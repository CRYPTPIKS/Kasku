import type { Prisma, TransactionStatus, TransactionType } from "@prisma/client";
import { parseDateInput, addDays } from "@/lib/dates";
import { prisma, type Tx } from "../db";
import { AppError, notFound } from "../errors";
import { canWrite, isAdmin, type ServiceContext } from "../context";
import { writeAudit } from "../audit";
import { buildLedgerLines, usesCategory } from "../ledger";
import {
  transactionFilterSchema,
  transactionInputSchema,
  type TransactionData,
  type TransactionFilter,
  type TransactionInput,
} from "../validation/transaction";

const transactionInclude = {
  category: { select: { id: true, name: true, icon: true, color: true, kind: true } },
  fromAccount: { select: { id: true, name: true } },
  toAccount: { select: { id: true, name: true } },
  splits: { include: { category: { select: { id: true, name: true, icon: true } } }, orderBy: { sortOrder: "asc" } },
  tags: { include: { tag: { select: { id: true, name: true } } } },
  attachments: true,
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
} satisfies Prisma.TransactionInclude;

export type TransactionWithRelations = Prisma.TransactionGetPayload<{ include: typeof transactionInclude }>;

function assertWrite(ctx: ServiceContext) {
  if (!canWrite(ctx)) throw new AppError("Anda tidak punya akses mengubah data.", "forbidden");
}

/** Validasi relasi (rekening, kategori, hutang) milik household yang sama & konsisten. */
async function validateRelations(tx: Tx, ctx: ServiceContext, data: TransactionData) {
  const accountIds = [data.fromAccountId, data.toAccountId].filter((x): x is string => Boolean(x));
  if (accountIds.length) {
    const accounts = await tx.account.findMany({
      where: { id: { in: accountIds }, householdId: ctx.householdId },
      select: { id: true, isArchived: true, name: true },
    });
    for (const id of accountIds) {
      const acc = accounts.find((a) => a.id === id);
      if (!acc) throw new AppError("Rekening tidak ditemukan.", "validation", { [id === data.fromAccountId ? "fromAccountId" : "toAccountId"]: "Rekening tidak ditemukan" });
      if (acc.isArchived) throw new AppError(`Rekening "${acc.name}" sudah diarsipkan.`);
    }
  }

  if (!usesCategory(data.type)) {
    if (data.categoryId || data.splits.some((s) => s.categoryId)) {
      throw new AppError("Jenis transaksi ini tidak memakai kategori.", "validation", { categoryId: "Kosongkan kategori" });
    }
  }

  const expectedKind = data.type === "expense" ? "expense" : "income";
  const categoryIds = [data.categoryId, ...data.splits.map((s) => s.categoryId)].filter((x): x is string => Boolean(x));
  if (categoryIds.length) {
    const cats = await tx.category.findMany({
      where: { id: { in: categoryIds }, householdId: ctx.householdId },
      select: { id: true, kind: true },
    });
    for (const id of new Set(categoryIds)) {
      const cat = cats.find((c) => c.id === id);
      if (!cat) throw new AppError("Kategori tidak ditemukan.", "validation", { categoryId: "Kategori tidak ditemukan" });
      if (cat.kind !== expectedKind) {
        throw new AppError(
          expectedKind === "expense" ? "Pilih kategori pengeluaran." : "Pilih kategori pemasukan.",
          "validation",
          { categoryId: "Jenis kategori tidak sesuai" },
        );
      }
    }
  }

  if (data.splits.length) {
    if (data.splits.length < 2) throw new AppError("Pembagian transaksi minimal 2 bagian.", "validation", { splits: "Minimal 2 bagian" });
    const total = Math.round(data.splits.reduce((a, s) => a + s.amount, 0) * 100);
    if (total !== Math.round(data.amount * 100)) {
      throw new AppError("Jumlah semua bagian harus sama dengan total transaksi.", "validation", {
        splits: "Jumlah bagian tidak sama dengan total",
      });
    }
  }

  let debtDirection: "payable" | "receivable" | null = null;
  if (data.debtId) {
    const debt = await tx.debt.findFirst({ where: { id: data.debtId, householdId: ctx.householdId }, select: { direction: true } });
    if (!debt) throw notFound("Hutang/piutang");
    debtDirection = debt.direction;
  } else if (data.type === "debt_payment") {
    throw new AppError("Pilih hutang/piutang yang dibayar.", "validation", { debtId: "Wajib dipilih" });
  }

  // Draf boleh belum lengkap rekeningnya; ledger hanya dibangun saat lengkap.
  return { debtDirection };
}

