import { addDays, currentMonthRange, jakartaParts, monthRange, parseDateInput, toDateInput } from "@/lib/dates";

/** Rentang laporan dari query (?from=YYYY-MM-DD&to=YYYY-MM-DD). Default: 6 bulan terakhir. */
export function resolveReportRange(sp: { from?: string; to?: string }, now = new Date()) {
  const cur = currentMonthRange(now);
  let start = sp.from ? parseDateInput(sp.from) : null;
  let endInclusive = sp.to ? parseDateInput(sp.to) : null;
  if (!start) {
    let y = cur.year;
    let m = cur.month - 5;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    start = monthRange(y, m).start;
  }
  if (!endInclusive) endInclusive = addDays(cur.end, -1);
  if (endInclusive < start) [start, endInclusive] = [endInclusive, start];
  const end = addDays(endInclusive, 1);
  // Batasi maksimal 10 tahun.
  const maxStart = new Date(end.getTime() - 3653 * 86400000);
  if (start < maxStart) start = maxStart;
  return { start, end, fromInput: toDateInput(start), toInput: toDateInput(endInclusive), parts: jakartaParts(start) };
}
