import { describe, expect, it } from "vitest";
import { addMonthsJakarta, jakartaDayDiff, toDateInput } from "@/lib/dates";
import { computeHolding, tradeTotal, valuate, type InvestmentTrade } from "@/lib/investments";
import { buildInstallmentSchedule } from "@/server/services/debts";

const d = (s: string) => new Date(`${s}T10:00:00+07:00`);
const buy = (date: string, units: number, price: number, fee = 0): InvestmentTrade => ({
  kind: "buy",
  occurredAt: d(date),
  units,
  pricePerUnit: price,
  fee,
  totalAmount: tradeTotal("buy", units, price, fee),
});
const sell = (date: string, units: number, price: number, fee = 0): InvestmentTrade => ({
  kind: "sell",
  occurredAt: d(date),
  units,
  pricePerUnit: price,
  fee,
  totalAmount: tradeTotal("sell", units, price, fee),
});

describe("computeHolding (biaya rata-rata)", () => {
  it("beli dua kali lalu jual sebagian", () => {
    const h = computeHolding([buy("2026-01-05", 100, 9000, 1000), buy("2026-02-05", 100, 10000, 1000), sell("2026-03-05", 100, 11000, 1500)]);
    // biaya total 1.902.000 untuk 200 lembar -> rata-rata 9.510
    expect(h.units).toBe(100);
    expect(h.costBasis).toBe(951_000);
    expect(h.realized).toBe(1_098_500 - 951_000);
    expect(h.fees).toBe(3500);
    expect(h.lastTradePrice).toBe(11000);
  });

  it("dividen dihitung sebagai pendapatan, urutan input tidak berpengaruh", () => {
    const h = computeHolding([
      { kind: "dividend", occurredAt: d("2026-04-01"), units: 0, pricePerUnit: 0, fee: 0, totalAmount: 25_000 },
      buy("2026-01-01", 10, 1000),
    ]);
    expect(h.income).toBe(25_000);
    expect(h.units).toBe(10);
  });

  it("jual habis mengosongkan harga pokok", () => {
    const h = computeHolding([buy("2026-01-01", 1.5, 1_000_000), sell("2026-02-01", 1.5, 1_200_000)]);
    expect(h.units).toBe(0);
    expect(h.costBasis).toBe(0);
    expect(h.realized).toBe(300_000);
  });

  it("menolak jual melebihi kepemilikan", () => {
    expect(() => computeHolding([buy("2026-01-01", 1, 100), sell("2026-01-02", 2, 100)])).toThrow(/melebihi/);
  });

  it("valuasi dengan harga terbaru", () => {
    const h = computeHolding([buy("2026-01-01", 2, 1_000_000)]);
    expect(valuate(h, 1_100_000)).toEqual({ marketValue: 2_200_000, unrealized: 200_000, unrealizedPct: 0.1 });
    expect(valuate(h, null).marketValue).toBe(2_000_000);
  });
});

describe("jadwal cicilan", () => {
  it("bulanan, tanggal 31 dipotong ke akhir bulan (WIB)", () => {
    const first = new Date("2026-01-30T17:00:00Z"); // 31 Jan 2026 00:00 WIB
    expect(toDateInput(addMonthsJakarta(first, 1, 31))).toBe("2026-02-28");
    expect(toDateInput(addMonthsJakarta(first, 2, 31))).toBe("2026-03-31");
    expect(toDateInput(addMonthsJakarta(first, 11, 31))).toBe("2026-12-31");
    expect(toDateInput(addMonthsJakarta(first, 12, 31))).toBe("2027-01-31");
  });

  it("pokok dibagi rata, sisa pembulatan di cicilan terakhir", () => {
    const s = buildInstallmentSchedule(1_000_000, 3, new Date("2026-02-09T17:00:00Z"));
    expect(s.map((x) => x.amount)).toEqual([333_333.33, 333_333.33, 333_333.34]);
    expect(s.map((x) => toDateInput(x.dueDate))).toEqual(["2026-02-10", "2026-03-10", "2026-04-10"]);
  });

  it("nominal cicilan tetap (termasuk bunga)", () => {
    const s = buildInstallmentSchedule(10_000_000, 12, new Date("2026-02-09T17:00:00Z"), 950_000);
    expect(s).toHaveLength(12);
    expect(s.reduce((a, x) => a + x.amount, 0)).toBe(11_400_000);
  });

  it("selisih hari kalender WIB", () => {
    expect(jakartaDayDiff(new Date("2026-03-01T16:30:00Z"), new Date("2026-03-02T16:30:00Z"))).toBe(1);
    expect(jakartaDayDiff(new Date("2026-03-01T17:30:00Z"), new Date("2026-03-01T16:00:00Z"))).toBe(-1);
  });
});
