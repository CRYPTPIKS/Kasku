import type { Bot, Context } from "grammy";
import { formatRupiah } from "@/lib/money";
import { findAmounts, parseAmount } from "@/lib/parsing/amount";
import { merchantKey, parseTransactionText, suggestCategory } from "@/lib/parsing/transaction-text";
import { prisma } from "../db";
import type { ServiceContext } from "../context";
import { toErrorPayload } from "../errors";
import { logger } from "../logger";
import { listAccounts } from "../services/accounts";
import { listCategories } from "../services/categories";
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  toInput,
  updateTransaction,
  type TransactionWithRelations,
} from "../services/transactions";
import type { TransactionInput } from "../validation/transaction";
import { createDraftFromReceipt, ingestReceipt, MAX_RECEIPT_BYTES } from "../receipts/service";
import { ensureReceiptRuntime } from "../receipts/runtime";
import { downloadTelegramFile } from "./files";
import { choiceKeyboard, draftKeyboard, esc, HELP_TEXT, isUndoable, savedKeyboard, transactionSummary } from "./format";
import { resolveIdentity } from "./identity";
import { cmdAnggaran, cmdDebts, cmdInvestasi, handleFinanceIntent, handlePendingCallback, notifyBudgetAfterSave } from "./finance-handlers";
import { detectQuestion } from "@/lib/parsing/question";
import { answerQuestion, cmdRingkasan, cmdSaldo, cmdTransaksi, handleQuestionCallback, notUnderstoodKeyboard } from "./questions";

export interface BotState {
  svc: ServiceContext;
  telegramUserId: bigint;
}
export type BotContext = Context & { state: BotState };

const STATE_TTL_MS = 30 * 60 * 1000;
const HTML = { parse_mode: "HTML" as const };

// ---------------------------------------------------------------------------
// Status percakapan
// ---------------------------------------------------------------------------

async function setAwaiting(telegramUserId: bigint, awaiting: string | null, transactionId: string | null = null) {
  await prisma.telegramChatState.upsert({
    where: { telegramUserId },
    create: { telegramUserId, awaiting, transactionId, receiptId: null, expiresAt: awaiting ? new Date(Date.now() + STATE_TTL_MS) : null },
    update: { awaiting, transactionId, receiptId: null, expiresAt: awaiting ? new Date(Date.now() + STATE_TTL_MS) : null },
  });
}

async function getAwaiting(telegramUserId: bigint) {
  const s = await prisma.telegramChatState.findUnique({ where: { telegramUserId } });
  if (!s?.awaiting || (s.expiresAt && s.expiresAt < new Date())) return null;
  return s;
}

// ---------------------------------------------------------------------------
// Bantuan
// ---------------------------------------------------------------------------

async function reply(ctx: BotContext, text: string, extra: Record<string, unknown> = {}) {
  return ctx.reply(text, { ...HTML, ...extra });
}

async function showTransaction(ctx: BotContext, t: TransactionWithRelations, note?: string, edit = false) {
  const text = (note ? `${note}\n\n` : "") + transactionSummary(t);
  const reply_markup = t.status === "draft" ? draftKeyboard(t) : savedKeyboard(t);
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { ...HTML, reply_markup });
      return;
    } catch {
      // Pesan lama tidak bisa diedit (terlalu lama/tidak berubah) — kirim baru.
    }
  }
  await ctx.reply(text, { ...HTML, reply_markup });
}

async function patchTransaction(svc: ServiceContext, id: string, patch: Partial<TransactionInput>) {
  const t = await getTransaction(svc, id);
  return updateTransaction(svc, id, toInput(t, patch));
}

/** Pelajari kebiasaan: keterangan/merchant -> kategori. */
async function learnCategory(svc: ServiceContext, t: TransactionWithRelations) {
  const key = merchantKey(t.merchant || t.description || "");
  if (!key || !t.categoryId || key.length < 3) return;
  await prisma.categoryMerchantRule.upsert({
    where: { householdId_merchantKey: { householdId: svc.householdId, merchantKey: key } },
    create: { householdId: svc.householdId, merchantKey: key, categoryId: t.categoryId },
    update: { categoryId: t.categoryId, hits: { increment: 1 } },
  });
}

