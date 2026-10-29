import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
import { applyCard } from "@/lib/api.server";

describe("优待卡", () => {
  it("每次5折", () => expect(applyCard({ mode: "pct", pct: 50 }, 10, 60, true).amount).toBe(5));
  it("比原价还贵", () => expect(applyCard({ mode: "pct", pct: 200 }, 10, 60, true).amount).toBe(20));
  it("每次25元", () => expect(applyCard({ mode: "fixed", amount: 25 }, 10, 60, true).amount).toBe(25));
  it("1分钟2元", () => expect(applyCard({ mode: "per_min", per_min: 2 }, 10, 120, false).amount).toBe(4));
  it("一直免费", () => expect(applyCard({ mode: "free" }, 10, 60, true).amount).toBe(0));
  it("免费5次然后5折", () => {
    expect(applyCard({ mode: "free_then_pct", free_count: 5, pct: 50, used: 4 }, 10, 60, true)).toMatchObject({ amount: 0, used: 5 });
    expect(applyCard({ mode: "free_then_pct", free_count: 5, pct: 50, used: 5 }, 10, 60, true).amount).toBe(5);
  });
});
