import type { Metadata } from "next";
import Link from "next/link";
import { toDateInput } from "@/lib/dates";
import { requireUser } from "@/server/auth/current";
import { listAccounts } from "@/server/services/accounts";
import { ActionForm } from "@/components/ui/action-form";
import { Card, PageHeader } from "@/components/ui/card";
import { ToggleSection } from "@/components/ui/toggle-section";
import { createDebtAction } from "../actions";

export const metadata: Metadata = { title: "Catat hutang/piutang" };

export default async function NewDebtPage({ searchParams }: { searchParams: Promise<{ jenis?: string }> }) {
  const { ctx } = await requireUser();
  const sp = await searchParams;
  const accounts = await listAccounts(ctx);
  const today = toDateInput(new Date());
  const direction = sp.jenis === "piutang" ? "receivable" : "payable";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="Catat hutang/piutang"
        actions={
          <Link href="/hutang" className="text-sm font-medium text-brand-700">
            ← Kembali
          </Link>
        }
      />
      <Card className="p-4 sm:p-6">
        <ActionForm action={createDebtAction} submitLabel="Simpan" className="space-y-4">
          <fieldset>
            <legend className="label">Jenis</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-300 p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
                <input type="radio" name="direction" value="payable" defaultChecked={direction === "payable"} className="mt-1" />
                <span>
                  <span className="block font-medium">Hutang</span>
                  <span className="text-xs text-slate-500">Saya meminjam / berhutang ke orang lain</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-300 p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
                <input type="radio" name="direction" value="receivable" defaultChecked={direction === "receivable"} className="mt-1" />
                <span>
                  <span className="block font-medium">Piutang</span>
                  <span className="text-xs text-slate-500">Orang lain meminjam ke saya</span>
                </span>
              </label>
            </div>
          </fieldset>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="counterparty">
                Nama pihak
              </label>
              <input id="counterparty" name="counterparty" className="input" required maxLength={80} placeholder="mis. Budi" />
            </div>
            <div>
              <label className="label" htmlFor="principalAmount">
                Nominal pinjaman
              </label>
              <input id="principalAmount" name="principalAmount" className="input" inputMode="decimal" required placeholder="mis. 2jt" />
            </div>
            <div>
              <label className="label" htmlFor="startDate">
                Tanggal
              </label>
              <input id="startDate" name="startDate" type="date" className="input" required defaultValue={today} />
            </div>
            <div>
              <label className="label" htmlFor="accountId">
                Rekening (opsional)
              </label>
              <select id="accountId" name="accountId" className="input" defaultValue="">
                <option value="">Tanpa arus kas (hanya catat)</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">Isi agar uang pinjaman ikut masuk/keluar rekening.</p>
            </div>
          </div>

          <ToggleSection name="useInstallments" label="Dibayar dengan cicilan bulanan">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="installmentCount">
                  Jumlah cicilan
                </label>
                <input id="installmentCount" name="installmentCount" type="number" min={1} max={360} className="input" placeholder="mis. 12" />
              </div>
              <div>
                <label className="label" htmlFor="installmentAmount">
                  Per cicilan (opsional)
                </label>
                <input id="installmentAmount" name="installmentAmount" className="input" inputMode="decimal" placeholder="kosong = dibagi rata" />
              </div>
              <div>
                <label className="label" htmlFor="firstDueDate">
                  Jatuh tempo pertama
                </label>
                <input id="firstDueDate" name="firstDueDate" type="date" className="input" />
              </div>
            </div>
            <p className="text-xs text-slate-500">Jika cicilan termasuk bunga, isi nominal per cicilan. Total kewajiban = jumlah semua cicilan.</p>
          </ToggleSection>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="dueDate">
                Jatuh tempo (tanpa cicilan, opsional)
              </label>
              <input id="dueDate" name="dueDate" type="date" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="reminderDaysBefore">
                Ingatkan (hari sebelum jatuh tempo)
              </label>
              <input id="reminderDaysBefore" name="reminderDaysBefore" type="number" min={0} max={30} defaultValue={3} className="input" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="note">
              Catatan (opsional)
            </label>
            <textarea id="note" name="note" rows={2} maxLength={500} className="input" />
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
