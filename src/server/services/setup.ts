import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "../auth/password";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, SAMPLE_ACCOUNTS } from "../seed-data";
import { ensureAccountTypes } from "./accounts";

/** Buat household + kategori bawaan (idempoten). */
export async function ensureHousehold(db: PrismaClient, name = "Keuangan Pribadi") {
  let household = await db.household.findFirst({ orderBy: { createdAt: "asc" } });
  household ??= await db.household.create({ data: { name } });
  await ensureAccountTypes(household.id, db);
  for (const [kind, list] of [
    ["expense", EXPENSE_CATEGORIES],
    ["income", INCOME_CATEGORIES],
  ] as const) {
    for (const [i, c] of list.entries()) {
      await db.category.upsert({
        where: { householdId_kind_name: { householdId: household.id, kind, name: c.name } },
        create: { householdId: household.id, kind, name: c.name, icon: c.icon, color: c.color, keywords: c.keywords, sortOrder: i },
        update: {},
      });
    }
  }
  return household;
}

export async function ensureSampleAccounts(db: PrismaClient, householdId: string) {
  const types = await db.accountType.findMany({ where: { householdId } });
  for (const [i, a] of SAMPLE_ACCOUNTS.entries()) {
    const type = types.find((t) => t.kind === a.kind);
    if (!type) continue;
    await db.account.upsert({
      where: { householdId_name: { householdId, name: a.name } },
      create: { householdId, accountTypeId: type.id, name: a.name, aliases: [...a.aliases], sortOrder: i },
      update: {},
    });
  }
}

/** Buat atau perbarui pengguna pemilik dan kaitkan ke household. */
export async function upsertOwner(
  db: PrismaClient,
  householdId: string,
  input: { email: string; password: string; name?: string; resetPassword?: boolean },
) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email tidak valid.");
  const existing = await db.user.findUnique({ where: { email } });
  let user;
  if (existing) {
    user = input.resetPassword
      ? await db.user.update({ where: { id: existing.id }, data: { passwordHash: await hashPassword(input.password) } })
      : existing;
    if (input.resetPassword) await db.session.deleteMany({ where: { userId: existing.id } });
  } else {
    user = await db.user.create({
      data: { email, name: input.name ?? email.split("@")[0]!, passwordHash: await hashPassword(input.password) },
    });
  }
  await db.householdMember.upsert({
    where: { householdId_userId: { householdId, userId: user.id } },
    create: { householdId, userId: user.id, role: "owner" },
    update: {},
  });
  return { user, created: !existing };
}
