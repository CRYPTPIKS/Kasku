import type { DebtDirection, DebtStatus, Prisma } from "@prisma/client";
import { addMonthsJakarta, formatDate, jakartaParts } from "@/lib/dates";
import { prisma, type Tx } from "../db";
import { AppError, notFound } from "../errors";
import { canWrite, type ServiceContext } from "../context";
import { writeAudit } from "../audit";
import {
  debtInputSchema,
  debtPaymentInputSchema,
  type DebtInput,
  type DebtPaymentInput,
} from "../validation/tahap4";
import { recomputeDebt } from "./debt-balance";
import { createTransaction } from "./transactions";

type Source = "web" | "telegram_text" | "system";

export const DEBT_DIRECTION_LABELS: Record<DebtDirection, string> = { payable: "Hutang", receivable: "Piutang" };
export const DEBT_STATUS_LABELS: Record<DebtStatus, string> = { active: "Berjalan", paid: "Lunas", overdue: "Terlambat" };

function assertWrite(ctx: ServiceContext) {
  if (!canWrite(ctx)) throw new AppError("Anda tidak punya akses mengubah data.", "forbidden");
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Jadwal cicilan bulanan. Tanpa nominal cicilan, pokok dibagi rata (sisa pembulatan di cicilan terakhir). */
export function buildInstallmentSchedule(
  principal: number,
  count: number,
  firstDue: Date,
  perInstallment?: number | null,
  /** true: cicilan terakhir = sisa pokok (mis. 2jt dicicil 300rb -> 6×300rb + 200rb). */
  remainderLast = false,
) {
  const day = jakartaParts(firstDue).day;
  const even = Math.floor((principal / count) * 100) / 100;
  return Array.from({ length: count }, (_, i) => {
    const last = i === count - 1;
    const amount =
      perInstallment && remainderLast
        ? last
          ? round2(principal - perInstallment * (count - 1))
          : perInstallment
        : (perInstallment ?? (last ? round2(principal - even * (count - 1)) : even));
    return { sequence: i + 1, dueDate: addMonthsJakarta(firstDue, i, day), amount };
  });
}

async function assertAccount(tx: Tx, ctx: ServiceContext, accountId: string | null) {
  if (!accountId) return;
  const acc = await tx.account.findFirst({ where: { id: accountId, householdId: ctx.householdId } });
  if (!acc) throw new AppError("Rekening tidak ditemukan.", "validation", { accountId: "Rekening tidak ditemukan" });
  if (acc.isArchived) throw new AppError(`Rekening "${acc.name}" sudah diarsipkan.`);
}

/**
 * Catat hutang (saya meminjam) atau piutang (saya meminjamkan).
 * Jika rekening diisi, uang pinjaman ikut tercatat masuk/keluar rekening.
 */
export async function createDebt(ctx: ServiceContext, raw: DebtInput, opts: { source?: Source } = {}) {
  assertWrite(ctx);
  const input = debtInputSchema.parse(raw);
  const schedule =
    input.installmentCount && input.firstDueDate
      ? buildInstallmentSchedule(input.principalAmount, input.installmentCount, input.firstDueDate, input.installmentAmount, input.remainderLast)
      : [];
  const lastDue = schedule.at(-1)?.dueDate ?? null;

  return prisma.$transaction(async (tx) => {
    await assertAccount(tx, ctx, input.accountId);
    const debt = await tx.debt.create({
      data: {
        householdId: ctx.householdId,
        direction: input.direction,
        counterparty: input.counterparty,
        principalAmount: input.principalAmount,
        remainingAmount: input.principalAmount,
        startDate: input.startDate,
        dueDate: input.dueDate ?? lastDue,
        note: input.note,
        reminderDaysBefore: input.reminderDaysBefore,
        installments: { create: schedule },
      },
    });
    if (input.accountId) {
      const payable = input.direction === "payable";
      await createTransaction(
        ctx,
        {
          type: payable ? "debt_payable" : "debt_receivable",
          status: "confirmed",
          amount: input.principalAmount,
          occurredAt: input.startDate,
          description: payable ? `Pinjaman dari ${input.counterparty}` : `Pinjaman ke ${input.counterparty}`,
          toAccountId: payable ? input.accountId : null,
          fromAccountId: payable ? null : input.accountId,
          debtId: debt.id,
        },
        { tx, source: opts.source ?? "web" },
      );
    }
    const updated = await recomputeDebt(tx, debt.id);
    await writeAudit(tx, ctx, { entityType: "Debt", entityId: debt.id, action: "create", after: { ...updated, installments: schedule } });
    return updated!;
  });
}

/** Bayar hutang / terima cicilan piutang. */
export async function recordDebtPayment(ctx: ServiceContext, debtId: string, raw: DebtPaymentInput, opts: { source?: Source } = {}) {
  assertWrite(ctx);
  const input = debtPaymentInputSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const debt = await tx.debt.findFirst({ where: { id: debtId, householdId: ctx.householdId } });
    if (!debt) throw notFound("Hutang/piutang");
    if (debt.status === "paid") throw new AppError(`${DEBT_DIRECTION_LABELS[debt.direction]} ini sudah lunas.`);
    if (input.amount > Number(debt.remainingAmount) + 0.005) {
      throw new AppError(`Pembayaran melebihi sisa (${new Intl.NumberFormat("id-ID").format(Number(debt.remainingAmount))}).`, "validation", {
        amount: "Melebihi sisa",
      });
    }
    if (input.installmentId) {
      const inst = await tx.debtInstallment.findFirst({ where: { id: input.installmentId, debtId } });
      if (!inst) throw notFound("Cicilan");
    }
    await assertAccount(tx, ctx, input.accountId);
    const payable = debt.direction === "payable";
    const t = await createTransaction(
      ctx,
      {
        type: "debt_payment",
        status: "confirmed",
        amount: input.amount,
        occurredAt: input.occurredAt,
        description: payable ? `Bayar hutang ke ${debt.counterparty}` : `Terima cicilan dari ${debt.counterparty}`,
        note: input.note,
        fromAccountId: payable ? input.accountId : null,
        toAccountId: payable ? null : input.accountId,
        debtId,
      },
      { tx, source: opts.source ?? "web" },
    );
    if (input.installmentId) await tx.transaction.update({ where: { id: t.id }, data: { debtInstallmentId: input.installmentId } });
    const updated = await recomputeDebt(tx, debtId);
    return { debt: updated!, transaction: t };
  });
}

