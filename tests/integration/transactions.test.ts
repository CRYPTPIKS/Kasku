import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { getAccount, listAccounts } from "@/server/services/accounts";
import {
  confirmTransaction,
  createTransaction,
  deleteTransaction,
  duplicateTransaction,
  listTransactions,
  restoreTransaction,
  updateTransaction,
} from "@/server/services/transactions";
import { monthlyCashFlow, periodTotals, totalsByCategory } from "@/server/services/reports";
import { monthRange } from "@/lib/dates";
import { resetDb, setupHousehold } from "./helpers";

let h: Awaited<ReturnType<typeof setupHousehold>>;
const nov = monthRange(2026, 11);
const at = (iso: string) => new Date(iso);

beforeEach(async () => {
  await resetDb();
  h = await setupHousehold();
});

describe("transaksi & saldo", () => {
  it("pengeluaran mengurangi saldo, pemasukan menambah", async () => {
    await createTransaction(h.ctx, { type: "expense", amount: "75rb", occurredAt: at("2026-11-10T05:00:00Z"), categoryId: h.food.id, fromAccountId: h.cash.id });
    await createTransaction(h.ctx, { type: "income", amount: "12jt", occurredAt: at("2026-11-01T03:00:00Z"), categoryId: h.salary.id, toAccountId: h.bca.id });
    expect((await getAccount(h.ctx, h.cash.id)).balance).toBe(925_000);
    expect((await getAccount(h.ctx, h.bca.id)).balance).toBe(22_000_000);
  });

  it("transfer memindahkan saldo dan tidak dihitung sebagai pemasukan/pengeluaran", async () => {
    await createTransaction(h.ctx, { type: "transfer", amount: 500_000, occurredAt: at("2026-11-12T02:00:00Z"), fromAccountId: h.bca.id, toAccountId: h.gopay.id });
    const accounts = await listAccounts(h.ctx);
    expect(accounts.find((a) => a.id === h.bca.id)?.balance).toBe(9_500_000);
    expect(accounts.find((a) => a.id === h.gopay.id)?.balance).toBe(500_000);
    const totals = await periodTotals(h.ctx, nov.start, nov.end);
    expect(totals).toEqual({ income: 0, expense: 0, net: 0 });
    const entries = await prisma.ledgerEntry.findMany();
    expect(entries.reduce((a, e) => a + Number(e.amount), 0)).toBe(0);
  });

  it("transfer tidak boleh memakai kategori", async () => {
    await expect(
      createTransaction(h.ctx, { type: "transfer", amount: 1000, occurredAt: new Date(), fromAccountId: h.bca.id, toAccountId: h.gopay.id, categoryId: h.food.id }),
    ).rejects.toThrow(/tidak memakai kategori/);
  });

  it("menolak kategori dengan jenis yang salah", async () => {
    await expect(
      createTransaction(h.ctx, { type: "expense", amount: 1000, occurredAt: new Date(), fromAccountId: h.cash.id, categoryId: h.salary.id }),
    ).rejects.toThrow(/kategori pengeluaran/);
  });

  it("menolak rekening dari household lain", async () => {
    const other = await prisma.household.create({ data: { name: "Lain" } });
    const type = await prisma.accountType.create({ data: { householdId: other.id, kind: "cash", name: "Tunai" } });
    const foreign = await prisma.account.create({ data: { householdId: other.id, accountTypeId: type.id, name: "Asing" } });
    await expect(
      createTransaction(h.ctx, { type: "expense", amount: 1000, occurredAt: new Date(), fromAccountId: foreign.id }),
    ).rejects.toThrow(/Rekening tidak ditemukan/);
  });

  it("draf tidak memengaruhi saldo sampai dikonfirmasi", async () => {
    const draft = await createTransaction(h.ctx, { type: "expense", status: "draft", amount: 50_000, occurredAt: new Date(), categoryId: h.food.id });
    expect((await getAccount(h.ctx, h.cash.id)).balance).toBe(1_000_000);
    // Konfirmasi gagal karena rekening belum dipilih.
    await expect(confirmTransaction(h.ctx, draft.id)).rejects.toThrow(/Rekening asal wajib/);
    const withAccount = await updateTransaction(h.ctx, draft.id, { type: "expense", status: "draft", amount: 50_000, occurredAt: draft.occurredAt, categoryId: h.food.id, fromAccountId: h.cash.id });
    expect((await getAccount(h.ctx, h.cash.id)).balance).toBe(1_000_000);
    const confirmed = await confirmTransaction(h.ctx, withAccount.id);
    expect(confirmed.status).toBe("confirmed");
    expect((await getAccount(h.ctx, h.cash.id)).balance).toBe(950_000);
    const audit = await prisma.auditLog.findMany({ where: { entityId: draft.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["create", "update", "confirm"]);
  });

  it("bagi transaksi: jumlah bagian harus sama dengan total, laporan memakai bagian", async () => {
    await expect(
      createTransaction(h.ctx, {
        type: "expense",
        amount: 300_000,
        occurredAt: at("2026-11-05T05:00:00Z"),
        fromAccountId: h.bca.id,
        splits: [
          { categoryId: h.food.id, amount: 100_000 },
          { categoryId: h.groceries.id, amount: 150_000 },
        ],
      }),
    ).rejects.toThrow(/Jumlah semua bagian/);

    const t = await createTransaction(h.ctx, {
      type: "expense",
      amount: 300_000,
      occurredAt: at("2026-11-05T05:00:00Z"),
      fromAccountId: h.bca.id,
      splits: [
        { categoryId: h.food.id, amount: 100_000 },
        { categoryId: h.groceries.id, amount: "200rb" },
      ],
    });
    expect(t.categoryId).toBeNull();
    expect(t.splits).toHaveLength(2);
    const byCat = await totalsByCategory(h.ctx, "expense", nov.start, nov.end);
    expect(byCat.map((c) => [c.name, c.total])).toEqual([
      ["Belanja Harian", 200_000],
      ["Makan & Minum", 100_000],
    ]);
  });

  it("hapus bersifat soft delete dan hanya admin yang bisa memulihkan", async () => {
    const t = await createTransaction(h.ctx, { type: "expense", amount: 100_000, occurredAt: new Date(), fromAccountId: h.cash.id });
    await deleteTransaction(h.ctx, t.id);
    expect((await getAccount(h.ctx, h.cash.id)).balance).toBe(1_000_000);
    expect(await prisma.transaction.count({ where: { id: t.id } })).toBe(1);
    expect((await listTransactions(h.ctx)).total).toBe(0);
    expect((await listTransactions(h.ctx, { deleted: "only" })).total).toBe(1);

    await expect(restoreTransaction({ ...h.ctx, role: "member" }, t.id)).rejects.toThrow(/Hanya admin/);
    await restoreTransaction(h.ctx, t.id);
    expect((await getAccount(h.ctx, h.cash.id)).balance).toBe(900_000);
    const actions = (await prisma.auditLog.findMany({ where: { entityId: t.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["create", "delete", "restore"]);
  });

  it("viewer tidak bisa membuat transaksi", async () => {
    await expect(
      createTransaction({ ...h.ctx, role: "viewer" }, { type: "expense", amount: 1, occurredAt: new Date(), fromAccountId: h.cash.id }),
    ).rejects.toThrow(/tidak punya akses/);
  });

  it("duplikasi membuat salinan dengan tag", async () => {
    const t = await createTransaction(h.ctx, { type: "expense", amount: 20_000, occurredAt: new Date(), fromAccountId: h.cash.id, tags: "#Kantor, kantor, ngopi" });
    expect(t.tags.map((x) => x.tag.name).sort()).toEqual(["kantor", "ngopi"]);
    const copy = await duplicateTransaction(h.ctx, t.id);
    expect(copy.id).not.toBe(t.id);
    expect(copy.tags).toHaveLength(2);
    expect((await getAccount(h.ctx, h.cash.id)).balance).toBe(960_000);
  });

  it("filter pencarian, tag, dan rekening", async () => {
    await createTransaction(h.ctx, { type: "expense", amount: 20_000, occurredAt: new Date(), fromAccountId: h.cash.id, description: "Kopi susu", tags: "ngopi" });
    await createTransaction(h.ctx, { type: "expense", amount: 425_000, occurredAt: new Date(), fromAccountId: h.bca.id, description: "Bayar listrik" });
    expect((await listTransactions(h.ctx, { q: "kopi" })).total).toBe(1);
    expect((await listTransactions(h.ctx, { tag: "ngopi" })).total).toBe(1);
    expect((await listTransactions(h.ctx, { accountId: h.bca.id })).items[0]?.description).toBe("Bayar listrik");
  });
});

describe("laporan arus kas", () => {
  it("batas bulan mengikuti WIB", async () => {
    // 2026-10-31 18:00 UTC = 1 Nov 01:00 WIB -> masuk November.
    await createTransaction(h.ctx, { type: "expense", amount: 10_000, occurredAt: at("2026-10-31T18:00:00Z"), fromAccountId: h.cash.id });
    // 2026-10-31 16:00 UTC = 31 Okt 23:00 WIB -> masuk Oktober.
    await createTransaction(h.ctx, { type: "expense", amount: 5_000, occurredAt: at("2026-10-31T16:00:00Z"), fromAccountId: h.cash.id });
    await createTransaction(h.ctx, { type: "income", amount: 1_000_000, occurredAt: at("2026-11-15T00:00:00Z"), toAccountId: h.bca.id });
    await createTransaction(h.ctx, { type: "transfer", amount: 300_000, occurredAt: at("2026-11-16T00:00:00Z"), fromAccountId: h.bca.id, toAccountId: h.cash.id });
    const rows = await monthlyCashFlow(h.ctx, monthRange(2026, 9).start, nov.end);
    expect(rows).toEqual([
      { month: "2026-09", income: 0, expense: 0, net: 0 },
      { month: "2026-10", income: 0, expense: 5_000, net: -5_000 },
      { month: "2026-11", income: 1_000_000, expense: 10_000, net: 990_000 },
    ]);
  });
});
