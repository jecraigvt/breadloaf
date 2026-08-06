# Breadloaf Hill — Family Property Hub

## Project Overview
Family hub website for the Craig family property at 3995 Vermont Route 125, Ripton, VT. Built with Next.js 14 (App Router), PostgreSQL via Prisma, and deployed on Railway at breadloafhill.com.

## Tech Stack
- **Framework:** Next.js 14, React 18, TypeScript
- **Styling:** Tailwind CSS 3.4 + editorial design system (see Design System below)
- **Fonts:** Instrument Serif (italic display), Instrument Sans (body), JetBrains Mono (labels) via `next/font/google`
- **Database:** PostgreSQL (Railway), Prisma ORM
- **AI:** OpenAI (migrated from Gemini, August 2026 — the Google key was stuck on a free tier capped at 5 requests/minute and no more billing-enabled Google projects were available). Model IDs centralized in the exported `MODELS` const in `src/lib/ai.ts` — never hardcode a model ID elsewhere. `gpt-5.6-luna` for categorization and chat, `gpt-5.6-terra` for heavy analysis, `text-embedding-3-small` (1536-dim) for retrieval, `gpt-4o-mini-transcribe` for audio. Structured Outputs (`json_schema`) is used throughout — **never parse model output with a regex and a JSON.parse fallback**; that pattern silently degraded bad output into confident "Other" filings for a month. If the embedding model changes, run `railway run npx tsx scripts/re-embed.ts` to rebuild vectors in the new space.
- **Calendar:** Two-way sync with Google Calendar via service account
- **Weather:** Open-Meteo API (free, no key needed)
- **Hosting:** Railway (hobby plan)
- **Domain:** breadloafhill.com — DNS on Cloudflare (proxied CNAMEs → Railway; apex + www are separate custom domains on the Railway service, each needing its own CNAME target and a `_railway-verify` TXT record)
- **Photos:** iCloud shared album (external link)

## Design System — Editorial Cabin-Catalog
The app uses a "family magazine" editorial style — warm paper tones, italic serif display type, mono-caps eyebrow labels, and Roman-numeral section numbering (I–V on the homepage hub).

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
- PostgreSQL in production. schema.prisma is checked in with `provider = "postgresql"`, so `DATABASE_URL="file:./dev.db"` alone no longer works locally — to dev against SQLite, temporarily flip the provider to `sqlite`, `npx prisma db push && npx prisma db seed`, and flip it back before committing (verified July 2026). Note `mode: "insensitive"` queries (ai.ts room lookup, documents/pantry routes) are postgres-only and will error at runtime on SQLite.
- Deploys: GitHub auto-deploy is enabled (push to `main` deploys); `railway up` also works for deploying without pushing. `.railwayignore` excludes Photos/ dir
- ESLint ignored during builds (`next.config.mjs`) to prevent agent-generated lint issues from blocking deploys

## Identity: the door and the claim (August 2026)
Two independent layers. Do not merge them.

- **The door** = the existing shared `FAMILY_PINS` cookie. This is the only security
  boundary and it is unchanged. It is what keeps strangers out.
- **Identity** = which family member a device belongs to. Inside the family this is a
  convenience claim, **not a secret** — there is no per-person credential yet, which is
  what makes claiming a single tap.

**Claiming happens at the door, not by discovery.** A device with a valid door cookie and
no identity is asked once, with a dropdown pre-filtered to the branch its PIN belongs to
(4–8 names, with "someone else" expanding to all). Tapping a face on the plate still works
and is now the *change who I am* path rather than the acquisition path — discovery-based
claiming had reached one person out of twenty-five.

The prompt triggers on **state** (door cookie present, identity absent, skip not recorded),
never on the PIN-submit event: door cookies last 30 days, so an event trigger silently
skips every device already logged in. Skipping is remembered for the identity lifetime,
because a prompt that returns every visit makes people pick any name to silence it, and
confidently wrong attribution is worse than none. It never gates access —
`getCurrentActor()` returning null is a supported state.

`AUTH_SECRET` **must stay set.** It is unset by default, in which case `FAMILY_PINS`
silently becomes the HMAC key for door cookies, identity session hashes, *and* calendar
feed tokens — so rotating the PINs would permanently orphan every `FamilySession`, whose
`tokenHash` values cannot be re-derived.

Because the door already stops outsiders, identity could be frictionless now and hardened
later per person: writing a `FamilyCredential` locks that one profile so re-tapping it
needs a PIN, while everyone else keeps tapping. No flag day, no migration.

Re-claiming an already-claimed profile is allowed **on purpose** — without a credential,
blocking it would strand anyone who gets a new phone. "Claimed" means in use, not locked.
`FamilySession` rows are revoked, never deleted, so they double as the claim audit trail.

