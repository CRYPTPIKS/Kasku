import { z } from "zod";
import { parseAmount } from "@/lib/parsing/amount";
import { dateTimeSchema, optionalId, optionalString, positiveAmount } from "./common";

// ---------------------------------------------------------------------------
// Anggaran
// ---------------------------------------------------------------------------

export const budgetInputSchema = z.object({
  categoryId: z.string().trim().min(1, "Pilih kategori"),
  amount: positiveAmount,
  /** "default" = berlaku tiap bulan; "month" = hanya untuk bulan `month`. */
  scope: z.enum(["default", "month"]).default("default"),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Format bulan YYYY-MM")
    .optional()
    .nullable(),
});
export type BudgetInput = z.input<typeof budgetInputSchema>;

// ---------------------------------------------------------------------------
// Hutang & piutang
// ---------------------------------------------------------------------------

const optionalDate = z
  .union([z.date(), z.string()])
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (v === undefined || v === null || v === "") return null;
    const parsed = dateTimeSchema.safeParse(v);
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: "Tanggal tidak valid" });
      return z.NEVER;
    }
    return parsed.data;
  });

const optionalPositive = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (v === undefined || v === null || v === "") return null;
    const n = typeof v === "number" ? v : parseAmount(v);
    if (n === null || !(n > 0)) {
      ctx.addIssue({ code: "custom", message: "Nominal tidak valid" });
      return z.NEVER;
    }
    return Math.round(n * 100) / 100;
  });

const optionalInt = (min: number, max: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `Isi angka ${min}–${max}` });
        return z.NEVER;
      }
      return n;
    });

export const debtInputSchema = z
  .object({
    direction: z.enum(["payable", "receivable"], { message: "Pilih hutang atau piutang" }),
    counterparty: z.string().trim().min(1, "Isi nama pihak terkait").max(80),
    principalAmount: positiveAmount,
    startDate: dateTimeSchema,
    dueDate: optionalDate,
    note: optionalString(500),
    /** Rekening tempat uang pinjaman masuk/keluar. Kosong = catat hutang saja, tanpa arus kas. */
    accountId: optionalId,
    installmentCount: optionalInt(1, 360),
    installmentAmount: optionalPositive,
    firstDueDate: optionalDate,
    reminderDaysBefore: optionalInt(0, 30).transform((v) => v ?? 3),
    /** Cicilan tetap, cicilan terakhir = sisa pokok (dipakai bot). */
    remainderLast: z.boolean().optional().default(false),
  })
  .superRefine((d, ctx) => {
    if (d.installmentCount && !d.firstDueDate) {
      ctx.addIssue({ code: "custom", path: ["firstDueDate"], message: "Isi tanggal jatuh tempo cicilan pertama" });
    }
    if (d.installmentAmount && !d.installmentCount) {
      ctx.addIssue({ code: "custom", path: ["installmentCount"], message: "Isi jumlah cicilan" });
    }
    if (d.dueDate && d.dueDate < d.startDate) {
      ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Jatuh tempo tidak boleh sebelum tanggal mulai" });
    }
  });
export type DebtInput = z.input<typeof debtInputSchema>;

export const debtPaymentInputSchema = z.object({
  amount: positiveAmount,
  occurredAt: dateTimeSchema,
  /** Rekening sumber (bayar hutang) atau tujuan (terima cicilan piutang). Opsional. */
  accountId: optionalId,
  installmentId: optionalId,
  note: optionalString(500),
});
export type DebtPaymentInput = z.input<typeof debtPaymentInputSchema>;

// ---------------------------------------------------------------------------
// Investasi
// ---------------------------------------------------------------------------

export const ASSET_CLASSES = ["stock", "mutual_fund", "gold", "crypto", "deposit", "bond", "other"] as const;

export const assetInputSchema = z.object({
  assetClass: z.enum(ASSET_CLASSES, { message: "Pilih jenis aset" }),
  name: z.string().trim().min(1, "Isi nama aset").max(80),
  symbol: optionalString(20).transform((v) => (v ? v.toUpperCase() : null)),
  unitLabel: optionalString(20).transform((v) => v ?? "unit"),
  unitsPerLot: optionalInt(1, 100000),
});
export type AssetInput = z.input<typeof assetInputSchema>;

const decimalSchema = (label: string) =>
  z.union([z.number(), z.string()]).transform((v, ctx) => {
    const n = typeof v === "number" ? v : parseAmount(v);
    if (n === null || !Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: "custom", message: `${label} tidak valid` });
      return z.NEVER;
    }
    return n;
  });

export const investmentTxInputSchema = z
  .object({
    kind: z.enum(["buy", "sell", "dividend", "interest"], { message: "Pilih jenis" }),
    occurredAt: dateTimeSchema,
    /** Jumlah unit (lembar/gram/unit/koin). Untuk lot, sudah dikalikan unitsPerLot. */
    units: decimalSchema("Jumlah unit").optional().nullable(),
    pricePerUnit: decimalSchema("Harga").optional().nullable(),
    fee: decimalSchema("Biaya").optional().nullable().transform((v) => v ?? 0),
    /** Total kas; wajib untuk dividen/bunga, opsional untuk beli/jual (dihitung dari unit × harga). */
    totalAmount: optionalPositive,
    accountId: optionalId,
    note: optionalString(500),
  })
  .superRefine((d, ctx) => {
    if (d.kind === "buy" || d.kind === "sell") {
      const hasUnits = d.units != null && d.units > 0;
      if (!hasUnits && !d.totalAmount) ctx.addIssue({ code: "custom", path: ["units"], message: "Isi jumlah unit & harga, atau nominal" });
      if (hasUnits && !(d.pricePerUnit && d.pricePerUnit > 0) && !d.totalAmount) {
        ctx.addIssue({ code: "custom", path: ["pricePerUnit"], message: "Isi harga per unit" });
      }
    } else if (!d.totalAmount) {
      ctx.addIssue({ code: "custom", path: ["totalAmount"], message: "Isi nominal yang diterima" });
    }
  });
export type InvestmentTxInput = z.input<typeof investmentTxInputSchema>;

export const priceInputSchema = z.object({
  price: decimalSchema("Harga").refine((n) => n > 0, "Harga harus lebih dari 0"),
  asOf: dateTimeSchema.optional(),
});
export type PriceInput = z.input<typeof priceInputSchema>;
