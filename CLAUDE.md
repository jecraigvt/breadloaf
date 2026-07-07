# Breadloaf Hill — Family Property Hub

## Project Overview
Family hub website for the Craig family property at 3995 Vermont Route 125, Ripton, VT. Built with Next.js 14 (App Router), PostgreSQL via Prisma, and deployed on Railway at breadloafhill.com.

## Tech Stack
- **Framework:** Next.js 14, React 18, TypeScript
- **Styling:** Tailwind CSS 3.4 + editorial design system (see Design System below)
- **Fonts:** Instrument Serif (italic display), Instrument Sans (body), JetBrains Mono (labels) via `next/font/google`
- **Database:** PostgreSQL (Railway), Prisma ORM
- **AI:** Google Gemini 3 Flash (document categorization, property assistant)
- **Calendar:** Two-way sync with Google Calendar via service account
- **Weather:** Open-Meteo API (free, no key needed)
- **Hosting:** Railway (hobby plan)
- **Domain:** breadloafhill.com — DNS on Cloudflare (proxied CNAMEs → Railway; apex + www are separate custom domains on the Railway service, each needing its own CNAME target and a `_railway-verify` TXT record)
- **Photos:** iCloud shared album (external link)

## Design System — Editorial Cabin-Catalog
The app uses a "family magazine" editorial style — warm paper tones, italic serif display type, mono-caps eyebrow labels, and Roman-numeral section numbering (I–XIV).

- **Shell frame:** every route renders inside `.stage > .shell` (see `src/app/layout.tsx`). On mobile the shell fills the viewport; on desktop (≥900px) it's a 440px-wide "phone frame" centered on a dark `--deep` stage with a drop shadow.
- **Bottom nav lives INSIDE the shell** (`src/components/layout/nav-bar.tsx`) using `position: sticky; bottom: 0`. Five items: Hub / Dates / Rooms / Guide / Board. The active item has an ember-colored top underline.
- **Design tokens** (CSS variables in `src/app/globals.css`): `--paper` `#f5efe4`, `--paper-2` `#ede5d3`, `--deep` `#1c1a17`, `--ink` `#2a2520`, `--muted` `#6a6055`, plus `--pine`/`--pine-deep` (greens) and `--ember`/`--ember-deep` (oranges) in oklch. Type vars: `--serif`, `--sans`, `--mono`.
- **Component classes** (in globals.css, use these on any page you redesign):
  - `.chrome-top` — sticky top bar with wordmark + mono-caps meta
  - `.masthead` — full-bleed photo hero with scrim, chapter tag, big serif title, pager dashes (see `src/components/layout/masthead.tsx`)
  - `.colophon` — 3-column stat strip
  - `.chapter-intro` — editorial lede with mono-caps number + large serif italic emphasis
  - `.section-head` — section title left (serif italic) + right-side mono caption
  - `.tiles` / `.tile` / `.tile-text` — the 2-col hub grid with `FIG. NN` badges
  - `.note` / `.note.pinned` — bulletin board entries with serif body
  - `.stay` / `.room` / `.cal-*` / `.wx-*` / `.entry` — page-specific components (calendar, rooms, weather, guide), defined but not all pages ported yet
  - `.pull-quote`, `.strip`, `.footer-colophon` — supporting pieces
- **Legacy utilities** (card-hover, hub-card-*, animate-fade-in-up, glass, etc.) are preserved in globals.css so sub-pages that haven't been ported yet keep working.
- **Not yet ported** to the editorial system: calendar, stays, guide, weather, bulletin, and all inner pages still use the original Tailwind styling. The CSS classes exist — when redesigning a page, swap Tailwind card/layout markup for the editorial classes. Full reference designs for these pages live in `.design-handoff/project/pages.jsx` (locally, not checked in).

## Key Architecture Decisions
- Server components for data-fetching pages (homepage), client components for interactive pages
- Google Calendar sync runs on every page load (homepage, calendar, stays, assistant) to keep data fresh
- Service account auth (GoogleAuth, not JWT) for Calendar API
- SQLite locally, PostgreSQL in production — schema is the same
- Deploys: GitHub auto-deploy is enabled (push to `main` deploys); `railway up` also works for deploying without pushing. `.railwayignore` excludes Photos/ dir
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
**GitHub auto-deploy is ENABLED** (verified in Railway dashboard, July 2026): pushes to `main` deploy to production automatically. This changed — before mid-2026 the service was not GitHub-connected and `railway up` was required after every push.
```bash
git push origin main   # Deploys automatically via GitHub integration
railway up             # Alternative: deploys the local directory without pushing
railway logs           # Check runtime logs
railway logs --build   # Check build logs
```
Normal workflow: `git add/commit` → `git push origin main`, then check `railway logs` to confirm the new deploy started. Note `railway up` uploads the local working tree, so uncommitted changes deploy too — prefer push-to-deploy.

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
    masthead.tsx        # Editorial rotating photo masthead (5 images, 6s interval, pager dashes)
    nav-bar.tsx         # Editorial bottom nav (Hub, Dates, Rooms, Guide, Board) — sits inside .shell
    header.tsx          # Page header with back-to-home link (used by un-ported pages)
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

## Deployment Details
- **Pushes to `main` auto-deploy** (GitHub integration enabled on the Railway service). `railway up` deploys the local directory directly.
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
- After a successful PIN login, the login page hard-redirects with `window.location.assign(dest)` rather than `router.replace` — a soft Next client-router nav fired right after `Set-Cookie` can stall inside the RSC request and strand the user on the welcome spinner. See `src/app/login/page.tsx`.
- S-Corp with 4 equal shareholders (Tom, Jim, Sandy, Greg Craig) — expenses split 25% each

## Future Roadmap
- **Smart Home dashboard** — monitor devices at the property
- **Starlink monitoring** — internet speed/uptime dashboard
- **Recipe book** — family favorites at the property
- **Nature/wildlife log**
