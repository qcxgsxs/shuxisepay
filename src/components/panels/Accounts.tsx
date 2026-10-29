import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useApi } from "@/lib/client";
import { MANAGES, PERM_DEFS, ROLE_LABEL, ROLES, type Role } from "@/lib/roles";
import { Section, useAction } from "@/components/ui-bits";
import type { Me } from "@/routes/app";

type AccRow = { id: string; username: string; password?: string; role: Role; banned: boolean; permissions: Record<string, unknown> };

export function PermEditor({ role, value, onSave }: { role: Role; value: Record<string, unknown>; onSave: (v: Record<string, unknown>) => void }) {
  const [v, setV] = useState<Record<string, unknown>>(value ?? {});
  const defs = PERM_DEFS[role];
  if (!defs.length) return <p className="text-sm text-muted-foreground">该类型无可调权限</p>;
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {defs.map((d) => (
          <label key={d.key} className="flex items-center justify-between gap-2 rounded border-2 border-ink bg-muted px-2 py-1 text-sm">
            <span>{d.label}</span>
            {d.type === "bool" ? (
              <select className="field w-28" value={v[d.key] === undefined ? "" : String(v[d.key])} onChange={(e) => {
                const n = { ...v };
                if (e.target.value === "") delete n[d.key]; else n[d.key] = e.target.value === "true";
                setV(n);
              }}>
                <option value="">默认</option><option value="true">开</option><option value="false">关</option>
              </select>
            ) : (
              <input className="field w-28" type="number" placeholder="默认" value={v[d.key] === undefined ? "" : String(v[d.key])} onChange={(e) => {
                const n = { ...v };
                if (e.target.value === "") delete n[d.key]; else n[d.key] = Number(e.target.value);
                setV(n);
              }} />
            )}
          </label>
        ))}
      </div>
      <button className="btn" onClick={() => onSave(v)}>保存权限</button>
    </div>
  );
}

function VisibilityEditor({ accountId }: { accountId: string }) {
  const api = useApi();
  const act = useAction();
  const qc = useQueryClient();
  const { data: curs = [] } = useQuery<any[]>({ queryKey: ["currencies"], queryFn: () => api("list_currencies") });
  return (
    <div className="max-h-64 space-y-1 overflow-auto">
      {curs.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
          <span>{c.symbol} {c.code} · {c.name}</span>
          <select className="field w-44" value={c.visibility?.[accountId] ?? "none"} onChange={async (e) => {
            await act("set_visibility", { currency_id: c.id, account_id: accountId, level: e.target.value }, "已设置");
            qc.invalidateQueries({ queryKey: ["currencies"] });
          }}>
            <option value="none">货币不可见</option>
            <option value="currency">可见货币，不可见汇率</option>
            <option value="full">可见货币和汇率</option>
          </select>
        </div>
      ))}
    </div>
  );
}

