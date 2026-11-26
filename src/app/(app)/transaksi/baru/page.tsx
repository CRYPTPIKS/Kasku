import type { Metadata } from "next";
import { toDateTimeInput } from "@/lib/dates";
import { requireUser } from "@/server/auth/current";
import { transactionFormOptions } from "@/server/services/form-options";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "Catat transaksi" };

export default async function NewTransactionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { ctx } = await requireUser();
  const sp = await searchParams;
  const { categories, accounts } = await transactionFormOptions(ctx);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Catat transaksi" />
      {sp.saved && (
        <div className="mb-4">
          <Alert tone="green">Transaksi tersimpan. Silakan catat berikutnya.</Alert>
        </div>
      )}
      <Card className="p-4 sm:p-6">
        {accounts.length === 0 ? (
          <EmptyState
            icon="💳"
            title="Tambahkan rekening dulu"
            description="Transaksi perlu dikaitkan ke rekening, misalnya Tunai atau BCA."
            action={<LinkButton href="/rekening/baru">Tambah rekening</LinkButton>}
          />
        ) : (
          <TransactionForm
            categories={categories}
            accounts={accounts}
            initial={{
              type: sp.type ?? "expense",
              amount: "",
              occurredAt: toDateTimeInput(new Date()),
              description: "",
              merchant: "",
              note: "",
              categoryId: "",
              fromAccountId: sp.account ?? "",
              toAccountId: "",
              tags: "",
              status: "confirmed",
              splits: [],
            }}
          />
        )}
      </Card>
    </div>
  );
}