function missingQuestion(t: TransactionWithRelations): { question: string; pick: "from" | "to" | "cat" } | null {
  if (t.type === "transfer") {
    if (!t.fromAccountId) return { question: "Transfer dari rekening mana?", pick: "from" };
    if (!t.toAccountId) return { question: "Transfer ke rekening mana?", pick: "to" };
    return null;
  }
  if (t.type === "expense" && !t.fromAccountId) return { question: "Pilih rekening:", pick: "from" };
  if ((t.type === "income" || t.type === "investment_income") && !t.toAccountId) return { question: "Masuk ke rekening mana?", pick: "to" };
  if ((t.type === "expense" || t.type === "income") && !t.categoryId && t.splits.length === 0) return { question: "Pilih kategori:", pick: "cat" };
  return null;
}

async function accountChoices(svc: ServiceContext) {
  return (await listAccounts(svc)).map((a) => ({ id: a.id, label: a.name }));
}

async function categoryChoices(svc: ServiceContext, kind: "income" | "expense") {
  return (await listCategories(svc, { kind })).map((c) => ({ id: c.id, label: `${c.icon ?? ""} ${c.name}`.trim() }));
}

async function askMissing(ctx: BotContext, t: TransactionWithRelations, edit = false) {
  const m = missingQuestion(t);
  if (!m) return false;
  const text = `${transactionSummary(t)}\n\n<b>${esc(m.question)}</b>`;
  const kb =
    m.pick === "cat"
      ? choiceKeyboard(await categoryChoices(ctx.state.svc, t.type === "expense" ? "expense" : "income"), "setc", t.id, 2)
      : choiceKeyboard(await accountChoices(ctx.state.svc), m.pick === "from" ? "setf" : "sett", t.id);
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { ...HTML, reply_markup: kb });
      return true;
    } catch {
      /* kirim baru */
    }
  }
  await ctx.reply(text, { ...HTML, reply_markup: kb });
  return true;
}

// ---------------------------------------------------------------------------
// Perintah
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pesan teks
// ---------------------------------------------------------------------------

async function handleAwaitingInput(ctx: BotContext, text: string): Promise<boolean> {
  const state = await getAwaiting(ctx.state.telegramUserId);
  const svc = ctx.state.svc;

  if (state?.awaiting === "receipt_amount" && state.receiptId) {
    const amount = parseAmount(text);
    if (amount === null || amount <= 0) {
      await reply(ctx, "Total belum terbaca. Contoh: <code>43rb</code>. Kirim /batal untuk membatalkan.");
      return true;
    }
    await setAwaiting(ctx.state.telegramUserId, null);
    const t = await createDraftFromReceipt(state.receiptId, { amount, ctx: svc });
    if (!(await askMissing(ctx, t))) await showTransaction(ctx, t, "Draf dibuat dari struk.");
    return true;
  }
  if (!state?.transactionId) return false;

  if (state.awaiting === "amount") {
    const amount = parseAmount(text);
    if (amount === null || amount <= 0) {
      await reply(ctx, "Nominal belum terbaca. Contoh: <code>75rb</code> atau <code>1,5jt</code>. Kirim /batal untuk membatalkan.");
      return true;
    }
    await setAwaiting(ctx.state.telegramUserId, null);
    const t = await patchTransaction(svc, state.transactionId, { amount, splits: [] });
    await showTransaction(ctx, t, "Nominal diperbarui.");
    return true;
  }

  if (state.awaiting === "split") {
    const t = await getTransaction(svc, state.transactionId);
    const categories = (await listCategories(svc, { kind: "expense" })).map((c) => ({ ...c, kind: c.kind as "income" | "expense" }));
    const parts: { categoryId: string | null; amount: number; label: string }[] = [];
    for (const line of text.split(/\n|;/).map((l) => l.trim()).filter(Boolean)) {
      const amt = findAmounts(line)[0];
      if (!amt) {
        await reply(ctx, `Baris “${esc(line)}” belum ada nominalnya. Kirim ulang semua bagian, atau /batal.`);
        return true;
      }
      const label = (line.slice(0, amt.start) + line.slice(amt.end)).trim();
      parts.push({ categoryId: suggestCategory(label, "expense", categories), amount: amt.value, label });
    }
    const total = parts.reduce((a, p) => a + p.amount, 0);
    if (parts.length < 2 || Math.round(total * 100) !== Math.round(Number(t.amount) * 100)) {
      await reply(
        ctx,
        `Jumlah bagian (${esc(formatRupiah(total))}) harus sama dengan total ${esc(formatRupiah(Number(t.amount)))} dan minimal 2 bagian. Coba lagi atau /batal.`,
      );
      return true;
    }
    const unknown = parts.filter((p) => !p.categoryId).map((p) => p.label || "(tanpa nama)");
    await setAwaiting(ctx.state.telegramUserId, null);
    const updated = await patchTransaction(svc, t.id, {
      categoryId: null,
      splits: parts.map((p) => ({ categoryId: p.categoryId, amount: p.amount, note: p.label || null })),
    });
    await showTransaction(
      ctx,
      updated,
      unknown.length ? `Transaksi dibagi. Kategori untuk ${esc(unknown.join(", "))} belum dikenali, bisa dilengkapi di dashboard.` : "Transaksi dibagi.",
    );
    return true;
  }
  return false;
}

