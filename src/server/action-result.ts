import { unstable_rethrow } from "next/navigation";
import { toErrorPayload } from "./errors";
import { logger } from "./logger";

export interface ActionState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Nilai isian sebelumnya agar form tidak kosong saat error. */
  values?: Record<string, string>;
}

/** Jalankan aksi dan ubah error menjadi pesan ramah pengguna. */
export async function runAction(fn: () => Promise<ActionState | void>, values?: Record<string, string>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (err) {
    unstable_rethrow(err);
    const payload = toErrorPayload(err);
    if (payload.code === "internal") logger.error("Aksi gagal", { err });
    return { error: payload.message, fieldErrors: payload.fieldErrors, values };
  }
}

export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = v;
  return out;
}
