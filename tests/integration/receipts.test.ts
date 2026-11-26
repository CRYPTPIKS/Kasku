import type { Update } from "grammy/types";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "@/server/context";
import { prisma } from "@/server/db";
import { MockReceiptProvider } from "@/server/receipts/providers/mock";
import { setReceiptProvider } from "@/server/receipts/providers";
import {
  createDraftFromReceipt,
  ingestReceipt,
  listReceipts,
  processReceipt,
  receiptStatusCounts,
  retryReceipt,
  setReceiptNotifier,
  setReceiptScheduler,
} from "@/server/receipts/service";
import { createBot, processUpdate } from "@/server/telegram/bot";
import { setTelegramDownloader } from "@/server/telegram/files";
import { telegramReceiptNotifier } from "@/server/telegram/receipt-notifier";
import { resetDb, setupHousehold } from "./helpers";

let currentCtx: ServiceContext | null = null;
vi.mock("@/server/auth/current", () => ({ getApiContext: async () => currentCtx }));
const imageRoute = await import("@/app/api/receipts/[id]/image/route");

const OWNER_TG = 111111;
type Call = { method: string; payload: Record<string, unknown> };
let calls: Call[] = [];
let h: Awaited<ReturnType<typeof setupHousehold>>;
let updateId = 5000;
let messageId = 1;
let seq = 0;

/** JPEG palsu yang unik per panggilan (magic bytes valid). */
function fakeJpeg(tag = String(seq++)) {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`struk-${tag}`)]);
}

const bot = createBot({
  token: "123456:TEST-TOKEN-xxxxxxxxxxxxxxxxxxxxxxxx",
  allowedUserIds: new Set([String(OWNER_TG)]),
  botInfo: { id: 42, is_bot: true, first_name: "Kasku", username: "kasku_test_bot" } as never,
  transformer: async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const result = method === "sendMessage" || method === "editMessageText" ? { message_id: messageId++, date: 0, chat: { id: OWNER_TG, type: "private" } } : true;
    return { ok: true, result } as never;
  },
});

const sentTexts = () => calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").map((c) => String(c.payload.text));

function photoUpdate(fileId = `file-${seq}`): Update {
  return {
    update_id: updateId++,
    message: {
      message_id: messageId++,
      date: Math.floor(Date.now() / 1000),
      chat: { id: OWNER_TG, type: "private", first_name: "Rafa" },
      from: { id: OWNER_TG, is_bot: false, first_name: "Rafa" },
      photo: [
        { file_id: `${fileId}-small`, file_unique_id: "s", width: 90, height: 120, file_size: 1000 },
        { file_id: fileId, file_unique_id: "b", width: 900, height: 1200, file_size: 90000 },
      ],
    },
  } as Update;
}

function textUpdate(text: string): Update {
  return {
    update_id: updateId++,
    message: {
      message_id: messageId++,
      date: Math.floor(Date.now() / 1000),
      chat: { id: OWNER_TG, type: "private", first_name: "Rafa" },
      from: { id: OWNER_TG, is_bot: false, first_name: "Rafa" },
      text,
    },
  } as Update;
}

/** Bytes yang "diunduh" dari Telegram per file_id. */
const telegramFiles = new Map<string, Buffer>();

beforeEach(async () => {
  await resetDb();
  h = await setupHousehold();
  currentCtx = h.ctx;
  calls = [];
  telegramFiles.clear();
  setReceiptProvider(new MockReceiptProvider());
  // Proses langsung (tanpa antrean) agar test deterministik.
  setReceiptScheduler(async (id) => {
    await processReceipt(id);
  });
  setReceiptNotifier(telegramReceiptNotifier(bot.api));
  setTelegramDownloader(async (_api, fileId) => {
    const b = telegramFiles.get(fileId);
    if (!b) throw new Error("file tidak ada");
    return b;
  });
});

afterAll(() => {
  setReceiptProvider(null);
  setReceiptNotifier(null);
  setTelegramDownloader(null);
});

