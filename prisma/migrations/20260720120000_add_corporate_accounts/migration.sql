CREATE TABLE "CorporateAccount" (
    "id" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'utility',
    "loginUrl" TEXT,
    "username" TEXT,
    "accountNumberLast4" TEXT,
    "responsiblePerson" TEXT,
    "recoveryContact" TEXT,
    "notes" TEXT,
    "encryptedSecret" TEXT,
    "secretIv" TEXT,
    "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorporateAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CorporateAccount_status_category_idx" ON "CorporateAccount"("status", "category");
CREATE INDEX "CorporateAccount_serviceName_idx" ON "CorporateAccount"("serviceName");

CREATE TABLE "VaultConfiguration" (
    "id" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultConfiguration_pkey" PRIMARY KEY ("id")
);
