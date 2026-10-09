import { useQuery } from "@tanstack/react-query";
import type { CSSProperties, ReactNode } from "react";
import { useApi } from "@/lib/client";

export type Theme = { hue?: number; layout?: "board" | "list"; nav?: "side" | "top"; radius?: number; panelOpacity?: number };
export type Config = { texts: Record<string, string>; signup: { roles: string[]; monthly_limit: number }; wallpapers: Record<string, { url?: string; opacity?: number }>; icon: { url?: string; opacity?: number }; theme: Theme };

export function useConfig() {
  const api = useApi();
  return useQuery<Config>({ queryKey: ["config"], queryFn: () => api("config"), staleTime: 30_000 });
}

/** Themed page wrapper with a per-menu wallpaper controlled by the top account. */
export function useText() {
  const { data } = useConfig();
  return (key: string, def: string) => (data?.texts?.[key]?.trim() ? data.texts[key] : def);
}

export function Themed({ menu, children, className = "", override }: { menu: string; children: ReactNode; className?: string; override?: Theme | null }) {
  const { data } = useConfig();
  const th = { ...(data?.theme ?? {}), ...(override ?? {}) };
  const wp = data?.wallpapers?.[menu];
  const style = { "--hue": String(th.hue ?? 30), "--radius": `${th.radius ?? 0.9}rem`, "--panel-alpha": `${Math.round((th.panelOpacity ?? 1) * 100)}%` } as CSSProperties;
  return (
    <div style={style} className={`relative min-h-screen board-bg text-foreground ${className}`}>
      {wp?.url && (
        <img src={wp.url} alt="" aria-hidden className="pointer-events-none fixed inset-0 h-full w-full object-cover" style={{ opacity: wp.opacity ?? 1 }} />
      )}
      <div className="relative">{children}</div>
    </div>
  );
}

export function AppIcon({ size = 48 }: { size?: number }) {
  const { data } = useConfig();
  const ic = data?.icon;
  return (
    <div className="grid place-items-center overflow-hidden rounded-xl border-2 border-ink bg-card" style={{ width: size, height: size }}>
      {ic?.url ? <img src={ic.url} alt="应用图标" className="h-full w-full object-cover" style={{ opacity: ic.opacity ?? 1 }} /> : null}
    </div>
  );
}
