/**
 * Jalankan pengingat sekali (cicilan jatuh tempo & anggaran 80%/100%).
 * Untuk instalasi tanpa worker/Redis, pasang di cron, mis. tiap 15 menit:
 *   *\/15 * * * *  cd /opt/kasku && npm run reminders
 * Di Docker Compose, service `worker` sudah menjalankannya otomatis.
 */
import { prisma } from "../src/server/db";
import { runReminders } from "../src/server/notifications/reminders";
import { telegramSender } from "../src/server/notifications/telegram-sender";

async function main() {
  const result = await runReminders(telegramSender());
  console.log(JSON.stringify(result));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
