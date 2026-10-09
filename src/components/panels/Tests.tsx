import { useState } from "react";
import { Section, useAction } from "@/components/ui-bits";

type R = { name: string; pass: boolean; detail?: string };

export function TestsPanel() {
  const act = useAction();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ results: R[]; passed: number; total: number } | null>(null);
  const [demo, setDemo] = useState<{ accounts: string[]; password: string; topPassword: string } | null>(null);
  return (
    <>
      <Section title="端到端测试">
        <p className="mb-2 text-sm">自动创建临时的九种账号，检查登录、注册限制、权限边界、商店和支付，结束后自动删除。可以反复运行。</p>
        <button className="btn" disabled={busy} onClick={async () => { setBusy(true); setRes((await act<any>("run_e2e")) ?? null); setBusy(false); }}>{busy ? "测试中…（约半分钟）" : "运行全部测试"}</button>
        {res && (
          <div className="mt-3">
            <p className={`font-display text-xl ${res.passed === res.total ? "" : "text-destructive"}`}>通过 {res.passed} / {res.total}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {res.results.map((r, i) => (
                <li key={i} className="flex gap-2 border-b border-dashed py-1">
                  <span className={r.pass ? "font-bold" : "font-bold text-destructive"}>{r.pass ? "✓ 通过" : "✗ 失败"}</span>
                  <span>{r.name}</span>
                  {!r.pass && r.detail && <span className="text-muted-foreground">（{r.detail}）</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>
      <Section title="演示数据（仅测试环境）">
        <p className="mb-2 text-sm">一键创建九种演示账号、演示支付方式和商品，并给演示普通账号发钱。只能在预览中使用，正式发布的网站会拒绝。</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={async () => setDemo((await act<any>("seed_demo", {}, "演示数据已就绪")) ?? null)}>生成演示数据</button>
          <button className="btn btn-danger" onClick={async () => { if (confirm("删除所有「演示-」开头的账号和支付方式？")) { await act("remove_demo", {}, "已删除演示数据"); setDemo(null); } }}>删除演示数据</button>
        </div>
        {demo && (
          <div className="mt-3 text-sm">
            <p>账号：{demo.accounts.join("、")}</p>
            <p>密码：<code>{demo.password}</code>（演示-顶级：<code>{demo.topPassword}</code>）</p>
          </div>
        )}
      </Section>
    </>
  );
}
