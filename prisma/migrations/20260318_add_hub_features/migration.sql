-- CreateTable
CREATE TABLE "GroceryItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "addedBy" TEXT,
    "checkedBy" TEXT,
    "priority" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroceryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "list" TEXT NOT NULL,
    "section" TEXT NOT NULL DEFAULT 'General',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checkedBy" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRecord" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'General',
    "performedBy" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "nextDueAt" TIMESTAMP(3),
    "cost" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyMember" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "birthday" TEXT,
    "branch" TEXT,
    "relation" TEXT,
    "notes" TEXT,

    CONSTRAINT "FamilyMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroceryItem_checked_idx" ON "GroceryItem"("checked");
CREATE INDEX "ChecklistItem_list_idx" ON "ChecklistItem"("list");
CREATE INDEX "MaintenanceRecord_category_idx" ON "MaintenanceRecord"("category");
CREATE INDEX "MaintenanceRecord_performedAt_idx" ON "MaintenanceRecord"("performedAt");
CREATE INDEX "FamilyMember_branch_idx" ON "FamilyMember"("branch");
