import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { addSession, getToken, listSessions, removeSession, useApi, useApiAs } from "@/lib/client";
import { FACILITY_KINDS, ROLE_LABEL, type FacilityKind, type Role } from "@/lib/roles";
import { Section, useAction } from "@/components/ui-bits";
import type { Me } from "@/routes/app";

/* ---------- ETC admin ---------- */
export function EtcAdminPanel({ me }: { me: Me }) {
  const api = useApi();
  const act = useAction();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const { data: rows = [] } = useQuery<any[]>({ queryKey: ["etc"], queryFn: () => api("etc_list") });
  const set = async (ids: string[], enabled: boolean) => {
    for (const id of ids) await act("set_etc", { id, enabled });
    toast.success(enabled ? "已开启" : "已关闭");
    qc.invalidateQueries({ queryKey: ["etc"] });
  };
  const list = rows.filter((r) => !filter || r.username.includes(filter));
  return (
    <Section title="ETC 开关（所有账号）" right={<input className="field w-40" placeholder="搜索" value={filter} onChange={(e) => setFilter(e.target.value)} />}>
      <p className="mb-2 text-sm text-muted-foreground">除顶级账号外，任何账号都不能控制自己的 ETC，只能由这里统一开关。{me.role === "top" ? "" : "顶级账号不在此列表。"}</p>
      <div className="mb-2 flex gap-2">
        <button className="btn btn-ghost" onClick={() => set(list.map((r) => r.id), true)}>全部开启</button>
        <button className="btn btn-ghost" onClick={() => set(list.map((r) => r.id), false)}>全部关闭</button>
      </div>
      <div className="space-y-1">
        {list.map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded border-2 border-ink bg-card px-2 py-1 text-sm">
            <b className="break-all">{r.username}</b>
            <span className="text-xs text-muted-foreground">{ROLE_LABEL[r.role as Role]}</span>
            <button className={`btn ml-auto ${r.etc_enabled ? "" : "btn-ghost"}`} onClick={() => set([r.id], !r.etc_enabled)}>{r.etc_enabled ? "ETC 已开" : "ETC 已关"}</button>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ---------- Screen admin ---------- */
export function ScreenPanel({ onOpened }: { onOpened: (token: string) => void }) {
  const api = useApi();
  const act = useAction();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [tf, setTf] = useState({ to: "", currency_id: "", amount: "" });
  const { data: rows = [] } = useQuery<any[]>({ queryKey: ["screen"], queryFn: () => api("screen_targets") });
  const { data: bals = [] } = useQuery<any[]>({ queryKey: ["screen_bal", open], queryFn: () => api("screen_balances", { id: open }), enabled: !!open });
  return (
    <Section title="投屏控制" right={<input className="field w-40" placeholder="搜索" value={filter} onChange={(e) => setFilter(e.target.value)} />}>
      <p className="mb-2 text-sm text-muted-foreground">「投屏」会把对方账号加入你的分身，你看到的就是对方的屏幕，可以替对方做任何操作。顶级账号和 ETC 管理账号不能投屏。</p>
      <div className="space-y-2">
        {rows.filter((r) => !filter || r.username.includes(filter)).map((r) => (
          <div key={r.id} className="rounded border-2 border-ink bg-card p-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <b className="break-all">{r.username}</b>
              <span className="text-xs text-muted-foreground">{ROLE_LABEL[r.role as Role]}</span>
              <button className="btn ml-auto" onClick={async () => {
                const x = await act<{ token: string; username: string; role: string }>("screen_open", { id: r.id });
                if (x) { addSession({ token: x.token, username: x.username, role: x.role }); onOpened(x.token); }
              }}>投屏</button>
              <button className="btn btn-ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>危险操作</button>
            </div>
            {open === r.id && (
              <div className="mt-2 space-y-2 border-t-2 border-dashed border-ink pt-2">
                <p>余额：{bals.length ? bals.map((b) => `${b.amount} ${b.code}`).join("，") : "无"}</p>
                <div className="grid gap-2 sm:grid-cols-4">
                  <input className="field" placeholder="转给（用户名）" value={tf.to} onChange={(e) => setTf({ ...tf, to: e.target.value })} />
                  <select className="field" value={tf.currency_id} onChange={(e) => setTf({ ...tf, currency_id: e.target.value })}>
                    <option value="">选择货币</option>{bals.map((b) => <option key={b.currency_id} value={b.currency_id}>{b.code}</option>)}
                  </select>
                  <input className="field" type="number" placeholder="金额" value={tf.amount} onChange={(e) => setTf({ ...tf, amount: e.target.value })} />
                  <button className="btn" onClick={async () => {
                    if (await act("screen_transfer", { from_id: r.id, to_username: tf.to, currency_id: tf.currency_id, amount: tf.amount }, "已转走")) qc.invalidateQueries({ queryKey: ["screen_bal"] });
                  }}>转走（无需支付密码）</button>
                </div>
                <button className="btn btn-danger" onClick={async () => {
                  if (confirm(`确定删除账号「${r.username}」？`) && (await act("screen_delete", { id: r.id }, "已删除"))) { setOpen(null); qc.invalidateQueries({ queryKey: ["screen"] }); }
                }}>删除该账号</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ---------- Security: pay password + devices ---------- */
export function DevicesPanel({ me, onChanged }: { me: Me; onChanged: (nextToken?: string) => void }) {
  const apiAs = useApiAs();
  const act = useAction();
  const qc = useQueryClient();
  const [pin, setPin] = useState({ old: "", pin: "" });
  const locals = listSessions();
  const { data = [], refetch } = useQuery<{ s: (typeof locals)[number]; rows: any[]; error?: string }[]>({
    queryKey: ["devices", locals.map((l) => l.token).join()],
    queryFn: () => Promise.all(locals.map(async (s) => {
      try { return { s, rows: await apiAs<any[]>(s.token, "my_sessions") }; } catch (e) { return { s, rows: [], error: (e as Error).message }; }
    })),
  });
  const dropLocal = (token: string) => {
    const wasActive = getToken() === token;
    const next = removeSession(token);
    if (wasActive) onChanged(next?.token);
  };
  return (
    <>
      <Section title="支付密码">
        <p className="mb-2 text-sm text-muted-foreground">{me.hasPayPin ? "已设置。购物付款时需要输入；ETC 等自动扣费不需要。" : "未设置。设置后购物付款时需要输入。"}忘记了请向顶级账号索取重设链接。</p>
        <form className="grid gap-2 sm:grid-cols-3" onSubmit={async (e) => {
          e.preventDefault();
          if (await act("set_pay_pin", { pin: pin.pin, old_pin: pin.old }, "支付密码已保存")) { setPin({ old: "", pin: "" }); qc.invalidateQueries({ queryKey: ["me"] }); }
        }}>
          {me.hasPayPin && <input className="field" type="password" placeholder="原支付密码" value={pin.old} onChange={(e) => setPin({ ...pin, old: e.target.value })} />}
          <input className="field" type="password" placeholder="新支付密码（至少6位）" value={pin.pin} onChange={(e) => setPin({ ...pin, pin: e.target.value })} />
          <button className="btn">保存</button>
        </form>
      </Section>
      <Section title="已登录设备" right={<button className="btn btn-danger" onClick={async () => {
        if (!confirm("确定撤销所有分身的所有登录？")) return;
        for (const l of locals) { try { await apiAs(l.token, "revoke_all_sessions", {}); } catch { /* already gone */ } removeSession(l.token); }
        onChanged(undefined);
      }}>全部撤销</button>}>
        <div className="space-y-3">
          {data.map(({ s, rows, error }) => (
            <div key={s.token} className="rounded border-2 border-ink bg-card p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <b className="break-all">{s.username}</b>
                <span className="text-xs text-muted-foreground">{ROLE_LABEL[s.role as Role] ?? s.role}</span>
                {getToken() === s.token && <span className="rounded bg-accent px-2 text-xs">当前分身</span>}
                <button className="btn btn-ghost ml-auto" onClick={() => dropLocal(s.token)}>退出此分身</button>
                <button className="btn btn-ghost" onClick={async () => { await apiAs(s.token, "revoke_all_sessions", { keep_current: true }).catch(() => null); toast.success("其他设备已撤销"); refetch(); }}>撤销其他设备</button>
              </div>
              {error && <p className="text-destructive">{error}（可点“退出此分身”移除）</p>}
              <ul className="mt-2 space-y-1">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 border-b border-dashed py-1">
                    <span className="min-w-0 flex-1 break-all">{r.current ? "【本浏览器】" : ""}{r.impersonated ? "【投屏】" : ""}{r.user_agent || "未知设备"} · {r.ip ?? ""}</span>
                    <span className="text-xs text-muted-foreground">登录 {new Date(r.created_at).toLocaleString()} · 活跃 {new Date(r.last_seen).toLocaleString()}</span>
                    <button className="underline" onClick={async () => {
                      await apiAs(s.token, "revoke_session", { id: r.id }).catch(() => null);
                      if (r.current) dropLocal(s.token); else refetch();
                    }}>撤销</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

/* ---------- Negative-rate currency (debt) prompt ---------- */
export function DebtPrompt() {
  const api = useApi();
  const act = useAction();
  const qc = useQueryClient();
  const [hidden, setHidden] = useState(false);
  const { data = [] } = useQuery<any[]>({ queryKey: ["debts"], queryFn: () => api("debts") });
  if (hidden || !data.length) return null;
  return (
    <div className="fixed inset-0 z-[1100] grid place-items-center bg-ink/60 p-4">
      <div className="card-hard w-full max-w-md space-y-3 p-4">
        {data.map((d) => (
          <div key={d.currency_id} className="space-y-2">
            <p className="text-lg">到账 <b>{d.amount} {d.code}</b></p>
            <p>请把所有的 {d.code} 换成人民币，一旦点击兑换将还清所有负债。你是换人民币还是存款？</p>
            <button className="btn w-full" onClick={async () => {
              if (await act("settle_debt", { currency_id: d.currency_id }, "已兑换，负债已还清")) qc.invalidateQueries();
            }}>换人民币（会收取手续费）</button>
          </div>
        ))}
        <button className="btn btn-ghost w-full" onClick={() => setHidden(true)}>存款（下次登录还会提醒）</button>
      </div>
    </div>
  );
}

/* ---------- AI shopping assistant ---------- */
export function AiAssistant({ pos, onPick }: { pos: [number, number] | null | undefined; onPick: (p: any) => void }) {
  const act = useAction();
  const [need, setNeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ summary: string; items: any[] } | null>(null);
  return (
    <div className="mb-4 rounded-lg border-2 border-ink bg-muted p-3">
      <h3 className="mb-2">AI 导购：说说你想要什么</h3>
      <form className="flex gap-2" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setRes(null);
        const r = await act<{ summary: string; items: any[] }>("ai_recommend", { need, lat: pos?.[0], lng: pos?.[1] });
        setBusy(false); if (r) setRes(r);
      }}>
        <input className="field flex-1" placeholder="例如：想要便宜又甜的零食送朋友" value={need} onChange={(e) => setNeed(e.target.value)} />
        <button className="btn" disabled={busy || !need.trim()}>{busy ? "思考中…" : "推荐"}</button>
      </form>
      {res && (
        <div className="mt-2 space-y-2 text-sm">
          <p>{res.summary}</p>
          {res.items.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded border-2 border-ink bg-card p-2">
              <div className="min-w-0 flex-1"><b>{p.name}</b> · {p.symbol} {p.price}<br /><span className="text-muted-foreground">{p.reason}</span></div>
              <button className="btn" onClick={() => onPick(p)}>购买</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Facility detailed settings ---------- */
type Mode = { mode: "none" | "free" | "pct"; pct?: number };
function ModePick({ v, onChange }: { v: Mode; onChange: (m: Mode) => void }) {
  return (
    <span className="inline-flex gap-1">
      <select className="field w-28" value={v.mode} onChange={(e) => onChange({ ...v, mode: e.target.value as Mode["mode"] })}>
        <option value="none">原价</option><option value="free">免费</option><option value="pct">按百分比</option>
      </select>
      {v.mode === "pct" && <input className="field w-24" type="number" placeholder="%" value={v.pct ?? 100} onChange={(e) => onChange({ ...v, pct: Number(e.target.value) })} />}
    </span>
  );
}
export function FacilityEditor({ fac, curs, onClose }: { fac: any; curs: any[]; onClose: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ ...fac, rules: { holidays: [], dates: [], holiday: { mode: "none" }, ...(fac.rules ?? {}) } });
  const r = f.rules;
  const setR = (p: any) => setF({ ...f, rules: { ...r, ...p } });
  const [newHoliday, setNewHoliday] = useState("");
  const isHotel = f.kind === "hotel";
  return (
    <div className="fixed inset-0 z-[1000] grid place-items-center overflow-auto bg-ink/50 p-4" onClick={onClose}>
      <div className="card-hard w-full max-w-lg space-y-3 p-4 text-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-xl">{FACILITY_KINDS[f.kind as FacilityKind]} · 详细设置</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <label>名称<input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>基础价格<input className="field" type="number" value={f.fee} onChange={(e) => setF({ ...f, fee: Number(e.target.value) })} /></label>
          <label>纬度<input className="field" type="number" value={f.lat ?? ""} onChange={(e) => setF({ ...f, lat: e.target.value === "" ? null : Number(e.target.value) })} /></label>
          <label>经度<input className="field" type="number" value={f.lng ?? ""} onChange={(e) => setF({ ...f, lng: e.target.value === "" ? null : Number(e.target.value) })} /></label>
          <label>感应范围（米）<input className="field" type="number" value={f.radius_m} onChange={(e) => setF({ ...f, radius_m: Number(e.target.value) })} /></label>
          <label>收费货币<select className="field" value={f.currency_id ?? ""} onChange={(e) => setF({ ...f, currency_id: e.target.value })}><option value="">选择</option>{curs.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select></label>
        </div>
        <div className="space-y-2 rounded border-2 border-ink p-2">
          <b>节假日</b>
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!r.weekend_holiday} onChange={(e) => setR({ weekend_holiday: e.target.checked })} />周六周日算节假日</label>
          <div className="flex flex-wrap gap-1">{(r.holidays as string[]).map((d) => <button key={d} className="rounded bg-secondary px-2" onClick={() => setR({ holidays: r.holidays.filter((x: string) => x !== d) })}>{d} ✕</button>)}</div>
          <div className="flex gap-2"><input className="field" type="date" value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} /><button className="btn btn-ghost" onClick={() => { if (newHoliday) { setR({ holidays: [...new Set([...r.holidays, newHoliday])] }); setNewHoliday(""); } }}>添加节假日</button></div>
          <div>节假日价格：<ModePick v={r.holiday} onChange={(m) => setR({ holiday: m })} /> <span className="text-muted-foreground">（低于100%为打折，高于100%为涨价）</span></div>
        </div>
        <div className="space-y-2 rounded border-2 border-ink p-2">
          <b>特定日期（优先于节假日）</b>
          {(r.dates as any[]).map((d, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input className="field w-40" type="date" value={d.date} onChange={(e) => setR({ dates: r.dates.map((x: any, j: number) => (j === i ? { ...x, date: e.target.value } : x)) })} />
              <ModePick v={d} onChange={(m) => setR({ dates: r.dates.map((x: any, j: number) => (j === i ? { ...x, ...m } : x)) })} />
              <button className="underline" onClick={() => setR({ dates: r.dates.filter((_: any, j: number) => j !== i) })}>删除</button>
            </div>
          ))}
          <button className="btn btn-ghost" onClick={() => setR({ dates: [...r.dates, { date: "", mode: "free" }] })}>添加特定日期</button>
        </div>
        {isHotel && (
          <div className="space-y-2 rounded border-2 border-ink p-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!r.ai} onChange={(e) => setR({ ai: e.target.checked })} /><b>AI 自动调价</b>（住的人多/住得久自动涨价，没人来/很多人走自动降价，约每30分钟重新计算）</label>
            {r.ai_mult && <p>当前倍数 ×{Number(r.ai_mult).toFixed(2)}{r.ai_reason ? ` · ${r.ai_reason}` : ""}</p>}
            {fac.id && <button className="btn btn-ghost" onClick={async () => { const x = await act<any>("ai_price_hotel", { id: fac.id }, "AI 已重新定价"); if (x) setF({ ...f, rules: { ...r, ...x } }); }}>立即让 AI 重新定价</button>}
          </div>
        )}
        <div className="flex gap-2">
          <button className="btn flex-1" onClick={async () => { if (await act("save_facility", f, "已保存")) onClose(); }}>保存</button>
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Background location: charge every 分身 ---------- */
export function BackgroundEtc() {
  const apiAs = useApiAs();
  const [pos, setPos] = useState<[number, number] | null>(null);
  const [err, setErr] = useState("");
  const posRef = useRef(pos);
  posRef.current = pos;
  useEffect(() => {
    if (!navigator.geolocation) { setErr("此浏览器不支持定位"); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => { setPos([p.coords.latitude, p.coords.longitude]); setErr(""); },
      (e) => setErr(e.code === 1 ? "未允许定位" : "定位失败"),
      { enableHighAccuracy: true, maximumAge: 10000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  useEffect(() => {
    const tick = async () => {
      const p = posRef.current;
      for (const s of listSessions()) {
        try {
          const r = await apiAs<{ events: string[] }>(s.token, "heartbeat", { lat: p?.[0], lng: p?.[1] });
          for (const e of r.events) toast(`${s.username}：${e}`);
        } catch { /* session gone */ }
      }
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [apiAs]);
  return <p className="px-3 pb-1 text-center text-[10px] text-muted-foreground">后台定位：{err || (pos ? `${pos[0].toFixed(4)}, ${pos[1].toFixed(4)}` : "定位中…")} · 所有分身自动计费</p>;
}

/* ---------- Discount cards ---------- */
const CARD_MODES: Record<string, string> = { none: "无优待卡", pct: "每次按百分比", fixed: "每次固定金额", free_then_pct: "免费N次后按百分比", per_min: "按分钟计价", free: "一直免费" };
export function CardPanel() {
  const api = useApi();
  const act = useAction();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [edit, setEdit] = useState<Record<string, any>>({});
  const { data: rows = [] } = useQuery<any[]>({ queryKey: ["cards"], queryFn: () => api("card_list") });
  const desc = (c: any) => !c ? "无" : c.mode === "pct" ? `每次${c.pct}%` : c.mode === "fixed" ? `每次${c.amount}` : c.mode === "free_then_pct" ? `免费${c.free_count}次（已用${c.used}）后${c.pct}%` : c.mode === "per_min" ? `每分钟${c.per_min}` : "一直免费";
  return (
    <Section title="优待卡" right={<input className="field w-40" placeholder="搜索" value={filter} onChange={(e) => setFilter(e.target.value)} />}>
      <p className="mb-2 text-sm text-muted-foreground">优待卡用于收费站、停车场、酒店、IP 计费等自动扣费。百分比低于100%是打折，高于100%就比原价还贵。金额按该收费项目的货币计算。</p>
      <div className="space-y-2">
        {rows.filter((r) => !filter || r.username.includes(filter)).map((r) => {
          const e = edit[r.id];
          return (
            <div key={r.id} className="rounded border-2 border-ink bg-card p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <b className="break-all">{r.username}</b>
                <span className="text-xs text-muted-foreground">{ROLE_LABEL[r.role as Role]}</span>
                <span className="text-xs">当前：{desc(r.card)}</span>
                <button className="btn btn-ghost ml-auto" onClick={() => setEdit({ ...edit, [r.id]: e ? undefined : { mode: "pct", pct: 50, amount: 25, free_count: 5, per_min: 2, ...(r.card ?? {}) } })}>{e ? "收起" : "设置"}</button>
              </div>
              {e && (
                <div className="mt-2 flex flex-wrap items-end gap-2 border-t-2 border-dashed border-ink pt-2">
                  <select className="field w-44" value={e.mode} onChange={(x) => setEdit({ ...edit, [r.id]: { ...e, mode: x.target.value } })}>
                    {Object.entries(CARD_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  {e.mode === "free_then_pct" && <label>免费次数<input className="field w-20" type="number" value={e.free_count} onChange={(x) => setEdit({ ...edit, [r.id]: { ...e, free_count: x.target.value } })} /></label>}
                  {(e.mode === "pct" || e.mode === "free_then_pct") && <label>百分比%<input className="field w-24" type="number" value={e.pct} onChange={(x) => setEdit({ ...edit, [r.id]: { ...e, pct: x.target.value } })} /></label>}
                  {e.mode === "fixed" && <label>每次金额<input className="field w-24" type="number" value={e.amount} onChange={(x) => setEdit({ ...edit, [r.id]: { ...e, amount: x.target.value } })} /></label>}
                  {e.mode === "per_min" && <label>每分钟金额<input className="field w-24" type="number" value={e.per_min} onChange={(x) => setEdit({ ...edit, [r.id]: { ...e, per_min: x.target.value } })} /></label>}
                  {e.mode === "free_then_pct" && <label className="flex items-center gap-1"><input type="checkbox" checked={!!e.reset} onChange={(x) => setEdit({ ...edit, [r.id]: { ...e, reset: x.target.checked } })} />重置已用次数</label>}
                  <button className="btn" onClick={async () => {
                    if (await act("set_card", { id: r.id, card: e }, "优待卡已保存")) { setEdit({ ...edit, [r.id]: undefined }); qc.invalidateQueries({ queryKey: ["cards"] }); }
                  }}>保存</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
