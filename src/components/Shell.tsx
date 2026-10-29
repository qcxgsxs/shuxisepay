import { useQuery } from "@tanstack/react-query";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { useApi } from "@/lib/client";

export type Theme = { hue?: number; layout?: "board" | "list"; nav?: "side" | "top"; radius?: number; panelOpacity?: number; textColor?: string; textOpacity?: number };
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
  const ta = Math.round((th.textOpacity ?? 1) * 100);
  const txt = (base: string) => `color-mix(in oklch, ${th.textColor || base} ${ta}%, transparent)`;
  const style = {
    "--hue": String(th.hue ?? 30), "--radius": `${th.radius ?? 0.9}rem`, "--panel-alpha": `${Math.round((th.panelOpacity ?? 1) * 100)}%`,
    ...(th.textColor || ta < 100 ? { "--foreground": txt("oklch(0.22 0.03 calc(var(--hue) + 250))"), "--ink": txt("oklch(0.2 0.03 calc(var(--hue) + 250))"), "--muted-foreground": txt("oklch(0.45 0.03 calc(var(--hue) + 250))") } : {}),
  } as CSSProperties;
  const icon = data?.icon?.url;
  useEffect(() => {
    if (!icon) return;
    let l = document.querySelector<HTMLLinkElement>("link#app-favicon");
    if (!l) { l = document.createElement("link"); l.id = "app-favicon"; l.rel = "icon"; document.head.appendChild(l); }
    document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]:not(#app-favicon)').forEach((x) => x.remove());
    l.href = icon;
  }, [icon]);
  return (
    <div style={style} className={`relative min-h-screen ${wp?.url ? "" : "board-bg"} text-foreground ${className}`}>
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
