import type { NextRequest } from "next/server";
import { toDateInput } from "@/lib/dates";
import { getApiContext } from "@/server/auth/current";
import { csvResponse, jsonError, unauthorized } from "@/server/http";
import { exportTransactionsCsv } from "@/server/services/export";

export async function GET(req: NextRequest) {
  const ctx = await getApiContext();
  if (!ctx) return unauthorized();
  try {
    const filter = Object.fromEntries(req.nextUrl.searchParams.entries());
    const csv = await exportTransactionsCsv(ctx, filter);
    return csvResponse(csv, `transaksi-${toDateInput(new Date())}.csv`);
  } catch (err) {
    return jsonError(err);
  }
}
