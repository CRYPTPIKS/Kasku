import { z } from "zod";
import { dateTimeSchema, optionalId, optionalString, positiveAmount } from "./common";

export const TRANSACTION_TYPES = [
  "income",
  "expense",
  "transfer",
  "debt_receivable",
  "debt_payable",
  "debt_payment",
  "investment_buy",
  "investment_sell",
  "investment_income",
  "adjustment",
] as const;

export const splitInputSchema = z.object({
  categoryId: optionalId,
  amount: positiveAmount,
  note: optionalString(200),
});

export const transactionInputSchema = z.object({
  type: z.enum(TRANSACTION_TYPES, { message: "Pilih jenis transaksi" }),
  status: z.enum(["draft", "confirmed"]).default("confirmed"),
  occurredAt: dateTimeSchema,
  amount: positiveAmount,
  description: optionalString(200),
  merchant: optionalString(120),
  note: optionalString(1000),
  categoryId: optionalId,
  fromAccountId: optionalId,
  toAccountId: optionalId,
  debtId: optionalId,
  tags: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .transform((v) =>
      [
        ...new Set(
          (Array.isArray(v) ? v : (v ?? "").split(","))
            .map((t) => t.trim().replace(/^#/, "").toLowerCase())
            .filter(Boolean),
        ),
      ].slice(0, 20),
    ),
  splits: z.array(splitInputSchema).max(50).optional().default([]),
});
export type TransactionInput = z.input<typeof transactionInputSchema>;
export type TransactionData = z.output<typeof transactionInputSchema>;

export const transactionFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  categoryId: z.string().optional(),
  accountId: z.string().optional(),
  tag: z.string().optional(),
  status: z.enum(["draft", "confirmed"]).optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  deleted: z.enum(["only", "include"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type TransactionFilter = z.input<typeof transactionFilterSchema>;