/** Batas waktu "hapus yang tadi": hanya transaksi yang dibuat lewat bot dalam 60 menit terakhir. */
const UNDO_LAST_WINDOW_MS = 60 * 60 * 1000;

async function offerUndoLast(ctx: BotContext) {
  const svc = ctx.state.svc;
  const last = await prisma.transaction.findFirst({
    where: {
      householdId: svc.householdId,
      deletedAt: null,
      createdById: svc.userId,
      source: { in: ["telegram_text", "telegram_receipt"] },
      type: { in: ["income", "expense", "transfer"] },
      debtId: null,
      investmentTransaction: null,
      createdAt: { gte: new Date(Date.now() - UNDO_LAST_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!last) {
    return reply(ctx, "Tidak ada transaksi dari bot dalam 1 jam terakhir. Untuk yang lebih lama, buka /transaksi atau dashboard.");
  }
  const t = await getTransaction(svc, last.id);
  return reply(ctx, `${transactionSummary(t)}\n\n<b>Hapus transaksi terakhir ini?</b>`, {
    reply_markup: { inline_keyboard: [[{ text: "Ya, hapus", callback_data: `tx:delok:${t.id}` }, { text: "Batal", callback_data: `tx:back:${t.id}` }]] },
  });
}

async function handleText(ctx: BotContext) {
  const text = ctx.message?.text?.trim() ?? "";
  if (!text || text.startsWith("/")) return;
  if (text.length > 500) return reply(ctx, "Pesan terlalu panjang. Kirim satu transaksi per pesan.");
  if (await handleAwaitingInput(ctx, text)) return;

  const svc = ctx.state.svc;
  const [accounts, categories, rules] = await Promise.all([
    listAccounts(svc),
    listCategories(svc),
    prisma.categoryMerchantRule.findMany({ where: { householdId: svc.householdId }, select: { merchantKey: true, categoryId: true } }),
  ]);
  const question = detectQuestion(text, {
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, aliases: a.aliases })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, keywords: c.keywords })),
  });
  if (question) {
    await setAwaiting(ctx.state.telegramUserId, null);
    if (question.kind === "undo") return offerUndoLast(ctx);
    return answerQuestion(ctx, question);
  }

  const parsed = parseTransactionText(text, {
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, aliases: a.aliases })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, keywords: c.keywords })),
    merchantRules: rules,
  });

  if (!parsed.intent) {
    return reply(
      ctx,
      "Maaf, aku belum paham. Untuk mencatat coba: <code>keluar 75rb makan siang pakai cash</code>\nAtau tanya, mis. <i>berapa saldo BCA?</i> Pilih salah satu:",
      { reply_markup: notUnderstoodKeyboard() },
    );
  }
  if (parsed.amount === null) {
    return reply(ctx, `${esc(parsed.question ?? "Berapa nominalnya?")} Kirim ulang lengkap dengan nominal, mis. <code>${esc(text)} 50rb</code>`);
  }
  if (!["income", "expense", "transfer"].includes(parsed.intent)) {
    await setAwaiting(ctx.state.telegramUserId, null);
    return handleFinanceIntent(ctx, parsed, text);
  }

  const t = await createTransaction(
    svc,
    {
      type: parsed.intent as "income" | "expense" | "transfer",
      status: "draft",
      amount: parsed.amount,
      occurredAt: parsed.occurredAt,
      description: parsed.description || null,
      categoryId: parsed.categoryId,
      fromAccountId: parsed.fromAccountId,
      toAccountId: parsed.toAccountId,
    },
    { source: "telegram_text" },
  );
  if (!(await askMissing(ctx, t))) await showTransaction(ctx, t);
}

