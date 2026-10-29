import { AiAssistant } from "./Extra";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { fmtAmount } from "@/lib/expr";
import { MapView } from "@/components/MapView";
import { Section, UploadButton, useAction } from "@/components/ui-bits";
import type { Me } from "@/routes/app";

export function useGps() {
  const [pos, setPos] = useState<[number, number] | null>(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition((p) => setPos([p.coords.latitude, p.coords.longitude]), () => {}, { enableHighAccuracy: true });
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return pos;
}

export function ShopPanel() {
  const api = useApi();
  const act = useAction();
  const qc = useQueryClient();
  const pos = useGps();
  const [sort, setSort] = useState("price");
  const [q, setQ] = useState("");
  const { data: prods = [] } = useQuery<any[]>({ queryKey: ["shop", pos?.[0], pos?.[1]], queryFn: () => api("list_shop", { lat: pos?.[0], lng: pos?.[1] }) });
  const [buying, setBuying] = useState<any>(null);
  const [pms, setPms] = useState<any[]>([]);
  const [qty, setQty] = useState(1);
  const [pin, setPin] = useState("");
  const list = prods.filter((p) => !q || p.name.includes(q)).sort((a, b) => sort === "price" ? a.price - b.price : a.name.localeCompare(b.name));
  return (
    <Section title="商店" right={<div className="flex gap-2"><input className="field w-32" placeholder="搜索比价" value={q} onChange={(e) => setQ(e.target.value)} /><select className="field w-28" value={sort} onChange={(e) => setSort(e.target.value)}><option value="price">按价格</option><option value="name">按名称</option></select></div>}>
      <AiAssistant pos={pos} onPick={async (p) => { setBuying(p); setQty(1); setPms((await act<any[]>("payment_options", { currency_id: p.currency_id })) ?? []); }} />
      {!pos && <p className="mb-2 text-sm text-muted-foreground">开启定位后才能看到限定区域发货的商品。</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {list.map((p) => (
          <div key={p.id} className="rounded-lg border-2 border-ink bg-card p-3">
            {p.images?.[0] && <img src={p.images[0]} alt={p.name} className="mb-2 h-40 w-full rounded object-cover" />}
            <b>{p.name}</b> <span className="text-xs text-muted-foreground">卖家 {p.seller} · 库存 {p.stock}</span>
            <p className="text-sm">{p.description}</p>
            {p.videos?.[0] && <video src={p.videos[0]} controls className="mt-2 w-full rounded" />}
            <div className="mt-2 flex items-center justify-between">
              <span className="font-display text-xl">{p.symbol} {fmtAmount(p.price)}</span>
              <button className="btn" disabled={p.stock < 1} onClick={async () => { setBuying(p); setQty(1); setPms((await act<any[]>("payment_options", { currency_id: p.currency_id })) ?? []); }}>购买</button>
            </div>
          </div>
        ))}
        {!list.length && <p className="text-muted-foreground">暂无商品</p>}
      </div>
      {buying && (
        <div className="fixed inset-0 z-[1000] grid place-items-center bg-ink/50 p-4" onClick={() => setBuying(null)}>
          <div className="card-hard w-full max-w-sm space-y-3 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl">购买 {buying.name}</h3>
            <label className="text-sm">数量 <input className="field" type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} /></label>
            <p>合计：{buying.symbol} {fmtAmount(buying.price * qty)}</p>
            <input className="field" type="password" inputMode="numeric" placeholder="支付密码（已设置时必填）" value={pin} onChange={(e) => setPin(e.target.value)} />
            {!pms.length && <p className="text-destructive">没有可支付该货币的支付方式</p>}
            {pms.map((m) => (
              <button key={m.id} className="btn w-full" onClick={async () => {
                if (await act("buy", { product_id: buying.id, payment_method_id: m.id, qty, lat: pos?.[0], lng: pos?.[1], pay_pin: pin }, "购买成功")) { setBuying(null); setPin(""); qc.invalidateQueries({ queryKey: ["shop"] }); }
              }}>用 {m.name} 支付</button>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

export function SellerPanel() {
  const api = useApi();
  const act = useAction();
  const qc = useQueryClient();
  const { data: prods = [] } = useQuery<any[]>({ queryKey: ["myprods"], queryFn: () => api("my_products") });
  const { data: curs = [] } = useQuery<any[]>({ queryKey: ["currencies"], queryFn: () => api("list_currencies") });
  const empty = { id: "", name: "", description: "", price: "", currency_id: "", stock: "1", images: [] as string[], videos: [] as string[], area: { type: "world" } as any };
  const [f, setF] = useState(empty);
  const [drawPts, setDrawPts] = useState<[number, number][]>([]);
  const a = f.area;
  return (
    <>
      <Section title={f.id ? "编辑商品" : "上架商品"}>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="field" placeholder="商品名" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="field" placeholder="描述" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <input className="field" type="number" placeholder="价格" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          <select className="field" value={f.currency_id} onChange={(e) => setF({ ...f, currency_id: e.target.value })}><option value="">定价货币（需对你可见）</option>{curs.map((c) => <option key={c.id} value={c.id}>{c.symbol} {c.code}</option>)}</select>
          <input className="field" type="number" placeholder="库存" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} />
        </div>
        <div className="my-2 flex flex-wrap items-center gap-2">
          <UploadButton accept="image/*" label="上传图片" onDone={(u) => setF((x) => ({ ...x, images: [...x.images, u] }))} />
          <UploadButton accept="video/*" label="上传视频" onDone={(u) => setF((x) => ({ ...x, videos: [...x.videos, u] }))} />
          <span className="text-sm">{f.images.length} 张图片 · {f.videos.length} 个视频</span>
        </div>
        <div className="mb-2 flex flex-wrap gap-2 text-sm">
          发货区域：
          {(["world", "circle", "polygon"] as const).map((t) => (
            <button key={t} className={`btn ${a.type === t ? "" : "btn-ghost"}`} onClick={() => { setDrawPts([]); setF({ ...f, area: t === "world" ? { type: "world" } : t === "circle" ? { type: "circle", center: null, radius: 1000 } : { type: "polygon", points: [] } }); }}>{{ world: "全世界", circle: "圆形", polygon: "手画区域" }[t]}</button>
          ))}
          {a.type === "circle" && <input className="field w-36" type="number" placeholder="半径(米)" value={a.radius} onChange={(e) => setF({ ...f, area: { ...a, radius: Number(e.target.value) } })} />}
          {a.type === "polygon" && <button className="btn btn-ghost" onClick={() => { setDrawPts([]); setF({ ...f, area: { type: "polygon", points: [] } }); }}>清除重画</button>}
        </div>
        {a.type !== "world" && (
          <>
            <p className="mb-1 text-xs text-muted-foreground">{a.type === "circle" ? "点击地图选择圆心" : "在地图上依次点击画出区域边界"}</p>
            <MapView
              circle={a.type === "circle" && a.center ? { center: a.center, radius: a.radius } : null}
              polygon={a.type === "polygon" ? drawPts : undefined}
              onClick={(lat, lng) => {
                if (a.type === "circle") setF({ ...f, area: { ...a, center: [lat, lng] } });
                else { const pts = [...drawPts, [lat, lng] as [number, number]]; setDrawPts(pts); setF({ ...f, area: { type: "polygon", points: pts } }); }
              }}
            />
          </>
        )}
        <div className="mt-3 flex gap-2">
          <button className="btn" onClick={async () => {
            if (a.type === "circle" && !a.center) return alert("请选择圆心");
            if (a.type === "polygon" && a.points.length < 3) return alert("区域至少需要3个点");
            if (await act("save_product", f, "已保存")) { setF(empty); setDrawPts([]); qc.invalidateQueries({ queryKey: ["myprods"] }); }
          }}>保存</button>
          {f.id && <button className="btn btn-ghost" onClick={() => setF(empty)}>取消</button>}
        </div>
      </Section>
      <Section title="我的商品">
        {prods.map((p) => (
          <div key={p.id} className="flex items-center gap-2 border-b border-dashed py-1 text-sm">
            <b>{p.name}</b> <span>{fmtAmount(p.price)} · 库存 {p.stock}</span>
            <button className="ml-auto underline" onClick={() => { setF({ ...p, price: String(p.price), stock: String(p.stock) }); setDrawPts(p.area?.points ?? []); }}>编辑</button>
            <button className="underline" onClick={async () => { if (await act("delete_product", { id: p.id }, "已删除")) qc.invalidateQueries({ queryKey: ["myprods"] }); }}>删除</button>
          </div>
        ))}
      </Section>
    </>
  );
}

export function PayMethodsPanel({ me }: { me: Me }) {
  const api = useApi();
  const act = useAction();
  const qc = useQueryClient();
  const { data: pms = [] } = useQuery<any[]>({ queryKey: ["pms"], queryFn: () => api("list_payment_methods") });
  const { data: curs = [] } = useQuery<any[]>({ queryKey: ["currencies"], queryFn: () => api("list_currencies"), enabled: me.role !== "pay_admin" });
  const [n, setN] = useState({ name: "", fee_normal: 30 });
  const [keys, setKeys] = useState<Record<string, any[]>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ["pms"] });
  const isPay = me.role === "pay_admin" || me.role === "top";
  const isBank = me.role === "bank_admin" || me.role === "top";
  return (
    <>
      {isPay && (
        <Section title="添加支付方式">
          <div className="flex flex-wrap gap-2">
            <input className="field w-48" placeholder="如 七彩星光支付（qcxg pay）" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} />
            <label className="text-sm">普通用户手续费%<input className="field w-24" type="number" value={n.fee_normal} onChange={(e) => setN({ ...n, fee_normal: Number(e.target.value) })} /></label>
            <button className="btn" onClick={async () => { if (await act("save_pm", n, "已添加")) { setN({ name: "", fee_normal: 30 }); refresh(); } }}>添加</button>
          </div>
        </Section>
      )}
      <Section title="支付方式">
        {pms.map((p) => (
          <div key={p.id} className="mb-2 rounded-lg border-2 border-ink p-2">
            <div className="flex flex-wrap items-center gap-2">
              <b>{p.name}</b><span className="text-sm">普通用户手续费 {p.fee_normal}%</span>
              <span className="text-xs text-muted-foreground">支持 {p.currency_ids?.length ?? 0} 种货币</span>
              {isPay && <span className="ml-auto flex gap-2 text-sm">
                <button className="underline" onClick={async () => { const v = prompt("新手续费%", String(p.fee_normal)); if (v && (await act("save_pm", { id: p.id, fee_normal: Number(v) }, "已保存"))) refresh(); }}>改手续费</button>
                <button className="underline" onClick={async () => { const r = await act<{ key: string }>("gen_api_key", { payment_method_id: p.id }); if (r) setKeys({ ...keys, [p.id]: (await act<any[]>("list_api_keys", { payment_method_id: p.id })) ?? [] }); }}>生成API接口</button>
                <button className="underline" onClick={async () => setKeys({ ...keys, [p.id]: (await act<any[]>("list_api_keys", { payment_method_id: p.id })) ?? [] })}>查看接口</button>
                <button className="underline" onClick={async () => { if (confirm("删除？") && (await act("delete_pm", { id: p.id }, "已删除"))) refresh(); }}>删除</button>
              </span>}
            </div>
            {isBank && (
              <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-auto text-xs">
                <span className="w-full text-muted-foreground">设置此支付方式可见汇率的货币（只能用这些货币支付）：</span>
                {curs.map((c) => (
                  <label key={c.id} className="flex items-center gap-1 rounded border border-ink px-1">
                    <input type="checkbox" checked={p.currency_ids?.includes(c.id)} onChange={async (e) => {
                      const ids = e.target.checked ? [...(p.currency_ids ?? []), c.id] : p.currency_ids.filter((x: string) => x !== c.id);
                      if (await act("save_pm", { id: p.id, currency_ids: ids })) refresh();
                    }} />{c.code}
                  </label>
                ))}
              </div>
            )}
            {keys[p.id] && (
              <div className="mt-2 space-y-1 text-xs">
                {keys[p.id].map((k) => <code key={k.id} className="block break-all rounded bg-muted p-1">{k.key}</code>)}
                <p className="text-muted-foreground">调用：POST {typeof location !== "undefined" ? location.origin : ""}/api/public/pay，JSON：{"{"}key, from_username, password, to_username, currency_code, amount{"}"}</p>
              </div>
            )}
          </div>
        ))}
      </Section>
    </>
  );
}
