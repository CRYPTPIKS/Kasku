import { csvNumber, toCsv } from "@/lib/csv";
import { formatDateTime, toDateInput } from "@/lib/dates";
import type { ServiceContext } from "../context";
import { TRANSACTION_TYPE_LABELS } from "../ledger";
import { listTransactionsForExport } from "./transactions";
import type { TransactionFilter } from "../validation/transaction";
import type { CashFlowRow } from "./reports";

export async function exportTransactionsCsv(ctx: ServiceContext, filter: TransactionFilter) {
  const rows = await listTransactionsForExport(ctx, filter);
  const out: (string | number | null)[][] = [];
  for (const t of rows) {
    const base = [
      toDateInput(t.occurredAt),
      formatDateTime(t.occurredAt),
      TRANSACTION_TYPE_LABELS[t.type],
      t.status === "draft" ? "Draf" : "Terkonfirmasi",
      t.description,
      t.merchant,
      t.fromAccount?.name ?? null,
      t.toAccount?.name ?? null,
      t.tags.map((x) => x.tag.name).join(", "),
      t.note,
      t.id,
    ];
    if (t.splits.length) {
      for (const s of t.splits) out.push([...base.slice(0, 6), s.category?.name ?? "", csvNumber(s.amount), ...base.slice(6)]);
    } else {
      out.push([...base.slice(0, 6), t.category?.name ?? "", csvNumber(t.amount), ...base.slice(6)]);
    }
  }
  return toCsv(
    ["Tanggal", "Waktu (WIB)", "Jenis", "Status", "Keterangan", "Merchant", "Kategori", "Nominal", "Dari rekening", "Ke rekening", "Tag", "Catatan", "ID"],
    out,
  );
}

export function cashFlowCsv(rows: CashFlowRow[]) {
  return toCsv(
    ["Bulan", "Pemasukan", "Pengeluaran", "Selisih"],
    rows.map((r) => [r.month, csvNumber(r.income), csvNumber(r.expense), csvNumber(r.net)]),
  );
}
