# Family email access and site repairs

Approved family emails replace the initial PIN with a one-use sign-in link. A
relative normally opens their bookmark and arrives immediately on a remembered
device. On a new device, they enter their own email, select **Send sign-in link**,
open the email, and confirm **Open Breadloaf Hill**. There is no site password.

Links expire after 20 minutes. Opening a link alone does not consume it, so email
security scanners do not invalidate it. Confirming it creates a 365-day device
session that renews during use. The database stores verifiers rather than the
secrets carried by links or cookies. A forwarded, unused link can admit its
recipient as that person; family members should not forward sign-in emails.

## Approved addresses and caretakers

Jeremy authorized the existing family directory as the initial approved list.
The additive rollout migration normalizes email casing and approves only unique
valid addresses belonging to eligible adults. Missing or shared addresses,
minors, deceased people, and nonclaimable profiles remain unapproved. A partial
unique index prevents two approved profiles sharing the same address.

Jeremy's existing curator profile needs the address he supplied. Provision it
after the migration using the operator script with the verified profile ID and
address; the script preserves roles and revokes earlier sessions if the email
changes. Do not place personal addresses or secrets in migration SQL.

Relatives without an approved address choose **Request family access**. That
saves a request and emails approved caretakers. A caretaker associates the request
with an adult directory profile and approves the address in `/access`; the
relative then requests a sign-in link. The request itself grants no access.

`/access` also lets people forget their own remembered devices. Caretakers can
approve or revoke family access. Changes serialize and recheck the acting
caretaker's session before writing, preserving an eligible caretaker. A caretaker
cannot change their own sign-in email or remove their own caretaker access through
the page. Another caretaker, or an authorized operator using the provisioning
script, handles recovery. Face taps and typed names provide attribution only.

## Activation sequence

1. Preserve an encrypted PostgreSQL and original-file snapshot before deployment.
   Follow [archive recovery](archive-recovery.md) and [Drive backups](archive-drive.md).
2. Integrate the verified branch into current GitHub `main`; Railway's connected
   `breadloaf-app` service deploys `main`. Inspect the actual deployment and migration
   results. Do not upload an uncommitted local tree.
3. Provision Jeremy's supplied email on his existing curator profile. Verify the
   directory's approved adults and missing/shared-address list.
4. Set `APP_URL=https://breadloafhill.com` and
   `FAMILY_EMAIL_SIGN_IN_ENABLED=true`. Retain the current `AUTH_SECRET`. Configure
   the property mailbox's separate Gmail HTTPS connection following
   [site mail operation](gmail-site-mail.md) and [mail authorization](gmail-send-authorization.md).
   Railway Hobby blocks outbound SMTP. Set all three `GMAIL_SEND_*` credentials
   together; keep `GMAIL_APP_PASSWORD` for Mail Room IMAP intake. The local test
   SMTP setting must never be set on Railway.
5. Send the requested first sign-in link to Jeremy and verify delivery. Confirm
   sign-in, remembered navigation, caretaker settings, and forgetting a disposable
   device. No test record or paid AI request is needed on production.
6. Retire PIN fallback after email recovery is verified. Preserve the previous
   calendar signing value in `CALENDAR_FEED_SECRET` before removing `FAMILY_PINS`,
   so existing subscribed calendar URLs remain valid. Calendar feed tokens are
   independent read-only credentials.
7. Configure the strong scoped `SITE_MAINTENANCE_TOKEN` on the web service and the
   isolated Railway scheduler, then activate its `SITE_HOUSEKEEPING_ENABLED` lane.
   Follow [the durable scheduler settings](../cron/README.md). Its 15-minute cron
   calls the operation endpoint without a family session or repository activity.
   Inspect the first completed run and actual mailbox/calendar state. The GitHub
   housekeeping workflow retains its existing token/gate for manual diagnostics;
   it has no automatic schedule.

The site remains private when production access configuration is absent.
Emergency, Guide, Weather, install icons, and the existing public cocktail guide
are available before family sign-in. Private original files pass through the
retained-file access handler, including old `/uploads/...` links.

## Reliable family workflows

Visit dates are calendar dates, normalized to UTC storage and displayed consistently
in every location. Calendar and Rooms save locally first, expose pending Google
synchronization, and support editing and room assignment. Room overlaps require
explicit sharing. Durable deletion tombstones prevent Google from recreating a
deleted visit; reconciliation preserves history outside its fetched window.
Google outages no longer block homepage entry or chat.

Pantry inventory is retired without deleting its records. The shopping list remains,
shows request dates, and confirms or rolls back changes. Seasonal checklist reset
archives a complete run transactionally; failures cannot erase the prior season.
Maintenance requires the actual work date and normalizes categories. The expense
ledger reports recorded spending and payers; Jeremy has not defined a reimbursement
policy, so the site and Bucky do not infer amounts owed.

Mail Room scans independently of browser visits, retains originals before advancing
its UID cursor, and retries saved messages using leases. Gmail-authenticated known
senders can create family records. Unknown or unverified messages go to `/mail-room`
for curator review. Approval is for that message, not permanent sender permission.
`MAIL_ROOM_ALLOW_ALL` cannot authorize automatic writes. Old receipts without
retained originals stay completed; review Gmail and the archive before reimporting
them. Sign-in and other site notifications are ignored without retaining their
credential-bearing originals.

Archive search ignores case, supports additional pages, and excludes restricted
records from both results and counts. Original-file containment, safe download
types, bounded public link fetching, verified role checks, and mutation-origin
checks apply on the server. Bucky cannot update private documents through IDs,
change positions through unverified identity claims, or continue writing pantry stock.

The homepage places ordinary tasks first, shows recent or intentionally pinned
notices, and defers resized photographs. Emergency includes 911, the address, official
contacts, and a printable card. Actual property repair providers still need family
confirmation; the page does not manufacture their phone numbers.

## Verification and operation

Ordinary CI exercises unit/API contracts, real PostgreSQL concurrency and rollback
cases, TypeScript, lint, and production builds. Local browser checks use fake email
delivery and disposable profiles/visits/documents. Production providers are disabled
in these tests. The local Bucky task was repaired and restarted using its existing
credentials and policies.

The updated production dependency audit has no critical or high findings. Three
moderate package flags remain in Mammoth's unused CLI dependency chain; no patch
is published. Build-tool advisories are separate from exposed request handlers.
Do not force incompatible major upgrades merely to erase an audit count.

Deployment, actual Gmail delivery, Google Calendar integration, and independent
backup activation must each be verified separately from local code completion.

Outbound mail shares a PostgreSQL-backed 24-hour attempt budget across sign-in,
caretaker requests, and Bucky notifications. `GMAIL_SEND_DAILY_BUDGET` defaults to
100 and accepts integers from 1 to 100. Failed live attempts consume a slot;
local fake SMTP does not. A delivery failure returns an honest error and invalidates
that sign-in link. A budget rejection returns 429 instead of claiming mail is on
its way. See the mail runbook for grant recovery and delivery checks.
