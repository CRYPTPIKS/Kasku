import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { ServiceContext } from "../context";

/** Tipe yang dihitung sebagai pemasukan/pengeluaran (transfer & hutang tidak). */
const INCOME_TYPES = ["income", "investment_income"] as const;
const EXPENSE_TYPES = ["expense"] as const;

export interface CashFlowRow {
  month: string; // YYYY-MM (WIB)
  income: number;
  expense: number;
  net: number;
}

/** Arus kas bulanan dalam rentang [from, to). Bulan dihitung di zona Asia/Jakarta. */
export async function monthlyCashFlow(ctx: ServiceContext, from: Date, to: Date): Promise<CashFlowRow[]> {
  const rows = await prisma.$queryRaw<{ month: string; income: Prisma.Decimal | null; expense: Prisma.Decimal | null }[]>`
    SELECT to_char(date_trunc('month', t."occurredAt" AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM') AS month,
           SUM(CASE WHEN t.type::text IN (${Prisma.join([...INCOME_TYPES])}) THEN t.amount ELSE 0 END) AS income,
           SUM(CASE WHEN t.type::text IN (${Prisma.join([...EXPENSE_TYPES])}) THEN t.amount ELSE 0 END) AS expense
    FROM "Transaction" t
    WHERE t."householdId" = ${ctx.householdId}
      AND t.status = 'confirmed'
      AND t."deletedAt" IS NULL
      AND t."occurredAt" >= ${from} AND t."occurredAt" < ${to}
    GROUP BY 1
    ORDER BY 1`;
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  // Isi bulan kosong agar grafik/laporan kontinu.
  const result: CashFlowRow[] = [];
  for (const month of monthsBetween(from, to)) {
    const r = byMonth.get(month);
    const income = Number(r?.income ?? 0);
    const expense = Number(r?.expense ?? 0);
    result.push({ month, income, expense, net: income - expense });
  }
  return result;
}

function monthsBetween(from: Date, to: Date): string[] {
  const shift = 7 * 3600 * 1000;
  const a = new Date(from.getTime() + shift);
  const b = new Date(to.getTime() + shift - 1);
  const out: string[] = [];
  let y = a.getUTCFullYear();
  let m = a.getUTCMonth();
  while (y < b.getUTCFullYear() || (y === b.getUTCFullYear() && m <= b.getUTCMonth())) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m += 1;
    if (m === 12) {
      m = 0;
      y += 1;
    }
    if (out.length > 600) break;
  }
  return out;
}

export interface CategoryTotal {
  categoryId: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  total: number;
  count: number;
}

/** Total per kategori; transaksi yang dibagi dihitung per bagiannya. */
export async function totalsByCategory(
  ctx: ServiceContext,
  kind: "income" | "expense",
  from: Date,
  to: Date,
): Promise<CategoryTotal[]> {
  const types = kind === "expense" ? [...EXPENSE_TYPES] : [...INCOME_TYPES];
  const rows = await prisma.$queryRaw<
    { categoryId: string | null; name: string | null; icon: string | null; color: string | null; total: Prisma.Decimal; count: bigint }[]
  >`
    WITH lines AS (
      SELECT COALESCE(s."categoryId", t."categoryId") AS "categoryId",
             COALESCE(s.amount, t.amount) AS amount,
             t.id AS tid
      FROM "Transaction" t
      LEFT JOIN "TransactionSplit" s ON s."transactionId" = t.id
      WHERE t."householdId" = ${ctx.householdId}
        AND t.status = 'confirmed'
        AND t."deletedAt" IS NULL
        AND t.type::text IN (${Prisma.join(types)})
        AND t."occurredAt" >= ${from} AND t."occurredAt" < ${to}
    )
    SELECT l."categoryId", c.name, c.icon, c.color, SUM(l.amount) AS total, COUNT(DISTINCT l.tid) AS count
    FROM lines l
    LEFT JOIN "Category" c ON c.id = l."categoryId"
    GROUP BY l."categoryId", c.name, c.icon, c.color
    ORDER BY total DESC`;
  return rows.map((r) => ({
    categoryId: r.categoryId,
    name: r.name ?? "Tanpa kategori",
    icon: r.icon,
    color: r.color,
    total: Number(r.total),
    count: Number(r.count),
  }));
}

/** Ringkasan pemasukan & pengeluaran untuk satu rentang. */
export async function periodTotals(ctx: ServiceContext, from: Date, to: Date) {
  const grouped = await prisma.transaction.groupBy({
    by: ["type"],
    where: {
      householdId: ctx.householdId,
      status: "confirmed",
      deletedAt: null,
      occurredAt: { gte: from, lt: to },
      type: { in: [...INCOME_TYPES, ...EXPENSE_TYPES] },
    },
    _sum: { amount: true },
  });
  let income = 0;
  let expense = 0;
  for (const g of grouped) {
    const v = Number(g._sum.amount ?? 0);
    if ((INCOME_TYPES as readonly string[]).includes(g.type)) income += v;
    else expense += v;
  }
  return { income, expense, net: income - expense };
}