/** Bangun entri ledger; untuk draf yang belum lengkap kembalikan [] alih-alih error. */
function ledgerFor(data: TransactionData, debtDirection: "payable" | "receivable" | null, status: TransactionStatus) {
  try {
    return buildLedgerLines({
      type: data.type,
      amount: data.amount,
      fromAccountId: data.fromAccountId,
      toAccountId: data.toAccountId,
      debtDirection,
    });
  } catch (err) {
    if (status === "draft") return [];
    throw err;
  }
}

async function upsertTags(tx: Tx, householdId: string, names: string[]) {
  const ids: string[] = [];
  for (const name of names) {
    const tag = await tx.tag.upsert({
      where: { householdId_name: { householdId, name } },
      create: { householdId, name },
      update: {},
      select: { id: true },
    });
    ids.push(tag.id);
  }
  return ids;
}

async function writeChildren(tx: Tx, ctx: ServiceContext, transactionId: string, data: TransactionData, lines: { accountId: string; amount: number }[]) {
  await tx.ledgerEntry.deleteMany({ where: { transactionId } });
  await tx.transactionSplit.deleteMany({ where: { transactionId } });
  await tx.transactionTag.deleteMany({ where: { transactionId } });
  if (lines.length) await tx.ledgerEntry.createMany({ data: lines.map((l) => ({ transactionId, ...l })) });
  if (data.splits.length) {
    await tx.transactionSplit.createMany({
      data: data.splits.map((s, i) => ({ transactionId, categoryId: s.categoryId, amount: s.amount, note: s.note, sortOrder: i })),
    });
  }
  if (data.tags.length) {
    const tagIds = await upsertTags(tx, ctx.householdId, data.tags);
    await tx.transactionTag.createMany({ data: tagIds.map((tagId) => ({ transactionId, tagId })) });
  }
}

function scalarData(data: TransactionData) {
  return {
    type: data.type,
    status: data.status,
    occurredAt: data.occurredAt,
    amount: data.amount,
    description: data.description,
    merchant: data.merchant,
    note: data.note,
    // Jika dibagi, kategori ada di tiap bagian.
    categoryId: data.splits.length ? null : data.categoryId,
    fromAccountId: data.fromAccountId,
    toAccountId: data.toAccountId,
    debtId: data.debtId,
  };
}

export async function createTransaction(
  ctx: ServiceContext,
  raw: TransactionInput,
  opts: { source?: "web" | "telegram_text" | "telegram_receipt" | "import" | "system"; tx?: Tx } = {},
) {
  assertWrite(ctx);
  const data = transactionInputSchema.parse(raw);
  const run = async (tx: Tx) => {
    const { debtDirection } = await validateRelations(tx, ctx, data);
    const lines = ledgerFor(data, debtDirection, data.status);
    const created = await tx.transaction.create({
      data: {
        householdId: ctx.householdId,
        source: opts.source ?? "web",
        createdById: ctx.userId,
        updatedById: ctx.userId,
        ...scalarData(data),
      },
    });
    await writeChildren(tx, ctx, created.id, data, lines);
    const full = await tx.transaction.findUniqueOrThrow({ where: { id: created.id }, include: transactionInclude });
    await writeAudit(tx, ctx, { entityType: "Transaction", entityId: created.id, action: "create", after: full });
    return full;
  };
  return opts.tx ? run(opts.tx) : prisma.$transaction(run);
}

export async function updateTransaction(ctx: ServiceContext, id: string, raw: TransactionInput) {
  assertWrite(ctx);
  const data = transactionInputSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const before = await tx.transaction.findFirst({
      where: { id, householdId: ctx.householdId, deletedAt: null },
      include: transactionInclude,
    });
    if (!before) throw notFound("Transaksi");
    const { debtDirection } = await validateRelations(tx, ctx, data);
    const lines = ledgerFor(data, debtDirection, data.status);
    await tx.transaction.update({ where: { id }, data: { ...scalarData(data), updatedById: ctx.userId } });
    await writeChildren(tx, ctx, id, data, lines);
    const after = await tx.transaction.findUniqueOrThrow({ where: { id }, include: transactionInclude });
    await writeAudit(tx, ctx, {
      entityType: "Transaction",
      entityId: id,
      action: before.status === "draft" && after.status === "confirmed" ? "confirm" : "update",
      before,
      after,
    });
    return after;
  });
}

/** Ubah draf menjadi terkonfirmasi. Gagal jika data wajib (rekening) belum lengkap. */
export async function confirmTransaction(ctx: ServiceContext, id: string) {
  const t = await getTransaction(ctx, id);
  if (t.status === "confirmed") return t;
  return updateTransaction(ctx, id, toInput(t, { status: "confirmed" }));
}

