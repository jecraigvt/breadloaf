# OpenAI Migration and Bucky Intake Handoff

**Written:** 2026-08-05
**For:** the implementing agent (Codex)
**Reviewed by:** Claude, after implementation
**Baseline commit:** `57dc15f` (working tree clean at time of writing)

---

## Status

Nothing in this document is built yet. Thirteen tasks are described below in
dependency order. Tasks 1–6 are a provider migration that must land as a unit —
the app is currently broken in production and stays broken until they ship.
Tasks 7–12 are improvements that build on the migrated code. Task 13 is
independent and can be done at any point.

---

## Why this work exists

Bucky has been silently failing to process uploaded files since mid-July. Twelve
open `BuckyQuestion` rows say "I couldn't read or confidently categorize this."
The cause was diagnosed on 2026-08-05:

**The production `GOOGLE_AI_API_KEY` is on the Gemini free tier.**

Probing the live key with 20 concurrent requests returned:

- `gemini-3.5-flash` — 7×200, 12×429, 1×503. Error body:
  `quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier", quotaValue: "5"`.
  **Five requests per minute.**
- `gemini-3.1-pro-preview` — 20/20 failed with `limit: 0`. **Unavailable entirely
  on free tier.** Every call to `MODELS.pro` has always failed.

One chat message with an attachment costs several Flash requests (categorize the
file, the chat turn, a round trip per function call). Two or three uploads in a
minute exceeds the ceiling. The failure timeline matches exactly: seven photos
uploaded ~20s apart on Jul 22 all failed; isolated uploads with a quiet minute
around them succeeded.

The API key, all three model IDs, and both the image and audio code paths were
verified working — a 4MB JPEG and a 485KB `.m4a` both categorized correctly on
the first attempt when run in isolation. **Nothing is wrong with the code's
Gemini usage.** It is purely quota.

The normal fix would be enabling billing on the Google Cloud project. That is not
available — the owner has hit the limit on billing-enabled Google projects.
Hence the migration.

The migration is independently justified on price:

| Role | Gemini (current) | OpenAI (target) |
|---|---|---|
| Workhorse | `gemini-3.5-flash` — $1.50 / $9.00 per 1M | `gpt-5.6-luna` — **$0.20 / $1.20** |
| Heavy analysis | `gemini-3.1-pro-preview` — $2–4 / $12–18 | `gpt-5.6-terra` — $2.00 / $12.00 |
| Embeddings | `gemini-embedding-2` — $0.20 per 1M | `text-embedding-3-small` — **$0.02** |
| Transcription | (bundled into Flash) | `gpt-4o-mini-transcribe` — $0.003/min |

Luna is ~7.5× cheaper than Flash on both sides; embeddings are 10× cheaper.

---

## Ground rules

1. **Do not deploy with `railway up`.** It uploads the local working tree,
   including uncommitted changes. GitHub auto-deploy is enabled — `git push
   origin main` is the deploy. (`AGENTS.md` said the opposite until this handoff;
   it has been corrected.)
2. **Never commit credentials.** Get the production DB URL with
   `railway variables --service Postgres` (use `DATABASE_PUBLIC_URL` for scripts
   run from a laptop; the `internal` host only resolves inside Railway).
3. **Land tasks 1–6 as one deployable unit** behind a single merge. A half-ported
   `ai.ts` is worse than the current state.
4. **Do not change behaviour that isn't described here.** Prompts, category
   guardrails, the ledger, and the `ask_family` flow keep their current semantics
   unless a task says otherwise.
5. **Run `npm run test` before every commit** (`tsx --test src/lib/*.test.ts`).
   Existing suites: `family-tree`, `family-plate`, `bucky-ledger`,
   `bucky-routing`, `document-title`, `embeddings`.
6. **Local dev gotcha:** `prisma/schema.prisma` is checked in with
   `provider = "postgresql"`. To develop against SQLite, temporarily flip it to
   `sqlite`, run `npx prisma db push && npx prisma db seed`, and flip it back
   before committing. Note that `mode: "insensitive"` queries are Postgres-only
   and error at runtime on SQLite.

---

## Migration surface (measured, not estimated)

- **5 files** import `@google/generative-ai`:
  `src/lib/ai.ts`, `src/lib/embeddings.ts`, `src/lib/librarian.ts`,
  `src/lib/email-processor.ts`, `src/app/api/documents/analyze-link/route.ts`
- **25 call sites** across `generateContent` / `embedContent` / `startChat` /
  `getGenerativeModel`
- **79 `SchemaType.*` usages** in `ai.ts` to convert to plain JSON Schema
- **12 Bucky tools** to re-declare
- Embeddings are stored as `vector String // JSON array of floats`
  (`prisma/schema.prisma:444`) — **not pgvector**, so no schema migration is
  needed for a dimension change
- Model IDs are already centralized in the exported `MODELS` const
  (`src/lib/ai.ts:29`) — keep that pattern

---

# Workstream A — OpenAI migration (tasks 1–6)

## Task 1 — Provision the OpenAI key — ✅ DONE (2026-08-05)

`OPENAI_API_KEY` is set on the Railway `breadloaf-app` service.

**Verified against the live key on 2026-08-05.** All six models this handoff
names are available on the account:

```
gpt-5.6-sol   gpt-5.6-terra   gpt-5.6-luna
text-embedding-3-small   gpt-4o-mini-transcribe   gpt-transcribe
```

