import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({
  key: z.string().min(10).max(100),
  from_username: z.string().min(1).max(40),
  password: z.string().min(1).max(200),
  to_username: z.string().min(1).max(40),
  currency_code: z.string().min(1).max(20),
  amount: z.number().positive(),
});

export const Route = createFileRoute("/api/public/pay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = schema.parse(await request.json());
          const { apiPay } = await import("@/lib/api.server");
          return Response.json(await apiPay(body));
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 400 });
        }
      },
    },
  },
});
