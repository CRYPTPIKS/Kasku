// Arahkan Prisma ke database test sebelum modul apa pun memuat PrismaClient.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://kasku:kasku-dev@localhost:5432/kasku_test";
// NODE_ENV sudah "test" dari vitest
// Struk: simpan di memori dan pakai pembaca palsu, tanpa MinIO/Tesseract/Redis.
process.env.STORAGE_DRIVER = "memory";
process.env.RECEIPT_PROVIDER = "mock";
delete process.env.REDIS_URL;
delete process.env.TELEGRAM_BOT_TOKEN;
