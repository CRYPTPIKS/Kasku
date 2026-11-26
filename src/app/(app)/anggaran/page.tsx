import type { Metadata } from "next";
import { requireUser } from "@/server/auth/current";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "Anggaran" };

export default async function Page() {
  await requireUser();
  return (
    <div>
      <PageHeader title="Anggaran" />
      <Card>
        <EmptyState icon="🎯" title="Segera hadir" description="Buat batas belanja bulanan per kategori, lengkap dengan peringatan saat pemakaian mencapai 80% dan 100%." />
      </Card>
    </div>
  );
}
