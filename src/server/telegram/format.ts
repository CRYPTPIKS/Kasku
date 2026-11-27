import { InlineKeyboard } from "grammy";
import { formatDate } from "@/lib/dates";
import { formatRupiah } from "@/lib/money";
import { TRANSACTION_TYPE_LABELS } from "../ledger";
import type { TransactionWithRelations } from "../services/transactions";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Ringkasan transaksi (HTML) untuk balasan bot. */
export function transactionSummary(t: TransactionWithRelations): string {
  const lines: string[] = [];
  lines.push(`<b>${esc(TRANSACTION_TYPE_LABELS[t.type])} ${esc(formatRupiah(Number(t.amount)))}</b>`);
  if (t.description) lines.push(esc(t.description));
  if (t.type === "transfer") {
    lines.push(`Dari: ${esc(t.fromAccount?.name ?? "belum dipilih")}`);
    lines.push(`Ke: ${esc(t.toAccount?.name ?? "belum dipilih")}`);
  } else {
    if (t.splits.length) {
      lines.push("Kategori:");
      for (const s of t.splits) lines.push(`  • ${esc(s.category?.name ?? "Tanpa kategori")}: ${esc(formatRupiah(Number(s.amount)))}`);
    } else if (t.type === "expense" || t.type === "income" || t.type === "investment_income") {
      lines.push(`Kategori: ${esc(t.category?.name ?? "belum dipilih")}`);
    }
    const acc = t.type === "expense" ? t.fromAccount : t.toAccount ?? t.fromAccount;
    lines.push(`Rekening: ${esc(acc?.name ?? "belum dipilih")}`);
  }
  lines.push(`Tanggal: ${esc(formatDate(t.occurredAt))}`);
  lines.push(t.status === "draft" ? "Status: <i>draf, belum disimpan</i>" : "Status: ✅ tersimpan");
  return lines.join("\n");
}

export function draftKeyboard(t: TransactionWithRelations): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("✅ Simpan", `tx:save:${t.id}`)
    .row()
    .text("Ubah nominal", `tx:amt:${t.id}`)
    .text(t.type === "transfer" ? "Ubah rekening" : "Ubah kategori", t.type === "transfer" ? `tx:acc:${t.id}` : `tx:cat:${t.id}`)
    .row();
  if (t.type !== "transfer") kb.text("Ubah rekening", `tx:acc:${t.id}`);
  if (t.type === "expense") kb.text("Bagi transaksi", `tx:split:${t.id}`);
  kb.row().text("🗑 Hapus", `tx:del:${t.id}`);
  return kb;
}

/** Tombol "Batalkan" tersedia 10 menit setelah transaksi disimpan. */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

export function isUndoable(t: Pick<TransactionWithRelations, "status" | "type" | "updatedAt">, now = Date.now()): boolean {
  return (
    t.status === "confirmed" &&
    ["income", "expense", "transfer"].includes(t.type) &&
    now - new Date(t.updatedAt).getTime() <= UNDO_WINDOW_MS
  );
}

export function savedKeyboard(t: TransactionWithRelations): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (isUndoable(t)) kb.text("↩️ Batalkan", `tx:undo:${t.id}`).row();
  return kb.text("Ubah", `tx:edit:${t.id}`).text("🗑 Hapus", `tx:del:${t.id}`);
}

export function choiceKeyboard(
  items: { id: string; label: string }[],
  action: string,
  transactionId: string,
  perRow = 3,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  items.forEach((item, i) => {
    kb.text(item.label.slice(0, 30), `tx:${action}:${transactionId}:${item.id}`);
    if ((i + 1) % perRow === 0) kb.row();
  });
  if (items.length % perRow !== 0) kb.row();
  kb.text("« Kembali", `tx:back:${transactionId}`);
  return kb;
}

export const HELP_TEXT = `<b>Cara mencatat</b>
Kirim pesan seperti:
• <code>keluar 75rb makan siang pakai cash</code>
• <code>bayar listrik 425000 dari BCA</code>
• <code>masuk 12jt gaji bulan November</code>
• <code>transfer 500rb dari BCA ke GoPay</code>
• <code>kemarin bensin 50rb gopay</code>
• <code>setor 2jt ke BRI</code>

Hutang, piutang, investasi:
• <code>pinjam 2jt dari Budi ke BCA cicilan 500rb tiap tanggal 10</code>
• <code>pinjamkan 300rb ke Andi dari cash</code>
• <code>bayar hutang 500rb ke Budi dari BCA</code>
• <code>beli BBCA 2 lot @9500 dari BCA</code>
• <code>dividen BBCA 150rb ke BCA</code>
Atau kirim <b>foto struk</b>.

<b>Tanya langsung</b>
• <i>berapa saldo BCA?</i>
• <i>pengeluaran makan minggu ini</i>
• <i>ringkasan bulan lalu</i>
• <i>hutang ke Budi berapa?</i>
• <i>sisa anggaran belanja</i>
• <i>laba usaha bulan ini</i>
• <i>hapus yang tadi</i> — hapus catatan terakhir dari bot

Nominal bisa ditulis 75rb, 1,5jt, 2 juta, atau Rp 25.000.
Setiap catatan muncul sebagai <b>draf</b>. Tekan <b>Simpan</b> agar masuk ke saldo. Salah? Tekan <b>Batalkan</b> (10 menit).

<b>Perintah</b>
/saldo — saldo semua rekening
/ringkasan — ringkasan bulan ini
/transaksi — 10 transaksi terakhir
/anggaran — anggaran bulan ini
/hutang — daftar hutang
/piutang — daftar piutang
/investasi — ringkasan investasi
/batal — batalkan input yang sedang berjalan
/bantuan — pesan ini`;
