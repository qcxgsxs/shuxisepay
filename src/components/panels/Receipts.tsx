import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Camera, Copy, Download, ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui-bits";
import { useApi } from "@/lib/client";
import { receiptAccount } from "@/lib/receipt";
import { fmtAmount } from "@/lib/expr";
import type { Me } from "@/routes/app";

export function ReceiptsPanel({ me }: { me: Me }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [kind, setKind] = useState("");
  const [qr, setQr] = useState("");
  const [url, setUrl] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const { data: rows = [], isPending, error: historyError } = useQuery<any[]>({ queryKey: ["notifications", me.id, kind], queryFn: () => api("my_notifications", { kind }), refetchInterval: 15000 });
  useEffect(() => {
    let cancelled = false;
    const link = `https://shuxisepay.lovable.app/receive/${me.id}`;
    setUrl(link);
    import("qrcode").then((m) => m.default.toDataURL(link, { width: 280, margin: 3, errorCorrectionLevel: "M" })).then((data) => { if (!cancelled) setQr(data); }).catch(() => setError("收款码生成失败"));
    return () => { cancelled = true; };
  }, [me.id]);
  const open = (value: string) => {
    try { const id = receiptAccount(value.trim()); setScanning(false); navigate({ to: "/receive/$id", params: { id } }); }
    catch (e) { setError(e instanceof Error ? e.message : "无法识别收款码"); }
  };
  useEffect(() => {
    if (!scanning) return;
    let dead = false;
    let controls: { stop: () => void } | undefined;
    import("@zxing/browser").then(async ({ BrowserQRCodeReader }) => {
      if (dead || !video.current) return;
      controls = await new BrowserQRCodeReader().decodeFromVideoDevice(undefined, video.current, (result) => { if (result && !dead) open(result.getText()); });
      if (dead) controls.stop();
    }).catch(() => { if (!dead) { setError("无法打开摄像头，请允许摄像头权限或粘贴收款链接"); setScanning(false); } });
    return () => { dead = true; controls?.stop(); };
  }, [scanning]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>
    <Section title="账号收款码">
      <div className="flex flex-wrap items-start gap-4">
        <div className="space-y-2 text-center">
          <p className="break-all font-bold">{me.username}</p>
          {qr && <img src={qr} alt={`${me.username}的收款码`} className="h-[240px] w-[240px] max-w-full" />}
          <div className="flex justify-center gap-2">
            <Button variant="outline" title="复制收款链接" onClick={async () => { try { await navigator.clipboard.writeText(url); } catch { setError("复制失败，请手动复制收款链接"); } }}><Copy />复制链接</Button>
            <Button variant="outline" asChild disabled={!qr}><a href={qr || undefined} download="七彩星光收款码.png"><Download />保存</a></Button>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <Button onClick={() => { setError(""); setScanning(true); }}><Camera />扫一扫付款</Button>
          {scanning && <div><video ref={video} className="aspect-square w-full max-w-sm rounded border" muted playsInline /><Button variant="ghost" onClick={() => setScanning(false)}><X />关闭摄像头</Button></div>}
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); open(input); }}>
            <input aria-label="收款链接" className="field min-w-0 flex-1" placeholder="粘贴收款链接" value={input} onChange={(e) => setInput(e.target.value)} />
            <Button type="submit" variant="outline"><ScanLine />打开</Button>
          </form>
          <input className="field text-xs" aria-label="我的收款链接" readOnly value={url} />
          {error && <p role="alert" className="text-destructive">{error}</p>}
        </div>
      </div>
    </Section>
    <Section title="通知记录">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select aria-label="通知类型" className="field w-auto" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">全部</option><option value="receipt">收款到账</option><option value="etc">ETC扣款</option><option value="payment">扫码付款</option></select>
        <Button variant="outline" onClick={async () => { try { await api("read_notifications"); await qc.invalidateQueries({ queryKey: ["notifications"] }); } catch { setError("标记已读失败"); } }}><Bell />全部已读</Button>
      </div>
      {isPending && <p>加载中…</p>}
      {historyError && <p role="alert" className="text-destructive">通知记录加载失败</p>}
      {!isPending && !rows.length && <p className="text-muted-foreground">暂无通知记录</p>}
      <div className="divide-y divide-border">{rows.map((r) => <article key={r.id} className="py-3">
        <div className="flex flex-wrap justify-between gap-2"><b>{!r.read_at && <span aria-label="未读">● </span>}{r.title}</b><span className={r.kind === "receipt" ? "text-primary" : "text-foreground"}>{r.kind === "receipt" ? "+" : "−"}{fmtAmount(r.amount)} {r.currency_code}</span></div>
        <p className="break-words text-sm">{r.detail}</p><time className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</time>
      </article>)}</div>
    </Section>
  </>;
}