// ---------------------------------------------------------------------------
// Foto struk
// ---------------------------------------------------------------------------

async function handlePhoto(ctx: BotContext) {
  const msg = ctx.message;
  if (!msg) return;
  let fileId: string | null = null;
  let size = 0;
  if (msg.photo?.length) {
    const largest = msg.photo[msg.photo.length - 1]!;
    fileId = largest.file_id;
    size = largest.file_size ?? 0;
  } else if (msg.document) {
    if (!msg.document.mime_type?.startsWith("image/")) {
      return reply(ctx, "Kirim struk sebagai foto (JPG/PNG), ya.");
    }
    fileId = msg.document.file_id;
    size = msg.document.file_size ?? 0;
  }
  if (!fileId) return;
  if (size > MAX_RECEIPT_BYTES) return reply(ctx, "Foto terlalu besar (maks. 10 MB).");

  await setAwaiting(ctx.state.telegramUserId, null);
  await reply(ctx, "Struk sedang diproses.", { reply_parameters: { message_id: msg.message_id } });
  ensureReceiptRuntime();
  const data = await downloadTelegramFile(ctx.api, fileId);
  const { receipt, duplicateOf } = await ingestReceipt(ctx.state.svc, {
    data,
    mimeType: msg.document?.mime_type ?? "image/jpeg",
    telegram: { fileId, chatId: msg.chat.id, messageId: msg.message_id },
  });
  if (duplicateOf) {
    if (receipt.transactionId) {
      const t = await getTransaction(ctx.state.svc, receipt.transactionId, { includeDeleted: true }).catch(() => null);
      if (t && !t.deletedAt) return showTransaction(ctx, t, "Struk ini sudah pernah dikirim. Ini transaksinya:");
    }
    return reply(ctx, "Struk ini sudah pernah dikirim sebelumnya, jadi tidak dibuat transaksi baru. Cek di dashboard menu Transaksi → Struk.");
  }
}

// ---------------------------------------------------------------------------
// Tombol inline
// ---------------------------------------------------------------------------

