import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "@/server/context";
import { resetDb, setupHousehold } from "./helpers";

let currentCtx: ServiceContext | null = null;
vi.mock("@/server/auth/current", () => ({ getApiContext: async () => currentCtx }));

const { GET, POST } = await import("@/app/api/transactions/route");
const exportRoute = await import("@/app/api/export/transaksi/route");

let h: Awaited<ReturnType<typeof setupHousehold>>;

beforeEach(async () => {
  await resetDb();
  h = await setupHousehold();
  currentCtx = h.ctx;
});

function post(body: unknown) {
  return new NextRequest("http://localhost/api/transactions", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("API /api/transactions", () => {
  it("401 tanpa sesi", async () => {
    currentCtx = null;
    const res = await GET(new NextRequest("http://localhost/api/transactions"));
    expect(res.status).toBe(401);
  });

  it("POST membuat transaksi (201) lalu GET mengembalikannya", async () => {
    const res = await POST(post({ type: "expense", amount: "Rp 25.000", occurredAt: "2026-11-20T12:30", fromAccountId: h.cash.id, categoryId: h.food.id }));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(Number(created.amount)).toBe(25_000);
    // "2026-11-20T12:30" dibaca sebagai WIB.
    expect(created.occurredAt).toBe("2026-11-20T05:30:00.000Z");

    const list = await (await GET(new NextRequest("http://localhost/api/transactions?q="))).json();
    expect(list.total).toBe(1);
  });

  it("400 dengan pesan validasi yang jelas", async () => {
    const res = await POST(post({ type: "expense", amount: "abc", occurredAt: "2026-11-20", fromAccountId: h.cash.id }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.fieldErrors.amount).toBe("Nominal tidak valid");
  });

  it("400 untuk aturan transfer yang dilanggar", async () => {
    const res = await POST(post({ type: "transfer", amount: 1000, occurredAt: "2026-11-20", fromAccountId: h.cash.id, toAccountId: h.cash.id }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/tidak boleh sama/);
  });

  it("400 untuk body bukan JSON", async () => {
    const res = await POST(post("{bukan json"));
    expect(res.status).toBe(400);
  });

  it("ekspor CSV memuat header dan baris", async () => {
    await POST(post({ type: "expense", amount: 25000, occurredAt: "2026-11-20", fromAccountId: h.cash.id, description: "=HYPERLINK(1)" }));
    const res = await exportRoute.GET(new NextRequest("http://localhost/api/export/transaksi"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("Tanggal;Waktu (WIB);Jenis");
    expect(text).toContain("25000");
    // Formula injection dinetralkan.
    expect(text).toContain("'=HYPERLINK(1)");
  });
});
