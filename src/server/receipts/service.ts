import { createHash, randomUUID } from "node:crypto";
import type { Receipt } from "@prisma/client";
import { jakartaParts } from "@/lib/dates";
import { normalizeText, suggestCategory } from "@/lib/parsing/transaction-text";
import { prisma } from "../db";
import { AppError, notFound } from "../errors";
import { canWrite, type ServiceContext } from "../context";
import { logger } from "../logger";
import { getStorage } from "../storage";
import { writeAudit } from "../audit";
import { listAccounts } from "../services/accounts";
import { listCategories } from "../services/categories";
import { createTransaction, getTransaction, type TransactionWithRelations } from "../services/transactions";
import { getReceiptProvider, type ReceiptExtractionOutput } from "./providers";

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface ReceiptNotifier {
  /** Hasil pembacaan siap: draf transaksi dibuat. */
  extracted(receipt: Receipt, transaction: TransactionWithRelations, extraction: ReceiptExtractionOutput): Promise<void>;
  /** Pembacaan gagal: foto tetap tersimpan, minta isi manual. */
  failed(receipt: Receipt, reason: string): Promise<void>;
}

const noopNotifier: ReceiptNotifier = { extracted: async () => {}, failed: async () => {} };
let notifier: ReceiptNotifier = noopNotifier;
export function setReceiptNotifier(n: ReceiptNotifier | null) {
  notifier = n ?? noopNotifier;
}

/** Penjadwal pemrosesan (antrean BullMQ atau langsung). Diatur oleh modul queue. */
let scheduler: (receiptId: string) => Promise<void> = async (id) => {
  setImmediate(() => void processReceipt(id).catch((err) => logger.error("Proses struk gagal", { err, receiptId: id })));
};
export function setReceiptScheduler(fn: (receiptId: string) => Promise<void>) {
  scheduler = fn;
}

export function detectMime(data: Buffer, declared?: string | null): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 12 && data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP") return "image/webp";
  // Tipe yang dideklarasikan tidak dipercaya; isi file harus cocok.
  void declared;
  return null;
}

export type IngestResult = { receipt: Receipt; duplicateOf: Receipt | null };

/**
 * Simpan foto struk secara privat, buat entri Receipt, lalu antrekan pembacaan.
 * Struk yang sama persis (hash SHA-256) tidak diproses ulang.
 */
