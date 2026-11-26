import { hash, verify } from "@node-rs/argon2";

/**
 * Hash kata sandi dengan Argon2id (parameter OWASP: m=19 MiB, t=2, p=1).
 */
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Kata sandi minimal ${MIN_PASSWORD_LENGTH} karakter.`);
  }
  // algorithm 2 = Argon2id
  return hash(password, { ...OPTIONS, algorithm: 2 });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Hash palsu untuk menyamakan waktu respons saat email tidak terdaftar.
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hash("dummy-password-for-timing", { ...OPTIONS, algorithm: 2 });
  return dummyHash;
}