**Observed rate limits** (from `x-ratelimit-*` response headers on a live
`gpt-5.6-luna` call — use these to tune task 6's backoff):

| Limit | Value |
|---|---|
| `x-ratelimit-limit-requests` | **500 / min** |
| `x-ratelimit-limit-tokens` | **200,000 / min** |
| `x-ratelimit-reset-requests` | 120ms |

For contrast, the Gemini free tier that caused this migration allowed **5
requests per minute**. This is a 100× increase on the exact constraint that
broke document processing, so the retry helper is no longer load-bearing for
normal family upload volume — but task 6 should still honor `Retry-After`
rather than a fixed schedule.

One thing to watch: TPM is 200,000 and image inputs are token-priced by
resolution and the `detail` setting. A batch of full-resolution phone photos
could approach the token ceiling well before the request ceiling. If task 9's
triage pass hits 429s, check `x-ratelimit-remaining-tokens` before assuming a
request-count problem.

**Keep `GOOGLE_AI_API_KEY` in place** until task 6 is done. Several modules read
it independently and will break the moment it disappears.

---

## Task 2 — Port embeddings

**File:** `src/lib/embeddings.ts`

Swap `gemini-embedding-2` for `text-embedding-3-small` (1536 dims, $0.02/1M).
The constant is `EMBEDDING_MODEL`, consumed at the single `getGenerativeModel`
call inside `generateEmbedding` (line ~87).

**The trap:** `hybridSearch` (line ~164) gates semantic search on
`process.env.GOOGLE_AI_API_KEY`:

```ts
process.env.GOOGLE_AI_API_KEY
  ? prisma.embedding.findMany({ where })
  : Promise.resolve([]),
```

If this is not changed to `OPENAI_API_KEY`, semantic search silently returns
nothing — no error, no log, Bucky just gets dumber. This is the highest-risk
line in the migration.

Functions that need porting: `generateEmbedding` (87), `embedAndStore` (93).
The five indexers (`indexDocument` 254, `indexMemory` 279, `indexAsset` 309,
`indexMaintenance` 341, `indexExpense` 368) call through `embedAndStore` and
should not need changes.

**After the code lands**, rebuild every vector — the old and new models occupy
different vector spaces and mixing them produces silently wrong similarity
scores:

```bash
railway run npx tsx scripts/re-embed.ts
```

Production currently holds **65 embedding rows** (48 document, 14 memory, 2
expense, 1 asset) at 3072 dims. After the port they should be 1536 dims, which
also halves retrieval cost — see task 12.

**Done when:** `scripts/re-embed.ts` completes, a spot-checked row has
`JSON.parse(vector).length === 1536`, and a Bucky question that requires recall
(e.g. "what did Tom say about the water pump?") still returns the right source.

---

## Task 3 — Port the categorization functions

**File:** `src/lib/ai.ts`

Port to `gpt-5.6-luna` via the Responses API:

| Function | Line | Input |
|---|---|---|
| `categorizeDocument` | 177 | image or PDF, inline base64 |
| `categorizeText` | 254 | extracted text (docx/xlsx/csv/txt) |
| `scanPantryItems` | 321 | image |

Images use image input. PDFs use `input_file` with a
`data:application/pdf;base64,{...}` data URI — OpenAI extracts both text and page
images for vision-capable models.

**Use `json_schema` Structured Outputs** to guarantee the `CategorizationResult`
shape (declared at `ai.ts:60`). This is the point of the task, not a nicety. The
current code does:

```ts
const text = result.response.text();
try {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  ...
} catch {
  return { suggestedCategory: "Other", confidence: 0.5, ... };  // silent
}
```

That pattern appears in **four places** and is why malformed output degrades into
a confidence-0.5 "Other" filing instead of surfacing as an error. Structured
Outputs removes the regex, the parse, and the fallback. Delete all three.

Keep `finalizeCategorizationTitle` and the `resolveDocumentTitle` guardrails —
they are independent of the provider and already tested
(`src/lib/document-title.test.ts`).

Keep the prompts substantially as-is. They encode real domain knowledge (the
S-Corp category hints, the `NEW_CATEGORY_RULES` guardrails, the
`DOCUMENT_TITLE_RULES` anti-generic-title rules) that took iterations to get
right. Port the wording; don't rewrite it.

**Done when:** an image, a PDF, and a `.docx` each categorize end-to-end through
`fileDocumentFromBuffer`, and no `JSON.parse` of model output remains in `ai.ts`.

---

## Task 4 — Split audio into transcribe + categorize

**File:** `src/lib/ai.ts`, function `processMediaFile` (line 113)

This is the one capability with no direct OpenAI equivalent. Gemini takes an
`.m4a` inline and returns transcript + summary + category + tags in a single
call. OpenAI keeps audio in a separate model family (`gpt-audio`), and combining
audio input with Structured Outputs and function calling in one request is not
documented as supported.

**Replace with two calls:**

1. `gpt-4o-mini-transcribe` ($0.003/min, accepts m4a) → transcript
2. Feed that transcript to the **existing** `categorizeText` → categorization

Persist the raw transcript to `Document.aiExtractedText` so it stays searchable
and so `indexDocument` embeds the real words.

**Accepted tradeoff, stated for the record:** a transcript loses non-verbal audio
context — speaker changes, tone, background sounds — that Gemini could hear. For
the property-walkthrough voice memos that feed `save_asset`, the words carry
nearly all the value. This is a deliberate downgrade, not an oversight.

**Callers to check:** `src/lib/file-document.ts:89` routes `audio/*` and
`video/*` here. Video is currently accepted; if `gpt-4o-mini-transcribe` rejects
the container, fall through to the existing size/unreadable path that files to
Needs Review rather than throwing.

**Done when:** a `.m4a` uploaded through Bucky chat produces a document with a
populated `aiExtractedText` transcript and a confident category.

---

## Task 5 — Port `chatWithAssistant` and the 12 tools

**File:** `src/lib/ai.ts`, function at line 1457. This is the bulk of the work.

**Tool schemas.** Convert **79 `SchemaType.*` usages** in the
`functionDeclarations` block (starts line 374) to plain JSON Schema. The 12 tools:

```
add_bulletin_message   add_dinner_signup   add_expense
add_grocery_item       add_maintenance_record   add_pantry_item
ask_family             create_stay         save_asset
save_memory            set_document_category    update_position
```

**The call loop.** Rewrite lines 1604–1648. Gemini's shape:

```ts
let functionCalls = result.response.functionCalls();
while (functionCalls && functionCalls.length > 0 && iterations < 8) {
  ...
  functionResponses.push({ functionResponse: { name: fc.name, response: ... } });
  result = await withGeminiRetry(() => chat.sendMessage(functionResponses));
  functionCalls = result.response.functionCalls();
}
```

becomes OpenAI `tool_calls` + `role: "tool"` messages. **Preserve the
8-iteration cap** — it is the only thing preventing a runaway tool loop.

**Preserve these behaviours exactly:**

- `recordBuckyToolResult` ledger writes and `stripToolAuditMetadata` — the ledger
  is the undo system's source of truth (`src/lib/bucky-undo.ts` reads it).
- The question-closing transaction inside `set_document_category`
  (`ai.ts:1041–1090`), including the `questionsBefore` / `questionsAfter`
  snapshots that let Ledger undo restore a question along with the category.
- `buildBuckyContext` integration and the `attachmentContext` system-note
  injection from `src/app/api/assistant/route.ts:81`.

**Model tier routing.** `src/lib/bucky-routing.ts` maps a message to `"flash"` or
`"pro"`. Remap: `flash → gpt-5.6-luna`, `pro → gpt-5.6-terra`. Keep
`selectAssistantModelTier` and its tests unchanged — only the `MODELS` values move.

**Remove the Pro-to-Flash downgrade** at `ai.ts:1597`. It exists because
`gemini-3.1-pro-preview` returns `limit: 0` on the free tier, so every Pro call
failed and silently fell back. On OpenAI, Terra is a real available model and the
fallback would mask genuine errors.

**Done when:** every tool round-trips (create a stay, log an expense, save a
memory, file a document), the ledger records each with before/after state, and
undo still works.

---

## Task 6 — Port the stragglers and replace the retry helper

**Files:** `src/lib/librarian.ts` (4 call sites — one on `MODELS.pro`, one on
`MODELS.flash`), `src/lib/email-processor.ts` (2), and
`src/app/api/documents/analyze-link/route.ts` (4).

**Replace `withGeminiRetry`** (`ai.ts:37`). The current implementation:

```ts
if (status !== 503 && status !== 429) throw err;
if (attempt < retries) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
```

Two retries at 2s and 4s — six seconds total. The free-tier 429s carried
`"retryDelay": "22s"` in `RetryInfo`. **The helper never waited long enough, and
ignored the delay the API handed it.** The replacement must honor OpenAI's
`Retry-After` header rather than using a fixed schedule. Keep the same
`withRetry(fn, retries)` signature so call sites don't churn.

Then remove `@google/generative-ai` from `package.json` and confirm no imports
remain.

**Done when:** `grep -rn "@google/generative-ai" src/ scripts/` returns nothing,
`npm run build` passes, and Tidy Up (librarian) and a Mail Room poll both work.

---

## Task 14 — Reprocess the documents the quota failure skipped

**Depends on tasks 2, 3, and 4.** Do this immediately after the migration lands,
before tasks 7–13.

Eighteen documents are in the archive with a file on disk but no AI analysis —
they were uploaded while the free-tier quota was rejecting calls. The files are
safe (the "disk first, AI second" ordering did its job); only the enrichment is
missing. Once the OpenAI path works, they can be run through it.

### Finding them — the trap

```
total documents: 48
aiSummary IS NULL:     13
aiSummary = '':         5   ← a NULL check silently misses these
falsy (either):        18   ← the real number
```

The five empty-string rows are `Breadloaf Cabin _ Important Phone Numbers.docx`,
`Contact Information.xlsx`, `IMG_4951.jpeg`, `IMG_4952.jpeg`, and
`Annex Improvements Proposal.pdf`. They have `aiExtractedText = ''` too. **Select
on falsy, not null**, or a fifth of the backlog is skipped with no error.

### Constraints

**Do not overwrite human filing.** 11 of the 18 already have a category a family
member assigned by hand after Bucky failed. Backfill `aiSummary`,
`aiExtractedText`, and `tags`; set `categoryId` **only if it is currently null**.
Overwriting Jim's manual filing with a fresh AI guess is a regression, not a fix.

**One file exceeds the AI size limit.** `Bestor_Photos_170.pdf` is 52.4MB against
`AI_SIZE_LIMIT` of 15MB (`file-document.ts:22`). It was correctly skipped, not
failed. Either route it through a page-subset pass or leave it and report it —
do not raise the limit, the ceiling exists for a reason.

**The files are on the Railway volume, not your laptop.** Uploads live on
`breadloaf-app-volume` mounted at `/app/public/uploads`. `railway run` executes
**locally** with production env vars injected — it can reach the database but
**cannot see the volume**. Working out how to run this inside the container is
the main engineering question in this task. Options worth weighing: a one-shot
admin-gated API route, `railway ssh`, or a guarded startup script. Pick one and
say why.

**Check each file exists before processing it.** The volume was added in July
2026; anything uploaded before that may have been wiped by a deploy while its
database row survived. Report unrecoverable rows rather than crashing on the
first missing file.

### Behaviour

- **Update in place. Never create a new `Document` row.** Do not route through
  the create path in `fileDocumentFromBuffer`; reuse the analysis functions only.
- Re-index each updated document (`indexDocument`) so the new summary and text
  become searchable.
- Close any open `archive` `BuckyQuestion` whose document now has both a summary
  and a category, reusing the logic from `ai.ts:1041–1090`.
- Make it **idempotent and resumable** — it will be interrupted. Skip anything
  already enriched so a re-run is safe.
- Log one line per document: enriched, skipped-oversize, file-missing, or failed.

**Done when:** the falsy-`aiSummary` count is 0 (or every remainder is explained
by a missing file or the size limit), no category a human set has changed, and
asking Bucky about the contents of one of the Jul 22 photos returns something
real.

---

# Workstream B — intake intelligence (tasks 7–12)

## Task 7 — Close archive questions filed from the Documents page

**Bug, ~15 minutes, independent of the migration.**

Bucky's `set_document_category` tool closes the matching open `BuckyQuestion`
(`ai.ts:1062`). The Documents page PATCH route does not — it writes `categoryId`
directly:

`src/app/api/documents/[id]/route.ts:41`

```ts
for (const key of ["title", "description", "categoryId", "tags", "assetId"]) {
```

**Consequence:** 10 of the 12 currently-open questions point at documents that
already have a category. The queue is mostly ghosts, which trains the family to
ignore it.

Fix the PATCH route to close matching open `archive` questions when `categoryId`
changes, reusing the logic from `ai.ts:1041–1090`. Then back-fill the 10 stale
production rows.

Verified breakdown of the 12 open questions as of 2026-08-05:

- `Bestor_Photos_170.pdf` → already filed under Photos (**stale**)
- 6 × Jul 22 photos → already Maintenance & Improvements (**stale**)
- 2 × Jul 29 photos → already Maintenance & Improvements (**stale**)
- `Voice Memo Jul 21 1031 AM` → already Maintenance & Improvements (**stale**)
- 2 × Jul 31 voice memos → genuinely uncategorized (**real**)

**Done when:** filing from the Documents UI closes the question, and the open
count drops to 2.

---

## Task 8 — Index answered questions

**Highest-value item in this workstream. Task 10 is worthless without it.**

`src/lib/bucky-context.ts:4`:

```ts
const KNOWLEDGE_SOURCE_TYPES = ["document", "memory", "asset", "maintenance", "expense"];
```

Questions are absent. When a family member answers *"that's Bill and Lois at the
Ripton house, 1962,"* the answer lands in `BuckyQuestion.answer` and is
**invisible to every retrieval path in the system**. Human-supplied answers are
the most valuable and least recoverable information here — nobody can regenerate
what only your father knows — and right now they are write-only.

Fix by folding the answer back into the record it describes:

- Append to the source `Document.aiExtractedText`, **or** create a `JarvisMemory`
  linked via `sourceType`/`sourceId` — prefer the memory, since it carries
  provenance (`source`, `confidence`) and supersession that a text blob doesn't
- Re-index the affected record so the answer becomes searchable
- Do this in `src/app/api/bucky/questions/[id]/route.ts` (the answer path) so it
  covers both Bucky-answered and UI-answered questions

**Done when:** answering a question and then asking Bucky about the subject
returns the answer's content.

---

## Task 9 — Two-stage document intake

**File:** `src/lib/file-document.ts`

Currently one AI call per file (line ~87–104), then file the result. Restructure:

1. **Triage** on `gpt-5.6-luna` — classify into a small closed set:
   receipt/invoice, corporate record, historical photo, property-condition photo,
   voice memo, manual/guide, other.
2. **Type-specific deep pass** with its own schema and prompt. Receipts extract
   vendor/cost/date and stop. Historical photos branch to task 10.

Cost is not a concern: a 4MB photo measured **1,277 prompt tokens**. Two or three
Luna passes per file is a fraction of a cent.

**Preserve:**

- The `sha256` dedupe short-circuit at the top (line 55) — it must stay *before*
  any AI call
- "Save to disk first, AI second" ordering. The comment at line 73 — *never lose
  a family document* — is load-bearing. AI failure must never prevent the
  `Document` row from being created.
- `AI_SIZE_LIMIT` (15MB) and `SAVE_SIZE_LIMIT` (100MB). The 53MB
  `Bestor_Photos_170.pdf` correctly skipped AI. Consider routing oversized PDFs
  through a page-subset pass rather than skipping entirely, but that is optional.

**Done when:** a receipt and a historical photo take visibly different paths, and
the existing single-pass behaviour still holds for everything else.

---

## Task 10 — Historical photo enrichment

The deep pass for photos classified as historical. **Depends on task 8.**

**The design rule that decides whether this works:** pass the family roster
(`src/lib/family-tree.ts` — 40+ people with generations, branches, and birth
order) into the prompt so the model **proposes** rather than asks.

- *"Is this Bill and Lois on the Ripton porch, early 1960s?"* → gets tapped
- *"Who is in this photo?"* → gets ignored

That difference is the entire feature. Open-ended questions produce another pile
of stale rows exactly like the 12 this handoff opens with.

Use the existing `BuckyQuestion` model with `options` populated from the roster
so the answer is a tap, not typing. Respect the `isMinor` redaction rule from
`family-tree.ts` — `/family` is a public route and minors are reduced to first
names.

**Done when:** uploading a historical photo produces a question with named
candidate people, and answering it makes those names searchable (via task 8).

---

## Task 11 — Bulk narration capture

**The motivating scenario:** the owner's father plans to go through boxes in the
attic and tell Bucky the contents of each one.

**Why the current path fails:** forty boxes narrated into Bucky's chat will not
produce forty `save_memory` calls. The model will summarize, and the per-box
detail — the entire point — is lost.

**Build a dedicated path:**

1. Record one long voice memo (the recorder already exists — commit `36d74ab`)
2. Transcribe it (task 4's transcription path)
3. **Segment** the transcript into N discrete items — one per box
4. Show them as an editable list for confirmation or correction
5. Commit each as a `JarvisMemory` and index

**Do not build a `Box` model.** `JarvisMemory` (`schema.prisma:408`) already has
the right fields: `type` (semantic/episodic/procedural), `topic`, `subject`,
`scope`, `source` provenance, `confidence`, `importance`, `validFrom`/`validUntil`,
`status`, `supersededById`. This is a capture-flow problem, not a schema problem.

The governing rule: **promote something to a typed model only when it drives a
feature.** Stays drive the calendar. Expenses drive the 25% splits. Assets drive
the systems notebook. Boxes drive nothing — they are facts. Keep them memories,
or the next request builds a Trees We Tapped model.

**One field worth adding:** a physical-location dimension. "Where is it" is the
question this data exists to answer, and semantic search handles location poorly.
`subject` is doing other work; a dedicated nullable `location` on `JarvisMemory`
is cheap and non-invasive.

**Done when:** a multi-item voice memo produces one memory per item, each
independently retrievable.

---

## Task 12 — Fix `hybridSearch` scaling

**Do this before task 11 ships, not after.**

`src/lib/embeddings.ts:164`:

```ts
prisma.embedding.findMany({ where })   // no take limit
```

Every embedding row is pulled into Node, a float array is `JSON.parse`d per row,
and cosine similarity is computed in JavaScript — **on every Bucky message**.

At today's 65 rows × 3072 dims that is roughly 4MB of JSON parsed per query,
which is already not free. One box-cataloguing session could add 150–200 rows. At
~1,000 rows this is ~60MB per message on a Railway hobby container.

**This is the actual wall the boxes plan hits** — not model capability, not
storage. The data model is fine; the retrieval implementation is O(all rows) in
application memory.

Either:

- move to pgvector with an index (proper fix, needs a migration and a real
  `vector` column — note the current column is `vector String`), or
- pre-filter candidates by keyword and `sourceType` before scoring (cheaper,
  keeps the JSON column, degrades more gracefully)

Task 2 helps for free: 3072 → 1536 dims halves the bytes.

### Two retrieval-quality bugs found on 2026-08-05, fix them in this task

**1. The keyword side matches substrings of short common words, and outranks
the semantic side while doing it.**

`tokenizeSearchQuery` drops a stopword list but keeps any token of 3+ characters
not on it — so `"the heater will not ignite"` tokenizes to
`["heater", "will", "not", "ignite"]`. Those go to Prisma as
`content: { contains: term }`, which is a **substring** match. `"will"` matches
**"William"**. `"not"` matches "notes", "cannot", "notice".

Measured effect: that query's top three hits are the Craig Family Contact
Directory, a corporate meeting agenda, and a cabin action-items list — none
related to heating — while the genuinely correct match (Emergency Generator
Operating Instructions) sits below them. Keyword carries weight `1.15` against
semantic's `1.0` in the fusion, so the noise wins.

Fix by matching on word boundaries rather than substrings, and by requiring
rarer terms — a term appearing in most rows carries no signal. This bug predates
the OpenAI migration; it was simply invisible while semantic scoring was doing
more of the work.

**2. The semantic floor is an absolute constant, and absolute constants are
model-specific.**

`SEMANTIC_FLOOR` in `embeddings.ts` was `0.28`, tuned for `gemini-embedding-2`.
`text-embedding-3-small` produces a compressed distribution, so after the
migration whole queries returned **nothing**: `"the heater will not ignite"`
peaked at 0.252 against all 65 rows and cleared the bar zero times.

Lowered to `0.25` on 2026-08-05 with the measurement recorded in the comment
above it. That is a stopgap. Per-query spread is wide — one query kept 18 rows
at 0.28 while another kept 0 — so **make the floor relative to each query's top
score** rather than absolute. Re-measure whenever the embedding model changes,
and leave a comment saying so.

**Done when:** Bucky message latency is flat as the embedding count grows; the
keyword/semantic fusion still returns the same top results for a set of known
queries; `"the heater will not ignite"` surfaces a heating document rather than
the contact directory; and a nonsense control query (`"purple monkey
dishwasher"`) returns nothing useful.

---

# Workstream C — adoption

## Task 13 — Redesign the homepage

**File:** `src/app/page.tsx` (340 lines)

Currently **14 destinations**: `HUB_LEAD` (Bucky, section I) + 9 photo tiles
(II–X) + 4 text tiles (XI–XIV).

Most family members arrive with two questions: **when am I there, and where do I
sleep.** Fourteen tiles is a catalog, not an entry point, and the goal here is
adoption.

Cut hard to roughly 5 surfaces with Bucky as the front door. Demote the rest
behind a single "everything else" route, or drop them from the hub entirely and
let Bucky reach them through his tools — several already have tool coverage
(`add_grocery_item`, `add_expense`, `add_dinner_signup`, `add_maintenance_record`).

**Preserve the editorial design system:** `.tiles` / `.tile` / `.tile-text` /
`.tile-lead`, the Roman-numeral section sequence, and the `FIG. NN` badge
sequence (which runs over the *photo* tiles only and is separate from the Roman
numerals). Renumber both sequences after the cut, and update the section-count
reference in `CLAUDE.md` and `AGENTS.md`.

Bucky keeping section I and the top-left `.tile-lead` slot is deliberate
(commit `57dc15f`) — asking, filing, and logging all route through him. Keep that.

**Done when:** the hub fits one phone screen without scrolling, and nothing
previously reachable has become unreachable.

---

# Workstream D — identity

## Task 15 — Ask who you are at the door

Today, identity is claimed by finding `/family` and tapping your own face. That
requires discovery, so almost nobody does it: **1 member has ever claimed, and
there are 2 `FamilySession` rows** against 25 claimable adults. Attribution is
effectively unpopulated.

Instead: when a device is through the door but has no identity, ask once with a
dropdown. Not a tile, not a face grid — a dropdown.

### Do this first: set `AUTH_SECRET`

`AUTH_SECRET` is unset, so `FAMILY_PINS` is silently acting as the HMAC key for
three separate token systems:

| Function | Secret chain | Signs |
|---|---|---|
| `getAuthSecret()` (auth.ts) | `AUTH_SECRET \|\| FAMILY_PINS` | door cookies |
| `hashIdentityToken()` (actor.ts) | `AUTH_SECRET \|\| FAMILY_PINS \|\| "breadloaf"` | **identity sessions** |
| `getCalendarFeedSecret()` (auth.ts) | `CALENDAR_FEED_SECRET \|\| FAMILY_PINS` | calendar feed URLs |

So rotating the PINs would log everyone out (fine), **permanently orphan every
`FamilySession`** — stored `tokenHash` values can never be re-derived, so the
rows survive looking live but no token will ever match one — and break any
subscribed calendar feeds. `FamilySession` is the claim audit trail, kept
revoked-not-deleted on purpose, so that loss is not recoverable.

Setting `AUTH_SECRET` to a random value achieves the goal a PIN reset was meant
to achieve — everyone re-enters the door once, so everyone meets the new prompt
— at far lower cost: they use **the PIN they already know**, no new numbers to
distribute, and calendar feeds are untouched because they key off a different
chain. Costs 2 sessions today; costs all 25 if deferred.

```bash
railway variables --set "AUTH_SECRET=$(openssl rand -base64 32)" --service breadloaf-app
```

**Do not rotate `FAMILY_PINS`.**

### Trigger on state, not on the PIN-entry event

Ask when **the door cookie is valid and there is no identity cookie**. Not "just
submitted a PIN."

This is the difference between the feature working and half-working. Door
cookies last 30 days; if the prompt only fires on PIN submission, every already-
logged-in device skips it until its cookie lapses. Triggering on state also means
the feature does not depend on the `AUTH_SECRET` reset — that reset just makes it
happen today rather than gradually.

### The picker

`getDoorFamily(request)` already returns the branch label from the door cookie,
so the list can be pre-filtered before it is rendered:

| Branch | Claimable adults |
|---|---|
| Sandy's | 4 |
| Tom's | 6 |
| Jim's | 6 |
| Greg's | 8 |
| **All** | **25** |

Show the branch (4–8 names), with a "someone else" option that expands to all
25 — families may not use their own PIN.

Apply the same exclusions `/family` already applies: `isMinor` and `deceased`
cannot be claimed. Reuse the helpers in `family-tree.ts` rather than
re-implementing the filter.

`createIdentitySession()` already accepts `claimedVia: "tap" | "pin"`, and
`"pin"` is currently unused — it was added for exactly this. Use it, so the
audit trail distinguishes claiming at the door from tapping a face in the tree.

### Rules

- **Skippable, and the skip must stick.** A prompt that returns every visit
  becomes a nag, and people will pick *any* name to make it stop. That yields
  confidently wrong attribution, which is worse than none: missing is
  recoverable, wrong quietly corrupts a record meant to last decades.
- **Never a gate.** `getCurrentActor()` returning `null` is a supported state —
  its own docstring says callers decide whether that is fatal. Keep it that way.
  The door is the only security boundary; identity is a convenience claim.
- **Keep `/family` tap-to-claim.** It stops being the acquisition path and
  becomes the "change who I am" path, which suits it better.
- **Shared devices are the growing hazard.** A 365-day cookie plus real
  attribution means everything done on the kitchen iPad is recorded as whoever
  claimed it. Add a quiet "not you?" affordance in the chrome — not buried in a
  settings page.

**Done when:** a device with a door cookie and no identity is asked once; the
answer sticks across sessions; skipping is remembered; attribution on a new
bulletin post or Bucky action resolves through `getCurrentActor()` without any
client-supplied name.

---

## Task 16 — Bucky could not find the ancestral photos

A real failure, observed 2026-08-05. A family member asked:

> "bucky, there are some amazing pictures that we've uploaded of people in our
> ancestry, can you point me to any of these?"

Bucky answered that it had no archive results loaded, then suggested looking
under **Family History**, **Ancestry**, **Photographs**, or **Genealogy**.

**The photos were in the archive.** `Bestor_Photos_170.pdf` — 52.4MB, 170
images, filed under Photos. **None of those four categories exist.** The family
member was sent hunting through folders that are not there, which teaches them
the archive does not work.

Three independent failures stacked. Fix all three.

### 16a. The document has no content to match against

Its entire indexed representation is one chunk:

```
"Document: Bestor Photos 170 Category: Photos"
```

Six words. At 52.4MB it exceeds `AI_SIZE_LIMIT` (15MB, `file-document.ts:22`),
so it was never analyzed — no `aiSummary`, no `aiExtractedText` — and
`indexDocument` had only a title to embed. Task 9 lists oversized-PDF handling
as optional. This proves it is not.

Do **not** raise the limit; a 52MB payload still cannot go inline. Instead
sample the PDF — extract a spread of pages as images, analyze those, and build
the summary and extracted text from the sample. For a 170-photo collection even
ten sampled pages should yield era, subjects, and any legible names, which is
the difference between six words and something retrievable.

Then re-run the backfill so this document, and anything else stranded by the
size gate, actually gets indexed.

### 16b. Long conversational queries retrieve the wrong things

`buildBuckyContext(lastUserMessage.content)` (`ai.ts:1417`) embeds the raw user
message. Measured against the live index:

| Query | Result |
|---|---|
| `"ancestry photos"` | ✅ Bestor Photos 170, top hit at 1.000 |
| the full sentence above | ❌ *History of the Inheritance Section*, *Vision*, *Succession Clause* |
| `"old family photographs"` | ❌ nothing |

Retrieval works; the query does not. A hundred characters of conversational
framing — "amazing", "we've uploaded", "point me to any of these" — drags the
embedding toward inheritance and corporate documents. The right answer was
reachable the whole time with two words.

Distill the message into a search query before embedding it. A cheap
`gpt-5.6-luna` call rewriting the turn into search terms is enough, and it can
emit several queries for a multi-part question. Keep the raw message for the
chat turn itself — only the retrieval query changes.

### 16c. Bucky cannot name what is actually in the archive

`knowledgeDirectory` (`bucky-context.ts:320`) is counts only:

```
- 48 family-access archive documents
- N active long-term memories
...
```

Bucky knows 48 documents exist but not one category name, so on a retrieval miss
it invents plausible ones. That is the direct cause of the fictional
**Genealogy** suggestion.

Include the real category list with per-category counts — it is a handful of
tokens and turns "try Genealogy" into "the archive has Photos (6), Corporate
Filings (9), Meeting Minutes (…)". Also instruct Bucky explicitly: when
retrieval returns nothing, say so and name the categories that exist. Never
invent a category name.

**Done when:** the original question returns `Bestor Photos 170`; that document
has a real summary and extracted text; and asking Bucky for something genuinely
absent produces a list of real categories rather than invented ones.

---

# Workstream E — trust

## Execution order (supersedes the numbering)

Tasks 16 and 17 overlap and must run together. Tasks 9, 10, 11 and 15 are
**deferred** until this workstream is done and its numbers are good — they add
more intake paths and more AI passes on top of a pipeline that cannot currently
prove it works, and 9 in particular would rewrite `file-document.ts` a second
time.

Three phases, and the order is the whole point:

**Phase 1 — make failure visible, and measure.** 17a (stop writing placeholder
summaries), 17c (round-trip harness), 17d (golden question set). Run both
harnesses and record the **baseline pass rates against today's broken archive**.
Stop here and report.

Phase 1 ships no fixes on purpose. The harness is what every later claim depends
on, so it gets reviewed before it is used to bless anything. A lenient harness
that reports 100% is worse than no harness — it converts an unknown problem into
a false assurance.

**Phase 2 — fix the causes.** 17b (extraction gaps), 17g (retrieval guard
tuning), 16a (oversized PDF sampling), 16b (query distillation), 16c (real
category directory).

### Phase 1 baseline — measured 2026-08-05, before any fixes

```
round-trip:  74.0%   (13 failures of 50 checks)
golden:      84.0%   ( 4 failures of 25 checks)
```

Every later change is measured against these two numbers. Report both, before
and after, every time. "The script ran" is not a result.

Round-trip failures split into two kinds:

**Eight documents with no content** — the known set, now correctly attributed by
`analysisState`: five `unsupported_type` (legacy `application/msword` — the
Bylaws, Vision, Inheritance History, Succession Clause, Instruction Letter), two
`provider_error` (the maintenance `.docx` pair), one `too_large` (Bestor
Photos). These are 17b and 16a.

**Five documents that hold real content and still fail** — this was not
predicted by this spec, and it is the more interesting result. Two return
**nothing at all** for questions generated from their own text:

```
"How much was charged in sales tax on the July 14, 2026 purchase?"     -> nothing
"How much was shown on the price tag next to the gray modular seating?" -> nothing
```

The answers are provably in those documents. The other three lose to
near-duplicates — the 2025 board minutes lose to the 2024 minutes, the
activities guide loses to the contact directory. See 17g.

**Phase 3 — repair and prove.** 17e (re-analyze and re-embed everything), 17h
(stop the golden harness passing on empty documents), re-run both harnesses,
report before-and-after. Then 17f (surface the numbers).

### Phase 2 result — measured 2026-08-05

```
            baseline    after phase 2
round-trip    74.0%   ->    78.0%
golden        84.0%   ->    92.0%
negative controls: all passing (gains were not bought by loosening)
```

Guards landed at `relativeSemanticFloor 0.70` / `uncorroboratedTopSpread 1.20`
from a 35-pair grid. Two caveats phase 3 inherits:

**The tuning shifted failures as well as removing them.** Two receipt questions
that returned nothing now pass, while *Woods Cabin Committee Records* and the
*2025 Annual Board Meeting Minutes* now return nothing where they previously
ranked. Net positive, not a clean win — re-check after re-analysis rather than
treating the guard values as settled.

**Phase 2 repaired no data, by design.** All eight damaged documents are exactly
as damaged as at baseline. `analysisState` is still `ok 40 / unsupported_type 5
/ provider_error 2 / too_large 1`.

### Phase 3 prediction — state it before running, so the result is falsifiable

Eight of the eleven remaining round-trip failures and **both** remaining golden
failures are the damaged documents. So:

```
round-trip   78.0%  ->  ~92-94%   (11 failures -> ~3)
golden       92.0%  ->  100%      (2 failures -> 0)
```

If re-analysis completes and round-trip sits at 84%, it did not work properly —
do not accept it because the script exited zero.

Three round-trip failures will **survive** phase 3 because they are not content
problems: *2025 Annex Goals* (a window-cost question returns furniture
receipts), *Woods Cabin Committee Records*, and the *2025 board minutes*. Those
are near-duplicate confusion and guard shape. Whether to chase them or accept
~94% as the honest ceiling is a judgement call to make with the numbers in hand.

### Phase 3 result — measured 2026-08-05, after re-analysis and re-tune

```
                 baseline    phase 2    corrected    FINAL
round-trip         74.0%      78.0%         —        94.0%
golden             84.0%      92.0%       68.0%      88.0%
negative controls                                     4 of 4
analysisState   ok 40 / 8 broken                   ok 46 / 2 blank
```

Golden's "corrected" column is 17h removing the hollow passes. The honest
progression is `68.0% -> 88.0%`; comparing 84.0% to 88.0% understates the work
because the first number was counting empty documents as found.

**Re-analysis broke the guard tuning, and that is the lasting lesson.** Spread
1.20 passed 4 of 4 controls before re-analysis and 2 of 4 after — without a line
of retrieval code changing. Forty-six documents gained content, and nonsense
queries began matching newly-populated photo summaries. The guard values are
properties of the corpus, not of the code. **Re-tune after any corpus-wide
change**; the constant in `embeddings.ts` now says so.

The re-tune grid also showed `relativeSemanticFloor` is inert — every value from
0.65 to 0.80 gave identical results. `uncorroboratedTopSpread` is the only real
lever. 1.28 was the minimum recovering all four controls; 1.30 was taken for
margin at identical measured cost.

**The harness is stochastic.** Round-trip questions are generated fresh by a
model each run, so bare runs differ by a few points for no reason. Compare
settings with `scripts/tune-archive-retrieval-guards.ts`, which fixes the
questions across the grid — never by diffing two harness runs.

### The ceiling is 96%, not 100%

Two documents are **genuinely blank**. `Breadloaf Maintenance Log.docx` and
`Breadloaf Maintenance Schedule.docx` are each 721,255 bytes, of which ~1.46MB
uncompressed is four embedded EB Garamond font files. `word/document.xml` is
2,211 bytes and contains no text at all.

`"No readable text could be extracted"` is **correct**, not a bug. No pipeline
can extract text that was never typed. These need re-uploading by whoever holds
the real files — a message to the family, not a task for an agent.

So 48 of 50 round-trip checks and 23 of 25 golden checks is the true maximum.
Current state is 47/50 and 22/25.

### Still open

**17i — the reported pass rates go stale silently.** 17f shipped 2026-08-05 with
live `analysisState` counts but `LATEST_ARCHIVE_VERIFICATION` in
`src/lib/archive-health.ts` as a **hardcoded constant**. Running fifty
model-generated questions per page load is not an option, and the panel is
honestly dated, so the shape is defensible — but a number that looks measured
and is actually a literal is a quieter form of the placeholder summaries that
fooled every health check for a month. Nothing forces a refresh after an upload.

*Near-term:* compare `measuredAt` against the newest document's `createdAt` and
show "measured before N documents were added" when it is behind. A stale number
that announces its staleness is honest.

*Proper:* a small `ArchiveVerification` table the harness writes on each run,
with `getArchiveHealth()` reading the newest row. Then `npm run archive:verify`
updates what everyone sees and the constant disappears. Fold this in whenever
someone is next in that file.

## Task 17h — stop the golden harness passing on empty documents

Found during the phase 2 review. `"what do the bylaws say about succession"`
now **passes** — against a document whose entire indexed content is:

```
"Document: Breadloaf Hill Corporation Bylaws Category: Corporate Filings"
```

It matches the word *bylaws* in its own title. The harness counts it found;
Bucky would surface it and have nothing to say. That is a hollow pass, and it
means golden 92% currently reads better than the experience does.

A golden check must assert the matched document **has real content** —
`analysisState = "ok"` and meaningful analysis text — not merely that it ranked.
Expect this to *lower* the golden number when first applied. That is the point:
it is correcting a measurement error, not a regression.

Re-analysis is deliberately last. Running it before the extraction gaps close
would burn the whole archive through a pipeline that still cannot read `.doc`,
and produce a second set of confident-looking failures.

## Task 17 — Make the archive provably findable

**Priority: highest.** Everything else is a feature; this is whether the system
is worth using at all. A search that misses teaches people the site is a waste
of time, and they do not come back to check whether it improved.

### The audit that triggered this (2026-08-05)

**8 of 48 documents — 17% — hold too little indexed text to be findable.** They
are disproportionately the documents that matter most:

```
   0 chars  Bestor Photos 170                            (52.4MB PDF, the ancestral photos)
  61 chars  BLH CORPORATION BY LAWS.doc
  61 chars  HISTORY OF THE INHERITANCE SECTION 2013.doc
  61 chars  proposed amendment to the succession clause.doc
  61 chars  VISION.doc
  61 chars  Instruction Letter to Brothers.doc
  61 chars  Breadloaf Maintenance Log.docx
  61 chars  Breadloaf Maintenance Schedule.docx
```

The bylaws. The succession clause. The vision document. The founding governance
records of the family corporation, invisible.

### Why nobody noticed for a month

`src/app/api/categorize/route.ts` writes placeholder summaries on failure:

```ts
summary: "Document uploaded — categorize manually or ask Bucky about it"   // 61 chars
summary: "File too large for AI analysis — categorize manually"
```

Those strings are **truthy**. Every "did analysis run?" check — including the
audits run during this session — reported success. `document-title.ts:80` even
carries a regex to recognise these placeholders after the fact, so the codebase
already knows they are junk and works around them rather than preventing them.

**Failure that looks identical to success is the actual defect.** Fix that first
or every later fix is unverifiable.

### 17a. Stop writing lies

Never write a synthesized summary on failure. Leave `aiSummary` and
`aiExtractedText` **null**, and record why in dedicated columns —
`analysisState` (`ok` | `unsupported_type` | `too_large` | `provider_error`) and
`analysisError`. Null is honest and queryable; a friendly sentence is neither.

Delete both placeholder writes in `api/categorize/route.ts`. Once no placeholder
can be written, the detection regex in `document-title.ts` becomes dead code for
new rows — keep it only for historical ones, with a comment saying so.

Note there are **two intake paths** — `lib/file-document.ts` (Bucky attachments,
Mail Room) and `api/categorize/route.ts` (the `/upload` page). They behave
differently. Converge them on one pipeline, or at minimum one failure contract.

### 17b. Close the extraction gaps

`isExtractableType()` accepts docx, xlsx, ODF, csv, txt. It rejects legacy
`application/msword` and `application/vnd.ms-excel`, but the uploader **accepts
those files anyway** — so they are stored and silently never read.

Rule: **for every mime type the uploader accepts there must be either an
extraction path or an explicit refusal at upload time.** Never accept a file you
cannot read. Add legacy `.doc`/`.xls` support, and diagnose the two `.docx`
files that should already have worked.

Oversized PDFs are covered by task 16a.

### 17c. Round-trip retrieval tests — the scalable check

For every indexed document, derive a question from its own content, run
`hybridSearch`, and assert the document appears in the top N. **A document that
cannot be found by asking about its own subject is broken by definition.**

This needs no hand-written fixtures, grows automatically with the archive, and
turns "is retrieval healthy?" into a number. Run it as a script against
production data — not in unit tests, which have no index.

Report a pass rate and list every failure. Wire it into `npm run archive:verify`
alongside the existing checksum check.

**Four ways this harness can lie. Avoid all four:**

1. **A document with no content must FAIL, not be skipped.** The obvious
   implementation generates a question from `aiSummary`, finds it null, and
   skips the row — which silently excludes precisely the 8 documents this task
   exists to catch, then reports 100%. No content is the most severe failure
   there is; score it as one.
2. **Do not derive the question from the title.** "What is in the Breadloaf Hill
   Vision document?" matches on title text and passes trivially. Generate from
   summary and extracted text, and instruct the generator to avoid reusing the
   title's distinctive words. The question should read like something a family
   member would ask without knowing the filename.
3. **Keep N small.** Top-3, not top-20. Bucky only ever sees a handful of
   chunks, so a document ranked 15th is not found in any sense that matters.
4. **Negative controls count toward the pass rate.** Nonsense and
   plausible-but-absent queries must return nothing, and a failure there counts
   the same as a miss. A system that always returns something is guessing, and
   confident guessing is what invented the "Genealogy" category.

Print the pass rate as a single number and a list of every failing document with
its reason. That number is the deliverable — not "the script ran."

### 17d. Golden questions — the "would Dad's question work?" check

A hand-written set of ~25 real questions with expected documents, committed to
the repo and run on demand. Seed it from questions that have actually failed:

| Question | Must return |
|---|---|
| pictures of people in our ancestry | Bestor Photos 170 |
| what do the bylaws say about succession | BLH Corporation By Laws |
| what is our vision for the property | Breadloaf Hill Vision |
| how does inheritance work here | History of the Inheritance Section |
| when is the board meeting | 2025 Annual Board Meeting Minutes |
| who mowed the meadow | Voice Memo Jul 31 |
| the heater will not ignite | a heating/equipment document |
| purple monkey dishwasher | **nothing** (control) |

Include negative controls. A retrieval system that returns something for every
query is not working — it is guessing, and confident guessing is what produced
the fictional "Genealogy" category.

Every future miss reported by a family member gets added here. The set only
grows.

### 17g. Tune the retrieval guards against the harness

Added after phase 1. Five documents hold real, indexed content and are still not
retrievable by questions drawn from that content — two of them return nothing at
all. That is a tuning problem, not a data problem, and it was invisible until
there was a number attached to it.

The suspects are both in `embeddings.ts`:

- `UNCORROBORATED_TOP_SPREAD` (1.3) — requires the top semantic hit to stand
  clear of the runner-up when no keyword matches. This is what correctly kills
  `"purple monkey dishwasher"`. It is likely also killing specific factual
  questions, where the answer sits in one chunk and nothing else in the archive
  resembles it — precisely the case where the top hit has no spread because
  there is no second candidate.
- `RELATIVE_SEMANTIC_FLOOR` (0.72) — retains candidates within a fraction of the
  query's top score.

Both were chosen without data. Now there is a pass rate to optimise against.

**Tune empirically, and report a table** of round-trip and golden pass rates
across a grid of candidate values rather than changing them by feel. The
negative controls are what make this safe: they prevent the obvious cheat of
loosening every guard until everything passes, because loosening also breaks the
controls. **A change that raises the document pass rate while breaking a
negative control is a regression, not an improvement.**

If no single pair of values satisfies both, say so rather than splitting the
difference silently — that result would mean the guard needs a different shape
(for example, keyword evidence gating only the spread test, not the floor), and
that is worth knowing explicitly.

### 17e. Re-analyze everything, then verify

Once 17a and 17b land, re-run analysis across the whole archive — not just the
rows that look broken, since the placeholder bug means "looks broken" was never
reliable. Then re-embed, then run 17c and 17d.

Success is **not** "the script completed." Success is the pass rates from 17c
and 17d, reported as numbers, before and after.

### 17f. Keep it monitored

Surface the 17c pass rate and the count of `analysisState != "ok"` documents
somewhere a human sees — the Documents page header or a Bucky answer. This was
invisible for a month because nothing ever reported it.

**Done when:** every document either has real indexed content or an explicit
recorded reason it does not; the round-trip pass rate is reported and above a
threshold you have chosen deliberately; all golden questions pass including the
negative controls; and the ancestral-photos question works.

---

# Workstream F — adoption

## Task 18 — A mic on Bucky's hub tile

**Sequenced after 15 and 9. Do not build it before those land** — see Routing.

Speaking is the lowest-friction input mode for exactly the people least likely
to use this site: the ones cataloguing boxes in the attic, or standing in the
basement hearing something wrong with the furnace. Typing a paragraph on a phone
is the barrier for that group, and a mic on the front door removes it. This is a
larger adoption lever than anything in the tile grid.

A small mic button in the corner of the `.tile-lead` Bucky tile
(`HUB_LEAD`, `src/app/page.tsx`): tap, record in place, and on stop land in
Bucky with the audio already uploading.

The recorder already exists in `src/app/assistant/page.tsx` — `MediaRecorder`
with `RECORDING_MIME_TYPES` preferring `audio/mp4` so Safari works. Extract it
rather than writing a second one.

### Three gotchas

**The tile is a `<Link>` wrapping its whole body.** A nested `<button>` fires
navigation on tap unless it calls `preventDefault()` and `stopPropagation()`.
The symptom is subtle: the mic appears to work *and* the page jumps to chat.

**The permission prompt breaks the instant-record illusion.** The first tap
raises the browser's mic dialog. Check
`navigator.permissions.query({ name: "microphone" })` first — when permission is
not yet granted, simply navigate to Bucky and let the existing recorder ask
there. Take the fast path only when permission already exists.

**Recording state cannot survive the route change.** Do not start on `/` and
continue on `/assistant`. Record in place in a small overlay on the homepage,
then navigate once the blob exists. The alternative — a MediaRecorder living
above the route, or a blob in IndexedDB — adds failure modes to a path whose
whole purpose is not losing what someone just said.

### Routing — the part that decides whether this helps or hurts

Every attachment currently becomes a permanent `Document`. If this button works,
it produces dozens of five-second notes — *"gate code is 4821"*, *"we're out of
propane"* — filed as archive documents. That is clutter in the exact corpus
Workstream E just spent three phases making findable, and it would push the
round-trip pass rate down for a good reason that looks like a bad one.

A quick note belongs in a `JarvisMemory` or a chat turn. A property walkthrough
belongs in the archive. **That is task 9's triage decision**, which is why this
task sits behind it. If 18 is somehow built first, gate on recording duration as
a stopgap and leave a comment saying it is one.

Attribution comes from `getCurrentActor()` — which is why 15 comes first, or
every note is anonymous.

**Done when:** one tap from the hub starts recording, stopping lands in Bucky
with the audio processing, a short note does not create an archive document, and
the note is attributed to the person whose device it is.

In rough priority order:

1. **The `OPENAI_API_KEY` gate in `hybridSearch`** — task 2's silent-failure trap
2. **No `JSON.parse` of model output anywhere** — Structured Outputs should have
   made all four fallback blocks dead code
3. **Ledger and undo integrity** through the `chatWithAssistant` rewrite
4. **"Disk first, AI second"** still holds in `file-document.ts`
5. **Retry honors `Retry-After`** rather than a fixed schedule
6. **Prompts ported, not rewritten** — the domain rules in them are hard-won
7. Tests pass; no `@google/generative-ai` imports remain

---

## Reference

- Diagnosis of the original failure: this document, "Why this work exists"
- Prior handoff in this style: `docs/family-tree-identity-handoff.md`
- Project conventions: `CLAUDE.md` (authoritative), `AGENTS.md` (mirrored for Codex)
- OpenAI docs: [pricing](https://developers.openai.com/api/docs/pricing) ·
  [file inputs](https://developers.openai.com/api/docs/guides/file-inputs) ·
  [speech to text](https://developers.openai.com/api/docs/guides/speech-to-text) ·
  [rate limits](https://developers.openai.com/api/docs/guides/rate-limits)
