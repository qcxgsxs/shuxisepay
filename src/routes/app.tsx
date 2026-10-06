import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getToken, setToken, useApi } from "@/lib/client";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { AppIcon, Themed, useConfig } from "@/components/Shell";
import { AccountsPanel, RolePermsPanel } from "@/components/panels/Accounts";
import { CurrencyPanel } from "@/components/panels/Currency";
import { WalletPanel } from "@/components/panels/Wallet";
import { PayMethodsPanel, SellerPanel, ShopPanel } from "@/components/panels/Commerce";
import { AppearancePanel, ChatPanel, EtcPanel, LogsPanel, MapPanel, MENU_KEYS } from "@/components/panels/Misc";

export type Me = { id: string; username: string; role: Role; perms: Record<string, any>; canRegister: Role[] };

export const Route = createFileRoute("/app")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "我的账户 · 七彩星光支付" },
      { name: "description", content: "七彩星光支付账户中心。" },
      { property: "og:title", content: "我的账户 · 七彩星光支付" },
      { property: "og:description", content: "七彩星光支付账户中心。" },
    ],
  }),
  component: AppPage,
});

function menusFor(me: Me): string[] {
  const r = me.role;
  const m: string[] = [];
  if (r !== "normal") m.push("wallet");
  if (r === "normal" || r === "top") m.push("shop");
  if (r === "seller" || r === "top") m.push("seller");
  m.push("map", "etc", "chat");
  if (me.canRegister.length || r === "engineer_admin" || r === "seller_admin") m.push("accounts");
  if (r === "top" || r === "bank_admin") m.push("currency");
  if (r === "top" || r === "bank_admin" || r === "pay_admin") m.push("pay");
  if (["top", "bank_admin", "engineer_admin", "seller_admin", "pay_admin"].includes(r)) m.push("logs");
  if (r === "top") m.push("perms", "look");
  return m;
}

function AppPage() {
  const api = useApi();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: cfg } = useConfig();
  const { data: me, error } = useQuery<Me>({ queryKey: ["me"], queryFn: () => api("me"), retry: false, enabled: !!getToken() });
  const [menu, setMenu] = useState("");
  useEffect(() => { if (!getToken() || error) nav({ to: "/" }); }, [error, nav]);
  useEffect(() => { if (me && !menu) setMenu(menusFor(me)[0]); }, [me, menu]);
  if (!me) return <Themed menu="home"><p className="p-8">加载中…</p></Themed>;
  const menus = menusFor(me);
  const side = cfg?.theme?.nav === "side";
  const logout = async () => { try { await api("logout"); } catch { /* */ } setToken(null); qc.clear(); nav({ to: "/", replace: true }); };

  return (
    <Themed menu={menu}>
      <header className="sticky top-0 z-[500] border-b-2 border-ink bg-card">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-2">
          <Link to="/"><AppIcon size={36} /></Link>
          <div className="min-w-0">
            <div className="font-display rainbow-text">七彩星光支付</div>
            <div className="truncate text-xs">{ROLE_LABEL[me.role]} · {me.username}</div>
          </div>
          <button className="btn btn-ghost ml-auto" onClick={logout}>退出</button>
        </div>
        {!side && (
          <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 pb-2">
            {menus.map((k) => <button key={k} onClick={() => setMenu(k)} className={`btn shrink-0 ${menu === k ? "" : "btn-ghost"}`}>{MENU_KEYS[k]}</button>)}
          </nav>
        )}
      </header>
      <div className={`mx-auto max-w-6xl px-3 py-4 ${side ? "grid gap-4 sm:grid-cols-[160px_1fr]" : ""}`}>
        {side && (
          <nav className="flex gap-1 overflow-x-auto sm:flex-col">
            {menus.map((k) => <button key={k} onClick={() => setMenu(k)} className={`btn shrink-0 ${menu === k ? "" : "btn-ghost"}`}>{MENU_KEYS[k]}</button>)}
          </nav>
        )}
        <main>
          {menu === "wallet" && <WalletPanel me={me} />}
          {menu === "shop" && <ShopPanel />}
          {menu === "seller" && <SellerPanel />}
          {menu === "map" && <MapPanel me={me} />}
          {menu === "etc" && <EtcPanel />}
          {menu === "chat" && <ChatPanel me={me} />}
          {menu === "accounts" && <AccountsPanel me={me} />}
          {menu === "currency" && <CurrencyPanel />}
          {menu === "pay" && <PayMethodsPanel me={me} />}
          {menu === "logs" && <LogsPanel me={me} />}
          {menu === "perms" && <RolePermsPanel />}
          {menu === "look" && <AppearancePanel />}
        </main>
      </div>
    </Themed>
  );
}