export async function updateDebtDetails(
  ctx: ServiceContext,
  id: string,
  raw: { counterparty?: string; dueDate?: Date | null; note?: string | null; reminderDaysBefore?: number },
) {
  assertWrite(ctx);
  return prisma.$transaction(async (tx) => {
    const before = await tx.debt.findFirst({ where: { id, householdId: ctx.householdId } });
    if (!before) throw notFound("Hutang/piutang");
    const counterparty = raw.counterparty?.trim();
    if (raw.counterparty !== undefined && !counterparty) throw new AppError("Isi nama pihak terkait.", "validation", { counterparty: "Wajib diisi" });
    const after = await tx.debt.update({
      where: { id },
      data: {
        ...(counterparty ? { counterparty: counterparty.slice(0, 80) } : {}),
        ...(raw.dueDate !== undefined ? { dueDate: raw.dueDate } : {}),
        ...(raw.note !== undefined ? { note: raw.note?.slice(0, 500) || null } : {}),
        ...(raw.reminderDaysBefore !== undefined ? { reminderDaysBefore: Math.max(0, Math.min(30, raw.reminderDaysBefore)) } : {}),
      },
    });
    await recomputeDebt(tx, id);
    await writeAudit(tx, ctx, { entityType: "Debt", entityId: id, action: "update", before, after });
    return after;
  });
}

/** Hapus hutang/piutang beserta transaksi terkaitnya (transaksi di-soft delete). */
export async function deleteDebt(ctx: ServiceContext, id: string) {
  assertWrite(ctx);
  return prisma.$transaction(async (tx) => {
    const before = await tx.debt.findFirst({ where: { id, householdId: ctx.householdId }, include: { installments: true } });
    if (!before) throw notFound("Hutang/piutang");
    const linked = await tx.transaction.findMany({ where: { debtId: id }, select: { id: true, deletedAt: true } });
    const now = new Date();
    for (const t of linked) {
      await tx.transaction.update({
        where: { id: t.id },
        data: { debtId: null, debtInstallmentId: null, ...(t.deletedAt ? {} : { deletedAt: now, deletedById: ctx.userId }) },
      });
    }
    await tx.debt.delete({ where: { id } });
    await writeAudit(tx, ctx, { entityType: "Debt", entityId: id, action: "delete", before: { ...before, transactionIds: linked.map((t) => t.id) } });
  });
}

const debtListInclude = {
  installments: { orderBy: { sequence: "asc" } },
} satisfies Prisma.DebtInclude;

export type DebtWithInstallments = Prisma.DebtGetPayload<{ include: typeof debtListInclude }>;

