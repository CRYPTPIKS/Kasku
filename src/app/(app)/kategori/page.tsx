import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/current";
import { listCategories } from "@/server/services/categories";
import { CategoryForm } from "@/components/categories/category-form";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "Kategori" };

export default async function CategoriesPage({ searchParams }: { searchParams: Promise<{ saved?: string; arsip?: string }> }) {
  const { ctx } = await requireUser();
  const sp = await searchParams;
  const categories = await listCategories(ctx, { includeArchived: sp.arsip === "1" });
  const parents = categories.filter((c) => !c.parentId && !c.isArchived).map((c) => ({ id: c.id, name: c.name, kind: c.kind }));

  const section = (kind: "expense" | "income", title: string) => {
    const list = categories.filter((c) => c.kind === kind);
    const roots = list.filter((c) => !c.parentId);
    return (
      <Card>
        <CardHeader title={title} subtitle={`${list.length} kategori`} />
        {list.length === 0 ? (
          <EmptyState icon="🏷️" title="Belum ada kategori" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {roots.map((c) => (
              <li key={c.id}>
                <CategoryLink c={c} />
                {list
                  .filter((x) => x.parentId === c.id)
                  .map((child) => (
                    <CategoryLink key={child.id} c={child} child />
                  ))}
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  };

  return (
    <div>
      <PageHeader title="Kategori" description="Atur kategori pemasukan dan pengeluaran" />
      {sp.saved && (
        <div className="mb-4">
          <Alert tone="green">Kategori tersimpan.</Alert>
        </div>
      )}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {section("expense", "Pengeluaran")}
          {section("income", "Pemasukan")}
          <p className="text-center text-sm">
            <Link href={sp.arsip === "1" ? "/kategori" : "/kategori?arsip=1"} className="text-slate-500 underline">
              {sp.arsip === "1" ? "Sembunyikan kategori diarsipkan" : "Tampilkan kategori diarsipkan"}
            </Link>
          </p>
        </div>
        <Card className="h-fit p-4 sm:p-5">
          <h2 className="mb-3 font-semibold">Tambah kategori</h2>
          <CategoryForm parents={parents} initial={{ name: "", kind: "expense", parentId: "", icon: "", color: "", keywords: "" }} />
        </Card>
      </div>
    </div>
  );
}

function CategoryLink({
  c,
  child,
}: {
  c: { id: string; name: string; icon: string | null; color: string | null; isArchived: boolean; _count: { transactions: number } };
  child?: boolean;
}) {
  return (
    <Link href={`/kategori/${c.id}`} className={`flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 sm:px-5 ${child ? "pl-12 sm:pl-14" : ""}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-full text-base" style={{ backgroundColor: `${c.color ?? "#94a3b8"}22` }} aria-hidden>
        {c.icon ?? "•"}
      </span>
      <span className="flex-1 truncate text-sm font-medium">{c.name}</span>
      {c.isArchived && <Badge>Diarsipkan</Badge>}
      <span className="text-xs text-slate-500">{c._count.transactions} transaksi</span>
    </Link>
  );
}