export async function ingestReceipt(
  ctx: ServiceContext,
  input: { data: Buffer; mimeType?: string | null; telegram?: { fileId: string; chatId: number; messageId: number } },
): Promise<IngestResult> {
  if (!canWrite(ctx)) throw new AppError("Anda tidak punya akses mengubah data.", "forbidden");
  if (input.data.length === 0) throw new AppError("File kosong.");
  if (input.data.length > MAX_RECEIPT_BYTES) throw new AppError("Ukuran foto maksimal 10 MB.");
  const mimeType = detectMime(input.data, input.mimeType);
  if (!mimeType) throw new AppError("Format foto tidak didukung. Gunakan JPG, PNG, atau WEBP.");

  const sha256 = createHash("sha256").update(input.data).digest("hex");
  const existing = await prisma.receipt.findFirst({
    where: { householdId: ctx.householdId, sha256 },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return { receipt: existing, duplicateOf: existing };

  const p = jakartaParts(new Date());
  const storageKey = `receipts/${ctx.householdId}/${p.year}/${String(p.month).padStart(2, "0")}/${randomUUID()}.${ALLOWED_MIME[mimeType]}`;
  await getStorage().put(storageKey, input.data, mimeType);

  const receipt = await prisma.$transaction(async (tx) => {
    const r = await tx.receipt.create({
      data: {
        householdId: ctx.householdId,
        status: "queued",
        storageKey,
        mimeType,
        sizeBytes: input.data.length,
        sha256,
        telegramFileId: input.telegram?.fileId ?? null,
        telegramChatId: input.telegram ? BigInt(input.telegram.chatId) : null,
        telegramMessageId: input.telegram?.messageId ?? null,
      },
    });
    await writeAudit(tx, ctx, { entityType: "Receipt", entityId: r.id, action: "create", after: { ...r, storageKey: "[privat]" } });
    return r;
  });
  await scheduler(receipt.id);
  return { receipt, duplicateOf: null };
}

async function ownerContext(householdId: string, source: ServiceContext["source"]): Promise<ServiceContext> {
  const owner = await prisma.householdMember.findFirst({ where: { householdId, role: "owner" }, orderBy: { createdAt: "asc" } });
  return { householdId, userId: owner?.userId ?? null, role: "owner", source };
}

/** Tebak rekening dari metode pembayaran yang terbaca (hanya jika jelas). */
function guessAccount(paymentMethod: string | null, rawText: string | null, accounts: Awaited<ReturnType<typeof listAccounts>>) {
  if (!paymentMethod) return null;
  const pm = normalizeText(paymentMethod);
  const text = normalizeText(rawText ?? "");
  if (pm === "tunai") return accounts.filter((a) => a.kind === "cash").length === 1 ? accounts.find((a) => a.kind === "cash")!.id : null;
  // Cocokkan nama/alias rekening yang muncul di metode bayar atau teks struk (mis. "DEBIT BCA").
  const hits = accounts.filter((a) =>
    [a.name, ...a.aliases].map(normalizeText).some((term) => term.length >= 3 && (pm.includes(term) || new RegExp(`\\b${term}\\b`).test(text))),
  );
  return hits.length === 1 ? hits[0]!.id : null;
}

/** Baca struk dan jadikan draf transaksi. Dipanggil oleh worker antrean. */
export async function processReceipt(receiptId: string): Promise<"extracted" | "failed" | "skipped"> {
  const receipt = await prisma.receipt.findUnique({ where: { id: receiptId } });
  if (!receipt) return "skipped";
  if (receipt.status === "extracted" || receipt.status === "confirmed" || receipt.transactionId) return "skipped";
  await prisma.receipt.update({ where: { id: receiptId }, data: { status: "processing", attempts: { increment: 1 }, errorMessage: null } });

  const provider = getReceiptProvider();
  let extraction: ReceiptExtractionOutput;
  try {
    const data = await getStorage().get(receipt.storageKey);
    extraction = await provider.extract({ data, mimeType: receipt.mimeType });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("Pembacaan struk gagal", { receiptId, provider: provider.name, reason });
    const failed = await prisma.receipt.update({ where: { id: receiptId }, data: { status: "failed", errorMessage: reason.slice(0, 500) } });
    await notifier.failed(failed, "Struk belum bisa dibaca.").catch((e) => logger.error("Notifikasi struk gagal", { err: e }));
    return "failed";
  }

  await prisma.receiptExtraction.create({
    data: {
      receiptId,
      provider: provider.name,
      merchant: extraction.merchant,
      occurredAt: extraction.occurredAt,
      total: extraction.total,
      subtotal: extraction.subtotal,
      tax: extraction.tax,
      discount: extraction.discount,
      serviceCharge: extraction.serviceCharge,
      paymentMethod: extraction.paymentMethod,
      items: extraction.items.length ? (extraction.items as unknown as object) : undefined,
      confidence: extraction.confidence,
      rawText: extraction.rawText?.slice(0, 20000) ?? null,
      rawResponse: extraction.rawResponse === undefined ? undefined : JSON.parse(JSON.stringify(extraction.rawResponse)),
    },
  });

  if (!extraction.total || extraction.total <= 0) {
    const failed = await prisma.receipt.update({
      where: { id: receiptId },
      data: { status: "failed", errorMessage: "Total pembayaran tidak terbaca." },
    });
    await notifier.failed(failed, "Total pembayaran tidak terbaca.").catch((e) => logger.error("Notifikasi struk gagal", { err: e }));
    return "failed";
  }

  const t = await createDraftFromReceipt(receiptId, {
    amount: extraction.total,
    merchant: extraction.merchant,
    occurredAt: extraction.occurredAt,
    paymentMethod: extraction.paymentMethod,
    rawText: extraction.rawText,
    itemNames: extraction.items.map((i) => i.name),
    extraction,
  });
  const updated = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });
  await notifier.extracted(updated, t, extraction).catch((e) => logger.error("Notifikasi struk gagal", { err: e }));
  return "extracted";
}

function extractionNote(e: ReceiptExtractionOutput | undefined): string | null {
  if (!e) return null;
  const parts: string[] = [];
  const fmt = (n: number) => new Intl.NumberFormat("id-ID").format(n);
  if (e.subtotal) parts.push(`Subtotal ${fmt(e.subtotal)}`);
  if (e.discount) parts.push(`Diskon ${fmt(e.discount)}`);
  if (e.serviceCharge) parts.push(`Layanan ${fmt(e.serviceCharge)}`);
  if (e.tax) parts.push(`Pajak ${fmt(e.tax)}`);
  if (e.paymentMethod) parts.push(`Bayar: ${e.paymentMethod}`);
  if (e.items.length) parts.push(`Item: ${e.items.slice(0, 15).map((i) => (i.qty && i.qty > 1 ? `${i.name} x${i.qty}` : i.name)).join(", ")}`);
  return parts.length ? `Dari struk — ${parts.join(" · ")}`.slice(0, 1000) : null;
}

