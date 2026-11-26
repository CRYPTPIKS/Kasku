import { Api } from "grammy";
import type { NotificationSender } from "./reminders";

/** Pengirim pengingat lewat Bot API. Null jika token bot belum diatur. */
export function telegramSender(token = process.env.TELEGRAM_BOT_TOKEN): NotificationSender | null {
  if (!token) return null;
  const api = new Api(token);
  return async (chatId, html) => {
    await api.sendMessage(Number(chatId), html, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  };
}
