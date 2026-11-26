import { beforeEach, describe, expect, it } from "vitest";
import { currentMonthRange } from "@/lib/dates";
import { prisma } from "@/server/db";
import { deliverPendingNotifications, generateReminders } from "@/server/notifications/reminders";
import { getAccount } from "@/server/services/accounts";
import { claimBudgetAlerts, deleteBudget, listBudgetStatus, setBudget } from "@/server/services/budgets";
import { createDebt, debtSummary, deleteDebt, getDebt, listDebts, recordDebtPayment, upcomingDebtDues } from "@/server/services/debts";
import { createAsset, deleteInvestmentTransaction, getPortfolio, recordInvestmentTransaction, setAssetPrice } from "@/server/services/investments";
import { netWorth } from "@/server/services/networth";
import { createTransaction, deleteTransaction, restoreTransaction, updateTransaction, getTransaction, toInput } from "@/server/services/transactions";
import { periodTotals } from "@/server/services/reports";
import { resetDb, setupHousehold } from "./helpers";

let h: Awaited<ReturnType<typeof setupHousehold>>;
const DAY = 86400000;

beforeEach(async () => {
  await resetDb();
  h = await setupHousehold();
});

async function spend(amount: number, categoryId = h.food.id, occurredAt = new Date()) {
  return createTransaction(h.ctx, { type: "expense", amount, occurredAt, fromAccountId: h.cash.id, categoryId });
}

describe("anggaran", () => {
  it("menghitung pemakaian bulan berjalan, termasuk sub-kategori dan bagian transaksi", async () => {
    const sub = await prisma.category.create({ data: { householdId: h.household.id, kind: "expense", name: "Kopi", parentId: h.food.id } });
    await setBudget(h.ctx, { categoryId: h.food.id, amount: "1jt" });
    await spend(300_000);
    await spend(100_000, sub.id);
    await createTransaction(h.ctx, {
      type: "expense",
      amount: 150_000,
      occurredAt: new Date(),
      fromAccountId: h.cash.id,
      splits: [
        { categoryId: h.food.id, amount: 50_000 },
        { categoryId: h.groceries.id, amount: 100_000 },
      ],
    });
    // Bulan lalu & draf tidak dihitung.
    await spend(999_000, h.food.id, new Date(currentMonthRange().start.getTime() - DAY));
    await createTransaction(h.ctx, { type: "expense", status: "draft", amount: 500_000, occurredAt: new Date(), fromAccountId: h.cash.id, categoryId: h.food.id });

    const s = await listBudgetStatus(h.ctx);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ spent: 450_000, amount: 1_000_000, remaining: 550_000, level: "ok" });
    expect(s.dailyAllowance).toBeGreaterThan(0);
  });

  it("batas khusus bulan ini tidak mengubah default", async () => {
    await setBudget(h.ctx, { categoryId: h.food.id, amount: 1_000_000 });
    await setBudget(h.ctx, { categoryId: h.food.id, amount: 1_500_000, scope: "month" });
    const s = await listBudgetStatus(h.ctx);
    expect(s.items[0]).toMatchObject({ amount: 1_500_000, defaultAmount: 1_000_000, hasMonthOverride: true });
  });

  it("menolak kategori pemasukan", async () => {
    await expect(setBudget(h.ctx, { categoryId: h.salary.id, amount: 1000 })).rejects.toThrow(/pengeluaran/);
  });

  it("peringatan 80% dan 100% masing-masing sekali", async () => {
    await setBudget(h.ctx, { categoryId: h.food.id, amount: 100_000 });
    await spend(50_000);
    expect(await claimBudgetAlerts(h.ctx)).toHaveLength(0);
    await spend(35_000);
    const a1 = await claimBudgetAlerts(h.ctx);
    expect(a1.map((a) => a.threshold)).toEqual([80]);
    expect(await claimBudgetAlerts(h.ctx)).toHaveLength(0);
    await spend(20_000);
    expect((await claimBudgetAlerts(h.ctx, { categoryId: h.food.id })).map((a) => a.threshold)).toEqual([100]);
    expect(await claimBudgetAlerts(h.ctx)).toHaveLength(0);
  });

  it("langsung 100% hanya mengirim peringatan 100%", async () => {
    await setBudget(h.ctx, { categoryId: h.food.id, amount: 100_000 });
    await spend(150_000);
    expect((await claimBudgetAlerts(h.ctx)).map((a) => a.threshold)).toEqual([100]);
  });

  it("hapus anggaran", async () => {
    const b = await setBudget(h.ctx, { categoryId: h.food.id, amount: 100_000 });
    await deleteBudget(h.ctx, b.id);
    expect((await listBudgetStatus(h.ctx)).items).toHaveLength(0);
  });
});

