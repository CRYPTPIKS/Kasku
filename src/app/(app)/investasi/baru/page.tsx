import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/current";
import { ASSET_CLASS_LABELS } from "@/server/services/investments";
import { ActionForm } from "@/components/ui/action-form";
import { Card, PageHeader } from "@/components/ui/card";
import { createAssetAction } from "../actions";

export const metadata: Metadata = { title: "Aset baru" };

export default async function NewAssetPage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader
        title="Aset investasi baru"
        actions={
          <Link href="/investasi" className="text-sm font-medium text-brand-700">
            ← Kembali
          </Link>
        }
      />
      <Card className="p-4 sm:p-6">
        <ActionForm action={createAssetAction} submitLabel="Simpan aset" className="space-y-4">
          <div>
            <label className="label" htmlFor="assetClass">
              Jenis
            </label>
            <select id="assetClass" name="assetClass" className="input" required defaultValue="">
              <option value="">— Pilih jenis —</option>
              {Object.entries(ASSET_CLASS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <fieldset>
            <legend className="label">Cara mencatat</legend>
            <div className="space-y-2">
              <label className="flex cursor-pointer gap-3 rounded-lg border border-slate-200 p-3 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
                <input type="radio" name="valuationMode" value="units" defaultChecked className="mt-0.5" />
                <span>
                  <span className="font-medium">Unit × harga</span>
                  <span className="block text-xs text-slate-500">Saham, emas, kripto, reksa dana yang kamu catat unit &amp; NAB-nya.</span>
                </span>
              </label>
              <label className="flex cursor-pointer gap-3 rounded-lg border border-slate-200 p-3 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
                <input type="radio" name="valuationMode" value="value" className="mt-0.5" />
                <span>
                  <span className="font-medium">Nilai total (robo-advisor)</span>
                  <span className="block text-xs text-slate-500">
                    Mis. portofolio robo Bibit. Cukup catat nominal setor/tarik, lalu sesekali isi total nilai yang tampil di aplikasinya.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="name">
                Nama
              </label>
              <input id="name" name="name" className="input" required maxLength={80} placeholder="mis. Bank Central Asia / Bibit Robo" />
            </div>
            <div>
              <label className="label" htmlFor="symbol">
                Kode (opsional)
              </label>
              <input id="symbol" name="symbol" className="input" maxLength={20} placeholder="mis. BBCA, BTC" />
            </div>
            <div>
              <label className="label" htmlFor="unitLabel">
                Satuan
              </label>
              <input id="unitLabel" name="unitLabel" className="input" maxLength={20} placeholder="lembar / gram / unit / koin" />
            </div>
            <div>
              <label className="label" htmlFor="unitsPerLot">
                Isi per lot (saham)
              </label>
              <input id="unitsPerLot" name="unitsPerLot" type="number" min={1} className="input" placeholder="100 untuk saham IDX" />
            </div>
          </div>
          <p className="text-xs text-slate-500">Satuan dan isi per lot hanya dipakai untuk mode unit × harga.</p>
        </ActionForm>
      </Card>
    </div>
  );
}
