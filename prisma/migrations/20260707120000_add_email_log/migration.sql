-- Inbound family email processing: dedupe + audit trail
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "actions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailLog_messageId_key" ON "EmailLog"("messageId");
CREATE INDEX "EmailLog_createdAt_idx" ON "EmailLog"("createdAt");
