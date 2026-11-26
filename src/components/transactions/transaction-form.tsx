"use client";

import { useActionState, useMemo, useState } from "react";
import { saveTransactionAction } from "@/app/(app)/transaksi/actions";
import { parseAmount } from "@/lib/parsing/amount";
import { formatRupiah } from "@/lib/money";
import { Alert } from "../ui/card";
import { Button } from "../ui/button";

type Kind = "income" | "expense";
export interface FormCategory {
  id: string;
  name: string;
  kind: Kind;
  icon: string | null;
}
export interface FormAccount {
  id: string;
  name: string;
  kindLabel: string;
}
export interface TransactionFormValues {
  id?: string;
  type: string;
  amount: string;
  occurredAt: string;
  description: string;
  merchant: string;
  note: string;
  categoryId: string;
  fromAccountId: string;
  toAccountId: string;
  tags: string;
  status: "draft" | "confirmed";
  splits: { categoryId: string; amount: string; note: string }[];
}

const PRIMARY_TYPES = [
  { value: "expense", label: "Pengeluaran" },
  { value: "income", label: "Pemasukan" },
  { value: "transfer", label: "Transfer" },
  { value: "adjustment", label: "Penyesuaian" },
] as const;

const OTHER_TYPE_LABELS: Record<string, string> = {
  debt_receivable: "Memberi pinjaman (piutang)",
  debt_payable: "Menerima pinjaman (hutang)",
  debt_payment: "Bayar/terima cicilan",
  investment_buy: "Beli investasi",
  investment_sell: "Jual investasi",
  investment_income: "Dividen/bunga",
};

// Rekening yang ditampilkan untuk tiap jenis.
const ACCOUNT_FIELDS: Record<string, { from?: string; to?: string }> = {
  expense: { from: "Bayar dari rekening" },
  income: { to: "Masuk ke rekening" },
  transfer: { from: "Dari rekening", to: "Ke rekening" },
  adjustment: { from: "Kurangi saldo rekening", to: "Tambah saldo rekening" },
  debt_receivable: { from: "Dari rekening" },
  debt_payable: { to: "Ke rekening" },
  debt_payment: { from: "Dari rekening (bayar hutang)", to: "Ke rekening (terima cicilan)" },
  investment_buy: { from: "Dari rekening" },
  investment_sell: { to: "Ke rekening" },
  investment_income: { to: "Ke rekening" },
};

