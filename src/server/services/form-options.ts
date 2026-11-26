import type { ServiceContext } from "../context";
import { listAccounts } from "./accounts";
import { listCategories } from "./categories";

/** Pilihan kategori & rekening untuk form transaksi. */
export async function transactionFormOptions(ctx: ServiceContext) {
  const [categories, accounts] = await Promise.all([listCategories(ctx), listAccounts(ctx)]);
  return {
    categories: categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, icon: c.icon })),
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, kindLabel: a.kindLabel })),
  };
}
