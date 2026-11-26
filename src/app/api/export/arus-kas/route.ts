import type { NextRequest } from "next/server";
import { getApiContext } from "@/server/auth/current";
import { csvResponse, jsonError, unauthorized } from "@/server/http";
import { cashFlowCsv } from "@/server/services/export";
import { resolveReportRange } from "@/server/services/report-range";
import { monthlyCashFlow } from "@/server/services/reports";

export async function GET(req: NextRequest) {
  const ctx = await getApiContext();
  if (!ctx) return unauthorized();
  try {
    const range = resolveReportRange(Object.fromEntries(req.nextUrl.searchParams.entries()));
    const rows = await monthlyCashFlow(ctx, range.start, range.end);
    return csvResponse(cashFlowCsv(rows), `arus-kas-${range.fromInput}_${range.toInput}.csv`);
  } catch (err) {
    return jsonError(err);
  }
}
