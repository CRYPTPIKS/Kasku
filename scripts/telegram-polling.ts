/**
 * Mode polling untuk DEVELOPMENT LOKAL (tanpa domain publik/HTTPS).
 *   npm run telegram:polling
 * Menghapus webhook yang aktif, lalu mengambil update dengan getUpdates.
 * Update tetap lewat processUpdate() sehingga idempotensi & whitelist sama dengan webhook.
 */
import { getBot, processUpdate } from "../src/server/telegram/bot";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Polling hanya untuk development. Di production gunakan webhook (npm run telegram:webhook -- set).");
  }
  const { bot, ready } = getBot();
  await ready;
  await bot.api.deleteWebhook();
  console.log(`✓ Polling aktif untuk @${bot.botInfo.username}. Tekan Ctrl+C untuk berhenti.`);
  let offset = 0;
  let running = true;
  process.on("SIGINT", () => {
    running = false;
    console.log("\nBerhenti…");
  });
  while (running) {
    try {
      const updates = await bot.api.getUpdates({ offset, timeout: 25, allowed_updates: ["message", "callback_query"] });
      for (const u of updates) {
        offset = u.update_id + 1;
        const result = await processUpdate(bot, u);
        console.log(`update ${u.update_id}: ${result}`);
      }
    } catch (err) {
      console.error("Gagal mengambil update:", err instanceof Error ? err.message : err);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
