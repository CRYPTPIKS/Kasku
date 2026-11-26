import type { Api } from "grammy";
import { formatRupiah } from "@/lib/money";
import { prisma } from "../db";
import type { ReceiptNotifier } from "../receipts/service";
import { draftKeyboard, esc, transactionSummary } from "./format";

/** Kirim hasil pembacaan struk ke chat Telegram asal foto. */
export function telegramReceiptNotifier(api: Api): ReceiptNotifier {
  return {
    async extracted(receipt, t, e) {
      if (!receipt.telegramChatId) return;
      const lines = ["🧾 <b>Struk terbaca</b>"];
      if (e.merchant) lines.push(`Toko: ${esc(e.merchant)}`);
      const extras = [
        e.discount ? `diskon ${formatRupiah(e.discount)}` : null,
        e.serviceCharge ? `layanan ${formatRupiah(e.serviceCharge)}` : null,
        e.tax ? `pajak ${formatRupiah(e.tax)}` : null,
      ].filter(Boolean);
      if (extras.length) lines.push(`Termasuk ${esc(extras.join(", "))}`);
      if (e.paymentMethod) lines.push(`Metode bayar: ${esc(e.paymentMethod)}`);
      if (e.items.length) lines.push(`${e.items.length} item terbaca`);
      if (e.confidence < 0.5) lines.push("⚠️ Total kurang yakin, mohon dicek.");
      const missingAccount = !t.fromAccountId ? "\n\n<b>Pilih rekening</b> lewat tombol Ubah rekening sebelum Simpan." : "";
      await api.sendMessage(Number(receipt.telegramChatId), `${lines.join("\n")}\n\n${transactionSummary(t)}${missingAccount}`, {
        parse_mode: "HTML",
        reply_markup: draftKeyboard(t),
        ...(receipt.telegramMessageId ? { reply_parameters: { message_id: receipt.telegramMessageId, allow_sending_without_reply: true } } : {}),
      });
    },
    async failed(receipt, reason) {
      if (!receipt.telegramChatId) return;
      const identity = await prisma.telegramIdentity.findFirst({ where: { chatId: receipt.telegramChatId } });
      if (identity) {
        await prisma.telegramChatState.upsert({
          where: { telegramUserId: identity.telegramUserId },
          create: { telegramUserId: identity.telegramUserId, awaiting: "receipt_amount", receiptId: receipt.id, expiresAt: new Date(Date.now() + 30 * 60000) },
          update: { awaiting: "receipt_amount", receiptId: receipt.id, transactionId: null, expiresAt: new Date(Date.now() + 30 * 60000) },
        });
      }
      await api.sendMessage(
        Number(receipt.telegramChatId),
        `😕 ${esc(reason)} Fotonya tetap tersimpan.\n\nBalas dengan <b>total pembayaran</b> (mis. <code>43rb</code>) untuk membuat draf, atau isi lewat dashboard di menu Transaksi → Struk.`,
        {
          parse_mode: "HTML",
          ...(receipt.telegramMessageId ? { reply_parameters: { message_id: receipt.telegramMessageId, allow_sending_without_reply: true } } : {}),
        },
      );
    },
  };
}
