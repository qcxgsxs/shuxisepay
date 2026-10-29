import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { downloadCsv, useApi } from "@/lib/client";
import { FACILITY_KINDS, ROLE_LABEL, ROLES, type FacilityKind, type Role } from "@/lib/roles";
import { MapView } from "@/components/MapView";
import { Section, UploadButton, useAction } from "@/components/ui-bits";
import { useGps } from "./Commerce";
import { FacilityEditor } from "./Extra";
import type { Me } from "@/routes/app";
import type { Config } from "@/components/Shell";

const KIND_COLOR: Record<string, string> = { toll: "#e2554a", parking: "#4a6ee2", hotel: "#d9a520", house: "#8a5a2b", bridge: "#555", road: "#777", scenic: "#3aa76d", park: "#2fb05a", ip: "#9b4ae2" };

export function MapPanel({ me }: { me: Me }) {
  const api = useApi();
  const act = useAction();
  const qc = useQueryClient();
  const pos = useGps();
  const { data: facs = [] } = useQuery<any[]>({ queryKey: ["facs"], queryFn: () => api("list_facilities") });
  const { data: curs = [] } = useQuery<any[]>({ queryKey: ["currencies"], queryFn: () => api("list_currencies"), enabled: me.role !== "normal" });
  const canBuild = me.role === "engineer" || me.role === "top";
  const allowed = (Object.keys(FACILITY_KINDS) as FacilityKind[]).filter((k) => me.role === "top" || me.perms[`build_${k}`]);
  const empty = { kind: allowed[0] ?? "toll", name: "", lat: null as number | null, lng: null as number | null, radius_m: 50, fee: 1, currency_id: "", ip: "" };
  const [f, setF] = useState(empty);
  const [editing, setEditing] = useState<any>(null);
  const canEditAll = me.role === "top" || me.role === "engineer_admin";
  const mine = facs.filter((x) => canEditAll || x.engineer_id === me.id);
  return (
    <>
      <Section title="地图">
        <MapView
          center={pos}
          markers={[...facs.filter((x) => x.lat != null).map((x) => ({ lat: x.lat, lng: x.lng, radius: x.radius_m, label: `${FACILITY_KINDS[x.kind as FacilityKind]}·${x.name}（${x.accounts?.username}）`, color: KIND_COLOR[x.kind] })),
            ...(f.lat != null ? [{ lat: f.lat, lng: f.lng!, radius: f.radius_m, label: "新选点", color: "#000" }] : []),
            ...(pos ? [{ lat: pos[0], lng: pos[1], label: "我的位置", color: "#22c" }] : [])]}
          onClick={canBuild ? (lat, lng) => setF({ ...f, lat, lng }) : undefined}
        />
      </Section>
      {canBuild && (
        <Section title="建设 / 设置收费点">
          {!allowed.length ? <p>你没有任何建设权限</p> : (
            <div className="grid gap-2 sm:grid-cols-3">
              <select className="field" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as FacilityKind })}>{allowed.map((k) => <option key={k} value={k}>{FACILITY_KINDS[k]}</option>)}</select>
              <input className="field" placeholder="名称" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              {f.kind === "ip" ? <input className="field" placeholder="IP，如 168.84.80.98" value={f.ip} onChange={(e) => setF({ ...f, ip: e.target.value })} />
                : <span className="self-center text-sm">{f.lat != null ? `已选点 ${f.lat.toFixed(5)}, ${f.lng!.toFixed(5)}` : "点击地图选点"}</span>}
              {(f.kind === "toll" || f.kind === "parking" || f.kind === "hotel") && <label className="text-sm">感应范围（米）<input className="field" type="number" value={f.radius_m} onChange={(e) => setF({ ...f, radius_m: Number(e.target.value) })} /></label>}
              {["toll", "parking", "ip", "hotel"].includes(f.kind) && <>
                <label className="text-sm">{f.kind === "toll" ? "每次收费" : f.kind === "parking" ? "每分钟收费" : f.kind === "hotel" ? "每小时收费" : "每秒收费"}（上限 {me.perms.max_fee ?? "∞"}）<input className="field" type="number" value={f.fee} onChange={(e) => setF({ ...f, fee: Number(e.target.value) })} /></label>
                <label className="text-sm">收费货币<select className="field" value={f.currency_id} onChange={(e) => setF({ ...f, currency_id: e.target.value })}><option value="">选择</option>{curs.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select></label>
              </>}
              <button className="btn sm:col-span-3" onClick={async () => {
                if (f.kind !== "ip" && f.lat == null) return alert("请在地图上选点");
                if (await act("save_facility", f, "已建设")) { setF(empty); qc.invalidateQueries({ queryKey: ["facs"] }); }
              }}>建设</button>
            </div>
          )}
        </Section>
      )}
      {(canBuild || canEditAll) && (
        <Section title="收费项目（收费站 / 酒店 / 停车场等）">
          <div className="space-y-1 text-sm">
            {!mine.length && <p className="text-muted-foreground">暂无</p>}
            {mine.map((x) => (
              <div key={x.id} className="flex flex-wrap gap-2 border-b border-dashed py-1">
                <span>{FACILITY_KINDS[x.kind as FacilityKind]} · {x.name} {x.ip ?? ""} · 收费 {x.fee} {x.currencies?.code ?? ""}{x.rules?.ai ? ` · AI倍数 ×${Number(x.rules.ai_mult ?? 1).toFixed(2)}` : ""}</span>
                <button className="ml-auto underline" onClick={() => setEditing(x)}>详细设置</button>
                {(me.role === "top" || x.engineer_id === me.id) && <button className="underline" onClick={async () => { if (await act("delete_facility", { id: x.id }, "已拆除")) qc.invalidateQueries({ queryKey: ["facs"] }); }}>拆除</button>}
              </div>
            ))}
          </div>
        </Section>
      )}
      {editing && <FacilityEditor fac={editing} curs={curs} onClose={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["facs"] }); }} />}
    </>
  );
}

