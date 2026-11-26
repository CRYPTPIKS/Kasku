// Arahkan Prisma ke database test sebelum modul apa pun memuat PrismaClient.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://kasku:kasku-dev@localhost:5432/kasku_test";
// NODE_ENV sudah "test" dari vitest
