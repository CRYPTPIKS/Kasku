import { describe, expect, it } from "vitest";
import { buildLedgerLines, LedgerRuleError } from "@/server/ledger";

const sum = (lines: { amount: number }[]) => lines.reduce((a, l) => a + l.amount, 0);

describe("aturan transfer antar-rekening", () => {
  it("transfer menghasilkan dua entri yang saling meniadakan", () => {
    const lines = buildLedgerLines({ type: "transfer", amount: 500_000, fromAccountId: "bca", toAccountId: "gopay" });
    expect(lines).toEqual([
      { accountId: "bca", amount: -500_000 },
      { accountId: "gopay", amount: 500_000 },
    ]);
    expect(sum(lines)).toBe(0);
  });

  it("transfer ke rekening yang sama ditolak", () => {
    expect(() => buildLedgerLines({ type: "transfer", amount: 1, fromAccountId: "a", toAccountId: "a" })).toThrow(
      LedgerRuleError,
    );
  });

  it("transfer tanpa rekening tujuan ditolak", () => {
    expect(() => buildLedgerLines({ type: "transfer", amount: 1, fromAccountId: "a" })).toThrow(/tujuan/);
  });

  it("transfer tanpa rekening asal ditolak", () => {
    expect(() => buildLedgerLines({ type: "transfer", amount: 1, toAccountId: "a" })).toThrow(/asal/);
  });
});

describe("aturan pemasukan & pengeluaran", () => {
  it("pengeluaran mengurangi rekening asal", () => {
    expect(buildLedgerLines({ type: "expense", amount: 75_000, fromAccountId: "cash" })).toEqual([
      { accountId: "cash", amount: -75_000 },
    ]);
  });

  it("pemasukan menambah rekening tujuan", () => {
    expect(buildLedgerLines({ type: "income", amount: 12_000_000, toAccountId: "bca" })).toEqual([
      { accountId: "bca", amount: 12_000_000 },
    ]);
  });

  it("pengeluaran dengan rekening tujuan ditolak", () => {
    expect(() =>
      buildLedgerLines({ type: "expense", amount: 1, fromAccountId: "a", toAccountId: "b" }),
    ).toThrow(LedgerRuleError);
  });

  it.each([0, -10])("nominal %d ditolak", (amount) => {
    expect(() => buildLedgerLines({ type: "expense", amount, fromAccountId: "a" })).toThrow(/lebih dari 0/);
  });

  it("nominal dibulatkan ke 2 desimal", () => {
    expect(buildLedgerLines({ type: "expense", amount: 10.005, fromAccountId: "a" })[0]?.amount).toBe(-10.01);
  });
});

describe("hutang, piutang, investasi, penyesuaian", () => {
  it("piutang mengeluarkan uang dari rekening", () => {
    expect(buildLedgerLines({ type: "debt_receivable", amount: 2_000_000, fromAccountId: "bca" })).toEqual([
      { accountId: "bca", amount: -2_000_000 },
    ]);
  });

  it("hutang tanpa rekening (pinjaman non-tunai) tidak menghasilkan entri", () => {
    expect(buildLedgerLines({ type: "debt_payable", amount: 1_000_000 })).toEqual([]);
  });

  it("bayar hutang mengurangi rekening asal", () => {
    expect(
      buildLedgerLines({ type: "debt_payment", amount: 1_000_000, fromAccountId: "mandiri", debtDirection: "payable" }),
    ).toEqual([{ accountId: "mandiri", amount: -1_000_000 }]);
  });

  it("bayar hutang ke rekening tujuan ditolak", () => {
    expect(() =>
      buildLedgerLines({ type: "debt_payment", amount: 1, toAccountId: "a", debtDirection: "payable" }),
    ).toThrow(LedgerRuleError);
  });

  it("terima cicilan piutang menambah rekening tujuan", () => {
    expect(
      buildLedgerLines({ type: "debt_payment", amount: 500_000, toAccountId: "bca", debtDirection: "receivable" }),
    ).toEqual([{ accountId: "bca", amount: 500_000 }]);
  });

  it("beli investasi mengurangi kas", () => {
    expect(buildLedgerLines({ type: "investment_buy", amount: 1_970_000, fromAccountId: "rdn" })).toEqual([
      { accountId: "rdn", amount: -1_970_000 },
    ]);
  });

  it("penyesuaian naik/turun", () => {
    expect(buildLedgerLines({ type: "adjustment", amount: 10, toAccountId: "a" })).toEqual([{ accountId: "a", amount: 10 }]);
    expect(buildLedgerLines({ type: "adjustment", amount: 10, fromAccountId: "a" })).toEqual([
      { accountId: "a", amount: -10 },
    ]);
    expect(() => buildLedgerLines({ type: "adjustment", amount: 10, fromAccountId: "a", toAccountId: "b" })).toThrow();
  });
});
