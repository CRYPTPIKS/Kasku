import type { NextRequest } from "next/server";
import { csvNumber, toCsv } from "@/lib/csv";
import { getApiContext } from "@/server/auth/current";
import { csvResponse, jsonError, unauthorized } from "@/server/http";
import { resolveReportRange } from "@/server/services/report-range";
import { totalsByCategory } from "@/server/services/reports";

export async function GET(req: NextRequest) {
  const ctx = await getApiContext();
  if (!ctx) return unauthorized();
  try {
    const range = resolveReportRange(Object.fromEntries(req.nextUrl.searchParams.entries()));
    const [income, expense] = await Promise.all([
      totalsByCategory(ctx, "income", range.start, range.end),
      totalsByCategory(ctx, "expense", range.start, range.end),
    ]);
    const rows = [
      ...income.map((r) => ["Pemasukan", r.name, csvNumber(r.total), r.count]),
      ...expense.map((r) => ["Pengeluaran", r.name, csvNumber(r.total), r.count]),
    ];
    return csvResponse(toCsv(["Jenis", "Kategori", "Total", "Jumlah transaksi"], rows), `kategori-${range.fromInput}_${range.toInput}.csv`);
  } catch (err) {
    return jsonError(err);
  }
}
