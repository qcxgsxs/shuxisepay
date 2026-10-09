import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/roles";
import { addSession, useApi } from "@/lib/client";
import { AppIcon, Themed, useConfig, useText } from "@/components/Shell";

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
  const t = useText();
  const { data: cfg } = useConfig();
  const canSignup = (cfg?.signup?.roles ?? ["normal"]).includes(role);
  const label = valid ? t(`role_${role}`, ROLE_LABEL[role as Role]) : "未知窗口";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ token: string }>(mode === "login" ? "login" : "signup", { role, username, password });
      addSession({ token: r.token, username: username.trim(), role });
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
        <Link to="/" className="mb-4 text-sm underline">{t("back_board", "← 返回棋盘")}</Link>
        <form onSubmit={submit} className="card-hard space-y-4 p-6">
          <div className="flex items-center gap-3">
            <AppIcon size={44} />
            <div>
              <h1 className="text-2xl">{label}</h1>
              <p className="text-xs text-muted-foreground">{mode === "login" ? t("login_title", "登录") : t("signup_title", "注册账号")}</p>
            </div>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-bold">{t("username", "用户名")}</span>
            <input className="field" value={username} onChange={(e) => setU(e.target.value)} maxLength={40} required />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-bold">{t("password", "密码")}</span>
            <input className="field" type="password" value={password} onChange={(e) => setP(e.target.value)} required />
            {mode === "signup" && <span className="text-xs text-muted-foreground">密码必须大于6位；忘记密码只能找顶级账号。</span>}
          </label>
          <button className="btn w-full" disabled={busy || !valid}>{busy ? "请稍候…" : mode === "login" ? t("login_btn", "登录") : t("signup_btn", "注册并登录")}</button>
          {canSignup && (
            <button type="button" className="w-full text-sm underline" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
              {mode === "login" ? t("signup_link", "没有账号？点击注册") : t("login_link", "已有账号？去登录")}
            </button>
          )}
        </form>
      </main>
    </Themed>
  );
}
