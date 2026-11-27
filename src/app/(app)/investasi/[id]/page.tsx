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
import { archiveAssetAction, deleteAssetAction, deletePriceAction, deleteTradeAction, recordTradeAction, setPriceAction } from "../actions";

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
  const valueMode = asset.valuationMode === "value";
  const cashLinked = asset.transactions.filter((t) => t.transaction).length;
  const nominalMode = valueMode || asset.assetClass === "deposit";
  const labels = valueMode ? { buy: "Setor", sell: "Tarik" } : { buy: "Beli", sell: "Jual" };
  const kindLabel = (k: keyof typeof INVESTMENT_KIND_LABELS) => (k === "buy" || k === "sell" ? labels[k] : INVESTMENT_KIND_LABELS[k]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={asset.symbol ? `${asset.symbol} · ${asset.name}` : asset.name}
        description={`${ASSET_CLASS_LABELS[asset.assetClass]}${valueMode ? " · nilai total" : ""}${asset.isArchived ? " · diarsipkan" : ""}`}
        actions={
          <Link href="/investasi" className="text-sm font-medium text-brand-700">
            ← Portofolio
          </Link>
        }
      />

      <Card className="p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {!valueMode && (
            <Stat large={false} label="Dimiliki" value={`${fmtUnits(s.units)} ${asset.unitLabel}`} hint={asset.unitsPerLot && s.units ? `${fmtUnits(s.units / asset.unitsPerLot)} lot` : undefined} />
          )}
          <Stat large={false} label="Nilai saat ini" value={<Money value={s.marketValue} />} />
          <Stat
            large={false}
            label={valueMode ? "Modal (setoran bersih)" : "Modal"}
            value={<Money value={s.costBasis} />}
            hint={!valueMode && s.units ? `rata-rata ${formatNumber(s.avgCost)}/${asset.unitLabel}` : undefined}
          />
          <Stat
            label="Belum terealisasi"
            value={<Money value={s.unrealized} signed tone={s.unrealized >= 0 ? "income" : "expense"} />}
            hint={s.costBasis ? formatPercent(s.unrealizedPct) : undefined}
          />
          <Stat large={false} label="Terealisasi" value={<Money value={s.realized} signed tone={s.realized >= 0 ? "income" : "expense"} />} />
          <Stat large={false} label="Dividen/bunga" value={<Money value={s.income} tone="income" />} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {valueMode
            ? s.priceAsOf
              ? `Nilai terakhir dicatat ${formatDate(s.priceAsOf)}, ditambah setoran/penarikan sesudahnya.`
              : "Nilai belum pernah diperbarui, jadi masih sama dengan total setoran."
            : s.price !== null
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
            tradeLabels={labels}
          />
        </Card>
      )}

      {writable && valueMode && (
        <Card className="p-4 sm:p-5">
          <h2 className="mb-1 font-semibold">Perbarui nilai</h2>
          <p className="mb-3 text-xs text-slate-500">Isi total nilai yang tampil di aplikasinya (mis. Bibit), untuk menghitung untung/rugi.</p>
          <ActionForm action={setPriceAction.bind(null, asset.id)} submitLabel="Simpan nilai" submitSize="sm" submitVariant="secondary" resetOnSuccess className="space-y-2">
            <input type="hidden" name="mode" value="value" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input name="price" className="input" inputMode="decimal" placeholder="Total nilai, mis. 10,5jt" aria-label="Total nilai" required />
              <input name="asOf" type="date" className="input" defaultValue={toDateInput(new Date())} aria-label="Tanggal nilai" />
            </div>
          </ActionForm>
          {asset.prices.length > 0 && (
            <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
              {asset.prices.map((pr) => (
                <li key={pr.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-slate-600">{formatDate(pr.asOf)}</span>
                  <span className="flex items-center gap-2">
                    <Money value={Number(pr.price)} />
                    <ConfirmButton action={deletePriceAction.bind(null, pr.id)} label="Hapus" title="Hapus catatan nilai ini?" confirmLabel="Hapus" variant="ghost" />
                  </span>
                </li>
              ))}
            </ul>
          )}
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
                      <Badge tone={t.kind === "buy" ? "blue" : t.kind === "sell" ? "amber" : "green"}>{kindLabel(t.kind)}</Badge>{" "}
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
        <div className="flex flex-wrap gap-2">
          <ConfirmButton
            action={deleteAssetAction.bind(null, asset.id)}
            label="Hapus aset"
            title={`Hapus ${asset.name}?`}
            description={
              asset.transactions.length || asset.prices.length
                ? `⚠️ Aset ini punya ${asset.transactions.length} riwayat ${valueMode ? "setor/tarik" : "beli/jual"}${asset.prices.length ? " dan catatan nilai" : ""}. Semuanya ikut terhapus.${cashLinked ? ` ${cashLinked} transaksi kas terkait (mis. ${valueMode ? "setoran" : "pembelian"} dari BCA) juga dihapus, jadi saldo rekening kembali seperti sebelum dicatat.` : ""}\n\nKalau cuma mau menyembunyikan, pakai "Arsipkan aset".`
                : "Aset ini belum punya riwayat, jadi akan dihapus permanen."
            }
            confirmLabel="Hapus aset"
            redirectTo="/investasi"
          />
          <ConfirmButton
            action={archiveAssetAction.bind(null, asset.id, !asset.isArchived)}
            label={asset.isArchived ? "Aktifkan lagi" : "Arsipkan aset"}
            title={asset.isArchived ? "Aktifkan aset ini lagi?" : "Arsipkan aset ini?"}
            description={asset.isArchived ? undefined : valueMode ? "Hanya bisa jika nilainya sudah nol (semua ditarik). Riwayat tetap tersimpan." : "Hanya bisa jika unit sudah habis dijual. Riwayat tetap tersimpan."}
            confirmLabel={asset.isArchived ? "Aktifkan" : "Arsipkan"}
            variant="secondary"
          />
        </div>
      )}
    </div>
  );
}
