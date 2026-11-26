import { NextResponse, type NextRequest } from "next/server";
import { getApiContext } from "@/server/auth/current";
import { jsonError, unauthorized } from "@/server/http";
import { getReceiptForViewer } from "@/server/receipts/service";

/**
 * GET /api/receipts/:id/image — foto struk untuk pengguna yang sudah masuk.
 * Foto tidak pernah punya URL publik permanen: selalu lewat sesi + cek household,
 * dan tidak boleh di-cache oleh proxy/browser bersama.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getApiContext();
  if (!ctx) return unauthorized();
  try {
    const { id } = await params;
    const { receipt, data } = await getReceiptForViewer(ctx, id);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": receipt.mimeType,
        "Content-Length": String(data.length),
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
