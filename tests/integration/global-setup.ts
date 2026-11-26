import { execSync } from "node:child_process";

export const DEFAULT_TEST_DB = "postgresql://kasku:kasku-dev@localhost:5432/kasku_test";

/** Terapkan migrasi ke database test sekali sebelum semua test integrasi. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DB;
  if (!/_test(\?|$)/.test(new URL(url).pathname + new URL(url).search)) {
    throw new Error("TEST_DATABASE_URL harus mengarah ke database yang namanya berakhiran _test.");
  }
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: "pipe",
  });
}
