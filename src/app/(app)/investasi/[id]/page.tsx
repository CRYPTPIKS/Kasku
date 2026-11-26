import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, toDateInput } from "@/lib/dates";
import { formatNumber, formatPercent } from "@/lib/money";
import { requireUser } from "@/server/auth/current";
import { canWrite } from "@/server/context";
import { AppError } from "@/server/errors";
import { listAccounts } from "@/server/services/accounts";
import { ASSET_CLASS_LABELS, fmtUnits, getAssetDetail, INVESTMENT_KIND_LABELS } from "@/server/services/investments";
import { TradeForm } from "@/components/finance/trade-form";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Money } from "@/components/ui/money";
import { Stat } from "@/components/ui/stat";
import { archiveAssetAction, deleteTradeAction, recordTradeAction, setPriceAction } from "../actions";

export const metadata: Metadata = { title: "Detail aset" };

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireUser();
  const { asset, summary: s } = await getAssetDetail(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const accounts = await listAccounts(ctx);
  const writable = canWrite(ctx);
  const nominalMode = asset.assetClass === "deposit";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={asset.symbol ? `${asset.symbol} · ${asset.name}` : asset.name}
        description={`${ASSET_CLASS_LABELS[asset.assetClass]}${asset.isArchived ? " · diarsipkan" : ""}`}
        actions={
          <Link href="/investasi" className="text-sm font-medium text-brand-700">
            ← Portofolio
          </Link>
        }
      />

      <Card className="p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat large={false} label="Dimiliki" value={`${fmtUnits(s.units)} ${asset.unitLabel}`} hint={asset.unitsPerLot && s.units ? `${fmtUnits(s.units / asset.unitsPerLot)} lot` : undefined} />
          <Stat large={false} label="Nilai saat ini" value={<Money value={s.marketValue} />} />
          <Stat large={false} label="Modal" value={<Money value={s.costBasis} />} hint={s.units ? `rata-rata ${formatNumber(s.avgCost)}/${asset.unitLabel}` : undefined} />
          <Stat
            label="Belum terealisasi"
            value={<Money value={s.unrealized} signed tone={s.unrealized >= 0 ? "income" : "expense"} />}
            hint={s.costBasis ? formatPercent(s.unrealizedPct) : undefined}
          />
          <Stat large={false} label="Terealisasi" value={<Money value={s.realized} signed tone={s.realized >= 0 ? "income" : "expense"} />} />
          <Stat large={false} label="Dividen/bunga" value={<Money value={s.income} tone="income" />} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {s.price !== null
            ? `Harga ${formatNumber(s.price)}/${asset.unitLabel} (${s.priceSource === "manual" ? "diperbarui manual" : "dari transaksi terakhir"}, ${formatDate(s.priceAsOf!)})`
            : "Belum ada harga."}
        </p>
      </Card>

      {writable && !asset.isArchived && (
        <Card className="p-4 sm:p-5">
          <h2 className="mb-3 font-semibold">Catat transaksi</h2>
          <TradeForm
            action={recordTradeAction.bind(null, asset.id)}
            accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
            unitLabel={asset.unitLabel}
            unitsPerLot={asset.unitsPerLot}
            today={toDateInput(new Date())}
            nominalMode={nominalMode}
          />
        </Card>
      )}

      {writable && !nominalMode && (
        <Card className="p-4 sm:p-5">
          <h2 className="mb-1 font-semibold">Perbarui harga</h2>
          <p className="mb-3 text-xs text-slate-500">Harga pasar terbaru per {asset.unitLabel}, untuk menghitung nilai portofolio.</p>
          <ActionForm action={setPriceAction.bind(null, asset.id)} submitLabel="Simpan harga" submitSize="sm" submitVariant="secondary" resetOnSuccess className="space-y-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input name="price" className="input" inputMode="decimal" placeholder={`Harga per ${asset.unitLabel}`} aria-label="Harga" required />
              <input name="asOf" type="date" className="input" defaultValue={toDateInput(new Date())} aria-label="Tanggal harga" />
            </div>
          </ActionForm>
        </Card>
      )}

      <Card>
        <CardHeader title="Riwayat" />
        {asset.transactions.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-500">Belum ada transaksi.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {asset.transactions.map((t) => {
              const acc = t.transaction?.fromAccount ?? t.transaction?.toAccount;
              const trade = t.kind === "buy" || t.kind === "sell";
              return (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      <Badge tone={t.kind === "buy" ? "blue" : t.kind === "sell" ? "amber" : "green"}>{INVESTMENT_KIND_LABELS[t.kind]}</Badge>{" "}
                      {trade && !nominalMode && (
                        <span className="text-slate-600">
                          {fmtUnits(Number(t.units))} {asset.unitLabel} @ {formatNumber(Number(t.pricePerUnit))}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDate(t.occurredAt)}
                      {acc && ` · ${acc.name}`}
                      {Number(t.fee) > 0 && ` · biaya ${formatNumber(Number(t.fee))}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Money value={Number(t.totalAmount)} className="font-medium" />
                    {writable && (
                      <ConfirmButton
                        action={deleteTradeAction.bind(null, t.id)}
                        label="Hapus"
                        title="Hapus transaksi investasi ini?"
                        description="Transaksi kas terkait (jika ada) ikut dihapus."
                        confirmLabel="Hapus"
                        variant="ghost"
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {writable && (
        <div>
          <ConfirmButton
            action={archiveAssetAction.bind(null, asset.id, !asset.isArchived)}
            label={asset.isArchived ? "Aktifkan lagi" : "Arsipkan aset"}
            title={asset.isArchived ? "Aktifkan aset ini lagi?" : "Arsipkan aset ini?"}
            description={asset.isArchived ? undefined : "Hanya bisa jika unit sudah habis dijual. Riwayat tetap tersimpan."}
            confirmLabel={asset.isArchived ? "Aktifkan" : "Arsipkan"}
            variant="secondary"
          />
        </div>
      )}
    </div>
  );
}
