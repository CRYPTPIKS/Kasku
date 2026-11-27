import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { getAccount } from "@/server/services/accounts";
import {
  createAsset,
  deleteAsset,
  deleteAssetPrice,
  deleteInvestmentTransaction,
  getPortfolio,
  recordInvestmentTransaction,
  setAssetArchived,
  setAssetPrice,
} from "@/server/services/investments";
import { netWorth } from "@/server/services/networth";
import { resetDb, setupHousehold } from "./helpers";

let h: Awaited<ReturnType<typeof setupHousehold>>;
const DAY = 86400000;
const ago = (d: number) => new Date(Date.now() - d * DAY);

beforeEach(async () => {
  await resetDb();
  h = await setupHousehold();
});

const robo = () => createAsset(h.ctx, { assetClass: "mutual_fund", name: "Bibit Robo", valuationMode: "value" });

describe("investasi mode nilai total (robo-advisor)", () => {
  it("setor, perbarui nilai, setor lagi, tarik sebagian", async () => {
    const a = await robo();
    expect(a.valuationMode).toBe("value");
    expect(a.unitsPerLot).toBeNull();

    // Unit/harga yang dikirim diabaikan: hanya nominal yang dipakai.
    await recordInvestmentTransaction(h.ctx, a.id, { kind: "buy", occurredAt: ago(30), units: 5, pricePerUnit: 3, totalAmount: "10jt", accountId: h.bca.id });
    let item = (await getPortfolio(h.ctx)).items[0]!;
    expect(item).toMatchObject({ valuationMode: "value", costBasis: 10_000_000, marketValue: 10_000_000, unrealized: 0, priceAsOf: null });
    expect((await getAccount(h.ctx, h.bca.id)).balance).toBe(0);
    expect((await prisma.transaction.findFirstOrThrow()).description).toBe("Setor Bibit Robo");

    await setAssetPrice(h.ctx, a.id, { price: "10,5jt", asOf: ago(20) });
    item = (await getPortfolio(h.ctx)).items[0]!;
    expect(item).toMatchObject({ marketValue: 10_500_000, costBasis: 10_000_000, unrealized: 500_000 });
    expect(item.unrealizedPct).toBeCloseTo(0.05);

    // Setoran sesudah pencatatan nilai menambah nilai & modal.
    await recordInvestmentTransaction(h.ctx, a.id, { kind: "buy", occurredAt: ago(10), totalAmount: 500_000 });
    item = (await getPortfolio(h.ctx)).items[0]!;
    expect(item).toMatchObject({ marketValue: 11_000_000, costBasis: 10_500_000, unrealized: 500_000 });

    // Tarik 2,2jt = 20% nilai → modal berkurang 20% (2,1jt), untung terealisasi 100rb.
    await recordInvestmentTransaction(h.ctx, a.id, { kind: "sell", occurredAt: ago(5), totalAmount: 2_200_000, accountId: h.bca.id });
    item = (await getPortfolio(h.ctx)).items[0]!;
    expect(item).toMatchObject({ marketValue: 8_800_000, costBasis: 8_400_000, realized: 100_000, unrealized: 400_000 });
    expect((await getAccount(h.ctx, h.bca.id)).balance).toBe(2_200_000);

    const w = await netWorth(h.ctx);
    expect(w.investments).toBe(8_800_000);
  });

  it("penarikan melebihi nilai ditolak, juga pencatatan nilai yang membuat penarikan lama tidak masuk akal", async () => {
    const a = await robo();
    await recordInvestmentTransaction(h.ctx, a.id, { kind: "buy", occurredAt: ago(10), totalAmount: 1_000_000 });
    await expect(recordInvestmentTransaction(h.ctx, a.id, { kind: "sell", occurredAt: ago(1), totalAmount: 1_200_000 })).rejects.toThrow(/melebihi nilai aset/);

    await recordInvestmentTransaction(h.ctx, a.id, { kind: "sell", occurredAt: ago(2), totalAmount: 900_000 });
    // Nilai 500rb pada hari ke-5 membuat penarikan 900rb pada hari ke-2 mustahil.
    await expect(setAssetPrice(h.ctx, a.id, { price: 500_000, asOf: ago(5) })).rejects.toThrow(/lebih kecil dari penarikan/);
    expect(await prisma.investmentPrice.count()).toBe(0);
  });

  it("hapus catatan nilai dan hapus setoran mengembalikan perhitungan", async () => {
    const a = await robo();
    const dep = await recordInvestmentTransaction(h.ctx, a.id, { kind: "buy", occurredAt: ago(10), totalAmount: 1_000_000 });
    await recordInvestmentTransaction(h.ctx, a.id, { kind: "buy", occurredAt: ago(9), totalAmount: 1_000_000 });
    const snap = await setAssetPrice(h.ctx, a.id, { price: 2_500_000, asOf: ago(1) });
    expect((await getPortfolio(h.ctx)).items[0]!.marketValue).toBe(2_500_000);

    await deleteAssetPrice(h.ctx, snap.id);
    expect((await getPortfolio(h.ctx)).items[0]!.marketValue).toBe(2_000_000);

    await deleteInvestmentTransaction(h.ctx, dep.id);
    expect((await getPortfolio(h.ctx)).items[0]).toMatchObject({ marketValue: 1_000_000, costBasis: 1_000_000 });
  });

  it("arsip hanya jika nilai sudah nol", async () => {
    const a = await robo();
    await recordInvestmentTransaction(h.ctx, a.id, { kind: "buy", occurredAt: ago(3), totalAmount: 1_000_000 });
    await expect(setAssetArchived(h.ctx, a.id, true)).rejects.toThrow(/Nilai aset belum nol/);
    await setAssetPrice(h.ctx, a.id, { price: 1_050_000, asOf: ago(2) });
    await recordInvestmentTransaction(h.ctx, a.id, { kind: "sell", occurredAt: ago(1), totalAmount: 1_050_000 });
    const item = (await getPortfolio(h.ctx, { includeArchived: true })).items[0]!;
    expect(item).toMatchObject({ marketValue: 0, costBasis: 0, realized: 50_000 });
    await setAssetArchived(h.ctx, a.id, true);
  });
});

describe("hapus aset", () => {
  it("menghapus aset, riwayat, harga, dan transaksi kasnya (saldo kembali)", async () => {
    const gold = await createAsset(h.ctx, { assetClass: "gold", name: "Emas Antam", unitLabel: "gram" });
    await recordInvestmentTransaction(h.ctx, gold.id, { kind: "buy", occurredAt: ago(2), units: 2, pricePerUnit: 1_500_000, accountId: h.bca.id });
    await setAssetPrice(h.ctx, gold.id, { price: 1_600_000 });
    expect((await getAccount(h.ctx, h.bca.id)).balance).toBe(7_000_000);

    const r = await deleteAsset(h.ctx, gold.id);
    expect(r.deletedCashTransactions).toBe(1);
    expect((await getAccount(h.ctx, h.bca.id)).balance).toBe(10_000_000);
    expect(await prisma.investmentAsset.count()).toBe(0);
    expect(await prisma.investmentTransaction.count()).toBe(0);
    expect(await prisma.investmentPrice.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityType: "InvestmentAsset", action: "delete" } })).toBe(1);
    // Nama yang sama bisa dibuat lagi.
    await createAsset(h.ctx, { assetClass: "gold", name: "Emas Antam" });
  });

  it("aset household lain tidak bisa dihapus", async () => {
    const a = await robo();
    await expect(deleteAsset({ ...h.ctx, householdId: "lain" }, a.id)).rejects.toThrow(/tidak ditemukan/i);
  });
});
