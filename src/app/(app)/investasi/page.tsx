import type { Metadata } from "next";
import { requireUser } from "@/server/auth/current";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "Investasi" };

export default async function Page() {
  await requireUser();
  return (
    <div>
      <PageHeader title="Investasi" />
      <Card>
        <EmptyState icon="📈" title="Segera hadir" description="Catat saham, reksa dana, emas, kripto, deposito, dan obligasi beserta untung/ruginya." />
      </Card>
    </div>
  );
}
