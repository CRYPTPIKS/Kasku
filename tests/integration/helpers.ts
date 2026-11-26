import { prisma } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import { ensureHousehold, upsertOwner } from "@/server/services/setup";
import { createAccount } from "@/server/services/accounts";

export async function resetDb() {
  // Pengaman: hanya kosongkan database test.
  const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  const db = row?.db ?? "";
  if (!db.endsWith("_test")) throw new Error(`Menolak mengosongkan database "${db}" (bukan database test).`);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
}

export async function setupHousehold(role: ServiceContext["role"] = "owner") {
  const household = await ensureHousehold(prisma);
  const { user } = await upsertOwner(prisma, household.id, { email: "pemilik@contoh.test", password: "kata-sandi-kuat-123" });
  const ctx: ServiceContext = { householdId: household.id, userId: user.id, role, source: "web" };
  const [cash, bca, gopay] = [
    await createAccount(ctx, { name: "Tunai", kind: "cash", initialBalance: 1_000_000 }),
    await createAccount(ctx, { name: "BCA", kind: "bank", initialBalance: 10_000_000, aliases: "bca" }),
    await createAccount(ctx, { name: "GoPay", kind: "ewallet", initialBalance: 0 }),
  ];
  const food = await prisma.category.findFirstOrThrow({ where: { householdId: household.id, name: "Makan & Minum" } });
  const groceries = await prisma.category.findFirstOrThrow({ where: { householdId: household.id, name: "Belanja Harian" } });
  const salary = await prisma.category.findFirstOrThrow({ where: { householdId: household.id, name: "Gaji" } });
  return { household, user, ctx, cash, bca, gopay, food, groceries, salary };
}
