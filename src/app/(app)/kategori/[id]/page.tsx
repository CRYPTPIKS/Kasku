import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/current";
import { categoryUsage, listCategories } from "@/server/services/categories";
import { CategoryForm } from "@/components/categories/category-form";
import { LinkButton } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { archiveCategoryAction, deleteCategoryAction } from "../actions";

export const metadata: Metadata = { title: "Ubah kategori" };

export default async function EditCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireUser();
  const all = await listCategories(ctx, { includeArchived: true });
  const c = all.find((x) => x.id === id);
  if (!c) notFound();
  const usage = await categoryUsage(ctx, id);
  const blockReason = usage.transactions
    ? `⚠️ Kategori ini masih dipakai di ${usage.transactions} transaksi. Kalau dihapus, transaksi itu jadi tanpa kategori dan laporan bulan-bulan lalu berubah.\n\nPakai "Arsipkan kategori" supaya hilang dari pilihan tapi riwayatnya tetap aman.`
    : usage.children
      ? `⚠️ Kategori ini masih punya ${usage.children} subkategori. Hapus atau pindahkan subkategorinya dulu.`
      : null;
  const parents = all.filter((x) => !x.parentId && !x.isArchived).map((x) => ({ id: x.id, name: x.name, kind: x.kind }));
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader
        title={`${c.icon ?? ""} ${c.name}`.trim()}
        actions={
          <LinkButton href={`/transaksi?categoryId=${c.id}`} variant="secondary">
            Lihat transaksi
          </LinkButton>
        }
      />
      <Card className="p-4 sm:p-6">
        <CategoryForm
          parents={parents}
          initial={{
            id: c.id,
            name: c.name,
            kind: c.kind,
            parentId: c.parentId ?? "",
            icon: c.icon ?? "",
            color: c.color ?? "",
            keywords: c.keywords.join(", "),
          }}
        />
      </Card>
      <Card className="flex flex-wrap gap-2 p-4">
        <ConfirmButton
          action={deleteCategoryAction.bind(null, c.id)}
          label="Hapus kategori"
          title={blockReason ? "Kategori ini tidak bisa dihapus" : `Hapus ${c.name}?`}
          description={blockReason ?? `Kategori ini belum pernah dipakai, jadi akan dihapus permanen.${usage.budgets ? " Anggaran untuk kategori ini ikut dihapus." : ""}`}
          confirmLabel="Hapus permanen"
          blocked={!!blockReason}
          redirectTo="/kategori"
        />
        <ConfirmButton
          action={archiveCategoryAction.bind(null, c.id, !c.isArchived)}
          label={c.isArchived ? "Aktifkan kembali" : "Arsipkan kategori"}
          title={c.isArchived ? "Aktifkan kategori ini?" : "Arsipkan kategori ini?"}
          description={c.isArchived ? "Kategori akan muncul lagi di pilihan." : "Kategori disembunyikan dari pilihan. Transaksi lama tetap memakai kategori ini."}
          confirmLabel={c.isArchived ? "Aktifkan" : "Arsipkan"}
          variant={c.isArchived ? "primary" : "secondary"}
          redirectTo="/kategori"
        />
      </Card>
    </div>
  );
}
