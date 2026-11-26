import { Api } from "grammy";
import { configureReceiptQueue, redisConnection } from "../queue/receipts";
import { telegramReceiptNotifier } from "../telegram/receipt-notifier";
import { setReceiptNotifier } from "./service";

let ready = false;

/**
 * Siapkan pemrosesan struk di proses aplikasi web:
 * - pakai antrean BullMQ jika REDIS_URL ada (worker terpisah yang membaca & memberi tahu),
 * - jika tidak, proses langsung di sini dan kirim notifikasi Telegram dari sini.
 */
export function ensureReceiptRuntime() {
  if (ready) return;
  ready = true;
  configureReceiptQueue();
  if (!redisConnection() && process.env.TELEGRAM_BOT_TOKEN) {
    setReceiptNotifier(telegramReceiptNotifier(new Api(process.env.TELEGRAM_BOT_TOKEN)));
  }
}
