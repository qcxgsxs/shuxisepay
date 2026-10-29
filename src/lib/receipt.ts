export function receiptAccount(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("不是有效的收款码");
  const match = url.pathname.match(/^\/receive\/([0-9a-f-]{36})$/i);
  if (!match || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(match[1])) throw new Error("不是七彩星光支付收款码");
  return match[1];
}

export function receiptAmount(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("付款金额必须是大于0的有限数字");
  return amount;
}