/** Buat draf pengeluaran dari struk (otomatis atau nominal yang diisi manual). */
export async function createDraftFromReceipt(
  receiptId: string,
  input: {
    amount: number;
    merchant?: string | null;
    occurredAt?: Date | null;
    paymentMethod?: string | null;
    rawText?: string | null;
    itemNames?: string[];
    extraction?: ReceiptExtractionOutput;
    ctx?: ServiceContext;
  },
) {
  const receipt = await prisma.receipt.findUnique({ where: { id: receiptId } });
  if (!receipt || (input.ctx && receipt.householdId !== input.ctx.householdId)) throw notFound("Struk");
  if (receipt.transactionId) {
    const ctx = input.ctx ?? (await ownerContext(receipt.householdId, "system"));
    return getTransaction(ctx, receipt.transactionId);
  }
  const ctx = input.ctx ?? (await ownerContext(receipt.householdId, receipt.telegramChatId ? "telegram" : "system"));
  const [accounts, categories, rules] = await Promise.all([
    listAccounts(ctx),
    listCategories(ctx, { kind: "expense" }),
    prisma.categoryMerchantRule.findMany({ where: { householdId: ctx.householdId }, select: { merchantKey: true, categoryId: true } }),
  ]);
  const hint = [input.merchant ?? "", ...(input.itemNames ?? [])].join(" ");
  const categoryId = hint.trim()
    ? suggestCategory(
        hint,
        "expense",
        categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, keywords: c.keywords })),
        rules,
      )
    : null;
  // Tanggal struk di masa depan/terlalu lama kemungkinan salah baca -> pakai waktu kirim.
  const now = Date.now();
  const occurredAt =
    input.occurredAt && input.occurredAt.getTime() <= now + 86400000 && input.occurredAt.getTime() > now - 400 * 86400000
      ? input.occurredAt
      : receipt.createdAt;

  const t = await prisma.$transaction(async (tx) => {
    const created = await createTransaction(
      ctx,
      {
        type: "expense",
        status: "draft",
        amount: input.amount,
        occurredAt,
        description: input.merchant ?? "Belanja (struk)",
        merchant: input.merchant ?? null,
        note: extractionNote(input.extraction),
        categoryId,
        fromAccountId: guessAccount(input.paymentMethod ?? null, input.rawText ?? null, accounts),
      },
      { source: receipt.telegramChatId ? "telegram_receipt" : "web", tx },
    );
    await tx.transactionAttachment.create({
      data: {
        transactionId: created.id,
        storageKey: receipt.storageKey,
        fileName: `struk.${ALLOWED_MIME[receipt.mimeType] ?? "jpg"}`,
        mimeType: receipt.mimeType,
        sizeBytes: receipt.sizeBytes,
      },
    });
    await tx.receipt.update({ where: { id: receiptId }, data: { status: "extracted", transactionId: created.id, errorMessage: null } });
    return created;
  });
  return getTransaction(ctx, t.id);
}

/** Proses ulang struk yang gagal (dashboard). */
export async function retryReceipt(ctx: ServiceContext, receiptId: string) {
  if (!canWrite(ctx)) throw new AppError("Anda tidak punya akses mengubah data.", "forbidden");
  const r = await prisma.receipt.findFirst({ where: { id: receiptId, householdId: ctx.householdId } });
  if (!r) throw notFound("Struk");
  if (r.transactionId) throw new AppError("Struk ini sudah menjadi transaksi.");
  await prisma.receipt.update({ where: { id: receiptId }, data: { status: "queued", errorMessage: null } });
  await scheduler(receiptId);
}

export async function listReceipts(ctx: ServiceContext, opts: { take?: number } = {}) {
  return prisma.receipt.findMany({
    where: { householdId: ctx.householdId },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 50,
    include: {
      transaction: { select: { id: true, status: true, amount: true, description: true, deletedAt: true } },
      extractions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

export async function receiptStatusCounts(ctx: ServiceContext) {
  const rows = await prisma.receipt.groupBy({
    by: ["status"],
    where: { householdId: ctx.householdId, status: { in: ["queued", "processing", "failed"] } },
    _count: true,
  });
  const get = (s: string) => rows.find((r) => r.status === s)?._count ?? 0;
  return { processing: get("queued") + get("processing"), failed: get("failed") };
}

export async function getReceiptForViewer(ctx: ServiceContext, receiptId: string) {
  const r = await prisma.receipt.findFirst({ where: { id: receiptId, householdId: ctx.householdId } });
  if (!r) throw notFound("Struk");
  return { receipt: r, data: await getStorage().get(r.storageKey) };
}

/** Struk yang menjadi sumber sebuah transaksi (untuk halaman detail). */
export async function getReceiptForTransaction(ctx: ServiceContext, transactionId: string) {
  return prisma.receipt.findFirst({
    where: { householdId: ctx.householdId, transactionId },
    include: { extractions: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
}
