import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Themed } from "@/components/Shell";
import { getToken, useApi } from "@/lib/client";
import type { Me } from "./app";

export const Route = createFileRoute("/receive/$id")({
  ssr: false,
  head: () => ({ meta: [
    { title: "扫码付款 · 七彩星光支付" }, { name: "description", content: "向七彩星光支付账号付款，仅用于虚拟财产互动。" },
    { property: "og:title", content: "扫码付款 · 七彩星光支付" }, { property: "og:description", content: "七彩星光支付账号收款码。" },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: ReceiptPage,
});

function ReceiptPage() {
  const { id } = Route.useParams();
  const api = useApi();
  const token = getToken();
  const { data: me } = useQuery<Me>({ queryKey: ["me", token], queryFn: () => api("me"), enabled: !!token, retry: false });
  const { data: target, error } = useQuery<any>({ queryKey: ["receipt-target", id, token], queryFn: () => api("receipt_target", { id }), enabled: !!me, retry: false });
  const [currency, setCurrency] = useState("");
  const [method, setMethod] = useState("");
  const [amount, setAmount] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [transaction, setTransaction] = useState("");
  const methods = (target?.methods ?? []).filter((m: any) => m.currency_ids.includes(currency));
  return <Themed menu="receipts"><main className="mx-auto max-w-lg space-y-5 px-4 py-8">
    <h1 className="font-display text-2xl">扫码付款</h1>
    {!token && <><p>请先登录付款账号</p><Button asChild><Link to="/">选择登录窗口</Link></Button></>}
    {token && !me && <p>登录验证中；如登录已失效，请重新登录。</p>}
    {error && <p role="alert" className="text-destructive">{error.message}</p>}
    {target && !transaction && <>
      <p className="break-all text-lg">收款账号：<b>{target.username}</b></p>
      <p className="break-all text-sm">付款账号：{me?.username}</p>
      {me?.id === id ? <p>这是你自己的收款码</p> : <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault(); if (busy) return; setBusy(true); setFailure("");
        try { const r = await api<{ transaction_id: string }>("receipt_pay", { to_id: id, currency_id: currency, payment_method_id: method, amount, pay_pin: pin }); setTransaction(r.transaction_id); setPin(""); }
        catch (e) { setFailure(e instanceof Error ? e.message : "付款失败"); } finally { setBusy(false); }
      }}>
        <label className="block">付款货币<select className="field" value={currency} required onChange={(e) => { setCurrency(e.target.value); setMethod(""); }}><option value="">选择货币</option>{target.currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code} {c.symbol}</option>)}</select></label>
        <label className="block">金额<input className="field" type="number" min="0.000000001" step="any" required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="block">支付方式<select className="field" value={method} required onChange={(e) => setMethod(e.target.value)}><option value="">选择支付方式</option>{methods.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        {me?.hasPayPin && <label className="block">支付密码<input className="field" type="password" autoComplete="off" value={pin} required onChange={(e) => setPin(e.target.value)} /></label>}
        {failure && <p role="alert" className="text-destructive">{failure}</p>}
        <Button className="w-full" disabled={busy || !method} type="submit"><Send />{busy ? "付款中…" : "确认付款"}</Button>
      </form>}
    </>}
    {transaction && <div className="space-y-3"><CheckCircle className="text-primary" /><h2 className="text-xl">付款成功</h2><p className="break-all">已到账 {target?.username}</p><p className="break-all text-xs text-muted-foreground">交易编号：{transaction}</p></div>}
    <Button variant="outline" asChild><Link to="/app">返回我的账号</Link></Button>
  </main></Themed>;
}