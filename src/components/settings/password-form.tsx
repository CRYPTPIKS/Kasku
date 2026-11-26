"use client";

import { useActionState } from "react";
import { changePasswordAction } from "@/app/(app)/pengaturan/actions";
import { Alert } from "../ui/card";
import { Button } from "../ui/button";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, {});
  return (
    <form action={action} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      {state.message && <Alert tone="green">{state.message}</Alert>}
      <div>
        <label className="label" htmlFor="current">
          Kata sandi saat ini
        </label>
        <input id="current" name="current" type="password" autoComplete="current-password" className="input" required />
      </div>
      <div>
        <label className="label" htmlFor="next">
          Kata sandi baru (min. 10 karakter)
        </label>
        <input id="next" name="next" type="password" autoComplete="new-password" minLength={10} className="input" required />
      </div>
      <div>
        <label className="label" htmlFor="confirm">
          Ulangi kata sandi baru
        </label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} className="input" required />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Ganti kata sandi"}
      </Button>
    </form>
  );
}
