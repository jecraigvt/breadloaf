# OpenAI Migration Results Handoff

**Prepared:** 2026-08-05  
**Audience:** Claude / senior reviewer  
**Scope completed:** Tasks 2–6 and Task 14 from `docs/openai-migration-and-intake-handoff.md`  
**Scope intentionally not started:** Tasks 7–13

## Review state

- Branch: `codex/openai-migration-tasks-2-6-14`
- Remote branch: `origin/codex/openai-migration-tasks-2-6-14`
- Branch HEAD at completion: `d9ed855f28088d5dcf04eb30289bd075cc0b3e50`
- Base `main`: `5e8ea9440db2900ededf7541b075b44e47344df8`
- The branch was **not merged** and `main` was **not pushed**.
- `railway up` was **not run**.
- Production application code therefore remains on `main` until review, merge, and deployment.
- Production data **was** changed by the explicitly requested re-embedding and Task 14 backfill operations described below.

Read this file together with the original specification. The original handoff remains authoritative for intent and prompt-preservation requirements.

## Commit map

Each requested task has its own commit:

| Task | Commit | Summary |
|---|---|---|
| 2 | `7e5e10b` | Port embeddings to OpenAI |
| 3 | `0accaeb` | Port document categorization to OpenAI |
| 4 | `cbd4383` | Transcribe media before categorization |
| 5 | `ece735a` | Port Bucky tool loop to OpenAI |
| 6 | `fc08887` | Finish OpenAI provider migration |
| 14 | `d9ed855` | Backfill stranded document analysis |

## Task 2 — Embeddings

- Replaced Gemini embeddings with OpenAI `text-embedding-3-small`.
- Changed both indexing and the semantic-search gate in `hybridSearch` from `GOOGLE_AI_API_KEY` to `OPENAI_API_KEY`.
- Preserved keyword fallback behavior.
- Ran the required production rebuild after the code landed. All 65 embedding rows were rebuilt successfully in the OpenAI vector space:
  - 65 indexed
  - 0 failed
  - 65 verified at 1,536 dimensions
- A recall smoke query returned document, memory, and asset results.

Operational note: the production database now contains OpenAI 1,536-dimensional vectors, but the deployed application is still the pre-merge Gemini code. Until this branch is deployed, deployed semantic queries generate incompatible vectors and semantic scoring degrades to zero; keyword retrieval still works. This temporary mixed deployment/data state follows the spec's instruction to re-embed immediately after Task 2.

## Task 3 — Categorization

- Ported document image/PDF categorization, extracted-text categorization, and pantry scanning to OpenAI Responses structured outputs.
- Centralized model choices in `MODELS` and used the specified Luna/Terra tiers.
- Removed malformed-JSON cleanup and fallback parsing from the migrated structured-output paths.
- Preserved the existing prompts verbatim in substance, including:
  - S-Corp category hints
  - new-category guardrails
  - anti-generic-title rules
- Did not alter `src/lib/file-document.ts` processing order: the SHA-256 dedupe check still occurs first and the file is still written to disk before AI processing.

## Task 4 — Audio

- Replaced direct Gemini media processing with two stages:
  1. OpenAI `gpt-4o-mini-transcribe` transcription
  2. Existing text categorization over the transcript
- Preserved the raw transcript as `extractedText`.
- Unsupported video/transcription failures continue through the existing safe `Needs Review` path rather than losing the document.

## Task 5 — Bucky and tools

- Ported `chatWithAssistant` to the OpenAI Responses tool loop.
- Converted all 12 tool schemas to standard JSON Schema.
- Preserved the hard 8-iteration loop cap.
- Preserved the complete Bucky system prompt and domain wording.
- Preserved `recordBuckyToolResult` ledger writes.
- Preserved the `set_document_category` transaction that closes the associated question.
- Preserved before/after snapshots used by Ledger undo to restore both category and question state.
- Added focused tests for OpenAI function-argument parsing.
- Ran a live read-only chat smoke test with all tool declarations accepted. No mutating production tool calls were made.

## Task 6 — Remaining provider paths and retry behavior

- Added a shared OpenAI client in `src/lib/openai-client.ts` with SDK retries disabled and one application retry policy.
- The retry helper handles 429 and 503 responses, honors `Retry-After`, and otherwise uses exponential delay.
- Ported the remaining Gemini paths:
  - librarian / Tidy Up
  - Mail Room email-body analysis
  - analyze-link image vision and structured analysis
- Removed `@google/generative-ai` from application dependencies.
- Confirmed no Gemini references remain in `src`, `scripts`, or `package.json`.
- Ran a live read-only Tidy Up generation on Terra; it produced a valid 18-operation plan, which was not applied.
- Did not run a live Mail Room poll because running it locally against production would save attachments to the local filesystem while creating production rows, leaving broken off-volume file references.

## Task 14 — Production backfill

Implementation: `scripts/backfill-document-analysis.ts`

The script is deliberately guarded and resumable:

