import type { ReactNode } from "react";

/** Angka ringkas dengan label kecil (ringkasan anggaran, investasi, dll). */
export function Stat({ label, value, hint, large = true }: { label: string; value: ReactNode; hint?: string; large?: boolean }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={large ? "text-lg font-semibold" : "font-semibold"}>{value}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
