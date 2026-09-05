-- Background uploads retain their original before a worker analyzes them.
-- Replace the existing constraint atomically, preserving every historical state.
ALTER TABLE "Document"
  DROP CONSTRAINT "Document_analysisState_check",
  ADD CONSTRAINT "Document_analysisState_check"
    CHECK ("analysisState" IN ('pending', 'ok', 'unsupported_type', 'too_large', 'provider_error'));
