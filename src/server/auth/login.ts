import { prisma } from "../db";
import { AppError } from "../errors";
import { getDummyHash, verifyPassword } from "./password";
import { clearFailures, isRateLimited, recordFailure } from "./rate-limit";
import { createSession } from "./session";

export async function login(input: { email: string; password: string; ip?: string | null; userAgent?: string | null }) {
  const email = input.email.trim().toLowerCase();
  const key = `${email}|${input.ip ?? "-"}`;
  if (isRateLimited(key)) {
    throw new AppError("Terlalu banyak percobaan. Coba lagi dalam 15 menit.", "forbidden");
  }
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = user
    ? user.isActive && (await verifyPassword(user.passwordHash, input.password))
    : (await verifyPassword(await getDummyHash(), input.password), false);
  if (!user || !ok) {
    recordFailure(key);
    throw new AppError("Email atau kata sandi salah.", "unauthorized");
  }
  clearFailures(key);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return createSession(user.id, { ipAddress: input.ip, userAgent: input.userAgent });
}
