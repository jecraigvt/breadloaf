# Breadloaf Hill

Family property hub for the Craig family home at 3995 Vermont Route 125, Ripton, VT. The app combines visit scheduling, room assignments, property operations, document storage, bulletin posts, grocery tracking, and an AI assistant in a single Next.js app.

## Stack

- Next.js 14 App Router with React 18 and TypeScript
- Prisma ORM with SQLite locally and PostgreSQL in production
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
DATABASE_URL="file:./dev.db"
GOOGLE_AI_API_KEY="..."
GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}'
GOOGLE_CALENDAR_ID="..."
FAMILY_PINS="Tom:1234,Jim:5678,Sandy:9012,Greg:3456"
```

3. Start the app:

```bash
npm run dev
```

Helpful commands:

```bash
npm run build
npx tsc --noEmit --incremental false
npm run db:migrate
npm run db:seed
```

## Deployment

This project is **not** auto-deployed from GitHub. Pushing to `origin` only updates the repository history. Production deploys happen through Railway.

Standard deploy flow:

```bash
git add ...
git commit -m "..."
git push origin main
railway up
railway logs
```

Useful Railway commands:

```bash
railway up
railway logs
railway logs --build
```

The `start` script runs Prisma migrations, seeds data, and then starts Next.js:

```bash
prisma migrate deploy && prisma db seed && next start
```

## Environment Variables

- `DATABASE_URL`: Prisma database connection string
- `GOOGLE_AI_API_KEY`: Gemini API key
- `GOOGLE_SERVICE_ACCOUNT_KEY`: full JSON service account key for Google Calendar
- `GOOGLE_CALENDAR_ID`: Breadloaf Hill Stays calendar ID
- `FAMILY_PINS`: comma-separated `Name:PIN` pairs used for login

## Calendar Notes

- Local stay records treat `checkOut` as the departure date and use exclusive end-date semantics.
- Google all-day events map directly to that model: `start.date = checkIn`, `end.date = checkOut`.
- Sync now paginates through the full Google Calendar event list before reconciling deletions.
- The iCal feed at `/api/calendar` is no longer public. It requires either a normal authenticated session or a signed feed token.
- The calendar page requests a private token from `/api/calendar/token` and uses it when generating Apple, Google, Outlook, and raw ICS subscription links.

## Authentication

- Middleware protects all app routes when `FAMILY_PINS` is configured.
- If `FAMILY_PINS` is unset, auth is skipped to make local development simpler.
- After login, the app stores an auth cookie and the current family name in local storage under `breadloaf-username`.

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
