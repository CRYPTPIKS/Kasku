import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { TRANSACTION_TYPE_LABELS } from "@/server/ledger";
import type { TransactionWithRelations } from "@/server/services/transactions";
import { Badge } from "../ui/card";
import { Money } from "../ui/money";

const INFLOW = new Set(["income", "investment_income", "investment_sell", "debt_payable"]);
const OUTFLOW = new Set(["expense", "investment_buy", "debt_receivable"]);

export function transactionTitle(t: TransactionWithRelations) {
  return t.description || t.merchant || t.category?.name || TRANSACTION_TYPE_LABELS[t.type];
}

export function accountLabel(t: TransactionWithRelations) {
  if (t.type === "transfer") return `${t.fromAccount?.name ?? "?"} → ${t.toAccount?.name ?? "?"}`;
  return t.fromAccount?.name ?? t.toAccount?.name ?? "Rekening belum dipilih";
}

export function TransactionRow({ t }: { t: TransactionWithRelations }) {
  const amount = Number(t.amount);
  const isIn = INFLOW.has(t.type) || (t.type === "debt_payment" && !!t.toAccountId) || (t.type === "adjustment" && !!t.toAccountId);
  const isOut = OUTFLOW.has(t.type) || (t.type === "debt_payment" && !!t.fromAccountId) || (t.type === "adjustment" && !!t.fromAccountId);
  const icon = t.splits.length ? "✂️" : t.category?.icon ?? (t.type === "transfer" ? "🔁" : "•");
  const categoryText = t.splits.length
    ? `Dibagi ${t.splits.length} kategori`
    : t.category?.name ?? (t.type === "transfer" ? "Transfer" : TRANSACTION_TYPE_LABELS[t.type]);

  return (
    <Link href={`/transaksi/${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium text-slate-900">{transactionTitle(t)}</p>
          {t.status === "draft" && <Badge tone="amber">Draf</Badge>}
          {t.deletedAt && <Badge tone="red">Dihapus</Badge>}
        </div>
        <p className="truncate text-xs text-slate-500">
          {categoryText} · {accountLabel(t)} · {formatDate(t.occurredAt)}
        </p>
      </div>
      <Money
        value={isOut ? -amount : amount}
        tone={isIn ? "income" : isOut ? "expense" : "plain"}
        signed={isIn}
        className="text-sm font-semibold"
      />
    </Link>
  );
}