/** Konversi transaksi tersimpan menjadi input (untuk edit/duplikasi). */
export function toInput(t: TransactionWithRelations, override: Partial<TransactionInput> = {}): TransactionInput {
  return {
    type: t.type,
    status: t.status,
    occurredAt: t.occurredAt,
    amount: Number(t.amount),
    description: t.description,
    merchant: t.merchant,
    note: t.note,
    categoryId: t.categoryId,
    fromAccountId: t.fromAccountId,
    toAccountId: t.toAccountId,
    debtId: t.debtId,
    tags: t.tags.map((x) => x.tag.name),
    splits: t.splits.map((s) => ({ categoryId: s.categoryId, amount: Number(s.amount), note: s.note })),
    ...override,
  };
}

export async function duplicateTransaction(ctx: ServiceContext, id: string) {
  const t = await getTransaction(ctx, id);
  return createTransaction(ctx, toInput(t, { occurredAt: new Date() }));
}

export async function deleteTransaction(ctx: ServiceContext, id: string) {
  assertWrite(ctx);
  return prisma.$transaction(async (tx) => {
    const before = await tx.transaction.findFirst({ where: { id, householdId: ctx.householdId, deletedAt: null } });
    if (!before) throw notFound("Transaksi");
    const after = await tx.transaction.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: ctx.userId, updatedById: ctx.userId },
    });
    await writeAudit(tx, ctx, { entityType: "Transaction", entityId: id, action: "delete", before, after });
    return after;
  });
}

/** Pulihkan transaksi yang dihapus (khusus admin/pemilik). */
export async function restoreTransaction(ctx: ServiceContext, id: string) {
  if (!isAdmin(ctx)) throw new AppError("Hanya admin yang bisa memulihkan transaksi.", "forbidden");
  return prisma.$transaction(async (tx) => {
    const before = await tx.transaction.findFirst({ where: { id, householdId: ctx.householdId, NOT: { deletedAt: null } } });
    if (!before) throw notFound("Transaksi terhapus");
    const after = await tx.transaction.update({
      where: { id },
      data: { deletedAt: null, deletedById: null, updatedById: ctx.userId },
    });
    await writeAudit(tx, ctx, { entityType: "Transaction", entityId: id, action: "restore", before, after });
    return after;
  });
}

export async function getTransaction(ctx: ServiceContext, id: string, opts: { includeDeleted?: boolean } = {}) {
  const t = await prisma.transaction.findFirst({
    where: { id, householdId: ctx.householdId, ...(opts.includeDeleted ? {} : { deletedAt: null }) },
    include: transactionInclude,
  });
  if (!t) throw notFound("Transaksi");
  return t;
}

export function buildTransactionWhere(ctx: ServiceContext, raw: TransactionFilter): Prisma.TransactionWhereInput {
  const f = transactionFilterSchema.parse(raw);
  const where: Prisma.TransactionWhereInput = { householdId: ctx.householdId };
  if (f.deleted === "only") where.NOT = { deletedAt: null };
  else if (f.deleted !== "include") where.deletedAt = null;
  if (f.status) where.status = f.status;
  if (f.type) where.type = f.type as TransactionType;
  const from = f.from ? parseDateInput(f.from) : null;
  const to = f.to ? parseDateInput(f.to) : null;
  if (from || to) where.occurredAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: addDays(to, 1) } : {}) };
  const and: Prisma.TransactionWhereInput[] = [];
  if (f.categoryId) and.push({ OR: [{ categoryId: f.categoryId }, { splits: { some: { categoryId: f.categoryId } } }] });
  if (f.accountId) and.push({ OR: [{ fromAccountId: f.accountId }, { toAccountId: f.accountId }] });
  if (f.tag) and.push({ tags: { some: { tag: { name: f.tag.toLowerCase() } } } });
  if (f.q) {
    const q = f.q;
    and.push({
      OR: [
        { description: { contains: q, mode: "insensitive" } },
        { merchant: { contains: q, mode: "insensitive" } },
        { note: { contains: q, mode: "insensitive" } },
        { category: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  if (and.length) where.AND = and;
  return where;
}

export async function listTransactions(ctx: ServiceContext, raw: TransactionFilter = {}) {
  const f = transactionFilterSchema.parse(raw);
  const where = buildTransactionWhere(ctx, raw);
  const [items, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: transactionInclude,
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
    prisma.transaction.count({ where }),
  ]);
  return { items, total, page: f.page, pageSize: f.pageSize, pageCount: Math.max(1, Math.ceil(total / f.pageSize)) };
}

/** Semua transaksi sesuai filter (untuk ekspor), dibatasi agar aman. */
export async function listTransactionsForExport(ctx: ServiceContext, raw: TransactionFilter = {}, limit = 50000) {
  return prisma.transaction.findMany({
    where: buildTransactionWhere(ctx, raw),
    include: transactionInclude,
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
}

export async function countDrafts(ctx: ServiceContext) {
  return prisma.transaction.count({ where: { householdId: ctx.householdId, status: "draft", deletedAt: null } });
}

