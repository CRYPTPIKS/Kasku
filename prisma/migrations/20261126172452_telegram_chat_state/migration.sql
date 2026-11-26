-- CreateTable
CREATE TABLE "TelegramChatState" (
    "telegramUserId" BIGINT NOT NULL,
    "awaiting" TEXT,
    "transactionId" TEXT,
    "expiresAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TelegramChatState_pkey" PRIMARY KEY ("telegramUserId")
);
