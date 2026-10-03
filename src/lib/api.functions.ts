import { createServerFn } from "@tanstack/react-start";
import { handle } from "./api.server";

export const rpc = createServerFn({ method: "POST" })
  .inputValidator((d: { op: string; args?: unknown; token?: string }) => d)
  .handler(async ({ data }) => {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const ip = (getRequestHeader("cf-connecting-ip") || getRequestHeader("x-forwarded-for") || "unknown").split(",")[0].trim();
    try {
      return { ok: true as const, data: JSON.parse(JSON.stringify((await handle(data.op, data.args, { token: data.token, ip })) ?? null)) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });
