# Bucky hybrid work: implementation and rollout

**Written:** September 5, 2026. This describes the implementation in this working tree. No deployment, worker registration, scheduled-task installation, GitHub secret setup, or automatic publication was performed as part of implementing it.

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

## Rollout

1. **Review and deploy the completed change normally.** Startup already runs `prisma migrate deploy`; migration `20260905120000_add_bucky_jobs` adds the queue, worker registry, attempts, and monthly budget. Verify that it applies successfully before starting any worker. This document is not confirmation that production has been migrated.
2. **Register separate local and API workers against the intended database.** Use `npm run worker:register` with `--id`, `--name`, `--provider local|api`, and `--base-url https://breadloafhill.com`. Registration rotates that worker's credential, saves configuration and a private token file outside the repository, and never prints the token. See [local worker setup](bucky-worker-local.md) for exact commands and paths. Supply database access only to registration, not the running local worker.
3. **Set the Railway configuration.** `BUCKY_BACKGROUND_API_BUDGET_CENTS=300` is the default generation cap. Set `BUCKY_GITHUB_REPOSITORY=owner/repo` to the intended repository so publication receipts can verify their origin. `OPENAI_API_KEY` remains on Railway for document/archive fallback and embeddings. Do not add that key to the local worker's configuration.
4. **Install the Windows worker deliberately.** After registration and Codex sign-in, run `scripts/install-bucky-worker.ps1`; use `-EnableDevelopment` to include website proposals and `-StartNow` to start immediately. Otherwise it starts hidden at this user's next sign-in. `npm run worker -- --doctor`, `--status`, `--pause`, and `--resume` provide local controls. Installation does not wake a sleeping computer or require an incoming network listener.
5. **Configure the hosted scheduler and publisher.** `.github/workflows/bucky-development.yml` uses repository variables `BUCKY_WORKER_SITE_URL`, `BUCKY_API_WORKER_ID`, `BUCKY_BACKGROUND_ENABLED=true`, and optionally `BUCKY_AUTO_PUBLISH=true`. Add `BUCKY_API_WORKER_TOKEN` from the registered API worker's private token file and `OPENAI_API_KEY` as GitHub Actions secrets; the latter serves hosted code-generation fallback. Transfer credentials through secret-input mechanisms without displaying them in logs or source. Ensure repository permissions permit the workflow to open PRs; merging also remains subject to repository rules.
6. **Verify the complete path before relying on it.** Submit a small background document, confirm the original exists while pending, run a local attempt, inspect the result and Ledger, and cancel/retry a test task. Then test a deliberately expedited API task, confirm budget accounting, and verify one review-only website proposal through independent checks. Use disposable documents/data for these checks.

The workflow can be dispatched manually, optionally for a completed local development job ID. Its scheduled pass runs hourly and advances up to eight document/archive sections. The data runner's authenticated `/api/bucky/worker/run-api` endpoint advances one section per invocation. A more frequent scheduler may call that endpoint with the API worker's bearer credential; it still obeys lease and budget limits.

## Current limits

- The 24-hour setting is eligibility for fallback, not a completion deadline. Large documents can need many scheduled passes; local processing or a more frequent data scheduler is necessary for prompt completion. Process now does not bypass the scheduler or budget.
- Quota introspection depends on the installed Codex runtime. Unknown quota, no subscription login, a paused worker, or a sleeping/logged-out computer leaves work queued for a later attempt or fallback.
- The $3 background-generation budget does not cap the household's entire OpenAI bill. Chat and existing retrieval embeddings remain separate. Embedding work retries after analysis is saved.
- Archive review creates findings, not an automatic filing cleanup. Website automation is restricted to the presentation allowlist; broader architecture changes still need normal development and review.
- Email intake remains on its existing processor. It does not call the authenticated chat tools or accept arbitrary background-job creation from an email. A later extension would need its own authenticated intent handling; sender text must not grant a curator or board identity.
- Production rollout, subscription processing, paid fallback, and GitHub publication still require their explicit setup and end-to-end verification. No deployment or unattended task was activated by writing this implementation.

## Verification and future changes

Verified during implementation: production build and TypeScript; 163 normal
tests; queue/source/undo/API integration checks against disposable PostgreSQL;
mobile upload/task flows; an authenticated Codex structured-output smoke; and
the built HTTP PDF flow using a local mock provider, including duplicate upload,
retained originals, search indexing, Ledger, and budget settlement. The GitHub
workflow and Windows scripts passed syntax checks; production publication and
persistent worker installation were not exercised.

Run `npm test` for the normal suite. Database tests are opt-in: set
`BUCKY_JOB_TEST_DATABASE_URL` and `BUCKY_HANDLER_TEST_DATABASE_URL` to a disposable
Postgres database, then run the Bucky integration test files with
`npx tsx --test --test-concurrency=1 src/lib/bucky-*.integration.test.ts`.
The queue tests create and remove an isolated schema; the handler tests need the
complete application schema and remove only their fixtures.

For a real HTTP check of the production build, set `BUCKY_TEST_DATABASE_URL` to a
disposable loopback database whose name includes `test`, build the app, and run
`npm run worker:verify:http`. This starts its own local server and mock OpenAI
endpoints, uploads a synthetic PDF, and verifies authentication, retained bytes,
analysis, Ledger, and budget accounting without making a paid provider call.

The repository's older migration history cannot bootstrap an empty database:
its first migration expects an existing `Stay` table. This predates the hybrid
change. For disposable CI databases the workflow creates the vector extension
and uses `prisma db push`; the new queue SQL migration is separately exercised
by the isolated-schema tests. Production continues using its existing migration
history and the additive queue migration.
