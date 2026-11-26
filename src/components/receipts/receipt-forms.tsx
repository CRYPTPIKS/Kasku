"use client";

import { useActionState, useRef } from "react";
import { fillReceiptAmountAction, uploadReceiptAction } from "@/app/(app)/transaksi/struk/actions";
import { Alert } from "../ui/card";
import { Button } from "../ui/button";

export function ReceiptUploadForm() {
  const [state, action, pending] = useActionState(uploadReceiptAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={async (fd) => {
        await action(fd);
        formRef.current?.reset();
      }}
      className="space-y-3"
    >
      {state.error && <Alert>{state.error}</Alert>}
      {state.message && <Alert tone="green">{state.message}</Alert>}
      <div>
        <label className="label" htmlFor="file">
          Foto struk (JPG, PNG, atau WEBP, maks. 10 MB)
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          required
          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Mengunggah…" : "Unggah & baca struk"}
      </Button>
    </form>
  );
}

export function ReceiptManualForm({ receiptId, merchant }: { receiptId: string; merchant?: string | null }) {
  const [state, action, pending] = useActionState(fillReceiptAmountAction.bind(null, receiptId), {});
  return (
    <form action={action} className="mt-3 space-y-2">
      {state.error && <Alert>{state.error}</Alert>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input name="amount" inputMode="decimal" placeholder="Total, mis. 45.000" className="input" aria-label="Total pembayaran" required />
        <input name="merchant" defaultValue={merchant ?? ""} placeholder="Nama toko (opsional)" className="input" aria-label="Nama toko" />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Menyimpan…" : "Buat draf"}
        </Button>
      </div>
    </form>
  );
}
