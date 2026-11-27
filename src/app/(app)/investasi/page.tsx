import type { Metadata } from "next";
import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { formatPercent } from "@/lib/money";
import { requireUser } from "@/server/auth/current";
import { canWrite } from "@/server/context";
import { ASSET_CLASS_LABELS, fmtUnits, getPortfolio } from "@/server/services/investments";
import { BarList } from "@/components/ui/bar-list";
import { LinkButton } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { Stat } from "@/components/ui/stat";

export const metadata: Metadata = { title: "Investasi" };

const CLASS_COLORS: Record<string, string> = {
  stock: "#3b82f6",
  mutual_fund: "#8b5cf6",
  gold: "#eab308",
  crypto: "#f97316",
  deposit: "#10b981",
  bond: "#06b6d4",
  other: "#64748b",
};

export default async function InvestmentsPage({ searchParams }: { searchParams: Promise<{ arsip?: string }> }) {
  const { ctx } = await requireUser();
  const sp = await searchParams;
  const p = await getPortfolio(ctx, { includeArchived: sp.arsip === "1" });
  const held = p.items.filter((i) => i.units > 0 || sp.arsip === "1" || i.realized !== 0 || i.income !== 0);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Investasi"
        description="Nilai portofolio memakai harga terakhir yang kamu catat"
        actions={canWrite(ctx) ? <LinkButton href="/investasi/baru">+ Aset</LinkButton> : undefined}
      />

      <Card className="p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Nilai saat ini" value={<Money value={p.totals.marketValue} />} />
          <Stat label="Modal" value={<Money value={p.totals.costBasis} />} />
          <Stat
            label="Untung/rugi belum terealisasi"
            value={<Money value={p.totals.unrealized} signed tone={p.totals.unrealized >= 0 ? "income" : "expense"} />}
            hint={p.totals.costBasis ? formatPercent(p.totals.unrealized / p.totals.costBasis) : undefined}
          />
          <Stat label="Terealisasi + dividen" value={<Money value={p.totals.realized + p.totals.income} signed tone={p.totals.realized + p.totals.income >= 0 ? "income" : "expense"} />} />
        </div>
      </Card>

      {p.allocation.length > 0 && (
        <Card>
          <CardHeader title="Alokasi" />
          <BarList items={p.allocation.map((a) => ({ label: a.label, value: a.value, color: CLASS_COLORS[a.assetClass] }))} />
        </Card>
      )}

      <Card>
        <CardHeader
          title="Aset"
          action={
            <Link href={sp.arsip === "1" ? "/investasi" : "/investasi?arsip=1"} className="text-sm font-medium text-brand-700">
              {sp.arsip === "1" ? "Sembunyikan arsip" : "Tampilkan semua"}
            </Link>
          }
        />
        {held.length === 0 && p.items.length === 0 ? (
          <EmptyState icon="📈" title="Belum ada aset" description="Tambahkan aset (saham, emas, reksa dana, kripto, deposito), lalu catat pembeliannya. Bisa juga lewat bot: beli BBCA 2 lot @9500 dari BCA" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {(held.length ? held : p.items).map((i) => (
              <li key={i.id}>
                <Link href={`/investasi/${i.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {i.symbol ? `${i.symbol} · ` : ""}
                      {i.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {ASSET_CLASS_LABELS[i.assetClass]} ·{" "}
                      {i.valuationMode === "value"
                        ? i.priceAsOf
                          ? `nilai per ${formatDate(i.priceAsOf)}`
                          : "nilai belum diperbarui"
                        : `${fmtUnits(i.units)} ${i.unitLabel}`}
                      {i.isArchived && " · diarsipkan"}
                    </p>
                  </div>
                  <div className="text-right">
                    <Money value={i.marketValue} className="font-semibold" />
                    {i.units > 0 && (
                      <p className="text-xs">
                        <Money value={i.unrealized} signed tone={i.unrealized >= 0 ? "income" : "expense"} /> ({formatPercent(i.unrealizedPct)})
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
