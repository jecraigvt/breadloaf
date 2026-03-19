-- CreateTable
CREATE TABLE "JarvisMemory" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT,
    "relevance" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JarvisMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JarvisMemory_type_idx" ON "JarvisMemory"("type");

-- CreateIndex
CREATE INDEX "JarvisMemory_topic_idx" ON "JarvisMemory"("topic");
