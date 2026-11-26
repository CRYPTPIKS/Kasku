/**
 * Pembuat CSV sederhana (RFC 4180) dengan pemisah ";" agar langsung terbuka
 * rapi di Excel berlocale Indonesia. Termasuk BOM UTF-8.
 */
export type CsvValue = string | number | boolean | null | undefined | Date;

function escapeCell(v: CsvValue, sep: string): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  // Cegah CSV/formula injection di spreadsheet.
  if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = `'${s}`;
  if (s.includes(sep) || s.includes('"') || s.includes("\n") || s.includes("\r")) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: CsvValue[][], sep = ";"): string {
  const lines = [headers, ...rows].map((r) => r.map((c) => escapeCell(c, sep)).join(sep));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Angka untuk CSV: format Indonesia tanpa pemisah ribuan (koma desimal). */
export function csvNumber(n: number | string | { toString(): string } | null | undefined): string {
  if (n === null || n === undefined) return "";
  return Number(n.toString()).toFixed(2).replace(".", ",").replace(/,00$/, "");
}
