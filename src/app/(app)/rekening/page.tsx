import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/current";
import { listAccounts, summarizeBalances } from "@/server/services/accounts";
import { LinkButton } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Money } from "@/components/ui/money";

export const metadata: Metadata = { title: "Rekening" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ arsip?: string }> }) {
  const { ctx } = await requireUser();
  const sp = await searchParams;
  const accounts = await listAccounts(ctx, { includeArchived: sp.arsip === "1" });
  const totals = summarizeBalances(accounts);
  const groups = new Map<string, typeof accounts>();
  for (const a of accounts) groups.set(a.kindLabel, [...(groups.get(a.kindLabel) ?? []), a]);

  return (
    <div>
      <PageHeader title="Rekening" description="Saldo dihitung dari saldo awal + transaksi terkonfirmasi" actions={<LinkButton href="/rekening/baru">+ Rekening</LinkButton>} />
      <div className="mb-5 grid grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-xs text-slate-500">Aset</p>
          <p className="font-bold">
            <Money value={totals.assets} />
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500">Kewajiban</p>
          <p className="font-bold text-red-600">
            <Money value={totals.liabilities} tone="plain" />
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500">Bersih</p>
          <p className="font-bold">
            <Money value={totals.net} />
          </p>
        </Card>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <EmptyState icon="💳" title="Belum ada rekening" description="Tambahkan uang tunai, rekening bank, e-wallet, atau kartu kredit." action={<LinkButton href="/rekening/baru">Tambah rekening</LinkButton>} />
        </Card>
      ) : (
        <div className="space-y-4">
          {[...groups.entries()].map(([label, list]) => (
            <Card key={label}>
              <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-600 sm:px-5">{label}</h2>
              <ul className="divide-y divide-slate-100">
                {list.map((a) => (
                  <li key={a.id}>
                    <Link href={`/rekening/${a.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate font-medium">
                          {a.name}
                          {a.isArchived && <Badge>Diarsipkan</Badge>}
                        </p>
                        <p className="text-xs text-slate-500">
                          Saldo awal <Money value={a.initialBalance} tone="plain" />
                          {a.accountNumberLast4 ? ` · •••• ${a.accountNumberLast4}` : ""}
                        </p>
                      </div>
                      <Money value={a.balance} className="font-semibold" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-4 text-center text-sm">
        <Link href={sp.arsip === "1" ? "/rekening" : "/rekening?arsip=1"} className="text-slate-500 underline">
          {sp.arsip === "1" ? "Sembunyikan rekening diarsipkan" : "Tampilkan rekening diarsipkan"}
        </Link>
      </p>
    </div>
  );
}