async function handleCallback(ctx: BotContext) {
  const data = ctx.callbackQuery?.data ?? "";
  const [prefix, action, id, arg] = data.split(":");
  if (prefix === "pa" && action && id) return handlePendingCallback(ctx, action, id, arg);
  if (prefix === "q" && action) return handleQuestionCallback(ctx, action);
  if (prefix !== "tx" || !action || !id) return ctx.answerCallbackQuery();
  const svc = ctx.state.svc;

  try {
    switch (action) {
      case "save": {
        const t = await getTransaction(svc, id);
        if (t.status === "confirmed") {
          await ctx.answerCallbackQuery({ text: "Sudah tersimpan." });
          return showTransaction(ctx, t, undefined, true);
        }
        if (await askMissing(ctx, t, true)) return ctx.answerCallbackQuery({ text: "Lengkapi dulu ya." });
        const saved = await patchTransaction(svc, id, { status: "confirmed" });
        await learnCategory(svc, saved).catch(() => undefined);
        await ctx.answerCallbackQuery({ text: "Tersimpan ✅" });
        await showTransaction(ctx, saved, undefined, true);
        if (saved.type === "expense") await notifyBudgetAfterSave(ctx);
        return;
      }
      case "edit": {
        const t = await patchTransaction(svc, id, { status: "draft" });
        await ctx.answerCallbackQuery({ text: "Mode ubah. Tekan Simpan jika sudah." });
        return showTransaction(ctx, t, undefined, true);
      }
      case "amt": {
        await setAwaiting(ctx.state.telegramUserId, "amount", id);
        await ctx.answerCallbackQuery();
        return reply(ctx, "Kirim nominal baru, mis. <code>80rb</code>.");
      }
      case "split": {
        const t = await getTransaction(svc, id);
        await setAwaiting(ctx.state.telegramUserId, "split", id);
        await ctx.answerCallbackQuery();
        return reply(
          ctx,
          `Kirim pembagian total ${esc(formatRupiah(Number(t.amount)))}, satu bagian per baris:\n<code>makan 50rb\nbelanja 100rb</code>`,
        );
      }
      case "cat": {
        const t = await getTransaction(svc, id);
        const kind = t.type === "expense" ? "expense" : "income";
        await ctx.answerCallbackQuery();
        return ctx.editMessageText(`${transactionSummary(t)}\n\n<b>Pilih kategori:</b>`, {
          ...HTML,
          reply_markup: choiceKeyboard(await categoryChoices(svc, kind), "setc", id, 2),
        });
      }
      case "acc": {
        const t = await getTransaction(svc, id);
        const pickTo = t.type === "income" || t.type === "investment_income";
        await ctx.answerCallbackQuery();
        return ctx.editMessageText(
          `${transactionSummary(t)}\n\n<b>${t.type === "transfer" ? "Transfer dari rekening mana?" : "Pilih rekening:"}</b>`,
          { ...HTML, reply_markup: choiceKeyboard(await accountChoices(svc), pickTo ? "sett" : "setf", id) },
        );
      }
      case "setf":
      case "sett": {
        if (!arg) return ctx.answerCallbackQuery();
        let t = await getTransaction(svc, id);
        const patch = action === "setf" ? { fromAccountId: arg } : { toAccountId: arg };
        if (t.type === "transfer" && action === "setf" && t.toAccountId === arg) Object.assign(patch, { toAccountId: null });
        if (t.type === "transfer" && action === "sett" && t.fromAccountId === arg) {
          await ctx.answerCallbackQuery({ text: "Rekening tujuan harus beda dengan asal." });
          return;
        }
        t = await patchTransaction(svc, id, patch);
        await ctx.answerCallbackQuery({ text: "Rekening dipilih." });
        // Transfer: setelah memilih asal lewat "Ubah rekening", lanjut pilih tujuan.
        if (t.type === "transfer" && action === "setf") {
          return ctx.editMessageText(`${transactionSummary(t)}\n\n<b>Transfer ke rekening mana?</b>`, {
            ...HTML,
            reply_markup: choiceKeyboard((await accountChoices(svc)).filter((a) => a.id !== arg), "sett", id),
          });
        }
        if (await askMissing(ctx, t, true)) return;
        return showTransaction(ctx, t, undefined, true);
      }
      case "setc": {
        if (!arg) return ctx.answerCallbackQuery();
        const t = await patchTransaction(svc, id, { categoryId: arg, splits: [] });
        await ctx.answerCallbackQuery({ text: "Kategori dipilih." });
        if (await askMissing(ctx, t, true)) return;
        return showTransaction(ctx, t, undefined, true);
      }
      case "del": {
        const t = await getTransaction(svc, id);
        await ctx.answerCallbackQuery();
        return ctx.editMessageText(`${transactionSummary(t)}\n\n<b>Yakin hapus transaksi ini?</b>`, {
          ...HTML,
          reply_markup: { inline_keyboard: [[{ text: "Ya, hapus", callback_data: `tx:delok:${id}` }, { text: "Batal", callback_data: `tx:back:${id}` }]] },
        });
      }
      case "delok": {
        await deleteTransaction(svc, id);
        await ctx.answerCallbackQuery({ text: "Dihapus." });
        return ctx.editMessageText("🗑 Transaksi dihapus. Admin masih bisa memulihkannya dari dashboard.");
      }
      case "undo": {
        const t = await getTransaction(svc, id);
        if (!isUndoable(t)) {
          await ctx.answerCallbackQuery({ text: "Sudah lewat 10 menit. Pakai tombol Hapus.", show_alert: true });
          return showTransaction(ctx, t, undefined, true);
        }
        await deleteTransaction(svc, id);
        await ctx.answerCallbackQuery({ text: "Dibatalkan." });
        return ctx.editMessageText("↩️ Transaksi dibatalkan dan tidak dihitung ke saldo.");
      }
      case "back": {
        const t = await getTransaction(svc, id);
        await ctx.answerCallbackQuery();
        return showTransaction(ctx, t, undefined, true);
      }
      default:
        return ctx.answerCallbackQuery();
    }
  } catch (err) {
    const payload = toErrorPayload(err);
    if (payload.code === "internal") logger.error("Callback Telegram gagal", { err, action });
    await ctx.answerCallbackQuery({ text: payload.message.slice(0, 190), show_alert: true }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Registrasi
// ---------------------------------------------------------------------------

export function registerHandlers(bot: Bot<BotContext>, allowedUserIds: Set<string>) {
  // 1) Hanya chat pribadi dari pengguna yang diizinkan.
  bot.use(async (ctx, next) => {
    const from = ctx.from;
    if (!from || from.is_bot) return;
    if (ctx.chat && ctx.chat.type !== "private") return;
    if (!allowedUserIds.has(String(from.id))) {
      logger.warn("Pesan Telegram dari pengguna tidak diizinkan diabaikan", { telegramUserId: String(from.id) });
      if (ctx.message?.text?.startsWith("/start")) await ctx.reply("Maaf, bot ini bersifat privat.");
      return;
    }
    const identity = await resolveIdentity(from, ctx.chat?.id);
    if (!identity) {
      await ctx.reply("Akun dashboard belum dibuat. Buat pengguna pemilik terlebih dahulu (lihat README).");
      return;
    }
    ctx.state = identity;
    await next();
  });

  bot.command("start", (ctx) =>
    reply(ctx, `Halo, ${esc(ctx.from?.first_name ?? "")}! 👋\nAku siap mencatat keuanganmu.\n\n${HELP_TEXT}`),
  );
  bot.command(["bantuan", "help"], (ctx) => reply(ctx, HELP_TEXT));
  bot.command("saldo", cmdSaldo);
  bot.command("ringkasan", cmdRingkasan);
  bot.command("transaksi", cmdTransaksi);
  bot.command("anggaran", cmdAnggaran);
  bot.command("hutang", cmdDebts("payable"));
  bot.command("piutang", cmdDebts("receivable"));
  bot.command("investasi", cmdInvestasi);
  bot.command("batal", async (ctx) => {
    await setAwaiting(ctx.state.telegramUserId, null);
    return reply(ctx, "Dibatalkan. Draf yang sudah dibuat tetap ada dan bisa dihapus dari pesannya atau dashboard.");
  });

  bot.on("callback_query:data", handleCallback);
  bot.on("message:text", handleText);
  bot.on(["message:photo", "message:document"], handlePhoto);

  bot.catch(async (err) => {
    const payload = toErrorPayload(err.error);
    if (payload.code === "internal") logger.error("Handler Telegram gagal", { err: err.error });
    await err.ctx.reply(payload.code === "internal" ? "Maaf, terjadi kesalahan. Coba lagi sebentar lagi." : payload.message).catch(() => undefined);
  });
}
