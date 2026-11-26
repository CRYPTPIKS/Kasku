"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { buttonClass } from "./button";

/**
 * Tombol aksi yang selalu meminta konfirmasi lewat dialog sebelum menjalankan
 * server action (mis. hapus). Tidak memakai window.confirm agar tampilan konsisten.
 */
export function ConfirmButton({
  action,
  label,
  title,
  description,
  confirmLabel = "Ya, lanjutkan",
  variant = "danger",
  size = "sm",
  redirectTo,
}: {
  action: () => Promise<unknown>;
  label: string;
  title: string;
  description?: string;
  confirmLabel?: string;
  variant?: "danger" | "secondary" | "primary" | "ghost";
  size?: "sm" | "md";
  /** Halaman tujuan setelah berhasil. */
  redirectTo?: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button type="button" className={buttonClass(variant, size)} onClick={() => dialogRef.current?.showModal()}>
        {label}
      </button>
      <dialog
        ref={dialogRef}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl p-0 shadow-xl backdrop:bg-slate-900/40"
        onClose={() => setError(null)}
      >
        <div className="p-5">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          {description && <p className="mt-2 text-sm text-slate-600">{description}</p>}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className={buttonClass("secondary", "md")} onClick={() => dialogRef.current?.close()} disabled={pending}>
              Batal
            </button>
            <button
              type="button"
              className={buttonClass(variant === "danger" ? "danger" : "primary", "md")}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  try {
                    const res = (await action()) as { error?: string } | undefined;
                    if (res && typeof res === "object" && "error" in res && res.error) {
                      setError(res.error);
                      return;
                    }
                    dialogRef.current?.close();
                    if (redirectTo) router.push(redirectTo);
                    else router.refresh();
                  } catch {
                    setError("Gagal memproses. Coba lagi.");
                  }
                })
              }
            >
              {pending ? "Memproses…" : confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
