import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/roles";
import { setToken, useApi } from "@/lib/client";
import { AppIcon, Themed } from "@/components/Shell";

export const Route = createFileRoute("/login/$role")({
  head: ({ params }) => {
    const label = ROLE_LABEL[params.role as Role] ?? "登录";
    return {
      meta: [
        { title: `${label}登录 · 七彩星光支付` },
        { name: "description", content: `七彩星光支付 ${label} 专属登录窗口。` },
        { property: "og:title", content: `${label}登录 · 七彩星光支付` },
        { property: "og:description", content: `七彩星光支付 ${label} 专属登录窗口。` },
      ],
    };
  },
  component: Login,
});

function Login() {
  const { role } = Route.useParams();
  const api = useApi();
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = (ROLES as readonly string[]).includes(role);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ token: string }>(mode === "login" ? "login" : "signup_normal", { role, username, password });
      setToken(r.token);
      nav({ to: "/app" });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Themed menu={`login_${role}`}>
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
        <Link to="/" className="mb-4 text-sm underline">← 返回棋盘</Link>
        <form onSubmit={submit} className="card-hard space-y-4 p-6">
          <div className="flex items-center gap-3">
            <AppIcon size={44} />
            <div>
              <h1 className="text-2xl">{valid ? ROLE_LABEL[role as Role] : "未知窗口"}</h1>
              <p className="text-xs text-muted-foreground">{mode === "login" ? "登录" : "注册普通账号"}</p>
            </div>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-bold">用户名</span>
            <input className="field" value={username} onChange={(e) => setU(e.target.value)} maxLength={40} required />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-bold">密码</span>
            <input className="field" type="password" value={password} onChange={(e) => setP(e.target.value)} required />
            {mode === "signup" && <span className="text-xs text-muted-foreground">密码必须大于6位；忘记密码只能找顶级账号。</span>}
          </label>
          <button className="btn w-full" disabled={busy || !valid}>{busy ? "请稍候…" : mode === "login" ? "登录" : "注册并登录"}</button>
          {role === "normal" && (
            <button type="button" className="w-full text-sm underline" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
              {mode === "login" ? "没有账号？点击注册" : "已有账号？去登录"}
            </button>
          )}
        </form>
      </main>
    </Themed>
  );
}