export function AccountsPanel({ me }: { me: Me }) {
  const api = useApi();
  const act = useAction();
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery<AccRow[]>({ queryKey: ["accounts"], queryFn: () => api("list_accounts") });
  const [form, setForm] = useState({ username: "", password: "", role: me.canRegister[0] ?? "normal" });
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["accounts"] });
  const isTop = me.role === "top";

  return (
    <>
      {me.canRegister.length > 0 && (
        <Section title="注册新账号">
          <form className="grid gap-2 sm:grid-cols-4" onSubmit={async (e) => {
            e.preventDefault();
            if (await act("create_account", form, "注册成功")) { setForm({ ...form, username: "", password: "" }); refresh(); }
          }}>
            <input className="field" placeholder="用户名（可中文/符号）" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <input className="field" placeholder={form.role === "top" ? "密码（大于20位）" : "密码（大于6位）"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <select className="field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {me.canRegister.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <button className="btn">注册</button>
          </form>
        </Section>
      )}
      <Section title={`账号列表（${rows.length}）`} right={<input className="field w-40" placeholder="搜索" value={filter} onChange={(e) => setFilter(e.target.value)} />}>
        <div className="space-y-2">
          {rows.filter((r) => !filter || r.username.includes(filter)).map((r) => {
            const canPerm = isTop || MANAGES[me.role] === r.role;
            const canVis = isTop || me.role === "bank_admin" || MANAGES[me.role] === r.role;
            return (
              <div key={r.id} className="rounded-lg border-2 border-ink bg-card p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="break-all">{r.username}</b>
                  <span className="rounded bg-secondary px-2 text-xs">{ROLE_LABEL[r.role]}</span>
                  {r.banned && <span className="rounded bg-destructive px-2 text-xs text-destructive-foreground">已封号</span>}
                  {typeof r.permissions?.acts_as === "string" && <span className="rounded bg-accent px-2 text-xs">权限身份：{ROLE_LABEL[r.permissions.acts_as as Role]}</span>}
                  <button className="ml-auto text-sm underline" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "收起" : "管理"}</button>
                </div>
                {open === r.id && (
                  <div className="mt-3 space-y-3 border-t-2 border-dashed border-ink pt-3">
                    {isTop && (
                      <div className="flex flex-wrap gap-2">
                        <button className="btn btn-ghost" onClick={async () => {
                          const pw = prompt("输入新密码");
                          if (pw && (await act("set_password", { id: r.id, password: pw }, "密码已修改"))) refresh();
                        }}>改密码</button>
                        <button className="btn btn-ghost" onClick={async () => {
                          const x = await act<{ token: string }>("reset_link", { id: r.id });
                          if (x) {
                            const url = `${location.origin}/reset/${x.token}`;
                            navigator.clipboard?.writeText(url);
                            toast.success("重设链接已复制", { description: url });
                          }
                        }}>生成重设链接</button>
                        <button className="btn btn-ghost" onClick={async () => {
                          const x = await act<{ token: string }>("pay_reset_link", { id: r.id });
                          if (x) { const url = `${location.origin}/reset-pay/${x.token}`; navigator.clipboard?.writeText(url); toast.success("支付密码重设链接已复制", { description: url }); }
                        }}>生成支付密码重设链接</button>
                        <button className="btn btn-ghost" onClick={async () => { if (await act("ban", { id: r.id, banned: !r.banned }, r.banned ? "已解封" : "已封号")) refresh(); }}>{r.banned ? "解封" : "封号"}</button>
                        <button className="btn btn-danger" onClick={async () => { if (confirm("确定把该账号资产清零？")) await act("zero_assets", { id: r.id }, "资产已清零"); }}>资产清零</button>
                        <button className="btn btn-danger" onClick={async () => { if (confirm("确定删除？") && (await act("delete_account", { id: r.id }, "已删除"))) refresh(); }}>删除</button>
                      </div>
                    )}
                    {isTop && (
                      <div className="flex flex-wrap items-end gap-2 text-sm">
                        <label>权限身份（可让任何账号拥有其他类型的全部权限）
                          <select className="field" value={(r.permissions?.acts_as as string) ?? ""} onChange={async (e) => {
                            const p = { ...r.permissions }; if (e.target.value) p.acts_as = e.target.value; else delete p.acts_as;
                            if (await act("set_account_perms", { id: r.id, permissions: p }, "已修改")) refresh();
                          }}>
                            <option value="">跟随账号类型（{ROLE_LABEL[r.role]}）</option>
                            {ROLES.map((x) => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}
                          </select>
                        </label>
                        <label>该账号专属色调
                          <input className="field w-24" type="number" min={0} max={360} placeholder="默认" defaultValue={(r.permissions?.theme as any)?.hue ?? ""} onBlur={async (e) => {
                            const p = { ...r.permissions }; const th = { ...((p.theme as object) ?? {}) } as any;
                            if (e.target.value === "") delete th.hue; else th.hue = Number(e.target.value);
                            p.theme = th; await act("set_account_perms", { id: r.id, permissions: p }, "已保存"); refresh();
                          }} />
                        </label>
                        <label>菜单位置
                          <select className="field" value={(r.permissions?.theme as any)?.nav ?? ""} onChange={async (e) => {
                            const p = { ...r.permissions }; const th = { ...((p.theme as object) ?? {}) } as any;
                            if (e.target.value) th.nav = e.target.value; else delete th.nav;
                            p.theme = th; if (await act("set_account_perms", { id: r.id, permissions: p }, "已保存")) refresh();
                          }}><option value="">默认</option><option value="top">顶部</option><option value="side">侧边</option></select>
                        </label>
                      </div>
                    )}
                    {canPerm && (
                      <div>
                        <h3 className="mb-1">账号权限</h3>
                        <PermEditor role={(r.permissions?.acts_as as Role) ?? r.role} value={r.permissions} onSave={async (v) => { if (await act("set_account_perms", { id: r.id, permissions: v }, "权限已保存")) refresh(); }} />
                      </div>
                    )}
                    {canVis && r.role !== "normal" && r.role !== "top" && r.role !== "bank_admin" && (
                      <div>
                        <h3 className="mb-1">货币与汇率可见性</h3>
                        <VisibilityEditor accountId={r.id} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}

export function RolePermsPanel() {
  const api = useApi();
  const act = useAction();
  const qc = useQueryClient();
  const { data: s } = useQuery<any>({ queryKey: ["settings"], queryFn: () => api("get_settings") });
  if (!s) return null;
  const rp = s.role_perms ?? {};
  return (
    <>
      {ROLES.filter((r) => r !== "top").map((r) => (
        <Section key={r} title={`${ROLE_LABEL[r]} · 默认权限`}>
          <PermEditor role={r} value={rp[r] ?? {}} onSave={async (v) => {
            await act("set_setting", { key: "role_perms", value: { ...rp, [r]: v } }, "已保存");
            qc.invalidateQueries({ queryKey: ["settings"] });
          }} />
        </Section>
      ))}
    </>
  );
}