describe("pipeline struk", () => {
  it("foto → ekstraksi → draf pengeluaran dengan kategori, rekening, dan lampiran", async () => {
    const { receipt, duplicateOf } = await ingestReceipt(h.ctx, { data: fakeJpeg(), mimeType: "image/jpeg" });
    expect(duplicateOf).toBeNull();
    const r = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id }, include: { extractions: true } });
    expect(r.status).toBe("extracted");
    expect(r.extractions).toHaveLength(1);
    expect(r.extractions[0]!.provider).toBe("mock");
    expect(r.storageKey).toMatch(new RegExp(`^receipts/${h.household.id}/\\d{4}/\\d{2}/[0-9a-f-]+\\.jpg$`));

    const t = await prisma.transaction.findUniqueOrThrow({ where: { id: r.transactionId! }, include: { attachments: true } });
    expect(t.status).toBe("draft");
    expect(t.type).toBe("expense");
    expect(Number(t.amount)).toBe(43_000);
    expect(t.merchant).toMatch(/indomaret/i);
    expect(t.categoryId).toBe(h.groceries.id);
    expect(t.fromAccountId).toBe(h.bca.id); // "DEBIT BCA"
    expect(t.source).toBe("web");
    expect(t.attachments).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityType: "Receipt", entityId: r.id } })).toBe(1);
  });

  it("struk yang sama persis tidak diproses dua kali", async () => {
    const data = fakeJpeg("sama");
    await ingestReceipt(h.ctx, { data });
    const second = await ingestReceipt(h.ctx, { data });
    expect(second.duplicateOf).not.toBeNull();
    expect(await prisma.receipt.count()).toBe(1);
    expect(await prisma.transaction.count()).toBe(1);
  });

  it("menolak file yang bukan gambar walau mengaku image/jpeg", async () => {
    await expect(ingestReceipt(h.ctx, { data: Buffer.from("%PDF-1.4 bukan foto"), mimeType: "image/jpeg" })).rejects.toThrow(/tidak didukung/);
    expect(await prisma.receipt.count()).toBe(0);
  });

  it("viewer tidak boleh mengunggah struk", async () => {
    await expect(ingestReceipt({ ...h.ctx, role: "viewer" }, { data: fakeJpeg() })).rejects.toThrow(/akses/);
  });

  it("gagal baca → status failed, isi manual membuat draf, baca ulang tidak membuat ganda", async () => {
    setReceiptProvider(new MockReceiptProvider("GAGAL"));
    const { receipt } = await ingestReceipt(h.ctx, { data: fakeJpeg() });
    let r = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(r.status).toBe("failed");
    expect(r.transactionId).toBeNull();
    expect(await receiptStatusCounts(h.ctx)).toEqual({ processing: 0, failed: 1 });

    const t = await createDraftFromReceipt(receipt.id, { amount: 52_500, merchant: "Warung Bu Sri", ctx: h.ctx });
    expect(Number(t.amount)).toBe(52_500);
    expect(t.status).toBe("draft");
    r = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(r.status).toBe("extracted");
    expect(r.transactionId).toBe(t.id);

    await expect(retryReceipt(h.ctx, receipt.id)).rejects.toThrow(/sudah menjadi transaksi/);
    expect(await prisma.transaction.count()).toBe(1);
  });

  it("total tidak terbaca → failed dengan alasan jelas, baca ulang bisa berhasil", async () => {
    setReceiptProvider(new MockReceiptProvider("TOKO TANPA ANGKA\nterima kasih"));
    const { receipt } = await ingestReceipt(h.ctx, { data: fakeJpeg() });
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } })).errorMessage).toBe("Total pembayaran tidak terbaca.");

    setReceiptProvider(new MockReceiptProvider());
    await retryReceipt(h.ctx, receipt.id);
    const r = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(r.status).toBe("extracted");
    expect(r.attempts).toBe(2);
    expect((await listReceipts(h.ctx))[0]!.transaction?.id).toBe(r.transactionId);
  });

  it("struk household lain tidak bisa diakses", async () => {
    const { receipt } = await ingestReceipt(h.ctx, { data: fakeJpeg() });
    const other = await prisma.household.create({ data: { name: "Lain" } });
    const otherCtx: ServiceContext = { householdId: other.id, userId: null, role: "owner", source: "web" };
    await expect(createDraftFromReceipt(receipt.id, { amount: 1000, ctx: otherCtx })).rejects.toThrow(/tidak ditemukan/);
    await expect(retryReceipt(otherCtx, receipt.id)).rejects.toThrow(/tidak ditemukan/);
  });
});

