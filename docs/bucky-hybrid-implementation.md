# Bucky hybrid work: implementation and rollout

**Updated:** September 5, 2026. The application was first activated at commit `1e9064f`. The local worker and hosted scheduler are installed and registered. Local document processing, Ledger undo, paid API fallback, and independent website-proposal verification have passed production checks. The verified proposal is an open review PR; automatic publication is disabled.

The August [Bucky 2.0 handoff](bucky-2.0-architecture-handoff.md) described the long-term custodian. This change delivers its first practical step: durable tasks that survive a closed browser, sleeping computer, interrupted session, or change of processing provider. PostgreSQL owns the work and results; the computer running it is replaceable.

## Operating policy

- **Quick conversation stays on the website's existing API path.** Ordinary chat, chat attachments, and standard Upload & Analyze keep their current behavior. Nothing silently diverts a live conversation into a background queue.
- **Background work is explicit.** Choose Analyze in background from a document preview or batch, or explicitly ask Bucky in chat to leave a document analysis, archive review, or site improvement as a background task. Chat gets queue/status tools without changing its foreground model or waiting for the background result. Reanalysis requires an exact existing archive document ID; the assistant must not invent one. The original is saved immediately; analysis is marked pending. Bucky's tasks at `/bucky/jobs`, linked from Upload and Documents, shows progress, results, cancellation, retries, and Process now.
- **The local subscription is preferred.** A signed-in Codex account can process queued work only when its reported remaining quota is strictly above 25%. Missing, malformed, or unavailable quota means wait, not permission to spend it. One local process and one active lease per worker prevent concurrent work by the same worker.
- **Paid fallback becomes eligible after 24 hours.** Process now makes a queued task eligible immediately; the next scheduled pass still has to collect it. Generation uses the same structured result contract in both paths.
- **Extra background generation defaults to $3 per UTC calendar month.** Reservations count against `BUCKY_BACKGROUND_API_BUDGET_CENTS` before work starts; the default per-attempt reservation is 25 cents (`BUCKY_API_MAX_ATTEMPT_CENTS`). Invalid limits disable spending. Foreground API usage and the small paid embedding calls used by retrieval are separate from this background-generation cap.

“Local subscription” describes where the worker runs and which account pays for inference. Source material is still sent to OpenAI; this is not an offline model. The local worker does not receive production database credentials or the website's API key.

## What tasks can do

| Task | Input and result | Authority |
| --- | --- | --- |
| Document analysis | Original documents and JPG, PNG, or WebP images; PDFs are read page by page and extracted document text is split into complete sections. Produces text, summary, tags, title, and category suggestion. | Applies validated analysis to the attached family document. New uploads can receive a descriptive title/category. Source-version checks preserve intervening edits; uncertain or changed sources remain reviewable. |
| Archive review | Explicit documents, or up to 50 recent family archive records by default. Produces source-linked problems and suggestions. | Findings only; no merges, deletion, or refiling. This review reads archive metadata and summaries rather than reopening every original. |
| Site improvement | A curator or board member's request and an isolated checkout. Produces a patch, explanation, and check results. | The local worker cannot publish. Trusted GitHub checks decide whether to open a review PR or merge an eligible presentation fix. |

Background upload limits are 20 files and 100 MB total per batch, 100 MB per original, 1–500 pages per PDF, and 2,000,000 extracted text characters per document. Unsupported or oversized sources fail explicitly; they are not silently clipped. Recordings and HEIC photos use the standard uploader. Existing audio/video records can only contribute already-retained transcription to background analysis.

Job state, completed sections, leases, attempts, actor attribution, and API reservations are durable database records. Workers authenticate with individually registered bearer credentials. Original-source reads are restricted to the active task and family-access documents. Successful document analysis enters Bucky's Ledger with conflict-aware undo: reversal checks that its recorded after-state still matches before restoring prior analysis. Embedding updates use a durable retry marker so an indexing failure does not erase saved analysis.

## Website change boundary

The publish policy comes from trusted `main`, independently of the proposed patch. Allowed proposal paths are presentation files: `src/app/globals.css`, component TSX/CSS, and page/loading/error TSX. Changes to APIs, auth, database, dependencies, scripts, workflows, or other protected paths are rejected by this lane.

