"use client";

import { useState } from "react";
import type { ActionState } from "@/server/action-result";
import { ActionForm } from "../ui/action-form";

export function TradeForm({
  action,
  accounts,
  unitLabel,
  unitsPerLot,
  today,
  nominalMode,
  tradeLabels = { buy: "Beli", sell: "Jual" },
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  accounts: { id: string; name: string }[];
  unitLabel: string;
  unitsPerLot: number | null;
  today: string;
  /** Aset tanpa unit (deposito dsb.): cukup isi nominal. */
  nominalMode: boolean;
  /** Label beli/jual, mis. Setor/Tarik untuk robo-advisor. */
  tradeLabels?: { buy: string; sell: string };
}) {
  const [kind, setKind] = useState<"buy" | "sell" | "dividend" | "interest">("buy");
  const trade = kind === "buy" || kind === "sell";
  return (
    <ActionForm action={action} submitLabel="Catat" resetOnSuccess>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm font-medium sm:grid-cols-4" role="radiogroup" aria-label="Jenis">
        {(
          [
            ["buy", tradeLabels.buy],
            ["sell", tradeLabels.sell],
            ["dividend", "Dividen"],
            ["interest", "Bunga/kupon"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className={`cursor-pointer rounded-md px-3 py-1.5 text-center ${kind === k ? "bg-white shadow-sm" : "text-slate-600"}`}>
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
            {label}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {trade && !nominalMode && (
          <>
            <div>
              <label className="label" htmlFor="units">
                Jumlah
              </label>
              <div className="flex gap-2">
                <input id="units" name="units" className="input" inputMode="decimal" placeholder="mis. 2" />
                {unitsPerLot ? (
                  <select name="unitMode" className="input w-28" defaultValue="lot" aria-label="Satuan">
                    <option value="lot">lot</option>
                    <option value="unit">{unitLabel}</option>
                  </select>
                ) : (
                  <span className="self-center text-sm text-slate-500">{unitLabel}</span>
                )}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="pricePerUnit">
                Harga per {unitLabel}
              </label>
              <input id="pricePerUnit" name="pricePerUnit" className="input" inputMode="decimal" placeholder="mis. 9.500" />
            </div>
            <div>
              <label className="label" htmlFor="fee">
                Biaya/fee (opsional)
              </label>
              <input id="fee" name="fee" className="input" inputMode="decimal" placeholder="0" />
            </div>
          </>
        )}
        <div>
          <label className="label" htmlFor="totalAmount">
            {trade ? (nominalMode ? "Nominal" : "Total (opsional, dihitung otomatis)") : "Nominal diterima"}
          </label>
          <input id="totalAmount" name="totalAmount" className="input" inputMode="decimal" placeholder="mis. 1,5jt" required={!trade || nominalMode} />
        </div>
        <div>
          <label className="label" htmlFor="occurredAt">
            Tanggal
          </label>
          <input id="occurredAt" name="occurredAt" type="date" className="input" defaultValue={today} required />
        </div>
        <div>
          <label className="label" htmlFor="accountId">
            {kind === "buy" ? "Dibayar dari rekening" : "Masuk ke rekening"}
          </label>
          <select id="accountId" name="accountId" className="input" defaultValue="">
            <option value="">Tanpa rekening (hanya catat)</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </ActionForm>
  );
}
