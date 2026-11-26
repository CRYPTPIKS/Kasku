/**
 * Kelola webhook Telegram untuk production.
 *   npm run telegram:webhook -- set     # daftarkan APP_URL/api/telegram/webhook
 *   npm run telegram:webhook -- info    # status webhook
 *   npm run telegram:webhook -- delete  # hapus webhook
 */
import { Api } from "grammy";
import { telegramConfig } from "../src/server/telegram/config";

async function main() {
  const cmd = process.argv[2] ?? "info";
  const cfg = telegramConfig();
  const api = new Api(cfg.token);
  if (cmd === "set") {
    const appUrl = process.env.APP_URL;
    if (!appUrl?.startsWith("https://")) throw new Error("APP_URL harus https:// agar webhook Telegram bisa dipakai.");
    if (!cfg.webhookSecret) throw new Error("Isi TELEGRAM_WEBHOOK_SECRET terlebih dahulu.");
    const url = `${appUrl.replace(/\/$/, "")}/api/telegram/webhook`;
    await api.setWebhook(url, {
      secret_token: cfg.webhookSecret,
      allowed_updates: ["message", "callback_query"],
      max_connections: 10,
    });
    await api.setMyCommands([
      { command: "saldo", description: "Saldo semua rekening" },
      { command: "ringkasan", description: "Ringkasan bulan ini" },
      { command: "transaksi", description: "10 transaksi terakhir" },
      { command: "anggaran", description: "Anggaran bulan ini" },
      { command: "hutang", description: "Daftar hutang" },
      { command: "piutang", description: "Daftar piutang" },
      { command: "investasi", description: "Ringkasan investasi" },
      { command: "batal", description: "Batalkan input yang berjalan" },
      { command: "bantuan", description: "Cara memakai bot" },
    ]);
    console.log(`✓ Webhook terpasang: ${url}`);
  } else if (cmd === "delete") {
    await api.deleteWebhook();
    console.log("✓ Webhook dihapus.");
  } else {
    const info = await api.getWebhookInfo();
    console.log({
      url: info.url || "(tidak ada)",
      pending_update_count: info.pending_update_count,
      last_error_date: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
      last_error_message: info.last_error_message ?? null,
    });
  }
}

main().catch((e) => {
  console.error("Gagal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
