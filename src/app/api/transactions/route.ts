import { NextResponse, type NextRequest } from "next/server";
import { getApiContext } from "@/server/auth/current";
import { jsonError, unauthorized } from "@/server/http";
import { createTransaction, listTransactions } from "@/server/services/transactions";

/** GET /api/transactions?from=&to=&q=&page= — daftar transaksi (JSON). */
export async function GET(req: NextRequest) {
  const ctx = await getApiContext();
  if (!ctx) return unauthorized();
  try {
    const result = await listTransactions(ctx, Object.fromEntries(req.nextUrl.searchParams.entries()));
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err);
  }
}

/** POST /api/transactions — buat transaksi. Body: TransactionInput (JSON). */
export async function POST(req: NextRequest) {
  const ctx = await getApiContext();
  if (!ctx) return unauthorized();
  try {
    const body = await req.json().catch(() => {
      throw Object.assign(new Error("Body harus JSON"), { name: "BadJson" });
    });
    const t = await createTransaction(ctx, body);
    return NextResponse.json(t, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.name === "BadJson") {
      return NextResponse.json({ error: { message: "Body harus berupa JSON.", code: "validation" } }, { status: 400 });
    }
    return jsonError(err);
  }
}
