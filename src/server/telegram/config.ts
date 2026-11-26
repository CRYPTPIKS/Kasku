import { z } from "zod";

/** Konfigurasi bot Telegram dari environment variable (dibaca saat dibutuhkan). */
const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string({ message: "TELEGRAM_BOT_TOKEN belum diisi" }).min(20, "TELEGRAM_BOT_TOKEN tidak valid"),
  TELEGRAM_WEBHOOK_SECRET: z
    .preprocess((v) => (v === "" ? undefined : v), z.string()
    .regex(/^[A-Za-z0-9_-]{16,256}$/, "TELEGRAM_WEBHOOK_SECRET minimal 16 karakter (huruf, angka, _ atau -)").optional()),
  TELEGRAM_ALLOWED_USER_IDS: z.string({ message: "TELEGRAM_ALLOWED_USER_IDS belum diisi" }).min(1, "TELEGRAM_ALLOWED_USER_IDS belum diisi"),
});

export interface TelegramConfig {
  token: string;
  webhookSecret: string | null;
  allowedUserIds: Set<string>;
}

export function parseAllowedIds(raw: string): Set<string> {
  return new Set(
    raw
      .split(/[\s,;]+/)
      .map((x) => x.trim())
      .filter((x) => /^\d{1,20}$/.test(x)),
  );
}

export function telegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Konfigurasi Telegram tidak valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  const allowed = parseAllowedIds(parsed.data.TELEGRAM_ALLOWED_USER_IDS);
  if (allowed.size === 0) throw new Error("TELEGRAM_ALLOWED_USER_IDS harus berisi minimal satu ID numerik.");
  return {
    token: parsed.data.TELEGRAM_BOT_TOKEN,
    webhookSecret: parsed.data.TELEGRAM_WEBHOOK_SECRET ?? null,
    allowedUserIds: allowed,
  };
}

export function isTelegramConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ALLOWED_USER_IDS);
}
