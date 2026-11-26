import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db";
import { env } from "../env";

export const SESSION_COOKIE = "kasku_session";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, meta: { userAgent?: string | null; ipAddress?: string | null }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env().SESSION_TTL_DAYS * 86400000);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { twoFactorEnabled: true } });
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      // Jika 2FA aktif, sesi harus diverifikasi langkah kedua (belum diimplementasikan).
      verified: !user.twoFactorEnabled,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      ipAddress: meta.ipAddress?.slice(0, 64) ?? null,
    },
  });
  return { token, expiresAt };
}

export async function validateSessionToken(token: string | undefined | null) {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          isActive: true,
          twoFactorEnabled: true,
          memberships: { select: { householdId: true, role: true }, orderBy: { createdAt: "asc" }, take: 1 },
        },
      },
    },
  });
  if (!session) return null;
  if (session.expiresAt < new Date() || !session.user.isActive) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (!session.verified) return null;
  // Perbarui lastSeenAt paling sering tiap 5 menit.
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return session;
}

export async function revokeSession(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function revokeAllSessions(userId: string, exceptTokenHash?: string) {
  await prisma.session.deleteMany({
    where: { userId, ...(exceptTokenHash ? { NOT: { tokenHash: exceptTokenHash } } : {}) },
  });
}
