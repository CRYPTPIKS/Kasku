/**
 * Jawaban bot untuk perintah baca (/saldo, /ringkasan, /transaksi) dan
 * pertanyaan bebas yang dikenali `detectQuestion`.
 */
import { InlineKeyboard } from "grammy";
import { currentMonthRange, formatDate, formatMonth, relativePeriodRange } from "@/lib/dates";
import { formatRupiah } from "@/lib/money";
import { PERIOD_LABELS, type Question, type QuestionPeriod } from "@/lib/parsing/question";
import { prisma } from "../db";
import { listAccounts, summarizeBalances } from "../services/accounts";
import { listBudgetStatus } from "../services/budgets";
import { businessReport } from "../services/businesses";
import { findActiveDebtsByCounterparty, nextInstallment } from "../services/debts";
import { periodTotals, totalsByCategory } from "../services/reports";
import { listTransactions } from "../services/transactions";
import { cmdAnggaran, cmdDebts, cmdInvestasi } from "./finance-handlers";
import { esc, HELP_TEXT } from "./format";
import type { BotContext } from "./handlers";

const HTML = { parse_mode: "HTML" as const };
const reply = (ctx: BotContext, text: string, extra: Record<string, unknown> = {}) => ctx.reply(text, { ...HTML, ...extra });

export async function cmdSaldo(ctx: BotContext) {
  const accounts = await listAccounts(ctx.state.svc);
  if (accounts.length === 0) return reply(ctx, "Belum ada rekening. Tambahkan dulu lewat dashboard.");
  const total = summarizeBalances(accounts);
  const lines = accounts.map((a) => `• ${esc(a.name)}: <b>${esc(formatRupiah(a.balance))}</b>`);
  return reply(ctx, `<b>Saldo rekening</b>\n${lines.join("\n")}\n\nTotal bersih: <b>${esc(formatRupiah(total.net))}</b>`);
}

export async function cmdRingkasan(ctx: BotContext) {
  const m = currentMonthRange();
  return periodSummary(ctx, "month", `Ringkasan ${formatMonth(m.year, m.month)}`);
}

export async function cmdTransaksi(ctx: BotContext) {
  const { items } = await listTransactions(ctx.state.svc, { pageSize: 10 });
  if (items.length === 0) return reply(ctx, "Belum ada transaksi. Coba kirim: <code>keluar 25rb kopi pakai cash</code>");
  const lines = items.map((t) => {
    const title = t.description || t.merchant || t.category?.name || "Transaksi";
    const draft = t.status === "draft" ? " <i>(draf)</i>" : "";
    return `• ${esc(formatDate(t.occurredAt))} — ${esc(title)}: ${esc(formatRupiah(Number(t.amount)))}${draft}`;
  });
  return reply(ctx, `<b>10 transaksi terakhir</b>\n${lines.join("\n")}`);
}

async function periodSummary(ctx: BotContext, period: QuestionPeriod, title?: string) {
  const { start, end } = relativePeriodRange(period);
  const [totals, cats] = await Promise.all([periodTotals(ctx.state.svc, start, end), totalsByCategory(ctx.state.svc, "expense", start, end)]);
  const top = cats.slice(0, 5).map((c) => `• ${esc(c.name)}: ${esc(formatRupiah(c.total))}`);
  return reply(
    ctx,
    [
      `<b>${esc(title ?? `Ringkasan ${PERIOD_LABELS[period]}`)}</b>`,
      `Pemasukan: <b>${esc(formatRupiah(totals.income))}</b>`,
      `Pengeluaran: <b>${esc(formatRupiah(totals.expense))}</b>`,
      `Selisih: <b>${esc(formatRupiah(totals.net))}</b>`,
      top.length ? `\nPengeluaran terbesar:\n${top.join("\n")}` : "",
    ].join("\n"),
  );
}

/** Total pengeluaran satu kategori, termasuk sub-kategorinya. */
async function categorySpending(ctx: BotContext, categoryId: string, start: Date, end: Date) {
  const svc = ctx.state.svc;
  const [cat, children, cats] = await Promise.all([
    prisma.category.findFirst({ where: { id: categoryId, householdId: svc.householdId } }),
    prisma.category.findMany({ where: { parentId: categoryId, householdId: svc.householdId }, select: { id: true } }),
    totalsByCategory(svc, "expense", start, end, { scope: "all" }),
  ]);
  const ids = new Set([categoryId, ...children.map((c) => c.id)]);
  const rows = cats.filter((c) => c.categoryId && ids.has(c.categoryId));
  return { name: cat?.name ?? "Kategori", total: rows.reduce((a, r) => a + r.total, 0), count: rows.reduce((a, r) => a + r.count, 0) };
}

