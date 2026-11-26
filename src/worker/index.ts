/**
 * Worker antrean struk (BullMQ). Jalankan: npm run worker
 * Membutuhkan REDIS_URL, DATABASE_URL, konfigurasi storage, dan (opsional) Telegram.
 */
import { Api } from "grammy";
import { Worker } from "bullmq";
import { logger } from "../server/logger";
import { RECEIPT_QUEUE, redisConnection } from "../server/queue/receipts";
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
  logger.info("Worker struk berjalan", { provider: provider.name });

  const shutdown = async () => {
    logger.info("Menghentikan worker…");
    await worker.close();
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
