import { formatRupiah, formatPercent } from "@/lib/money";

/** Grafik batang horizontal sederhana (tanpa library) yang ramah ponsel. */
export function BarList({
  items,
  emptyText = "Belum ada data",
}: {
  items: { label: string; value: number; icon?: string | null; color?: string | null }[];
  emptyText?: string;
}) {
  const total = items.reduce((a, i) => a + i.value, 0);
  const max = Math.max(...items.map((i) => i.value), 1);
  if (items.length === 0) return <p className="px-4 py-8 text-center text-sm text-slate-500">{emptyText}</p>;
  return (
    <ul className="space-y-3 px-4 py-4 sm:px-5">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-slate-700">
              {item.icon && <span aria-hidden>{item.icon} </span>}
              {item.label}
            </span>
            <span className="tabular shrink-0 font-medium text-slate-900">
              {formatRupiah(item.value)} <span className="text-xs font-normal text-slate-500">({formatPercent(total ? item.value / total : 0)})</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full"
              style={{ width: `${Math.max(2, (item.value / max) * 100)}%`, backgroundColor: item.color ?? "#10b981" }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
