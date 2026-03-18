-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "type" TEXT NOT NULL DEFAULT 'operating',
    "paidBy" TEXT NOT NULL DEFAULT 'Shared',
    "vendor" TEXT,
    "documentId" TEXT,
    "notes" TEXT,
    "fiscalYear" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expense_fiscalYear_idx" ON "Expense"("fiscalYear");

-- CreateIndex
CREATE INDEX "Expense_category_idx" ON "Expense"("category");

-- CreateIndex
CREATE INDEX "Expense_paidBy_idx" ON "Expense"("paidBy");

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");
