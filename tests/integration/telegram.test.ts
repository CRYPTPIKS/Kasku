import type { Update } from "grammy/types";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { getAccount } from "@/server/services/accounts";
import { createBot, processUpdate } from "@/server/telegram/bot";
import { resetDb, setupHousehold } from "./helpers";

const OWNER_TG = 111111;
const STRANGER_TG = 999999;

type Call = { method: string; payload: Record<string, unknown> };
let calls: Call[] = [];
let h: Awaited<ReturnType<typeof setupHousehold>>;
let updateId = 1000;
let messageId = 1;

const bot = createBot({
  token: "123456:TEST-TOKEN-xxxxxxxxxxxxxxxxxxxxxxxx",
  allowedUserIds: new Set([String(OWNER_TG)]),
  botInfo: {
    id: 42,
    is_bot: true,
    first_name: "Kasku",
    username: "kasku_test_bot",
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  } as never,
  // Sadap semua panggilan API Telegram; tidak ada request jaringan.
  transformer: async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const result = method === "sendMessage" || method === "editMessageText" ? { message_id: messageId++, date: 0, chat: { id: OWNER_TG, type: "private" } } : true;
    return { ok: true, result } as never;
  },
});

function textUpdate(text: string, from = OWNER_TG): Update {
  return {
    update_id: updateId++,
    message: {
      message_id: messageId++,
      date: Math.floor(Date.now() / 1000),
      chat: { id: from, type: "private", first_name: "Rafa" },
      from: { id: from, is_bot: false, first_name: "Rafa" },
      text,
      ...(text.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }] } : {}),
    },
  } as Update;
}

function callbackUpdate(data: string, from = OWNER_TG): Update {
  return {
    update_id: updateId++,
    callback_query: {
      id: String(updateId),
      from: { id: from, is_bot: false, first_name: "Rafa" },
      chat_instance: "x",
      data,
      message: { message_id: 1, date: 0, chat: { id: from, type: "private", first_name: "Rafa" }, text: "…" },
    },
  } as Update;
}

const sent = () => calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText");
const lastText = () => String(sent().at(-1)?.payload.text ?? "");
const buttons = () =>
  ((sent().at(-1)?.payload.reply_markup as { inline_keyboard?: { text: string; callback_data: string }[][] })?.inline_keyboard ?? []).flat();

beforeEach(async () => {
  await resetDb();
  h = await setupHousehold();
  calls = [];
});

