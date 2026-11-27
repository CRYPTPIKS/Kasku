import type { Metadata } from "next";
import Link from "next/link";
import { currentMonthRange, formatMonth } from "@/lib/dates";
import { requireUser } from "@/server/auth/current";
import { canWrite } from "@/server/context";
import { BUSINESS_TEMPLATES, businessReport, listBusinesses } from "@/server/services/businesses";
import { ActionForm } from "@/components/ui/action-form";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Money } from "@/components/ui/money";
import { createBusinessAction, deleteBusinessAction, setupTemplatesAction } from "./actions";

export const metadata: Metadata = { title: "Usaha" };

const monthName = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return formatMonth(y!, m!);
};

export default async function BusinessPage() {
  const { ctx } = await requireUser();
  const cur = currentMonthRange();
  const [reports, businesses] = await Promise.all([businessReport(ctx, cur.year, cur.month, 6), listBusinesses(ctx)]);
  const writable = canWrite(ctx);
  const missingTemplates = BUSINESS_TEMPLATES.filter((t) => !businesses.some((b) => b.name.toLowerCase() === t.name.toLowerCase()));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Usaha"
        description="Laba per usaha, terpisah dari keuangan pribadi. Yang masuk laporan pribadi hanya uang yang dipindah antara usaha dan rekening pribadi."
      />

      {reports.length === 0 && (
        <EmptyState
          icon="🏪"
          title="Belum ada usaha"
          description="Buat usaha, lalu tandai rekening (mis. BRI) atau kategorinya sebagai milik usaha itu."
        />
      )}

      {reports.map((r) => {
        const b = businesses.find((x) => x.id === r.id);
        const now = r.months.at(-1)!;
        return (
          <Card key={r.id}>
            <CardHeader
              title={`${r.icon ? `${r.icon} ` : ""}${r.name}`}
              subtitle={
                [
                  b?.accounts.length ? `Rekening: ${b.accounts.map((a) => a.name).join(", ")}` : "",
                  b?.categories.length ? `Kategori: ${b.categories.map((c) => c.name).join(", ")}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || "Belum ada rekening atau kategori yang ditandai"
              }
            />
            <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-4 sm:px-5">
              <Mini label={`Pendapatan ${monthName(now.month)}`} value={<Money value={now.income} tone="plain" />} />
              <Mini label="Biaya" value={<Money value={now.expense} tone="plain" />} />
              <Mini label="Laba kira-kira" value={<Money value={now.profit} />} />
              {r.accounts.length > 0 ? (
                <Mini label="Saldo rekening usaha" value={<Money value={r.balance} tone="plain" />} />
              ) : (
                <Mini label="Diambil ke pribadi" value={<Money value={now.withdrawn} tone="plain" />} />
              )}
            </div>
            <div className="overflow-x-auto border-t border-slate-100">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium sm:px-5">Bulan</th>
                    <th className="px-4 py-2 text-right font-medium">Pendapatan</th>
                    <th className="px-4 py-2 text-right font-medium">Biaya</th>
                    <th className="px-4 py-2 text-right font-medium">Laba</th>
                    {r.accounts.length > 0 && <th className="px-4 py-2 text-right font-medium">Diambil</th>}
                    {r.accounts.length > 0 && <th className="px-4 py-2 text-right font-medium sm:px-5">Modal masuk</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...r.months].reverse().map((m) => (
                    <tr key={m.month}>
                      <td className="px-4 py-2 sm:px-5">{monthName(m.month)}</td>
                      <td className="px-4 py-2 text-right text-emerald-700">
                        <Money value={m.income} tone="plain" />
                      </td>
                      <td className="px-4 py-2 text-right text-red-700">
                        <Money value={m.expense} tone="plain" />
                      </td>
                      <td className="px-4 py-2 text-right font-medium">
                        <Money value={m.profit} />
                      </td>
                      {r.accounts.length > 0 && (
                        <td className="px-4 py-2 text-right">
                          <Money value={m.withdrawn} tone="plain" />
                        </td>
                      )}
                      {r.accounts.length > 0 && (
                        <td className="px-4 py-2 text-right sm:px-5">
                          <Money value={m.injected} tone="plain" />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-3 text-xs text-slate-500 sm:px-5">
              Laba dihitung dari pendapatan dikurangi biaya pada bulan yang sama, jadi bisa naik-turun kalau stok dibeli di akhir bulan. Lihat rata-ratanya beberapa
              bulan.
            </p>
            {writable && (
              <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
                <ConfirmButton
                  action={deleteBusinessAction.bind(null, r.id)}
                  label="Hapus usaha"
                  title={`Hapus ${r.name}?`}
                  description="Rekening, kategori, dan transaksinya tetap ada, tapi kembali dihitung sebagai keuangan pribadi."
                  confirmLabel="Hapus usaha"
                  variant="ghost"
                />
              </div>
            )}
          </Card>
        );
      })}

      {writable && (
        <div className="grid gap-5 sm:grid-cols-2">
          {missingTemplates.length > 0 && (
            <Card className="p-4 sm:p-5">
              <h2 className="font-semibold">Siapkan otomatis</h2>
              <p className="mt-1 text-sm text-slate-600">
                Membuat {missingTemplates.map((t) => `"${t.name}"`).join(" dan ")} beserta kategorinya (
                {missingTemplates.flatMap((t) => t.categories.map((c) => c.name)).join(", ")}). Kategori yang sudah ada dengan nama sama dipakai ulang, tidak dobel.
              </p>
              <div className="mt-3">
                <ConfirmButton
                  action={setupTemplatesAction}
                  label="Siapkan usaha"
                  title="Siapkan usaha otomatis?"
                  description="Setelah ini, buka rekening BRI lalu pilih “Milik usaha: Usaha Gas”."
                  confirmLabel="Siapkan"
                  variant="primary"
                />
              </div>
            </Card>
          )}
          <Card className="p-4 sm:p-5">
            <h2 className="mb-3 font-semibold">Tambah usaha</h2>
            <ActionForm action={createBusinessAction} submitLabel="Tambah" resetOnSuccess>
              <div className="grid grid-cols-[1fr_5rem] gap-3">
                <div>
                  <label className="label" htmlFor="bname">
                    Nama
                  </label>
                  <input id="bname" name="name" className="input" required maxLength={60} placeholder="mis. Warung" />
                </div>
                <div>
                  <label className="label" htmlFor="bicon">
                    Ikon
                  </label>
                  <input id="bicon" name="icon" className="input" maxLength={8} placeholder="🏪" />
                </div>
              </div>
            </ActionForm>
          </Card>
        </div>
      )}

      <Card className="p-4 text-sm text-slate-600 sm:p-5">
        <h2 className="mb-2 font-semibold text-slate-800">Cara hitungnya</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Transaksi di <b>rekening usaha</b> (mis. setor tunai & tebus gas di BRI) hanya muncul di sini, tidak di laporan pribadi.</li>
          <li>
            Transfer <b>rekening usaha → rekening pribadi</b> = pemasukan pribadi “Penghasilan …”. Sebaliknya = pengeluaran pribadi “Modal …”.
          </li>
          <li>
            Transaksi berkategori usaha di rekening pribadi (mis. langganan CapCut dari BCA) dijumlah per bulan; di laporan pribadi hanya muncul laba bersihnya
            sebagai satu baris.
          </li>
        </ul>
        <p className="mt-2">
          Atur di <Link href="/rekening">Rekening</Link> atau <Link href="/kategori">Kategori</Link> → ubah → “Milik usaha”.
        </p>
      </Card>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
