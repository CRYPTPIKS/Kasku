/** Isi data contoh untuk mencoba dashboard (hanya untuk development). */
import { prisma } from "../src/server/db";
import { createTransaction } from "../src/server/services/transactions";
import type { ServiceContext } from "../src/server/context";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Jangan jalankan data contoh di production.");
  const m = await prisma.householdMember.findFirstOrThrow({ where: { role: "owner" } });
  const ctx: ServiceContext = { householdId: m.householdId, userId: m.userId, role: "owner", source: "system" };
  const acc = Object.fromEntries((await prisma.account.findMany({ where: { householdId: m.householdId } })).map((a) => [a.name, a.id]));
  const cat = Object.fromEntries((await prisma.category.findMany({ where: { householdId: m.householdId } })).map((c) => [c.name, c.id]));
  const now = Date.now();
  const d = (days: number) => new Date(now - days * 86400000);
  const rows = [
    { type: "income", amount: "12jt", categoryId: cat["Gaji"], toAccountId: acc["BCA"], description: "Gaji November", occurredAt: d(20) },
    { type: "income", amount: "11,5jt", categoryId: cat["Gaji"], toAccountId: acc["BCA"], description: "Gaji Oktober", occurredAt: d(50) },
    { type: "expense", amount: "75rb", categoryId: cat["Makan & Minum"], fromAccountId: acc["Tunai"], description: "Makan siang", occurredAt: d(1) },
    { type: "expense", amount: "425000", categoryId: cat["Tagihan & Utilitas"], fromAccountId: acc["BCA"], description: "Bayar listrik", occurredAt: d(3) },
    { type: "transfer", amount: "500rb", fromAccountId: acc["BCA"], toAccountId: acc["GoPay"], description: "Isi saldo GoPay", occurredAt: d(4) },
    { type: "expense", amount: "35rb", categoryId: cat["Transportasi"], fromAccountId: acc["GoPay"], description: "Gojek ke kantor", occurredAt: d(2) },
    { type: "expense", amount: "1,2jt", categoryId: cat["Belanja Harian"], fromAccountId: acc["Kartu Kredit"], description: "Belanja bulanan", occurredAt: d(6) },
    { type: "expense", amount: "2,5jt", categoryId: cat["Tempat Tinggal"], fromAccountId: acc["BCA"], description: "Sewa kos", occurredAt: d(18) },
    { type: "expense", amount: "3jt", categoryId: cat["Tempat Tinggal"], fromAccountId: acc["BCA"], description: "Sewa kos", occurredAt: d(48) },
    { type: "expense", amount: "900rb", categoryId: cat["Makan & Minum"], fromAccountId: acc["BCA"], description: "Makan Oktober", occurredAt: d(45) },
    { type: "expense", amount: "48rb", categoryId: cat["Makan & Minum"], status: "draft", description: "Kopi (draf)", occurredAt: d(0) },
  ] as const;
  for (const r of rows) await createTransaction(ctx, { ...r } as never);
  console.log(`✓ ${rows.length} transaksi contoh dibuat`);
}
main().finally(() => prisma.$disconnect());
