"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: "🏠" },
  { href: "/transaksi", label: "Transaksi", icon: "🧾" },
  { href: "/rekening", label: "Rekening", icon: "💳" },
  { href: "/kategori", label: "Kategori", icon: "🏷️" },
  { href: "/anggaran", label: "Anggaran", icon: "🎯" },
  { href: "/hutang", label: "Hutang & Piutang", icon: "🤝" },
  { href: "/investasi", label: "Investasi", icon: "📈" },
  { href: "/laporan", label: "Laporan", icon: "📊" },
  { href: "/usaha", label: "Usaha", icon: "🏪" },
  { href: "/pengaturan", label: "Pengaturan", icon: "⚙️" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function SideNav({ draftCount }: { draftCount: number }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-1">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
            isActive(pathname, item.href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <span aria-hidden>{item.icon}</span>
          <span className="flex-1">{item.label}</span>
          {item.href === "/transaksi" && draftCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2 text-xs font-semibold text-amber-800">{draftCount}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const main = [
    { href: "/", label: "Beranda", icon: "🏠" },
    { href: "/transaksi", label: "Transaksi", icon: "🧾" },
    { href: "/transaksi/baru", label: "Catat", icon: "＋", primary: true },
    { href: "/laporan", label: "Laporan", icon: "📊" },
  ];
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 pb-24" onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-3 gap-2">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex flex-col items-center gap-1 rounded-xl p-3 text-center text-xs font-medium ${
                    isActive(pathname, item.href) ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <span className="text-xl" aria-hidden>
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="grid grid-cols-5">
          {main.map((item) =>
            item.primary ? (
              <Link key={item.href} href={item.href} className="flex flex-col items-center justify-center py-1.5" onClick={() => setOpen(false)}>
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-600 text-2xl text-white shadow-md">＋</span>
                <span className="sr-only">{item.label}</span>
              </Link>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                  isActive(pathname, item.href) && !open ? "text-brand-700" : "text-slate-500"
                }`}
              >
                <span className="text-lg" aria-hidden>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            ),
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${open ? "text-brand-700" : "text-slate-500"}`}
            aria-expanded={open}
          >
            <span className="text-lg" aria-hidden>
              ☰
            </span>
            Menu
          </button>
        </div>
      </nav>
    </>
  );
}
