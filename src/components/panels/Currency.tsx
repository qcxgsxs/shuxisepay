import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { fmtLog10 } from "@/lib/expr";
import { ROLE_LABEL, ROLES } from "@/lib/roles";
import { Section, useAction } from "@/components/ui-bits";

export function CurrencyPanel() {
  const api = useApi();
  const act = useAction();
  const qc = useQueryClient();
  const { data: curs = [] } = useQuery<any[]>({ queryKey: ["currencies"], queryFn: () => api("list_currencies") });
  const { data: s } = useQuery<any>({ queryKey: ["settings"], queryFn: () => api("get_settings") });
  const empty = { id: "", code: "", name: "", symbol: "", rate_expr: "1" };
  const [f, setF] = useState(empty);
  const [preview, setPreview] = useState("");
  const [op, setOp] = useState({ symbol: "", kind: "tetration" });
  const [fees, setFees] = useState<Record<string, number>>({});
  const [gift, setGift] = useState({ currency: "XMY", amount: 100000000 });
  useEffect(() => { if (s) { setFees(s.fees ?? {}); setGift(s.bank_gift ?? gift); } }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ log10: number; estimated: boolean }>("preview_rate", { rate_expr: f.rate_expr })
        .then((r) => setPreview(`${r.estimated ? "≈（太大，已估算）" : "="} ${fmtLog10(r.log10)} 人民币`))
        .catch((e) => setPreview(e.message));
    }, 300);
    return () => clearTimeout(t);
  }, [f.rate_expr, api, s?.operators]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["currencies"] }); qc.invalidateQueries({ queryKey: ["settings"] }); };
  const ops: { symbol: string; kind: string }[] = s?.operators ?? [];

  return (
    <>
      <Section title={f.id ? "编辑货币" : "创建货币"} right={<button className="btn btn-ghost" onClick={async () => { const r = await act<{ count: number }>("import_real", {}); if (r) { refresh(); alert(`已导入/更新 ${r.count} 种真实货币`); } }}>一键导入真实货币</button>}>
        <form className="grid gap-2 sm:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault();
          if (await act("save_currency", f, "已保存")) { setF(empty); refresh(); }
        }}>
          <input className="field" placeholder="代码，如 XMY" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          <input className="field" placeholder="名称，如 厦门元" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="field" placeholder="符号，如 XMY$" value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value })} />
          <input className="field" placeholder="1单位 = ? 人民币，如 89い783" value={f.rate_expr} onChange={(e) => setF({ ...f, rate_expr: e.target.value })} />
          <p className="text-sm sm:col-span-2">汇率结果：<b className="break-all">{preview}</b></p>
          <div className="flex gap-2 sm:col-span-2">
            <button className="btn">{f.id ? "保存修改" : "创建"}</button>
            {f.id && <button type="button" className="btn btn-ghost" onClick={() => setF(empty)}>取消</button>}
          </div>
        </form>
      </Section>

      <Section title="运算符号">
        <p className="mb-2 text-sm text-muted-foreground">慕塔（tetration）：aあb 表示 a 的 b 层幂塔；连续慕塔（iterated）：aいb 表示 aあaあ…あa 共 b 次。</p>
        <div className="mb-2 flex flex-wrap gap-2">
          {ops.map((o) => (
            <span key={o.symbol} className="rounded border-2 border-ink bg-secondary px-2 py-1 text-sm">
              {o.symbol} · {({ tetration: "慕塔", iterated: "连续慕塔", power: "乘方", multiply: "乘" } as Record<string, string>)[o.kind]}
              <button className="ml-2 underline" onClick={async () => { await act("set_setting", { key: "operators", value: ops.filter((x) => x.symbol !== o.symbol) }, "已删除"); refresh(); }}>删</button>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <input className="field w-24" placeholder="符号" value={op.symbol} onChange={(e) => setOp({ ...op, symbol: e.target.value })} />
          <select className="field w-36" value={op.kind} onChange={(e) => setOp({ ...op, kind: e.target.value })}>
            <option value="tetration">慕塔</option><option value="iterated">连续慕塔</option><option value="power">乘方</option><option value="multiply">乘</option>
          </select>
          <button className="btn" onClick={async () => {
            if (!op.symbol || /[0-9.+\-*/^()\s]/.test(op.symbol)) return alert("符号无效");
            await act("set_setting", { key: "operators", value: [...ops.filter((x) => x.symbol !== op.symbol), op] }, "已添加");
            setOp({ ...op, symbol: "" }); refresh();
          }}>添加符号</button>
        </div>
      </Section>

      <Section title="货币兑换手续费（%）">
        <div className="grid gap-2 sm:grid-cols-3">
          {ROLES.map((r) => (
            <label key={r} className="text-sm">
              {ROLE_LABEL[r]}
              <input className="field" type="number" value={fees[r] ?? fees.other ?? 15} onChange={(e) => setFees({ ...fees, [r]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
        <button className="btn mt-2" onClick={() => act("set_setting", { key: "fees", value: fees }, "已保存")}>保存手续费</button>
      </Section>

      <Section title="银行账号注册赠送">
        <div className="flex flex-wrap gap-2">
          <select className="field w-40" value={gift.currency} onChange={(e) => setGift({ ...gift, currency: e.target.value })}>
            {curs.map((c) => <option key={c.id} value={c.code}>{c.code}</option>)}
          </select>
          <input className="field w-48" type="number" value={gift.amount} onChange={(e) => setGift({ ...gift, amount: Number(e.target.value) })} />
          <button className="btn" onClick={() => act("set_setting", { key: "bank_gift", value: gift }, "已保存")}>保存</button>
        </div>
      </Section>

      <Section title={`全部货币（${curs.length}）`}>
        <div className="max-h-[480px] space-y-1 overflow-auto">
          {curs.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 border-b border-dashed py-1 text-sm">
              <b>{c.symbol} {c.code}</b><span>{c.name}</span>
              <span className="break-all text-muted-foreground">1 = {c.rate_log10 != null ? fmtLog10(c.rate_log10) : "?"} RMB（{c.rate_expr}）</span>
              <span className="ml-auto flex gap-2">
                <button className="underline" onClick={() => setF({ id: c.id, code: c.code, name: c.name, symbol: c.symbol, rate_expr: c.rate_expr })}>编辑</button>
                <button className="underline" onClick={async () => { if (confirm("删除该货币？") && (await act("delete_currency", { id: c.id }, "已删除"))) refresh(); }}>删除</button>
              </span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
