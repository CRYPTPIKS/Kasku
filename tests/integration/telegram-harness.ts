import type { Update } from "grammy/types";
import { createBot, processUpdate } from "@/server/telegram/bot";

/** Bot uji: semua panggilan API Telegram disadap, tanpa jaringan. */
export function createTestBot(ownerId = 111111) {
  type Call = { method: string; payload: Record<string, unknown> };
  const calls: Call[] = [];
  let updateId = 1;
  let messageId = 1;
  const bot = createBot({
    token: "123456:TEST-TOKEN-xxxxxxxxxxxxxxxxxxxxxxxx",
    allowedUserIds: new Set([String(ownerId)]),
    botInfo: { id: 42, is_bot: true, first_name: "Kasku", username: "kasku_test_bot" } as never,
    transformer: async (_prev, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      const result = method === "sendMessage" || method === "editMessageText" ? { message_id: messageId++, date: 0, chat: { id: ownerId, type: "private" } } : true;
      return { ok: true, result } as never;
    },
  });
  const chat = { id: ownerId, type: "private" as const, first_name: "Rafa" };
  const from = { id: ownerId, is_bot: false, first_name: "Rafa" };

  const send = (text: string) =>
    processUpdate(bot, {
      update_id: updateId++,
      message: {
        message_id: messageId++,
        date: Math.floor(Date.now() / 1000),
        chat,
        from,
        text,
        ...(text.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }] } : {}),
      },
    } as Update);

  const press = (data: string) =>
    processUpdate(bot, {
      update_id: updateId++,
      callback_query: { id: String(updateId), from, chat_instance: "x", data, message: { message_id: 1, date: 0, chat, text: "…" } },
    } as Update);

  const messages = () => calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText");
  const lastText = () => String(messages().at(-1)?.payload.text ?? "");
  const buttons = () =>
    ((messages().at(-1)?.payload.reply_markup as { inline_keyboard?: { text: string; callback_data: string }[][] })?.inline_keyboard ?? []).flat();
  const alerts = () => calls.filter((c) => c.method === "answerCallbackQuery").map((c) => String(c.payload.text ?? ""));
  const reset = () => void calls.splice(0);

  return { bot, calls, send, press, messages, lastText, buttons, alerts, reset };
}
