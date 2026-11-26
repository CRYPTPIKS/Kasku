"use client";

import { useActionState } from "react";
import { saveCategoryAction } from "@/app/(app)/kategori/actions";
import { Alert } from "../ui/card";
import { Button } from "../ui/button";

export interface CategoryFormValues {
  id?: string;
  name: string;
  kind: "income" | "expense";
  parentId: string;
  icon: string;
  color: string;
  keywords: string;
}

export function CategoryForm({
  initial,
  parents,
}: {
  initial: CategoryFormValues;
  parents: { id: string; name: string; kind: "income" | "expense" }[];
}) {
  const [state, action, pending] = useActionState(saveCategoryAction, {});
  const v = state.values;
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      {state.error && <Alert>{state.error}</Alert>}
      <div className="grid grid-cols-[4.5rem_1fr] gap-3">
        <div>
          <label className="label" htmlFor="icon">
            Ikon
          </label>
          <input id="icon" name="icon" className="input text-center" maxLength={8} placeholder="🍜" defaultValue={v?.icon ?? initial.icon} />
        </div>
        <div>
          <label className="label" htmlFor="name">
            Nama kategori
          </label>
          <input id="name" name="name" className="input" required maxLength={60} defaultValue={v?.name ?? initial.name} />
          {fe.name && <p className="mt-1 text-sm text-red-600">{fe.name}</p>}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="kind">
            Jenis
          </label>
          <select id="kind" name="kind" className="input" defaultValue={v?.kind ?? initial.kind}>
            <option value="expense">Pengeluaran</option>
            <option value="income">Pemasukan</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="parentId">
            Induk (opsional)
          </label>
          <select id="parentId" name="parentId" className="input" defaultValue={v?.parentId ?? initial.parentId}>
            <option value="">— Tidak ada —</option>
            {parents
              .filter((p) => p.id !== initial.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.kind === "income" ? "↑ " : "↓ "}
                  {p.name}
                </option>
              ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="keywords">
          Kata kunci (untuk saran otomatis)
        </label>
        <input id="keywords" name="keywords" className="input" placeholder="mis. kopi, starbucks" defaultValue={v?.keywords ?? initial.keywords} />
        <p className="mt-1 text-xs text-slate-500">Jika keterangan atau nama toko mengandung kata ini, kategori ini akan disarankan.</p>
      </div>
      <div>
        <label className="label" htmlFor="color">
          Warna
        </label>
        <input id="color" name="color" type="color" className="h-10 w-16 rounded border border-slate-300" defaultValue={v?.color ?? (initial.color || "#10b981")} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Simpan kategori"}
      </Button>
    </form>
  );
}
