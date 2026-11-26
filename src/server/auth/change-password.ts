import { prisma } from "../db";
import { AppError } from "../errors";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "./password";
import { hashToken } from "./session";

export async function changePassword(userId: string, current: string, next: string, keepSessionToken?: string) {
  if (next.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(`Kata sandi baru minimal ${MIN_PASSWORD_LENGTH} karakter.`, "validation", { next: "Terlalu pendek" });
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(user.passwordHash, current))) {
    throw new AppError("Kata sandi saat ini salah.", "validation", { current: "Salah" });
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } }),
    // Keluarkan semua sesi lain.
    prisma.session.deleteMany({
      where: { userId, ...(keepSessionToken ? { NOT: { tokenHash: hashToken(keepSessionToken) } } : {}) },
    }),
  ]);
}
