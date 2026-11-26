import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatDateTime, toDateTimeInput } from "@/lib/dates";
import { formatNumber } from "@/lib/money";
import { requireUser } from "@/server/auth/current";
import { isAdmin } from "@/server/context";
import { AppError } from "@/server/errors";
import { TRANSACTION_TYPE_LABELS } from "@/server/ledger";
import { transactionFormOptions } from "@/server/services/form-options";
import { getTransaction } from "@/server/services/transactions";
import { getReceiptForTransaction } from "@/server/receipts/service";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Money } from "@/components/ui/money";
import {
  confirmTransactionAction,
  deleteTransactionAction,
  duplicateTransactionAction,
  restoreTransactionAction,
} from "../actions";

export const metadata: Metadata = { title: "Detail transaksi" };

export default async function TransactionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requireUser();
  const t = await getTransaction(ctx, id, { includeDeleted: isAdmin(ctx) }).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const [{ categories, accounts }, receipt] = await Promise.all([transactionFormOptions(ctx), getReceiptForTransaction(ctx, t.id)]);
  const extraction = receipt?.extractions[0];
  const items = Array.isArray(extraction?.items) ? (extraction.items as { name?: string; qty?: number | null; total?: number | null }[]) : [];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={t.description || t.merchant || TRANSACTION_TYPE_LABELS[t.type]}
        description={`${TRANSACTION_TYPE_LABELS[t.type]} · ${formatDateTime(t.occurredAt)}`}
      />
      {sp.saved && <Alert tone="green">Perubahan tersimpan.</Alert>}
      {sp.duplicated && <Alert tone="green">Transaksi berhasil diduplikasi. Ini salinannya — ubah bila perlu.</Alert>}
      {sp.error && <Alert>{sp.error}</Alert>}

      {t.deletedAt ? (
        <Card className="p-5">
          <p className="mb-1 text-lg font-semibold">
            <Money value={Number(t.amount)} />
          </p>
          <p className="mb-4 text-sm text-slate-600">Transaksi ini sudah dihapus pada {formatDateTime(t.deletedAt)} dan tidak dihitung di saldo maupun laporan.</p>
          <ConfirmButton
            action={restoreTransactionAction.bind(null, t.id)}
            label="Pulihkan transaksi"
            title="Pulihkan transaksi?"
            description="Transaksi akan kembali dihitung di saldo dan laporan."
            confirmLabel="Pulihkan"
            variant="primary"
            size="md"
          />
        </Card>
      ) : (
        <>
          {t.status === "draft" && (
            <Card className="border-amber-200 bg-amber-50/60 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Badge tone="amber">Draf</Badge>
                  <p className="mt-1 text-sm text-amber-900">Belum dikonfirmasi, belum memengaruhi saldo. Periksa lalu konfirmasi.</p>
                </div>
                <ConfirmButton
                  action={confirmTransactionAction.bind(null, t.id)}
                  label="Konfirmasi"
                  title="Konfirmasi transaksi?"
                  description="Transaksi akan masuk ke saldo dan laporan."
                  confirmLabel="Ya, konfirmasi"
                  variant="primary"
                  size="md"
                />
              </div>
            </Card>
          )}

          <Card className="p-4 sm:p-6">
            <TransactionForm
              categories={categories}
              accounts={accounts}
              initial={{
                id: t.id,
                type: t.type,
                amount: formatNumber(Number(t.amount)),
                occurredAt: toDateTimeInput(t.occurredAt),
                description: t.description ?? "",
                merchant: t.merchant ?? "",
                note: t.note ?? "",
                categoryId: t.categoryId ?? "",
                fromAccountId: t.fromAccountId ?? "",
                toAccountId: t.toAccountId ?? "",
                tags: t.tags.map((x) => x.tag.name).join(", "),
                status: t.status,
                splits: t.splits.map((s) => ({ categoryId: s.categoryId ?? "", amount: formatNumber(Number(s.amount)), note: s.note ?? "" })),
              }}
            />
          </Card>

          {receipt && (
            <Card>
              <CardHeader title="Struk" subtitle={extraction ? `Dibaca oleh ${extraction.provider}` : undefined} />
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:p-5">
                <a href={`/api/receipts/${receipt.id}/image`} target="_blank" rel="noopener" className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- gambar privat, tidak lewat optimizer */}
                  <img src={`/api/receipts/${receipt.id}/image`} alt="Foto struk" className="max-h-72 w-full rounded-lg border border-slate-200 object-contain sm:w-48" />
                </a>
                {extraction && (
                  <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    {extraction.merchant && (<><dt className="text-slate-500">Toko</dt><dd>{extraction.merchant}</dd></>)}
                    {extraction.total != null && (<><dt className="text-slate-500">Total</dt><dd><Money value={Number(extraction.total)} /></dd></>)}
                    {extraction.subtotal != null && (<><dt className="text-slate-500">Subtotal</dt><dd><Money value={Number(extraction.subtotal)} /></dd></>)}
                    {extraction.discount != null && (<><dt className="text-slate-500">Diskon</dt><dd><Money value={Number(extraction.discount)} /></dd></>)}
                    {extraction.tax != null && (<><dt className="text-slate-500">Pajak</dt><dd><Money value={Number(extraction.tax)} /></dd></>)}
                    {extraction.paymentMethod && (<><dt className="text-slate-500">Pembayaran</dt><dd>{extraction.paymentMethod}</dd></>)}
                    {extraction.confidence != null && (<><dt className="text-slate-500">Keyakinan</dt><dd>{Math.round(Number(extraction.confidence) * 100)}%</dd></>)}
                    {items.length > 0 && (
                      <div className="col-span-2 mt-2">
                        <dt className="mb-1 text-slate-500">Item</dt>
                        <dd>
                          <ul className="space-y-0.5">
                            {items.slice(0, 30).map((it, i) => (
                              <li key={i} className="flex justify-between gap-2">
                                <span className="truncate">{it.name}{it.qty && it.qty > 1 ? ` ×${it.qty}` : ""}</span>
                                {it.total != null && <Money value={Number(it.total)} />}
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>
              {t.status === "draft" && <p className="px-5 pb-4 text-xs text-slate-500">Hasil baca otomatis bisa keliru. Cocokkan dengan foto sebelum konfirmasi.</p>}
            </Card>
          )}

          {!receipt && t.attachments.length > 0 && (
            <Card>
              <CardHeader title="Lampiran" />
              <p className="px-5 py-4 text-sm text-slate-600">{t.attachments.length} lampiran tersimpan.</p>
            </Card>
          )}

          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <form action={duplicateTransactionAction.bind(null, t.id)}>
                <Button variant="secondary" size="sm">
                  Duplikasi
                </Button>
              </form>
              <ConfirmButton
                action={deleteTransactionAction.bind(null, t.id)}
                label="Hapus"
                title="Hapus transaksi ini?"
                description="Transaksi tidak lagi dihitung di saldo dan laporan. Admin masih bisa memulihkannya."
                confirmLabel="Ya, hapus"
                redirectTo="/transaksi"
              />
              <p className="ml-auto text-xs text-slate-500">
                Dibuat {formatDateTime(t.createdAt)}
                {t.createdBy ? ` oleh ${t.createdBy.name}` : ""}
                {t.updatedAt.getTime() - t.createdAt.getTime() > 1000 ? ` · diubah ${formatDateTime(t.updatedAt)}` : ""}
              </p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
