/**
 * Aturan double-entry sederhana: menerjemahkan transaksi menjadi entri buku besar
 * bertanda (+ masuk rekening, - keluar rekening).
 *
 * Prinsip:
 * - Transfer menghasilkan dua entri yang saling meniadakan (total 0), sehingga
 *   tidak pernah dihitung sebagai pemasukan maupun pengeluaran.
 * - Pemasukan/pengeluaran untuk laporan dihitung dari `type`, bukan dari entri.
 * - Fungsi ini murni (tanpa I/O) agar mudah diuji.
 */
import type { TransactionType } from "@prisma/client";

export type DebtDirectionInput = "payable" | "receivable";

export interface LedgerInput {
  type: TransactionType;
  amount: number;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  /** Wajib untuk debt_payment: arah hutang yang dibayar. */
  debtDirection?: DebtDirectionInput | null;
}

export interface LedgerLine {
  accountId: string;
  amount: number;
}

export class LedgerRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerRuleError";
  }
}

type Requirement = { from: "required" | "forbidden" | "optional"; to: "required" | "forbidden" | "optional" };

/** Rekening mana yang wajib diisi untuk tiap jenis transaksi. */
export const ACCOUNT_REQUIREMENTS: Record<TransactionType, Requirement> = {
  income: { from: "forbidden", to: "required" },
  expense: { from: "required", to: "forbidden" },
  transfer: { from: "required", to: "required" },
  // Piutang: saya meminjamkan uang -> uang keluar dari rekening saya.
  debt_receivable: { from: "optional", to: "forbidden" },
  // Hutang: saya meminjam uang -> uang masuk ke rekening saya.
  debt_payable: { from: "forbidden", to: "optional" },
  // Pembayaran hutang (keluar) atau penerimaan cicilan piutang (masuk).
  debt_payment: { from: "optional", to: "optional" },
  investment_buy: { from: "required", to: "forbidden" },
  investment_sell: { from: "forbidden", to: "required" },
  investment_income: { from: "forbidden", to: "required" },
  // Penyesuaian saldo: isi "ke" untuk menambah, "dari" untuk mengurangi.
  adjustment: { from: "optional", to: "optional" },
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function buildLedgerLines(input: LedgerInput): LedgerLine[] {
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new LedgerRuleError("Nominal harus lebih dari 0.");

  const from = input.fromAccountId || null;
  const to = input.toAccountId || null;
  const req = ACCOUNT_REQUIREMENTS[input.type];

  if (req.from === "required" && !from) throw new LedgerRuleError("Rekening asal wajib diisi.");
  if (req.to === "required" && !to) throw new LedgerRuleError("Rekening tujuan wajib diisi.");
  if (req.from === "forbidden" && from) throw new LedgerRuleError("Jenis transaksi ini tidak memakai rekening asal.");
  if (req.to === "forbidden" && to) throw new LedgerRuleError("Jenis transaksi ini tidak memakai rekening tujuan.");

  switch (input.type) {
    case "transfer":
      if (from === to) throw new LedgerRuleError("Rekening asal dan tujuan transfer tidak boleh sama.");
      return [
        { accountId: from!, amount: -amount },
        { accountId: to!, amount },
      ];
    case "adjustment":
      if (from && to) throw new LedgerRuleError("Penyesuaian hanya memakai satu rekening.");
      if (!from && !to) throw new LedgerRuleError("Pilih rekening yang disesuaikan.");
      return from ? [{ accountId: from, amount: -amount }] : [{ accountId: to!, amount }];
    case "debt_payment": {
      if (from && to) throw new LedgerRuleError("Pembayaran hutang/piutang hanya memakai satu rekening.");
      if (input.debtDirection === "payable" && to)
        throw new LedgerRuleError("Membayar hutang: pilih rekening asal pembayaran.");
      if (input.debtDirection === "receivable" && from)
        throw new LedgerRuleError("Menerima cicilan piutang: pilih rekening tujuan.");
      if (from) return [{ accountId: from, amount: -amount }];
      if (to) return [{ accountId: to, amount }];
      return [];
    }
    default: {
      const lines: LedgerLine[] = [];
      if (from) lines.push({ accountId: from, amount: -amount });
      if (to) lines.push({ accountId: to, amount });
      return lines;
    }
  }
}

/** Jenis yang dihitung sebagai pemasukan / pengeluaran dalam laporan arus kas. */
export const INCOME_TYPES: TransactionType[] = ["income", "investment_income"];
export const EXPENSE_TYPES: TransactionType[] = ["expense"];

/** Apakah jenis transaksi memakai kategori. */
export function usesCategory(type: TransactionType): boolean {
  return type === "income" || type === "expense" || type === "investment_income";
}

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  income: "Pemasukan",
  expense: "Pengeluaran",
  transfer: "Transfer",
  debt_receivable: "Memberi pinjaman (piutang)",
  debt_payable: "Menerima pinjaman (hutang)",
  debt_payment: "Bayar/terima cicilan",
  investment_buy: "Beli investasi",
  investment_sell: "Jual investasi",
  investment_income: "Dividen/bunga",
  adjustment: "Penyesuaian saldo",
};
