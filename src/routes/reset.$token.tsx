import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useApi } from "@/lib/client";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { Themed } from "@/components/Shell";

export const Route = createFileRoute("/reset/$token")({
  head: () => ({
    meta: [
      { title: "重设密码 · 七彩星光支付" },
      { name: "description", content: "使用顶级账号提供的链接重设密码。" },
      { property: "og:title", content: "重设密码 · 七彩星光支付" },
      { property: "og:description", content: "使用顶级账号提供的链接重设密码。" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Reset,
});

function Reset() {
  const { token } = Route.useParams();
  const api = useApi();
  const [info, setInfo] = useState<{ username: string; role: Role } | null>(null);
  const [err, setErr] = useState("");
  const [pw, setPw] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => { api("reset_info", { token }).then(setInfo).catch((e) => setErr(e.message)); }, [api, token]);
  return (
    <Themed menu="reset">
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
        <div className="card-hard space-y-4 p-6">
          <h1 className="text-2xl">重设密码</h1>
          {err && <p className="text-destructive">{err}</p>}
          {done ? (
            <p>密码已修改。<Link to="/" className="underline">去登录</Link></p>
          ) : info && (
            <form className="space-y-3" onSubmit={async (e) => {
              e.preventDefault();
              try { await api("reset_do", { token, password: pw }); setDone(true); } catch (x) { toast.error((x as Error).message); }
            }}>
              <p>{ROLE_LABEL[info.role]}：<b>{info.username}</b></p>
              <input className="field" type="password" placeholder="新密码" value={pw} onChange={(e) => setPw(e.target.value)} />
              <button className="btn w-full">确认修改</button>
            </form>
          )}
        </div>
      </main>
    </Themed>
  );
}
