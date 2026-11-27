import type { AccountKind, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { AppError, notFound } from "../errors";
import { canWrite, type ServiceContext } from "../context";
import { writeAudit } from "../audit";
import { accountInputSchema, type AccountInput } from "../validation/account";

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  cash: "Tunai",
  bank: "Bank",
  ewallet: "E-wallet",
  credit_card: "Kartu kredit",
  deposit: "Deposito",
  other: "Lainnya",
};

const DEFAULT_TYPES: { kind: AccountKind; isLiability: boolean }[] = [
  { kind: "cash", isLiability: false },
  { kind: "bank", isLiability: false },
  { kind: "ewallet", isLiability: false },
  { kind: "credit_card", isLiability: true },
  { kind: "deposit", isLiability: false },
  { kind: "other", isLiability: false },
];

/** Pastikan jenis rekening bawaan tersedia untuk household. */
export async function ensureAccountTypes(householdId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  for (const [i, t] of DEFAULT_TYPES.entries()) {
    await db.accountType.upsert({
      where: { householdId_kind: { householdId, kind: t.kind } },
      create: { householdId, kind: t.kind, name: ACCOUNT_KIND_LABELS[t.kind], isLiability: t.isLiability, sortOrder: i },
      update: {},
    });
  }
}

/** Mutasi bersih per rekening dari transaksi terkonfirmasi yang belum dihapus. */
export async function accountMovements(householdId: string, accountIds?: string[], upTo?: Date) {
  const rows = await prisma.ledgerEntry.groupBy({
    by: ["accountId"],
    where: {
      ...(accountIds ? { accountId: { in: accountIds } } : {}),
      transaction: {
        householdId,
        status: "confirmed",
        deletedAt: null,
        ...(upTo ? { occurredAt: { lt: upTo } } : {}),
      },
    },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.accountId, Number(r._sum.amount ?? 0)]));
}

export interface AccountWithBalance {
  id: string;
  name: string;
  kind: AccountKind;
  kindLabel: string;
  isLiability: boolean;
  institution: string | null;
  accountNumberLast4: string | null;
  aliases: string[];
  color: string | null;
  isArchived: boolean;
  initialBalance: number;
  creditLimit: number | null;
  balance: number;
}

export async function listAccounts(ctx: ServiceContext, opts: { includeArchived?: boolean } = {}): Promise<AccountWithBalance[]> {
  const accounts = await prisma.account.findMany({
    where: { householdId: ctx.householdId, ...(opts.includeArchived ? {} : { isArchived: false }) },
    include: { accountType: true },
    orderBy: [{ isArchived: "asc" }, { accountType: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
  });
  const movements = await accountMovements(
    ctx.householdId,
    accounts.map((a) => a.id),
  );
  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.accountType.kind,
    kindLabel: a.accountType.name,
    isLiability: a.accountType.isLiability,
    institution: a.institution,
    accountNumberLast4: a.accountNumberLast4,
    aliases: a.aliases,
    color: a.color,
    isArchived: a.isArchived,
    initialBalance: Number(a.initialBalance),
    creditLimit: a.creditLimit === null ? null : Number(a.creditLimit),
    balance: Math.round((Number(a.initialBalance) + (movements.get(a.id) ?? 0)) * 100) / 100,
  }));
}

export async function getAccount(ctx: ServiceContext, id: string) {
  const [account] = (await listAccounts(ctx, { includeArchived: true })).filter((a) => a.id === id);
  if (!account) throw notFound("Rekening");
  return account;
}

/** Total saldo: aset dikurangi kewajiban (saldo kartu kredit negatif = tagihan). */
export function summarizeBalances(accounts: AccountWithBalance[]) {
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    if (a.isArchived) continue;
    if (a.balance >= 0) assets += a.balance;
    else liabilities += -a.balance;
  }
  return { assets, liabilities, net: assets - liabilities };
}

