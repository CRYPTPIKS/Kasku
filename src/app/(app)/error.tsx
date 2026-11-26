"use client";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card mx-auto max-w-md p-6 text-center">
      <p className="text-3xl">⚠️</p>
      <h2 className="mt-2 font-semibold">Terjadi kesalahan</h2>
      <p className="mt-1 text-sm text-slate-600">Halaman gagal dimuat. Data kamu aman. Silakan coba lagi.</p>
      <button onClick={reset} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
        Coba lagi
      </button>
    </div>
  );
}
