# Breadloaf Hill — Family Property Hub

## Project Overview
Family hub website for the Craig family property at 3995 Vermont Route 125, Ripton, VT. Built with Next.js 14 (App Router), PostgreSQL via Prisma, and deployed on Railway at breadloafhill.com.

## Tech Stack
- **Framework:** Next.js 14, React 18, TypeScript
- **Styling:** Tailwind CSS 3.4, mobile-first design
- **Database:** PostgreSQL (Railway), Prisma ORM
- **AI:** Google Gemini 3 Flash (document categorization, property assistant)
- **Calendar:** Two-way sync with Google Calendar via service account
- **Weather:** Open-Meteo API (free, no key needed)
- **Hosting:** Railway (hobby plan)
- **Domain:** breadloafhill.com via Namecheap (CNAME → Railway)
- **Photos:** iCloud shared album (external link)

## Key Architecture Decisions
- Server components for data-fetching pages (homepage), client components for interactive pages
- Google Calendar sync runs on every page load (homepage, calendar, stays, assistant) to keep data fresh
- Service account auth (GoogleAuth, not JWT) for Calendar API
- SQLite locally, PostgreSQL in production — schema is the same
- `railway up` for deployments (not GitHub-connected), `.railwayignore` excludes Photos/ dir
- ESLint ignored during builds (`next.config.mjs`) to prevent agent-generated lint issues from blocking deploys

## Environment Variables (Railway)
- `DATABASE_URL` — PostgreSQL connection (references Postgres service)
- `GOOGLE_AI_API_KEY` — Gemini API key
- `GOOGLE_SERVICE_ACCOUNT_KEY` — Full JSON key for calendar service account
- `GOOGLE_CALENDAR_ID` — Google Calendar ID (Breadloaf Hill Stays calendar on breadloafhillsite@gmail.com)
- `FAMILY_PINS` — Per-family auth PINs (format: `Tom:1234,Jim:5678,Sandy:9012,Greg:3456`)

## Local Development
```bash
npm install
# Set DATABASE_URL="file:./dev.db" in .env for SQLite locally
# Set GOOGLE_AI_API_KEY in .env
npm run dev
```

## Deployment
**IMPORTANT: `git push` alone does NOT deploy.** Railway is NOT connected to GitHub for auto-deploy. You MUST run `railway up` after every commit to deploy.
```bash
git push origin main   # Push to GitHub (backup/history only)
railway up             # REQUIRED — this is what actually deploys to Railway
railway logs           # Check runtime logs
railway logs --build   # Check build logs
```
The correct deploy workflow is: `git add/commit` → `git push origin main` → `railway up`

Migrations and seed run at startup (`npm start` script).

## Database
- Run `npx prisma migrate dev` locally for new migrations
- Production migrations are in `prisma/migrations/` as raw SQL
- Seed data: 18 document categories (including S-Corp: Meeting Minutes, Corporate Filings, Financial Statements, K-1 Forms, Bank Statements, Capital Accounts), 11 rooms, 44 checklist items, 28 pantry items, 3 sample dinners

## Project Structure
```
src/
  middleware.ts           # PIN-based auth — gates all routes except /login and /api/auth

src/app/
  page.tsx              # Homepage hub with photo cards
  login/                # PIN entry page (per-family auth)
  calendar/             # Visit calendar (month/list view, Google Calendar sync)
  stays/                # Room assignments and booking
  weather/              # Live weather from Open-Meteo
  grocery/              # Unified Supplies page (Shopping List + In Stock tabs, pantry scanning)
  dinners/              # Dinner sign-up (who's cooking which night)
  pantry/               # Legacy pantry page (still works, but main access is via /grocery In Stock tab)
  expenses/             # S-Corp expense tracker with financial dashboard and family splits
  checklists/           # Opening/closing checklists for seasonal use
  bulletin/             # Family message board
  assistant/            # AI property assistant (Gemini, function-calling for actions)
  documents/            # Document archive with AI categorization
  upload/               # Document scanner (camera + file upload + link by URL)
  maintenance/          # Maintenance log with timeline view
  emergency/            # Emergency contacts (tap-to-call)
  guide/                # Local guide (swimming, hikes, restaurants)
  family/               # Family directory by Craig branch
  api/                  # API routes for all features

src/components/
  layout/
    hero-banner.tsx     # Rotating photo hero (5 images, 8s interval)
    nav-bar.tsx         # Bottom navigation (Home, Calendar, Scan, Rooms, Archive)
    header.tsx          # Page header with back-to-home link
  upload/
    camera-capture.tsx  # Camera interface for document scanning
    file-dropzone.tsx   # Drag-and-drop file upload (images, PDF, Word, Excel, CSV)

src/lib/
  prisma.ts             # Prisma client singleton
  ai.ts                 # Gemini AI (categorization, assistant with function-calling, pantry scanning)
  google-calendar.ts    # Two-way Google Calendar sync service
  utils.ts              # Formatting helpers
  upload.ts             # File upload handling (images, PDF, Word, Excel, CSV, TXT)
```

