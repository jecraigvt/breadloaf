-- Add description to Category so the AI categorizer knows what belongs in each category
ALTER TABLE "Category" ADD COLUMN "description" TEXT;
