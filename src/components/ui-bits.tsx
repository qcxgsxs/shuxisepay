import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { fileToBase64, useApi } from "@/lib/client";

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card-hard mb-4 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xl">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function useAction() {
  const api = useApi();
  return async <T,>(op: string, args?: unknown, ok?: string): Promise<T | undefined> => {
    try {
      const r = await api<T>(op, args);
      if (ok) toast.success(ok);
      return r;
    } catch (e) {
      toast.error((e as Error).message);
      return undefined;
    }
  };
}

export function UploadButton({ accept, label, onDone }: { accept: string; label: string; onDone: (url: string) => void }) {
  const act = useAction();
  const [busy, setBusy] = useState(false);
  return (
    <label className="btn btn-ghost cursor-pointer">
      {busy ? "上传中…" : label}
      <input type="file" accept={accept} className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setBusy(true);
        const r = await act<{ url: string }>("upload", { name: f.name, type: f.type, base64: await fileToBase64(f) });
        setBusy(false);
        e.target.value = "";
        if (r) onDone(r.url);
      }} />
    </label>
  );
}
