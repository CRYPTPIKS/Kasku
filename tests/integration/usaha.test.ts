import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { monthRange } from "@/lib/dates";
import { createAccount, updateAccount } from "@/server/services/accounts";
import { listBudgetStatus, setBudget } from "@/server/services/budgets";
import { businessReport, setupBusinessTemplates } from "@/server/services/businesses";
import { monthlyCashFlow, periodTotals, totalsByCategory } from "@/server/services/reports";
import { createTransaction } from "@/server/services/transactions";
import { resetDb, setupHousehold } from "./helpers";
import { createTestBot } from "./telegram-harness";

let h: Awaited<ReturnType<typeof setupHousehold>>;
const day = (d: number) => new Date(Date.UTC(2026, 10, d, 5)); // November 2026 (WIB siang)
const nov = monthRange(2026, 11);

async function setupGas() {
  await setupBusinessTemplates(h.ctx);
  const gas = await prisma.business.findFirstOrThrow({ where: { name: "Usaha Gas" } });
  const konten = await prisma.business.findFirstOrThrow({ where: { name: "Konten & Kerja" } });
  const bri = await createAccount(h.ctx, { name: "BRI", kind: "bank", initialBalance: 0, aliases: "bri", businessId: gas.id });
  const cat = async (name: string) => prisma.category.findFirstOrThrow({ where: { householdId: h.household.id, name } });
  return { gas, konten, bri, tebus: await cat("Tebus Gas"), jual: await cat("Penjualan Gas"), tools: await cat("Langganan & Software"), freelance: await cat("Usaha & Freelance") };
}

beforeEach(async () => {
  await resetDb();
  h = await setupHousehold();
});

