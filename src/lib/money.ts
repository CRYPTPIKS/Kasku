/**
 * Utilitas format Rupiah (IDR) dengan format angka Indonesia.
 * Contoh: 75000 -> "Rp75.000", -1500000.5 -> "-Rp1.500.000,50".
 */
const numberFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const compactFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

export type Numeric = number | string | { toString(): string };

export function toNumber(value: Numeric | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : 0;
}

export function formatRupiah(value: Numeric | null | undefined, opts: { signed?: boolean } = {}): string {
  const n = toNumber(value);
  const abs = numberFmt.format(Math.abs(n));
  if (n < 0) return `-Rp${abs}`;
  if (opts.signed && n > 0) return `+Rp${abs}`;
  return `Rp${abs}`;
}

/** Format ringkas untuk grafik: 1.500.000 -> "1,5 jt". */
export function formatRupiahCompact(value: Numeric): string {
  const n = toNumber(value);
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${compactFmt.format(abs / 1e12)} T`;
  if (abs >= 1e9) return `${sign}${compactFmt.format(abs / 1e9)} M`;
  if (abs >= 1e6) return `${sign}${compactFmt.format(abs / 1e6)} jt`;
  if (abs >= 1e3) return `${sign}${compactFmt.format(abs / 1e3)} rb`;
  return `${sign}${compactFmt.format(abs)}`;
}

export function formatNumber(value: Numeric, maxFractionDigits = 2): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: maxFractionDigits }).format(toNumber(value));
}

export function formatPercent(ratio: number): string {
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(ratio * 100)}%`;
}