Attribution must come from `getCurrentActor(request)` in `src/lib/actor.ts` — never from a
name in a request body and never from `localStorage["breadloaf-username"]`. Existing write
routes still trust client-supplied names; converting them is deliberately **not** done yet.

## Family tree data model
The relationship graph is the source of truth; `FamilyMember.branch` is a derived cache.

- **Parent edges attach to individual parents, never to a couple.** Sandy's daughter Riley
  is his and Kirsten's, while Sandy's current marriage is to Andrea — a couple-as-container
  model reparents her onto Andrea. Couples are grouped at render time instead.
- **Spouse edges** are stored one-directional with `status` (`current` | `former`) and read
  symmetrically via `partnersOf()`.
- **Lineage is derived and three-valued**, never a stored label: `descendant` (reachable
  descending from a branch root), `ancestor` (reachable ascending), `affine` (attached only
  through a spouse edge — every in-law family). `deriveLineageClasses()` computes it from
  the edges. **Do not add a column for it** — that is exactly how `branch: null` came to
  mean three different things at once (Bill and Lois as forebears, Lorenza as a childless
  second wife, and any in-law parent), which would have rendered Colleen's parents as Craig
  forebears.
- **`branch` is decorative.** It answers "whose territory" for Craig descendants and simply
  does not apply to anyone else. It is a cached derived value, so **any write that adds
  edges must re-derive and write it back** or the plate tints people wrong with nothing to
  indicate why. Derivation seeds from `isBranchRoot` (the four brothers) — NOT from "has a
  branch and no parents", because an inferred rule promotes married-in spouses to roots on
  the second run.
- **`isBranchRoot` and `isFounder` are honours, not traversal seeds.** They earn the branch
  tints and the founders' mark. The plate viewport must follow edges from wherever it is
  centred and never consult them, or a family that does not descend from the four brothers
  has nowhere to render.
- **Minors** (`isMinor`) are reduced to a first name and cannot claim, since `/family` is a
  public route. Adults keep their surname. `deceased` also blocks claiming. Minor status is
  **never inferred** — a proposed change touching a possible minor stops and asks.
- **Generations above the branch split** (Bill and Lois) classify as `ancestor` and render
  in "Forebears" without descending. Adding further generations upward needs no schema or
  layout change.
- A **divorced couple** produces two units, one anchored on each partner. `ancestorUnitIds`
  drops the redundant one, and the rule is asymmetric on purpose — only an earlier unit may
  absorb a later one, or both halves eliminate each other.

## The plate — the only `/family` view
A circular chart: generations as growth rings, relatives nested inside their own slice of
arc. Layout lives in `src/lib/family-plate.ts`, drawing in
`src/components/family/family-plate.tsx`. The scrolling roster it replaced was removed
July 2026 — everyone stays reachable because the person sheet lists parents and children
as links, and the trail re-centres.

**The plate is a viewport, not a model.** It stores nothing: `buildDescentPlate` /
`buildAscentPlate` take any person as centre and `layoutPlate` prunes what will not fit.
The graph is the web; the plate is a magnifying glass slid across it. Anything that writes
to `FamilyMember` / `FamilyRelationship` changes what it draws, with no plate work at all.

**Two directions.** Descent walks children; ascent walks parents. Ascent **doubles** every
ring where descent narrows, so the 440px shell holds two descent rings but only one ascent
ring — the rest is reached by re-centring, which *is* the branch chooser. In ascent both
parents are equally blood from the viewer's position, so **neither is ranked**: each gets
an equal wedge and its own spoke, and `parentIds` order decides only clockwise placement.

**In-law families are unreachable in descent.** From Bill and Lois looking down, Colleen's
parents never appear at any depth. Ascent is the only way to see them, which is why it is
not optional once the graph holds more than one family.

**Two pruning rules bound the view at any graph size:** depth (N rings), and never
auto-crossing into a lineage the centre does not belong to. The binding constraint is
visual, not computational — `MIN_BRANCH_DEGREES = 52` fits roughly seven branches per ring.

**Navigation is spatial, not a form control.** The `.plate-trail` above the plate is the
blood line down to whoever is centred; tapping back up it widens the view. Tapping a name
on the plate opens the person sheet, which offers "Centre the plate on X" for going down.
`ancestorPath()` picks the blood parent at each step — NOT `parentIds[0]`, which is sorted
by birth order and would follow the married-in parent (Judy outranks Tom) and dead-end.

Three rules carry the meaning:

- **The viewer picks the centre.** `isFounder` is an honour flagged on Bill and Lois, never
  a consequence of being centred — otherwise adding a generation above them would silently
  crown a new couple every time the ancestry grows.
- **The partner shown beside someone is whoever CO-PARENTED the people on the plate**, not
  their current spouse. That puts Lois beside Bill and Kirsten beside Sandy; later marriages
  (Lorenza, Andrea) are stated at the rim instead. One rule, no special cases.
