# Running Bucky through your computer

Interactive family chat stays on the hosted API. This helper claims background document analysis, archive reviews, and optional website improvements through your signed-in Codex subscription. Railway stores the queue, source files, checkpoints, results, and the action history. Your computer only makes outbound HTTPS connections; there is no incoming port, separate server, or wake timer.

The implementation has been checked with Codex CLI 0.153.3 and `@openai/codex-sdk` 0.153.4. The read-only account check and a small structured-output SDK turn were verified with the existing ChatGPT login. Future CLI changes can make account/quota discovery unavailable; in that case the worker stops claiming and hosted fallback remains available. Codex subscription usage is shared with your own development work.

## September 5 activation status

The application was first activated at commit `1e9064f`; later runbook or installer changes may produce subsequent deployments. Both the queue migration and `20260905130000_allow_pending_document_analysis` are applied. Worker `jeremy-pc` is registered, and its hidden Windows sign-in task runs with ordinary `Limited` privileges. All three capabilities are enabled: document analysis, archive review, and website proposals.

The initial account check reported 31% remaining against the 25% reserve. Synthetic document job `cmtok9bxm0001oe45b2c9qbhl` then completed locally with zero recorded background API generation cost. Its retained original, complete normalized text, summary, and full Ledger undo were verified.

The temporary pause used to test paid fallback was lifted. The final activation check found the task running and the worker unpaused and idle; `--doctor` reported ready with 30% quota remaining. An idempotent reinstall under Windows PowerShell 5.1 passed without elevation or interrupting the worker. Private directory permissions and the absence of a wake timer were verified. These are dated checks; use `--status` and `--doctor` for current readiness.

