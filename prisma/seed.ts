/**
 * Seed: household, kategori Indonesia, contoh rekening, dan (opsional) pemilik.
 * Aman dijalankan berulang kali.
 *
 *   SEED_ADMIN_EMAIL=saya@contoh.com SEED_ADMIN_PASSWORD='...' npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import { ensureHousehold, ensureSampleAccounts, upsertOwner } from "../src/server/services/setup";

const prisma = new PrismaClient();

async function main() {
  const household = await ensureHousehold(prisma);
  console.log(`✓ Household: ${household.name}`);
  console.log("✓ Kategori bawaan tersedia");

  if (process.env.SEED_SAMPLE_ACCOUNTS !== "false") {
    await ensureSampleAccounts(prisma, household.id);
    console.log("✓ Contoh rekening: Tunai, BCA, Mandiri, GoPay, OVO, Kartu Kredit");
  }

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    const { created } = await upsertOwner(prisma, household.id, { email, password, name: process.env.SEED_ADMIN_NAME });
    console.log(created ? `✓ Pemilik dibuat: ${email}` : `• Pemilik sudah ada: ${email} (kata sandi tidak diubah)`);
  } else {
    console.log("• SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD kosong — buat pengguna dengan: npm run user:create");
  }
}

main()
  .catch((e) => {
    console.error("Seed gagal:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
