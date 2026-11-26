import { z } from "zod";

/**
 * Validasi environment variable. Dibaca secara malas (lazy) agar `next build`
 * tidak memerlukan rahasia production.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL wajib diisi"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // Gunakan cookie Secure. Default true di production.
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Konfigurasi environment tidak valid: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function cookieSecure(): boolean {
  const e = env();
  return e.COOKIE_SECURE ?? e.NODE_ENV === "production";
}
