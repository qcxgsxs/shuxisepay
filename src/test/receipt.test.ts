import { describe, expect, it } from "vitest";
import { receiptAccount, receiptAmount } from "@/lib/receipt";

describe("收款码", () => {
  it("扫码只选择收款账号，不携带付款权限", () => {
    expect(receiptAccount("https://shuxisepay.lovable.app/receive/12345678-1234-1234-1234-123456789abc")).toBe("12345678-1234-1234-1234-123456789abc");
  });
  it.each(["https://example.com/", "javascript:alert(1)", "https://example.com/receive/not-an-account"])("拒绝非收款码 %s", (value) => expect(() => receiptAccount(value)).toThrow());
  it.each([0, -1, Infinity, NaN, "Infinity"])("拒绝无效付款金额 %s", (value) => expect(() => receiptAmount(value)).toThrow());
  it("接受正数付款金额", () => expect(receiptAmount("25")).toBe(25));
});