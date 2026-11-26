/**
 * Utilitas tanggal untuk zona Asia/Jakarta (WIB, UTC+7, tanpa DST).
 * Semua tanggal disimpan sebagai UTC di database; batas hari/bulan dihitung di WIB.
 */
export const APP_TIMEZONE = "Asia/Jakarta";
const OFFSET_MS = 7 * 60 * 60 * 1000;

const dateFmt = new Intl.DateTimeFormat("id-ID", { timeZone: APP_TIMEZONE, day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("id-ID", {
  timeZone: APP_TIMEZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const monthFmt = new Intl.DateTimeFormat("id-ID", { timeZone: APP_TIMEZONE, month: "long", year: "numeric" });

export function formatDate(d: Date): string {
  return dateFmt.format(d);
}
export function formatDateTime(d: Date): string {
  return dateTimeFmt.format(d);
}

/** Komponen tanggal (tahun, bulan 1-12, hari) menurut WIB. */
export function jakartaParts(d: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const shifted = new Date(d.getTime() + OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** Instant UTC untuk pukul 00:00 WIB pada tanggal tertentu (bulan 1-12). */
export function jakartaMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - OFFSET_MS);
}

export type MonthKey = `${number}-${string}`;

export function monthKey(d: Date): string {
  const p = jakartaParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

export function parseMonthKey(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** Rentang [start, end) bulan dalam WIB. */
export function monthRange(year: number, month: number): { start: Date; end: Date } {
  const start = jakartaMidnight(year, month, 1);
  const end = month === 12 ? jakartaMidnight(year + 1, 1, 1) : jakartaMidnight(year, month + 1, 1);
  return { start, end };
}

export function currentMonthRange(now = new Date()) {
  const p = jakartaParts(now);
  return { ...monthRange(p.year, p.month), year: p.year, month: p.month };
}

export function previousMonth(year: number, month: number) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function formatMonth(year: number, month: number): string {
  return monthFmt.format(jakartaMidnight(year, month, 15));
}

/** "YYYY-MM-DD" (tanggal WIB) -> instant awal hari WIB. */
export function parseDateInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return jakartaMidnight(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** "YYYY-MM-DDTHH:mm" (waktu WIB dari <input type=datetime-local>) -> instant UTC. */
export function parseDateTimeInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return parseDateInput(value);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) - OFFSET_MS);
}

export function toDateInput(d: Date): string {
  const p = jakartaParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function toDateTimeInput(d: Date): string {
  const p = jakartaParts(d);
  return `${toDateInput(d)}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000);
}
