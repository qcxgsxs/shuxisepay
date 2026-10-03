export const ROLES = ["top", "bank_admin", "bank", "engineer_admin", "engineer", "seller_admin", "seller", "pay_admin", "normal"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  top: "顶级账号",
  bank_admin: "银行管理账号",
  bank: "银行账号",
  engineer_admin: "工程师管理账号",
  engineer: "工程师账号",
  seller_admin: "卖家管理账号",
  seller: "卖家账号",
  pay_admin: "支付方式管理账号",
  normal: "普通账号",
};

export const CAN_REGISTER: Record<Role, Role[]> = {
  top: [...ROLES],
  bank_admin: ["bank", "engineer_admin", "engineer", "seller_admin", "seller", "pay_admin", "normal"],
  bank: ["engineer", "seller", "normal"],
  engineer_admin: ["engineer", "seller", "normal"],
  engineer: ["seller", "normal"],
  seller_admin: ["engineer", "seller", "normal"],
  seller: ["normal"],
  pay_admin: ["normal"],
  normal: [],
};

// Which admin manages which role's per-account permissions & currency visibility
export const MANAGES: Partial<Record<Role, Role>> = { bank_admin: "bank", engineer_admin: "engineer", seller_admin: "seller" };

export const FACILITY_KINDS = {
  house: "房子", bridge: "桥", road: "路", toll: "收费站", hotel: "酒店", parking: "停车场", scenic: "景区", park: "公园", ip: "IP计费",
} as const;
export type FacilityKind = keyof typeof FACILITY_KINDS;

export type PermDef = { key: string; label: string; type: "bool" | "number" };
export const PERM_DEFS: Record<Role, PermDef[]> = {
  top: [],
  bank_admin: [
    { key: "register", label: "可注册账号", type: "bool" },
    { key: "export_logs", label: "可导出日志", type: "bool" },
    { key: "currency_admin", label: "可管理货币", type: "bool" },
  ],
  bank: [
    { key: "register", label: "可注册账号", type: "bool" },
    { key: "give_money", label: "可给账号转钱", type: "bool" },
    { key: "auto_deduct", label: "可自动扣其他账号的款", type: "bool" },
    { key: "exchange", label: "可兑换货币", type: "bool" },
  ],
  engineer_admin: [
    { key: "register", label: "可注册账号", type: "bool" },
    { key: "export_logs", label: "可导出日志", type: "bool" },
  ],
  engineer: [
    { key: "register", label: "可注册账号", type: "bool" },
    ...Object.entries(FACILITY_KINDS).map(([k, v]) => ({ key: `build_${k}`, label: `可设置${v}`, type: "bool" as const })),
    { key: "max_fee", label: "最高扣费标准", type: "number" },
  ],
  seller_admin: [
    { key: "register", label: "可注册账号", type: "bool" },
    { key: "export_logs", label: "可导出日志", type: "bool" },
  ],
  seller: [
    { key: "register", label: "可注册账号", type: "bool" },
    { key: "can_sell", label: "卖家权限（可上架）", type: "bool" },
    { key: "price_min", label: "最低定价（厦门元）", type: "number" },
    { key: "price_max", label: "最高定价（厦门元）", type: "number" },
    { key: "require_media", label: "必须上传图片和视频", type: "bool" },
  ],
  pay_admin: [
    { key: "register", label: "可注册账号", type: "bool" },
    { key: "export_logs", label: "可导出日志", type: "bool" },
  ],
  normal: [
    { key: "shop", label: "可进入商店", type: "bool" },
    { key: "chat", label: "可聊天", type: "bool" },
  ],
};

export const DEFAULT_PERMS: Record<Role, Record<string, unknown>> = {
  top: {},
  bank_admin: { register: true, export_logs: true, currency_admin: true },
  bank: { register: true, give_money: true, auto_deduct: true, exchange: true },
  engineer_admin: { register: true, export_logs: true },
  engineer: {
    register: true, max_fee: 100,
    ...Object.fromEntries(Object.keys(FACILITY_KINDS).map((k) => [`build_${k}`, true])),
  },
  seller_admin: { register: true, export_logs: true },
  seller: { register: true, can_sell: true, price_min: 0, price_max: 100, require_media: true },
  pay_admin: { register: true, export_logs: true },
  normal: { shop: true, chat: true },
};

export const USERNAME_RE = /^[\p{L}\p{N}\-/：:；;—@“”"…～~、？?！!.，,&*￥#£€฿¢_ ]{1,40}$/u;
