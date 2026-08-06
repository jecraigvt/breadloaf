-- One-time addition of the Family Recordings category.
--
-- It cannot come from the seed: seed.ts deliberately only populates categories
-- into an EMPTY table, because re-seeding every deploy would resurrect
-- categories the librarian had merged or renamed. So a category added to that
-- list after first run reaches new databases only, and an existing archive
-- needs a migration like this one.
--
-- Idempotent, and silent if the family already made a category by this slug.
INSERT INTO "Category" ("id", "name", "slug", "icon", "color", "description", "createdAt")
SELECT
    'cat_family_recordings',
    'Family Recordings',
    'family-recordings',
    'Mic',
    'rose',
    'Recorded family stories, oral history, interviews, and narrated walkthroughs — the recording itself is the record',
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM "Category" WHERE "slug" = 'family-recordings' OR "name" = 'Family Recordings'
);
