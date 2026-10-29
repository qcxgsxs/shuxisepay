import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { CAN_REGISTER, DEFAULT_PERMS, MANAGES, ROLES, USERNAME_RE, FACILITY_KINDS, type Role } from "./roles";
import { evalRateLog10, LOG_CAP, type OperatorDef } from "./expr";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;
type Acc = { [k: string]: any; id: string; username: string; password: string; password_hash?: string | null; real_role?: Role; role: Role; banned: boolean; permissions: Record<string, unknown> };
type Cur = { rate_sign?: number; id: string; code: string; name: string; symbol: string; rate_expr: string; rate_log10: number; visibility: Record<string, string> };

const fail = (m: string): never => { throw new Error(m); };
const rnd = (n = 32) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

async function q<T = any>(p: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) fail(error.message);
  return data;
}
async function getSetting<T = any>(key: string, def: T): Promise<T> {
  const r = await q(db.from("settings").select("value").eq("key", key).maybeSingle());
  return (r?.value ?? def) as T;
}
async function setSetting(key: string, value: unknown) {
  await q(db.from("settings").upsert({ key, value }));
}
async function log(a: Partial<Acc> | null, action: string, detail: Record<string, unknown> = {}) {
  await db.from("logs").insert({ account_id: a?.id ?? null, username: a?.username ?? null, role: a?.role ?? null, action, detail });
}
async function perms(a: Acc) {
  const rp = await getSetting<Record<string, Record<string, unknown>>>("role_perms", {});
  return { ...DEFAULT_PERMS[a.role], ...(rp[a.role] ?? {}), ...(a.permissions ?? {}) } as Record<string, any>;
}
async function need(a: Acc, key: string) {
  if (a.role === "top") return;
  const p = await perms(a);
  if (!p[key]) fail("没有该权限");
}
const allCur = async (): Promise<Cur[]> => q(db.from("currencies").select("*").order("created_at"));
function visLevel(a: Acc, c: Cur): "full" | "currency" | "none" {
  if (a.role === "top" || a.role === "bank_admin") return "full";
  if (a.role === "normal") return "none";
  return (c.visibility?.[a.id] as any) ?? "none";
}
async function feePct(a: Acc) {
  const f = await getSetting<any>("fees", { bank: 5, normal: 30, other: 15 });
  return a.role === "bank" ? f.bank : a.role === "normal" ? f.normal : (f[a.role] ?? f.other);
}

