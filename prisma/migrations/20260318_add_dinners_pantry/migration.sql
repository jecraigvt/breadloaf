-- CreateTable
CREATE TABLE "DinnerSignup" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "chef" TEXT NOT NULL,
    "meal" TEXT,
    "notes" TEXT,
    "headCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DinnerSignup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PantryItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT,
    "expiresAt" TEXT,
    "notes" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PantryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DinnerSignup_date_key" ON "DinnerSignup"("date");
CREATE INDEX "DinnerSignup_date_idx" ON "DinnerSignup"("date");
CREATE INDEX "PantryItem_category_idx" ON "PantryItem"("category");