export function TransactionForm({
  initial,
  categories,
  accounts,
}: {
  initial: TransactionFormValues;
  categories: FormCategory[];
  accounts: FormAccount[];
}) {
  const [state, action, pending] = useActionState(saveTransactionAction, {});
  const v = state.values;
  const [type, setType] = useState(v?.type ?? initial.type);
  const [amountText, setAmountText] = useState(v?.amount ?? initial.amount);
  const [useSplits, setUseSplits] = useState(initial.splits.length > 0);
  const [splits, setSplits] = useState(
    initial.splits.length ? initial.splits : [{ categoryId: "", amount: "", note: "" }, { categoryId: "", amount: "", note: "" }],
  );

  const parsedAmount = useMemo(() => parseAmount(amountText), [amountText]);
  const kind: Kind | null = type === "expense" ? "expense" : type === "income" || type === "investment_income" ? "income" : null;
  const cats = categories.filter((c) => c.kind === kind);
  const fields = ACCOUNT_FIELDS[type] ?? {};
  const fe = state.fieldErrors ?? {};
  const splitTotal = splits.reduce((a, s) => a + (parseAmount(s.amount) ?? 0), 0);

  return (
    <form action={action} className="space-y-5">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="type" value={type} />
      {state.error && <Alert>{state.error}</Alert>}

      <div>
        <span className="label">Jenis</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PRIMARY_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                type === t.value ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {OTHER_TYPE_LABELS[type] && <p className="mt-2 text-sm text-slate-600">Jenis: {OTHER_TYPE_LABELS[type]}</p>}
      </div>

      <div>
        <label htmlFor="amount" className="label">
          Nominal
        </label>
        <input
          id="amount"
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          className="input text-lg font-semibold"
          placeholder="mis. 75rb, 1,5jt, 25.000"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          required
        />
        <p className={`mt-1 text-sm ${parsedAmount === null && amountText ? "text-red-600" : "text-slate-500"}`}>
          {amountText ? (parsedAmount === null ? "Nominal belum terbaca" : `= ${formatRupiah(parsedAmount)}`) : "Boleh pakai rb, jt, atau titik ribuan."}
        </p>
        {fe.amount && <p className="mt-1 text-sm text-red-600">{fe.amount}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="occurredAt" className="label">
            Tanggal & jam
          </label>
          <input id="occurredAt" name="occurredAt" type="datetime-local" className="input" defaultValue={v?.occurredAt ?? initial.occurredAt} required />
        </div>
        <div>
          <label htmlFor="description" className="label">
            Keterangan
          </label>
          <input id="description" name="description" className="input" placeholder="mis. Makan siang" defaultValue={v?.description ?? initial.description} />
        </div>
      </div>

      {(fields.from || fields.to) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.from && (
            <AccountSelect name="fromAccountId" label={fields.from} accounts={accounts} defaultValue={v?.fromAccountId ?? initial.fromAccountId} error={fe.fromAccountId} />
          )}
          {fields.to && (
            <AccountSelect name="toAccountId" label={fields.to} accounts={accounts} defaultValue={v?.toAccountId ?? initial.toAccountId} error={fe.toAccountId} />
          )}
        </div>
      )}
      {type === "adjustment" && <p className="-mt-2 text-xs text-slate-500">Isi salah satu saja: tambah atau kurangi saldo.</p>}

      {kind && (
        <div className="space-y-3">
          {!useSplits && (
            <div>
              <label htmlFor="categoryId" className="label">
                Kategori
              </label>
              <select id="categoryId" name="categoryId" className="input" defaultValue={v?.categoryId ?? initial.categoryId}>
                <option value="">— Pilih kategori —</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon ? `${c.icon} ` : ""}
                    {c.name}
                  </option>
                ))}
              </select>
              {fe.categoryId && <p className="mt-1 text-sm text-red-600">{fe.categoryId}</p>}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="useSplits" checked={useSplits} onChange={(e) => setUseSplits(e.target.checked)} className="h-4 w-4 rounded" />
            Bagi ke beberapa kategori
          </label>
          {useSplits && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              {splits.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_8rem_auto] items-center gap-2">
                  <select
                    name={`split.${i}.categoryId`}
                    className="input"
                    value={s.categoryId}
                    onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)))}
                    aria-label={`Kategori bagian ${i + 1}`}
                  >
                    <option value="">— Kategori —</option>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <input
                    name={`split.${i}.amount`}
                    className="input"
                    inputMode="decimal"
                    placeholder="Nominal"
                    value={s.amount}
                    onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                    aria-label={`Nominal bagian ${i + 1}`}
                  />
                  <button
                    type="button"
                    className="rounded-lg px-2 py-2 text-slate-500 hover:bg-slate-200 disabled:opacity-30"
                    onClick={() => setSplits(splits.filter((_, j) => j !== i))}
                    disabled={splits.length <= 2}
                    aria-label="Hapus bagian"
                  >
                    ✕
                  </button>
                  <input type="hidden" name={`split.${i}.note`} value={s.note} />
                </div>
              ))}
              <div className="flex items-center justify-between text-sm">
                <button type="button" className="font-medium text-brand-700" onClick={() => setSplits([...splits, { categoryId: "", amount: "", note: "" }])}>
                  + Tambah bagian
                </button>
                <span className={parsedAmount !== null && Math.round(splitTotal * 100) !== Math.round(parsedAmount * 100) ? "text-red-600" : "text-slate-600"}>
                  {formatRupiah(splitTotal)} dari {formatRupiah(parsedAmount ?? 0)}
                </span>
              </div>
              {fe.splits && <p className="text-sm text-red-600">{fe.splits}</p>}
            </div>
          )}
        </div>
      )}

      <details className="group rounded-xl border border-slate-200 bg-white" open={Boolean(initial.merchant || initial.note || initial.tags)}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700">Detail tambahan</summary>
        <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2">
          <div>
            <label htmlFor="merchant" className="label">
              Toko / merchant
            </label>
            <input id="merchant" name="merchant" className="input" defaultValue={v?.merchant ?? initial.merchant} />
          </div>
          <div>
            <label htmlFor="tags" className="label">
              Tag
            </label>
            <input id="tags" name="tags" className="input" placeholder="pisahkan dengan koma, mis. kantor, liburan" defaultValue={v?.tags ?? initial.tags} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="note" className="label">
              Catatan
            </label>
            <textarea id="note" name="note" rows={3} className="input" defaultValue={v?.note ?? initial.note} />
          </div>
        </div>
      </details>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="saveAsDraft" defaultChecked={initial.status === "draft"} className="h-4 w-4 rounded" />
        Simpan sebagai draf (belum memengaruhi saldo)
      </label>

      <div className="flex gap-2 border-t border-slate-100 pt-4">
        <Button type="submit" className="flex-1 sm:flex-none" disabled={pending}>
          {pending ? "Menyimpan…" : "Simpan"}
        </Button>
        {!initial.id && (
          <Button type="submit" name="addAnother" value="1" variant="secondary" disabled={pending}>
            Simpan & catat lagi
          </Button>
        )}
      </div>
    </form>
  );
}

function AccountSelect({
  name,
  label,
  accounts,
  defaultValue,
  error,
}: {
  name: string;
  label: string;
  accounts: FormAccount[];
  defaultValue: string;
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="label">
        {label}
      </label>
      <select id={name} name={name} className="input" defaultValue={defaultValue}>
        <option value="">— Pilih rekening —</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} ({a.kindLabel})
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