// ---------- passwords (PBKDF2, never stored in plain text) ----------
const enc = new TextEncoder();
const b64 = (u: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(u as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function derive(pw: string, salt: Uint8Array, iter: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt as BufferSource, iterations: iter, hash: "SHA-256" }, key, 256));
}
export async function hashPw(pw: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$100000$${b64(salt)}$${b64(await derive(pw, salt, 100000))}`;
}
async function checkHash(hash: string, pw: string): Promise<boolean> {
  const [, it, salt, h] = hash.split("$");
  const got = await derive(String(pw), unb64(salt), Number(it));
  const exp = unb64(h);
  if (got.length !== exp.length) return false;
  let d = 0; for (let i = 0; i < got.length; i++) d |= got[i] ^ exp[i];
  return d === 0;
}
async function verifyPw(a: Acc, pw: string): Promise<boolean> {
  if (a.password_hash) {
    const [, it, salt, h] = a.password_hash.split("$");
    const got = await derive(String(pw), unb64(salt), Number(it));
    const exp = unb64(h);
    if (got.length !== exp.length) return false;
    let d = 0; for (let i = 0; i < got.length; i++) d |= got[i] ^ exp[i];
    return d === 0;
  }
  if (a.password && a.password === pw) { // legacy plain text: migrate now
    await db.from("accounts").update({ password: "", password_hash: await hashPw(pw) }).eq("id", a.id);
    return true;
  }
  return false;
}
const pwOk = (role: Role, pw: string) => (role === "top" ? pw.length > 20 : pw.length > 6);
function effective(a: Acc): Acc {
  const as = a.permissions?.acts_as as Role | undefined;
  return { ...a, real_role: a.role, role: as && ROLES.includes(as) ? as : a.role };
}

// ---------- money ----------
async function balances(id: string): Promise<{ currency_id: string; amount: number }[]> {
  return q(db.from("balances").select("currency_id,amount").eq("account_id", id));
}
async function addBal(id: string, cur: string, delta: number) {
  const r = await q(db.from("balances").select("amount").eq("account_id", id).eq("currency_id", cur).maybeSingle());
  let v = (r?.amount ?? 0) + delta;
  if (!isFinite(v)) v = v > 0 ? Number.MAX_VALUE : 0;
  await q(db.from("balances").upsert({ account_id: id, currency_id: cur, amount: v }));
}
const conv = (amt: number, fromL: number, toL: number) => {
  const v = amt * Math.pow(10, fromL - toL);
  return isFinite(v) ? v : Number.MAX_VALUE;
};
/** Take `amount` of currency `curId` from account, converting other currencies with fee%. Returns false if insufficient (unless partial). */
async function takeMoney(accId: string, curId: string, amount: number, fee: number, partial = false): Promise<number> {
  const curs = await allCur();
  const byId = new Map(curs.map((c) => [c.id, c]));
  const target = byId.get(curId) ?? fail("货币不存在");
  const bals = (await balances(accId)).filter((b) => b.amount > 0 && byId.has(b.currency_id) && (byId.get(b.currency_id)!.rate_sign ?? 1) > 0);
  const plan: { cur: string; take: number }[] = [];
  let remain = amount;
  const same = bals.find((b) => b.currency_id === curId);
  if (same) { const t = Math.min(same.amount, remain); plan.push({ cur: curId, take: t }); remain -= t; }
  const mult = 1 + fee / 100;
  for (const b of bals.sort((x, y) => byId.get(y.currency_id)!.rate_log10 - byId.get(x.currency_id)!.rate_log10)) {
    if (remain <= 1e-12) break;
    if (b.currency_id === curId) continue;
    const c = byId.get(b.currency_id)!;
    const worth = conv(b.amount, c.rate_log10, target.rate_log10) / mult; // in target currency after fee
    const use = Math.min(worth, remain);
    const takeSrc = Math.min(b.amount, conv(use * mult, target.rate_log10, c.rate_log10));
    plan.push({ cur: b.currency_id, take: takeSrc });
    remain -= use;
  }
  if (remain > 1e-9 * Math.max(1, amount) && !partial) return 0;
  for (const p of plan) await addBal(accId, p.cur, -p.take);
  return amount - Math.max(0, remain);
}

// ---------- auth ----------
async function byToken(token?: string): Promise<Acc> {
  if (!token) fail("请先登录");
  const s = await q(db.from("sessions").select("id,account_id,last_seen,impersonated_by").eq("token", token).maybeSingle());
  if (!s) fail("登录已失效，请重新登录");
  if (Date.now() - new Date(s.last_seen).getTime() > 60000) await db.from("sessions").update({ last_seen: new Date().toISOString() }).eq("token", token);
  const a: Acc = await q(db.from("accounts").select("*").eq("id", s.account_id).maybeSingle());
  if (!a) fail("账号不存在");
  if (a.banned) fail("账号已被封禁");
  return { ...effective(a), session_id: s.id, impersonated_by: s.impersonated_by };
}
async function findUser(username: string): Promise<Acc> {
  const a = await q(db.from("accounts").select("*").eq("username", username).maybeSingle());
  return a ?? fail(`找不到账号：${username}`);
}
async function createAccount(creator: Acc | null, username: string, password: string, role: Role) {
  username = String(username ?? "").trim();
  if (!USERNAME_RE.test(username)) fail("用户名包含不支持的字符或过长");
  if (!ROLES.includes(role)) fail("账号类型无效");
  if (role === "top" ? password.length <= 20 : password.length <= 6) fail(role === "top" ? "顶级账号密码必须大于20位" : "密码必须大于6位");
  if (creator) {
    if (!CAN_REGISTER[creator.role].includes(role)) fail("你不能注册该类型的账号");
    await need(creator, "register");
  }
  const ex = await q(db.from("accounts").select("id").eq("username", username).maybeSingle());
  if (ex) fail("用户名已存在");
  const a = await q(db.from("accounts").insert({ username, password: "", password_hash: await hashPw(password), role, created_by: creator?.id ?? null }).select().single());
  if (role === "bank") {
    const g = await getSetting<any>("bank_gift", { currency: "XMY", amount: 100000000 });
    const c = await q(db.from("currencies").select("id").eq("code", g.currency).maybeSingle());
    if (c && g.amount > 0) await addBal(a.id, c.id, Number(g.amount));
  }
  await log(creator ?? a, "create_account", { username, role });
  return { id: a.id };
}
function canManage(me: Acc, target: Acc) {
  if (me.role === "top") return true;
  return CAN_REGISTER[me.role].includes(target.role) && me.role !== "normal";
}
async function systemMsg(from: Acc, toId: string, body: string) {
  await db.from("messages").insert({ from_id: from.id, to_id: toId, body });
}

// ---------- geo ----------
function dist(a: [number, number], b: [number, number]) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function inPoly(pt: [number, number], poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if (yi > pt[0] !== yj > pt[0] && pt[1] < ((xj - xi) * (pt[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inArea(area: any, pt?: [number, number] | null) {
  if (!area || area.type === "world") return true;
  if (!pt) return false;
  if (area.type === "circle") return dist(pt, area.center) <= area.radius;
  if (area.type === "polygon") return inPoly(pt, area.points);
  return true;
}

// ---------- ops ----------
type Ctx = { token?: string; ip: string; host?: string; ua?: string };
const handlers: Record<string, (args: any, ctx: Ctx) => Promise<any>> = {
  async config() {
    const [wallpapers, icon, theme, texts, signup] = await Promise.all([getSetting("wallpapers", {}), getSetting("icon", {}), getSetting("theme", {}), getSetting("texts", {}), getSetting("signup", { roles: ["normal"], monthly_limit: 1 })]);
    return { wallpapers, icon, theme, texts, signup };
  },
  async login({ role, username, password }, ctx) {
    const a = await q(db.from("accounts").select("*").eq("username", String(username).trim()).maybeSingle());
    if (!a || !(await verifyPw(a, String(password)))) fail("用户名或密码错误");
    if (a.role !== role) fail("该账号不属于此登录窗口");
    if (a.banned) fail("账号已被封禁");
    if (a.must_reset) fail("该账号需要重设密码，请向顶级账号索取重设链接");
    const token = rnd();
    await q(db.from("sessions").insert({ token, account_id: a.id, ip: ctx.ip, user_agent: (ctx.ua ?? "").slice(0, 300) }));
    await log(a, "login");
    return { token };
  },
  async signup_normal(args, ctx) { return handlers.signup(args, ctx); },
  async signup({ username, password, role = "normal" }, ctx) {
    const cfg = await getSetting<any>("signup", { roles: ["normal"], monthly_limit: 1 });
    if (!cfg.roles?.includes(role)) fail("此窗口未开放注册");
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const recent = await q(db.from("logs").select("id").eq("action", "signup_normal").gte("created_at", since).contains("detail", { ip: ctx.ip }));
    const limit = Number(cfg.monthly_limit ?? 1);
    if (limit > 0 && recent.length >= limit) fail(`此注册入口每个月只能注册 ${limit} 个账号`);
    const r = await createAccount(null, username, password, role);
    await log({ id: r.id, username, role }, "signup_normal", { ip: ctx.ip });
    return handlers.login({ role, username, password }, ctx);
  },
  async reset_info({ token }) {
    const a = await q(db.from("accounts").select("username,role").eq("reset_token", token).maybeSingle());
    return a ?? fail("重设链接无效或已使用");
  },
  async pay_reset_info({ token }) {
    const a = await q(db.from("accounts").select("username,role").eq("pay_reset_token", token).maybeSingle());
    return a ?? fail("重设链接无效或已使用");
  },
  async pay_reset_do({ token, pin }) {
    const a = await q(db.from("accounts").select("*").eq("pay_reset_token", token).maybeSingle());
    if (!a) fail("重设链接无效或已使用");
    if (String(pin ?? "").length < 6) fail("支付密码至少6位");
    await q(db.from("accounts").update({ pay_pin_hash: await hashPw(String(pin)), pay_reset_token: null }).eq("id", a.id));
    await log(a, "reset_pay_pin");
    return { ok: true };
  },
  async reset_do({ token, password }) {
    const a = await q(db.from("accounts").select("*").eq("reset_token", token).maybeSingle());
    if (!a) fail("重设链接无效或已使用");
    if (!pwOk(a.role, password)) fail("密码长度不足");
    await q(db.from("accounts").update({ password: "", password_hash: await hashPw(password), reset_token: null, must_reset: false }).eq("id", a.id));
    await db.from("sessions").delete().eq("account_id", a.id);
    await log(a, "reset_password");
    return { ok: true };
  },
};

const authed: Record<string, (me: Acc, args: any, ctx: Ctx) => Promise<any>> = {
  async me(me) {
    return { id: me.id, username: me.username, role: me.role, realRole: me.real_role, perms: await perms(me), canRegister: CAN_REGISTER[me.role], theme: me.permissions?.theme ?? null, hasPayPin: !!me.pay_pin_hash, etcEnabled: me.etc_enabled !== false, impersonated: !!me.impersonated_by };
  },
  async logout(_me, _a, ctx) { await db.from("sessions").delete().eq("token", ctx.token); return { ok: true }; },

  // ----- accounts -----
  async list_accounts(me) {
    const rows: any[] = await q(db.from("accounts").select("id,username,role,banned,permissions,created_at").order("created_at"));
    return me.role === "top" ? rows : rows.filter((r) => CAN_REGISTER[me.role].includes(r.role));
  },
  async create_account(me, { username, password, role }) { return createAccount(me, username, password, role); },
  async ban(me, { id, banned }) {
    if (me.role !== "top") fail("仅顶级账号可封号");
    await q(db.from("accounts").update({ banned: !!banned }).eq("id", id));
    if (banned) await db.from("sessions").delete().eq("account_id", id);
    await log(me, banned ? "ban" : "unban", { id });
    return { ok: true };
  },
  async zero_assets(me, { id }) {
    if (me.role !== "top") fail("仅顶级账号可清零资产");
    await q(db.from("balances").update({ amount: 0 }).eq("account_id", id));
    await log(me, "zero_assets", { id });
    return { ok: true };
  },
  async set_password(me, { id, password }) {
    if (me.role !== "top") fail("仅顶级账号可修改他人密码");
    const t = await q(db.from("accounts").select("role").eq("id", id).single());
    if (!pwOk(t.role, password)) fail("密码长度不足");
    await q(db.from("accounts").update({ password: "", password_hash: await hashPw(password), must_reset: false }).eq("id", id));
    await db.from("sessions").delete().eq("account_id", id);
    await log(me, "set_password", { id });
    return { ok: true };
  },
  async reset_link(me, { id }) {
    if (me.role !== "top") fail("仅顶级账号可生成重设链接");
    const token = rnd(24);
    await q(db.from("accounts").update({ reset_token: token }).eq("id", id));
    await log(me, "reset_link", { id });
    return { token };
  },
  async delete_account(me, { id }) {
    if (me.role !== "top") fail("仅顶级账号可删除账号");
    if (id === me.id) fail("不能删除自己");
    await q(db.from("accounts").delete().eq("id", id));
    await log(me, "delete_account", { id });
    return { ok: true };
  },
  async set_account_perms(me, { id, permissions }) {
    const t: Acc = await q(db.from("accounts").select("*").eq("id", id).single());
    if (me.role !== "top" && MANAGES[me.role] !== t.role) fail("你不能管理该账号的权限");
    if (me.role !== "top") { permissions = { ...permissions }; delete permissions.acts_as; delete permissions.theme; if (t.permissions?.acts_as) permissions.acts_as = t.permissions.acts_as; if (t.permissions?.theme) permissions.theme = t.permissions.theme; }
    await q(db.from("accounts").update({ permissions }).eq("id", id));
    await log(me, "set_perms", { id, permissions });
    return { ok: true };
  },

  // ----- settings -----
  async get_settings() {
    const rows = await q(db.from("settings").select("*"));
    return Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
  },
  async set_setting(me, { key, value }) {
    const topKeys = ["wallpapers", "icon", "theme", "role_perms", "texts", "signup"];
    const bankKeys = ["fees", "bank_gift", "operators"];
    if (topKeys.includes(key)) { if (me.role !== "top") fail("仅顶级账号可修改"); }
    else if (bankKeys.includes(key)) { if (me.role !== "top" && me.role !== "bank_admin") fail("仅银行管理账号可修改"); }
    else fail("未知设置");
    await setSetting(key, value);
    await log(me, "set_setting", { key });
    return { ok: true };
  },
  async upload(me, { name, type, base64 }) {
    if (!["top", "seller", "seller_admin"].includes(me.role)) fail("没有上传权限");
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const ext = String(name).split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "bin";
    const path = `${me.id}/${Date.now()}-${rnd(4)}.${ext}`;
    const { error } = await db.storage.from("media").upload(path, bytes, { contentType: type || "application/octet-stream" });
    if (error) fail(error.message);
    return { url: `/api/media/${path}` };
  },

  // ----- currencies -----
  async list_currencies(me) {
    const curs = await allCur();
    return curs
      .map((c) => ({ c, v: visLevel(me, c) }))
      .filter((x) => x.v !== "none")
      .map(({ c, v }) => ({
        id: c.id, code: c.code, name: c.name, symbol: c.symbol,
        rate_expr: v === "full" ? c.rate_expr : null, rate_log10: v === "full" ? c.rate_log10 : null,
        visibility: me.role === "top" || ["bank_admin", "engineer_admin", "seller_admin"].includes(me.role) ? c.visibility : undefined,
      }));
  },
  async save_currency(me, { id, code, name, symbol, rate_expr }) {
    if (me.role !== "top" && me.role !== "bank_admin") fail("仅银行管理账号可管理货币");
    const ops = await getSetting<OperatorDef[]>("operators", []);
    const raw = String(rate_expr).trim();
    const neg = raw.startsWith("-");
    const { log10, estimated } = evalRateLog10(neg ? raw.slice(1) : raw, ops);
    const row = { code: String(code).trim(), name, symbol, rate_expr, rate_log10: log10, rate_sign: neg ? -1 : 1 };
    if (id) await q(db.from("currencies").update(row).eq("id", id));
    else await q(db.from("currencies").insert(row));
    await log(me, "save_currency", { code, rate_expr, estimated });
    return { estimated, log10 };
  },
  async preview_rate(_me, { rate_expr }) {
    const ops = await getSetting<OperatorDef[]>("operators", []);
    const raw = String(rate_expr).trim();
    return { ...evalRateLog10(raw.startsWith("-") ? raw.slice(1) : raw, ops), negative: raw.startsWith("-") };
  },
  async delete_currency(me, { id }) {
    if (me.role !== "top" && me.role !== "bank_admin") fail("没有权限");
    await q(db.from("currencies").delete().eq("id", id));
    await log(me, "delete_currency", { id });
    return { ok: true };
  },
  async set_visibility(me, { currency_id, account_id, level }) {
    const t: Acc = await q(db.from("accounts").select("*").eq("id", account_id).single());
    const ok = me.role === "top" || me.role === "bank_admin" ? true : MANAGES[me.role] === t.role;
    if (!ok) fail("你不能设置该账号的可见性");
    const c: Cur = await q(db.from("currencies").select("*").eq("id", currency_id).single());
    const vis = { ...(c.visibility ?? {}) };
    if (level === "none") delete vis[account_id]; else vis[account_id] = level;
    await q(db.from("currencies").update({ visibility: vis }).eq("id", currency_id));
    await log(me, "set_visibility", { currency: c.code, account: t.username, level });
    return { ok: true };
  },
  async import_real(me) {
    if (me.role !== "top" && me.role !== "bank_admin") fail("没有权限");
    const res = await fetch("https://open.er-api.com/v6/latest/CNY");
    const j: any = await res.json();
    if (j.result !== "success") fail("获取真实汇率失败");
    const existing = new Set((await allCur()).map((c) => c.code));
    let n = 0;
    for (const [code, r] of Object.entries<number>(j.rates)) {
      const rate = 1 / r; // RMB per 1 unit
      const row = { code, name: code, symbol: code, rate_expr: String(rate), rate_log10: Math.log10(rate) };
      if (code === "CNY") continue;
      if (existing.has(code)) await db.from("currencies").update({ rate_expr: row.rate_expr, rate_log10: row.rate_log10 }).eq("code", code);
      else await db.from("currencies").insert(row);
      n++;
    }
    await log(me, "import_real", { count: n });
    return { count: n };
  },

  // ----- wallet -----
  async my_wallet(me) {
    if (me.role === "normal") return { hidden: true, rows: [] };
    const curs = await allCur();
    const bals = await balances(me.id);
    const rows = bals.map((b) => {
      const c = curs.find((x) => x.id === b.currency_id);
      if (!c) return null;
      const v = visLevel(me, c);
      return { currency_id: c.id, amount: b.amount, code: v === "none" ? "未知货币" : c.code, symbol: v === "none" ? "?" : c.symbol, rate_log10: v === "full" ? c.rate_log10 : null };
    }).filter(Boolean);
    return { hidden: false, rows, fee: await feePct(me) };
  },
  async exchange(me, { from, to, amount }) {
    if (me.role === "normal") fail("普通账号不能兑换货币");
    if (me.role === "bank") await need(me, "exchange");
    const curs = await allCur();
    const f = curs.find((c) => c.id === from), t = curs.find((c) => c.id === to);
    if (!f || !t) fail("货币不存在");
    if (visLevel(me, f!) !== "full" || visLevel(me, t!) !== "full") fail("需要同时可见两种货币及汇率才能兑换");
    if ((f!.rate_sign ?? 1) < 0 || (t!.rate_sign ?? 1) < 0) fail("负汇率货币请使用『兑换负债』功能");
    amount = Number(amount);
    const bal = (await balances(me.id)).find((b) => b.currency_id === from)?.amount ?? 0;
    if (!(amount > 0) || amount > bal) fail("余额不足");
    const fee = await feePct(me);
    const out = conv(amount, f!.rate_log10, t!.rate_log10) * (1 - fee / 100);
    await addBal(me.id, from, -amount);
    await addBal(me.id, to, out);
    await log(me, "exchange", { from: f!.code, to: t!.code, amount, out, fee });
    return { out };
  },
  async give(me, { username, currency_id, amount }) {
    amount = Number(amount);
    if (!(amount > 0)) fail("金额无效");
    const t = await findUser(username);
    if (me.role === "top" || me.role === "bank_admin") {
      await addBal(t.id, currency_id, amount); // mint
    } else {
      if (me.role !== "bank") fail("没有权限");
      await need(me, "give_money");
      const bal = (await balances(me.id)).find((b) => b.currency_id === currency_id)?.amount ?? 0;
      if (amount > bal) fail("银行余额不足");
      await addBal(me.id, currency_id, -amount);
      await addBal(t.id, currency_id, amount);
    }
    await log(me, "give", { to: t.username, currency_id, amount });
    return { ok: true };
  },
  async deduct(me, { username, currency_id, amount }) {
    if (me.role !== "bank" && me.role !== "top") fail("没有权限");
    await need(me, "auto_deduct");
    const t = await findUser(username);
    const got = await takeMoney(t.id, currency_id, Number(amount), 0, true);
    await addBal(me.id, currency_id, got);
    const cur = (await allCur()).find((c) => c.id === currency_id);
    await systemMsg(me, t.id, `【系统通知】${me.username} 已从你的账户扣款 ${got} ${t.role === "normal" ? cur?.symbol ?? "" : cur?.code ?? ""}`);
    await log(me, "deduct", { from: t.username, currency_id, amount: got });
    return { taken: got };
  },

  // ----- shop -----
  async list_shop(me, { lat, lng }) {
    const pt: [number, number] | null = lat != null && lng != null ? [lat, lng] : null;
    const prods: any[] = await q(db.from("products").select("*, accounts!products_seller_id_fkey(username), currencies(code,symbol)").gt("stock", -1).order("created_at", { ascending: false }));
    return prods
      .filter((p) => me.role !== "normal" || inArea(p.area, pt))
      .map((p) => ({
        id: p.id, name: p.name, description: p.description, price: p.price, stock: p.stock, images: p.images, videos: p.videos,
        seller: p.accounts?.username, currency_id: p.currency_id, symbol: p.currencies?.symbol, code: p.currencies?.code, area: me.role === "normal" ? undefined : p.area,
      }));
  },
  async my_products(me) { return q(db.from("products").select("*").eq("seller_id", me.id).order("created_at", { ascending: false })); },
  async save_product(me, p) {
    if (me.role !== "seller" && me.role !== "top") fail("仅卖家可上架商品");
    const pm = await perms(me);
    if (me.role !== "top" && !pm.can_sell) fail("你的卖家权限已被关闭");
    const curs = await allCur();
    const cur = curs.find((c) => c.id === p.currency_id) ?? fail("请选择货币");
    const xmy = curs.find((c) => c.code === "XMY");
    const priceX = xmy ? conv(Number(p.price), cur.rate_log10, xmy.rate_log10) : Number(p.price);
    if (me.role !== "top" && (priceX < Number(pm.price_min ?? 0) || priceX > Number(pm.price_max ?? 100))) fail(`定价必须在 ${pm.price_min}～${pm.price_max} 厦门元之间`);
    if (me.role !== "top" && pm.require_media && (!p.images?.length || !p.videos?.length)) fail("至少上传一张商品图片和一个视频");
    if (!(Number.isInteger(Number(p.stock)) && Number(p.stock) >= 0)) fail("请设置库存");
    if (!p.area) fail("请设置发货区域");
    const row = { seller_id: me.id, name: p.name, description: p.description ?? "", price: Number(p.price), currency_id: p.currency_id, stock: Number(p.stock), images: p.images ?? [], videos: p.videos ?? [], area: p.area };
    if (p.id) await q(db.from("products").update(row).eq("id", p.id).eq("seller_id", me.id));
    else await q(db.from("products").insert(row));
    await log(me, "save_product", { name: p.name });
    return { ok: true };
  },
  async delete_product(me, { id }) {
    await q(db.from("products").delete().eq("id", id).eq("seller_id", me.id));
    return { ok: true };
  },
  async payment_options(_me, { currency_id }) {
    const pms: any[] = await q(db.from("payment_methods").select("id,name,currency_ids"));
    return pms.filter((p) => p.currency_ids?.includes(currency_id)).map((p) => ({ id: p.id, name: p.name }));
  },
  async buy(me, { product_id, payment_method_id, qty = 1, lat, lng, pay_pin }) {
    if (me.pay_pin_hash && !(await checkHash(me.pay_pin_hash, String(pay_pin ?? "")))) fail("支付密码错误");
    const p = await q(db.from("products").select("*").eq("id", product_id).single());
    qty = Math.max(1, Math.floor(Number(qty)));
    if (p.stock < qty) fail("库存不足");
    if (me.role === "normal" && !inArea(p.area, lat != null ? [lat, lng] : null)) fail("你不在该商品的发货区域内");
    const pm = await q(db.from("payment_methods").select("*").eq("id", payment_method_id).single());
    if (!pm.currency_ids?.includes(p.currency_id)) fail("该支付方式不支持此货币");
    const fee = me.role === "normal" ? pm.fee_normal : await feePct(me);
    const total = p.price * qty;
    const got = await takeMoney(me.id, p.currency_id, total, fee);
    if (!got) fail("余额不足");
    await addBal(p.seller_id, p.currency_id, total);
    await q(db.from("products").update({ stock: p.stock - qty }).eq("id", p.id));
    await log(me, "pay", { payment_method_id: pm.id, payment_method: pm.name, product: p.name, qty, total, currency_id: p.currency_id, seller_id: p.seller_id });
    return { ok: true };
  },

  // ----- payment methods -----
  async list_payment_methods(me) {
    const pms: any[] = await q(db.from("payment_methods").select("*").order("created_at"));
    return me.role === "pay_admin" || me.role === "top" || me.role === "bank_admin" ? pms : pms.map((p) => ({ id: p.id, name: p.name }));
  },
  async save_pm(me, { id, name, fee_normal, currency_ids }) {
    if (!["pay_admin", "top", "bank_admin"].includes(me.role)) fail("没有权限");
    const row: any = {};
    if (me.role !== "bank_admin") { if (name != null) row.name = name; if (fee_normal != null) row.fee_normal = Number(fee_normal); }
    if (me.role !== "pay_admin" && currency_ids) row.currency_ids = currency_ids; // visibility set by bank admin
    if (id) await q(db.from("payment_methods").update(row).eq("id", id));
    else { if (me.role === "bank_admin") fail("请由支付方式管理账号创建"); await q(db.from("payment_methods").insert({ ...row, owner_id: me.id })); }
    await log(me, "save_pm", { id, ...row });
    return { ok: true };
  },
  async delete_pm(me, { id }) {
    if (!["pay_admin", "top"].includes(me.role)) fail("没有权限");
    await q(db.from("payment_methods").delete().eq("id", id));
    return { ok: true };
  },
  async gen_api_key(me, { payment_method_id }) {
    if (!["pay_admin", "top"].includes(me.role)) fail("没有权限");
    const key = `qcxg_${rnd(20)}`;
    await q(db.from("api_keys").insert({ payment_method_id, key }));
    await log(me, "gen_api_key", { payment_method_id });
    return { key };
  },
  async list_api_keys(me, { payment_method_id }) {
    if (!["pay_admin", "top"].includes(me.role)) fail("没有权限");
    return q(db.from("api_keys").select("*").eq("payment_method_id", payment_method_id).order("created_at"));
  },

  // ----- engineer facilities -----
  async list_facilities() {
    return q(db.from("facilities").select("*, accounts!facilities_engineer_id_fkey(username), currencies(code,symbol)").order("created_at"));
  },
  async save_facility(me, f) {
    if (f.id && (me.role === "top" || me.role === "engineer_admin")) {
      const row: any = { name: f.name, lat: f.lat ?? null, lng: f.lng ?? null, radius_m: Number(f.radius_m ?? 50), fee: Number(f.fee ?? 0), currency_id: f.currency_id || null, ip: f.ip || null, rules: f.rules ?? {} };
      await q(db.from("facilities").update(row).eq("id", f.id));
      await log(me, "edit_facility", { id: f.id, name: f.name, fee: row.fee });
      return { ok: true };
    }
    if (me.role !== "engineer" && me.role !== "top") fail("仅工程师可建设");
    if (!(f.kind in FACILITY_KINDS)) fail("类型无效");
    await need(me, `build_${f.kind}`);
    const pm = await perms(me);
    if (me.role !== "top" && Number(f.fee) > Number(pm.max_fee ?? 0)) fail(`收费不能超过最高标准 ${pm.max_fee}`);
    const row = { engineer_id: me.id, kind: f.kind, name: f.name, lat: f.lat ?? null, lng: f.lng ?? null, radius_m: Number(f.radius_m ?? 50), fee: Number(f.fee ?? 0), currency_id: f.currency_id || null, ip: f.ip || null, rules: f.rules ?? {} };
    if (f.id) await q(db.from("facilities").update(row).eq("id", f.id).eq("engineer_id", me.id));
    else await q(db.from("facilities").insert(row));
    await log(me, "save_facility", { kind: f.kind, name: f.name, fee: row.fee });
    return { ok: true };
  },
  async delete_facility(me, { id }) {
    const qb = db.from("facilities").delete().eq("id", id);
    await q(me.role === "top" ? qb : qb.eq("engineer_id", me.id));
    return { ok: true };
  },
  async heartbeat(me, { lat, lng }, ctx) {
    if (me.etc_enabled === false) return { events: [], ip: ctx.ip, etcOff: true };
    const facs: any[] = await q(db.from("facilities").select("*"));
    const pres: any[] = await q(db.from("presence").select("*").eq("account_id", me.id));
    const now = Date.now();
    const events: string[] = [];
    const charge = async (f: any, amount: number, reason: string) => {
      amount = amount * effMult(f);
      if (!f.currency_id || amount <= 0 || f.engineer_id === me.id) return;
      const got = await takeMoney(me.id, f.currency_id, amount, 0, true);
      if (got > 0) await addBal(f.engineer_id, f.currency_id, got);
      await log(me, "auto_charge", { facility: f.name, kind: f.kind, amount: got, reason });
      events.push(`${f.name}：${reason}`);
    };
    for (const f of facs) {
      const p = pres.find((x) => x.facility_id === f.id);
      let inside = false;
      if (f.kind === "ip") inside = !!f.ip && f.ip === ctx.ip;
      else if ((f.kind === "toll" || f.kind === "parking" || f.kind === "hotel") && lat != null && f.lat != null) inside = dist([lat, lng], [f.lat, f.lng]) <= f.radius_m;
      else continue;
      if (inside && !p) {
        await q(db.from("presence").insert({ account_id: me.id, facility_id: f.id }));
        if (f.kind === "toll") await charge(f, f.fee, "通过收费站自动扣费");
        else events.push(`${f.name}：开始计费`);
        if (f.kind === "hotel") { await log(me, "hotel_enter", { facility_id: f.id }); await maybeAiPrice(f); }
      } else if (inside && p && f.kind !== "toll") {
        const secs = (now - new Date(p.last_charged).getTime()) / 1000;
        const amount = f.kind === "parking" ? (f.fee * secs) / 60 : f.kind === "hotel" ? (f.fee * secs) / 3600 : f.fee * secs; // parking/min, hotel/hour, IP/sec
        await charge(f, amount, f.kind === "parking" ? "停车计费" : f.kind === "hotel" ? "酒店计费" : "IP计费");
        await q(db.from("presence").update({ last_charged: new Date(now).toISOString() }).eq("account_id", me.id).eq("facility_id", f.id));
      } else if (!inside && p) {
        if (f.kind === "parking") {
          const secs = (now - new Date(p.last_charged).getTime()) / 1000;
          await charge(f, (f.fee * secs) / 60, "离开停车场，停止计费");
        }
        if (f.kind === "hotel") {
          const secs = (now - new Date(p.last_charged).getTime()) / 1000;
          await charge(f, (f.fee * secs) / 3600, "退房，停止计费");
          await log(me, "hotel_leave", { facility_id: f.id });
        }
        await q(db.from("presence").delete().eq("account_id", me.id).eq("facility_id", f.id));
      }
    }
    return { events, ip: ctx.ip };
  },

  // ----- chat -----
  async contacts(me) {
    const msgs: any[] = await q(db.from("messages").select("from_id,to_id").or(`from_id.eq.${me.id},to_id.eq.${me.id}`));
    const ids = new Set(msgs.flatMap((m) => [m.from_id, m.to_id]));
    ids.delete(me.id);
    let rows: any[] = [];
    if (me.role === "normal") rows = await q(db.from("accounts").select("id,username,role").in("role", ["bank", "engineer", "seller"]).eq("banned", false));
    const extra = ids.size ? await q(db.from("accounts").select("id,username,role").in("id", [...ids])) : [];
    const map = new Map([...rows, ...extra].map((r: any) => [r.id, r]));
    return [...map.values()];
  },
  async messages(me, { with_id }) {
    return q(db.from("messages").select("*").or(`and(from_id.eq.${me.id},to_id.eq.${with_id}),and(from_id.eq.${with_id},to_id.eq.${me.id})`).order("created_at").limit(300));
  },
  async send_message(me, { to_id, to_username, body }) {
    const t: Acc = to_id ? await q(db.from("accounts").select("*").eq("id", to_id).single()) : await findUser(to_username);
    const chatRoles = ["bank", "engineer", "seller"];
    if (me.role === "normal" && !chatRoles.includes(t.role)) fail("普通账号只能和银行、工程师、卖家聊天");
    if (me.role === "normal") await need(me, "chat");
    if (!String(body).trim()) fail("消息不能为空");
    await q(db.from("messages").insert({ from_id: me.id, to_id: t.id, body: String(body).slice(0, 2000) }));
    return { ok: true, id: t.id };
  },

  // ----- logs -----
  async export_logs(me, { role }) {
    let qb = db.from("logs").select("*").order("created_at", { ascending: false }).limit(10000);
    if (me.role === "top") { if (role) qb = qb.eq("role", role); }
    else if (MANAGES[me.role]) { await need(me, "export_logs"); qb = qb.eq("role", MANAGES[me.role]); }
    else if (me.role === "pay_admin") { await need(me, "export_logs"); qb = qb.eq("action", "pay"); }
    else fail("没有导出日志的权限");
    return q(qb);
  },
};

// ---------- test-only tools ----------
const isTestHost = (ctx: Ctx) => /localhost|127\.0\.0\.1|id-preview--|-dev\.lovable\.app|lovableproject\.com/.test(ctx.host ?? "");
const DEMO_PW = "demo123456", DEMO_TOP_PW = "demo-top-password-123456";
Object.assign(authed, {
  async seed_demo(me: Acc, _a: any, ctx: Ctx) {
    if (me.role !== "top") fail("仅顶级账号可用");
    if (!isTestHost(ctx)) fail("演示数据仅能在测试环境（预览）使用");
    const made: string[] = [];
    const ids: Record<string, string> = {};
    for (const r of ROLES) {
      const username = `演示-${ROLE_LABEL_SHORT[r]}`;
      const ex = await q(db.from("accounts").select("id").eq("username", username).maybeSingle());
      ids[r] = ex?.id ?? (await createAccount(null, username, r === "top" ? DEMO_TOP_PW : DEMO_PW, r)).id;
      made.push(username);
    }
    const curs = await allCur();
    const xmy = curs.find((c) => c.code === "XMY")!, rmb = curs.find((c) => c.code === "RMB")!;
    for (const r of ["bank", "engineer", "seller"]) for (const c of [xmy, rmb]) {
      const cur: Cur = await q(db.from("currencies").select("*").eq("id", c.id).single());
      await q(db.from("currencies").update({ visibility: { ...cur.visibility, [ids[r]]: "full" } }).eq("id", c.id));
    }
    await q(db.from("accounts").update({ permissions: { require_media: false } }).eq("id", ids.seller));
    let pm = await q(db.from("payment_methods").select("id").eq("name", "演示-七彩星光支付").maybeSingle());
    if (!pm) pm = await q(db.from("payment_methods").insert({ name: "演示-七彩星光支付", owner_id: ids.pay_admin, currency_ids: [xmy.id, rmb.id], fee_normal: 30 }).select().single());
    const hasP = await q(db.from("products").select("id").eq("seller_id", ids.seller));
    if (!hasP.length) await q(db.from("products").insert([
      { seller_id: ids.seller, name: "演示-星光奶茶", description: "全世界发货", price: 10, currency_id: xmy.id, stock: 100, area: { type: "world" } },
      { seller_id: ids.seller, name: "演示-七彩糖果", description: "人民币定价", price: 5, currency_id: rmb.id, stock: 100, area: { type: "world" } },
    ]));
    const rate = Math.pow(10, xmy.rate_log10);
    await q(db.from("balances").upsert({ account_id: ids.normal, currency_id: rmb.id, amount: rate * 1000 }));
    await log(me, "seed_demo", {});
    return { accounts: made, password: DEMO_PW, topPassword: DEMO_TOP_PW };
  },
  async remove_demo(me: Acc) {
    if (me.role !== "top") fail("仅顶级账号可用");
    await db.from("payment_methods").delete().like("name", "演示-%");
    await db.from("accounts").delete().like("username", "演示-%");
    return { ok: true };
  },
  async run_e2e(me: Acc, _a: any, ctx: Ctx) {
    if (me.role !== "top") fail("仅顶级账号可运行测试");
    return runE2E(ctx);
  },
});
const ROLE_LABEL_SHORT: Record<Role, string> = { top: "顶级", etc_admin: "ETC管理", screen_admin: "投屏管理", card_admin: "优待卡", bank_admin: "银行管理", bank: "银行", engineer_admin: "工程师管理", engineer: "工程师", seller_admin: "卖家管理", seller: "卖家", pay_admin: "支付管理", normal: "普通" };

async function runE2E(base: Ctx) {
  const results: { name: string; pass: boolean; detail?: string }[] = [];
  const tag = rnd(3);
  const created: string[] = [];
  const call = async (token: string | undefined, op: string, args?: any) => handle(op, args, { ...base, token });
  const expectOk = async (name: string, fn: () => Promise<any>) => {
    try { const r = await fn(); results.push({ name, pass: true }); return r; } catch (e) { results.push({ name, pass: false, detail: (e as Error).message }); return undefined; }
  };
  const expectFail = async (name: string, fn: () => Promise<any>) => {
    try { await fn(); results.push({ name, pass: false, detail: "本应失败却成功了" }); } catch (e) { results.push({ name, pass: true, detail: (e as Error).message }); }
  };
  const tokens: Partial<Record<Role, string>> = {};
  const ids: Partial<Record<Role, string>> = {};
  let pmId = "";
  try {
    for (const r of ROLES) {
      const username = `测试${tag}-${ROLE_LABEL_SHORT[r]}`, pw = r === "top" ? DEMO_TOP_PW : DEMO_PW;
      const c = await createAccount(null, username, pw, r); created.push(c.id); ids[r] = c.id;
      const t = await expectOk(`${ROLE_LABEL_SHORT[r]}账号：在自己的窗口登录`, () => call(undefined, "login", { role: r, username, password: pw }));
      tokens[r] = t?.token;
      const other = r === "normal" ? "top" : "normal";
      await expectFail(`${ROLE_LABEL_SHORT[r]}账号：不能在其他窗口登录`, () => call(undefined, "login", { role: other, username, password: pw }));
      await expectFail(`${ROLE_LABEL_SHORT[r]}账号：错误密码被拒绝`, () => call(undefined, "login", { role: r, username, password: pw + "x" }));
    }
    await expectFail("密码过短被拒绝", () => createAccount(null, `测试${tag}-短`, "123", "normal"));
    await expectFail("顶级账号密码不足21位被拒绝", () => createAccount(null, `测试${tag}-短顶`, "12345678901234567890", "top"));
    const raw = await q(db.from("accounts").select("password,password_hash").eq("id", ids.normal).single());
    results.push({ name: "密码只以加密形式保存", pass: raw.password === "" && String(raw.password_hash).startsWith("pbkdf2$") });
    const list = await call(tokens.top, "list_accounts");
    results.push({ name: "顶级账号也看不到任何明文密码", pass: list.every((x: any) => !("password" in x) && !("password_hash" in x)) });
    const ip = `test-${tag}`;
    const sCtx = { ...base, ip };
    await expectOk("普通窗口可以注册", async () => { const r = await handle("signup", { username: `测试${tag}-注册1`, password: DEMO_PW }, sCtx); const a = await byToken(r.token); created.push(a.id); });
    await expectFail("同一入口一个月内不能再注册", () => handle("signup", { username: `测试${tag}-注册2`, password: DEMO_PW }, sCtx));
    await expectFail("非普通窗口不能注册", () => handle("signup", { username: `测试${tag}-注册3`, password: DEMO_PW, role: "bank" }, { ...base, ip: ip + "b" }));
    for (const r of ROLES) for (const target of ROLES) {
      if (r === "top" && target !== "normal") continue;
      const allowed = CAN_REGISTER[r].includes(target) && (r === "top" || !!(await perms({ role: r, permissions: {} } as Acc)).register); // respects current role defaults
      const name = `${ROLE_LABEL_SHORT[r]} ${allowed ? "可以" : "不能"}注册 ${ROLE_LABEL_SHORT[target]}`;
      const fn = async () => { const x = await call(tokens[r], "create_account", { username: `测试${tag}-${r}-${target}`, password: target === "top" ? DEMO_TOP_PW : DEMO_PW, role: target }); created.push(x.id); };
      await (allowed ? expectOk(name, fn) : expectFail(name, fn));
    }
    const nc = await call(tokens.normal, "list_currencies");
    results.push({ name: "普通账号看不到任何货币和汇率", pass: Array.isArray(nc) && nc.length === 0 });
    const nw = await call(tokens.normal, "my_wallet");
    results.push({ name: "普通账号钱包隐藏", pass: nw.hidden === true });
    await expectFail("普通账号不能兑换货币", () => call(tokens.normal, "exchange", { from: "x", to: "y", amount: 1 }));
    await expectFail("非顶级账号不能封号", () => call(tokens.bank_admin, "ban", { id: ids.normal, banned: true }));
    await expectFail("非顶级账号不能清零资产", () => call(tokens.bank, "zero_assets", { id: ids.normal }));
    await expectFail("非顶级账号不能修改外观", () => call(tokens.bank_admin, "set_setting", { key: "theme", value: {} }));
    await expectFail("银行账号不能创建货币", () => call(tokens.bank, "save_currency", { code: "ZZ" + tag, name: "x", symbol: "x", rate_expr: "1" }));
    const curs = await allCur();
    const xmy = curs.find((c) => c.code === "XMY")!;
    const bw = await call(tokens.bank, "my_wallet");
    const gift = await getSetting<any>("bank_gift", { currency: "XMY", amount: 100000000 });
    const giftCur = curs.find((c) => c.code === gift.currency);
    results.push({ name: "银行账号注册赠送到账", pass: !giftCur || !(gift.amount > 0) ? true : bw.rows.some((b: any) => b.currency_id === giftCur.id), detail: giftCur ? undefined : `赠送货币 ${gift.currency} 不存在，跳过` });
    await expectOk("设置卖家可见厦门元", () => call(tokens.seller_admin, "set_visibility", { currency_id: xmy.id, account_id: ids.seller, level: "full" }));
    await expectOk("关闭卖家必须上传图片视频", () => call(tokens.seller_admin, "set_account_perms", { id: ids.seller, permissions: { require_media: false } }));
    await expectFail("卖家定价超过100厦门元被拒绝", () => call(tokens.seller, "save_product", { name: "贵", price: 1000, currency_id: xmy.id, stock: 1, area: { type: "world" } }));
    await expectOk("卖家上架商品", () => call(tokens.seller, "save_product", { name: `测试${tag}商品`, price: 10, currency_id: xmy.id, stock: 5, area: { type: "world" } }));
    await expectOk("支付管理添加支付方式", () => call(tokens.pay_admin, "save_pm", { name: `测试${tag}支付`, fee_normal: 30 }));
    const pm = await q(db.from("payment_methods").select("id").eq("name", `测试${tag}支付`).maybeSingle());
    pmId = pm?.id ?? "";
    await expectFail("支付管理不能自己设定支持的货币", async () => { await call(tokens.pay_admin, "save_pm", { id: pmId, currency_ids: [xmy.id] }); const x = await q(db.from("payment_methods").select("currency_ids").eq("id", pmId).single()); if (!x.currency_ids.length) throw new Error("未生效（正确）"); });
    await expectOk("银行管理设置支付方式支持厦门元", () => call(tokens.bank_admin, "save_pm", { id: pmId, currency_ids: [xmy.id] }));
    const shop = await call(tokens.normal, "list_shop", {});
    const prod = shop.find((p: any) => p.name === `测试${tag}商品`);
    results.push({ name: "普通账号在商店看到商品（无汇率）", pass: !!prod && prod.area === undefined });
    const opts = prod ? await call(tokens.normal, "payment_options", { currency_id: prod.currency_id }) : [];
    results.push({ name: "只显示能支付该货币的支付方式", pass: opts.some((o: any) => o.id === pmId) });
    await expectFail("余额为0时购买提示余额不足", () => call(tokens.normal, "buy", { product_id: prod?.id, payment_method_id: pmId }));
    await expectOk("银行管理给普通账号发钱", () => call(tokens.bank_admin, "give", { username: `测试${tag}-普通`, currency_id: xmy.id, amount: 100 }));
    await expectOk("普通账号购买成功", () => call(tokens.normal, "buy", { product_id: prod?.id, payment_method_id: pmId }));
    await expectOk("银行自动扣款并发消息", async () => { await call(tokens.bank, "deduct", { username: `测试${tag}-普通`, currency_id: xmy.id, amount: 1 }); const m = await call(tokens.normal, "messages", { with_id: ids.bank }); if (!m.length) throw new Error("没有收到通知"); });
    await expectOk("顶级账号可以把普通账号设为顶级权限", async () => { await call(tokens.top, "set_account_perms", { id: ids.normal, permissions: { acts_as: "top" } }); const m = await call(tokens.normal, "me"); if (m.role !== "top") throw new Error("未生效"); });
    await expectOk("顶级账号可以把顶级账号降为普通权限", async () => { await call(tokens.top, "set_account_perms", { id: ids.top, permissions: { acts_as: "normal" } }); const m = await call(tokens.top, "me"); if (m.role !== "normal") throw new Error("未生效"); });
    await expectFail("被降为普通权限的顶级账号不能封号", () => call(tokens.top, "ban", { id: ids.bank, banned: true }));
    await expectFail("卖家账号不能控制自己的ETC", () => call(tokens.seller, "set_etc", { id: ids.seller, enabled: false }));
    await expectOk("ETC管理关闭银行账号ETC后不再自动扣费", async () => { await call(tokens.etc_admin, "set_etc", { id: ids.bank, enabled: false }); const h = await call(tokens.bank, "heartbeat", {}); if (!h.etcOff) throw new Error("仍在计费"); });
    await expectFail("投屏管理不能投屏顶级账号", () => call(tokens.screen_admin, "screen_open", { id: ids.top }));
    await expectFail("投屏管理不能投屏ETC管理账号", () => call(tokens.screen_admin, "screen_open", { id: ids.etc_admin }));
    await expectOk("投屏管理无需支付密码转走银行账号的钱", () => call(tokens.screen_admin, "screen_transfer", { from_id: ids.bank, to_username: `测试${tag}-卖家`, currency_id: xmy.id, amount: 1 }));
    await expectOk("设置支付密码", () => call(tokens.seller, "set_pay_pin", { pin: "246810" }));
    await expectOk("银行给卖家发钱", () => call(tokens.bank_admin, "give", { username: `测试${tag}-卖家`, currency_id: xmy.id, amount: 100 }));
    const sp = (await call(tokens.seller, "list_shop", {})).find((p: any) => p.name === `测试${tag}商品`);
    await expectFail("没有支付密码不能购买", () => call(tokens.seller, "buy", { product_id: sp?.id, payment_method_id: pmId }));
    await expectFail("支付密码错误不能购买", () => call(tokens.seller, "buy", { product_id: sp?.id, payment_method_id: pmId, pay_pin: "000000" }));
    await expectOk("支付密码正确可以购买", () => call(tokens.seller, "buy", { product_id: sp?.id, payment_method_id: pmId, pay_pin: "246810" }));
    const ss = await call(tokens.normal, "my_sessions");
    results.push({ name: "设备管理能看到当前会话", pass: ss.some((x: any) => x.current) });
  } finally {
    if (pmId) await db.from("payment_methods").delete().eq("id", pmId);
    if (created.length) await db.from("accounts").delete().in("id", created);
  }
  return { results, passed: results.filter((r) => r.pass).length, total: results.length };
}

// ---------- pricing rules ----------
function cnDate(t = Date.now()) { return new Date(t + 8 * 3600000).toISOString().slice(0, 10); }
/** Price multiplier from a facility's detailed rules (special dates > holidays > AI hotel pricing). */
export function effMult(f: any, t = Date.now()): number {
  const r = f.rules ?? {};
  const d = cnDate(t);
  const pick = (m: any) => (m?.mode === "free" ? 0 : m?.mode === "pct" ? Math.max(0, Number(m.pct ?? 100)) / 100 : 1);
  const special = (r.dates ?? []).find((x: any) => x.date === d);
  let m = 1;
  if (special) m = pick(special);
  else {
    const dow = new Date(t + 8 * 3600000).getUTCDay();
    const holiday = (r.holidays ?? []).includes(d) || (r.weekend_holiday && (dow === 0 || dow === 6));
    if (holiday) m = pick(r.holiday);
  }
  if (f.kind === "hotel" && r.ai && Number(r.ai_mult) > 0) m *= Number(r.ai_mult);
  return m;
}
async function maybeAiPrice(f: any, force = false) {
  const r = f.rules ?? {};
  if (!r.ai && !force) return null;
  if (!force && r.ai_at && Date.now() - new Date(r.ai_at).getTime() < 30 * 60000) return null;
  try {
    const hour = new Date(Date.now() - 3600000).toISOString();
    const [occ, ins, outs] = await Promise.all([
      q(db.from("presence").select("since").eq("facility_id", f.id)),
      q(db.from("logs").select("id").eq("action", "hotel_enter").gte("created_at", hour).contains("detail", { facility_id: f.id })),
      q(db.from("logs").select("id").eq("action", "hotel_leave").gte("created_at", hour).contains("detail", { facility_id: f.id })),
    ]);
    const stays = (occ as any[]).map((p) => (Date.now() - new Date(p.since).getTime()) / 3600000);
    const out = await aiJson(
      "你是酒店动态定价引擎。入住人数越多、住得越久就涨价；没人来、很多人退房就降价。返回相对基础价的倍数 multiplier（0.3~5）。",
      JSON.stringify({ hotel: f.name, base_price_per_hour: f.fee, occupants: stays.length, longest_stay_hours: Math.max(0, ...stays), avg_stay_hours: stays.length ? stays.reduce((a, b) => a + b, 0) / stays.length : 0, checkins_last_hour: (ins as any[]).length, checkouts_last_hour: (outs as any[]).length, current_multiplier: r.ai_mult ?? 1 }),
      { type: "object", properties: { multiplier: { type: "number" }, reason: { type: "string" } }, required: ["multiplier", "reason"], additionalProperties: false },
      "hotel_price",
    );
    const mult = Math.min(5, Math.max(0.3, Number(out.multiplier) || 1));
    const rules = { ...r, ai_mult: mult, ai_reason: String(out.reason ?? "").slice(0, 300), ai_at: new Date().toISOString() };
    await db.from("facilities").update({ rules }).eq("id", f.id);
    f.rules = rules;
    return rules;
  } catch (e) {
    if (force) throw e;
    return null;
  }
}

// ---------- AI gateway (Responses API, streamed) ----------
async function aiJson(instructions: string, input: string, schema: object, name: string): Promise<any> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) fail("AI 未配置");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({ model: "openai/gpt-6-astra", instructions, input, stream: true, store: false, reasoning: { effort: "low" }, text: { format: { type: "json_schema", name, strict: true, schema } } }),
  });
  if (!res.ok || !res.body) {
    let m = ""; try { const j: any = await res.json(); m = j?.error?.message || j?.message || ""; } catch { /* */ }
    if (res.status === 429) fail("AI 请求太频繁，请稍后再试");
    if (res.status === 402) fail(m || "AI 额度已用完，请为工作区充值");
    fail(m || `AI 服务错误（${res.status}）`);
  }
  const reader = res.body!.getReader(); const dec = new TextDecoder();
  let buf = "", text = "", refusal = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const d = line.slice(5).trim(); if (!d || d === "[DONE]") continue;
      let ev: any; try { ev = JSON.parse(d); } catch { continue; }
      if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
      else if (ev.type === "response.refusal.delta") refusal += ev.delta ?? "";
      else if (ev.type === "response.failed" || ev.type === "error") fail(ev.response?.error?.message || ev.message || "AI 生成失败");
    }
  }
  if (!text && refusal) fail("AI 拒绝了该请求");
  try { return JSON.parse(text); } catch { fail("AI 返回格式错误"); }
}

// ---------- new features ----------
const realRole = (a: Acc) => (a.real_role ?? a.role) as Role;
Object.assign(authed, {
  // pay password
  async set_pay_pin(me: Acc, { pin, old_pin }: any) {
    if (String(pin ?? "").length < 6) fail("支付密码至少6位");
    if (me.pay_pin_hash && !(await checkHash(me.pay_pin_hash, String(old_pin ?? "")))) fail("原支付密码错误");
    await q(db.from("accounts").update({ pay_pin_hash: await hashPw(String(pin)) }).eq("id", me.id));
    await log(me, "set_pay_pin");
    return { ok: true };
  },
  async pay_reset_link(me: Acc, { id }: any) {
    if (me.role !== "top") fail("仅顶级账号可生成重设链接");
    const token = rnd(24);
    await q(db.from("accounts").update({ pay_reset_token: token }).eq("id", id));
    await log(me, "pay_reset_link", { id });
    return { token };
  },
  // ETC
  async etc_list(me: Acc) {
    if (me.role !== "top" && me.role !== "etc_admin") fail("仅ETC管理账号可用");
    const rows: any[] = await q(db.from("accounts").select("id,username,role,etc_enabled").order("created_at"));
    return me.role === "top" ? rows : rows.filter((r) => r.role !== "top");
  },
  async set_etc(me: Acc, { id, enabled }: any) {
    const t: Acc = await q(db.from("accounts").select("id,username,role").eq("id", id).single());
    const ok = me.role === "top" || (me.role === "etc_admin" && t.role !== "top");
    if (!ok) fail("只有ETC管理账号可以控制ETC开关");
    await q(db.from("accounts").update({ etc_enabled: !!enabled }).eq("id", id));
    await log(me, "set_etc", { target: t.username, enabled: !!enabled });
    return { ok: true };
  },
  // screen admin
  async screen_targets(me: Acc) {
    if (me.role !== "screen_admin" && me.role !== "top") fail("仅投屏管理账号可用");
    const rows: any[] = await q(db.from("accounts").select("id,username,role,banned").order("created_at"));
    return rows.filter((r) => r.role !== "top" && r.role !== "etc_admin");
  },
  async screen_open(me: Acc, { id }: any, ctx: Ctx) {
    const t = await screenTarget(me, id);
    const token = rnd();
    await q(db.from("sessions").insert({ token, account_id: t.id, impersonated_by: me.id, ip: ctx.ip, user_agent: `投屏：${me.username}` }));
    await log(me, "screen_open", { target: t.username });
    return { token, username: t.username, role: t.role };
  },
  async screen_balances(me: Acc, { id }: any) {
    await screenTarget(me, id);
    const curs = await allCur();
    return (await balances(id)).map((b) => ({ ...b, code: curs.find((c) => c.id === b.currency_id)?.code ?? "?" }));
  },
  async screen_delete(me: Acc, { id }: any) {
    const t = await screenTarget(me, id);
    await q(db.from("accounts").delete().eq("id", t.id));
    await log(me, "screen_delete", { target: t.username });
    return { ok: true };
  },
  async screen_transfer(me: Acc, { from_id, to_username, currency_id, amount }: any) {
    const t = await screenTarget(me, from_id);
    const to = await findUser(String(to_username));
    amount = Number(amount);
    if (!(amount > 0)) fail("金额无效");
    const bal = (await balances(t.id)).find((b) => b.currency_id === currency_id)?.amount ?? 0;
    if (amount > bal) fail("对方该货币余额不足");
    await addBal(t.id, currency_id, -amount);
    await addBal(to.id, currency_id, amount);
    await log(me, "screen_transfer", { from: t.username, to: to.username, currency_id, amount });
    return { ok: true };
  },
  // negative-rate currencies (debts)
  async debts(me: Acc) {
    const curs = await allCur();
    return (await balances(me.id)).flatMap((b) => {
      const c = curs.find((x) => x.id === b.currency_id);
      return c && (c.rate_sign ?? 1) < 0 && b.amount > 0 ? [{ currency_id: c.id, code: c.code, amount: b.amount }] : [];
    });
  },
  async settle_debt(me: Acc, { currency_id }: any) {
    const curs = await allCur();
    const c = curs.find((x) => x.id === currency_id) ?? fail("货币不存在");
    if ((c.rate_sign ?? 1) >= 0) fail("该货币不是负债货币");
    const rmb = curs.find((x) => x.code === "RMB" || x.code === "CNY") ?? fail("系统缺少人民币");
    const amt = (await balances(me.id)).find((b) => b.currency_id === c.id)?.amount ?? 0;
    if (!(amt > 0)) fail("没有需要兑换的负债");
    const fee = await feePct(me);
    const rmbDelta = -conv(amt, c.rate_log10, rmb.rate_log10) * (1 + fee / 100);
    await addBal(me.id, c.id, -amt);
    await addBal(me.id, rmb.id, rmbDelta);
    await log(me, "settle_debt", { code: c.code, amount: amt, rmb: rmbDelta, fee });
    return { ok: true };
  },
  // AI shopping assistant
  async ai_recommend(me: Acc, { need, lat, lng }: any, ctx: Ctx) {
    const text = String(need ?? "").trim().slice(0, 1000);
    if (!text) fail("请描述你的需求");
    const prods: any[] = await authed.list_shop(me, { lat, lng }, ctx);
    const avail = prods.filter((p) => p.stock > 0).slice(0, 200);
    if (!avail.length) return { summary: "商店目前没有可购买的商品。", items: [] };
    const out = await aiJson(
      "你是七彩星光支付商店的导购。只能从给定商品目录中推荐（用目录里的 id），最多5个，按匹配度排序，用中文简短说明理由。不要提及汇率。没有合适的就返回空列表并说明。",
      JSON.stringify({ need: text, catalog: avail.map((p) => ({ id: p.id, name: p.name, description: p.description, price: `${p.symbol ?? ""}${p.price}`, seller: p.seller, stock: p.stock })) }),
      { type: "object", properties: { summary: { type: "string" }, items: { type: "array", items: { type: "object", properties: { id: { type: "string" }, reason: { type: "string" } }, required: ["id", "reason"], additionalProperties: false } } }, required: ["summary", "items"], additionalProperties: false },
      "shop_recommendation",
    );
    const items = (out.items ?? []).flatMap((x: any) => { const p = avail.find((y) => y.id === x.id); return p ? [{ ...p, reason: x.reason }] : []; });
    await log(me, "ai_recommend", { need: text, count: items.length });
    return { summary: out.summary, items };
  },
  async ai_price_hotel(me: Acc, { id }: any) {
    if (!["top", "engineer_admin", "engineer"].includes(me.role)) fail("没有权限");
    const f = await q(db.from("facilities").select("*").eq("id", id).single());
    if (f.kind !== "hotel") fail("只有酒店支持AI定价");
    if (me.role === "engineer" && f.engineer_id !== me.id) fail("只能操作自己的酒店");
    return maybeAiPrice(f, true);
  },
  // devices / sessions
  async my_sessions(me: Acc, _a: any, ctx: Ctx) {
    const rows: any[] = await q(db.from("sessions").select("id,token,created_at,last_seen,user_agent,ip,impersonated_by").eq("account_id", me.id).order("last_seen", { ascending: false }));
    return rows.map(({ token, ...r }) => ({ ...r, current: token === ctx.token, impersonated: !!r.impersonated_by }));
  },
  async revoke_session(me: Acc, { id }: any) {
    await q(db.from("sessions").delete().eq("account_id", me.id).eq("id", id));
    await log(me, "revoke_session", { id });
    return { ok: true };
  },
  async revoke_all_sessions(me: Acc, { keep_current }: any, ctx: Ctx) {
    let qb = db.from("sessions").delete().eq("account_id", me.id);
    if (keep_current) qb = qb.neq("token", ctx.token);
    await q(qb);
    await log(me, "revoke_all_sessions", { keep_current: !!keep_current });
    return { ok: true };
  },
});
async function screenTarget(me: Acc, id: string): Promise<Acc> {
  if (me.role !== "screen_admin" && me.role !== "top") fail("仅投屏管理账号可用");
  const t: Acc = await q(db.from("accounts").select("*").eq("id", id).maybeSingle());
  if (!t) fail("账号不存在");
  if (t.role === "top" || t.role === "etc_admin") fail("不能投屏顶级账号和ETC管理账号");
  void realRole;
  return t;
}

export async function handle(op: string, args: any, ctx: Ctx) {
  if (handlers[op]) return handlers[op](args ?? {}, ctx);
  const fn = authed[op] ?? fail(`未知操作 ${op}`);
  const me = await byToken(ctx.token);
  return fn(me, args ?? {}, ctx);
}

/** External payment API: key-authenticated transfer through a payment method. */
export async function apiPay(body: any) {
  const k = await q(db.from("api_keys").select("payment_method_id").eq("key", body.key).maybeSingle());
  if (!k) fail("API key 无效");
  const pm = await q(db.from("payment_methods").select("*").eq("id", k.payment_method_id).single());
  const payer = await findUser(body.from_username);
  if (!(await verifyPw(payer, body.password)) || payer.banned) fail("付款账号验证失败");
  if (payer.pay_pin_hash && !(await checkHash(payer.pay_pin_hash, String(body.pay_pin ?? "")))) fail("支付密码错误");
  const payee = await findUser(body.to_username);
  const cur = await q(db.from("currencies").select("*").eq("code", body.currency_code).maybeSingle());
  if (!cur || !pm.currency_ids.includes(cur.id)) fail("该支付方式不支持此货币");
  const fee = payer.role === "normal" ? pm.fee_normal : await feePct(payer);
  const amount = Number(body.amount);
  if (!(amount > 0)) fail("金额无效");
  const got = await takeMoney(payer.id, cur.id, amount, fee);
  if (!got) fail("余额不足");
  await addBal(payee.id, cur.id, amount);
  await log(payer, "pay", { payment_method_id: pm.id, payment_method: pm.name, api: true, to: payee.username, amount, currency_id: cur.id });
  return { ok: true };
}
export { LOG_CAP };
