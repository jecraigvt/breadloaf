# Breadloaf Hill

Family property hub for the Craig family home at 3995 Vermont Route 125, Ripton, VT. The app combines visit scheduling, room assignments, property operations, document storage, bulletin posts, grocery tracking, and an AI assistant in a single Next.js app.

## Stack

- Next.js 14 App Router with React 18 and TypeScript
- Prisma ORM with PostgreSQL
- Tailwind CSS plus the editorial cabin-catalog design system in `src/app/globals.css`
- Google Calendar two-way sync via service account
- Google Gemini for document categorization and the property assistant
- Railway for production deploys

## Core Features

- Hub homepage with editorial masthead, family notes, weather, and quick links
- Shared stays calendar with room assignments and Google Calendar sync
- Grocery, pantry, dinners, bulletin, maintenance, checklists, expenses, guide, and emergency pages
- Document archive with upload, AI categorization, and semantic retrieval support
- PIN-based family auth via `FAMILY_PINS`

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Create `.env` with at least:

```bash
DATABASE_URL="postgresql://breadloaf:breadloaf@localhost:5432/breadloaf"
GOOGLE_AI_API_KEY="..."
GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}'
GOOGLE_CALENDAR_ID="..."
FAMILY_PINS="Tom:1234,Jim:5678,Sandy:9012,Greg:3456"
GMAIL_APP_PASSWORD="..."
AUTH_SECRET="a-long-random-value"
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
- `FAMILY_PINS`: comma-separated `Name:PIN` pairs used for login
- `GMAIL_APP_PASSWORD`: app password for the existing `breadloafhillsite@gmail.com` inbox and Bucky notifications
- `AUTH_SECRET`: recommended long random secret used to sign login sessions; falls back to `FAMILY_PINS` when omitted
- `CALENDAR_FEED_SECRET`: optional separate secret for signed calendar subscription URLs
- `BUCKY_NOTIFICATION_EMAILS`: comma-separated fallback recipients when a question has no named person or that person has no saved email
- `APP_URL`: public site URL used in notification links

## Calendar Notes

- Local stay records treat `checkOut` as the departure date and use exclusive end-date semantics.
- Google all-day events map directly to that model: `start.date = checkIn`, `end.date = checkOut`.
- Sync now paginates through the full Google Calendar event list before reconciling deletions.
- The iCal feed at `/api/calendar` is no longer public. It requires either a normal authenticated session or a signed feed token.
- The calendar page requests a private token from `/api/calendar/token` and uses it when generating Apple, Google, Outlook, and raw ICS subscription links.

## Authentication

- Middleware protects all app routes when `FAMILY_PINS` is configured.
- If `FAMILY_PINS` is unset, auth is skipped only in local development. Production returns 503 rather than exposing the site.
- After login, the app stores a signed 30-day session cookie without the PIN and the current family name in local storage under `breadloaf-username`.
- Login attempts are throttled in memory per app instance.
- The agreed replacement is a lightweight family-tree claim flow with unique memorable phrases, long-lived device sessions, optional recovery email, and server-verified member attribution for Bucky and uploads. Product decisions, UI direction, current-system findings, and implementation steps are recorded in [`docs/family-tree-identity-handoff.md`](docs/family-tree-identity-handoff.md).

## Archive Safety

- Uploaded files receive a SHA-256 checksum so accidental corruption can be detected.
- Deleting a document moves it to Recently Deleted; the stored file remains recoverable.
- `npm run archive:verify` checks stored files and backfills checksums for older records. Run it from the deployed environment where both PostgreSQL and the upload volume are available.
- `Local copy only` is intentionally shown until off-site backup storage is added. Sensitive vault documents should not be uploaded until encrypted storage and recovery procedures are configured.

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
- Outbound notifications use the existing `breadloafhillsite@gmail.com` app password, so no additional email-service account is required.
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
    assistant/            Gemini-powered property assistant
    bulletin/             Family bulletin board
    calendar/             Shared stays calendar
    documents/            Document archive and detail pages
    grocery/              Shopping list and pantry entrypoint
    stays/                Room assignments and occupancy planning
    upload/               Document upload and scan flow
  components/
    layout/               Editorial shell, masthead, and nav
    upload/               Camera and file-drop UI
  lib/
    ai.ts                 Gemini integrations
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
