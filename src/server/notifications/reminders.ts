/**
 * Pengingat: cicilan/hutang jatuh tempo dan anggaran yang mencapai 80%/100%.
 *
 * 1. generateReminders() membuat baris Notification (unik per dedupeKey, jadi aman
 *    dijalankan berulang kali).
 * 2. deliverPendingNotifications() mengirimnya ke chat Telegram pemilik, hanya
 *    pukul 07.00–21.00 WIB agar tidak mengganggu malam hari.
 * Dijalankan berkala oleh worker (BullMQ) atau `npm run reminders` lewat cron.
 */
import { formatDate, jakartaDayDiff, jakartaParts } from "@/lib/dates";
import { formatRupiah } from "@/lib/money";
import type { ServiceContext } from "../context";
import { prisma } from "../db";
import { logger } from "../logger";
import { claimBudgetAlerts, type BudgetAlert } from "../services/budgets";
import { upcomingDebtDues } from "../services/debts";
import { esc } from "../telegram/format";

export type NotificationSender = (chatId: bigint, html: string) => Promise<void>;

export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 7;

export function isQuietHour(now = new Date()) {
  const h = jakartaParts(now).hour;
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

async function ownerContext(householdId: string): Promise<ServiceContext | null> {
  const owner = await prisma.householdMember.findFirst({ where: { householdId, role: "owner" }, orderBy: { createdAt: "asc" } });
  return owner ? { householdId, userId: owner.userId, role: "owner", source: "system" } : null;
}

export function budgetAlertText(a: BudgetAlert) {
  const s = a.status;
  const pct = Math.round(s.ratio * 100);
  if (a.threshold === 100) {
    return `🚨 Anggaran <b>${esc(s.name)}</b> sudah terlampaui: ${esc(formatRupiah(s.spent))} dari ${esc(formatRupiah(s.amount))} (${pct}%).`;
  }
  return `⚠️ Anggaran <b>${esc(s.name)}</b> sudah terpakai ${pct}%: ${esc(formatRupiah(s.spent))} dari ${esc(formatRupiah(s.amount))}. Sisa ${esc(formatRupiah(s.remaining))}.`;
}

async function insertNotification(householdId: string, userId: string | null, now: Date, n: { kind: string; title: string; body: string; dedupeKey: string }) {
  await prisma.notification.createMany({
    data: [{ householdId, userId, channel: "telegram", scheduledAt: now, ...n }],
    skipDuplicates: true,
  });
}

/** Buat notifikasi yang jatuh waktu untuk semua household. Mengembalikan jumlah baris baru (perkiraan). */
export async function generateReminders(now = new Date()) {
  const households = await prisma.household.findMany({ select: { id: true } });
  let created = 0;
  for (const h of households) {
    const ctx = await ownerContext(h.id);
    if (!ctx) continue;
    const before = await prisma.notification.count({ where: { householdId: h.id } });

    // Cicilan & jatuh tempo hutang/piutang.
    const dues = await upcomingDebtDues(ctx, 30, now);
    for (const d of dues) {
      const days = jakartaDayDiff(now, d.dueDate);
      if (!d.overdue && days > d.debt.reminderDaysBefore) continue;
      const payable = d.debt.direction === "payable";
      const what = d.sequence ? `cicilan ke-${d.sequence}` : payable ? "hutang" : "piutang";
      const when = d.overdue ? `sudah lewat jatuh tempo (${formatDate(d.dueDate)})` : days === 0 ? "jatuh tempo hari ini" : days === 1 ? "jatuh tempo besok" : `jatuh tempo ${days} hari lagi (${formatDate(d.dueDate)})`;
      const body = payable
        ? `📅 ${esc(what.charAt(0).toUpperCase() + what.slice(1))} ke <b>${esc(d.debt.counterparty)}</b> ${esc(when)}: <b>${esc(formatRupiah(d.amount))}</b>.`
        : `📅 ${esc(what.charAt(0).toUpperCase() + what.slice(1))} dari <b>${esc(d.debt.counterparty)}</b> ${esc(when)}: <b>${esc(formatRupiah(d.amount))}</b>.`;
      const target = d.sequence ? `inst:${d.debt.installments.find((i) => i.sequence === d.sequence)!.id}` : `debt:${d.debt.id}`;
      await insertNotification(h.id, ctx.userId, now, {
        kind: d.overdue ? "debt_overdue" : "debt_due",
        title: payable ? "Pengingat hutang" : "Pengingat piutang",
        body: `${body}\nCatat pembayaran: <code>${payable ? "bayar hutang" : "terima cicilan"} ${esc(formatRupiah(d.amount).replace("Rp", ""))} ${payable ? "ke" : "dari"} ${esc(d.debt.counterparty)}</code>`,
        dedupeKey: `${target}:${d.overdue ? "overdue" : "soon"}`,
      });
    }

    // Anggaran 80% / 100%.
    for (const a of await claimBudgetAlerts(ctx)) {
      await insertNotification(h.id, ctx.userId, now, {
        kind: a.threshold === 100 ? "budget_100" : "budget_80",
        title: "Anggaran",
        body: budgetAlertText(a),
        dedupeKey: `budget:${a.status.budgetId}:${a.monthKey}:${a.threshold}`,
      });
    }
    created += (await prisma.notification.count({ where: { householdId: h.id } })) - before;
  }
  return created;
}

/** Kirim notifikasi yang tertunda ke Telegram. Di luar jam tenang saja. */
export async function deliverPendingNotifications(send: NotificationSender, now = new Date()) {
  if (isQuietHour(now)) return { sent: 0, failed: 0, skipped: "quiet_hours" as const };
  const pending = await prisma.notification.findMany({
    where: { status: "pending", channel: "telegram", scheduledAt: { lte: now } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  let sent = 0;
  let failed = 0;
  for (const n of pending) {
    const members = await prisma.householdMember.findMany({ where: { householdId: n.householdId }, select: { userId: true } });
    const identities = await prisma.telegramIdentity.findMany({
      where: { userId: { in: n.userId ? [n.userId] : members.map((m) => m.userId) }, chatId: { not: null } },
    });
    if (identities.length === 0) {
      // Belum ada chat Telegram tertaut: tandai agar tidak dicoba terus.
      await prisma.notification.update({ where: { id: n.id }, data: { status: "failed", error: "Belum ada chat Telegram tertaut" } });
      failed++;
      continue;
    }
    try {
      for (const i of identities) await send(i.chatId!, n.body);
      await prisma.notification.update({ where: { id: n.id }, data: { status: "sent", sentAt: new Date() } });
      sent++;
    } catch (err) {
      failed++;
      logger.warn("Gagal mengirim pengingat", { notificationId: n.id, reason: err instanceof Error ? err.message : String(err) });
      await prisma.notification.update({ where: { id: n.id }, data: { status: "failed", error: String(err).slice(0, 300) } });
    }
  }
  return { sent, failed, skipped: null };
}

export async function runReminders(send: NotificationSender | null, now = new Date()) {
  const created = await generateReminders(now);
  const delivery = send ? await deliverPendingNotifications(send, now) : null;
  return { created, delivery };
}
