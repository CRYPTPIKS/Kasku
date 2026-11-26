import { Prisma } from "@prisma/client";
import { Bot, type Transformer } from "grammy";
import type { BotFullInfo, Update } from "grammy/types";
import { prisma } from "../db";
import { logger } from "../logger";
import { telegramConfig } from "./config";
import { registerHandlers, type BotContext } from "./handlers";

export interface CreateBotOptions {
  token: string;
  allowedUserIds: Set<string>;
  /** Isi untuk melewati getMe (test). */
  botInfo?: BotFullInfo;
  /** Penyadap panggilan API (test). */
  transformer?: Transformer;
}

export function createBot(opts: CreateBotOptions) {
  const bot = new Bot<BotContext>(opts.token, opts.botInfo ? { botInfo: opts.botInfo } : undefined);
  if (opts.transformer) bot.api.config.use(opts.transformer);
  registerHandlers(bot, opts.allowedUserIds);
  return bot;
}

let singleton: { bot: Bot<BotContext>; ready: Promise<void> } | null = null;

export function getBot() {
  if (!singleton) {
    const cfg = telegramConfig();
    const bot = createBot({ token: cfg.token, allowedUserIds: cfg.allowedUserIds });
    singleton = { bot, ready: bot.init() };
    singleton.ready.catch(() => {
      singleton = null;
    });
  }
  return singleton;
}

function updateKind(u: Update) {
  if (u.message?.photo) return "photo";
  if (u.message?.text?.startsWith("/")) return "command";
  if (u.message?.text) return "text";
  if (u.callback_query) return "callback";
  return Object.keys(u).find((k) => k !== "update_id") ?? "unknown";
}

export type ProcessResult = "processed" | "duplicate" | "failed";

/**
 * Proses satu update secara idempoten. update_id dicatat lebih dulu (primary key),
 * sehingga update yang dikirim ulang Telegram tidak membuat transaksi ganda.
 */
export async function processUpdate(bot: Bot<BotContext>, update: Update): Promise<ProcessResult> {
  const from = update.message?.from ?? update.callback_query?.from ?? update.edited_message?.from;
  try {
    await prisma.processedTelegramUpdate.create({
      data: {
        updateId: BigInt(update.update_id),
        telegramUserId: from ? BigInt(from.id) : null,
        kind: updateKind(update),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      logger.info("Update Telegram duplikat diabaikan", { updateId: update.update_id });
      return "duplicate";
    }
    throw err;
  }

  try {
    await bot.handleUpdate(update);
    return "processed";
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Gagal memproses update Telegram", { updateId: update.update_id, err: error });
    await prisma.processedTelegramUpdate
      .update({ where: { updateId: BigInt(update.update_id) }, data: { status: "failed", error: error.message.slice(0, 500) } })
      .catch(() => undefined);
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId) await bot.api.sendMessage(chatId, "Maaf, terjadi kesalahan. Coba lagi sebentar lagi.").catch(() => undefined);
    return "failed";
  }
}

/** Bandingkan secret token tanpa membocorkan waktu. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}
