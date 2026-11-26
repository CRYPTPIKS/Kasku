import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { getAccount } from "@/server/services/accounts";
import { setBudget } from "@/server/services/budgets";
import { createDebt } from "@/server/services/debts";
import { getPortfolio } from "@/server/services/investments";
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

describe("bot: hutang & piutang", () => {
  it("pinjam dengan cicilan → usulan → Simpan membuat hutang + jadwal + uang masuk", async () => {
    await t.send("pinjam 2jt dari Budi ke BCA cicilan 300rb tiap tanggal 10");
    expect(t.lastText()).toContain("Hutang baru Rp2.000.000");
    expect(t.lastText()).toContain("Meminjam dari: Budi");
    expect(t.lastText()).toContain("7× Rp300.000");
    expect(t.lastText()).toContain("Rekening: BCA");
    expect(await prisma.debt.count()).toBe(0);

    await pressButton(/Simpan/);
    expect(t.lastText()).toContain("Hutang tercatat");
    const debt = await prisma.debt.findFirstOrThrow({ include: { installments: { orderBy: { sequence: "asc" } } } });
    expect(debt.counterparty).toBe("Budi");
    expect(debt.installments.map((i) => Number(i.amount))).toEqual([300_000, 300_000, 300_000, 300_000, 300_000, 300_000, 200_000]);
    expect(debt.installments.every((i) => new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric" }).format(i.dueDate) === "10")).toBe(true);
    expect((await getAccount(h.ctx, h.bca.id)).balance).toBe(12_000_000);
    expect(await prisma.telegramPendingAction.count()).toBe(0);

    // Tombol yang sama ditekan lagi tidak membuat hutang ganda.
    await t.press(`pa:ok:x`);
    expect(t.alerts().at(-1)).toMatch(/kedaluwarsa/);
    expect(await prisma.debt.count()).toBe(1);
  });

  it("bayar hutang dengan nama pihak, pilih rekening lewat tombol, lalu /hutang", async () => {
    await createDebt(h.ctx, { direction: "payable", counterparty: "Budi", principalAmount: 1_000_000, startDate: new Date() });
    await t.send("bayar hutang 400rb ke budi");
    expect(t.lastText()).toContain("Bayar hutang Rp400.000");
    expect(t.lastText()).toContain("Sisa setelah ini: Rp600.000");

    await pressButton(/Ubah rekening/);
    await pressButton(/^BCA$/);
    expect(t.lastText()).toContain("Rekening: BCA");
    await pressButton(/Simpan/);
    expect(t.lastText()).toContain("Sisa Rp600.000");
    expect((await getAccount(h.ctx, h.bca.id)).balance).toBe(9_600_000);

    await t.send("/hutang");
    expect(t.lastText()).toContain("Sisa hutang: Rp600.000");
    expect(t.lastText()).toContain("Budi");
  });

  it("bayar ke orang yang tidak punya hutang", async () => {
    await t.send("bayar hutang 100rb ke Siapa");
    expect(t.lastText()).toContain("Tidak ada hutang ke Siapa");
  });

  it("pinjamkan → piutang; Batal tidak mencatat apa pun", async () => {
    await t.send("pinjamkan 300rb ke Andi dari Tunai");
    expect(t.lastText()).toContain("Piutang baru Rp300.000");
    expect(t.lastText()).toContain("Rekening: Tunai");
    await pressButton(/Batal/);
    expect(t.lastText()).toContain("Dibatalkan");
    expect(await prisma.debt.count()).toBe(0);
  });
});

describe("bot: investasi", () => {
  it("beli saham dalam lot membuat aset baru; /investasi menampilkan portofolio", async () => {
    await t.send("beli BBCA 2 lot @9500 dari BCA");
    expect(t.lastText()).toContain("Beli BBCA Rp1.900.000");
    expect(t.lastText()).toContain("200 lembar @ Rp9.500");
    expect(t.lastText()).toContain("Aset baru: Saham");
    await pressButton(/Simpan/);
    expect(t.lastText()).toContain("Pembelian BBCA tercatat");

    const p = await getPortfolio(h.ctx);
    expect(p.items[0]).toMatchObject({ symbol: "BBCA", units: 200, costBasis: 1_900_000 });
    expect((await getAccount(h.ctx, h.bca.id)).balance).toBe(8_100_000);

    await t.send("beli BBCA 1 lot @10000 dari BCA");
    expect(t.lastText()).not.toContain("Aset baru");
    await pressButton(/Simpan/);
    expect(await prisma.investmentAsset.count()).toBe(1);

    await t.send("dividen BBCA 150rb ke BCA");
    expect(t.lastText()).toContain("Dividen BBCA Rp150.000");
    await pressButton(/Simpan/);

    await t.send("/investasi");
    expect(t.lastText()).toContain("Portofolio: Rp3.000.000");
    expect(t.lastText()).toContain("BBCA");
  });

  it("jual aset yang tidak ada ditolak dengan sopan", async () => {
    await t.send("jual TLKM 1 lot @3000 ke BCA");
    expect(t.lastText()).toContain("belum ada di portofolio");
  });

  it("jual melebihi kepemilikan: pesan error saat Simpan", async () => {
    await t.send("beli emas 2 gram 3jt dari BCA");
    await pressButton(/Simpan/);
    await t.send("jual emas 5 gram 8jt ke BCA");
    await pressButton(/Simpan/);
    expect(t.alerts().at(-1)).toMatch(/melebihi/);
  });
});

describe("bot: anggaran", () => {
  it("Simpan pengeluaran yang membuat anggaran lewat 80% memberi peringatan", async () => {
    await setBudget(h.ctx, { categoryId: h.food.id, amount: 100_000 });
    await t.send("keluar 85rb makan siang pakai Tunai");
    await pressButton(/Simpan/);
    expect(t.lastText()).toContain("Anggaran <b>Makan &amp; Minum</b> sudah terpakai 85%");

    await t.send("/anggaran");
    expect(t.lastText()).toContain("Makan &amp; Minum</b> 85%");
  });
});
