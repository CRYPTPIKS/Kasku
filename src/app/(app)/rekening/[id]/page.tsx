import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatNumber } from "@/lib/money";
import { requireUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { accountUsage, getAccount } from "@/server/services/accounts";
import { loadBusinesses } from "@/server/services/reports";
import { listTransactions } from "@/server/services/transactions";
import { AccountForm } from "@/components/accounts/account-form";
import { TransactionRow } from "@/components/transactions/transaction-row";
import { LinkButton } from "@/components/ui/button";
import { Alert, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Money } from "@/components/ui/money";
import { archiveAccountAction, deleteAccountAction } from "../actions";

export const metadata: Metadata = { title: "Detail rekening" };

export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; page?: string; edit?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requireUser();
  const account = await getAccount(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const [history, usage] = await Promise.all([
    listTransactions(ctx, { accountId: id, page: Number(sp.page ?? 1) || 1, pageSize: 20 }),
    accountUsage(ctx, id),
  ]);
  const businesses = await loadBusinesses(ctx);
  const used = usage.transactions > 0;
  const usedParts = [
    `${usage.transactions} transaksi`,
    usage.debts ? `${usage.debts} hutang/piutang` : "",
    usage.investments ? `${usage.investments} transaksi investasi` : "",
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={account.name}
        description={account.kindLabel}
        actions={<LinkButton href={`/transaksi/baru?account=${account.id}`}>+ Catat</LinkButton>}
      />
      {sp.saved && <Alert tone="green">Rekening tersimpan.</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <p className="text-xs text-slate-500">Saldo awal</p>
          <p className="font-bold">
            <Money value={account.initialBalance} />
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500">Saldo terkini</p>
          <p className="text-lg font-bold">
            <Money value={account.balance} />
          </p>
          {account.creditLimit !== null && (
            <p className="text-xs text-slate-500">
              Sisa limit <Money value={account.creditLimit + Math.min(0, account.balance)} tone="plain" />
            </p>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Riwayat transaksi" subtitle={`${history.total} transaksi`} />
        {history.items.length === 0 ? (
          <EmptyState icon="🧾" title="Belum ada transaksi di rekening ini" />
        ) : (
          <div className="divide-y divide-slate-100">
            {history.items.map((t) => (
              <TransactionRow key={t.id} t={t} />
            ))}
          </div>
        )}
        {history.pageCount > 1 && (
          <div className="flex justify-between border-t border-slate-100 px-4 py-3 text-sm">
            {history.page > 1 ? <Link href={`?page=${history.page - 1}`}>← Sebelumnya</Link> : <span />}
            <span className="text-slate-500">
              {history.page}/{history.pageCount}
            </span>
            {history.page < history.pageCount ? <Link href={`?page=${history.page + 1}`}>Berikutnya →</Link> : <span />}
          </div>
        )}
      </Card>

      <details className="card" open={sp.edit === "1"}>
        <summary className="cursor-pointer px-5 py-3 font-semibold">Ubah rekening</summary>
        <div className="border-t border-slate-100 p-4 sm:p-6">
          <AccountForm
            businesses={businesses}
            initial={{
              id: account.id,
              name: account.name,
              kind: account.kind,
              institution: account.institution ?? "",
              accountNumberLast4: account.accountNumberLast4 ?? "",
              initialBalance: formatNumber(account.initialBalance),
              creditLimit: account.creditLimit === null ? "" : formatNumber(account.creditLimit),
              aliases: account.aliases.join(", "),
              businessId: account.businessId ?? "",
            }}
          />
        </div>
      </details>

      <Card className="flex flex-wrap gap-2 p-4">
        <ConfirmButton
          action={deleteAccountAction.bind(null, account.id)}
          label="Hapus rekening"
          title={used ? "Rekening ini tidak bisa dihapus" : `Hapus ${account.name}?`}
          description={
            used
              ? `⚠️ Rekening ini masih dipakai di ${usedParts.join(", ")}. Kalau dihapus, riwayat dan saldo (termasuk rekening lain yang terhubung lewat transfer) jadi tidak cocok.\n\nPakai "Arsipkan rekening" supaya rekening hilang dari pilihan tapi riwayatnya tetap aman. Atau hapus dulu transaksinya satu per satu.`
              : `Rekening ini belum pernah dipakai, jadi akan dihapus permanen.${usage.trashed ? ` ${usage.trashed} transaksi di tempat sampah yang memakai rekening ini ikut dihapus permanen.` : ""}`
          }
          confirmLabel="Hapus permanen"
          blocked={used}
          redirectTo="/rekening"
        />
        <ConfirmButton
          action={archiveAccountAction.bind(null, account.id, !account.isArchived)}
          label={account.isArchived ? "Aktifkan kembali" : "Arsipkan rekening"}
          title={account.isArchived ? "Aktifkan rekening ini?" : "Arsipkan rekening ini?"}
          description={
            account.isArchived
              ? "Rekening akan muncul lagi di pilihan transaksi."
              : "Rekening disembunyikan dari pilihan transaksi. Riwayat transaksi tetap tersimpan."
          }
          confirmLabel={account.isArchived ? "Aktifkan" : "Arsipkan"}
          variant={account.isArchived ? "primary" : "secondary"}
        />
      </Card>
    </div>
  );
}
