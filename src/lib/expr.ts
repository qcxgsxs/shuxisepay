// Evaluate exchange-rate expressions in log10 space so huge values stay usable.
// Supported: numbers, + - * / ^ ( ), plus custom operators (tetration / iterated etc.)
export type OperatorDef = { symbol: string; kind: "tetration" | "iterated" | "power" | "multiply" };

export const LOG_CAP = 1e300; // estimate ceiling for log10 values

const log10 = Math.log10;
const addL = (a: number, b: number) => {
  const m = Math.max(a, b), n = Math.min(a, b);
  if (!isFinite(m)) return m;
  return m + log10(1 + Math.pow(10, n - m));
};
const subL = (a: number, b: number) => {
  if (b >= a) throw new Error("结果必须为正数");
  return a + log10(1 - Math.pow(10, b - a));
};
const toNum = (L: number) => Math.pow(10, L);
const powL = (La: number, Lb: number) => toNum(Lb) * La;
function tetL(La: number, height: number) {
  if (height < 1) return 0;
  let L = La;
  const h = Math.min(height, 1e6);
  for (let i = 1; i < h; i++) {
    L = powL(La, L);
    if (!isFinite(L) || L > LOG_CAP) return Infinity;
  }
  return L;
}
function iterL(La: number, count: number) {
  let L = La;
  const c = Math.min(count, 1e6);
  for (let i = 1; i < c; i++) {
    L = tetL(La, toNum(L));
    if (!isFinite(L) || L > LOG_CAP) return Infinity;
  }
  return L;
}

export function evalRateLog10(expr: string, ops: OperatorDef[] = []): { log10: number; estimated: boolean } {
  const custom = new Map(ops.map((o) => [o.symbol, o.kind]));
  const tokens: string[] = [];
  const s = expr.replace(/\s+/g, "");
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    const m = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?/i.exec(s.slice(i));
    if (m && m[0]) { tokens.push(m[0]); i += m[0].length; continue; }
    const sym = [...custom.keys()].sort((a, b) => b.length - a.length).find((k) => s.startsWith(k, i));
    if (sym) { tokens.push(sym); i += sym.length; continue; }
    if ("+-*/^()".includes(ch)) { tokens.push(ch); i++; continue; }
    throw new Error(`无法识别的符号：${ch}`);
  }
  let p = 0;
  const peek = () => tokens[p];
  const prec = (t: string) => (t === "+" || t === "-" ? 1 : t === "*" || t === "/" ? 2 : t === "^" || custom.has(t) ? 3 : 0);
  function primary(): number {
    const t = tokens[p++];
    if (t === "(") { const v = expr0(0); if (tokens[p++] !== ")") throw new Error("括号不匹配"); return v; }
    if (t === undefined) throw new Error("表达式不完整");
    const n = Number(t);
    if (isNaN(n) || n <= 0) throw new Error("数值必须为正数");
    return log10(n);
  }
  function apply(op: string, a: number, b: number) {
    if (op === "+") return addL(a, b);
    if (op === "-") return subL(a, b);
    if (op === "*") return a + b;
    if (op === "/") return a - b;
    if (op === "^") return powL(a, b);
    const k = custom.get(op);
    if (k === "tetration") return tetL(a, Math.floor(toNum(b)));
    if (k === "iterated") return iterL(a, Math.floor(toNum(b)));
    if (k === "power") return powL(a, b);
    if (k === "multiply") return a + b;
    throw new Error(`未知运算符 ${op}`);
  }
  function expr0(min: number): number {
    let lhs = primary();
    while (peek() && prec(peek()) >= min && prec(peek()) > 0) {
      const op = tokens[p++];
      const pr = prec(op);
      const right = pr === 3;
      const rhs = expr0(right ? pr : pr + 1);
      lhs = apply(op, lhs, rhs);
    }
    return lhs;
  }
  const v = expr0(0);
  if (p < tokens.length) throw new Error("表达式有多余内容");
  if (!isFinite(v) || v > LOG_CAP) return { log10: LOG_CAP, estimated: true };
  return { log10: v, estimated: false };
}

export function fmtLog10(L: number) {
  if (L < 15) return Number(Math.pow(10, L).toPrecision(8)).toLocaleString();
  if (L < 1e15) { const e = Math.floor(L); return `${Math.pow(10, L - e).toFixed(4)}×10^${e.toLocaleString()}`; }
  return `10^(${L.toExponential(4)})`;
}
export function fmtAmount(n: number) {
  if (!isFinite(n)) return "∞";
  if (Math.abs(n) < 1e15) return Number(n.toFixed(4)).toLocaleString();
  return n.toExponential(4);
}