async function assertUniqueAliases(ctx: ServiceContext, aliases: string[], exceptId?: string) {
  if (aliases.length === 0) return;
  const clash = await prisma.account.findFirst({
    where: {
      householdId: ctx.householdId,
      aliases: { hasSome: aliases },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { name: true },
  });
  if (clash) throw new AppError(`Alias sudah dipakai rekening "${clash.name}".`, "conflict");
}

export async function createAccount(ctx: ServiceContext, raw: AccountInput) {
  if (!canWrite(ctx)) throw new AppError("Anda tidak punya akses mengubah data.", "forbidden");
  const input = accountInputSchema.parse(raw);
  await ensureAccountTypes(ctx.householdId);
  await assertUniqueAliases(ctx, input.aliases);
  return prisma.$transaction(async (tx) => {
    const type = await tx.accountType.findUniqueOrThrow({
      where: { householdId_kind: { householdId: ctx.householdId, kind: input.kind } },
    });
    const account = await tx.account.create({
      data: {
        householdId: ctx.householdId,
        accountTypeId: type.id,
        name: input.name,
        institution: input.institution,
        accountNumberLast4: input.accountNumberLast4,
        initialBalance: input.initialBalance,
        creditLimit: input.creditLimit ?? null,
        aliases: input.aliases,
        color: input.color,
      },
    });
    await writeAudit(tx, ctx, { entityType: "Account", entityId: account.id, action: "create", after: account });
    return account;
  });
}

export async function updateAccount(ctx: ServiceContext, id: string, raw: AccountInput) {
  if (!canWrite(ctx)) throw new AppError("Anda tidak punya akses mengubah data.", "forbidden");
  const input = accountInputSchema.parse(raw);
  const before = await prisma.account.findFirst({ where: { id, householdId: ctx.householdId } });
  if (!before) throw notFound("Rekening");
  await ensureAccountTypes(ctx.householdId);
  await assertUniqueAliases(ctx, input.aliases, id);
  return prisma.$transaction(async (tx) => {
    const type = await tx.accountType.findUniqueOrThrow({
      where: { householdId_kind: { householdId: ctx.householdId, kind: input.kind } },
    });
    const account = await tx.account.update({
      where: { id },
      data: {
        accountTypeId: type.id,
        name: input.name,
        institution: input.institution,
        accountNumberLast4: input.accountNumberLast4,
        initialBalance: input.initialBalance,
        creditLimit: input.creditLimit ?? null,
        aliases: input.aliases,
        color: input.color,
      },
    });
    await writeAudit(tx, ctx, { entityType: "Account", entityId: id, action: "update", before, after: account });
    return account;
  });
}

export async function setAccountArchived(ctx: ServiceContext, id: string, archived: boolean) {
  if (!canWrite(ctx)) throw new AppError("Anda tidak punya akses mengubah data.", "forbidden");
  const before = await prisma.account.findFirst({ where: { id, householdId: ctx.householdId } });
  if (!before) throw notFound("Rekening");
  return prisma.$transaction(async (tx) => {
    const account = await tx.account.update({ where: { id }, data: { isArchived: archived } });
    await writeAudit(tx, ctx, { entityType: "Account", entityId: id, action: "update", before, after: account });
    return account;
  });
}

export interface AccountUsage {
  /** Transaksi aktif yang memakai rekening ini (termasuk transfer, hutang, investasi). */
  transactions: number;
  debts: number;
  investments: number;
  /** Transaksi di tempat sampah (sudah dihapus lunak) yang ikut terhapus permanen. */
  trashed: number;
}

/** Seberapa banyak data yang bergantung pada rekening ini. */
export async function accountUsage(ctx: ServiceContext, id: string): Promise<AccountUsage> {
  const touches = { householdId: ctx.householdId, OR: [{ fromAccountId: id }, { toAccountId: id }, { entries: { some: { accountId: id } } }] };
  const [transactions, debtRows, investments, trashed] = await Promise.all([
    prisma.transaction.count({ where: { ...touches, deletedAt: null } }),
    prisma.transaction.findMany({ where: { ...touches, deletedAt: null, debtId: { not: null } }, select: { debtId: true }, distinct: ["debtId"] }),
    prisma.transaction.count({ where: { ...touches, deletedAt: null, investmentTransaction: { isNot: null } } }),
    prisma.transaction.count({ where: { ...touches, NOT: { deletedAt: null } } }),
  ]);
  return { transactions, debts: debtRows.length, investments, trashed };
}

/**
 * Hapus permanen rekening yang belum pernah dipakai. Rekening yang masih punya
 * transaksi ditolak (riwayat & saldo rekening lain bisa rusak) — arsipkan saja.
 */
export async function deleteAccount(ctx: ServiceContext, id: string) {
  if (!canWrite(ctx)) throw new AppError("Anda tidak punya akses mengubah data.", "forbidden");
  const before = await prisma.account.findFirst({ where: { id, householdId: ctx.householdId } });
  if (!before) throw notFound("Rekening");
  const usage = await accountUsage(ctx, id);
  if (usage.transactions > 0) {
    throw new AppError(`Rekening "${before.name}" masih dipakai di ${usage.transactions} transaksi, jadi tidak bisa dihapus. Arsipkan saja.`);
  }
  return prisma.$transaction(async (tx) => {
    // Transaksi di tempat sampah ikut dihapus permanen supaya rekening bisa dilepas.
    const trashed = await tx.transaction.deleteMany({
      where: { householdId: ctx.householdId, NOT: { deletedAt: null }, OR: [{ fromAccountId: id }, { toAccountId: id }, { entries: { some: { accountId: id } } }] },
    });
    await tx.telegramIdentity.updateMany({ where: { defaultAccountId: id }, data: { defaultAccountId: null } });
    await tx.account.delete({ where: { id } });
    await writeAudit(tx, ctx, { entityType: "Account", entityId: id, action: "delete", before: { ...before, purgedTrashedTransactions: trashed.count } });
    return { purgedTrashed: trashed.count };
  });
}
