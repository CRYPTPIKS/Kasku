import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTime } from "@/lib/dates";
import { requireUser } from "@/server/auth/current";
import { canWrite } from "@/server/context";
import { listReceipts } from "@/server/receipts/service";
import { ReceiptManualForm, ReceiptUploadForm } from "@/components/receipts/receipt-forms";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Money } from "@/components/ui/money";
import { retryReceiptAction } from "./actions";

export const metadata: Metadata = { title: "Struk" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "slate" | "green" | "red" | "amber" | "blue" }> = {
  uploaded: { label: "Diunggah", tone: "slate" },
  queued: { label: "Menunggu", tone: "blue" },
  processing: { label: "Dibaca…", tone: "blue" },
  extracted: { label: "Jadi draf", tone: "amber" },
  confirmed: { label: "Tersimpan", tone: "green" },
  failed: { label: "Gagal dibaca", tone: "red" },
};

export default async function ReceiptsPage() {
  const { ctx } = await requireUser();
  const receipts = await listReceipts(ctx);
  const writable = canWrite(ctx);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Struk"
        description="Foto struk dibaca otomatis menjadi draf transaksi. Kirim juga bisa lewat bot Telegram."
        actions={
          <Link href="/transaksi" className="text-sm font-medium text-brand-700">
            ← Transaksi
          </Link>
        }
      />

      {writable && (
        <Card className="p-4 sm:p-5">
          <ReceiptUploadForm />
        </Card>
      )}

      <Card>
        <CardHeader title="Riwayat struk" subtitle="Foto disimpan privat dan hanya bisa dilihat setelah masuk" />
        {receipts.length === 0 ? (
          <EmptyState icon="🧾" title="Belum ada struk" description="Unggah foto struk di atas atau kirim foto ke bot Telegram." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {receipts.map((r) => {
              const st = STATUS[r.status] ?? STATUS.uploaded!;
              const ex = r.extractions[0];
              const t = r.transaction && !r.transaction.deletedAt ? r.transaction : null;
              return (
                <li key={r.id} className="flex gap-3 px-4 py-4 sm:px-5">
                  <a href={`/api/receipts/${r.id}/image`} target="_blank" rel="noopener" className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element -- gambar privat, tidak lewat optimizer */}
                    <img
                      src={`/api/receipts/${r.id}/image`}
                      alt="Foto struk"
                      loading="lazy"
                      className="h-20 w-16 rounded-md border border-slate-200 bg-slate-50 object-cover"
                    />
                  </a>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={t?.status === "confirmed" ? "green" : st.tone}>{t?.status === "confirmed" ? "Tersimpan" : st.label}</Badge>
                      <span className="text-xs text-slate-500">{formatDateTime(r.createdAt)}</span>
                      {r.telegramChatId && <span className="text-xs text-slate-500">· via Telegram</span>}
                    </div>
                    <p className="mt-1 truncate font-medium">
                      {t?.description || ex?.merchant || "Struk"}
                      {t && (
                        <>
                          {" · "}
                          <Money value={Number(t.amount)} />
                        </>
                      )}
                    </p>
                    {t && (
                      <Link href={`/transaksi/${t.id}`} className="text-sm font-medium text-brand-700">
                        {t.status === "draft" ? "Periksa & konfirmasi draf →" : "Lihat transaksi →"}
                      </Link>
                    )}
                    {r.status === "failed" && !r.transactionId && (
                      <div>
                        <p className="text-sm text-red-700">
                          {r.errorMessage === "Total pembayaran tidak terbaca." ? "Total pembayaran tidak terbaca." : "Struk belum bisa dibaca."} Isi
                          totalnya sendiri atau coba baca ulang.
                        </p>
                        {writable && (
                          <>
                            <ReceiptManualForm receiptId={r.id} merchant={ex?.merchant} />
                            <div className="mt-2">
                              <ConfirmButton
                                action={retryReceiptAction.bind(null, r.id)}
                                label="Baca ulang"
                                title="Baca ulang struk ini?"
                                description="Struk akan diproses lagi oleh pembaca OCR."
                                confirmLabel="Baca ulang"
                                variant="secondary"
                              />
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