Automatic publication additionally requires all of the following:

1. Only allowed CSS files change, with at most 100 added/deleted lines.
2. Added CSS contains no external resources/imports, generated content, escaped values, or executable-style constructs.
3. Independent tests, TypeScript, production build, and mobile/desktop browser checks pass against a disposable database.
4. The proposal still matches its recorded `main` commit, and `BUCKY_AUTO_PUBLISH=true` is enabled.

Other permitted presentation changes create a PR for review. Model-reported checks or `requiresReview` do not override this gate. Publication uses a separate credentialed job that does not execute the proposed application. A confirmed receipt adds the PR link and publication status to Bucky's task. Merging to `main` can trigger the existing Railway GitHub deployment integration.

## September 5 activation

- **Deployment:** The application was first activated at commit `1e9064f`. Production applied `20260905120000_add_bucky_jobs` and `20260905130000_allow_pending_document_analysis`. The second migration extends the archive's existing SQL check constraint to allow `pending`; the queue migration alone was insufficient for new background uploads. Later operating-guide or installer commits may produce subsequent deployments.
- **Registered workers:** `jeremy-pc` uses the local Codex subscription; `github-api` handles hosted fallback. Their credentials are stored separately outside the repository. Registration is complete; repeating it rotates credentials and requires updating the matching runner.
- **Windows task:** The hidden, per-user sign-in task is installed with ordinary `Limited` privileges. The final activation check confirmed the task running, all three capabilities enabled, and the worker unpaused and idle. `--doctor` reported ready with 30% quota remaining against the 25% reserve; the initial reading had been 31%. These are activation snapshots, not live readings. The temporary API-test pause was lifted. An idempotent reinstall under Windows PowerShell 5.1 passed without elevation or interrupting the worker; private directory permissions and the absence of a wake timer were verified.
- **Railway:** The background generation budget is 300 cents per UTC month, with a 25-cent attempt reservation. `BUCKY_GITHUB_REPOSITORY` is `jecraigvt/breadloaf`. Hosted provider credentials remain outside source control and are not supplied to the local worker.
- **GitHub:** The hourly workflow is enabled. Authenticated idle run [33975933995](https://github.com/jecraigvt/breadloaf/actions/runs/33975933995) succeeded. `BUCKY_AUTO_PUBLISH=false`; verified website proposals require review.

### Verified in production

Synthetic document job `cmtok9bxm0001oe45b2c9qbhl` completed through `jeremy-pc` with zero recorded background API generation cost. The original bytes were retained, and the full normalized source text and summary were saved. The resulting Ledger action was undone successfully, restoring every changed document field. This verifies the local subscription path and its undo behavior; it does not measure paid fallback.

Paid API job `cmtokct1w000boe45mhswbbv1` completed through `github-api` in [workflow run 33976224510](https://github.com/jecraigvt/breadloaf/actions/runs/33976224510). Original bytes, the complete normalized source text, the expected summary marker, and its Ledger entry were verified. Generation cost was recorded as 1 cent; the monthly budget then showed 1 cent spent and 0 reserved against its 300-cent limit. These are measured rollout values, not a forecast or a current bill reading.

Cancel and retry controls passed. The three synthetic document fixtures were soft-deleted through the existing document-delete route, preserving their audit records. The local analysis was undone before its fixture was deleted.

Website job `cmtokev5t000joe454531iwfz` completed locally with zero recorded API generation cost. It proposed six CSS lines adding keyboard focus indicators to `btn-ember` and `btn-quiet`. [Workflow run 33976424511](https://github.com/jecraigvt/breadloaf/actions/runs/33976424511) passed collection, independent verification, and the publishing step; verification included the production build and browser checks. It opened [PR #1, “Bucky: website improvement”](https://github.com/jecraigvt/breadloaf/pull/1). The PR is open and unmerged, as required by the disabled automatic-publication setting. A successful publishing step here means the review PR was created, not that its patch reached production.

Live `/bucky/jobs` and `/upload` pages passed browser checks at 390-pixel and 1440-pixel widths without browser errors or horizontal overflow. The local worker's final readiness check confirmed all three capabilities, an unpaused/idle state, and 30% remaining quota.

### Ongoing operation

The activation checks are complete. Review PR #1 separately before merging; automatic publication remains disabled. Use worker status and quota checks for current readiness, and inspect the monthly budget rather than treating rollout measurements as ongoing availability or spending guarantees.

For reinstallation, credential rotation, and local controls, use [the worker operating guide](bucky-worker-local.md). Database access belongs only in registration and deployment tools. Never add it or the hosted API key to the running local worker's configuration.

The workflow can be dispatched manually, optionally for a completed local development job ID. Its scheduled pass runs hourly and advances up to eight document/archive sections. The data runner's authenticated `/api/bucky/worker/run-api` endpoint advances one section per invocation. A more frequent scheduler may call that endpoint with the API worker's bearer credential; it still obeys lease and budget limits.

## Current limits

- The 24-hour setting is eligibility for fallback, not a completion deadline. Large documents can need many scheduled passes; local processing or a more frequent data scheduler is necessary for prompt completion. Process now does not bypass the scheduler or budget.
- Quota introspection depends on the installed Codex runtime. Unknown quota, no subscription login, a paused worker, or a sleeping/logged-out computer leaves work queued for a later attempt or fallback.
- The $3 background-generation budget does not cap the household's entire OpenAI bill. Chat and existing retrieval embeddings remain separate. Embedding work retries after analysis is saved.
- Archive review creates findings, not an automatic filing cleanup. Website automation is restricted to the presentation allowlist; broader architecture changes still need normal development and review.
- Email intake remains on its existing processor. It does not call the authenticated chat tools or accept arbitrary background-job creation from an email. A later extension would need its own authenticated intent handling; sender text must not grant a curator or board identity.
- Automatic publication is disabled. The verified website proposal remains an open review PR until a maintainer merges or closes it.

## Verification and future changes

Verified during implementation: production build and TypeScript; the normal
tests; queue/source/undo/API integration checks against disposable PostgreSQL;
mobile upload/task flows; an authenticated Codex structured-output smoke; and
the built HTTP PDF flow using a local mock provider, including duplicate upload,
retained originals, search indexing, Ledger, and budget settlement. The GitHub
workflow and Windows scripts passed syntax checks. The activation results above
record the subsequent production and persistent-worker checks separately.

Run `npm test` for the normal suite. Database tests are opt-in: set
`BUCKY_JOB_TEST_DATABASE_URL` and `BUCKY_HANDLER_TEST_DATABASE_URL` to a disposable
Postgres database, then run the Bucky integration test files with
`npx tsx --test --test-concurrency=1 src/lib/bucky-*.integration.test.ts`.
The queue tests create and remove an isolated schema; the handler tests need the
complete application schema and remove only their fixtures.

Also run `npx tsx --test src/lib/document-analysis-migration.test.ts` with
`BUCKY_JOB_TEST_DATABASE_URL` pointing to the disposable database. This test
reconstructs the actual historical `Document_analysisState_check`, proves that
it rejects `pending`, applies `20260905130000_allow_pending_document_analysis`,
and verifies that pending uploads and subsequent analysis transitions work while
the four historical states remain valid and unknown states remain rejected.

For a real HTTP check of the production build, set `BUCKY_TEST_DATABASE_URL` to a
disposable loopback database whose name includes `test`, build the app, and run
`npm run worker:verify:http`. This starts its own local server and mock OpenAI
endpoints, uploads a synthetic PDF, and verifies authentication, retained bytes,
analysis, Ledger, and budget accounting without making a paid provider call.

The repository's older migration history cannot bootstrap an empty database:
an early migration alters `Stay` before its creation runs. This predates the hybrid
change. For disposable CI databases the workflow creates the vector extension
and uses `prisma db push`; the new queue SQL migration is separately exercised
by the isolated-schema tests. `prisma db push` does not reproduce historical SQL
check constraints, so it cannot replace the focused constraint regression test.
Production uses its existing migration history and both additive hybrid-work
migrations; do not use a database reset or `db push` to repair production history.
