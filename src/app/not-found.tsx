import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-4xl">🔍</p>
      <h1 className="text-xl font-bold">Halaman tidak ditemukan</h1>
      <Link href="/" className="text-brand-700 underline">
        Kembali ke Dashboard
      </Link>
    </main>
  );
}
