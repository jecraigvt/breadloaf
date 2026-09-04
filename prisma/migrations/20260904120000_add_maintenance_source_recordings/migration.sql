-- Preserve the complete transcript and playable source audio behind maintenance
-- records created from Bucky voice dictation.
ALTER TABLE "MaintenanceRecord" ADD COLUMN "sourceRecordings" JSONB;
