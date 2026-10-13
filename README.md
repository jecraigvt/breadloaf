# Breadloaf Hill

Family property hub for the Craig family home at 3995 Vermont Route 125, Ripton, VT. The app combines visit scheduling, room assignments, property operations, document storage, bulletin posts, grocery tracking, and an AI assistant in a single Next.js app.

## Stack

- Next.js 15 App Router with React 18 and TypeScript
- Prisma ORM with PostgreSQL
- Tailwind CSS plus the editorial cabin-catalog design system in `src/app/globals.css`
- Google Calendar two-way sync via service account
- OpenAI for document analysis and the property assistant; Gemini for audio transcription
- Railway for production deploys

## Core Features

- Hub homepage with editorial masthead, family notes, weather, and quick links
- Shared stays calendar with room assignments and Google Calendar sync
- Shopping list, dinners, bulletin, maintenance, checklists, expenses, guide, and emergency pages
- Document archive with upload, AI categorization, and semantic retrieval support
- Approved-email sign-in links and remembered, revocable family devices

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Create `.env` with at least:

```bash
DATABASE_URL="postgresql://breadloaf:breadloaf@localhost:5432/breadloaf"
OPENAI_API_KEY="..."
GOOGLE_AI_API_KEY="..."
GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}'
GOOGLE_CALENDAR_ID="..."
GMAIL_APP_PASSWORD="..."
GMAIL_SEND_CLIENT_ID="..."
GMAIL_SEND_CLIENT_SECRET="..."
GMAIL_SEND_REFRESH_TOKEN="..."
AUTH_SECRET="a-long-random-value"
FAMILY_EMAIL_SIGN_IN_ENABLED="true"
BUCKY_NOTIFICATION_EMAILS="fallback@example.com"
APP_URL="https://breadloafhill.com"
```

3. Start the app:

```bash
npm run dev
```

Helpful commands:

```bash
npm run build
npm test
npx tsc --noEmit --incremental false
npm run db:migrate
npm run db:seed
npm run archive:verify
npm run archive:retitle
npm run memory:reindex
```

## Deployment

The Railway service is connected to GitHub. A push to `main` starts a production deployment automatically. Do not also run `railway up` after the same push, because that starts a duplicate build.

Standard deploy flow:

```bash
git add ...
git commit -m "..."
git push origin main
railway logs
```

Useful Railway commands:

```bash
railway up # alternative for an intentional local-tree deploy without pushing
railway logs
railway logs --build
```

The `start` script runs Prisma migrations, seeds data, and then starts Next.js:

```bash
prisma migrate deploy && prisma db seed && next start
```

## Environment Variables

- `DATABASE_URL`: Prisma database connection string
- `GOOGLE_AI_API_KEY`: Gemini API key used for Bucky audio transcription
- `GOOGLE_SERVICE_ACCOUNT_KEY`: full JSON service account key for Google Calendar
- `GOOGLE_CALENDAR_ID`: Breadloaf Hill Stays calendar ID
- `FAMILY_EMAIL_SIGN_IN_ENABLED`: enables approved-family email sign-in
- `GMAIL_APP_PASSWORD`: app password for Mail Room IMAP intake from `breadloafhillsite@gmail.com`; outbound Railway mail uses the separate HTTPS connection below
- `GMAIL_SEND_CLIENT_ID`, `GMAIL_SEND_CLIENT_SECRET`, `GMAIL_SEND_REFRESH_TOKEN`: separate send-only Gmail OAuth credentials for sign-in links, caretaker requests, and Bucky notifications
- `GMAIL_SEND_DAILY_BUDGET`: shared live-send attempt limit per 24-hour window, integer 1–100; defaults to 100, counts failures, and excludes local fake SMTP
- `AUTH_SECRET`: required stable random secret used for authentication; do not rotate it during the email-access rollout
- `CALENDAR_FEED_SECRET`: optional separate secret for signed calendar subscription URLs
- `BUCKY_NOTIFICATION_EMAILS`: comma-separated fallback recipients when a question has no named person or that person has no saved email
- `APP_URL`: canonical public site URL used for authentication, redirects, and notification links
- `SITE_MAINTENANCE_TOKEN`: separate bearer credential for scheduled calendar and Mail Room work
- Backup variables and activation gates are documented in [`docs/archive-backup-schedule.md`](docs/archive-backup-schedule.md)
- Railway Hobby blocks SMTP. Configure outbound HTTPS mail using [`docs/gmail-site-mail.md`](docs/gmail-site-mail.md) and [`docs/gmail-send-authorization.md`](docs/gmail-send-authorization.md)

