-- Keep Prisma's JSON source column for portable writes, but search against a
-- native pgvector column so retrieval never loads the whole index into Node.
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "Embedding"
    ADD COLUMN "embedding" vector(1536),
    ADD COLUMN "searchVector" tsvector
        GENERATED ALWAYS AS (to_tsvector('simple', "content")) STORED;

UPDATE "Embedding"
SET "embedding" = "vector"::vector(1536);

CREATE OR REPLACE FUNCTION sync_embedding_vector()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW."embedding" := NEW."vector"::vector(1536);
    RETURN NEW;
END;
$$;

CREATE TRIGGER "Embedding_sync_vector"
BEFORE INSERT OR UPDATE OF "vector" ON "Embedding"
FOR EACH ROW
EXECUTE FUNCTION sync_embedding_vector();

CREATE INDEX "Embedding_embedding_hnsw_idx"
    ON "Embedding" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX "Embedding_searchVector_gin_idx"
    ON "Embedding" USING gin ("searchVector");
