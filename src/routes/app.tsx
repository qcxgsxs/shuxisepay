import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getToken, listSessions, removeSession, switchSession, useApi } from "@/lib/client";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { AppIcon, Themed, useConfig, useText, type Theme } from "@/components/Shell";
import { AccountsPanel, RolePermsPanel } from "@/components/panels/Accounts";
import { CurrencyPanel } from "@/components/panels/Currency";
import { WalletPanel } from "@/components/panels/Wallet";
import { PayMethodsPanel, SellerPanel, ShopPanel } from "@/components/panels/Commerce";
import { AppearancePanel, ChatPanel, EtcPanel, LogsPanel, MapPanel, MENU_KEYS } from "@/components/panels/Misc";
import { TestsPanel } from "@/components/panels/Tests";
import { BackgroundEtc, CardPanel, DebtPrompt, DevicesPanel, EtcAdminPanel, ScreenPanel } from "@/components/panels/Extra";

export type Me = { id: string; username: string; role: Role; realRole: Role; perms: Record<string, any>; canRegister: Role[]; theme: Theme | null; hasPayPin?: boolean; etcEnabled?: boolean; impersonated?: boolean };

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
  if (r === "top" || r === "etc_admin") m.push("etcadm");
  if (r === "top" || r === "screen_admin") m.push("screen");
  if (r === "top" || r === "card_admin") m.push("cards");
  if (r === "top") m.push("perms", "look", "tests");
  m.push("devices");
  return m;
}

function AppPage() {
  const api = useApi();
  const nav = useNavigate();
  const qc = useQueryClient();
  const t = useText();
  const { data: cfg } = useConfig();
  const [active, setActive] = useState(getToken());
  const { data: me, error } = useQuery<Me>({ queryKey: ["me", active], queryFn: () => api("me"), retry: false, enabled: !!active });
  const [menu, setMenu] = useState("");
  const sessions = listSessions();
  useEffect(() => { if (!active) nav({ to: "/" }); }, [active, nav]);
  useEffect(() => {
    if (error) { const next = removeSession(active); setActive(next?.token); qc.clear(); }
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (me && (!menu || !menusFor(me).includes(menu))) setMenu(menusFor(me)[0]); }, [me, menu]);
  if (!me) return <Themed menu="home"><p className="p-8">加载中…</p></Themed>;
  const menus = menusFor(me);
  const side = (me.theme?.nav ?? cfg?.theme?.nav) === "side";
  const switchTo = (tok: string) => { switchSession(tok); qc.clear(); setMenu(""); setActive(tok); };
  const logout = async () => { try { await api("logout"); } catch { /* */ } const next = removeSession(active); qc.clear(); setMenu(""); setActive(next?.token); };
  const label = (k: string) => t(`menu_${k}`, MENU_KEYS[k]);

  return (
    <Themed menu={menu} override={me.theme}>
      <DebtPrompt key={`debt-${active}`} />
      <header className="sticky top-0 z-[500] border-b-2 border-ink" style={{ background: "var(--panel-bg)" }}>
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2">
          <Link to="/"><AppIcon size={36} /></Link>
          <div className="min-w-0 flex-1">
            <div className="font-display rainbow-text">{t("app_name", "七彩星光支付")}</div>
            <select className="field max-w-full py-0 text-xs" aria-label="切换分身" value={active} onChange={(e) => switchTo(e.target.value)}>
              {sessions.map((s) => <option key={s.token} value={s.token}>{t(`role_${s.role}`, ROLE_LABEL[s.role as Role] ?? s.role)} · {s.username}</option>)}
            </select>
          </div>
          <Link to="/" className="btn btn-ghost shrink-0" title="再登录一个账号">+分身</Link>
          <button className="btn btn-ghost shrink-0" onClick={logout}>退出</button>
        </div>
        <BackgroundEtc />
        {me.impersonated && <p className="bg-destructive px-3 py-1 text-center text-xs text-destructive-foreground">投屏中：你正在以「{me.username}」的身份操作</p>}
        {me.role !== me.realRole && <p className="px-3 pb-1 text-center text-xs">当前拥有「{ROLE_LABEL[me.role]}」的权限（由顶级账号设置）</p>}
        {!side && (
          <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 pb-2">
            {menus.map((k) => <button key={k} onClick={() => setMenu(k)} className={`btn shrink-0 ${menu === k ? "" : "btn-ghost"}`}>{label(k)}</button>)}
          </nav>
        )}
      </header>
      <div className={`mx-auto max-w-6xl px-3 py-4 ${side ? "grid gap-4 sm:grid-cols-[160px_1fr]" : ""}`}>
        {side && (
          <nav className="flex gap-1 overflow-x-auto sm:flex-col">
            {menus.map((k) => <button key={k} onClick={() => setMenu(k)} className={`btn shrink-0 ${menu === k ? "" : "btn-ghost"}`}>{label(k)}</button>)}
          </nav>
        )}
        <main key={active}>
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
          {menu === "tests" && <TestsPanel />}
          {menu === "etcadm" && <EtcAdminPanel me={me} />}
          {menu === "cards" && <CardPanel />}
          {menu === "screen" && <ScreenPanel onOpened={(tok) => switchTo(tok)} />}
          {menu === "devices" && <DevicesPanel me={me} onChanged={(next) => { qc.clear(); setMenu(""); setActive(next); }} />}
        </main>
      </div>
    </Themed>
  );
}
