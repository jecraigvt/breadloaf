ALTER TABLE "Document"
  ADD COLUMN "analysisState" TEXT,
  ADD COLUMN "analysisError" TEXT;

WITH classified AS (
  SELECT
    "id",
    CASE
      WHEN (
        (NULLIF(BTRIM("aiSummary"), '') IS NOT NULL AND BTRIM("aiSummary") !~* '^Document uploaded.*categorize manually or ask Bucky about it$' AND BTRIM("aiSummary") !~* '^File too large for AI analysis.*categorize manually$')
        OR NULLIF(BTRIM("aiExtractedText"), '') IS NOT NULL
      ) THEN 'ok'
      WHEN "fileSize" > 15728640 OR BTRIM(COALESCE("aiSummary", '')) ~* '^File too large for AI analysis.*categorize manually$' THEN 'too_large'
      WHEN LOWER(SPLIT_PART("fileType", ';', 1)) NOT LIKE 'audio/%'
        AND LOWER(SPLIT_PART("fileType", ';', 1)) NOT LIKE 'video/%'
        AND LOWER(SPLIT_PART("fileType", ';', 1)) NOT LIKE 'image/%'
        AND LOWER(SPLIT_PART("fileType", ';', 1)) NOT IN (
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.oasis.opendocument.text',
          'application/vnd.oasis.opendocument.spreadsheet',
          'application/vnd.oasis.opendocument.presentation',
          'text/plain',
          'text/csv',
          'link'
        ) THEN 'unsupported_type'
      ELSE 'provider_error'
    END AS state
  FROM "Document"
)
UPDATE "Document" AS document
SET
  "analysisState" = classified.state,
  "analysisError" = CASE classified.state
    WHEN 'ok' THEN NULL
    WHEN 'too_large' THEN 'Historical intake skipped AI analysis because the file exceeded the 15 MB limit.'
    WHEN 'unsupported_type' THEN 'Historical intake could not analyze unsupported file type: ' || LOWER(SPLIT_PART(document."fileType", ';', 1)) || '.'
    ELSE 'Historical intake did not record a successful analysis.'
  END,
  "description" = CASE
    WHEN BTRIM(COALESCE(document."description", '')) ~* '^(Document uploaded.*categorize manually or ask Bucky about it|File too large for AI analysis.*categorize manually)$' THEN NULL
    ELSE document."description"
  END,
  "aiSummary" = CASE WHEN classified.state = 'ok' THEN NULLIF(BTRIM(document."aiSummary"), '') ELSE NULL END,
  "aiExtractedText" = CASE WHEN classified.state = 'ok' THEN NULLIF(BTRIM(document."aiExtractedText"), '') ELSE NULL END
FROM classified
WHERE document."id" = classified."id";

ALTER TABLE "Document"
  ALTER COLUMN "analysisState" SET DEFAULT 'provider_error',
  ALTER COLUMN "analysisState" SET NOT NULL,
  ADD CONSTRAINT "Document_analysisState_check"
    CHECK ("analysisState" IN ('ok', 'unsupported_type', 'too_large', 'provider_error'));
