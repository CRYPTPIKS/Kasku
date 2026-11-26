import { currentMonthRange, jakartaParts, monthRange, parseMonthKey } from "@/lib/dates";
import { prisma } from "../db";
import { AppError, notFound } from "../errors";
import { canWrite, type ServiceContext } from "../context";
import { writeAudit } from "../audit";
import { budgetInputSchema, type BudgetInput } from "../validation/tahap4";
import { totalsByCategory } from "./reports";

export const BUDGET_WARN_RATIO = 0.8;

export type BudgetLevel = "ok" | "warn" | "over";

export interface BudgetStatus {
  budgetId: string;
  periodId: string | null;
  categoryId: string;
  name: string;
  icon: string | null;
  /** Batas bulan ini (khusus bulan ini jika ada, selain itu default). */
  amount: number;
  defaultAmount: number;
  hasMonthOverride: boolean;
  spent: number;
  remaining: number;
  ratio: number;
  level: BudgetLevel;
}

function assertWrite(ctx: ServiceContext) {
  if (!canWrite(ctx)) throw new AppError("Anda tidak punya akses mengubah data.", "forbidden");
}

export function monthKeyOf(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function levelFor(ratio: number): BudgetLevel {
  if (ratio >= 1) return "over";
  if (ratio >= BUDGET_WARN_RATIO) return "warn";
  return "ok";
}

/** Status semua anggaran aktif untuk satu bulan (default: bulan ini, WIB). */
export async function listBudgetStatus(ctx: ServiceContext, month?: { year: number; month: number }) {
  const m = month ?? currentMonthRange();
  const key = monthKeyOf(m.year, m.month);
  const { start, end } = monthRange(m.year, m.month);
  const [budgets, totals, categories] = await Promise.all([
    prisma.budget.findMany({
      where: { householdId: ctx.householdId, isActive: true },
      include: { category: { select: { id: true, name: true, icon: true, sortOrder: true } }, periods: { where: { month: key } } },
    }),
    totalsByCategory(ctx, "expense", start, end),
    prisma.category.findMany({ where: { householdId: ctx.householdId, kind: "expense" }, select: { id: true, parentId: true } }),
  ]);
  const spentByCategory = new Map(totals.map((t) => [t.categoryId, t.total]));
  // Anggaran kategori induk ikut menghitung sub-kategorinya.
  const childrenOf = (id: string) => categories.filter((c) => c.parentId === id).map((c) => c.id);

  const items: BudgetStatus[] = budgets
    .map((b) => {
      const period = b.periods[0] ?? null;
      const amount = Number(period?.amount ?? b.amount);
      const spent = [b.categoryId, ...childrenOf(b.categoryId)].reduce((a, id) => a + (spentByCategory.get(id) ?? 0), 0);
      const ratio = amount > 0 ? spent / amount : 0;
      return {
        budgetId: b.id,
        periodId: period?.id ?? null,
        categoryId: b.categoryId,
        name: b.category.name,
        icon: b.category.icon,
        amount,
        defaultAmount: Number(b.amount),
        hasMonthOverride: period ? Number(period.amount) !== Number(b.amount) : false,
        spent,
        remaining: amount - spent,
        ratio,
        level: levelFor(ratio),
      };
    })
    .sort((a, b) => b.ratio - a.ratio);

  const total = items.reduce((a, i) => a + i.amount, 0);
  const spent = items.reduce((a, i) => a + i.spent, 0);
  const now = new Date();
  const isCurrent = jakartaParts(now).year === m.year && jakartaParts(now).month === m.month;
  const daysLeft = isCurrent ? Math.max(1, Math.round((end.getTime() - now.getTime()) / 86400000)) : 0;
  return {
    month: { ...m, key },
    items,
    total,
    spent,
    remaining: total - spent,
    ratio: total > 0 ? spent / total : 0,
    isCurrent,
    /** Sisa anggaran per hari sampai akhir bulan (hanya bulan berjalan). */
    dailyAllowance: isCurrent && total - spent > 0 ? (total - spent) / daysLeft : 0,
  };
}

/** Buat atau ubah anggaran sebuah kategori pengeluaran. */
export async function setBudget(ctx: ServiceContext, raw: BudgetInput) {
  assertWrite(ctx);
  const input = budgetInputSchema.parse(raw);
  const category = await prisma.category.findFirst({ where: { id: input.categoryId, householdId: ctx.householdId } });
  if (!category) throw notFound("Kategori");
  if (category.kind !== "expense") throw new AppError("Anggaran hanya untuk kategori pengeluaran.", "validation", { categoryId: "Pilih kategori pengeluaran" });
  const month = input.month && parseMonthKey(input.month) ? input.month : monthKeyOf(currentMonthRange().year, currentMonthRange().month);

  return prisma.$transaction(async (tx) => {
    const before = await tx.budget.findUnique({ where: { householdId_categoryId: { householdId: ctx.householdId, categoryId: input.categoryId } } });
    const budget = before
      ? await tx.budget.update({
          where: { id: before.id },
          data: { isActive: true, ...(input.scope === "default" ? { amount: input.amount } : {}) },
        })
      : await tx.budget.create({ data: { householdId: ctx.householdId, categoryId: input.categoryId, amount: input.amount } });
    if (input.scope === "month") {
      await tx.budgetPeriod.upsert({
        where: { budgetId_month: { budgetId: budget.id, month } },
        create: { budgetId: budget.id, month, amount: input.amount },
        update: { amount: input.amount },
      });
    } else {
      // Batas default berubah: periode bulan ini ikut, kecuali sudah diatur khusus.
      const current = monthKeyOf(currentMonthRange().year, currentMonthRange().month);
      await tx.budgetPeriod.updateMany({ where: { budgetId: budget.id, month: current, amount: before?.amount ?? input.amount }, data: { amount: input.amount } });
    }
    await writeAudit(tx, ctx, { entityType: "Budget", entityId: budget.id, action: before ? "update" : "create", before, after: { ...budget, scope: input.scope, month } });
    return budget;
  });
}

export async function deleteBudget(ctx: ServiceContext, id: string) {
  assertWrite(ctx);
  return prisma.$transaction(async (tx) => {
    const before = await tx.budget.findFirst({ where: { id, householdId: ctx.householdId } });
    if (!before) throw notFound("Anggaran");
    const after = await tx.budget.update({ where: { id }, data: { isActive: false } });
    await writeAudit(tx, ctx, { entityType: "Budget", entityId: id, action: "delete", before, after });
  });
}

export interface BudgetAlert {
  status: BudgetStatus;
  threshold: 80 | 100;
  monthKey: string;
}

/**
 * Cari anggaran bulan berjalan yang baru melewati 80% / 100% dan tandai agar
 * peringatan yang sama tidak dikirim lagi. Hanya level tertinggi yang dilaporkan.
 */
export async function claimBudgetAlerts(ctx: ServiceContext, opts: { categoryId?: string | null } = {}): Promise<BudgetAlert[]> {
  const status = await listBudgetStatus(ctx);
  const alerts: BudgetAlert[] = [];
  // Jika kategori diberikan, cek hanya anggaran kategori itu (atau induknya).
  const onlyIds = opts.categoryId
    ? [opts.categoryId, (await prisma.category.findUnique({ where: { id: opts.categoryId }, select: { parentId: true } }))?.parentId].filter(Boolean)
    : null;
  for (const s of status.items) {
    if (s.level === "ok") continue;
    if (onlyIds && !onlyIds.includes(s.categoryId)) continue;
    const period = await prisma.budgetPeriod.upsert({
      where: { budgetId_month: { budgetId: s.budgetId, month: status.month.key } },
      create: { budgetId: s.budgetId, month: status.month.key, amount: s.amount },
      update: {},
    });
    const now = new Date();
    if (s.level === "over" && !period.notified100At) {
      // Klaim atomik: hanya satu proses yang berhasil menandai.
      const { count } = await prisma.budgetPeriod.updateMany({
        where: { id: period.id, notified100At: null },
        data: { notified100At: now, notified80At: period.notified80At ?? now },
      });
      if (count) alerts.push({ status: s, threshold: 100, monthKey: status.month.key });
    } else if (s.level === "warn" && !period.notified80At) {
      const { count } = await prisma.budgetPeriod.updateMany({ where: { id: period.id, notified80At: null }, data: { notified80At: now } });
      if (count) alerts.push({ status: s, threshold: 80, monthKey: status.month.key });
    }
  }
  return alerts;
}