## Property Details
- **4 Craig brothers:** Tom, Jim, Sandy, Greg — bedrooms named after each
- **11 rooms total:** 4 bedrooms (private bath), Wedge Room, Upper/Lower Annex, Loft, Woods Cabin (compost toilet), Tents, Off-site
- **Bed types:** Greg/Tom/Jim: queen, Sandy: king, all others: twin
- **Address:** 3995 Vermont Route 125, Ripton, VT
- **Google Calendar:** Dedicated "Breadloaf Hill Stays" calendar on breadloafhillsite@gmail.com, shared with service account breadloaf-hill@reader-7c045.iam.gserviceaccount.com
- **Calendar ID:** aeb2b22ddb5d4bdce900c64d50a01ae870fc57824dc53d8b4dcb118618dd307c@group.calendar.google.com
- **Photo album:** iCloud shared album (847 photos)

## PENDING: Google Calendar Migration
The Google Calendar was switched from Tom's personal calendar (tomgilcraig@gmail.com) to a dedicated
"Breadloaf Hill Stays" calendar on breadloafhillsite@gmail.com (April 2026).

**IMPORTANT — Do this BEFORE anyone loads the site, or the sync will delete existing stays:**

1. Deploy the latest code: `railway up`
2. Run the migration (visit in browser or curl):
   - Browser: `https://breadloafhill.com/api/calendar/migrate`
   - Terminal: `curl -X POST https://breadloafhill.com/api/calendar/migrate`
3. Verify the response shows stays were pushed successfully
4. Check the "Breadloaf Hill Stays" calendar on Google to confirm events appeared
5. After confirming, delete the migration endpoint: `src/app/api/calendar/migrate/route.ts`
6. Remove this "PENDING" section from CLAUDE.md
7. Deploy again: `railway up`

The `GOOGLE_CALENDAR_ID` env var has already been updated in Railway.

## Deployment Details
- **`railway up` is the ONLY way to deploy.** GitHub pushes do NOT trigger deploys.
- **Logs:** `railway logs` (runtime), `railway logs --build` (build)
- **`.railwayignore`** excludes Photos/ dir, screenshots, and service account key from uploads.
- After deploy, check `railway logs` to confirm the app started and migrations ran.

## Conventions
- Use `"use client"` for interactive pages, server components for static/data pages
- API routes follow REST pattern: `route.ts` for GET/POST, `[id]/route.ts` for PATCH/DELETE
- Store user's name in localStorage under key `breadloaf-username`
- Icons from lucide-react, green-700 primary color, stone neutrals
- Hub cards on homepage ordered by assumed frequency of use
- Prisma models use cuid() for IDs, DateTime for timestamps
- Google Calendar sync uses GoogleAuth (not JWT) — see `src/lib/google-calendar.ts`
- Calendar sync runs on homepage, calendar page, stays page, and assistant message

## Conventions
- PIN auth via FAMILY_PINS env var; middleware skips auth when env var is unset (local dev)
- S-Corp with 4 equal shareholders (Tom, Jim, Sandy, Greg Craig) — expenses split 25% each

## Future Roadmap
- **Smart Home dashboard** — monitor devices at the property
- **Starlink monitoring** — internet speed/uptime dashboard
- **Recipe book** — family favorites at the property
- **Nature/wildlife log**
