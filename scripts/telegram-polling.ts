/**
 * Mode polling untuk server tanpa alamat publik (development lokal atau home lab).
 *   npm run telegram:polling
 * Di production (Docker) dipakai service `bot` dengan TELEGRAM_POLLING=true.
 * Menghapus webhook yang aktif, lalu mengambil update dengan getUpdates.
 * Update tetap lewat processUpdate() sehingga idempotensi & whitelist sama dengan webhook.
 */
import { getBot, processUpdate } from "../src/server/telegram/bot";
import { BOT_COMMANDS } from "../src/server/telegram/commands";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.TELEGRAM_POLLING !== "true") {
    throw new Error("Di production gunakan webhook (npm run telegram:webhook -- set), atau set TELEGRAM_POLLING=true untuk mode polling.");
  }
  const { bot, ready } = getBot();
  await ready;
  await bot.api.deleteWebhook();
  await bot.api.setMyCommands(BOT_COMMANDS);
  console.log(`✓ Polling aktif untuk @${bot.botInfo.username}. Tekan Ctrl+C untuk berhenti.`);
  let offset = 0;
  let running = true;
  const stop = () => {
    running = false;
    console.log("\nBerhenti…");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
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