export function EtcPanel() {
  const api = useApi();
  const pos = useGps();
  const [on, setOn] = useState(false); // detailed log view; background charging always runs
  const [events, setEvents] = useState<string[]>([]);
  const [ip, setIp] = useState("");
  const posRef = useRef(pos);
  posRef.current = pos;
  useEffect(() => {
    if (!on) return;
    const tick = async () => {
      try {
        const r = await api<{ events: string[]; ip: string }>("heartbeat", { lat: posRef.current?.[0], lng: posRef.current?.[1] });
        setIp(r.ip);
        if (r.events.length) setEvents((e) => [...r.events.map((x) => `${new Date().toLocaleTimeString()} ${x}`), ...e].slice(0, 50));
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [on, api]);
  return (
    <Section title="ETC 自动扣费">
      <p className="mb-2 text-sm">打开APP后会自动后台定位：到达收费站、停车场、酒店或命中IP计费时，会给每个分身都扣一遍费，没钱会扣成负数。ETC 开关由 ETC 管理账号控制。</p>
      <button className="btn btn-ghost" onClick={() => setOn(!on)}>{on ? "隐藏本账号扣费记录" : "查看本账号扣费记录"}</button>
      <p className="mt-2 text-xs text-muted-foreground">位置：{pos ? `${pos[0].toFixed(5)}, ${pos[1].toFixed(5)}` : "未获取"} · IP：{ip || "-"}</p>
      <ul className="mt-2 space-y-1 text-sm">{events.map((e, i) => <li key={i}>{e}</li>)}</ul>
    </Section>
  );
}

export function ChatPanel({ me }: { me: Me }) {
  const api = useApi();
  const act = useAction();
  const { data: contacts = [], refetch } = useQuery<any[]>({ queryKey: ["contacts"], queryFn: () => api("contacts"), refetchInterval: 10000 });
  const [sel, setSel] = useState<any>(null);
  const [text, setText] = useState("");
  const [newU, setNewU] = useState("");
  const { data: msgs = [], refetch: rm } = useQuery<any[]>({ queryKey: ["msgs", sel?.id], queryFn: () => api("messages", { with_id: sel.id }), enabled: !!sel, refetchInterval: 4000 });
  return (
    <Section title="聊天">
      <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
        <div className="space-y-1">
          <div className="flex gap-1"><input className="field" placeholder="用户名" value={newU} onChange={(e) => setNewU(e.target.value)} /><button className="btn" onClick={async () => { const r = await act<{ id: string }>("send_message", { to_username: newU, body: "你好" }); if (r) { setNewU(""); await refetch(); setSel({ id: r.id, username: newU }); } }}>+</button></div>
          {contacts.map((c) => (
            <button key={c.id} className={`block w-full rounded border-2 border-ink px-2 py-1 text-left text-sm ${sel?.id === c.id ? "bg-secondary" : "bg-card"}`} onClick={() => setSel(c)}>
              {c.username} <span className="text-xs text-muted-foreground">{ROLE_LABEL[c.role as Role]}</span>
            </button>
          ))}
        </div>
        <div className="flex min-h-[320px] flex-col rounded border-2 border-ink bg-card">
          <div className="flex-1 space-y-1 overflow-auto p-2">
            {!sel && <p className="text-muted-foreground">选择联系人</p>}
            {msgs.map((m) => (
              <div key={m.id} className={`max-w-[80%] rounded px-2 py-1 text-sm ${m.from_id === me.id ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}>{m.body}</div>
            ))}
          </div>
          {sel && (
            <form className="flex gap-1 border-t-2 border-ink p-1" onSubmit={async (e) => { e.preventDefault(); if (await act("send_message", { to_id: sel.id, body: text })) { setText(""); rm(); } }}>
              <input className="field" value={text} onChange={(e) => setText(e.target.value)} /><button className="btn">发送</button>
            </form>
          )}
        </div>
      </div>
    </Section>
  );
}

export function LogsPanel({ me }: { me: Me }) {
  const act = useAction();
  const [role, setRole] = useState("");
  return (
    <Section title="导出日志">
      <div className="flex flex-wrap gap-2">
        {me.role === "top" && <select className="field w-48" value={role} onChange={(e) => setRole(e.target.value)}><option value="">所有账号</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>}
        <button className="btn" onClick={async () => { const r = await act<any[]>("export_logs", { role: role || undefined }); if (r) downloadCsv(`日志-${new Date().toISOString().slice(0, 10)}.csv`, r); }}>导出 CSV</button>
      </div>
    </Section>
  );
}

export const MENU_KEYS: Record<string, string> = {
  home: "首页棋盘", ...Object.fromEntries(ROLES.map((r) => [`login_${r}`, `${ROLE_LABEL[r]}登录页`])),
  wallet: "钱包", accounts: "账号", perms: "权限", currency: "货币", pay: "支付方式", shop: "商店", seller: "我的商品", map: "地图", etc: "ETC", chat: "聊天", logs: "日志", look: "外观", tests: "测试", etcadm: "ETC管理", cards: "优待卡", screen: "投屏", devices: "安全与设备", reset: "重设密码页",
};

export function AppearancePanel() {
  const api = useApi();
  const act = useAction();
  const qc = useQueryClient();
  const { data: cfg } = useQuery<Config>({ queryKey: ["config"], queryFn: () => api("config") });
  if (!cfg) return null;
  const save = async (key: string, value: unknown) => { await act("set_setting", { key, value }, "已保存"); qc.invalidateQueries({ queryKey: ["config"] }); };
  const t = cfg.theme ?? {};
  return (
    <>
      <Section title="应用图标">
        <div className="flex flex-wrap items-center gap-3">
          {cfg.icon?.url && <img src={cfg.icon.url} alt="" className="h-16 w-16 rounded border-2 border-ink object-cover" style={{ opacity: cfg.icon.opacity ?? 1 }} />}
          <UploadButton accept="image/*" label="上传图标" onDone={(url) => save("icon", { ...cfg.icon, url })} />
          <label className="text-sm">透明度 {Math.round((cfg.icon?.opacity ?? 1) * 100)}%<input type="range" min={0} max={1} step={0.01} defaultValue={cfg.icon?.opacity ?? 1} onMouseUp={(e) => save("icon", { ...cfg.icon, opacity: Number((e.target as HTMLInputElement).value) })} onTouchEnd={(e) => save("icon", { ...cfg.icon, opacity: Number((e.target as HTMLInputElement).value) })} /></label>
          {cfg.icon?.url && <button className="underline" onClick={() => save("icon", {})}>移除</button>}
        </div>
      </Section>
      <Section title="文字（留空用默认）">
        <div className="grid gap-2 sm:grid-cols-2">
          {[["app_name", "应用名称", "七彩星光支付"], ["app_sub", "副标题", "QCXG PAY · 仅虚拟财产互动"], ["signup_link", "注册链接文字", "没有账号？点击注册"], ["signup_title", "注册标题", "注册账号"], ["signup_btn", "注册按钮", "注册并登录"], ["login_btn", "登录按钮", "登录"], ["tile_signup", "首页格子（可注册）", "登录 / 注册 →"], ["tile_login", "首页格子（仅登录）", "登录 →"],
            ...ROLES.map((r) => [`role_${r}`, `账号名称：${ROLE_LABEL[r]}`, ROLE_LABEL[r]]),
            ...Object.entries(MENU_KEYS).filter(([k]) => !k.startsWith("login_") && k !== "home" && k !== "reset").map(([k, v]) => [`menu_${k}`, `菜单：${v}`, v])].map(([k, label, def]) => (
            <label key={k} className="text-sm">{label}
              <input className="field" placeholder={def} defaultValue={cfg.texts?.[k] ?? ""} onBlur={(e) => { if ((cfg.texts?.[k] ?? "") !== e.target.value) save("texts", { ...cfg.texts, [k]: e.target.value }); }} />
            </label>
          ))}
        </div>
      </Section>
      <Section title="注册方式">
        <p className="mb-2 text-sm">选择哪些登录窗口可以自己注册，以及每个入口每月可注册数量（0 = 不限）。</p>
        <div className="flex flex-wrap gap-2 text-sm">
          {ROLES.map((r) => (
            <label key={r} className="flex items-center gap-1 rounded border-2 border-ink px-2">
              <input type="checkbox" checked={cfg.signup?.roles?.includes(r) ?? r === "normal"} onChange={(e) => {
                const roles = cfg.signup?.roles ?? ["normal"];
                save("signup", { ...cfg.signup, roles: e.target.checked ? [...roles, r] : roles.filter((x) => x !== r) });
              }} />{ROLE_LABEL[r]}
            </label>
          ))}
          <label>每月上限<input className="field w-24" type="number" min={0} defaultValue={cfg.signup?.monthly_limit ?? 1} onBlur={(e) => save("signup", { roles: cfg.signup?.roles ?? ["normal"], monthly_limit: Number(e.target.value) })} /></label>
        </div>
      </Section>
      <Section title="风格与布局">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">主色调 {t.hue ?? 30}<input type="range" className="w-full" min={0} max={360} defaultValue={t.hue ?? 30} onMouseUp={(e) => save("theme", { ...t, hue: Number((e.target as HTMLInputElement).value) })} onTouchEnd={(e) => save("theme", { ...t, hue: Number((e.target as HTMLInputElement).value) })} /></label>
          <label className="text-sm">圆角 {t.radius ?? 0.9}<input type="range" className="w-full" min={0} max={2} step={0.1} defaultValue={t.radius ?? 0.9} onMouseUp={(e) => save("theme", { ...t, radius: Number((e.target as HTMLInputElement).value) })} onTouchEnd={(e) => save("theme", { ...t, radius: Number((e.target as HTMLInputElement).value) })} /></label>
          <label className="text-sm">面板/文字框透明度 {Math.round((t.panelOpacity ?? 1) * 100)}%（调到0只留文字，能看到整张壁纸）<input type="range" className="w-full" min={0} max={1} step={0.05} defaultValue={t.panelOpacity ?? 1} onMouseUp={(e) => save("theme", { ...t, panelOpacity: Number((e.target as HTMLInputElement).value) })} onTouchEnd={(e) => save("theme", { ...t, panelOpacity: Number((e.target as HTMLInputElement).value) })} /></label>
          <label className="text-sm">首页布局<select className="field" value={t.layout ?? "board"} onChange={(e) => save("theme", { ...t, layout: e.target.value })}><option value="board">棋盘格</option><option value="list">列表</option></select></label>
          <label className="text-sm">菜单位置<select className="field" value={t.nav ?? "top"} onChange={(e) => save("theme", { ...t, nav: e.target.value })}><option value="top">顶部</option><option value="side">侧边</option></select></label>
        </div>
      </Section>
      <Section title="各菜单壁纸">
        <div className="space-y-2">
          {Object.entries(MENU_KEYS).map(([k, label]) => {
            const w = cfg.wallpapers?.[k] ?? {};
            const set = (v: object) => save("wallpapers", { ...cfg.wallpapers, [k]: { ...w, ...v } });
            return (
              <div key={k} className="flex flex-wrap items-center gap-2 border-b border-dashed py-1 text-sm">
                <span className="w-36">{label}</span>
                {w.url && <img src={w.url} alt="" className="h-10 w-16 rounded border object-cover" style={{ opacity: w.opacity ?? 1 }} />}
                <UploadButton accept="image/*" label={w.url ? "更换" : "上传"} onDone={(url) => set({ url })} />
                {w.url && <>
                  <input type="range" min={0} max={1} step={0.01} defaultValue={w.opacity ?? 1} onMouseUp={(e) => set({ opacity: Number((e.target as HTMLInputElement).value) })} onTouchEnd={(e) => set({ opacity: Number((e.target as HTMLInputElement).value) })} />
                  <span>{Math.round((w.opacity ?? 1) * 100)}%</span>
                  <button className="underline" onClick={() => { const n = { ...cfg.wallpapers }; delete n[k]; save("wallpapers", n); }}>移除</button>
                </>}
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}
