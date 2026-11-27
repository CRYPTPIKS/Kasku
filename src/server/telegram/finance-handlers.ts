/**
 * Bot Tahap 4: anggaran, hutang/piutang, investasi.
 *
 * Hutang & investasi tidak memakai draf transaksi biasa karena perlu data
 * tambahan (pihak, cicilan, unit, harga). Bot menyimpan usulan sebagai
 * TelegramPendingAction (30 menit) dan baru mencatat saat tombol Simpan ditekan.
 * callback_data: pa:<aksi>:<id>[:<arg>] (≤ 64 byte).
 */
import { InlineKeyboard } from "grammy";
import { addMonthsJakarta, formatDate, jakartaMidnight, jakartaParts } from "@/lib/dates";
import { formatRupiah } from "@/lib/money";
import { normalizeText, type ParsedTransaction } from "@/lib/parsing/transaction-text";
import { prisma } from "../db";
import type { ServiceContext } from "../context";
import { AppError, toErrorPayload } from "../errors";
import { logger } from "../logger";
import { budgetAlertText } from "../notifications/reminders";
import { listAccounts } from "../services/accounts";
import { claimBudgetAlerts, listBudgetStatus } from "../services/budgets";
import { createDebt, findActiveDebtsByCounterparty, listDebts, nextInstallment, recordDebtPayment } from "../services/debts";
import {
  ASSET_CLASS_LABELS,
  createAsset,
  findAsset,
  fmtUnits,
  getPortfolio,
  guessAssetClass,
  recordInvestmentTransaction,
} from "../services/investments";
import { esc } from "./format";
import type { BotContext } from "./handlers";

const HTML = { parse_mode: "HTML" as const };
const PENDING_TTL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Perintah
// ---------------------------------------------------------------------------

export async function cmdAnggaran(ctx: BotContext) {
  const s = await listBudgetStatus(ctx.state.svc);
  if (s.items.length === 0) return ctx.reply("Belum ada anggaran. Atur di dashboard menu Anggaran.", HTML);
  const bar = (r: number) => {
    const n = Math.min(10, Math.round(r * 10));
    return "▓".repeat(n) + "░".repeat(10 - n);
  };
  const lines = s.items.map((b) => {
    const icon = b.level === "over" ? "🚨" : b.level === "warn" ? "⚠️" : "✅";
    return `${icon} <b>${esc(b.name)}</b> ${Math.round(b.ratio * 100)}%\n<code>${bar(b.ratio)}</code> ${esc(formatRupiah(b.spent))} / ${esc(formatRupiah(b.amount))}`;
  });
  const footer = s.isCurrent && s.remaining > 0 ? `\nSisa ${esc(formatRupiah(s.remaining))}, sekitar ${esc(formatRupiah(Math.floor(s.dailyAllowance)))}/hari sampai akhir bulan.` : "";
  return ctx.reply(`<b>Anggaran bulan ini</b>\n\n${lines.join("\n\n")}\n${footer}`, HTML);
}

export function cmdDebts(direction: "payable" | "receivable") {
  return async (ctx: BotContext) => {
    const debts = await listDebts(ctx.state.svc, { direction });
    const label = direction === "payable" ? "hutang" : "piutang";
    if (debts.length === 0) {
      return ctx.reply(
        `Tidak ada ${label} berjalan. 🎉\nCatat baru: <code>${direction === "payable" ? "pinjam 2jt dari Budi ke BCA" : "pinjamkan 500rb ke Andi dari cash"}</code>`,
        HTML,
      );
    }
    const total = debts.reduce((a, d) => a + Number(d.remainingAmount), 0);
    const lines = debts.map((d) => {
      const n = nextInstallment(d);
      const due = n?.dueDate ?? d.dueDate;
      const late = d.status === "overdue" ? " ⏰ <b>terlambat</b>" : "";
      return `• ${esc(d.counterparty)}: <b>${esc(formatRupiah(Number(d.remainingAmount)))}</b>${due ? `, jatuh tempo ${esc(formatDate(due))}` : ""}${late}`;
    });
    const hint = direction === "payable" ? "bayar hutang 500rb ke Budi dari BCA" : "terima cicilan 200rb dari Andi ke BCA";
    return ctx.reply(`<b>Sisa ${label}: ${esc(formatRupiah(total))}</b>\n${lines.join("\n")}\n\nCatat pembayaran: <code>${hint}</code>`, HTML);
  };
}

