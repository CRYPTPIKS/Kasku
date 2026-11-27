import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { accountUsage, createAccount, deleteAccount } from "@/server/services/accounts";
import { setBudget } from "@/server/services/budgets";
import { categoryUsage, createCategory, deleteCategory } from "@/server/services/categories";
import { createTransaction, deleteTransaction } from "@/server/services/transactions";
import { resetDb, setupHousehold } from "./helpers";

let h: Awaited<ReturnType<typeof setupHousehold>>;
beforeEach(async () => {
  await resetDb();
  h = await setupHousehold();
});

describe("hapus rekening", () => {
  it("rekening kosong terhapus permanen", async () => {
    const a = await createAccount(h.ctx, { name: "Salah Ketik", kind: "bank", initialBalance: 0 });
    expect(await accountUsage(h.ctx, a.id)).toEqual({ transactions: 0, debts: 0, investments: 0, trashed: 0 });
    await deleteAccount(h.ctx, a.id);
    expect(await prisma.account.findUnique({ where: { id: a.id } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: a.id, action: "delete" } })).toBe(1);
  });

  it("rekening yang dipakai transfer ditolak, saldo rekening lain aman", async () => {
    await createTransaction(h.ctx, { type: "transfer", amount: 200_000, occurredAt: new Date(), fromAccountId: h.bca.id, toAccountId: h.gopay.id });
    expect((await accountUsage(h.ctx, h.gopay.id)).transactions).toBe(1);
    await expect(deleteAccount(h.ctx, h.gopay.id)).rejects.toThrow(/masih dipakai di 1 transaksi/);
    expect(await prisma.account.count({ where: { id: h.gopay.id } })).toBe(1);
  });

  it("transaksi di tempat sampah tidak menghalangi, ikut dihapus permanen", async () => {
    const t = await createTransaction(h.ctx, { type: "expense", amount: 10_000, occurredAt: new Date(), fromAccountId: h.gopay.id, categoryId: h.food.id });
    await deleteTransaction(h.ctx, t.id);
    expect(await accountUsage(h.ctx, h.gopay.id)).toMatchObject({ transactions: 0, trashed: 1 });
    await deleteAccount(h.ctx, h.gopay.id);
    expect(await prisma.transaction.count({ where: { id: t.id } })).toBe(0);
  });
});

describe("hapus kategori", () => {
  it("kategori kosong terhapus beserta anggarannya", async () => {
    const c = await createCategory(h.ctx, { name: "Coba", kind: "expense" });
    await setBudget(h.ctx, { categoryId: c.id, amount: 100_000 });
    expect(await categoryUsage(h.ctx, c.id)).toEqual({ transactions: 0, children: 0, budgets: 1 });
    await deleteCategory(h.ctx, c.id);
    expect(await prisma.category.count({ where: { id: c.id } })).toBe(0);
    expect(await prisma.budget.count({ where: { categoryId: c.id } })).toBe(0);
  });

  it("kategori yang dipakai atau punya subkategori ditolak", async () => {
    await createTransaction(h.ctx, { type: "expense", amount: 10_000, occurredAt: new Date(), fromAccountId: h.cash.id, categoryId: h.food.id });
    await expect(deleteCategory(h.ctx, h.food.id)).rejects.toThrow(/masih dipakai/);
    const parent = await createCategory(h.ctx, { name: "Induk", kind: "expense" });
    await createCategory(h.ctx, { name: "Anak", kind: "expense", parentId: parent.id });
    await expect(deleteCategory(h.ctx, parent.id)).rejects.toThrow(/subkategori/);
  });
});