## Calendar Notes

- Local stay records treat `checkOut` as the departure date and use exclusive end-date semantics.
- Google all-day events map directly to that model: `start.date = checkIn`, `end.date = checkOut`.
- Sync now paginates through the full Google Calendar event list before reconciling deletions.
- The iCal feed at `/api/calendar` is no longer public. It requires either a normal authenticated session or a signed feed token.
- The calendar page requests a private token from `/api/calendar/token` and uses it when generating Apple, Google, Outlook, and raw ICS subscription links.

## Authentication

- Approved adults request a one-use, 20-minute link at **Send sign-in link**. Confirming it remembers the device for 365 days, renewed during use; there is no site password.
- Caretakers approve new addresses and revoke access at `/access`. Missing addresses use **Request family access**.
- Sessions and throttling are stored in PostgreSQL. A face tap or typed name does not grant authority.
- Emergency, Guide, Weather, install icons, and the public cocktail guide remain reachable before sign-in. Family documents and originals require server-verified access.
- Production fails closed if authentication is unconfigured. See [`docs/family-access-rollout.md`](docs/family-access-rollout.md) for directory eligibility, rollout sequencing, and verification.

## Archive Safety

- Uploaded files receive a SHA-256 checksum so accidental corruption can be detected.
- Deleting a document moves it to Recently Deleted; the stored file remains recoverable.
- `npm run archive:verify` checks stored files and backfills checksums for older records. Run it from the deployed environment where both PostgreSQL and the upload volume are available.
- Encrypted database-and-original snapshots can be stored in the property Google Drive and verified by downloading the complete encrypted copy. A verified upload is distinct from a successful restore drill. Individual document labels are not automatically changed to claim recovery coverage.
- Setup, scheduling, and restore instructions are in [`docs/archive-backup-schedule.md`](docs/archive-backup-schedule.md), [`docs/archive-drive.md`](docs/archive-drive.md), and [`docs/archive-recovery.md`](docs/archive-recovery.md).

The isolated [Railway scheduler](cron/README.md) is the sole recurring owner of
calendar/Mail Room housekeeping and weekly backups. GitHub housekeeping and
backup workflows are manual diagnostics; routine work does not depend on site
visits, Jeremy's computer, or repository activity.

## Corporation Vault

- The vault has a separate shared passphrase and a 30-minute signed unlock session.
- The first authorized user creates the passphrase directly on the Corporation Vault page; no outside account or deployment setting is required.
- Passwords and recovery notes are encrypted in the browser with AES-256-GCM before they are sent to the server. The database stores ciphertext and never receives plaintext credential fields.
- A fresh page load requires the passphrase again; revealed credentials automatically hide after 30 seconds.
- Keep a paper copy of the passphrase in the corporation's physical records. There is no password-recovery bypass for encrypted credentials.
- The Change action re-encrypts every saved credential before replacing the passphrase. When a custodian should lose access, also rotate the affected utility passwords.

## Bucky Email Notifications

