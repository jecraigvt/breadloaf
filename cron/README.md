# Durable site scheduler

This is the one automatic owner of the site's calendar/Mail Room checks and
weekly encrypted backups. It runs on Railway independently of browser visits,
Jeremy's computer, or repository activity. GitHub housekeeping and backup
workflows remain manual diagnostics with their existing scoped credentials and
activation gates; Bucky's separate worker workflows are unchanged.

GitHub documents that public repositories' scheduled workflows disable after
60 days without repository activity. Railway cron starts a service on its UTC
schedule and expects it to exit; an overlapping execution is skipped. The runner
has a five-minute hard deadline so it cannot block the next fifteen-minute tick.
Sources: [GitHub scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
[Railway cron jobs](https://docs.railway.com/cron-jobs).

## Exact service settings

The operator template is [service-settings.json](service-settings.json). The
existing empty service is `breadloaf-scheduler`; configuring/building code is
separate from activating its two lanes.

| Setting | Value |
| --- | --- |
| Repository / branch | `jecraigvt/breadloaf`, `main` |
| Source root / Docker build context | `/cron` |
| Dockerfile | `Dockerfile` inside that isolated context |
| Start command | `node runner.mjs` |
| Cron schedule | `*/15 * * * *` (UTC) |
| Restart policy / replicas | `NEVER`, one replica |
| Suggested replica limits | CPU `0.25`, memory `134217728` bytes (128 MiB) |
| Domain / healthcheck / volume | None |

The image contains only the two dependency-free `.mjs` runtime files and the
official Node 22 runtime. It installs no packages and starts no server, database,
worker, migration, or seed. Keep the source root at `/cron`, so the web app's
Dockerfile and source never become the scheduler build context.

The JSON template describes operator settings; it is not a legacy `railway.json`
or project-wide IaC declaration. Railway's current documentation says new services
cannot opt into deprecated Config as Code. Apply these settings to this service
through Railway's service configuration, preserving all other project services.
[Railway configuration guidance](https://docs.railway.com/infrastructure-as-code).

Supply only these runtime variables:

- `SITE_MAINTENANCE_TOKEN`: the existing separate housekeeping bearer credential.
- `ARCHIVE_BACKUP_TOKEN`: the existing separate backup bearer credential.
- `SITE_HOUSEKEEPING_ENABLED=true`: activate calendar and inbox checks.
- `ARCHIVE_BACKUP_ENABLED=true`: activate weekly backup checks after backup setup
  and recovery proof are complete; until then leave it absent or `false`.

The two tokens must differ. The service refuses database, family-authentication,
worker, Gmail, Calendar, OpenAI, Drive, or backup-encryption credentials. All of
those stay on the existing web service. Missing activation flags pause their
lanes; missing/invalid credentials on an enabled lane fail before any request.
Secrets belong in Railway's variables, never in source or command arguments.

## Tick behavior and completion

Each tick makes one housekeeping POST and one backup status GET when those lanes
are enabled. Requests use fixed `https://breadloafhill.com` endpoints, reject
redirects, limit response size and duration, and print only validated counts and
status. Failure in either lane cannot suppress the other lane. The process exits
nonzero for request failures, reported housekeeping failures, or failed/interrupted
backup status. Provider bodies, private records, and credentials are not logged.

Housekeeping success requires configured IMAP, no mail errors, a successful
calendar pull and outbound retries, and both cleanup tasks succeeding. Idle zero
counts are valid. The separate send-only Gmail OAuth grant does not replace the
web service's IMAP app password.

Weekly backup eligibility uses the most recent Sunday 10:00 UTC boundary and the
web service's durable `due` flag. A delayed/missed Sunday run catches up on a later
tick. A verified success within the current weekly period suppresses another
start, even when the server's six-day minimum has elapsed. That six-day minimum
remains authoritative during initial setup: a fresh manual copy may defer the
first Sunday renewal until it reaches that age. With no verified copy, activation
starts the initial copy on the first eligible tick.

A tick starts a backup at most once. The web service's durable global lease
prevents duplicate jobs, including a race with a manual diagnostic. Starting or
observing `running` reports an in-progress copy, never verified completion.
Subsequent ticks monitor the result instead of waiting up to 55 minutes and
blocking calendar/mail cadence. Only `copyVerified` from the endpoint describes
an independently checked encrypted copy; full restoration status stays separate.
Failed/interrupted copies remain visible and wait six hours before an eligible
restart, preserving the previous verified receipt and avoiding rapid expensive
retries. An uncertain POST response is not retried within the tick.

Inspect the first completed cron execution, its counts, mailbox checked/cursor
state, and pending/error visit count. Inspect a launched backup's later verified
result and retained success time separately. Use Railway's failure notifications
and cron run history for ongoing failures; a missing recent run or stale verified
copy needs investigation. The existing archive health page retains the durable
backup result. Current CLI 5.67.1 supports read-only `railway cron list --service
breadloaf-scheduler`; an intentional `railway cron run` triggers real work and is
an operator action. [CLI reference](https://docs.railway.com/cli/cron).

## Bounded cost and tests

Railway charges measured resource usage within the existing Hobby subscription,
with no additional service subscription. At the suggested 128 MiB/0.25-vCPU caps,
96 daily ticks lasting 5–30 seconds would cost approximately **$0.035–$0.21/month**
in runner compute if each tick continuously consumed both full caps. Actual CPU
is usually lower during HTTPS waits. Hitting the five-minute deadline on every
tick would instead be roughly **$2.08/month** at those caps. These are estimates,
not a billing guarantee; network egress and the web service's actual processing
and uploads are separate. Builds are free. Rates used: RAM $0.000231/GB/minute,
CPU $0.000463/vCPU/minute. [Railway pricing](https://docs.railway.com/pricing/plans).

Run `node --test cron/*.test.mjs` from the repository root. Tests cover UTC weekly
boundaries, missed runs, fresh copies, active leases, failure cooldowns, scoped
tokens, pause/exit behavior, one-attempt startup, honest failure aggregation,
actual redirect rejection, and bounded responses. CI also builds this isolated
image and proves a paused container exits without networking or credentials.
