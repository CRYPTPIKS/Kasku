import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/current";
import { isAdmin } from "@/server/context";
import { listAccounts } from "@/server/services/accounts";
import { listCategories } from "@/server/services/categories";
import { listTransactions } from "@/server/services/transactions";
import { transactionFilterSchema } from "@/server/validation/transaction";
import { TransactionRow } from "@/components/transactions/transaction-row";
import { LinkButton } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "Transaksi" };

type SP = Record<string, string | undefined>;

function qs(sp: SP, patch: SP) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { ctx } = await requireUser();
  const raw = await searchParams;
  const parsed = transactionFilterSchema.safeParse(raw);
  const filter = parsed.success ? parsed.data : transactionFilterSchema.parse({});
  const sp: SP = Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" && v));
  if (!isAdmin(ctx)) delete sp.deleted;

  const [result, categories, accounts] = await Promise.all([
    listTransactions(ctx, { ...filter, deleted: isAdmin(ctx) ? filter.deleted : undefined }),
    listCategories(ctx),
    listAccounts(ctx, { includeArchived: true }),
  ]);
  const hasFilter = Boolean(sp.q || sp.from || sp.to || sp.categoryId || sp.accountId || sp.tag || sp.status || sp.type || sp.deleted);

  return (
    <div>
      <PageHeader
        title="Transaksi"
        description={`${result.total.toLocaleString("id-ID")} transaksi`}
        actions={
          <>
            <a href={`/api/export/transaksi${qs(sp, { page: undefined })}`} className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Ekspor CSV
            </a>
            <Link href="/transaksi/struk" className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              🧾 Struk
            </Link>
            <LinkButton href="/transaksi/baru">+ Catat</LinkButton>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" method="get">
          <input name="q" defaultValue={sp.q} placeholder="Cari keterangan, toko, catatan…" className="input sm:col-span-2" aria-label="Cari" />
          <input name="from" type="date" defaultValue={sp.from} className="input" aria-label="Dari tanggal" />
          <input name="to" type="date" defaultValue={sp.to} className="input" aria-label="Sampai tanggal" />
          <select name="categoryId" defaultValue={sp.categoryId ?? ""} className="input" aria-label="Kategori">
            <option value="">Semua kategori</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.kind === "income" ? "↑ " : "↓ "}
                {c.name}
              </option>
            ))}
          </select>
          <select name="accountId" defaultValue={sp.accountId ?? ""} className="input" aria-label="Rekening">
            <option value="">Semua rekening</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={sp.status ?? ""} className="input" aria-label="Status">
            <option value="">Semua status</option>
            <option value="confirmed">Terkonfirmasi</option>
            <option value="draft">Draf</option>
          </select>
          <input name="tag" defaultValue={sp.tag} placeholder="Tag" className="input" aria-label="Tag" />
          {isAdmin(ctx) && (
            <select name="deleted" defaultValue={sp.deleted ?? ""} className="input" aria-label="Transaksi terhapus">
              <option value="">Sembunyikan yang dihapus</option>
              <option value="only">Hanya yang dihapus</option>
              <option value="include">Tampilkan semua</option>
            </select>
          )}
          <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
            <button className="flex-1 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900">Terapkan</button>
            {hasFilter && (
              <Link href="/transaksi" className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
                Reset
              </Link>
            )}
          </div>
        </form>
      </Card>

      <Card>
        {result.items.length === 0 ? (
          hasFilter ? (
            <EmptyState icon="🔍" title="Tidak ada transaksi yang cocok" description="Coba ubah atau reset filter." />
          ) : (
            <EmptyState
              icon="🧾"
              title="Belum ada transaksi"
              description="Mulai catat pengeluaran dan pemasukanmu."
              action={<LinkButton href="/transaksi/baru">Catat transaksi</LinkButton>}
            />
          )
        ) : (
          <div className="divide-y divide-slate-100">
            {result.items.map((t) => (
              <TransactionRow key={t.id} t={t} />
            ))}
          </div>
        )}
      </Card>

      {result.pageCount > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Halaman">
          {result.page > 1 ? (
            <Link className="rounded-lg border border-slate-300 bg-white px-3 py-2" href={`/transaksi${qs(sp, { page: String(result.page - 1) })}`}>
              ← Sebelumnya
            </Link>
          ) : (
            <span />
          )}
          <span className="text-slate-600">
            Halaman {result.page} dari {result.pageCount}
          </span>
          {result.page < result.pageCount ? (
            <Link className="rounded-lg border border-slate-300 bg-white px-3 py-2" href={`/transaksi${qs(sp, { page: String(result.page + 1) })}`}>
              Berikutnya →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
