/** Batang progres untuk anggaran/cicilan. */
export function ProgressBar({ ratio, tone }: { ratio: number; tone?: "ok" | "warn" | "over" | "neutral" }) {
  const t = tone ?? (ratio >= 1 ? "over" : ratio >= 0.8 ? "warn" : "ok");
  const color = { ok: "bg-emerald-500", warn: "bg-amber-500", over: "bg-red-500", neutral: "bg-slate-400" }[t];
  const pct = Math.max(0, Math.min(100, ratio * 100));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct > 0 ? Math.max(pct, 2) : 0}%` }} />
    </div>
  );
}
