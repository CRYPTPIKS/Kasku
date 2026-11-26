-- CreateTable
CREATE TABLE "TelegramPendingAction" (
    "id" TEXT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "householdId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramPendingAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TelegramPendingAction_telegramUserId_idx" ON "TelegramPendingAction"("telegramUserId");
