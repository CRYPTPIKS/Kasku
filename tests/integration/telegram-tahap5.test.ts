import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { getAccount } from "@/server/services/accounts";
import { createDebt } from "@/server/services/debts";
import { createTransaction } from "@/server/services/transactions";
import { resetDb, setupHousehold } from "./helpers";
import { createTestBot } from "./telegram-harness";

const t = createTestBot();
let h: Awaited<ReturnType<typeof setupHousehold>>;

beforeEach(async () => {
  await resetDb();
  h = await setupHousehold();
  t.reset();
});

const pressButton = async (label: RegExp) => {
  const b = t.buttons().find((x) => label.test(x.text));
  if (!b) throw new Error(`Tombol ${label} tidak ada: ${t.buttons().map((x) => x.text).join(", ")}`);
  await t.press(b.callback_data);
};

describe("bot: pertanyaan bebas", () => {
  it("Berapa saldo sekarang? → semua rekening", async () => {
    await t.send("Berapa saldo sekarang?");
    expect(t.lastText()).toContain("Saldo rekening");
    expect(t.lastText()).toContain("BCA: <b>Rp10.000.000</b>");
  });

  it("saldo satu rekening", async () => {
    await t.send("saldo bca berapa?");
    expect(t.lastText()).toContain("BCA");
    expect(t.lastText()).toContain("Rp10.000.000");
    expect(t.lastText()).not.toContain("Tunai");
  });

  it("pengeluaran per kategori minggu ini", async () => {
    await createTransaction(h.ctx, { type: "expense", amount: 50_000, occurredAt: new Date(), categoryId: h.food.id, fromAccountId: h.cash.id });
    await createTransaction(h.ctx, { type: "expense", amount: 70_000, occurredAt: new Date(), categoryId: h.groceries.id, fromAccountId: h.cash.id });
    await t.send("pengeluaran makan minggu ini berapa?");
    expect(t.lastText()).toContain("Rp50.000");
    expect(t.lastText()).not.toContain("Rp120.000");
    await t.send("pengeluaran hari ini");
    expect(t.lastText()).toContain("Rp120.000");
  });

  it("hutang ke Budi berapa?", async () => {
    await createDebt(h.ctx, { direction: "payable", counterparty: "Budi", principalAmount: 1_000_000, startDate: new Date() });
    await t.send("hutang ke Budi berapa?");
    expect(t.lastText()).toContain("Budi");
    expect(t.lastText()).toContain("Rp1.000.000");
  });

  it("tidak paham → tombol pilihan, dan tombolnya jalan", async () => {
    await t.send("halo bot apa kabar");
    expect(t.lastText()).toContain("belum paham");
    await pressButton(/Saldo/);
    expect(t.lastText()).toContain("Saldo rekening");
  });

  it("pesan transaksi tetap dicatat sebagai draf", async () => {
    await t.send("keluar 75rb makan siang pakai tunai");
    expect(t.lastText()).toContain("draf, belum disimpan");
    expect(await prisma.transaction.count({ where: { status: "draft" } })).toBe(1);
  });
});

describe("bot: undo", () => {
  it("tombol Batalkan setelah simpan menghapus transaksi dan mengembalikan saldo", async () => {
    await t.send("keluar 75rb makan siang pakai tunai");
    await pressButton(/Simpan/);
    expect((await getAccount(h.ctx, h.cash.id)).balance).toBe(925_000);
    await pressButton(/Batalkan/);
    expect(t.lastText()).toContain("dibatalkan");
    expect((await getAccount(h.ctx, h.cash.id)).balance).toBe(1_000_000);
    expect(await prisma.transaction.count({ where: { deletedAt: null } })).toBe(0);
  });

  it("Batalkan ditolak setelah 10 menit", async () => {
    await t.send("keluar 75rb makan siang pakai tunai");
    await pressButton(/Simpan/);
    const tx = await prisma.transaction.findFirstOrThrow();
    await prisma.$executeRaw`UPDATE "Transaction" SET "updatedAt" = now() - interval '11 minutes' WHERE id = ${tx.id}`;
    await t.press(`tx:undo:${tx.id}`);
    expect(t.alerts().at(-1)).toMatch(/lewat 10 menit/);
    expect(await prisma.transaction.count({ where: { deletedAt: null } })).toBe(1);
  });

  it("hapus yang tadi → konfirmasi → terhapus", async () => {
    await t.send("keluar 30rb kopi pakai tunai");
    await pressButton(/Simpan/);
    await t.send("hapus yang tadi");
    expect(t.lastText()).toContain("Hapus transaksi terakhir ini?");
    expect(t.lastText()).toContain("Rp30.000");
    await pressButton(/Ya, hapus/);
    expect(await prisma.transaction.count({ where: { deletedAt: null } })).toBe(0);
  });

  it("hapus yang tadi tidak menyentuh transaksi dari dashboard", async () => {
    await createTransaction(h.ctx, { type: "expense", amount: 50_000, occurredAt: new Date(), categoryId: h.food.id, fromAccountId: h.cash.id });
    await t.send("hapus yang tadi");
    expect(t.lastText()).toContain("Tidak ada transaksi dari bot");
    expect(await prisma.transaction.count({ where: { deletedAt: null } })).toBe(1);
  });
});
