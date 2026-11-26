"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseAmount } from "@/lib/parsing/amount";
import { requireUser } from "@/server/auth/current";
import { runAction, type ActionState } from "@/server/action-result";
import { AppError } from "@/server/errors";
import { ensureReceiptRuntime } from "@/server/receipts/runtime";
import { createDraftFromReceipt, ingestReceipt, retryReceipt } from "@/server/receipts/service";

export async function uploadReceiptAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx } = await requireUser();
  return runAction(async () => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("Pilih foto struk terlebih dahulu.");
    ensureReceiptRuntime();
    const { duplicateOf } = await ingestReceipt(ctx, { data: Buffer.from(await file.arrayBuffer()), mimeType: file.type });
    revalidatePath("/", "layout");
    if (duplicateOf) return { ok: true, message: "Struk ini sudah pernah diunggah, jadi tidak diproses lagi." };
    return { ok: true, message: "Struk diunggah dan sedang dibaca. Muat ulang halaman sebentar lagi." };
  });
}

export async function retryReceiptAction(receiptId: string) {
  const { ctx } = await requireUser();
  ensureReceiptRuntime();
  await retryReceipt(ctx, receiptId);
  revalidatePath("/transaksi/struk");
}

export async function fillReceiptAmountAction(receiptId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx } = await requireUser();
  let transactionId = "";
  const result = await runAction(async () => {
    const raw = formData.get("amount");
    const amount = typeof raw === "string" ? parseAmount(raw) : null;
    if (!amount || amount <= 0) throw new AppError("Isi total pembayaran, misalnya 45.000.");
    const merchant = formData.get("merchant");
    const t = await createDraftFromReceipt(receiptId, {
      amount,
      merchant: typeof merchant === "string" && merchant.trim() ? merchant.trim().slice(0, 120) : null,
      ctx,
    });
    transactionId = t.id;
  });
  if (result.error) return result;
  revalidatePath("/", "layout");
  redirect(`/transaksi/${transactionId}`);
}
