import { NextResponse, type NextRequest } from "next/server";
import type { Update } from "grammy/types";
import { logger } from "@/server/logger";
import { getBot, processUpdate, safeEqual } from "@/server/telegram/bot";
import { isTelegramConfigured, telegramConfig } from "@/server/telegram/config";

export const dynamic = "force-dynamic";

/**
 * Webhook Telegram. Diverifikasi dengan header X-Telegram-Bot-Api-Secret-Token.
 * Selalu membalas 200 untuk update valid agar Telegram tidak mengirim ulang;
 * idempotensi dijamin oleh ProcessedTelegramUpdate.
 */
export async function POST(req: NextRequest) {
  if (!isTelegramConfigured()) return NextResponse.json({ ok: false }, { status: 404 });
  const cfg = telegramConfig();
  if (!cfg.webhookSecret) {
    logger.error("TELEGRAM_WEBHOOK_SECRET belum diisi; webhook ditolak");
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  const header = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeEqual(header, cfg.webhookSecret)) {
    logger.warn("Webhook Telegram dengan secret salah ditolak");
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: Update;
  try {
    update = (await req.json()) as Update;
    if (typeof update?.update_id !== "number") throw new Error("update_id tidak ada");
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { bot, ready } = getBot();
  await ready;
  const result = await processUpdate(bot, update);
  return NextResponse.json({ ok: true, result });
}
