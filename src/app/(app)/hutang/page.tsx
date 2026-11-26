import type { Metadata } from "next";
import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { requireUser } from "@/server/auth/current";
import { canWrite } from "@/server/context";
import { debtSummary, DEBT_STATUS_LABELS, listDebts, nextInstallment } from "@/server/services/debts";
import { LinkButton } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { ProgressBar } from "@/components/ui/progress";

export const metadata: Metadata = { title: "Hutang & Piutang" };

const TABS = [
  { key: "hutang", label: "Hutang", direction: "payable" as const },
  { key: "piutang", label: "Piutang", direction: "receivable" as const },
  { key: "lunas", label: "Lunas", direction: undefined },
];

export default async function DebtsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { ctx } = await requireUser();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0]!;
  const [summary, debts] = await Promise.all([
    debtSummary(ctx),
    listDebts(ctx, { direction: tab.direction, includePaid: tab.key === "lunas" }),
  ]);
  const shown = tab.key === "lunas" ? debts.filter((d) => d.status === "paid") : debts;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Hutang & Piutang"
        description="Pinjaman, cicilan, dan pengingat jatuh tempo"
        actions={canWrite(ctx) ? <LinkButton href={`/hutang/baru${tab.key === "piutang" ? "?jenis=piutang" : ""}`}>+ Catat</LinkButton> : undefined}
      />

      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <p className="text-xs text-slate-500">Sisa hutang saya</p>
          <p className="text-lg font-semibold text-red-600">
            <Money value={summary.payable} tone="plain" />
          </p>
          <p className="text-xs text-slate-500">{summary.payableCount} berjalan</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500">Piutang (uang saya di orang lain)</p>
          <p className="text-lg font-semibold text-emerald-600">
            <Money value={summary.receivable} tone="plain" />
          </p>
          <p className="text-xs text-slate-500">{summary.receivableCount} berjalan</p>
        </Card>
      </div>

      <nav className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm font-medium" aria-label="Filter">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/hutang?tab=${t.key}`}
            className={`flex-1 rounded-md px-3 py-1.5 text-center ${t.key === tab.key ? "bg-white shadow-sm" : "text-slate-600"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <Card>
        {shown.length === 0 ? (
          <EmptyState
            icon="🤝"
            title={tab.key === "lunas" ? "Belum ada yang lunas" : `Tidak ada ${tab.label.toLowerCase()} berjalan`}
            description="Catat lewat tombol + Catat, atau kirim ke bot: pinjam 2jt dari Budi ke BCA"
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((d) => {
              const obligation = d.installments.length ? d.installments.reduce((a, i) => a + Number(i.amount), 0) : Number(d.principalAmount);
              const paid = obligation - Number(d.remainingAmount);
              const next = nextInstallment(d);
              const due = next?.dueDate ?? (d.status !== "paid" ? d.dueDate : null);
              return (
                <li key={d.id}>
                  <Link href={`/hutang/${d.id}`} className="block px-4 py-4 hover:bg-slate-50 sm:px-5">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {d.direction === "payable" ? "Ke " : "Dari "}
                          {d.counterparty}
                        </p>
                        <p className="text-xs text-slate-500">
                          {d.installments.length ? `${d.installments.filter((i) => i.paidAt).length}/${d.installments.length} cicilan` : "Tanpa cicilan"}
                          {due && ` · jatuh tempo ${formatDate(due)}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <Money value={Number(d.remainingAmount)} className="font-semibold" />
                        <div className="mt-0.5">
                          <Badge tone={d.status === "overdue" ? "red" : d.status === "paid" ? "green" : "slate"}>{DEBT_STATUS_LABELS[d.status]}</Badge>
                        </div>
                      </div>
                    </div>
                    <ProgressBar ratio={obligation > 0 ? paid / obligation : 0} tone="ok" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
