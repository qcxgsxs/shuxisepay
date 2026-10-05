import { useServerFn } from "@tanstack/react-start";
import { useCallback } from "react";
import { rpc } from "./api.functions";

const KEY = "qcxg_token";
export const getToken = () => (typeof window === "undefined" ? undefined : localStorage.getItem(KEY) ?? undefined);
export const setToken = (t: string | null) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

export function useApi() {
  const fn = useServerFn(rpc);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useCallback(async <T = any>(op: string, args?: unknown): Promise<T> => {
    const r = await fn({ data: { op, args, token: getToken() } });
    if (!r.ok) throw new Error(r.error);
    return r.data as T;
  }, [fn]);
}

export function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) rows = [{ 提示: "无日志" }];
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(typeof v === "object" && v !== null ? JSON.stringify(v) : v ?? "").replace(/"/g, '""')}"`;
  const csv = "\ufeff" + [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name;
  a.click();
}

export async function fileToBase64(f: File) {
  const buf = new Uint8Array(await f.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