export async function cmdInvestasi(ctx: BotContext) {
  const p = await getPortfolio(ctx.state.svc);
  const held = p.items.filter((i) => i.units > 0);
  if (held.length === 0) return ctx.reply("Belum ada investasi. Coba: <code>beli BBCA 2 lot @9500 dari BCA</code>", HTML);
  const lines = held.map((i) => {
    const sign = i.unrealized >= 0 ? "+" : "−";
    const detail = i.valuationMode === "value" ? "nilai total" : `${esc(fmtUnits(i.units))} ${esc(i.unitLabel)}`;
    return `• ${esc(i.symbol ?? i.name)}: ${esc(formatRupiah(i.marketValue))} (${sign}${esc(formatRupiah(Math.abs(i.unrealized)))}) · ${detail}`;
  });
  const u = p.totals.unrealized;
  return ctx.reply(
    `<b>Portofolio: ${esc(formatRupiah(p.totals.marketValue))}</b>\nModal ${esc(formatRupiah(p.totals.costBasis))}, ${u >= 0 ? "untung" : "rugi"} ${esc(formatRupiah(Math.abs(u)))}\n\n${lines.join("\n")}\n\n<i>Nilai memakai harga terakhir yang dicatat.</i>`,
    HTML,
  );
}

/** Setelah pengeluaran disimpan: kabari jika anggaran melewati 80%/100%. */
export async function notifyBudgetAfterSave(ctx: BotContext) {
  try {
    const alerts = await claimBudgetAlerts(ctx.state.svc);
    if (alerts.length) await ctx.reply(alerts.map(budgetAlertText).join("\n"), HTML);
  } catch (err) {
    logger.warn("Cek anggaran gagal", { reason: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Usulan tertunda
// ---------------------------------------------------------------------------

type DebtCreatePayload = {
  direction: "payable" | "receivable";
  counterparty: string;
  amount: number;
  accountId: string | null;
  occurredAt: string;
  installment: { amount: number; count: number; firstDueDate: string } | null;
};
type DebtPaymentPayload = {
  debtId: string;
  counterparty: string;
  direction: "payable" | "receivable";
  amount: number;
  remaining: number;
  accountId: string | null;
  occurredAt: string;
  installmentId: string | null;
};
type InvestmentPayload = {
  kind: "buy" | "sell" | "dividend";
  assetId: string | null;
  assetName: string;
  assetClass: keyof typeof ASSET_CLASS_LABELS;
  unitLabel: string;
  units: number | null;
  pricePerUnit: number | null;
  totalAmount: number;
  accountId: string | null;
  occurredAt: string;
};
type Pending =
  | { kind: "debt_create"; payload: DebtCreatePayload }
  | { kind: "debt_payment"; payload: DebtPaymentPayload }
  | { kind: "investment"; payload: InvestmentPayload };

async function savePending(ctx: BotContext, p: Pending) {
  // Bersihkan usulan lama yang kedaluwarsa.
  await prisma.telegramPendingAction.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return prisma.telegramPendingAction.create({
    data: {
      telegramUserId: ctx.state.telegramUserId,
      householdId: ctx.state.svc.householdId,
      kind: p.kind,
      payload: p.payload,
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    },
  });
}

async function loadPending(ctx: BotContext, id: string): Promise<(Pending & { id: string }) | null> {
  const row = await prisma.telegramPendingAction.findFirst({
    where: { id, telegramUserId: ctx.state.telegramUserId, householdId: ctx.state.svc.householdId, expiresAt: { gt: new Date() } },
  });
  return row ? ({ id: row.id, kind: row.kind, payload: row.payload } as Pending & { id: string }) : null;
}

async function accountName(svc: ServiceContext, id: string | null) {
  if (!id) return null;
  return (await prisma.account.findFirst({ where: { id, householdId: svc.householdId }, select: { name: true } }))?.name ?? null;
}

async function pendingSummary(svc: ServiceContext, p: Pending): Promise<string> {
  const acc = await accountName(svc, p.payload.accountId);
  const accLine = `Rekening: ${acc ? esc(acc) : "<i>tidak dicatat (opsional)</i>"}`;
  const date = `Tanggal: ${esc(formatDate(new Date(p.payload.occurredAt)))}`;
  switch (p.kind) {
    case "debt_create": {
      const d = p.payload;
      const lines = [
        d.direction === "payable"
          ? `<b>Hutang baru ${esc(formatRupiah(d.amount))}</b>\nMeminjam dari: ${esc(d.counterparty)}`
          : `<b>Piutang baru ${esc(formatRupiah(d.amount))}</b>\nDipinjamkan ke: ${esc(d.counterparty)}`,
      ];
      if (d.installment) {
        lines.push(`Cicilan: ${d.installment.count}× ${esc(formatRupiah(d.installment.amount))}, mulai ${esc(formatDate(new Date(d.installment.firstDueDate)))}`);
      }
      lines.push(accLine, date);
      return lines.join("\n");
    }
    case "debt_payment": {
      const d = p.payload;
      const after = Math.max(0, d.remaining - d.amount);
      return [
        d.direction === "payable" ? `<b>Bayar hutang ${esc(formatRupiah(d.amount))}</b>\nKe: ${esc(d.counterparty)}` : `<b>Terima cicilan ${esc(formatRupiah(d.amount))}</b>\nDari: ${esc(d.counterparty)}`,
        `Sisa setelah ini: ${after === 0 ? "<b>lunas</b> 🎉" : esc(formatRupiah(after))}`,
        accLine,
        date,
      ].join("\n");
    }
    case "investment": {
      const d = p.payload;
      const verb = { buy: "Beli", sell: "Jual", dividend: "Dividen" }[d.kind];
      const lines = [`<b>${verb} ${esc(d.assetName)} ${esc(formatRupiah(d.totalAmount))}</b>`];
      if (d.units) lines.push(`${esc(fmtUnits(d.units))} ${esc(d.unitLabel)}${d.pricePerUnit ? ` @ ${esc(formatRupiah(d.pricePerUnit))}` : ""}`);
      if (!d.assetId) lines.push(`Aset baru: ${esc(ASSET_CLASS_LABELS[d.assetClass])}`);
      lines.push(accLine, date);
      return lines.join("\n");
    }
  }
}

function pendingKeyboard(id: string) {
  return new InlineKeyboard().text("✅ Simpan", `pa:ok:${id}`).row().text("Ubah rekening", `pa:acc:${id}`).text("❌ Batal", `pa:no:${id}`);
}

async function showPending(ctx: BotContext, id: string, p: Pending, edit = false) {
  const text = `${await pendingSummary(ctx.state.svc, p)}\n\n<i>Tekan Simpan untuk mencatat.</i>`;
  if (edit && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { ...HTML, reply_markup: pendingKeyboard(id) });
      return;
    } catch {
      /* kirim baru */
    }
  }
  await ctx.reply(text, { ...HTML, reply_markup: pendingKeyboard(id) });
}

// ---------------------------------------------------------------------------
// Pesan teks: hutang/piutang & investasi
// ---------------------------------------------------------------------------

/** Cicilan dari teks ("cicilan 300rb tiap tanggal 10") -> jumlah & tanggal pertama. */
function planInstallments(principal: number, inst: NonNullable<ParsedTransaction["installment"]>, start: Date) {
  const count = Math.ceil(principal / inst.amount - 1e-9);
  const p = jakartaParts(start);
  let first: Date;
  if (inst.dayOfMonth) {
    const thisMonth = jakartaMidnight(p.year, p.month, Math.min(inst.dayOfMonth, 28));
    const candidate = addMonthsJakarta(thisMonth, 0, inst.dayOfMonth);
    first = candidate.getTime() > start.getTime() ? candidate : addMonthsJakarta(thisMonth, 1, inst.dayOfMonth);
  } else {
    first = addMonthsJakarta(start, 1);
  }
  return { amount: inst.amount, count, firstDueDate: first.toISOString() };
}

export async function handleFinanceIntent(ctx: BotContext, parsed: ParsedTransaction, rawText: string) {
  const svc = ctx.state.svc;
  const amount = parsed.amount!;
  const occurredAt = parsed.occurredAt.toISOString();

  if (parsed.intent === "debt_payable" || parsed.intent === "debt_receivable") {
    if (!parsed.counterparty) {
      return ctx.reply(`Dengan siapa? Kirim ulang dengan nama, mis. <code>${parsed.intent === "debt_payable" ? "pinjam 2jt dari Budi" : "pinjamkan 500rb ke Andi"}</code>`, HTML);
    }
    const payable = parsed.intent === "debt_payable";
    const p: Pending = {
      kind: "debt_create",
      payload: {
        direction: payable ? "payable" : "receivable",
        counterparty: parsed.counterparty,
        amount,
        accountId: payable ? parsed.toAccountId : parsed.fromAccountId,
        occurredAt,
        installment: parsed.installment ? planInstallments(amount, parsed.installment, parsed.occurredAt) : null,
      },
    };
    const row = await savePending(ctx, p);
    return showPending(ctx, row.id, p);
  }

  if (parsed.intent === "debt_payment") {
    if (!parsed.counterparty) return ctx.reply("Bayar ke/terima dari siapa? Mis. <code>bayar hutang 500rb ke Budi dari BCA</code>", HTML);
    const debts = await findActiveDebtsByCounterparty(svc, parsed.counterparty, parsed.debtDirection);
    if (debts.length === 0) {
      const what = parsed.debtDirection === "receivable" ? "piutang ke" : "hutang ke";
      return ctx.reply(`Tidak ada ${what} ${esc(parsed.counterparty)} yang masih berjalan. Cek /hutang atau /piutang.`, HTML);
    }
    const debt = debts[0]!;
    const payable = debt.direction === "payable";
    const next = nextInstallment(debt);
    const p: Pending = {
      kind: "debt_payment",
      payload: {
        debtId: debt.id,
        counterparty: debt.counterparty,
        direction: debt.direction,
        amount,
        remaining: Number(debt.remainingAmount),
        accountId: payable ? parsed.fromAccountId : parsed.toAccountId,
        occurredAt,
        installmentId: next?.id ?? null,
      },
    };
    const row = await savePending(ctx, p);
    return showPending(ctx, row.id, p);
  }

  // Investasi
  let kind: InvestmentPayload["kind"];
  let assetQuery = parsed.investment?.assetName ?? "";
  if (parsed.intent === "investment_buy") kind = "buy";
  else if (parsed.intent === "investment_sell") kind = "sell";
  else kind = "dividend";

  let asset = assetQuery ? await findAsset(svc, assetQuery) : null;
  if (!asset && kind === "dividend") {
    // "dividen BBCA 150rb": cari aset yang namanya/kodenya muncul di teks.
    const words = new Set(normalizeText(rawText).split(" "));
    const assets = await prisma.investmentAsset.findMany({ where: { householdId: svc.householdId, isArchived: false } });
    asset = assets.find((a) => (a.symbol && words.has(a.symbol.toLowerCase())) || normalizeText(rawText).includes(normalizeText(a.name))) ?? null;
    if (asset) assetQuery = asset.symbol ?? asset.name;
  }
  if (!asset && kind !== "buy") {
    return ctx.reply(`Aset ${assetQuery ? `“${esc(assetQuery)}” ` : ""}belum ada di portofolio. Cek /investasi atau tambahkan di dashboard.`, HTML);
  }
  if (!asset && !assetQuery) return ctx.reply("Aset apa yang dibeli? Mis. <code>beli BBCA 2 lot @9500 dari BCA</code>", HTML);

  const guess = guessAssetClass(assetQuery, parsed.investment?.unitLabel ?? null);
  const perLot = asset?.unitsPerLot ?? (guess.assetClass === "stock" ? 100 : null);
  let units = parsed.investment?.units ?? null;
  if (units !== null && parsed.investment?.unitLabel === "lot") units *= perLot ?? 100;
  // Harga dari teks adalah per lembar untuk saham; tanpa harga, hitung dari total.
  const price = parsed.investment?.pricePerUnit ?? (units ? Math.round((amount / units) * 100) / 100 : null);
  const assetName = asset ? (asset.symbol ?? asset.name) : /^[a-z]{4}$/i.test(assetQuery) ? assetQuery.toUpperCase() : assetQuery;

  const p: Pending = {
    kind: "investment",
    payload: {
      kind,
      assetId: asset?.id ?? null,
      assetName,
      assetClass: asset?.assetClass ?? guess.assetClass,
      unitLabel: asset?.unitLabel ?? guess.unitLabel,
      units: kind === "dividend" ? null : units,
      pricePerUnit: kind === "dividend" ? null : price,
      totalAmount: amount,
      accountId: kind === "buy" ? parsed.fromAccountId : parsed.toAccountId,
      occurredAt,
    },
  };
  const row = await savePending(ctx, p);
  return showPending(ctx, row.id, p);
}

// ---------------------------------------------------------------------------
// Tombol pa:*
// ---------------------------------------------------------------------------

async function commit(svc: ServiceContext, p: Pending): Promise<string> {
  const source = "telegram_text" as const;
  switch (p.kind) {
    case "debt_create": {
      const d = p.payload;
      const debt = await createDebt(
        svc,
        {
          direction: d.direction,
          counterparty: d.counterparty,
          principalAmount: d.amount,
          startDate: new Date(d.occurredAt),
          accountId: d.accountId,
          installmentCount: d.installment?.count ?? null,
          installmentAmount: d.installment?.amount ?? null,
          firstDueDate: d.installment ? new Date(d.installment.firstDueDate) : null,
          remainderLast: true,
        },
        { source },
      );
      return `✅ ${d.direction === "payable" ? "Hutang" : "Piutang"} tercatat. Sisa ${esc(formatRupiah(Number(debt.remainingAmount)))}.${d.installment ? " Aku akan mengingatkan sebelum tiap cicilan jatuh tempo." : ""}`;
    }
    case "debt_payment": {
      const d = p.payload;
      const { debt } = await recordDebtPayment(
        svc,
        d.debtId,
        { amount: d.amount, occurredAt: new Date(d.occurredAt), accountId: d.accountId, installmentId: d.installmentId },
        { source },
      );
      return debt.status === "paid"
        ? `✅ Tercatat. ${d.direction === "payable" ? "Hutang" : "Piutang"} ke ${esc(d.counterparty)} <b>lunas</b> 🎉`
        : `✅ Tercatat. Sisa ${esc(formatRupiah(Number(debt.remainingAmount)))}.`;
    }
    case "investment": {
      const d = p.payload;
      return prisma.$transaction(async (tx) => {
        let assetId = d.assetId;
        if (!assetId) {
          const existing = await tx.investmentAsset.findFirst({
            where: { householdId: svc.householdId, OR: [{ symbol: { equals: d.assetName, mode: "insensitive" } }, { name: { equals: d.assetName, mode: "insensitive" } }] },
          });
          assetId =
            existing?.id ??
            (
              await createAsset(
                svc,
                {
                  assetClass: d.assetClass,
                  name: d.assetName,
                  symbol: d.assetClass === "stock" || d.assetClass === "crypto" ? d.assetName : null,
                  unitLabel: d.unitLabel,
                },
                tx,
              )
            ).id;
        }
        const occurredAt = new Date(d.occurredAt);
        if (d.kind === "dividend") {
          await recordInvestmentTransaction(svc, assetId, { kind: "dividend", occurredAt, totalAmount: d.totalAmount, accountId: d.accountId }, { source, tx });
        } else {
          await recordInvestmentTransaction(
            svc,
            assetId,
            { kind: d.kind, occurredAt, units: d.units, pricePerUnit: d.pricePerUnit, totalAmount: d.totalAmount, accountId: d.accountId },
            { source, tx },
          );
        }
        return `✅ ${{ buy: "Pembelian", sell: "Penjualan", dividend: "Dividen" }[d.kind]} ${esc(d.assetName)} tercatat. Cek /investasi.`;
      });
    }
  }
}

export async function handlePendingCallback(ctx: BotContext, action: string, id: string, arg: string | undefined) {
  try {
    const p = await loadPending(ctx, id);
    if (!p) {
      await ctx.answerCallbackQuery({ text: "Usulan sudah kedaluwarsa. Kirim ulang pesannya ya.", show_alert: true });
      return;
    }
    switch (action) {
      case "ok": {
        const msg = await commit(ctx.state.svc, p);
        await prisma.telegramPendingAction.delete({ where: { id } }).catch(() => undefined);
        await ctx.answerCallbackQuery({ text: "Tersimpan ✅" });
        await ctx.editMessageText(`${await pendingSummary(ctx.state.svc, p)}\n\n${msg}`, HTML).catch(() => ctx.reply(msg, HTML));
        return;
      }
      case "no": {
        await prisma.telegramPendingAction.delete({ where: { id } }).catch(() => undefined);
        await ctx.answerCallbackQuery({ text: "Dibatalkan." });
        await ctx.editMessageText("Dibatalkan, tidak ada yang dicatat.").catch(() => undefined);
        return;
      }
      case "acc": {
        const accounts = await listAccounts(ctx.state.svc);
        const kb = new InlineKeyboard();
        accounts.forEach((a, i) => {
          kb.text(a.name.slice(0, 30), `pa:seta:${id}:${a.id}`);
          if ((i + 1) % 3 === 0) kb.row();
        });
        kb.row().text("Tanpa rekening", `pa:seta:${id}:-`).text("« Kembali", `pa:back:${id}`);
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(`${await pendingSummary(ctx.state.svc, p)}\n\n<b>Pilih rekening:</b>`, { ...HTML, reply_markup: kb });
        return;
      }
      case "seta": {
        if (!arg) return ctx.answerCallbackQuery();
        let accountId: string | null = null;
        if (arg !== "-") {
          const acc = await prisma.account.findFirst({ where: { id: arg, householdId: ctx.state.svc.householdId, isArchived: false } });
          if (!acc) throw new AppError("Rekening tidak ditemukan.");
          accountId = acc.id;
        }
        const payload = { ...p.payload, accountId };
        await prisma.telegramPendingAction.update({ where: { id }, data: { payload } });
        await ctx.answerCallbackQuery({ text: "Rekening dipilih." });
        return showPending(ctx, id, { ...p, payload } as Pending, true);
      }
      case "back":
        await ctx.answerCallbackQuery();
        return showPending(ctx, id, p, true);
      default:
        return ctx.answerCallbackQuery();
    }
  } catch (err) {
    const payload = toErrorPayload(err);
    if (payload.code === "internal") logger.error("Callback Telegram (pa) gagal", { err, action });
    await ctx.answerCallbackQuery({ text: payload.message.slice(0, 190), show_alert: true }).catch(() => undefined);
  }
}
