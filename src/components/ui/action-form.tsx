"use client";

import { useActionState, useEffect, useRef, useTransition, type ReactNode } from "react";
import type { ActionState } from "@/server/action-result";
import { Alert } from "./card";
import { Button } from "./button";

/**
 * Form server action generik. Isian tidak dikosongkan saat ada error (tidak
 * memakai reset otomatis React), dan bisa dikosongkan setelah berhasil.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Menyimpan…",
  className = "space-y-3",
  resetOnSuccess = false,
  submitVariant = "primary",
  submitSize = "md",
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  resetOnSuccess?: boolean;
  submitVariant?: "primary" | "secondary";
  submitSize?: "sm" | "md";
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  const fieldErrors = Object.values(state.fieldErrors ?? {});
  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      {state.error && (
        <Alert>
          {state.error}
          {fieldErrors.length > 0 && fieldErrors.join(" ") !== state.error && (
            <span className="mt-1 block text-xs">{[...new Set(fieldErrors)].join(" · ")}</span>
          )}
        </Alert>
      )}
      {state.message && <Alert tone="green">{state.message}</Alert>}
      {children}
      <div>
        <Button type="submit" disabled={pending} variant={submitVariant} size={submitSize}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
