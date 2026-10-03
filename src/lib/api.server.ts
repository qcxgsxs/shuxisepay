import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { CAN_REGISTER, DEFAULT_PERMS, MANAGES, ROLES, USERNAME_RE, FACILITY_KINDS, type Role } from "./roles";
import { evalRateLog10, LOG_CAP, type OperatorDef } from "./expr";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;
type Acc = { id: string; username: string; password: string; role: Role; banned: boolean; permissions: Record<string, unknown> };
type Cur = { id: string; code: string; name: string; symbol: string; rate_expr: string; rate_log10: number; visibility: Record<string, string> };

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
  const bals = (await balances(accId)).filter((b) => b.amount > 0 && byId.has(b.currency_id));
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
  const s = await q(db.from("sessions").select("account_id").eq("token", token).maybeSingle());
  if (!s) fail("登录已失效，请重新登录");
  const a: Acc = await q(db.from("accounts").select("*").eq("id", s.account_id).maybeSingle());
  if (!a) fail("账号不存在");
  if (a.banned) fail("账号已被封禁");
  return a;
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
  const a = await q(db.from("accounts").insert({ username, password, role, created_by: creator?.id ?? null }).select().single());
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
type Ctx = { token?: string; ip: string };
const handlers: Record<string, (args: any, ctx: Ctx) => Promise<any>> = {
  async config() {
    const [wallpapers, icon, theme] = await Promise.all([getSetting("wallpapers", {}), getSetting("icon", {}), getSetting("theme", {})]);
    return { wallpapers, icon, theme };
  },
  async login({ role, username, password }) {
    const a = await q(db.from("accounts").select("*").eq("username", String(username).trim()).maybeSingle());
    if (!a || a.password !== password) fail("用户名或密码错误");
    if (a.role !== role) fail("该账号不属于此登录窗口");
    if (a.banned) fail("账号已被封禁");
    const token = rnd();
    await q(db.from("sessions").insert({ token, account_id: a.id }));
    await log(a, "login");
    return { token };
  },
  async signup_normal({ username, password }, ctx) {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const recent = await q(db.from("logs").select("id").eq("action", "signup_normal").gte("created_at", since).contains("detail", { ip: ctx.ip }));
    if (recent.length > 0) fail("此注册入口每个月只能注册一个普通账号");
    const r = await createAccount(null, username, password, "normal");
    await log({ id: r.id, username, role: "normal" }, "signup_normal", { ip: ctx.ip });
    return handlers.login({ role: "normal", username, password }, ctx);
  },
  async reset_info({ token }) {
    const a = await q(db.from("accounts").select("username,role").eq("reset_token", token).maybeSingle());
    return a ?? fail("重设链接无效或已使用");
  },
  async reset_do({ token, password }) {
    const a = await q(db.from("accounts").select("*").eq("reset_token", token).maybeSingle());
    if (!a) fail("重设链接无效或已使用");
    if (a.role === "top" ? password.length <= 20 : password.length <= 6) fail("密码长度不足");
    await q(db.from("accounts").update({ password, reset_token: null }).eq("id", a.id));
    await db.from("sessions").delete().eq("account_id", a.id);
    await log(a, "reset_password");
    return { ok: true };
  },
};

const authed: Record<string, (me: Acc, args: any, ctx: Ctx) => Promise<any>> = {
  async me(me) {
    return { id: me.id, username: me.username, role: me.role, perms: await perms(me), canRegister: CAN_REGISTER[me.role] };
  },
  async logout(_me, _a, ctx) { await db.from("sessions").delete().eq("token", ctx.token); return { ok: true }; },

  // ----- accounts -----
  async list_accounts(me) {
    const rows: any[] = await q(db.from("accounts").select("id,username,password,role,banned,permissions,created_at").order("created_at"));
    const vis = me.role === "top" ? rows : rows.filter((r) => CAN_REGISTER[me.role].includes(r.role));
    return vis.map((r) => (me.role === "top" ? r : { ...r, password: undefined }));
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
    if (t.role === "top" ? password.length <= 20 : password.length <= 6) fail("密码长度不足");
    await q(db.from("accounts").update({ password }).eq("id", id));
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
    const topKeys = ["wallpapers", "icon", "theme", "role_perms"];
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
    const { log10, estimated } = evalRateLog10(String(rate_expr), ops);
    const row = { code: String(code).trim(), name, symbol, rate_expr, rate_log10: log10 };
    if (id) await q(db.from("currencies").update(row).eq("id", id));
    else await q(db.from("currencies").insert(row));
    await log(me, "save_currency", { code, rate_expr, estimated });
    return { estimated, log10 };
  },
  async preview_rate(_me, { rate_expr }) {
    const ops = await getSetting<OperatorDef[]>("operators", []);
    return evalRateLog10(String(rate_expr), ops);
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
  async buy(me, { product_id, payment_method_id, qty = 1, lat, lng }) {
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
    if (me.role !== "engineer" && me.role !== "top") fail("仅工程师可建设");
    if (!(f.kind in FACILITY_KINDS)) fail("类型无效");
    await need(me, `build_${f.kind}`);
    const pm = await perms(me);
    if (me.role !== "top" && Number(f.fee) > Number(pm.max_fee ?? 0)) fail(`收费不能超过最高标准 ${pm.max_fee}`);
    const row = { engineer_id: me.id, kind: f.kind, name: f.name, lat: f.lat ?? null, lng: f.lng ?? null, radius_m: Number(f.radius_m ?? 50), fee: Number(f.fee ?? 0), currency_id: f.currency_id || null, ip: f.ip || null };
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
    const facs: any[] = await q(db.from("facilities").select("*"));
    const pres: any[] = await q(db.from("presence").select("*").eq("account_id", me.id));
    const now = Date.now();
    const events: string[] = [];
    const charge = async (f: any, amount: number, reason: string) => {
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
      else if ((f.kind === "toll" || f.kind === "parking") && lat != null && f.lat != null) inside = dist([lat, lng], [f.lat, f.lng]) <= f.radius_m;
      else continue;
      if (inside && !p) {
        await q(db.from("presence").insert({ account_id: me.id, facility_id: f.id }));
        if (f.kind === "toll") await charge(f, f.fee, "通过收费站自动扣费");
        else events.push(`${f.name}：开始计费`);
      } else if (inside && p && f.kind !== "toll") {
        const secs = (now - new Date(p.last_charged).getTime()) / 1000;
        const amount = f.kind === "parking" ? (f.fee * secs) / 60 : f.fee * secs; // parking per minute, IP per second
        await charge(f, amount, f.kind === "parking" ? "停车计费" : "IP计费");
        await q(db.from("presence").update({ last_charged: new Date(now).toISOString() }).eq("account_id", me.id).eq("facility_id", f.id));
      } else if (!inside && p) {
        if (f.kind === "parking") {
          const secs = (now - new Date(p.last_charged).getTime()) / 1000;
          await charge(f, (f.fee * secs) / 60, "离开停车场，停止计费");
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
  if (payer.password !== body.password || payer.banned) fail("付款账号验证失败");
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
