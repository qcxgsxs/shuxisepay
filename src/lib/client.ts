import { useServerFn } from "@tanstack/react-start";
import { useCallback } from "react";
import { rpc } from "./api.functions";

// Multi-account ("分身") sessions kept in this browser; one is active at a time.
export type SavedSession = { token: string; username: string; role: string };
const LIST = "qcxg_sessions", ACTIVE = "qcxg_active";
const isBrowser = () => typeof window !== "undefined";
export const listSessions = (): SavedSession[] => { if (!isBrowser()) return []; try { return JSON.parse(localStorage.getItem(LIST) || "[]"); } catch { return []; } };
const saveList = (l: SavedSession[]) => localStorage.setItem(LIST, JSON.stringify(l));
export const getToken = () => (isBrowser() ? localStorage.getItem(ACTIVE) ?? undefined : undefined);
export const switchSession = (token: string) => localStorage.setItem(ACTIVE, token);
export function addSession(s: SavedSession) { saveList([...listSessions().filter((x) => x.token !== s.token), s]); switchSession(s.token); }
export function removeSession(token?: string) {
  const l = listSessions().filter((x) => x.token !== token); saveList(l);
  if (l[0]) switchSession(l[0].token); else localStorage.removeItem(ACTIVE);
  return l[0];
}

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