- **Bloodline is position, not colour.** Surnames can't carry descent (Vanessa is blood but
  reads "Devlin"; Colleen married in but reads "Craig"), so the blood relative sits on the
  inner radius with the only spoke to the centre — and that is the *whole* signal.
  `tintOf()` must not mute the non-blood half of a couple. That only looked deliberate
  while every centre was a Craig; once any person can be centred it greys the viewer on his
  own family's plate. **Muted means deceased.** Branch tints mark territory at the top level
  and are deliberately NOT shaded down the generations — the steps stop being
  distinguishable by the third ring and it would mis-colour everyone married in.

**Two markers, two meanings — do not merge them.** `truncatedChildren` means more of the
*same* lineage cut by the depth limit. `doorwayIds` means a *different* lineage this view
never traverses — someone whose own parents are not shown. Tapping a doorway re-centres
and flips direction rather than expanding in place, because a ring means a generation and
drawing two unrelated trees at once destroys that. Doorways render zero against a
single-family graph; they light up only once in-law parents exist.

Roster changes have two paths, both funnelling through the same matcher in
`src/lib/family-member-matcher.ts`:

- `npx tsx scripts/seed-family-tree.ts` (dry run by default, `--apply` to commit)
- Bucky's `propose_family_change` tool → a reviewable proposal → human confirmation →
  `confirmFamilyChangeProposal()` applies people, edges, and re-derived branches in one
  transaction

**Bucky proposes; he never writes the graph directly.** The reason is a real recording: one
voice note said "Corey" and the next corrected it to "Korey". A direct-write tool would
have created two people. The matcher refuses to guess on ambiguity rather than merging —
"William Craig" is both Sandy's legal name and Greg's son Will — and groups ambiguities
into connected components so a confidently matched neighbour can settle its neighbours.

## Archive health and retrieval (August 2026)
Eight of forty-eight documents were once unfindable — the Corporation Bylaws, the
succession clause, the Vision document among them — and every health check reported
success for a month, because failed intake wrote a *friendly placeholder* into `aiSummary`
and a truthy string is indistinguishable from a real summary. **Never write a synthesized
value on failure.** Leave the field null and record `analysisState`
(`ok` | `unsupported_type` | `too_large` | `provider_error`) plus `analysisError`.

**Two harnesses turn "is the archive findable" into a number.** Run them against production
(`DATABASE_PUBLIC_URL` + `OPENAI_API_KEY`); they need a real index, so they are scripts, not
unit tests.

```bash
npm run archive:verify:roundtrip   # a question derived from each document's own content
npm run archive:verify:golden      # ~25 real questions with expected documents
```

- **Golden is the reliable signal** — fixed questions, deterministic. Currently 88.0%.
- **Round-trip is stochastic** — its questions are model-generated fresh each run, so it
  drifts several points between runs on identical code. **Never compare two bare runs.**
  To compare settings use `scripts/tune-archive-retrieval-guards.ts`, which fixes the
  questions across a grid.
- **Negative controls count toward the rate.** A system that returns something for every
  query is guessing, and confident guessing is what once sent someone looking for a
  "Genealogy" category that did not exist. **A change that raises the pass rate while
  breaking a control is a regression.**
- The ceiling is 48/50 and 23/25, not 100% — two `.docx` files are genuinely blank (721KB
  each, almost entirely embedded fonts, zero `<w:t>` elements). No pipeline can extract
  text that was never typed.

**Retrieval guards are properties of the corpus, not of the code.** `RELATIVE_SEMANTIC_FLOOR`
and `UNCORROBORATED_TOP_SPREAD` in `embeddings.ts` must be **re-tuned after any archive-wide
change** — re-analysis once flipped controls from 4/4 to 2/4 without a line of retrieval
logic changing. The floor has measured as inert across 0.65–0.80; the spread is the lever.

Re-analysis runs through `scripts/backfill-document-analysis.ts` (dry run by default).
Two operational traps: `railway ssh` drops long sessions and `nohup` does not survive it,
so run in chunks with `--offset=/--limit=`; and the journal makes a second pass a silent
no-op, so a deliberate re-run needs a fresh `BACKFILL_JOURNAL_PATH` inside the upload root.

