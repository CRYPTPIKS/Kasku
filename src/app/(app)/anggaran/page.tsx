import type { Metadata } from "next";
import Link from "next/link";
import { currentMonthRange, formatMonth, parseMonthKey, previousMonth } from "@/lib/dates";
import { formatPercent } from "@/lib/money";
import { requireUser } from "@/server/auth/current";
import { canWrite } from "@/server/context";
import { listBudgetStatus, monthKeyOf } from "@/server/services/budgets";
import { listCategories } from "@/server/services/categories";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Money } from "@/components/ui/money";
import { Stat } from "@/components/ui/stat";
import { ProgressBar } from "@/components/ui/progress";
import { deleteBudgetAction, saveBudgetAction } from "./actions";

export const metadata: Metadata = { title: "Anggaran" };

function nextMonth(year: number, month: number) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export default async function BudgetsPage({ searchParams }: { searchParams: Promise<{ bulan?: string }> }) {
  const { ctx } = await requireUser();
  const sp = await searchParams;
  const cur = currentMonthRange();
  const sel = (sp.bulan && parseMonthKey(sp.bulan)) || { year: cur.year, month: cur.month };
  const [status, categories] = await Promise.all([listBudgetStatus(ctx, sel), listCategories(ctx, { kind: "expense" })]);
  const writable = canWrite(ctx);
  const prev = previousMonth(sel.year, sel.month);
  const next = nextMonth(sel.year, sel.month);
  const key = monthKeyOf(sel.year, sel.month);
  const budgeted = new Set(status.items.map((i) => i.categoryId));
  const available = categories.filter((c) => !budgeted.has(c.id));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Anggaran" description="Batas belanja bulanan per kategori. Peringatan dikirim ke Telegram saat mencapai 80% dan 100%." />

      <div className="flex items-center justify-between gap-2">
        <Link href={`/anggaran?bulan=${monthKeyOf(prev.year, prev.month)}`} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          ← {formatMonth(prev.year, prev.month)}
        </Link>
        <h2 className="text-lg font-semibold">{formatMonth(sel.year, sel.month)}</h2>
        <Link href={`/anggaran?bulan=${monthKeyOf(next.year, next.month)}`} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          {formatMonth(next.year, next.month)} →
        </Link>
      </div>

      {status.items.length > 0 && (
        <Card className="p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total anggaran" value={<Money value={status.total} />} />
            <Stat label="Terpakai" value={<Money value={status.spent} />} hint={formatPercent(status.ratio)} />
            <Stat label="Sisa" value={<Money value={status.remaining} />} />
            {status.isCurrent && <Stat label="Jatah per hari" value={<Money value={status.dailyAllowance} />} hint="sampai akhir bulan" />}
          </div>
          <div className="mt-4">
            <ProgressBar ratio={status.ratio} />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Per kategori" subtitle="Anggaran kategori induk ikut menghitung sub-kategorinya" />
        {status.items.length === 0 ? (
          <EmptyState icon="🎯" title="Belum ada anggaran" description="Tambahkan batas belanja untuk kategori yang ingin kamu kendalikan, misalnya Makan & Minum." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {status.items.map((b) => (
              <li key={b.budgetId} className="px-4 py-4 sm:px-5">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {b.icon && <span aria-hidden>{b.icon} </span>}
                    {b.name}
                    {b.level === "over" && <span className="ml-2"><Badge tone="red">Terlampaui</Badge></span>}
                    {b.level === "warn" && <span className="ml-2"><Badge tone="amber">Hampir habis</Badge></span>}
                  </p>
                  <p className="text-sm">
                    <Money value={b.spent} className="font-semibold" /> <span className="text-slate-500">dari</span> <Money value={b.amount} />
                  </p>
                </div>
                <ProgressBar ratio={b.ratio} tone={b.level} />
                <p className="mt-1 text-xs text-slate-500">
                  {b.remaining >= 0 ? (
                    <>
                      Sisa <Money value={b.remaining} tone="plain" /> · {formatPercent(b.ratio)}
                    </>
                  ) : (
                    <>
                      Lebih <Money value={-b.remaining} tone="plain" /> · {formatPercent(b.ratio)}
                    </>
                  )}
                  {b.hasMonthOverride && <> · khusus bulan ini (default <Money value={b.defaultAmount} tone="plain" />)</>}
                </p>
                {writable && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-medium text-brand-700">Ubah</summary>
                    <ActionForm action={saveBudgetAction} submitLabel="Simpan" submitSize="sm" className="mt-2 space-y-2">
                      <input type="hidden" name="categoryId" value={b.categoryId} />
                      <input type="hidden" name="month" value={key} />
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input name="amount" className="input" inputMode="decimal" defaultValue={String(b.amount)} aria-label="Batas" required />
                        <select name="scope" className="input" defaultValue="default" aria-label="Berlaku">
                          <option value="default">Berlaku tiap bulan</option>
                          <option value="month">Hanya {formatMonth(sel.year, sel.month)}</option>
                        </select>
                      </div>
                    </ActionForm>
                    <div className="mt-2">
                      <ConfirmButton
                        action={deleteBudgetAction.bind(null, b.budgetId)}
                        label="Hapus anggaran"
                        title={`Hapus anggaran ${b.name}?`}
                        description="Transaksi tidak terpengaruh."
                        confirmLabel="Hapus"
                      />
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {writable && available.length > 0 && (
        <Card className="p-4 sm:p-5">
          <h2 className="mb-3 font-semibold">Tambah anggaran</h2>
          <ActionForm action={saveBudgetAction} submitLabel="Tambah" resetOnSuccess>
            <input type="hidden" name="month" value={key} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="categoryId">
                  Kategori
                </label>
                <select id="categoryId" name="categoryId" className="input" required defaultValue="">
                  <option value="">— Pilih kategori —</option>
                  {available.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon ? `${c.icon} ` : ""}
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="amount">
                  Batas per bulan
                </label>
                <input id="amount" name="amount" className="input" inputMode="decimal" placeholder="mis. 1,5jt" required />
              </div>
            </div>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