Local website job `cmtokev5t000joe454531iwfz` also completed with zero recorded API generation cost. Its six CSS lines add keyboard focus indicators to `btn-ember` and `btn-quiet`. Independent [workflow run 33976424511](https://github.com/jecraigvt/breadloaf/actions/runs/33976424511) passed all collection, verification, and publishing steps and opened [PR #1, “Bucky: website improvement”](https://github.com/jecraigvt/breadloaf/pull/1). The PR remains open and unmerged; automatic publication is disabled. Live `/bucky/jobs` and `/upload` pages also passed 390-pixel and 1440-pixel browser checks without errors or overflow.

## Reinstall or register another computer

The steps below are for setup or deliberate reinstallation. The existing `jeremy-pc` registration is complete; repeating registration rotates its credential.

1. Install this checkout's dependencies with `npm install`. Run `codex login` if Codex is not already signed in through ChatGPT. The worker currently supports managed file-based ChatGPT credentials; it does not export tokens from a keychain or copy credentials to Railway.
2. With `DATABASE_URL` pointing to the intended database and both hybrid-work migrations already applied, register a local worker. The registration command writes an opaque worker token outside the repository and stores only its SHA-256 verifier in the database. Repeating registration rotates the token.

   ```powershell
   npx tsx scripts/register-bucky-worker.ts --id jeremy-pc --name Jeremy --provider local --base-url https://breadloafhill.com
   ```

3. Install the per-user sign-in task. It runs with ordinary user privileges and a hidden window. `-StartNow` also starts it immediately; omit that switch to wait until your next sign-in. `-EnableDevelopment` additionally permits background coding jobs.

   ```powershell
   powershell -NoProfile -File scripts/install-bucky-worker.ps1 -StartNow
   ```

4. Check readiness and current status:

   ```powershell
   npx tsx scripts/bucky-worker.ts --doctor
   npx tsx scripts/bucky-worker.ts --status
   ```

The installer puts `config.json`, a separate `token` file, and a launcher in `%USERPROFILE%\.breadloaf-worker`. Windows permissions restrict that directory to you and SYSTEM. `config.json` contains `siteUrl`, `workerId`, `codexPath`, `repository`, `capabilities`, `mode`, `paused`, and optional `pollSeconds` (default 60) and `maxJobMinutes` (default 45). Secrets never belong in the repository or a command-line argument.

For foreground troubleshooting, stop the sign-in task first, then run `npx tsx scripts/bucky-worker.ts --once`. One local worker process runs at a time. The hosted queue separately rejects concurrent live claims for the same worker identity.

## Pause, resume, and remove

```powershell
npx tsx scripts/bucky-worker.ts --pause
npx tsx scripts/bucky-worker.ts --resume
powershell -NoProfile -File scripts/uninstall-bucky-worker.ps1
```

Pausing interrupts a running attempt at the next heartbeat and preserves its confirmed checkpoints. Uninstalling removes the scheduled task and keeps the local configuration for deliberate reuse or credential rotation. Pause or delete the corresponding `BuckyWorker` record when revoking access permanently.

The worker starts no inference if ChatGPT authentication cannot be confirmed, quota cannot be read, or any reported quota window has 25% or less remaining. It checks again before each model turn. One in-flight turn can still consume additional allowance before the next check. Account checks never redeem resets, purchase credits, or send account notifications.

## Recovery and source handling

Every claimed attempt has an expiring server lease. Heartbeats renew it while work is active. Sleep, disconnection, pause, quota exhaustion, or a crash leave the last confirmed checkpoint in Postgres. A replacement attempt receives a new lease; a late result from an old process cannot apply changes.

Documents are processed one text section or PDF page at a time. The worker preserves text sources verbatim and renders each PDF page locally for Codex vision. Page results are checkpointed under deterministic source IDs, so another worker/provider can continue without repeating completed sections. Document text, pages, and credentials are confined to a temporary job directory. Each model run uses a separate Codex home with a local copy of managed authentication, disabled personal plugins/hooks/MCP integrations, no shell or network tools, and a read-only workspace. Normal completion deletes those temporary files; a hard process kill can leave a protected temporary directory until the next worker start cleans it.

API fallback becomes eligible 24 hours after enqueueing, or sooner when someone promotes a pending job. Optional paid work is constrained by the website's monthly budget and per-attempt reservations. Live family chat retains its existing routing and budget priority.

## Website improvement jobs

The trusted helper fetches `origin/main`, creates a detached worktree, and gives Codex a bounded inventory of UI files. Codex returns exact text replacements. The helper validates each path and unique source match, applies replacements only in that worktree, and produces a patch. It never runs generated JavaScript on your computer or sends your production database credentials to the model. Larger or sensitive changes become findings for review.

Completed local patches are picked up by `.github/workflows/bucky-development.yml`. The workflow also handles overdue API work and uses the same result format. Its independent verification checkout runs unit tests, TypeScript, a production build, and mobile/desktop browser smoke checks against disposable Postgres data. The publishing job has credentials but never runs the proposed application. It recomputes the publishing policy from the actual patch.

The initial automatic publishing lane is small CSS changes (at most 100 changed lines) without external resources, generated content, or escaped values. TypeScript/interaction changes create a review PR. Activation currently has `BUCKY_AUTO_PUBLISH=false`. Set it to `true` in GitHub repository variables only when deliberately enabling automatic merges for eligible CSS changes; otherwise every tested patch becomes a PR. Branch protections still apply. Changes to authentication, API handlers, dependencies, migrations, test controls, and workflow files are outside this unattended editing scope.

Stale or unsupported patches are recorded as blocked review items, so they do not prevent later jobs from being picked up. Requeue a stale proposal to generate a new patch against the current `main`. Publishing uses a deterministic branch per job to avoid duplicate PRs.

## Hosted fallback setup

The separate API worker `github-api` is registered, the required GitHub secrets and variables are configured, and `BUCKY_BACKGROUND_ENABLED=true`. Railway has `BUCKY_GITHUB_REPOSITORY=jecraigvt/breadloaf`, a 300-cent monthly background-generation budget, and a 25-cent attempt reservation. Authenticated idle workflow run [33975933995](https://github.com/jecraigvt/breadloaf/actions/runs/33975933995) succeeded.

Paid fallback was then verified with job `cmtokct1w000boe45mhswbbv1` in [run 33976224510](https://github.com/jecraigvt/breadloaf/actions/runs/33976224510). It saved the retained source's complete normalized text, expected summary, and Ledger entry, and recorded 1 cent of generation cost. The monthly budget snapshot was 1 cent spent and 0 reserved. Cancel/retry controls passed, and synthetic fixtures were soft-deleted while preserving audit history.

For replacement setup, register a separate worker with `--provider api`. Its token is saved as `~/.breadloaf-worker/api-token`, separate from the local token. Supply GitHub repository secrets `BUCKY_API_WORKER_TOKEN` and `OPENAI_API_KEY`, plus variables `BUCKY_WORKER_SITE_URL`, `BUCKY_API_WORKER_ID`, and `BUCKY_BACKGROUND_ENABLED=true`. Railway also needs the intended `BUCKY_GITHUB_REPOSITORY` to validate returned proposal URLs. Use secret-input mechanisms without printing credentials or putting them in task prompts.

The workflow runs hourly and can also be dispatched manually with an optional completed development `jobId`. Each pass processes up to eight sequential hosted document/archive sections, stopping when there is no eligible work, the provider is unavailable, or a section exceeds its allowance. It also attempts one eligible development job. The API code generator uses bounded Responses calls and the central `MODELS.pro` setting, rather than an open-ended paid coding session. Nothing runs while `BUCKY_BACKGROUND_ENABLED` is unset.

Deployment, registration, scheduled-task installation, hosted configuration, paid document fallback, independent proposal verification, and the final local readiness check were verified during the authorized September 5 rollout. [The activation record](bucky-hybrid-implementation.md#september-5-activation) contains the job IDs, measured costs, workflow results, and audit cleanup. PR #1 awaits maintainer review; its successful creation is not a production merge.

Official interfaces: [Codex TypeScript SDK](https://learn.chatgpt.com/docs/codex-sdk), [Codex account and rate-limit protocol](https://learn.chatgpt.com/docs/app-server).