- Requires explicit `--apply` for writes.
- Refuses apply mode unless `BACKFILL_UPLOAD_ROOT=/app/public/uploads`.
- Selects both `aiSummary IS NULL` and `aiSummary = ''`.
- Verifies safe paths, file existence, and actual file size before reading.
- Reports and continues past missing or oversized files.
- Updates the existing `Document` row; it never creates a replacement row.
- Updates summary, extracted text, and tags.
- Sets `categoryId` only if the current value is null.
- Avoids even resolving a proposed AI category for rows that already have a human category.
- Re-indexes every successfully enriched document.
- Rolls back document enrichment if re-indexing fails, leaving the row eligible for a clean retry.
- Closes open archive questions only for successfully enriched candidate documents.
- Verifies that originally non-null categories remain unchanged.

### Execution choice

The backfill ran inside the Railway application container through `railway ssh`. This was chosen over an admin API route or startup hook because it reaches `/app/public/uploads` without adding a permanent web endpoint or causing the job to rerun on every boot.

The deployed container did not include Git, OpenAI, or Zod. A compressed snapshot of this review branch was therefore transferred to an isolated temporary directory, its SHA-256 was verified, dependencies were installed there, and the script was pointed at `/app/public/uploads`. `/app` application files were not modified. The temporary bundle, source tree, and dependencies were removed after verification.

### Production result

Preview found exactly 18 documents with falsy summaries:

- 17 were processable and were enriched in place.
- All 17 were re-indexed.
- 1 was skipped as oversized: `Bestor_Photos_170.pdf` (52.4 MB, above the 15 MB AI limit).
- 0 files were missing.
- 0 processing attempts failed.
- 11 related open archive questions were closed.
- 0 human-assigned categories changed.
- 1 falsy-summary row remains: the oversized Bestor PDF.

A second apply run made no changes and reported only the same oversized document, confirming practical idempotence and resumability.

Afterward, a read-only Bucky retrieval query about the archived July 22 photos returned concrete newly indexed details, including a Weil-McLain Gold GV boiler, a 30 PSI Watts relief valve, and a Wirsbo/copper plumbing manifold with labeled PEX lines.

## Validation performed

`npm run test` was run before every commit, as required:

| Commit | Passing tests |
|---|---:|
| `7e5e10b` | 46 |
| `0accaeb` | 46 |
| `cbd4383` | 46 |
| `ece735a` | 48 |
| `fc08887` | 51 |
| `d9ed855` | 51 |

Additional verification:

- TypeScript checks passed after the material migration stages.
- `npm run build` passed after Task 6.
- Working tree was clean at the original completion point.
- The feature branch was pushed to its matching remote branch only.
- No tasks 7–13 were implemented.

## Spec discrepancies and underspecified points

1. **Human-categorized backlog count:** The spec expected 11 of 18 documents to already have a category. Production had 16 of 18. The script used live row state as the authority and preserved all 16.
2. **Railway environment behavior:** The initial `railway run npx tsx scripts/re-embed.ts` could not resolve the private database hostname because it ran locally. A second attempt using an absent app-scoped public database variable failed Prisma validation before any writes. The successful run explicitly obtained the Postgres service's public URL while injecting the application service's OpenAI environment; secrets were not printed.
3. **Railway container tooling:** `railway ssh` provided volume access but the running image lacked the branch source and required migration dependencies. The isolated, hash-verified temporary bundle was the least invasive way to execute the exact reviewed script inside the container.
4. **Deployment instructions conflict:** `AGENTS.md` contains both a current statement that GitHub pushes to `main` auto-deploy and a stale later statement that `railway up` is the only deployment method. The migration handoff and the newer section were followed: no push to `main` and no `railway up`.
5. **Mutation-safe smoke coverage:** A live round trip through all 12 Bucky tools was not run because it would mutate real family data. Tool declarations were accepted in a no-action live request, unit tests passed, and the ledger/undo transaction code was preserved by inspection.
6. **Mail Room smoke coverage:** A live local poll was intentionally skipped because its production-database/local-filesystem split could create unrecoverable document records.
7. **Task 3 direct-create coverage:** The full `fileDocumentFromBuffer` creation path was not invoked against production to avoid creating synthetic family records. Task 14 exercised real PDF, image, DOCX, XLSX, and audio analysis paths from inside the production container.

## Reviewer priorities

Review these areas first because failures would be silent or destructive:

1. `src/lib/embeddings.ts`: confirm semantic search is gated on `OPENAI_API_KEY` and dimensions/models are consistent.
2. `src/lib/file-document.ts`: confirm dedupe and disk-before-AI ordering remain unchanged.
3. `src/lib/ai.ts`: confirm the 8-iteration tool cap, original prompt wording, and all 12 tool schemas.
4. `set_document_category`: confirm category/question transaction, ledger recording, and undo snapshots.
5. `scripts/backfill-document-analysis.ts`: confirm category preservation, update-in-place behavior, per-file failure handling, rollback on indexing failure, and the `/app/public/uploads` apply guard.

## Remaining operator action

- Decide how to handle `Bestor_Photos_170.pdf` (52.4 MB). It remains intentionally unprocessed; the current AI input limit is 15 MB.
- Review and merge the feature branch as one unit for Tasks 2–6, then deploy promptly to restore compatibility between deployed query embeddings and the already rebuilt production index.
- Do not interpret this handoff as authorization to begin Tasks 7–13.
