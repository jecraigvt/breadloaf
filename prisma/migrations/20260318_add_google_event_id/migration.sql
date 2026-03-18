-- AlterTable
ALTER TABLE "Stay" ADD COLUMN "googleEventId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Stay_googleEventId_key" ON "Stay"("googleEventId");
