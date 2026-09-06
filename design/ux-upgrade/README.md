# Breadloaf Hill — three UX directions

Three isolated, clickable design prototypes for comparing a visible upgrade that keeps the family's existing navigation and tasks familiar. These files do not change the production application.

Start from the repository root with Node.js:

```powershell
node design/ux-upgrade/serve.mjs
```

Open **http://127.0.0.1:4178**. For another port, use `--port 4179` (or `PORT`). No installation, database, credentials, or paid services are needed.

## Compare and explore

- **Refined Cabin**: the closest continuation of the current warm editorial design; recommended for the least relearning.
- **Family Field Guide**: a more photographic, welcoming expression of the property and family.
- **Modern Homestead**: a compact everyday workspace that emphasizes upcoming visits and useful actions.

Compare all three homepages, or choose the same screen across the concepts. Select **Explore this direction** to use the screen and viewport selectors. Each viewport gives the prototype a real CSS layout width of 390, 768, or 1440 pixels. Wide previews scale down to fit the comparison page; use **Open full-size** for readable inspection in a separate tab at your browser's current width.

The URL stores the selected mode, concept, screen, and viewport, so refreshing or sharing the local URL restores that view. Examples:

- `/?mode=explore&concept=cabin&screen=calendar&viewport=mobile`
- `/?mode=explore&concept=fieldguide&screen=upload&viewport=desktop`
- `/prototype.html?concept=homestead&screen=hub`

## Screens and example journeys

Each direction includes **Hub, Calendar, Stays & Rooms, Bucky, Add to Archive, and Bucky's tasks**. All keep the familiar **Hub / Dates / Rooms / Guide / Board** bottom navigation and Bucky's prominence.

Try checking dates and adding a stay, then adding a document and following its analysis. The **Reset this preview** button restores the focused demonstration to its initial sample content. Destinations beyond the six-screen demonstration are explicitly marked in the prototype.

## Boundaries

Visits, documents, and conversations are synthetic sample content. Inputs and interactions simulate the experience locally; nothing books a room, uploads a file, generates an API request, changes production data, or publishes a site. Existing property photography is reused from `public/photos`.

The preview server listens only on `127.0.0.1`. It allows GET/HEAD for explicitly listed prototype entry files, local image/font assets, and the existing `public/photos` images. Other repository files, environment files, scripts, directory listings, and traversal/symlink escapes are unavailable. A restrictive content security policy prevents connections to APIs or external assets.

The concepts are a selection artifact, not a new production route. Choose a direction (and any favorite details from another) before integrating the final UI into the application.

## Verification

With the preview server running and the repository's existing Playwright dependency installed:

```powershell
node design/ux-upgrade/verify.mjs
```

The browser suite checks the six screens across all three concepts, phone/tablet/desktop layouts, visit forms, upload and task journeys, keyboard focus, comparison controls, and local server boundaries. The September 5, 2026 run passed 76 checks with no failures, external requests, API calls, browser errors, or missing assets. Reports and screenshots are written to the ignored `artifacts/` directory.

## Fonts and assets

The local WOFF2 files are the Latin font subsets already downloaded by the application's Next.js build: Instrument Serif (regular and italic), Instrument Sans, and JetBrains Mono. They are served locally so the prototypes need no font service connection. Their SIL Open Font License texts are included alongside the font files, sourced from the corresponding directories in the official [Google Fonts repository](https://github.com/google/fonts/tree/main/ofl). Photography remains in the application's existing `public/photos` directory.
