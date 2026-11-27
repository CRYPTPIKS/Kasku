import type { Metadata } from "next";
import { currentMonthRange, formatMonth, monthRange, previousMonth } from "@/lib/dates";
import { formatRupiahCompact } from "@/lib/money";
import { requireUser } from "@/server/auth/current";
import { resolveReportRange } from "@/server/services/report-range";
import { monthlyCashFlow, periodTotals, totalsByCategory } from "@/server/services/reports";
import { listBudgetStatus } from "@/server/services/budgets";
import { netWorth } from "@/server/services/networth";
import { ProgressBar } from "@/components/ui/progress";
import { BarList } from "@/components/ui/bar-list";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Money } from "@/components/ui/money";

export const metadata: Metadata = { title: "Laporan" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { ctx } = await requireUser();
  const sp = await searchParams;
  const range = resolveReportRange(sp);
  const cur = currentMonthRange();
  const prev = previousMonth(cur.year, cur.month);
  const prevRange = monthRange(prev.year, prev.month);

  const [flow, expenseCats, incomeCats, curTotals, prevTotals, worth, budgets] = await Promise.all([
    monthlyCashFlow(ctx, range.start, range.end),
    totalsByCategory(ctx, "expense", range.start, range.end),
    totalsByCategory(ctx, "income", range.start, range.end),
    periodTotals(ctx, cur.start, cur.end),
    periodTotals(ctx, prevRange.start, prevRange.end),
    netWorth(ctx),
    listBudgetStatus(ctx),
  ]);
  const totals = flow.reduce((a, r) => ({ income: a.income + r.income, expense: a.expense + r.expense }), { income: 0, expense: 0 });
  const max = Math.max(1, ...flow.map((r) => Math.max(r.income, r.expense)));
  const q = `from=${range.fromInput}&to=${range.toInput}`;
  const monthName = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return formatMonth(y!, m!);
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Laporan" description="Arus kas, kategori, anggaran, dan kekayaan bersih" />

      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <div>
            <label className="label" htmlFor="from">
              Dari
            </label>
            <input id="from" name="from" type="date" className="input" defaultValue={range.fromInput} />
          </div>
          <div>
            <label className="label" htmlFor="to">
              Sampai
            </label>
            <input id="to" name="to" type="date" className="input" defaultValue={range.toInput} />
          </div>
          <button className="rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-white">Terapkan</button>
          <div className="ml-auto flex flex-wrap gap-2 text-sm">
            <a className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium hover:bg-slate-50" href={`/api/export/arus-kas?${q}`}>
              CSV arus kas
            </a>
            <a className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium hover:bg-slate-50" href={`/api/export/kategori?${q}`}>
              CSV per kategori
            </a>
            <a className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium hover:bg-slate-50" href={`/api/export/transaksi?${q}&status=confirmed`}>
              CSV transaksi
            </a>
          </div>
        </form>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-xs text-slate-500">Pemasukan</p>
          <p className="font-bold text-emerald-600">
            <Money value={totals.income} tone="plain" />
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500">Pengeluaran</p>
          <p className="font-bold text-red-600">
            <Money value={totals.expense} tone="plain" />
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500">Selisih</p>
          <p className="font-bold">
            <Money value={totals.income - totals.expense} />
          </p>
        </Card>
      </div>

      <Card>
        <CardHeader title="Arus kas bulanan" subtitle="Pribadi saja. Transfer antar-rekening tidak dihitung; usaha dipisah di halaman Usaha." />
        {totals.income === 0 && totals.expense === 0 ? (
          <EmptyState icon="📊" title="Belum ada data di rentang ini" description="Coba pilih rentang tanggal lain." />
        ) : (
          <>
            <div className="flex h-48 items-end gap-2 overflow-x-auto px-4 pt-6 sm:px-5" role="img" aria-label="Grafik arus kas bulanan">
              {flow.map((r) => (
                <div key={r.month} className="flex min-w-10 flex-1 flex-col items-center gap-1">
                  <div className="flex h-36 w-full items-end justify-center gap-0.5">
                    <div className="w-1/2 max-w-5 rounded-t bg-emerald-500" style={{ height: `${(r.income / max) * 100}%` }} title={`Pemasukan ${formatRupiahCompact(r.income)}`} />
                    <div className="w-1/2 max-w-5 rounded-t bg-red-400" style={{ height: `${(r.expense / max) * 100}%` }} title={`Pengeluaran ${formatRupiahCompact(r.expense)}`} />
                  </div>
                  <span className="text-[10px] text-slate-500">{r.month.slice(5)}/{r.month.slice(2, 4)}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-4 px-5 pb-2 pt-3 text-xs text-slate-600">
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Pemasukan
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-red-400" /> Pengeluaran
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium sm:px-5">Bulan</th>
                    <th className="px-4 py-2 text-right font-medium">Pemasukan</th>
                    <th className="px-4 py-2 text-right font-medium">Pengeluaran</th>
                    <th className="px-4 py-2 text-right font-medium sm:px-5">Selisih</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {flow.map((r) => (
                    <tr key={r.month}>
                      <td className="px-4 py-2 sm:px-5">{monthName(r.month)}</td>
                      <td className="px-4 py-2 text-right text-emerald-700">
                        <Money value={r.income} tone="plain" />
                      </td>
                      <td className="px-4 py-2 text-right text-red-700">
                        <Money value={r.expense} tone="plain" />
                      </td>
                      <td className="px-4 py-2 text-right font-medium sm:px-5">
                        <Money value={r.net} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card>
        <CardHeader title="Bulan ini vs bulan lalu" subtitle={`${formatMonth(cur.year, cur.month)} dibanding ${formatMonth(prev.year, prev.month)}`} />
        <div className="grid grid-cols-3 gap-3 p-4 text-sm sm:p-5">
          {(
            [
              ["Pemasukan", curTotals.income, prevTotals.income, true],
              ["Pengeluaran", curTotals.expense, prevTotals.expense, false],
              ["Selisih", curTotals.net, prevTotals.net, true],
            ] as const
          ).map(([label, now, before, upIsGood]) => {
            const diff = now - before;
            const good = upIsGood ? diff >= 0 : diff <= 0;
            return (
              <div key={label}>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="font-semibold">
                  <Money value={now} tone="plain" />
                </p>
                <p className={`text-xs ${diff === 0 ? "text-slate-500" : good ? "text-emerald-600" : "text-red-600"}`}>
                  {diff === 0 ? "Sama" : `${diff > 0 ? "▲" : "▼"} ${formatRupiahCompact(Math.abs(diff))}`}
                </p>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Kekayaan bersih"
            subtitle="Posisi saat ini"
            action={
              <span className="flex gap-3 text-sm">
                <a href="/api/export/investasi" className="font-medium text-brand-700">
                  CSV investasi
                </a>
                <a href="/api/export/hutang" className="font-medium text-brand-700">
                  CSV hutang
                </a>
              </span>
            }
          />
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {(
                [
                  ["Saldo rekening", worth.cash],
                  ["Investasi (nilai pasar)", worth.investments],
                  ["Piutang", worth.receivables],
                  ["Tagihan kartu kredit", -worth.creditCards],
                  ["Hutang", -worth.payables],
                ] as const
              ).map(([label, v]) => (
                <tr key={label}>
                  <td className="px-4 py-2 text-slate-600 sm:px-5">{label}</td>
                  <td className="px-4 py-2 text-right sm:px-5">
                    <Money value={v} />
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td className="px-4 py-2 sm:px-5">Kekayaan bersih</td>
                <td className="px-4 py-2 text-right sm:px-5">
                  <Money value={worth.net} />
                </td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card>
          <CardHeader title="Anggaran vs realisasi" subtitle={formatMonth(cur.year, cur.month)} />
          {budgets.items.length === 0 ? (
            <EmptyState icon="🎯" title="Belum ada anggaran" description="Atur di menu Anggaran." />
          ) : (
            <ul className="space-y-3 px-4 py-4 sm:px-5">
              {budgets.items.map((b) => (
                <li key={b.budgetId}>
                  <div className="mb-1 flex justify-between gap-2 text-sm">
                    <span className="truncate">{b.name}</span>
                    <span className="tabular shrink-0 text-slate-600">
                      <Money value={b.spent} tone="plain" /> / <Money value={b.amount} tone="plain" />
                    </span>
                  </div>
                  <ProgressBar ratio={b.ratio} tone={b.level} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Pengeluaran per kategori" />
          <BarList items={expenseCats.map((c) => ({ label: c.name, value: c.total, icon: c.icon, color: c.color }))} emptyText="Belum ada pengeluaran." />
        </Card>
        <Card>
          <CardHeader title="Pemasukan per kategori" />
          <BarList items={incomeCats.map((c) => ({ label: c.name, value: c.total, icon: c.icon, color: c.color }))} emptyText="Belum ada pemasukan." />
        </Card>
      </div>
    </div>
  );
}
