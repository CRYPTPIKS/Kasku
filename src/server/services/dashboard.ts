import { receiptStatusCounts } from "../receipts/service";
import { currentMonthRange, previousMonth, monthRange } from "@/lib/dates";
import { prisma } from "../db";
import type { ServiceContext } from "../context";
import { listAccounts, summarizeBalances } from "./accounts";
import { periodTotals, totalsByCategory } from "./reports";
import { listTransactions } from "./transactions";
import { listBudgetStatus } from "./budgets";
import { upcomingDebtDues } from "./debts";
import { netWorth } from "./networth";

export async function getDashboard(ctx: ServiceContext, now = new Date()) {
  const month = currentMonthRange(now);
  const prev = previousMonth(month.year, month.month);
  const prevRange = monthRange(prev.year, prev.month);

  const [accounts, totals, prevTotals, byCategory, recent, drafts, receipts, budgets, dues, worth] = await Promise.all([
    listAccounts(ctx),
    periodTotals(ctx, month.start, month.end),
    periodTotals(ctx, prevRange.start, prevRange.end),
    totalsByCategory(ctx, "expense", month.start, month.end),
    listTransactions(ctx, { status: "confirmed", pageSize: 8 }),
    prisma.transaction.findMany({
      where: { householdId: ctx.householdId, status: "draft", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { category: { select: { name: true, icon: true } } },
    }),
    receiptStatusCounts(ctx),
    listBudgetStatus(ctx),
    upcomingDebtDues(ctx, 14, now),
    netWorth(ctx),
  ]);

  return {
    month,
    accounts,
    balances: summarizeBalances(accounts),
    totals,
    prevTotals,
    byCategory,
    recent: recent.items,
    drafts,
    receipts,
    budgets,
    dues: dues.slice(0, 5),
    worth,
  };
}
