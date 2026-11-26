import Link from "next/link";
import { formatDate, formatMonth } from "@/lib/dates";
import { requireUser } from "@/server/auth/current";
import { getDashboard } from "@/server/services/dashboard";
import { TransactionRow } from "@/components/transactions/transaction-row";
import { BarList } from "@/components/ui/bar-list";
import { LinkButton } from "@/components/ui/button";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { ProgressBar } from "@/components/ui/progress";
import { formatRupiah } from "@/lib/money";

export default async function DashboardPage() {
  const { user, ctx } = await requireUser();
  const d = await getDashboard(ctx);
  const monthLabel = formatMonth(d.month.year, d.month.month);
  const noAccounts = d.accounts.length === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">Halo, {user.name} 👋</p>
          <h1 className="text-2xl font-bold tracking-tight">Ringkasan {monthLabel}</h1>
        </div>
        <LinkButton href="/transaksi/baru" className="hidden sm:inline-flex">
          + Catat transaksi
        </LinkButton>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total saldo" value={d.balances.net} hint={`${d.accounts.length} rekening`} href="/rekening" big />
        <StatCard label="Pemasukan bulan ini" value={d.totals.income} tone="income" prev={d.prevTotals.income} />
        <StatCard label="Pengeluaran bulan ini" value={d.totals.expense} tone="expense" prev={d.prevTotals.expense} />
        <StatCard wide label="Selisih kas" value={d.totals.net} hint={d.totals.net >= 0 ? "Surplus" : "Defisit"} />
      </div>

      {noAccounts && (
        <Card>
          <EmptyState
            icon="💳"
            title="Belum ada rekening"
            description="Tambahkan rekening pertama (misalnya Tunai atau rekening bank) agar transaksi bisa dicatat."
            action={<LinkButton href="/rekening/baru">Tambah rekening</LinkButton>}
          />
        </Card>
      )}

      {(d.receipts.processing > 0 || d.receipts.failed > 0) && (
        <Link href="/transaksi/struk" className="block">
          <Card className={`p-4 text-sm ${d.receipts.failed > 0 ? "border-red-200 bg-red-50/60 text-red-900" : "border-blue-200 bg-blue-50/60 text-blue-900"}`}>
            🧾{" "}
            {[
              d.receipts.processing > 0 ? `${d.receipts.processing} struk sedang dibaca` : "",
              d.receipts.failed > 0 ? `${d.receipts.failed} struk gagal dibaca dan perlu diisi manual` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
            <span className="ml-1 font-medium">→</span>
          </Card>
        </Link>
      )}

      {d.drafts.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader
            title={`Perlu dikonfirmasi (${d.drafts.length})`}
            subtitle="Transaksi draf belum memengaruhi saldo"
            action={
              <Link href="/transaksi?status=draft" className="text-sm font-medium text-brand-700">
                Lihat semua
              </Link>
            }
          />
          <ul className="divide-y divide-slate-100">
            {d.drafts.map((t) => (
              <li key={t.id}>
                <Link href={`/transaksi/${t.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-amber-50/50 sm:px-5">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.description || t.merchant || t.category?.name || "Transaksi draf"}</p>
                    <p className="text-xs text-slate-500">{formatDate(t.occurredAt)}</p>
                  </div>
                  <Money value={Number(t.amount)} className="font-semibold" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Transaksi terbaru"
            action={
              <Link href="/transaksi" className="text-sm font-medium text-brand-700">
                Semua
              </Link>
            }
          />
          {d.recent.length === 0 ? (
            <EmptyState
              icon="🧾"
              title="Belum ada transaksi"
              description="Catat pemasukan atau pengeluaran pertamamu. Nanti kamu juga bisa mencatat lewat bot Telegram."
              action={<LinkButton href="/transaksi/baru">Catat transaksi</LinkButton>}
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {d.recent.map((t) => (
                <TransactionRow key={t.id} t={t} />
              ))}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Pengeluaran per kategori" subtitle={monthLabel} />
          <BarList
            items={d.byCategory.slice(0, 8).map((c) => ({ label: c.name, value: c.total, icon: c.icon, color: c.color }))}
            emptyText="Belum ada pengeluaran bulan ini."
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <Card>
          <CardHeader
            title="Anggaran"
            subtitle={d.budgets.items.length ? `${formatRupiah(d.budgets.spent)} dari ${formatRupiah(d.budgets.total)}` : undefined}
            action={
              <Link href="/anggaran" className="text-sm font-medium text-brand-700">
                Atur
              </Link>
            }
          />
          {d.budgets.items.length === 0 ? (
            <EmptyState icon="🎯" title="Belum ada anggaran" description="Pasang batas belanja per kategori, dapat peringatan di 80% dan 100%." />
          ) : (
            <ul className="space-y-3 px-4 py-4 sm:px-5">
              {d.budgets.items.slice(0, 5).map((b) => (
                <li key={b.budgetId}>
                  <div className="mb-1 flex justify-between gap-2 text-sm">
                    <span className="truncate">
                      {b.icon && <span aria-hidden>{b.icon} </span>}
                      {b.name}
                    </span>
                    <span className={`tabular shrink-0 ${b.level === "over" ? "text-red-600" : b.level === "warn" ? "text-amber-700" : "text-slate-600"}`}>
                      {Math.round(b.ratio * 100)}%
                    </span>
                  </div>
                  <ProgressBar ratio={b.ratio} tone={b.level} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Jatuh tempo"
            subtitle="14 hari ke depan"
            action={
              <Link href="/hutang" className="text-sm font-medium text-brand-700">
                Semua
              </Link>
            }
          />
          {d.dues.length === 0 ? (
            <EmptyState icon="🤝" title="Tidak ada yang jatuh tempo" description="Cicilan hutang/piutang yang mendekati jatuh tempo tampil di sini." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.dues.map((x) => (
                <li key={`${x.debt.id}-${x.sequence}`}>
                  <Link href={`/hutang/${x.debt.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {x.debt.direction === "payable" ? "Bayar ke " : "Tagih "}
                        {x.debt.counterparty}
                        {x.sequence ? ` (ke-${x.sequence})` : ""}
                      </p>
                      <p className={`text-xs ${x.overdue ? "font-medium text-red-600" : "text-slate-500"}`}>
                        {x.overdue ? "Terlambat · " : ""}
                        {formatDate(x.dueDate)}
                      </p>
                    </div>
                    <Money value={x.amount} className="font-semibold" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Kekayaan bersih"
            action={
              <Link href="/laporan" className="text-sm font-medium text-brand-700">
                Rincian
              </Link>
            }
          />
          <div className="px-4 py-4 sm:px-5">
            <p className="text-2xl font-bold">
              <Money value={d.worth.net} />
            </p>
            <dl className="mt-3 space-y-1 text-sm">
              <Row label="Rekening" value={d.worth.cash} href="/rekening" />
              <Row label="Investasi" value={d.worth.investments} href="/investasi" />
              <Row label="Piutang" value={d.worth.receivables} href="/hutang?tab=piutang" />
              <Row label="Kartu kredit" value={-d.worth.creditCards} href="/rekening" />
              <Row label="Hutang" value={-d.worth.payables} href="/hutang" />
            </dl>
          </div>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone,
  prev,
  href,
  big,
  wide,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "income" | "expense";
  prev?: number;
  href?: string;
  big?: boolean;
  wide?: boolean;
}) {
  const diff = prev !== undefined && prev > 0 ? (value - prev) / prev : null;
  const body = (
    <div className={`card h-full p-4 ${wide ? "col-span-2 lg:col-span-1" : ""} ${big ? "col-span-2 bg-gradient-to-br from-brand-600 to-brand-700 text-white lg:col-span-1" : ""}`}>
      <p className={`text-xs font-medium ${big ? "text-brand-100" : "text-slate-500"}`}>{label}</p>
      <p className={`mt-1 text-lg font-bold sm:text-xl ${big ? "" : tone === "income" ? "text-emerald-600" : tone === "expense" ? "text-red-600" : ""}`}>
        <Money value={value} tone={big || tone ? "plain" : "auto"} />
      </p>
      {hint && <p className={`mt-0.5 text-xs ${big ? "text-brand-100" : "text-slate-500"}`}>{hint}</p>}
      {diff !== null && (
        <p className="mt-0.5 text-xs text-slate-500">
          {diff >= 0 ? "▲" : "▼"} {Math.abs(Math.round(diff * 100))}% dari bulan lalu
        </p>
      )}
    </div>
  );
  return href ? (
    <Link href={href} className={big ? "col-span-2 lg:col-span-1" : ""}>
      {body}
    </Link>
  ) : (
    body
  );
}

function Row({ label, value, href }: { label: string; value: number; href: string }) {
  if (value === 0) return null;
  return (
    <div className="flex justify-between gap-2">
      <dt>
        <Link href={href} className="text-slate-600 hover:underline">
          {label}
        </Link>
      </dt>
      <dd>
        <Money value={value} />
      </dd>
    </div>
  );
}
