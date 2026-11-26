"use client";

import { useState, type ReactNode } from "react";

/** Checkbox yang menampilkan isian tambahan saat dicentang. */
export function ToggleSection({ name, label, defaultChecked = false, children }: { name: string; label: string; defaultChecked?: boolean; children: ReactNode }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name={name} checked={on} onChange={(e) => setOn(e.target.checked)} className="h-4 w-4" />
        {label}
      </label>
      <div className={on ? "mt-3 space-y-3" : "hidden"}>{children}</div>
    </div>
  );
}
