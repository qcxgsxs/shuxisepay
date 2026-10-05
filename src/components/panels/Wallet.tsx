import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApi } from "@/lib/client";
import { fmtAmount, fmtLog10 } from "@/lib/expr";
import { Section, useAction } from "@/components/ui-bits";
import type { Me } from "@/routes/app";

export function WalletPanel({ me }: { me: Me }) {
  const api = useApi();
  const act = useAction();
  const qc = useQueryClient();
  const { data: w } = useQuery<any>({ queryKey: ["wallet"], queryFn: () => api("my_wallet"), refetchInterval: 10000 });
  const { data: curs = [] } = useQuery<any[]>({ queryKey: ["currencies"], queryFn: () => api("list_currencies") });
  const full = curs.filter((c) => c.rate_log10 != null);
  const [ex, setEx] = useState({ from: "", to: "", amount: "" });
  const [g, setG] = useState({ username: "", currency_id: "", amount: "" });
  const refresh = () => qc.invalidateQueries({ queryKey: ["wallet"] });
  const canGive = me.role === "top" || me.role === "bank_admin" || (me.role === "bank" && me.perms.give_money);
  const canDeduct = me.role === "top" || (me.role === "bank" && me.perms.auto_deduct);

  if (w?.hidden) return <Section title="钱包"><p>普通账号不可查看货币与汇率。购物时如余额不足会提示你。</p></Section>;
  return (
    <>
      <Section title="我的资产">
        {!w?.rows?.length && <p className="text-muted-foreground">暂无资产</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {w?.rows?.map((r: any) => (
            <div key={r.currency_id} className="rounded-lg border-2 border-ink bg-secondary p-3">
              <div className="text-xs">{r.code}</div>
              <div className="break-all font-display text-2xl">{r.symbol} {fmtAmount(r.amount)}</div>
              {r.rate_log10 != null && <div className="text-xs text-muted-foreground">1 = {fmtLog10(r.rate_log10)} RMB</div>}
            </div>
          ))}
        </div>
      </Section>
      {me.role !== "normal" && (
        <Section title={`货币兑换（手续费 ${w?.fee ?? "-"}%）`}>
          <form className="grid gap-2 sm:grid-cols-4" onSubmit={async (e) => { e.preventDefault(); const r = await act<{ out: number }>("exchange", ex); if (r) { alert(`兑换得到 ${fmtAmount(r.out)}`); refresh(); } }}>
            <select className="field" value={ex.from} onChange={(e) => setEx({ ...ex, from: e.target.value })}><option value="">从</option>{full.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select>
            <select className="field" value={ex.to} onChange={(e) => setEx({ ...ex, to: e.target.value })}><option value="">到</option>{full.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select>
            <input className="field" type="number" placeholder="金额" value={ex.amount} onChange={(e) => setEx({ ...ex, amount: e.target.value })} />
            <button className="btn">兑换</button>
          </form>
          {!full.length && <p className="mt-2 text-sm text-muted-foreground">你没有任何可见汇率的货币，无法兑换。</p>}
        </Section>
      )}
      {(canGive || canDeduct) && (
        <Section title="银行操作">
          <div className="grid gap-2 sm:grid-cols-3">
            <input className="field" placeholder="对方用户名" value={g.username} onChange={(e) => setG({ ...g, username: e.target.value })} />
            <select className="field" value={g.currency_id} onChange={(e) => setG({ ...g, currency_id: e.target.value })}><option value="">货币</option>{curs.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select>
            <input className="field" type="number" placeholder="金额" value={g.amount} onChange={(e) => setG({ ...g, amount: e.target.value })} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {canGive && <button className="btn" onClick={async () => { if (await act("give", g, me.role === "bank" ? "已转账" : "已发放")) refresh(); }}>{me.role === "bank" ? "给钱（从银行余额扣）" : "发放（凭空增发）"}</button>}
            {canDeduct && <button className="btn btn-danger" onClick={async () => { const r = await act<{ taken: number }>("deduct", g); if (r) { alert(`已扣款 ${fmtAmount(r.taken)}，并已发消息通知对方`); refresh(); } }}>自动扣款</button>}
          </div>
        </Section>
      )}
    </>
  );
}
