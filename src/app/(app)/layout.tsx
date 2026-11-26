import Link from "next/link";
import { requireUser } from "@/server/auth/current";
import { countDrafts } from "@/server/services/transactions";
import { BottomNav, SideNav } from "@/components/layout/nav";
import { logoutAction } from "../login/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ctx } = await requireUser();
  const draftCount = await countDrafts(ctx);
  return (
    <div className="lg:flex">
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white lg:p-4">
        <Link href="/" className="mb-6 flex items-center gap-2 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-sm font-bold text-white">Rp</span>
          <span className="text-lg font-bold">Kasku</span>
        </Link>
        <SideNav draftCount={draftCount} />
        <div className="mt-auto border-t border-slate-100 pt-4">
          <p className="truncate px-2 text-sm font-medium text-slate-800">{user.name}</p>
          <p className="truncate px-2 text-xs text-slate-500">{user.email}</p>
          <form action={logoutAction} className="mt-2">
            <button className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-100">Keluar</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">Rp</span>
            <span className="font-bold">Kasku</span>
          </Link>
          {draftCount > 0 && (
            <Link href="/transaksi?status=draft" className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              {draftCount} draf
            </Link>
          )}
        </header>
        <main className="mx-auto max-w-6xl px-4 py-5 pb-28 sm:px-6 lg:px-8 lg:py-8 lg:pb-10">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