export async function answerQuestion(ctx: BotContext, q: Exclude<Question, { kind: "undo" }>) {
  const svc = ctx.state.svc;
  switch (q.kind) {
    case "help":
      return reply(ctx, HELP_TEXT);
    case "balance": {
      if (!q.accountId) return cmdSaldo(ctx);
      const acc = (await listAccounts(svc)).find((a) => a.id === q.accountId);
      if (!acc) return cmdSaldo(ctx);
      return reply(ctx, `Saldo <b>${esc(acc.name)}</b>: <b>${esc(formatRupiah(acc.balance))}</b>`);
    }
    case "spending": {
      const { start, end } = relativePeriodRange(q.period);
      const label = PERIOD_LABELS[q.period];
      if (q.categoryId) {
        const s = await categorySpending(ctx, q.categoryId, start, end);
        return reply(ctx, `Pengeluaran <b>${esc(s.name)}</b> ${esc(label)}: <b>${esc(formatRupiah(s.total))}</b> (${s.count} transaksi)`);
      }
      const [totals, cats] = await Promise.all([periodTotals(svc, start, end), totalsByCategory(svc, "expense", start, end)]);
      const top = cats.slice(0, 3).map((c) => `• ${esc(c.name)}: ${esc(formatRupiah(c.total))}`);
      return reply(ctx, `Pengeluaran ${esc(label)}: <b>${esc(formatRupiah(totals.expense))}</b>${top.length ? `\n${top.join("\n")}` : ""}`);
    }
    case "income": {
      const { start, end } = relativePeriodRange(q.period);
      const [totals, cats] = await Promise.all([periodTotals(svc, start, end), totalsByCategory(svc, "income", start, end)]);
      const top = cats.slice(0, 3).map((c) => `• ${esc(c.name)}: ${esc(formatRupiah(c.total))}`);
      return reply(ctx, `Pemasukan ${esc(PERIOD_LABELS[q.period])}: <b>${esc(formatRupiah(totals.income))}</b>${top.length ? `\n${top.join("\n")}` : ""}`);
    }
    case "summary":
      return q.period === "month" ? cmdRingkasan(ctx) : periodSummary(ctx, q.period);
    case "debts": {
      if (!q.counterparty) return cmdDebts(q.direction)(ctx);
      const debts = await findActiveDebtsByCounterparty(svc, q.counterparty, q.direction);
      const label = q.direction === "payable" ? "hutang ke" : "piutang dari";
      if (debts.length === 0) return reply(ctx, `Tidak ada ${label} ${esc(q.counterparty)} yang masih berjalan.`);
      const lines = debts.map((d) => {
        const n = nextInstallment(d);
        const due = n?.dueDate ?? d.dueDate;
        return `• Sisa <b>${esc(formatRupiah(Number(d.remainingAmount)))}</b>${due ? `, jatuh tempo ${esc(formatDate(due))}` : ""}`;
      });
      return reply(ctx, `<b>${esc(label[0]!.toUpperCase() + label.slice(1))} ${esc(debts[0]!.counterparty)}</b>\n${lines.join("\n")}`);
    }
    case "business": {
      const m = currentMonthRange();
      const prev = new Date(Date.UTC(m.year, m.month - 2, 1));
      const [y, mo] = q.period === "last_month" ? [prev.getUTCFullYear(), prev.getUTCMonth() + 1] : [m.year, m.month];
      const reports = await businessReport(svc, y, mo, 1);
      if (reports.length === 0) return reply(ctx, "Belum ada usaha. Buat dulu di dashboard → Usaha.");
      const blocks = reports.map((r) => {
        const x = r.months[0]!;
        return [
          `<b>${esc(`${r.icon ? `${r.icon} ` : ""}${r.name}`)}</b>`,
          `Pendapatan: ${esc(formatRupiah(x.income))}`,
          `Biaya: ${esc(formatRupiah(x.expense))}`,
          `Laba kira-kira: <b>${esc(formatRupiah(x.profit))}</b>`,
          x.withdrawn ? `Diambil ke pribadi: ${esc(formatRupiah(x.withdrawn))}` : "",
          r.accounts.length ? `Saldo rekening usaha: ${esc(formatRupiah(r.balance))}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      });
      return reply(ctx, `<b>Usaha ${esc(formatMonth(y, mo))}</b>\n\n${blocks.join("\n\n")}`);
    }
    case "budget": {
      if (!q.categoryId) return cmdAnggaran(ctx);
      const s = await listBudgetStatus(svc);
      const b = s.items.find((i) => i.categoryId === q.categoryId);
      if (!b) return cmdAnggaran(ctx);
      return reply(
        ctx,
        `Anggaran <b>${esc(b.name)}</b>: terpakai ${esc(formatRupiah(b.spent))} dari ${esc(formatRupiah(b.amount))} (${Math.round(b.ratio * 100)}%). Sisa <b>${esc(formatRupiah(b.remaining))}</b>.`,
      );
    }
    case "investments":
      return cmdInvestasi(ctx);
    case "recent":
      return cmdTransaksi(ctx);
  }
}

/** Tombol pilihan saat pesan tidak dikenali. callback_data: q:<aksi>. */
export function notUnderstoodKeyboard() {
  return new InlineKeyboard()
    .text("💰 Saldo", "q:saldo")
    .text("📊 Ringkasan", "q:ringkasan")
    .row()
    .text("🧾 Transaksi terakhir", "q:transaksi")
    .text("❓ Contoh", "q:bantuan");
}

export async function handleQuestionCallback(ctx: BotContext, action: string) {
  await ctx.answerCallbackQuery();
  switch (action) {
    case "saldo":
      return cmdSaldo(ctx);
    case "ringkasan":
      return cmdRingkasan(ctx);
    case "transaksi":
      return cmdTransaksi(ctx);
    default:
      return reply(ctx, HELP_TEXT);
  }
}