/** Cicilan berikutnya yang belum lunas. */
export function nextInstallment(d: DebtWithInstallments) {
  return d.installments.find((i) => Number(i.paidAmount) < Number(i.amount) - 0.005) ?? null;
}

export async function listDebts(ctx: ServiceContext, opts: { direction?: DebtDirection; includePaid?: boolean } = {}) {
  const debts = await prisma.debt.findMany({
    where: {
      householdId: ctx.householdId,
      ...(opts.direction ? { direction: opts.direction } : {}),
      ...(opts.includePaid ? {} : { status: { not: "paid" } }),
    },
    include: debtListInclude,
    orderBy: [{ status: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
  });
  // Status "terlambat" bergantung waktu: segarkan yang mungkin berubah.
  const now = new Date();
  const stale = debts.filter((d) => d.status !== "paid" && isLikelyStale(d, now));
  if (stale.length) {
    await prisma.$transaction(async (tx) => {
      for (const d of stale) {
        const u = await recomputeDebt(tx, d.id, now);
        if (u) d.status = u.status;
      }
    });
  }
  return debts;
}

function isLikelyStale(d: DebtWithInstallments, now: Date) {
  const n = nextInstallment(d);
  const due = n?.dueDate ?? d.dueDate;
  const overdueNow = !!due && due.getTime() + 86400000 <= now.getTime();
  return overdueNow !== (d.status === "overdue");
}

export async function getDebt(ctx: ServiceContext, id: string) {
  const debt = await prisma.debt.findFirst({
    where: { id, householdId: ctx.householdId },
    include: {
      ...debtListInclude,
      transactions: {
        where: { deletedAt: null },
        orderBy: { occurredAt: "desc" },
        include: { fromAccount: { select: { name: true } }, toAccount: { select: { name: true } } },
      },
    },
  });
  if (!debt) throw notFound("Hutang/piutang");
  const now = Date.now();
  return {
    ...debt,
    installments: debt.installments.map((i) => ({ ...i, isLate: !i.paidAt && i.dueDate.getTime() + 86400000 <= now })),
  };
}

export async function debtSummary(ctx: ServiceContext) {
  const rows = await prisma.debt.groupBy({
    by: ["direction"],
    where: { householdId: ctx.householdId, status: { not: "paid" } },
    _sum: { remainingAmount: true },
    _count: true,
  });
  const overdue = await prisma.debt.count({ where: { householdId: ctx.householdId, status: "overdue" } });
  const get = (d: DebtDirection) => rows.find((r) => r.direction === d);
  return {
    payable: Number(get("payable")?._sum.remainingAmount ?? 0),
    payableCount: get("payable")?._count ?? 0,
    receivable: Number(get("receivable")?._sum.remainingAmount ?? 0),
    receivableCount: get("receivable")?._count ?? 0,
    overdue,
  };
}

/** Cicilan/jatuh tempo yang belum lunas dalam `days` hari ke depan (termasuk yang terlambat). */
export async function upcomingDebtDues(ctx: ServiceContext, days = 7, now = new Date()) {
  const until = new Date(now.getTime() + days * 86400000);
  const debts = await prisma.debt.findMany({
    where: { householdId: ctx.householdId, status: { not: "paid" } },
    include: debtListInclude,
  });
  const out: { debt: DebtWithInstallments; dueDate: Date; amount: number; sequence: number | null; overdue: boolean }[] = [];
  for (const d of debts) {
    if (d.installments.length) {
      for (const i of d.installments) {
        const left = round2(Number(i.amount) - Number(i.paidAmount));
        if (left <= 0 || i.dueDate > until) continue;
        out.push({ debt: d, dueDate: i.dueDate, amount: left, sequence: i.sequence, overdue: i.dueDate.getTime() + 86400000 <= now.getTime() });
      }
    } else if (d.dueDate && d.dueDate <= until) {
      out.push({ debt: d, dueDate: d.dueDate, amount: Number(d.remainingAmount), sequence: null, overdue: d.dueDate.getTime() + 86400000 <= now.getTime() });
    }
  }
  return out.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

/** Cari hutang/piutang aktif berdasarkan nama pihak (untuk bot). */
export async function findActiveDebtsByCounterparty(ctx: ServiceContext, name: string, direction?: DebtDirection | null) {
  return prisma.debt.findMany({
    where: {
      householdId: ctx.householdId,
      status: { not: "paid" },
      counterparty: { equals: name.trim(), mode: "insensitive" },
      ...(direction ? { direction } : {}),
    },
    include: debtListInclude,
    orderBy: { createdAt: "asc" },
  });
}

export function describeDue(d: Date) {
  return formatDate(d);
}
