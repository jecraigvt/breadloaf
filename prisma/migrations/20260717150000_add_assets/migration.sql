-- Asset registry: permanently installed systems & major equipment
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "location" TEXT,
    "make" TEXT,
    "model" TEXT,
    "serial" TEXT,
    "installedYear" INTEGER,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Asset_name_key" ON "Asset"("name");
CREATE INDEX "Asset_category_idx" ON "Asset"("category");

-- Link maintenance records and documents to assets
ALTER TABLE "MaintenanceRecord" ADD COLUMN "assetId" TEXT;
CREATE INDEX "MaintenanceRecord_assetId_idx" ON "MaintenanceRecord"("assetId");
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Document" ADD COLUMN "assetId" TEXT;
CREATE INDEX "Document_assetId_idx" ON "Document"("assetId");
ALTER TABLE "Document" ADD CONSTRAINT "Document_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