describe("pemisahan usaha", () => {
  it("setor & tebus di BRI tidak masuk laporan pribadi; BRI→BCA jadi penghasilan, BCA→BRI jadi modal", async () => {
    const g = await setupGas();
    await createTransaction(h.ctx, { type: "income", amount: 15_000_000, occurredAt: day(3), toAccountId: g.bri.id, categoryId: g.jual.id });
    await createTransaction(h.ctx, { type: "expense", amount: 13_500_000, occurredAt: day(5), fromAccountId: g.bri.id, categoryId: g.tebus.id });
    await createTransaction(h.ctx, { type: "transfer", amount: 1_000_000, occurredAt: day(20), fromAccountId: g.bri.id, toAccountId: h.bca.id });
    await createTransaction(h.ctx, { type: "transfer", amount: 300_000, occurredAt: day(22), fromAccountId: h.bca.id, toAccountId: g.bri.id });
    await createTransaction(h.ctx, { type: "expense", amount: 50_000, occurredAt: day(6), fromAccountId: h.cash.id, categoryId: h.food.id });

    expect(await periodTotals(h.ctx, nov.start, nov.end)).toEqual({ income: 1_000_000, expense: 350_000, net: 650_000 });
    const inc = await totalsByCategory(h.ctx, "income", nov.start, nov.end);
    expect(inc).toEqual([expect.objectContaining({ name: "Penghasilan Usaha Gas", total: 1_000_000, businessId: g.gas.id })]);
    const exp = await totalsByCategory(h.ctx, "expense", nov.start, nov.end);
    expect(exp.map((c) => [c.name, c.total])).toEqual([
      ["Modal Usaha Gas", 300_000],
      ["Makan & Minum", 50_000],
    ]);
    const flow = await monthlyCashFlow(h.ctx, nov.start, nov.end);
    expect(flow).toEqual([{ month: "2026-11", income: 1_000_000, expense: 350_000, net: 650_000 }]);

    // Mode "all" tetap melihat semuanya (untuk anggaran per kategori).
    expect((await periodTotals(h.ctx, nov.start, nov.end, { scope: "all" })).expense).toBe(13_550_000);

    const [gas] = await businessReport(h.ctx, 2026, 11, 1);
    expect(gas).toMatchObject({ name: "Usaha Gas", balance: 15_000_000 - 13_500_000 - 1_000_000 + 300_000 });
    expect(gas!.months[0]).toEqual({ month: "2026-11", income: 15_000_000, expense: 13_500_000, profit: 1_500_000, withdrawn: 1_000_000, injected: 300_000 });
  });

  it("kategori usaha di rekening pribadi → satu baris laba bersih", async () => {
    const g = await setupGas();
    await createTransaction(h.ctx, { type: "income", amount: 3_000_000, occurredAt: day(10), toAccountId: h.bca.id, categoryId: g.freelance.id });
    await createTransaction(h.ctx, { type: "expense", amount: 400_000, occurredAt: day(2), fromAccountId: h.bca.id, categoryId: g.tools.id });
    await createTransaction(h.ctx, { type: "expense", amount: 200_000, occurredAt: day(15), fromAccountId: h.bca.id, categoryId: g.tools.id });

    expect(await periodTotals(h.ctx, nov.start, nov.end)).toEqual({ income: 2_400_000, expense: 0, net: 2_400_000 });
    expect(await totalsByCategory(h.ctx, "income", nov.start, nov.end)).toEqual([
      expect.objectContaining({ name: "Penghasilan Konten & Kerja", total: 2_400_000, count: 3 }),
    ]);
    const report = await businessReport(h.ctx, 2026, 11, 1);
    expect(report.find((r) => r.name === "Konten & Kerja")!.months[0]).toMatchObject({ income: 3_000_000, expense: 600_000, profit: 2_400_000 });

    // Bulan rugi → muncul sebagai pengeluaran "Modal Konten & Kerja".
    const dec = monthRange(2026, 12);
    await createTransaction(h.ctx, { type: "expense", amount: 250_000, occurredAt: new Date(Date.UTC(2026, 11, 3, 5)), fromAccountId: h.bca.id, categoryId: g.tools.id });
    expect(await periodTotals(h.ctx, dec.start, dec.end)).toEqual({ income: 0, expense: 250_000, net: -250_000 });
  });

  it("anggaran kategori usaha tetap menghitung pengeluarannya", async () => {
    const g = await setupGas();
    await setBudget(h.ctx, { categoryId: g.tools.id, amount: 500_000 });
    await createTransaction(h.ctx, { type: "expense", amount: 400_000, occurredAt: new Date(), fromAccountId: h.bca.id, categoryId: g.tools.id });
    const s = await listBudgetStatus(h.ctx);
    expect(s.items.find((i) => i.categoryId === g.tools.id)!.spent).toBe(400_000);
  });

  it("siapkan otomatis aman diulang, kategori lama dipakai ulang", async () => {
    await setupBusinessTemplates(h.ctx);
    await setupBusinessTemplates(h.ctx);
    expect(await prisma.business.count()).toBe(2);
    expect(await prisma.category.count({ where: { name: "Usaha & Freelance" } })).toBe(1);
    expect(await prisma.category.count({ where: { name: "Tebus Gas" } })).toBe(1);
  });

  it("ubah rekening tanpa field usaha tidak menghapus tandanya", async () => {
    const g = await setupGas();
    await updateAccount(h.ctx, g.bri.id, { name: "BRI Usaha", kind: "bank", initialBalance: 0, aliases: "bri" });
    expect((await prisma.account.findUniqueOrThrow({ where: { id: g.bri.id } })).businessId).toBe(g.gas.id);
  });
});

describe("bot: usaha", () => {
  const t = createTestBot();
  beforeEach(() => t.reset());

  it("setor 2jt ke BRI → pemasukan Penjualan Gas; laba usaha bulan ini", async () => {
    const g = await setupGas();
    await t.send("setor 2jt ke BRI");
    expect(t.lastText()).toContain("Rp2.000.000");
    expect(t.lastText()).toContain("Penjualan Gas");
    expect(t.lastText()).toContain("BRI");
    const b = t.buttons().find((x) => /Simpan/.test(x.text))!;
    await t.press(b.callback_data);
    await createTransaction(h.ctx, { type: "expense", amount: 1_500_000, occurredAt: new Date(), fromAccountId: g.bri.id, categoryId: g.tebus.id });

    await t.send("laba usaha bulan ini?");
    expect(t.lastText()).toContain("Usaha Gas");
    expect(t.lastText()).toContain("Laba kira-kira: <b>Rp500.000</b>");
  });
});
