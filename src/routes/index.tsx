import { createFileRoute, Link } from "@tanstack/react-router";
import { ROLES, ROLE_LABEL } from "@/lib/roles";
import { AppIcon, Themed, useConfig, useText } from "@/components/Shell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "七彩星光支付 · 选择登录窗口" },
      { name: "description", content: "大富翁式虚拟支付游戏，九种账号九个登录窗口。" },
      { property: "og:title", content: "七彩星光支付" },
      { property: "og:description", content: "大富翁式虚拟支付游戏，九种账号九个登录窗口。" },
    ],
  }),
  component: Index,
});

const TILE = ["bg-tile-1", "bg-tile-2", "bg-tile-3", "bg-tile-4", "bg-tile-5", "bg-tile-6", "bg-tile-7", "bg-tile-8", "bg-tile-9"];

function Index() {
  const { data } = useConfig();
  const list = data?.theme?.layout === "list";
  const t = useText();
  const signupRoles = data?.signup?.roles ?? ["normal"];
  return (
    <Themed menu="home">
      <main className="mx-auto max-w-4xl px-4 py-8">
        <header className="mb-8 flex items-center gap-4">
          <AppIcon size={64} />
          <div>
            <h1 className="text-4xl sm:text-5xl rainbow-text drop-shadow-sm">{t("app_name", "七彩星光支付")}</h1>
            <p className="text-sm text-muted-foreground">{t("app_sub", "QCXG PAY · 仅虚拟财产互动")}</p>
          </div>
        </header>
        <div className={list ? "flex flex-col gap-3" : "grid grid-cols-3 gap-3"}>
          {ROLES.map((r, i) => (
            <Link
              key={r}
              to="/login/$role"
              params={{ role: r }}
              className="card-hard group flex flex-col overflow-hidden transition-transform hover:-translate-y-1"
            >
              <div className={`${TILE[i]} h-6 border-b-2 border-ink sm:h-8`} />
              <div className={`flex flex-1 ${list ? "flex-row items-center justify-between" : "flex-col"} p-3`}>
                <span className="font-display text-xs text-muted-foreground">第 {i + 1} 格</span>
                <span className="font-display text-base sm:text-xl">{t(`role_${r}`, ROLE_LABEL[r])}</span>
                <span className="mt-auto pt-2 text-xs text-muted-foreground">{signupRoles.includes(r) ? t("tile_signup", "登录 / 注册 →") : t("tile_login", "登录 →")}</span>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </Themed>
  );
}