describe("GET /api/receipts/:id/image", () => {
  const get = (id: string) => imageRoute.GET(new NextRequest(`http://localhost/api/receipts/${id}/image`), { params: Promise.resolve({ id }) });

  it("401 tanpa sesi", async () => {
    const { receipt } = await ingestReceipt(h.ctx, { data: fakeJpeg() });
    currentCtx = null;
    expect((await get(receipt.id)).status).toBe(401);
  });

  it("mengirim foto dengan header privat", async () => {
    const data = fakeJpeg();
    const { receipt } = await ingestReceipt(h.ctx, { data });
    const res = await get(receipt.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await res.arrayBuffer()).equals(data)).toBe(true);
  });

  it("404 untuk household lain", async () => {
    const { receipt } = await ingestReceipt(h.ctx, { data: fakeJpeg() });
    const other = await prisma.household.create({ data: { name: "Lain" } });
    currentCtx = { householdId: other.id, userId: null, role: "owner", source: "web" };
    expect((await get(receipt.id)).status).toBe(404);
  });
});

describe("foto struk lewat bot Telegram", () => {
  it("foto → 'sedang diproses' → draf dengan tombol Simpan", async () => {
    telegramFiles.set("foto-1", fakeJpeg());
    await processUpdate(bot, photoUpdate("foto-1"));
    const texts = sentTexts();
    expect(texts[0]).toBe("Struk sedang diproses.");
    expect(texts.at(-1)).toContain("Struk terbaca");
    expect(texts.at(-1)).toContain("Rp43.000");

    const r = await prisma.receipt.findFirstOrThrow({ include: { transaction: true } });
    expect(r.telegramFileId).toBe("foto-1");
    expect(r.transaction?.source).toBe("telegram_receipt");
    expect(r.transaction?.status).toBe("draft");

    const last = calls.filter((c) => c.method === "sendMessage").at(-1)!;
    const kb = (last.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard.flat();
    expect(kb.some((b) => b.callback_data === `tx:save:${r.transactionId}`)).toBe(true);

    // Simpan dari tombol → terkonfirmasi.
    await processUpdate(bot, {
      update_id: updateId++,
      callback_query: {
        id: "cb",
        from: { id: OWNER_TG, is_bot: false, first_name: "Rafa" },
        chat_instance: "x",
        data: `tx:save:${r.transactionId}`,
        message: { message_id: 1, date: 0, chat: { id: OWNER_TG, type: "private", first_name: "Rafa" }, text: "…" },
      },
    } as Update);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: r.transactionId! } })).status).toBe("confirmed");
  });

  it("foto yang sama dikirim lagi tidak membuat transaksi baru", async () => {
    const data = fakeJpeg("dobel");
    telegramFiles.set("a", data);
    telegramFiles.set("b", data);
    await processUpdate(bot, photoUpdate("a"));
    calls = [];
    await processUpdate(bot, photoUpdate("b"));
    expect(sentTexts().at(-1)).toContain("sudah pernah dikirim");
    expect(await prisma.transaction.count()).toBe(1);
    expect(await prisma.receipt.count()).toBe(1);
  });

  it("gagal baca → bot minta total → balasan nominal membuat draf", async () => {
    setReceiptProvider(new MockReceiptProvider("GAGAL"));
    telegramFiles.set("buram", fakeJpeg());
    await processUpdate(bot, photoUpdate("buram"));
    expect(sentTexts().at(-1)).toContain("total pembayaran");
    expect(await prisma.transaction.count()).toBe(0);

    await processUpdate(bot, textUpdate("bukan angka"));
    expect(sentTexts().at(-1)).toContain("Total belum terbaca");

    await processUpdate(bot, textUpdate("43rb"));
    const r = await prisma.receipt.findFirstOrThrow({ include: { transaction: true } });
    expect(Number(r.transaction?.amount)).toBe(43_000);
    expect(r.transaction?.status).toBe("draft");
    expect(await prisma.telegramChatState.findFirst({ where: { awaiting: "receipt_amount" } })).toBeNull();
  });

  it("dokumen non-gambar ditolak dengan sopan", async () => {
    await processUpdate(bot, {
      update_id: updateId++,
      message: {
        message_id: messageId++,
        date: 0,
        chat: { id: OWNER_TG, type: "private", first_name: "Rafa" },
        from: { id: OWNER_TG, is_bot: false, first_name: "Rafa" },
        document: { file_id: "pdf", file_unique_id: "pdf", mime_type: "application/pdf", file_size: 100 },
      },
    } as Update);
    expect(sentTexts().at(-1)).toContain("sebagai foto");
    expect(await prisma.receipt.count()).toBe(0);
  });
});
