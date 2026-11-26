import type { ServiceContext } from "../context";
import { listAccounts, summarizeBalances } from "./accounts";
import { debtSummary } from "./debts";
import { getPortfolio } from "./investments";

/**
 * Kekayaan bersih = saldo rekening positif + nilai investasi + sisa piutang
 *                   − saldo negatif (kartu kredit) − sisa hutang.
 */
export async function netWorth(ctx: ServiceContext) {
  const [accounts, portfolio, debts] = await Promise.all([listAccounts(ctx), getPortfolio(ctx), debtSummary(ctx)]);
  const balances = summarizeBalances(accounts);
  const assets = balances.assets + portfolio.totals.marketValue + debts.receivable;
  const liabilities = balances.liabilities + debts.payable;
  return {
    cash: balances.assets,
    investments: portfolio.totals.marketValue,
    receivables: debts.receivable,
    creditCards: balances.liabilities,
    payables: debts.payable,
    assets,
    liabilities,
    net: assets - liabilities,
  };
}