describe("hutang & piutang", () => {
  it("hutang dengan rekening: uang masuk, cicilan FIFO, lunas", async () => {
    const debt = await createDebt(h.ctx, {
      direction: "payable",
      counterparty: "Budi",
      principalAmount: "3jt",
      startDate: new Date(),
      accountId: h.bca.id,
      installmentCount: 3,
      firstDueDate: new Date(Date.now() + 10 * DAY),
    });
    expect(Number(debt.remainingAmount)).toBe(3_000_000);
    expect((await getAccount(h.ctx, h.bca.id)).balance).toBe(13_000_000);
    // Pinjaman bukan pemasukan.
    const m = currentMonthRange();
    expect((await periodTotals(h.ctx, m.start, m.end)).income).toBe(0);

    await recordDebtPayment(h.ctx, debt.id, { amount: 1_500_000, occurredAt: new Date(), accountId: h.bca.id });
    let d = await getDebt(h.ctx, debt.id);
    expect(Number(d.remainingAmount)).toBe(1_500_000);
    expect(d.installments.map((i) => Number(i.paidAmount))).toEqual([1_000_000, 500_000, 0]);
    expect(d.installments[0]!.paidAt).not.toBeNull();
    expect(d.installments[1]!.paidAt).toBeNull();
    expect((await getAccount(h.ctx, h.bca.id)).balance).toBe(11_500_000);

    await expect(recordDebtPayment(h.ctx, debt.id, { amount: 2_000_000, occurredAt: new Date() })).rejects.toThrow(/melebihi/);
    await recordDebtPayment(h.ctx, debt.id, { amount: 1_500_000, occurredAt: new Date(), accountId: h.bca.id });
    d = await getDebt(h.ctx, debt.id);
    expect(d.status).toBe("paid");
    expect(Number(d.remainingAmount)).toBe(0);
    expect((await debtSummary(h.ctx)).payable).toBe(0);
  });

  it("hapus/pulihkan transaksi pembayaran menghitung ulang sisa", async () => {
    const debt = await createDebt(h.ctx, { direction: "receivable", counterparty: "Andi", principalAmount: 1_000_000, startDate: new Date(), accountId: h.cash.id });
    expect((await getAccount(h.ctx, h.cash.id)).balance).toBe(0);
    const { transaction } = await recordDebtPayment(h.ctx, debt.id, { amount: 400_000, occurredAt: new Date(), accountId: h.cash.id });
    expect(Number((await getDebt(h.ctx, debt.id)).remainingAmount)).toBe(600_000);
    await deleteTransaction(h.ctx, transaction.id);
    expect(Number((await getDebt(h.ctx, debt.id)).remainingAmount)).toBe(1_000_000);
    await restoreTransaction(h.ctx, transaction.id);
    expect(Number((await getDebt(h.ctx, debt.id)).remainingAmount)).toBe(600_000);

    // Ubah nominal lewat form transaksi biasa tetap tertaut ke piutang.
    const t = await getTransaction(h.ctx, transaction.id);
    await updateTransaction(h.ctx, t.id, { ...toInput(t), debtId: null, amount: 250_000 });
    expect(Number((await getDebt(h.ctx, debt.id)).remainingAmount)).toBe(750_000);
  });

  it("cicilan dengan bunga: total kewajiban = jumlah cicilan", async () => {
    const debt = await createDebt(h.ctx, {
      direction: "payable",
      counterparty: "Koperasi",
      principalAmount: 10_000_000,
      startDate: new Date(),
      installmentCount: 12,
      installmentAmount: 950_000,
      firstDueDate: new Date(Date.now() + 5 * DAY),
    });
    expect(Number(debt.remainingAmount)).toBe(11_400_000);
    // Tanpa rekening: tidak ada transaksi kas.
    expect(await prisma.transaction.count({ where: { debtId: debt.id } })).toBe(0);
  });

  it("terlambat & jatuh tempo terdekat", async () => {
    const debt = await createDebt(h.ctx, {
      direction: "payable",
      counterparty: "Citra",
      principalAmount: 2_000_000,
      startDate: new Date(Date.now() - 60 * DAY),
      installmentCount: 2,
      firstDueDate: new Date(Date.now() - 3 * DAY),
    });
    expect(debt.status).toBe("overdue");
    const dues = await upcomingDebtDues(h.ctx, 40);
    expect(dues.map((d) => [d.sequence, d.overdue])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect((await listDebts(h.ctx))[0]!.status).toBe("overdue");
    await recordDebtPayment(h.ctx, debt.id, { amount: 1_000_000, occurredAt: new Date() });
    expect((await getDebt(h.ctx, debt.id)).status).toBe("active");
  });

  it("hapus hutang ikut menghapus transaksinya", async () => {
    const debt = await createDebt(h.ctx, { direction: "payable", counterparty: "Dodi", principalAmount: 500_000, startDate: new Date(), accountId: h.cash.id });
    expect((await getAccount(h.ctx, h.cash.id)).balance).toBe(1_500_000);
    await deleteDebt(h.ctx, debt.id);
    expect((await getAccount(h.ctx, h.cash.id)).balance).toBe(1_000_000);
    expect(await prisma.debt.count()).toBe(0);
  });
});

describe("investasi", () => {
  it("beli, update harga, jual sebagian, dividen; kas ikut bergerak", async () => {
    const bbca = await createAsset(h.ctx, { assetClass: "stock", name: "Bank Central Asia", symbol: "bbca" });
    expect(bbca.symbol).toBe("BBCA");
    expect(bbca.unitsPerLot).toBe(100);

    await recordInvestmentTransaction(h.ctx, bbca.id, { kind: "buy", occurredAt: new Date(Date.now() - 10 * DAY), units: 200, pricePerUnit: 9000, fee: 2700, accountId: h.bca.id });
    expect((await getAccount(h.ctx, h.bca.id)).balance).toBe(10_000_000 - 1_802_700);

    await setAssetPrice(h.ctx, bbca.id, { price: 10_000 });
    let p = await getPortfolio(h.ctx);
    expect(p.items[0]).toMatchObject({ units: 200, costBasis: 1_802_700, price: 10_000, marketValue: 2_000_000, priceSource: "manual" });

    await recordInvestmentTransaction(h.ctx, bbca.id, { kind: "sell", occurredAt: new Date(), units: 100, pricePerUnit: 11_000, fee: 3300, accountId: h.bca.id });
    await recordInvestmentTransaction(h.ctx, bbca.id, { kind: "dividend", occurredAt: new Date(), totalAmount: 25_000, accountId: h.bca.id });
    p = await getPortfolio(h.ctx);
    expect(p.items[0]).toMatchObject({ units: 100, costBasis: 901_350, realized: 1_096_700 - 901_350, income: 25_000, price: 11_000, priceSource: "trade" });
    expect(p.totals.marketValue).toBe(1_100_000);

    // Beli/jual bukan pemasukan/pengeluaran; dividen adalah pemasukan.
    const m = currentMonthRange();
    const totals = await periodTotals(h.ctx, m.start, m.end);
    expect(totals.expense).toBe(0);
    expect(totals.income).toBe(25_000);

    await expect(recordInvestmentTransaction(h.ctx, bbca.id, { kind: "sell", occurredAt: new Date(), units: 101, pricePerUnit: 1 })).rejects.toThrow(/melebihi/);
  });

  it("mode nominal (deposito) tanpa rekening", async () => {
    const dep = await createAsset(h.ctx, { assetClass: "deposit", name: "Deposito BCA" });
    await recordInvestmentTransaction(h.ctx, dep.id, { kind: "buy", occurredAt: new Date(), totalAmount: "5jt" });
    const p = await getPortfolio(h.ctx);
    expect(p.items[0]).toMatchObject({ units: 5_000_000, costBasis: 5_000_000, marketValue: 5_000_000 });
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("menghapus transaksi kas investasi mengeluarkannya dari portofolio; edit lewat form ditolak", async () => {
    const gold = await createAsset(h.ctx, { assetClass: "gold", name: "Emas Antam", unitLabel: "gram" });
    const it = await recordInvestmentTransaction(h.ctx, gold.id, { kind: "buy", occurredAt: new Date(), units: 2, pricePerUnit: 1_500_000, accountId: h.bca.id });
    const t = await getTransaction(h.ctx, it.transactionId!);
    await expect(updateTransaction(h.ctx, t.id, toInput(t, { amount: 1 }))).rejects.toThrow(/menu Investasi/);
    await deleteTransaction(h.ctx, t.id);
    expect((await getPortfolio(h.ctx)).items[0]!.units).toBe(0);
  });

  it("tidak bisa menghapus pembelian yang sudah dijual", async () => {
    const a = await createAsset(h.ctx, { assetClass: "crypto", name: "BTC", unitLabel: "koin" });
    const b = await recordInvestmentTransaction(h.ctx, a.id, { kind: "buy", occurredAt: new Date(Date.now() - DAY), units: 0.01, pricePerUnit: 1_000_000_000 });
    await recordInvestmentTransaction(h.ctx, a.id, { kind: "sell", occurredAt: new Date(), units: 0.005, pricePerUnit: 1_100_000_000 });
    await expect(deleteInvestmentTransaction(h.ctx, b.id)).rejects.toThrow(/penjualannya dulu/);
  });

  it("aset duplikat ditolak", async () => {
    await createAsset(h.ctx, { assetClass: "stock", name: "TLKM" });
    await expect(createAsset(h.ctx, { assetClass: "stock", name: "tlkm" })).rejects.toThrow(/sudah ada/);
  });
});

describe("kekayaan bersih", () => {
  it("rekening + investasi + piutang − hutang", async () => {
    // Saldo awal: Tunai 1jt + BCA 10jt
    await createDebt(h.ctx, { direction: "payable", counterparty: "Budi", principalAmount: 2_000_000, startDate: new Date(), accountId: h.bca.id });
    await createDebt(h.ctx, { direction: "receivable", counterparty: "Andi", principalAmount: 500_000, startDate: new Date() });
    const a = await createAsset(h.ctx, { assetClass: "gold", name: "Emas", unitLabel: "gram" });
    await recordInvestmentTransaction(h.ctx, a.id, { kind: "buy", occurredAt: new Date(), units: 1, pricePerUnit: 1_000_000, accountId: h.bca.id });
    await setAssetPrice(h.ctx, a.id, { price: 1_200_000 });
    const nw = await netWorth(h.ctx);
    expect(nw).toMatchObject({ cash: 12_000_000, investments: 1_200_000, receivables: 500_000, payables: 2_000_000 });
    expect(nw.net).toBe(12_000_000 + 1_200_000 + 500_000 - 2_000_000);
  });
});

describe("pengingat", () => {
  async function linkTelegram() {
    await prisma.telegramIdentity.create({ data: { userId: h.user.id, telegramUserId: 111n, chatId: 111n } });
  }
  // 10.00 WIB, bukan jam tenang.
  const morning = () => {
    const d = new Date();
    d.setUTCHours(3, 0, 0, 0);
    return d;
  };

  it("cicilan H-3 dan anggaran 80% dikirim sekali ke Telegram", async () => {
    await linkTelegram();
    const now = morning();
    await createDebt(h.ctx, {
      direction: "payable",
      counterparty: "Budi",
      principalAmount: 1_000_000,
      startDate: now,
      installmentCount: 2,
      firstDueDate: new Date(now.getTime() + 2 * DAY),
      reminderDaysBefore: 3,
    });
    await setBudget(h.ctx, { categoryId: h.food.id, amount: 100_000 });
    await spend(90_000);

    await generateReminders(now);
    await generateReminders(now); // idempoten
    const sent: { chat: bigint; html: string }[] = [];
    const r = await deliverPendingNotifications(async (chat, html) => void sent.push({ chat, html }), now);
    expect(r.sent).toBe(2);
    expect(sent.map((s) => s.chat)).toEqual([111n, 111n]);
    const texts = sent.map((s) => s.html).join("\n");
    expect(texts).toContain("Cicilan ke-1 ke <b>Budi</b> jatuh tempo 2 hari lagi");
    expect(texts).toContain("bayar hutang 500.000 ke Budi");
    expect(texts).toContain("Anggaran <b>Makan &amp; Minum</b> sudah terpakai 90%");

    await generateReminders(now);
    expect((await deliverPendingNotifications(async () => {}, now)).sent).toBe(0);
  });

  it("cicilan yang masih jauh belum diingatkan; jam tenang menunda pengiriman", async () => {
    await linkTelegram();
    const now = morning();
    await createDebt(h.ctx, {
      direction: "receivable",
      counterparty: "Andi",
      principalAmount: 600_000,
      startDate: now,
      installmentCount: 1,
      firstDueDate: new Date(now.getTime() + 10 * DAY),
    });
    await generateReminders(now);
    expect(await prisma.notification.count()).toBe(0);

    const later = new Date(now.getTime() + 8 * DAY);
    await generateReminders(later);
    expect(await prisma.notification.count()).toBe(1);
    const night = new Date(later);
    night.setUTCHours(16, 0, 0, 0); // 23.00 WIB
    expect((await deliverPendingNotifications(async () => {}, night)).skipped).toBe("quiet_hours");
    expect((await deliverPendingNotifications(async () => {}, later)).sent).toBe(1);
  });
});
