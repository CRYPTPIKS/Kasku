import type { Metadata } from "next";
import { formatDateTime } from "@/lib/dates";
import { requireUser } from "@/server/auth/current";
import { prisma } from "@/server/db";
import { isTelegramConfigured } from "@/server/telegram/config";
import { PasswordForm } from "@/components/settings/password-form";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "Pengaturan" };

export default async function SettingsPage() {
  const { user, ctx } = await requireUser();
  const telegramReady = isTelegramConfigured();
  const [household, sessions, telegramIds] = await Promise.all([
    prisma.household.findUniqueOrThrow({ where: { id: ctx.householdId } }),
    prisma.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" }, take: 10 }),
    prisma.telegramIdentity.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Pengaturan" />
      <Card>
        <CardHeader title="Profil" />
        <dl className="grid gap-3 p-4 text-sm sm:grid-cols-2 sm:p-5">
          <div>
            <dt className="text-slate-500">Nama</dt>
            <dd className="font-medium">{user.name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Email</dt>
            <dd className="font-medium">{user.email}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Ruang keuangan</dt>
            <dd className="font-medium">{household.name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Mata uang & zona waktu</dt>
            <dd className="font-medium">
              {household.currency} · {household.timezone}
            </dd>
          </div>
        </dl>
      </Card>
      <Card>
        <CardHeader title="Keamanan" />
        <div className="grid gap-6 p-4 sm:p-5 md:grid-cols-2">
          <PasswordForm />
          <div className="space-y-4 text-sm">
            <div>
              <p className="font-medium">Verifikasi dua langkah</p>
              <p className="mt-1 text-slate-600">
                <Badge>{user.twoFactorEnabled ? "Aktif" : "Belum tersedia"}</Badge> Akan hadir di versi berikutnya.
              </p>
            </div>
            <div>
              <p className="font-medium">Sesi aktif</p>
              <ul className="mt-1 space-y-1 text-slate-600">
                {sessions.map((s) => (
                  <li key={s.id} className="truncate">
                    {s.userAgent?.slice(0, 60) ?? "Perangkat"} · {formatDateTime(s.lastSeenAt)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Bot Telegram" />
        <div className="space-y-3 p-4 text-sm text-slate-600 sm:p-5">
          <p>
            Status:{" "}
            {telegramReady ? <Badge tone="green">Bot aktif</Badge> : <Badge tone="amber">Belum dikonfigurasi</Badge>}
          </p>
          {!telegramReady && (
            <p>
              Isi <code>TELEGRAM_BOT_TOKEN</code>, <code>TELEGRAM_WEBHOOK_SECRET</code>, dan <code>TELEGRAM_ALLOWED_USER_IDS</code> di file .env server,
              lalu jalankan <code>npm run telegram:webhook -- set</code>. Panduan lengkap ada di README.
            </p>
          )}
          {telegramIds.length > 0 ? (
            <ul className="space-y-1">
              {telegramIds.map((t) => (
                <li key={t.id}>
                  Terhubung: <span className="font-medium text-slate-800">{t.username ? `@${t.username}` : t.firstName ?? "Akun Telegram"}</span> (ID {t.telegramUserId.toString()})
                </li>
              ))}
            </ul>
          ) : (
            telegramReady && <p>Kirim /start ke bot dari akun Telegram yang diizinkan untuk menghubungkannya.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