- When Bucky creates a persistent question, the named family member receives an email if their Family Directory record includes an address.
- Questions without a known recipient use `BUCKY_NOTIFICATION_EMAILS`.
- Notification messages contain only a sign-in link. Question text and document details remain inside the authenticated site.
- Outbound notifications use the property mailbox's separate send-only Gmail HTTPS OAuth connection, shared with family sign-in and caretaker mail. The IMAP app password remains for Mail Room intake.
- Notifications are skipped without failing Bucky's work when Gmail is not configured or temporarily unavailable.

## Bucky Memory and Oversight

- Bucky uses bounded operational context plus request-specific long-term retrieval instead of loading the whole archive into every conversation.
- Documents, assets, maintenance, expenses, and durable memories are indexed in rebuildable overlapping chunks for hybrid semantic and lexical search.
- Memories carry scope, subject, provenance, confidence, validity dates, and lifecycle status; updates preserve superseded versions.
- Successful assistant actions are written to the Ledger. Only document filing and position changes currently expose conflict-aware undo.
- Archive processing generates descriptive content-based titles while retaining the original filename as provenance.
- Architecture, failure behavior, maintenance commands, and the production rollout are documented in [`docs/bucky-memory-and-operations.md`](docs/bucky-memory-and-operations.md).

## Active Work — OpenAI Migration

- Document processing has been failing since mid-July because the production Gemini key is on the free tier: 5 requests per minute on flash, and zero quota for pro. Adding billing to the Google project is not available, so the app is migrating to OpenAI.
- The migration is also ~7.5x cheaper on the workhorse model and 10x cheaper on embeddings.
- Thirteen scoped tasks — provider migration, two-stage document intake, retrieval scaling, and a homepage simplification — are specified in [`docs/openai-migration-and-intake-handoff.md`](docs/openai-migration-and-intake-handoff.md).

## Project Structure

```text
src/
  app/
    api/                  REST endpoints for app features
    assistant/            Property assistant
    bulletin/             Family bulletin board
    calendar/             Shared stays calendar
    documents/            Document archive and detail pages
    grocery/              Shopping list (old pantry inventory is retired)
    stays/                Room assignments and occupancy planning
    upload/               Document upload and scan flow
  components/
    layout/               Editorial shell, masthead, and nav
    upload/               Camera and file-drop UI
  lib/
    ai.ts                 Centralized model IDs and AI integrations
    auth.ts               Shared auth and calendar feed token helpers
    bucky-context.ts      Tiered operational and long-term retrieval context
    bucky-undo.ts         Conflict-aware Ledger undo handlers
    document-title.ts     Archive title validation and fallback rules
    embeddings.ts         Chunked indexing and hybrid retrieval
    google-calendar.ts    Google Calendar sync logic
    prisma.ts             Prisma singleton
  middleware.ts           Route protection and calendar feed gating
  types.ts                Shared Prisma-backed UI types
prisma/
  schema.prisma
  seed.ts
```

## Design System

The app is moving toward an editorial "cabin catalog" look:

- warm paper background tones with dark stage framing
- Instrument Serif for display, Instrument Sans for body, JetBrains Mono for labels
- sticky top chrome and bottom nav inside the mobile-shell frame
- reusable editorial classes like `.masthead`, `.chapter-intro`, `.section-head`, `.tiles`, `.note`, `.stay`, `.room`, and `.footer-colophon`

The homepage is already on this system. Several inner pages still use the earlier Tailwind-first layout and can be ported incrementally.

## Property Data

- Four Craig brothers: Tom, Jim, Sandy, Greg
- Eleven room options including the four main bedrooms, annex rooms, loft, Woods Cabin, tents, and off-site stays
- S-Corp expense splitting assumes four equal shareholders

## Current Review Fixes

The latest review pass addressed:

- off-by-one stay syncing between Google Calendar and local stays
- incomplete Google sync pagination that could delete valid stays
- public exposure of the family calendar feed
- missing shared `@/types` module used by calendar, stays, and documents pages
- dropped board metadata on family-member creation
- broken 404 handling on the document detail page