describe("bot Telegram", () => {
  it("pengguna di luar whitelist diabaikan", async () => {
    await processUpdate(bot, textUpdate("keluar 75rb makan pakai Tunai", STRANGER_TG));
    expect(await prisma.transaction.count()).toBe(0);
    expect(sent()).toHaveLength(0);
    expect(await prisma.telegramIdentity.count()).toBe(0);
  });

  it("/start dari orang asing dijawab bot privat", async () => {
    await processUpdate(bot, textUpdate("/start", STRANGER_TG));
    expect(lastText()).toContain("privat");
  });

  it("teks lengkap -> draf dengan tombol, lalu Simpan -> confirmed + saldo berubah", async () => {
    await processUpdate(bot, textUpdate("keluar 75rb makan siang pakai tunai"));
    const t = await prisma.transaction.findFirstOrThrow();
    expect(t.status).toBe("draft");
    expect(t.source).toBe("telegram_text");
    expect(Number(t.amount)).toBe(75_000);
    expect(t.categoryId).toBe(h.food.id);
    expect(t.fromAccountId).toBe(h.cash.id);
    expect(lastText()).toContain("Pengeluaran Rp75.000");
    expect(lastText()).toContain("Makan &amp; Minum");
    expect(buttons().map((b) => b.text)).toEqual(
      expect.arrayContaining(["✅ Simpan", "Ubah nominal", "Ubah kategori", "Ubah rekening", "Bagi transaksi", "🗑 Hapus"]),
    );
    expect((await getAccount(h.ctx, h.cash.id)).balance).toBe(1_000_000);

    await processUpdate(bot, callbackUpdate(`tx:save:${t.id}`));
    const saved = await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } });
    expect(saved.status).toBe("confirmed");
    expect((await getAccount(h.ctx, h.cash.id)).balance).toBe(925_000);
    // Kebiasaan merchant dipelajari.
    expect(await prisma.categoryMerchantRule.count({ where: { categoryId: h.food.id } })).toBe(1);
    // Audit mencatat sumber telegram.
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: t.id, action: "confirm" } });
    expect(audit.actorSource).toBe("telegram");
  });

  it("rekening belum disebut -> bot bertanya dengan tombol rekening", async () => {
    await processUpdate(bot, textUpdate("masuk 12jt gaji bulan November"));
    const t = await prisma.transaction.findFirstOrThrow();
    expect(t.toAccountId).toBeNull();
    expect(lastText()).toContain("Masuk ke rekening mana?");
    const bca = buttons().find((b) => b.text === "BCA");
    expect(bca?.callback_data).toBe(`tx:sett:${t.id}:${h.bca.id}`);

    // Simpan sebelum lengkap -> diminta melengkapi, tetap draf.
    await processUpdate(bot, callbackUpdate(`tx:save:${t.id}`));
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("draft");

    await processUpdate(bot, callbackUpdate(bca!.callback_data));
    await processUpdate(bot, callbackUpdate(`tx:save:${t.id}`));
    expect((await getAccount(h.ctx, h.bca.id)).balance).toBe(22_000_000);
  });

  it("update_id yang sama diproses sekali saja", async () => {
    const u = textUpdate("keluar 20rb kopi pakai tunai");
    expect(await processUpdate(bot, u)).toBe("processed");
    expect(await processUpdate(bot, u)).toBe("duplicate");
    expect(await prisma.transaction.count()).toBe(1);
    expect(await prisma.processedTelegramUpdate.count()).toBe(1);
  });

  it("ubah nominal lewat balasan teks", async () => {
    await processUpdate(bot, textUpdate("keluar 20rb kopi pakai tunai"));
    const t = await prisma.transaction.findFirstOrThrow();
    await processUpdate(bot, callbackUpdate(`tx:amt:${t.id}`));
    expect(lastText()).toContain("Kirim nominal baru");
    await processUpdate(bot, textUpdate("35rb"));
    expect(Number((await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).amount)).toBe(35_000);
    expect(await prisma.transaction.count()).toBe(1);
  });

  it("bagi transaksi lewat Telegram", async () => {
    await processUpdate(bot, textUpdate("belanja 150rb pakai tunai"));
    const t = await prisma.transaction.findFirstOrThrow();
    await processUpdate(bot, callbackUpdate(`tx:split:${t.id}`));
    await processUpdate(bot, textUpdate("makan 50rb\nbelanja indomaret 100rb"));
    const splits = await prisma.transactionSplit.findMany({ where: { transactionId: t.id }, orderBy: { sortOrder: "asc" } });
    expect(splits.map((s) => [s.categoryId, Number(s.amount)])).toEqual([
      [h.food.id, 50_000],
      [h.groceries.id, 100_000],
    ]);
  });

  it("transfer: tidak dihitung pengeluaran, saldo pindah", async () => {
    await processUpdate(bot, textUpdate("transfer 500rb dari BCA ke GoPay"));
    const t = await prisma.transaction.findFirstOrThrow();
    expect(t.type).toBe("transfer");
    await processUpdate(bot, callbackUpdate(`tx:save:${t.id}`));
    expect((await getAccount(h.ctx, h.bca.id)).balance).toBe(9_500_000);
    expect((await getAccount(h.ctx, h.gopay.id)).balance).toBe(500_000);
  });

  it("hapus butuh konfirmasi", async () => {
    await processUpdate(bot, textUpdate("keluar 20rb kopi pakai tunai"));
    const t = await prisma.transaction.findFirstOrThrow();
    await processUpdate(bot, callbackUpdate(`tx:del:${t.id}`));
    expect(lastText()).toContain("Yakin hapus");
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).deletedAt).toBeNull();
    await processUpdate(bot, callbackUpdate(`tx:delok:${t.id}`));
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).deletedAt).not.toBeNull();
  });

  it("/saldo dan /ringkasan", async () => {
    await processUpdate(bot, textUpdate("/saldo"));
    expect(lastText()).toContain("BCA: <b>Rp10.000.000</b>");
    await processUpdate(bot, textUpdate("/ringkasan"));
    expect(lastText()).toContain("Pemasukan");
  });

  it("tidak bisa mengakses transaksi household lain lewat callback", async () => {
    const other = await prisma.household.create({ data: { name: "Lain" } });
    const foreign = await prisma.transaction.create({
      data: { householdId: other.id, type: "expense", status: "draft", occurredAt: new Date(), amount: 1 },
    });
    await processUpdate(bot, callbackUpdate(`tx:save:${foreign.id}`));
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe("draft");
    const alert = calls.find((c) => c.method === "answerCallbackQuery" && c.payload.show_alert);
    expect(String(alert?.payload.text)).toContain("tidak ditemukan");
  });
});

describe("webhook /api/telegram/webhook", () => {
  it("menolak secret yang salah dan menerima yang benar", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123456:TEST-TOKEN-xxxxxxxxxxxxxxxxxxxxxxxx";
    process.env.TELEGRAM_ALLOWED_USER_IDS = String(OWNER_TG);
    process.env.TELEGRAM_WEBHOOK_SECRET = "rahasia-webhook-1234567890";
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const req = (secret: string, body: unknown) =>
      new NextRequest("http://localhost/api/telegram/webhook", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      });
    expect((await POST(req("salah", { update_id: 1 }))).status).toBe(401);
    expect((await POST(req("rahasia-webhook-1234567890", { bukan: "update" }))).status).toBe(400);
    expect(await prisma.processedTelegramUpdate.count()).toBe(0);
  });
});
