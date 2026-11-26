/**
 * Antrean pembacaan struk.
 * - Dengan REDIS_URL: BullMQ (worker terpisah: npm run worker).
 * - Tanpa REDIS_URL: diproses langsung di proses aplikasi (cukup untuk development).
 */
import { Queue } from "bullmq";
import { logger } from "../logger";
import { setReceiptScheduler } from "../receipts/service";

export const RECEIPT_QUEUE = "receipts";

export function redisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== "/" ? Number(u.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

let queue: Queue | null = null;
let configured = false;

/** Pasang penjadwal BullMQ jika REDIS_URL tersedia. Aman dipanggil berulang. */
export function configureReceiptQueue() {
  if (configured) return;
  configured = true;
  const connection = redisConnection();
  if (!connection) {
    logger.info("REDIS_URL kosong: struk diproses langsung tanpa antrean");
    return;
  }
  queue = new Queue(RECEIPT_QUEUE, { connection });
  setReceiptScheduler(async (receiptId) => {
    await queue!.add(
      "extract",
      { receiptId },
      { jobId: `${receiptId}-${Date.now()}`, attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 1000, removeOnFail: 5000 },
    );
  });
}
