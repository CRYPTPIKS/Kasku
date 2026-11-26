import { z } from "zod";
import { optionalId, optionalString } from "./common";

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Nama kategori wajib diisi").max(60),
  kind: z.enum(["income", "expense"], { message: "Pilih jenis kategori" }),
  parentId: optionalId,
  icon: optionalString(8),
  color: optionalString(20),
  keywords: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .transform((v) =>
      (Array.isArray(v) ? v : (v ?? "").split(","))
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 50),
    ),
});
export type CategoryInput = z.input<typeof categoryInputSchema>;
