import { z } from "zod";
import { parseDateTimeInput } from "@/lib/dates";
import { parseAmount } from "@/lib/parsing/amount";

/** String kosong dari form -> undefined. */
export const optionalString = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `Maksimal ${max} karakter`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const optionalId = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/** Nominal: menerima number atau teks Indonesia ("75rb", "Rp 25.000"). */
export const amountSchema = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const n = typeof v === "number" ? v : parseAmount(v);
    if (n === null || !Number.isFinite(n)) {
      ctx.addIssue({ code: "custom", message: "Nominal tidak valid" });
      return z.NEVER;
    }
    return Math.round(n * 100) / 100;
  });

export const positiveAmount = amountSchema.refine((n) => n > 0, "Nominal harus lebih dari 0").refine(
  (n) => n < 1e15,
  "Nominal terlalu besar",
);

export const signedAmount = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    if (typeof v === "number") return Math.round(v * 100) / 100;
    const s = v.trim();
    if (s === "") return 0;
    const negative = s.startsWith("-");
    const n = parseAmount(negative ? s.slice(1) : s);
    if (n === null) {
      ctx.addIssue({ code: "custom", message: "Nominal tidak valid" });
      return z.NEVER;
    }
    return (negative ? -1 : 1) * Math.round(n * 100) / 100;
  });

export const dateTimeSchema = z.union([z.date(), z.string()]).transform((v, ctx) => {
  const d = v instanceof Date ? v : parseDateTimeInput(v) ?? new Date(v);
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: "custom", message: "Tanggal tidak valid" });
    return z.NEVER;
  }
  return d;
});
