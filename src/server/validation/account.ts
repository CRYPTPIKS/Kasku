import { z } from "zod";
import { optionalString, signedAmount } from "./common";

export const ACCOUNT_KINDS = ["cash", "bank", "ewallet", "credit_card", "deposit", "other"] as const;

export const accountInputSchema = z.object({
  name: z.string().trim().min(1, "Nama rekening wajib diisi").max(60),
  kind: z.enum(ACCOUNT_KINDS, { message: "Pilih jenis rekening" }),
  institution: optionalString(80),
  accountNumberLast4: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\d{4}$/.test(v), "Isi 4 digit terakhir"),
  initialBalance: signedAmount.default(0),
  creditLimit: signedAmount.optional().nullable(),
  aliases: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .transform((v) =>
      (Array.isArray(v) ? v : (v ?? "").split(","))
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 10),
    ),
  color: optionalString(20),
});
export type AccountInput = z.input<typeof accountInputSchema>;
