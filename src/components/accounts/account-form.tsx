"use client";

import { useActionState, useState } from "react";
import { saveAccountAction } from "@/app/(app)/rekening/actions";
import { Alert } from "../ui/card";
import { Button } from "../ui/button";

const KINDS = [
  { value: "cash", label: "Tunai" },
  { value: "bank", label: "Bank" },
  { value: "ewallet", label: "E-wallet" },
  { value: "credit_card", label: "Kartu kredit" },
  { value: "deposit", label: "Deposito" },
  { value: "other", label: "Lainnya" },
];

export interface AccountFormValues {
  id?: string;
  name: string;
  kind: string;
  institution: string;
  accountNumberLast4: string;
  initialBalance: string;
  creditLimit: string;
  aliases: string;
}

export function AccountForm({ initial }: { initial: AccountFormValues }) {
  const [state, action, pending] = useActionState(saveAccountAction, {});
  const v = state.values;
  const [kind, setKind] = useState(v?.kind ?? initial.kind);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      {state.error && <Alert>{state.error}</Alert>}
      <div>
        <label className="label" htmlFor="name">
          Nama rekening
        </label>
        <input id="name" name="name" className="input" required maxLength={60} placeholder="mis. BCA Utama" defaultValue={v?.name ?? initial.name} />
        {fe.name && <p className="mt-1 text-sm text-red-600">{fe.name}</p>}
      </div>
      <div>
        <label className="label" htmlFor="kind">
          Jenis
        </label>
        <select id="kind" name="kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)} required>
          <option value="">— Pilih jenis —</option>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        {fe.kind && <p className="mt-1 text-sm text-red-600">{fe.kind}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="institution">
            Bank / penyedia (opsional)
          </label>
          <input id="institution" name="institution" className="input" defaultValue={v?.institution ?? initial.institution} />
        </div>
        <div>
          <label className="label" htmlFor="accountNumberLast4">
            4 digit terakhir (opsional)
          </label>
          <input
            id="accountNumberLast4"
            name="accountNumberLast4"
            className="input"
            inputMode="numeric"
            maxLength={4}
            defaultValue={v?.accountNumberLast4 ?? initial.accountNumberLast4}
          />
          {fe.accountNumberLast4 && <p className="mt-1 text-sm text-red-600">{fe.accountNumberLast4}</p>}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="initialBalance">
            {kind === "credit_card" ? "Tagihan awal (isi minus, mis. -500rb)" : "Saldo awal"}
          </label>
          <input id="initialBalance" name="initialBalance" className="input" inputMode="decimal" defaultValue={v?.initialBalance ?? initial.initialBalance} />
          {fe.initialBalance && <p className="mt-1 text-sm text-red-600">{fe.initialBalance}</p>}
        </div>
        {kind === "credit_card" && (
          <div>
            <label className="label" htmlFor="creditLimit">
              Limit kartu
            </label>
            <input id="creditLimit" name="creditLimit" className="input" inputMode="decimal" defaultValue={v?.creditLimit ?? initial.creditLimit} />
          </div>
        )}
      </div>
      <div>
        <label className="label" htmlFor="aliases">
          Nama panggilan untuk bot Telegram
        </label>
        <input id="aliases" name="aliases" className="input" placeholder="mis. bca, tabungan" defaultValue={v?.aliases ?? initial.aliases} />
        <p className="mt-1 text-xs text-slate-500">Pisahkan dengan koma. Dipakai saat kamu menulis “dari BCA” di Telegram.</p>
        {fe.aliases && <p className="mt-1 text-sm text-red-600">{fe.aliases}</p>}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Simpan rekening"}
      </Button>
    </form>
  );
}
