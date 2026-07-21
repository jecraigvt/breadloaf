# Bucky Memory and Operations

This document describes how Bucky stores, retrieves, changes, and audits family knowledge. The design is intentionally tiered: small current-state context is always available, while long-term detail is loaded only when a request calls for it.

## Storage Boundaries

Use the narrowest durable system that owns the fact:

| Knowledge | System of record | Examples |
| --- | --- | --- |
| Current operations | Native relational tables | stays, groceries, pantry, dinners, expenses, maintenance |
| Property equipment | `Asset` and linked maintenance | well pump model, shutoff location, generator startup warning |
| Source material | `Document` | deeds, minutes, invoices, photos, voice memos, transcripts |
| Durable conclusions | `JarvisMemory` | approved decision, family preference, reusable property-wide procedure |
| Uncertainty | `BuckyQuestion` | conflicting records, unclear filing, draft versus approved minutes |
| Changes | `BuckyLedgerEntry` | actions Bucky or a family member performed through governed flows |

Documents remain primary evidence. A summary or memory should point back to its source when one is known. Bucky should not copy expenses, stays, maintenance entries, or equipment facts into generic memory when a native record already owns them.

## Retrieval Layers

Every assistant request receives three layers from `src/lib/bucky-context.ts`:

1. **Operational context:** bounded current state such as upcoming stays, rooms, open questions, shopping items, and the current financial summary.
2. **Knowledge directory:** counts showing which bodies of knowledge exist without loading all of their contents.
3. **Relevant long-term knowledge:** request-specific document chunks, active memories, assets, maintenance, expenses, and family records.

Explicit year questions use structured database queries for stays and expenses. Long-term retrieval uses hybrid search: Gemini embeddings and lexical matches are fused with reciprocal-rank scoring. If the embedding request is unavailable, lexical retrieval continues to work.

Context is capped before it reaches the chat model. This prevents archive growth from making every request slower or more expensive.

## Memory Lifecycle

`JarvisMemory` supports:

- `type`: semantic, episodic, or procedural
- `scope`: property, family, user, or entity
- `subject`: the person, system, organization, or topic primarily involved
- structured provenance through `sourceType`, `sourceId`, and human-readable `source`
- `confidence` and `importance`
- `validFrom` and `validUntil`
- `status`: active, superseded, or disputed
- usage metadata through `lastUsedAt` and `useCount`

The active identity of a memory is its topic within a scope and, when supplied, its subject. Updating that identity creates a new active row and marks the old row superseded. History is retained instead of overwritten.

Expired, future, superseded, disputed, or non-family memories are not returned in normal family retrieval.

## Derived Search Index

`Embedding` is a rebuildable derived index, not a system of record. Sources are split into overlapping chunks and stored under `(sourceType, sourceId, chunkIndex)`. The index currently covers:

- documents
- active memories
- active assets
- maintenance records
- expenses

Create, update, restore, and delete flows refresh or remove the affected index entries. A complete rebuild is safe and idempotent:

```bash
npm run memory:reindex
```

At the current archive size, semantic ranking reads stored vectors and scores them in the application. If the index grows into the tens of thousands of chunks, move similarity ranking into PostgreSQL with `pgvector` or a dedicated vector service.

## Model Routing and Failure Behavior

Routine actions and lookups use the stable Flash model. Pro is reserved for explicit requests for comprehensive, cross-record, scenario, or strategic analysis. A 429 or 503 from Pro before any tool side effect triggers a retry and Flash fallback.

Embedding writes are best effort during normal requests. A failed embedding must not make the underlying document, expense, maintenance record, asset, or memory fail to save. The reindex command repairs missing derived entries later.

Document and media analysis follows the same rule. Chat and email attachments are written to the archive before AI enrichment. If transcription or categorization remains unavailable after retries, the archive row is still created with a conservative title, placed in Needs Review, and surfaced through a persistent filing question.

## Oversight and Undo

Every successful assistant tool call is written to Bucky's Ledger. Audit metadata is removed before tool results are sent back to the model.

Ledger undo is intentionally limited to actions with implemented, conflict-aware handlers:

- document category changes, including restoration of filing-question state
- position changes, including assignment history and affected directory roles

Undo verifies that the affected records still match the action's after-snapshot. If somebody changed them later, undo returns a conflict instead of overwriting newer work. Vault and corporate-account operations are audited but not advertised as reversible.

## Archive Titles

Bucky proposes a descriptive title while reading or transcribing a file. The server then applies the same title resolver to uploads, chat attachments, email attachments, links, and direct document saves.

The visible title should describe content. The original filename remains in `Document.fileName` as provenance. Generic or machine-generated names such as `IMG_4821.jpg`, `scan003.pdf`, or `Voice Memo 7.m4a` are rejected when a summary, transcript, extracted heading, or useful human filename can produce a better title.

Historical cleanup defaults to preview mode:

```bash
npm run archive:retitle
```

Apply only reviewed deterministic changes:

```bash
npm run archive:retitle -- --apply
```

Ask Bucky to reread unresolved files in small, sequential batches:

```bash
npm run archive:retitle -- --reanalyze --limit=20
npm run archive:retitle -- --reanalyze --offset=20 --limit=20
```

For a one-time high-quality review, `--reanalyze-all` asks Bucky to reread every filename-like candidate even when stored text produced a plausible title. Write the preview to a plan, review the printed titles, then apply that exact plan:

```bash
npm run archive:retitle -- --reanalyze-all --limit=20 --write-plan=/tmp/archive-title-plan.json
npm run archive:retitle -- --apply-plan=/tmp/archive-title-plan.json
```

The apply step rejects documents whose title or filename changed after preview. For stored-content-only batches, add `--apply` after reviewing a preview. Add `--skip-index` only during a Google outage, then run `npm run memory:reindex` later.

## Production Rollout

The app runs `prisma migrate deploy` at startup. For the tiered-memory release:

1. Deploy and verify that `20260720200000_add_tiered_bucky_memory` applied.
2. Rebuild all derived knowledge chunks inside the running service.
3. Preview historical title changes inside the running service, where the upload volume is mounted.
4. Apply deterministic title changes after review.
5. Reread remaining generic files in small batches only if Gemini is healthy.

```bash
git push origin main
railway logs --lines 100
railway ssh npm run memory:reindex
railway ssh npm run archive:retitle
railway ssh npm run archive:retitle -- --apply
```

Do not use `railway run` for archive rereading. It injects production variables into a local process but does not mount the production upload volume.

## Validation

Before deployment:

```bash
npm test
npx tsc --noEmit
npx prisma validate
npm run build
```

After deployment, check startup logs for migration errors, run the index rebuild, and smoke-test:

- an ordinary Bucky lookup
- a year-specific stay or expense question
- a document or voice-memo upload
- a descriptive archive title with the original filename still visible
- a reversible category change and Ledger undo
