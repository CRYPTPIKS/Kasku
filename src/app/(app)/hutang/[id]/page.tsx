import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, toDateInput } from "@/lib/dates";
import { requireUser } from "@/server/auth/current";
import { canWrite } from "@/server/context";
import { AppError } from "@/server/errors";
import { listAccounts } from "@/server/services/accounts";
import { DEBT_DIRECTION_LABELS, DEBT_STATUS_LABELS, getDebt, nextInstallment } from "@/server/services/debts";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Money } from "@/components/ui/money";
import { ProgressBar } from "@/components/ui/progress";
import { deleteDebtAction, payDebtAction, updateDebtAction } from "../actions";

export const metadata: Metadata = { title: "Detail hutang/piutang" };

export default async function DebtDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx } = await requireUser();
  const debt = await getDebt(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const accounts = await listAccounts(ctx);
  const writable = canWrite(ctx);
  const payable = debt.direction === "payable";
  const obligation = debt.installments.length ? debt.installments.reduce((a, i) => a + Number(i.amount), 0) : Number(debt.principalAmount);
  const remaining = Number(debt.remainingAmount);
  const next = nextInstallment(debt);
  const suggested = next ? Number(next.amount) - Number(next.paidAmount) : remaining;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={`${DEBT_DIRECTION_LABELS[debt.direction]} ${payable ? "ke" : "dari"} ${debt.counterparty}`}
        description={`Mulai ${formatDate(debt.startDate)}${debt.dueDate ? ` · jatuh tempo ${formatDate(debt.dueDate)}` : ""}`}
        actions={
          <Link href="/hutang" className="text-sm font-medium text-brand-700">
            ← Semua
          </Link>
        }
      />
      {sp.saved && <Alert tone="green">Tersimpan.</Alert>}

      <Card className="p-4 sm:p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">Sisa</p>
            <p className={`text-2xl font-bold ${payable ? "text-red-600" : "text-emerald-600"}`}>
              <Money value={remaining} tone="plain" />
            </p>
            <p className="text-xs text-slate-500">
              dari <Money value={obligation} tone="plain" />
              {obligation !== Number(debt.principalAmount) && (
                <>
                  {" "}
                  (pokok <Money value={Number(debt.principalAmount)} tone="plain" />)
                </>
              )}
            </p>
          </div>
          <Badge tone={debt.status === "overdue" ? "red" : debt.status === "paid" ? "green" : "slate"}>{DEBT_STATUS_LABELS[debt.status]}</Badge>
        </div>
        <ProgressBar ratio={obligation > 0 ? (obligation - remaining) / obligation : 0} tone="ok" />
        {debt.note && <p className="mt-3 text-sm text-slate-600">{debt.note}</p>}
      </Card>

      {writable && debt.status !== "paid" && (
        <Card className="p-4 sm:p-5">
          <h2 className="mb-3 font-semibold">{payable ? "Bayar hutang" : "Terima pembayaran"}</h2>
          <ActionForm action={payDebtAction.bind(null, debt.id)} submitLabel="Catat pembayaran" resetOnSuccess>
            {next && <input type="hidden" name="installmentId" value={next.id} />}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="amount">
                  Nominal
                </label>
                <input id="amount" name="amount" className="input" inputMode="decimal" required defaultValue={String(Math.round(suggested * 100) / 100)} />
              </div>
              <div>
                <label className="label" htmlFor="occurredAt">
                  Tanggal
                </label>
                <input id="occurredAt" name="occurredAt" type="date" className="input" required defaultValue={toDateInput(new Date())} />
              </div>
              <div>
                <label className="label" htmlFor="accountId">
                  {payable ? "Dari rekening" : "Ke rekening"}
                </label>
                <select id="accountId" name="accountId" className="input" defaultValue="">
                  <option value="">Tanpa rekening</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {next && <p className="text-xs text-slate-500">Disarankan: cicilan ke-{next.sequence} (jatuh tempo {formatDate(next.dueDate)}).</p>}
          </ActionForm>
        </Card>
      )}

      {debt.installments.length > 0 && (
        <Card>
          <CardHeader title="Jadwal cicilan" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 sm:px-5">#</th>
                  <th className="px-2 py-2">Jatuh tempo</th>
                  <th className="px-2 py-2 text-right">Cicilan</th>
                  <th className="px-4 py-2 text-right sm:px-5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {debt.installments.map((i) => {
                  const paidAmt = Number(i.paidAmount);
                  return (
                    <tr key={i.id}>
                      <td className="px-4 py-2 sm:px-5">{i.sequence}</td>
                      <td className="px-2 py-2">{formatDate(i.dueDate)}</td>
                      <td className="px-2 py-2 text-right">
                        <Money value={Number(i.amount)} />
                      </td>
                      <td className="px-4 py-2 text-right sm:px-5">
                        {i.paidAt ? (
                          <Badge tone="green">Lunas</Badge>
                        ) : i.isLate ? (
                          <Badge tone="red">Terlambat</Badge>
                        ) : paidAmt > 0 ? (
                          <Badge tone="amber">
                            Dibayar <Money value={paidAmt} tone="plain" />
                          </Badge>
                        ) : (
                          <span className="text-xs text-slate-400">Belum</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Riwayat" />
        {debt.transactions.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-500">Belum ada transaksi kas.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {debt.transactions.map((t) => (
              <li key={t.id}>
                <Link href={`/transaksi/${t.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.description}</p>
                    <p className="text-xs text-slate-500">
                      {formatDate(t.occurredAt)}
                      {(t.fromAccount ?? t.toAccount) && ` · ${(t.fromAccount ?? t.toAccount)!.name}`}
                    </p>
                  </div>
                  <Money value={Number(t.amount)} className="font-medium" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {writable && (
        <Card className="p-4 sm:p-5">
          <details>
            <summary className="cursor-pointer font-medium">Ubah detail</summary>
            <ActionForm action={updateDebtAction.bind(null, debt.id)} submitLabel="Simpan" className="mt-3 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="label" htmlFor="e-counterparty">
                    Nama pihak
                  </label>
                  <input id="e-counterparty" name="counterparty" className="input" defaultValue={debt.counterparty} required />
                </div>
                <div>
                  <label className="label" htmlFor="e-dueDate">
                    Jatuh tempo
                  </label>
                  <input id="e-dueDate" name="dueDate" type="date" className="input" defaultValue={debt.dueDate ? toDateInput(debt.dueDate) : ""} />
                </div>
                <div>
                  <label className="label" htmlFor="e-reminder">
                    Ingatkan H-
                  </label>
                  <input id="e-reminder" name="reminderDaysBefore" type="number" min={0} max={30} className="input" defaultValue={debt.reminderDaysBefore} />
                </div>
              </div>
              <textarea name="note" rows={2} className="input" defaultValue={debt.note ?? ""} placeholder="Catatan" aria-label="Catatan" />
            </ActionForm>
            <div className="mt-4 border-t border-slate-100 pt-4">
              <ConfirmButton
                action={deleteDebtAction.bind(null, debt.id)}
                label={`Hapus ${DEBT_DIRECTION_LABELS[debt.direction].toLowerCase()} ini`}
                title="Hapus beserta riwayatnya?"
                description="Semua transaksi pinjaman dan pembayarannya ikut dihapus (bisa dipulihkan admin dari daftar transaksi terhapus, tetapi tidak lagi tertaut)."
                confirmLabel="Ya, hapus"
                redirectTo="/hutang"
              />
            </div>
          </details>
        </Card>
      )}
    </div>
  );
}
