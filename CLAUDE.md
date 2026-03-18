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
- `GOOGLE_CALENDAR_ID` — Google Calendar ID (tomgilcraig@gmail.com)

## Local Development
```bash
npm install
# Set DATABASE_URL="file:./dev.db" in .env for SQLite locally
# Set GOOGLE_AI_API_KEY in .env
npm run dev
```

## Deployment
```bash
railway up          # Upload and deploy
railway logs        # Check runtime logs
railway logs --build # Check build logs
```
Migrations and seed run at startup (`npm start` script).

## Database
- Run `npx prisma migrate dev` locally for new migrations
- Production migrations are in `prisma/migrations/` as raw SQL
- Seed data: 12 document categories, 11 rooms, 44 checklist items, 28 pantry items, 3 sample dinners

## Project Structure
```
src/app/
  page.tsx              # Homepage hub with rotating photo hero
  calendar/             # Visit calendar (month/list view, Google Calendar sync)
  stays/                # Room assignments and booking
  weather/              # Live weather from Open-Meteo
  grocery/              # Shopping list (quick add, categories, check off)
  dinners/              # Dinner sign-up (who's cooking which night)
  pantry/               # Pantry inventory (track what's in stock)
  checklists/           # Opening/closing checklists for seasonal use
  bulletin/             # Family message board
  assistant/            # AI property assistant (Gemini, calendar-aware)
  documents/            # Document archive with AI categorization
  upload/               # Document scanner (camera + file upload)
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
    file-dropzone.tsx   # Drag-and-drop file upload

src/lib/
  prisma.ts             # Prisma client singleton
  ai.ts                 # Gemini AI (document categorization + assistant)
  google-calendar.ts    # Two-way Google Calendar sync service
  utils.ts              # Formatting helpers
  upload.ts             # File upload handling
```

## Property Details
- **4 Craig brothers:** Tom, Jim, Sandy, Greg — bedrooms named after each
- **11 rooms total:** 4 bedrooms (private bath), Wedge Room, Upper/Lower Annex, Loft, Woods Cabin (compost toilet), Tents, Off-site
- **Bed types:** Greg/Tom/Jim: queen, Sandy: king, all others: twin
- **Address:** 3995 Vermont Route 125, Ripton, VT
- **Google Calendar:** Shared via service account breadloaf-hill@reader-7c045.iam.gserviceaccount.com
- **Photo album:** iCloud shared album (847 photos)

## Conventions
- Use `"use client"` for interactive pages, server components for static/data pages
- API routes follow REST pattern: `route.ts` for GET/POST, `[id]/route.ts` for PATCH/DELETE
- Store user's name in localStorage under key `breadloaf-username`
- Icons from lucide-react, green-700 primary color, stone neutrals
- Hub cards on homepage ordered by assumed frequency of use
- Prisma models use cuid() for IDs, DateTime for timestamps
