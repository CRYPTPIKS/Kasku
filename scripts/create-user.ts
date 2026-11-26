/**
 * Buat pemilik dashboard atau reset kata sandinya.
 *
 *   npm run user:create -- --email saya@contoh.com --name "Rafa"
 *   npm run user:create -- --email saya@contoh.com --reset
 *
 * Kata sandi dibaca dari prompt (tidak tampil di layar) atau env KASKU_PASSWORD.
 */
import { PrismaClient } from "@prisma/client";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";
import { ensureHousehold, upsertOwner } from "../src/server/services/setup";

async function promptHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const { values } = parseArgs({
    options: { email: { type: "string" }, name: { type: "string" }, reset: { type: "boolean", default: false } },
  });
  if (!values.email) throw new Error("Gunakan --email <alamat>");
  let password = process.env.KASKU_PASSWORD ?? "";
  if (!password) {
    password = await promptHidden("Kata sandi (min. 10 karakter): ");
    const confirm = await promptHidden("Ulangi kata sandi: ");
    if (password !== confirm) throw new Error("Kata sandi tidak sama.");
  }
  const prisma = new PrismaClient();
  try {
    const household = await ensureHousehold(prisma);
    const { created } = await upsertOwner(prisma, household.id, {
      email: values.email,
      password,
      name: values.name,
      resetPassword: values.reset,
    });
    console.log(created ? "✓ Pengguna dibuat." : values.reset ? "✓ Kata sandi diperbarui, semua sesi dikeluarkan." : "• Pengguna sudah ada. Pakai --reset untuk mengganti kata sandi.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Gagal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