## Environment Variables (Railway)
- `DATABASE_URL` — PostgreSQL connection (references Postgres service). `railway run` executes **locally**, so it reaches the database but NOT the uploads volume; use `DATABASE_PUBLIC_URL` from the Postgres service for scripts run off a laptop.
- `OPENAI_API_KEY` — OpenAI key (500 RPM / 200k TPM as of August 2026)
- `AUTH_SECRET` — HMAC key for door cookies and identity sessions. **Must stay set** — see Identity above for what breaks if it is not.
- `GOOGLE_SERVICE_ACCOUNT_KEY` — Full JSON key for calendar service account
- `GOOGLE_CALENDAR_ID` — Google Calendar ID (Breadloaf Hill Stays calendar on breadloafhillsite@gmail.com)
- `FAMILY_PINS` — Per-family auth PINs (format: `Tom:1234,Jim:5678,Sandy:9012,Greg:3456`)
- `GMAIL_APP_PASSWORD` — App password for breadloafhillsite@gmail.com (Mail Room IMAP polling; spaces tolerated)
- `FAMILY_EMAILS` — Extra allowlisted sender addresses for Mail Room, comma-separated (jecraigvt@gmail.com and the site's own address are always allowed)
- `MAIL_ROOM_ALLOW_ALL` — "true" disables the Mail Room sender allowlist (currently true, set July 2026 during family onboarding; collect real addresses from the poll endpoint's recentLog, add to FAMILY_EMAILS, then set back to false)

## Local Development
```bash
npm install
# Set DATABASE_URL="file:./dev.db" in .env for SQLite locally
# Set OPENAI_API_KEY in .env
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
  assistant/            # AI property assistant (OpenAI, function-calling for actions; paperclip attachments file docs into the archive via /api/assistant multipart + lib/file-document.ts)
  documents/            # Document archive: AI categorization, Needs Review bucket, AI "librarian" reorganization (Tidy Up button)
  upload/               # Document intake: camera, single or BATCH file upload (drop many files, they auto-file), link by URL. No longer a hub tile (July 2026) — main intake is now Bucky chat attachments + Mail Room email; page still works at /upload
  maintenance/          # Maintenance log (timeline) + Property Systems "notebook" (Asset registry — Bucky creates/updates assets via save_asset as he learns about equipment from chat/docs/voice-memo walkthroughs; records and documents link to assets via assetId)
  emergency/            # Emergency contacts (tap-to-call)
  guide/                # Local guide (swimming, hikes, restaurants)
  family/               # Living family tree (PUBLIC route — replaced the old directory July 2026).
                        # Branch-per-brother vertical tree in the editorial style, tap-to-claim
                        # identity, person sheet. Contact details appear only after the PIN door.
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
  family-tree.ts        # Family graph: branch derivation, generation depth, couple grouping,
                        # public/private redaction. Pure functions + tests in family-tree.test.ts
  family-plate.ts       # Descent-plate layout (nested polar tree, co-parent resolution,
                        # branch spans, depth limiting). NO prisma import — it ships to the
                        # client bundle. Tests in family-plate.test.ts
  actor.ts              # ActorContext — who is acting, resolved server-side (see Identity below)
  ai.ts                 # AI: two-stage intake triage + type-specific analysis, Bucky chat w/ 13 tools, pantry scanning
  document-categories.ts # Category resolution guardrails (fuzzy dedupe, AI-proposed categories, Needs Review)
  extract-text.ts       # Text extraction: docx (mammoth), xlsx (exceljs), csv/txt
  librarian.ts          # AI filing-system review: generates + applies merge/rename/refile plans (user-approved)
  email-inbox.ts        # IMAP reader for breadloafhillsite@gmail.com (unseen messages + attachments)
  email-processor.ts    # "Mail Room": allowlisted family emails → stay extraction/dedupe → calendar; attachments → doc pipeline; audit notes to bulletin. Add-only by design.
  file-document.ts      # Shared server-side doc filing (buffer → save/categorize/guardrails/Document row/maintenance cross-link/embedding). Used by Bucky chat attachments.
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
- **Uploaded documents persist on a Railway volume** (`breadloaf-app-volume`, mounted at `/app/public/uploads`, added July 2026). Before that, every deploy wiped uploaded files (container filesystem is ephemeral) — DB rows survived but files 404'd. Don't remove the volume.
- After deploy, check `railway logs` to confirm the app started and migrations ran.

## Conventions
- Use `"use client"` for interactive pages, server components for static/data pages
- API routes follow REST pattern: `route.ts` for GET/POST, `[id]/route.ts` for PATCH/DELETE
- Store user's name in localStorage under key `breadloaf-username`
- Icons from lucide-react, green-700 primary color, stone neutrals
- Hub cards on homepage ordered by assumed frequency of use. Slimmed August 2026 to five surfaces: **Bucky is section I and the top-left tile** (`HUB_LEAD` in `src/app/page.tsx`, styled `.tile-lead`), followed by Calendar, Rooms, Family, and All Tools. Sections are I–V; `FIG. 01–02` is the separate sequence over the two photo tiles. Demoted destinations remain directly reachable from `/more`; Guide and Board also remain in the persistent bottom nav, the Album remains in the photography strip, and Bucky retains tool coverage for common writes.
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
