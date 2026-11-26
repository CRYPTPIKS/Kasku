import { beforeEach, describe, expect, it } from "vitest";
import { login } from "@/server/auth/login";
import { validateSessionToken, revokeSession } from "@/server/auth/session";
import { changePassword } from "@/server/auth/change-password";
import { prisma } from "@/server/db";
import { resetDb, setupHousehold } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await setupHousehold();
});

describe("autentikasi dashboard", () => {
  it("password disimpan sebagai hash argon2id", async () => {
    const user = await prisma.user.findFirstOrThrow();
    expect(user.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(user.passwordHash).not.toContain("kata-sandi-kuat-123");
  });

  it("login benar menghasilkan sesi yang valid, token tidak disimpan mentah", async () => {
    const { token } = await login({ email: "PEMILIK@contoh.test", password: "kata-sandi-kuat-123", ip: "1.1.1.1" });
    const session = await validateSessionToken(token);
    expect(session?.user.email).toBe("pemilik@contoh.test");
    expect(await prisma.session.count({ where: { tokenHash: token } })).toBe(0);
    await revokeSession(token);
    expect(await validateSessionToken(token)).toBeNull();
  });

  it("login salah ditolak dan dibatasi setelah 5 percobaan", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(login({ email: "pemilik@contoh.test", password: "salah", ip: "2.2.2.2" })).rejects.toThrow(/salah/);
    }
    await expect(login({ email: "pemilik@contoh.test", password: "kata-sandi-kuat-123", ip: "2.2.2.2" })).rejects.toThrow(/Terlalu banyak/);
  });

  it("email tidak terdaftar memberi pesan yang sama", async () => {
    await expect(login({ email: "tidak-ada@contoh.test", password: "apa saja", ip: "3.3.3.3" })).rejects.toThrow("Email atau kata sandi salah.");
  });

  it("ganti kata sandi mengeluarkan sesi lain", async () => {
    const a = await login({ email: "pemilik@contoh.test", password: "kata-sandi-kuat-123", ip: "4.4.4.4" });
    const b = await login({ email: "pemilik@contoh.test", password: "kata-sandi-kuat-123", ip: "4.4.4.5" });
    const user = await prisma.user.findFirstOrThrow();
    await changePassword(user.id, "kata-sandi-kuat-123", "kata-sandi-baru-456", a.token);
    expect(await validateSessionToken(a.token)).not.toBeNull();
    expect(await validateSessionToken(b.token)).toBeNull();
  });
});
