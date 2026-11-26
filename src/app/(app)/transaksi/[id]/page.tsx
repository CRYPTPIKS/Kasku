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
  const { categories, accounts } = await transactionFormOptions(ctx);

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

          {t.attachments.length > 0 && (
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
