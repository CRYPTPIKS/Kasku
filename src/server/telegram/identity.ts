import type { User as TelegramUser } from "grammy/types";
import { prisma } from "../db";
import type { ServiceContext } from "../context";

/**
 * Petakan pengguna Telegram (yang sudah lolos whitelist) ke akun dashboard.
 * Versi awal: identitas baru otomatis ditautkan ke pemilik household pertama.
 */
export async function resolveIdentity(
  from: TelegramUser,
  chatId: number | undefined,
): Promise<{ svc: ServiceContext; telegramUserId: bigint } | null> {
  const telegramUserId = BigInt(from.id);
  let identity = await prisma.telegramIdentity.findUnique({ where: { telegramUserId } });
  if (!identity) {
    const owner = await prisma.householdMember.findFirst({ where: { role: "owner" }, orderBy: { createdAt: "asc" } });
    if (!owner) return null;
    identity = await prisma.telegramIdentity.create({
      data: {
        userId: owner.userId,
        telegramUserId,
        username: from.username ?? null,
        firstName: from.first_name ?? null,
        chatId: chatId !== undefined ? BigInt(chatId) : null,
      },
    });
  } else if (chatId !== undefined && identity.chatId !== BigInt(chatId)) {
    identity = await prisma.telegramIdentity.update({ where: { id: identity.id }, data: { chatId: BigInt(chatId) } });
  }
  const membership = await prisma.householdMember.findFirst({
    where: { userId: identity.userId },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) return null;
  return {
    telegramUserId,
    svc: { householdId: membership.householdId, userId: identity.userId, role: membership.role, source: "telegram" },
  };
}
