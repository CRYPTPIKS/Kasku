import type { Metadata } from "next";
import { requireUser } from "@/server/auth/current";
import { AccountForm } from "@/components/accounts/account-form";
import { Card, PageHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "Rekening baru" };

export default async function NewAccountPage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Rekening baru" />
      <Card className="p-4 sm:p-6">
        <AccountForm initial={{ name: "", kind: "bank", institution: "", accountNumberLast4: "", initialBalance: "0", creditLimit: "", aliases: "" }} />
      </Card>
    </div>
  );
}
