/**
 * Worker latar (BullMQ): membaca struk dan menjalankan pengingat tiap 15 menit.
 * Jalankan: npm run worker
 * Membutuhkan REDIS_URL, DATABASE_URL, konfigurasi storage, dan (opsional) Telegram.
 */
import { Api } from "grammy";
import { Queue, Worker } from "bullmq";
import { runReminders } from "../server/notifications/reminders";
import { telegramSender } from "../server/notifications/telegram-sender";
import { logger } from "../server/logger";
import { RECEIPT_QUEUE, redisConnection } from "../server/queue/receipts";

const REMINDER_QUEUE = "reminders";
import { processReceipt, setReceiptNotifier } from "../server/receipts/service";
import { getReceiptProvider } from "../server/receipts/providers";
import { telegramReceiptNotifier } from "../server/telegram/receipt-notifier";
import { prisma } from "../server/db";

async function main() {
  const connection = redisConnection();
  if (!connection) throw new Error("REDIS_URL belum diisi.");
  if (process.env.TELEGRAM_BOT_TOKEN) setReceiptNotifier(telegramReceiptNotifier(new Api(process.env.TELEGRAM_BOT_TOKEN)));
  const provider = getReceiptProvider();
  const worker = new Worker(
    RECEIPT_QUEUE,
    async (job) => {
      const result = await processReceipt(String(job.data.receiptId));
      logger.info("Struk diproses", { receiptId: job.data.receiptId, result });
      return result;
    },
    { connection, concurrency: Number(process.env.RECEIPT_WORKER_CONCURRENCY ?? 1) },
  );
  worker.on("failed", (job, err) => logger.error("Job struk gagal", { receiptId: job?.data.receiptId, err }));

  // Pengingat berkala. Penjadwal BullMQ memastikan hanya satu job per interval
  // walau worker dijalankan lebih dari satu.
  const send = telegramSender();
  const reminderQueue = new Queue(REMINDER_QUEUE, { connection });
  const everyMs = Number(process.env.REMINDER_INTERVAL_MINUTES ?? 15) * 60000;
  await reminderQueue.upsertJobScheduler("reminders", { every: everyMs }, { name: "run", opts: { removeOnComplete: 100, removeOnFail: 100 } });
  const reminderWorker = new Worker(
    REMINDER_QUEUE,
    async () => {
      const result = await runReminders(send);
      if (result.created || result.delivery?.sent || result.delivery?.failed) logger.info("Pengingat dijalankan", result);
      return result;
    },
    { connection, concurrency: 1 },
  );
  reminderWorker.on("failed", (_job, err) => logger.error("Job pengingat gagal", { err }));
  logger.info("Worker struk berjalan", { provider: provider.name });

  const shutdown = async () => {
    logger.info("Menghentikan worker…");
    await Promise.all([worker.close(), reminderWorker.close(), reminderQueue.close()]);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((e) => {
  logger.error("Worker gagal start", { err: e });
  process.exit(1);
});
