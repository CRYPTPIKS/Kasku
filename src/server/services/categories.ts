import type { CategoryKind } from "@prisma/client";
import { prisma } from "../db";
import { AppError, notFound } from "../errors";
import { canWrite, type ServiceContext } from "../context";
import { writeAudit } from "../audit";
import { categoryInputSchema, type CategoryInput } from "../validation/category";

export const CATEGORY_KIND_LABELS: Record<CategoryKind, string> = { income: "Pemasukan", expense: "Pengeluaran" };

export async function listCategories(ctx: ServiceContext, opts: { kind?: CategoryKind; includeArchived?: boolean } = {}) {
  return prisma.category.findMany({
    where: {
      householdId: ctx.householdId,
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.includeArchived ? {} : { isArchived: false }),
    },
    orderBy: [{ kind: "asc" }, { isArchived: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { transactions: { where: { deletedAt: null } } } } },
  });
}

async function validateParent(ctx: ServiceContext, parentId: string | null, kind: CategoryKind, selfId?: string) {
  if (!parentId) return;
  if (parentId === selfId) throw new AppError("Kategori tidak bisa menjadi induk dirinya sendiri.");
  const parent = await prisma.category.findFirst({ where: { id: parentId, householdId: ctx.householdId } });
  if (!parent) throw notFound("Kategori induk");
  if (parent.kind !== kind) throw new AppError("Jenis kategori induk harus sama.");
  if (parent.parentId) throw new AppError("Sub-kategori hanya boleh satu tingkat.");
}

export async function createCategory(ctx: ServiceContext, raw: CategoryInput) {
  if (!canWrite(ctx)) throw new AppError("Anda tidak punya akses mengubah data.", "forbidden");
  const input = categoryInputSchema.parse(raw);
  await validateParent(ctx, input.parentId, input.kind);
  return prisma.$transaction(async (tx) => {
    const category = await tx.category.create({ data: { householdId: ctx.householdId, ...input } });
    await writeAudit(tx, ctx, { entityType: "Category", entityId: category.id, action: "create", after: category });
    return category;
  });
}

export async function updateCategory(ctx: ServiceContext, id: string, raw: CategoryInput) {
  if (!canWrite(ctx)) throw new AppError("Anda tidak punya akses mengubah data.", "forbidden");
  const input = categoryInputSchema.parse(raw);
  const before = await prisma.category.findFirst({ where: { id, householdId: ctx.householdId } });
  if (!before) throw notFound("Kategori");
  if (before.kind !== input.kind) {
    const used = await prisma.transaction.count({ where: { categoryId: id } });
    if (used > 0) throw new AppError("Jenis kategori tidak bisa diubah karena sudah dipakai transaksi.");
  }
  await validateParent(ctx, input.parentId, input.kind, id);
  return prisma.$transaction(async (tx) => {
    const category = await tx.category.update({ where: { id }, data: input });
    await writeAudit(tx, ctx, { entityType: "Category", entityId: id, action: "update", before, after: category });
    return category;
  });
}

export async function setCategoryArchived(ctx: ServiceContext, id: string, archived: boolean) {
  if (!canWrite(ctx)) throw new AppError("Anda tidak punya akses mengubah data.", "forbidden");
  const before = await prisma.category.findFirst({ where: { id, householdId: ctx.householdId } });
  if (!before) throw notFound("Kategori");
  return prisma.$transaction(async (tx) => {
    const category = await tx.category.update({ where: { id }, data: { isArchived: archived } });
    await writeAudit(tx, ctx, { entityType: "Category", entityId: id, action: "update", before, after: category });
    return category;
  });
}

export interface CategoryUsage {
  transactions: number;
  children: number;
  budgets: number;
}

export async function categoryUsage(ctx: ServiceContext, id: string): Promise<CategoryUsage> {
  const [transactions, children, budgets] = await Promise.all([
    prisma.transaction.count({
      where: { householdId: ctx.householdId, deletedAt: null, OR: [{ categoryId: id }, { splits: { some: { categoryId: id } } }] },
    }),
    prisma.category.count({ where: { householdId: ctx.householdId, parentId: id } }),
    prisma.budget.count({ where: { householdId: ctx.householdId, categoryId: id } }),
  ]);
  return { transactions, children, budgets };
}

/** Hapus permanen kategori yang belum dipakai transaksi dan tidak punya subkategori. */
export async function deleteCategory(ctx: ServiceContext, id: string) {
  if (!canWrite(ctx)) throw new AppError("Anda tidak punya akses mengubah data.", "forbidden");
  const before = await prisma.category.findFirst({ where: { id, householdId: ctx.householdId } });
  if (!before) throw notFound("Kategori");
  const usage = await categoryUsage(ctx, id);
  if (usage.transactions > 0) {
    throw new AppError(`Kategori "${before.name}" masih dipakai di ${usage.transactions} transaksi, jadi tidak bisa dihapus. Arsipkan saja.`);
  }
  if (usage.children > 0) throw new AppError(`Kategori "${before.name}" masih punya ${usage.children} subkategori. Hapus atau pindahkan dulu.`);
  return prisma.$transaction(async (tx) => {
    // Anggaran & aturan merchant ikut terhapus (cascade); transaksi di tempat sampah jadi tanpa kategori.
    await tx.category.delete({ where: { id } });
    await writeAudit(tx, ctx, { entityType: "Category", entityId: id, action: "delete", before: { ...before, budgets: usage.budgets } });
  });
}
