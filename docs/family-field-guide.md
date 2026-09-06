# Family Field Guide

Selected by Jeremy on September 5, 2026 from the three clickable concepts in
`design/ux-upgrade`. This is the production implementation of that direction.

## What changed

The site uses warm ivory, sage, and forest green with Instrument Serif headings,
property photography, and editorial panels. The desktop shell grows to 1180px;
phone layouts keep the familiar bottom navigation in the same order: Hub, Dates,
Rooms, Guide, Board. Existing routes and destination names remain recognizable.

The homepage keeps Bucky first, Calendar and Rooms together, and Family and All
Tools close by. The rainbow opens the photo masthead; its slideshow can be paused
or navigated by keyboard and respects reduced motion. Voice recording remains
available directly from the Bucky tile. Calendar, archive counts, next-visit
details, Bucky questions, and board notes come from existing records. Illustrative
wildlife, weather, and attributed quotations were removed from the homepage.

Calendar, Stays & Rooms, Bucky, Bucky's tasks, Add to Archive, the document archive,
document detail, and All Tools adopt the design. Shared headers, fonts, navigation,
and the responsive shell carry the family resemblance to other routes.

## Familiar behavior retained

- Calendar views, calendar subscriptions/sharing, date selection, all 11 rooms,
  visit creation/deletion, statuses, and existing calendar synchronization.
- Chat, streaming responses, attachments, voice recording/handoff, Questions,
  and Ledger/undo.
- Upload by camera, file, batch, or URL; immediate versus background analysis;
  original retention, review and filing, archive filters, category assignment,
  health reporting, deletion/restoration, and Tidy Up.
- Task polling, real statuses, retry/cancel/Process now, request permissions,
  and existing local-first processing and API budgets.

Visit forms now show server validation errors and prevent repeat submission while
saving. Dialog focus, keyboard tabs, category selectors, active navigation,
slideshow controls, and browser zoom have also been improved. No API routes,
authentication rules, schema, worker policy, dependencies, or billing configuration
change with this design.

## Implementation map

- `src/app/field-guide.css`: shared palette, responsive shell, headers, homepage,
  masthead controls, and directory.
- `src/app/fieldguide-visits.css`: calendar and rooms.
- `src/app/fieldguide-bucky.css`: assistant and background tasks.
- `src/app/fieldguide-archive.css`: upload, archive, and document detail.

The existing editorial classes in `globals.css` remain available. Route-specific
styles are scoped to their page wrappers. Font variables now live on `html`, where
the existing root-level type aliases can resolve them correctly. The selected
design introduces no new runtime service, image-generation cost, or font request
to an external service from the browser.

## Validation

Local validation uses a separate PostgreSQL container and synthetic records, with
calendar, mail, AI, and worker credentials removed from the application process.
Browser workflows either operate on that disposable database or intercept feature
API requests. Family records and paid inference are not used for these checks.

- Unit suite: 163 passed, five opt-in integration tests skipped, no failures.
- TypeScript check passed.
- Optimized Next.js production build passed.
- Calendar/Rooms: 16 browser flow checks and layouts at 320, 390, 768, 1000, and
  1440 pixels, including validation failure/retry and keyboard dialogs.
- Bucky/tasks: 26 checks including chat, attachments, simulated microphone,
  Questions, Ledger undo, permission-dependent controls, and task recovery.
- Archive: responsive views at 320/390/768/1440, plus immediate/background/batch
  uploads, review/save, search, category filing, and document detail.
- Shared shell, homepage, and secondary destinations reviewed at phone and desktop
  sizes; the comparison prototypes remain separate from application routes.
- Final production-build smoke: 24 route/viewport combinations passed across the
  main screens, directory, Guide, Board, Family, and Accounts. No horizontal
  overflow or browser runtime errors; one main landmark and familiar navigation
  verified throughout.

Local screenshots, fixture scripts, and detailed reports are ignored under
`design/ux-upgrade/artifacts/`. Release follows the repository's GitHub-to-Railway
deployment path after these checks; no local database or review artifacts are
included in deployment.
