# The Living Family Tree — Handoff

**Written:** 2026-08-06
**For:** the implementing agent (Codex)
**Reviewed by:** Claude, after implementation
**Baseline commit:** `fea70a5`

---

## Why this exists

On 2026-08-06 the owner recorded two voice notes through the new hub mic:

> *"Can you add Colleen's parents to the family tree? Her father is Kevin McCabe,
> her mother is Cheryl McCabe, and actually her brother is Corey McCabe, and her
> brother's wife is Kira. Corey is the son of Kevin and Cheryl."*

> *"Oh, Corey is K-O-R-E-Y, not C-O-R-E-Y, and I forgot that Corey and Kira's
> daughter is Isla, I-S-L-A."*

Both captured perfectly — transcribed, attributed to `Voice note from Jeremy
Craig`, routed to memories rather than documents. Every part of the new plumbing
worked.

**And the family tree was never touched.** Still 33 members; no Kevin, Cheryl,
Korey, Kira, or Isla. Bucky has twelve tools and none of them can write to the
family graph, so he stored an instruction as though it were a fact and answered
as though he had acted.

That is the same failure shape as the placeholder summaries: agreeable output
masking no action. It is worth fixing twice over — once so Bucky can do it, and
once so he says so when he cannot.

---

## What is already true — do not re-architect

The owner described wanting "a web of data, with the plate as a slidable
magnifying glass over its surface." **That is the current architecture.**

`buildDescentPlate(tree, rootId)` accepts any person as centre and
`layoutPlate(..., { maxDepth })` prunes what will not fit, marking cut points
`truncated`. `ancestorPath()` computes the trail upward. The plate stores
nothing; it is a pure function over `FamilyMember` + `FamilyRelationship`.

So no new storage layer is needed, and none should be added. What is missing is
narrower than it looks.

---

## Measured against the live graph, 2026-08-06

```
members            33
parent edges       40
spouse edges       12
blood descendants of the four branch roots   20
founders flagged   Bill, Lois

branch = null      Bill, Lois, Lorenza          <- three rows, three meanings
married-in (zero parent edges)   13
  ...of whom have children       10   <- Lois, Mira, Derry, Ben, Colleen,
                                          Judy, Bill, Kirsten, Rob, Annie
doorways today     0
```

Two facts drive the whole design:

**Every married-in person has zero parent edges.** Nobody has entered an in-law's
parents yet. So there are no doorways today, and the ten married-in people who
have children are exactly the doorway candidates. Colleen becomes one the moment
Kevin and Cheryl exist.

**`branch: null` already carries three different meanings.** Bill and Lois are
Craig ancestors above the branch split. Lorenza is Bill's second wife with no
children — married in, no Craig descent at all. Kevin and Cheryl would land in
the same bucket. Today they would all render as "Forebears," which is wrong for
Lorenza and would be badly wrong for Colleen's parents.

---

## The data rules

These are the point of the exercise. Get them right and the display follows.

### Rule 1 — Two edge types, never inferred from each other

`parent` describes lineage, `spouse` describes partnership. Already true; keep
it. A parent edge attaches to an individual parent, never to a couple — Sandy's
daughter Riley is his and Kirsten's while Sandy's current marriage is to Andrea,
and a couple-as-container model reparents her onto the wrong person.

### Rule 2 — Lineage is three-valued and derived, not a nullable label

Replace the overloaded `branch: null` with a computed classification, relative to
the Craig branch roots:

| class | definition | today |
|---|---|---|
| `descendant` | reachable descending from a branch root | 20 people |
| `ancestor` | reachable ascending from a branch root | Bill, Lois |
| `affine` | attached only through a spouse edge | Lorenza, and every future in-law |

Derive it from the graph. **Do not add a column** — it is a function of the
edges, and a stored copy will drift the way `branch` did.

`branch` stays exactly as it is: a decorative tint marking which brother's
territory a Craig descendant belongs to. It answers nothing for an `affine`
person and should stop being asked.

### Rule 3 — Position is relative to the centre, not absolute

The plate already picks a centre. Everything shown should be described by its
relationship to that centre, not by a global label. This is what lets the graph
grow to many attached families without a schema fight — "how are you connected
to the person in the middle" always has an answer; "which brother do you descend
from" does not.

### Rule 4 — `isBranchRoot` and `isFounder` are honours, not traversal seeds

`deriveBranches` currently seeds from `isBranchRoot`, which bakes in "there is
one family, rooted at the brothers." Keep both flags for tinting and for the
founders' mark, but the **viewport must follow edges from wherever it is
centred**, never from a flag. Otherwise adding a family that does not descend
from the brothers has nowhere to render.

### Rule 5 — Two pruning rules bound the view at any graph size

1. **Depth** — N rings from centre (exists today)
2. **Direction** — a view follows one edge direction and never auto-crosses into
   a lineage the centre does not belong to (new)

Together these keep the plate bounded no matter how large the web gets, which is
the magnifying-glass property. The binding constraint is visual, not
computational: `MIN_BRANCH_DEGREES = 52` means roughly seven branches fit around
a ring before slices stop holding a name. Do not build for thousands of people;
build for one family's worth of relatives at any centre.

---

## Task 19 — Bucky should know his own boundaries

**Smallest and most urgent. Do this first.**

Bucky answered a family-tree request as though he had acted on it. Until task 22
lands he cannot edit the graph at all, and after task 22 he still will not apply
changes directly.

Add explicit boundary knowledge to his system prompt: the set of things he can
change is exactly his tool list, and a request outside it gets an honest answer —
what he saved, what he cannot do, and what will happen to it instead.

**The failure to prevent is silent success**, not the missing capability. "I've
saved that, but I can't edit the family tree myself" costs nothing and keeps the
family's trust; sounding agreeable while doing nothing spends it.

**Done when:** asking Bucky to do something outside his tools produces an
explicit statement that he cannot, plus what he did with the information.

---

## Task 20 — Replace the overloaded `branch: null`

Implement Rule 2 as pure functions in `src/lib/family-tree.ts`, with tests.

Classify every member `descendant` / `ancestor` / `affine` by graph traversal.
Then fix the render: the "Forebears" section should contain **`ancestor`**
people, not everyone whose branch happens to be null. Lorenza is `affine` and
must stop being grouped with Bill and Lois.

Verify against the live numbers above — 20 descendants, 2 ancestors, and
Lorenza plus the twelve other married-in people as affine.

**Done when:** the classification matches those counts, `/family` renders
Lorenza as a spouse rather than a forebear, and adding a non-Craig family does
not put anyone in Forebears.

---

## Task 21 — Doorways and the ascent view

### 21a. Doorways

A **doorway** is a person on the plate with edges of the *other* direction
leading to people the current view does not render. In descent view: someone
whose own parents are not shown. It generalises the existing `truncated` marker,
which means "more in the same direction, cut by depth."

Two distinct markers, two distinct meanings — do not merge them:

- `truncated` — more of the same lineage, hidden by the depth limit
- `doorway` — a different lineage, never traversed by this view

Reuse the existing interaction. Tapping a doorway re-centres, exactly as
"Centre the plate on X" already does. **Do not add a toggle that renders two
lineages at once** — a ring means a generation, and two unrelated trees on one
plate destroys that.

Today this renders zero markers. That is correct and is the test: it should
light up only when someone adds an in-law's parents.

### 21b. Ascent

Add `buildAscentPlate(tree, rootId)` parallel to the descent builder: same ring
geometry, walking `parentIds` instead of children, nesting parents inside a
child's arc.

**Ascent doubles every ring** — two parents, four grandparents, eight — where
descent narrows toward leaves. It cannot render past two rings in a 440px shell.
So: show both parent lines at ring one, then require re-centring to continue up
either. That re-centring *is* the "branch chooser"; do not build a separate
control for it.

One genuine design decision to make and write down: descent puts the blood
parent on the inner radius with the only spoke to centre, which is the rule that
makes it legible. Ascent has **two** parents, both equally blood from the
viewer's position. Pick a rule and state the reasoning in a comment, because the
next person will wonder.

Why this matters more than it appears: **in-law families are unreachable in
descent.** From Bill and Lois looking down, the McCabes never appear at any
depth. Ascent from Colleen is the only way to see them.

**Done when:** the view switches between ascent and descent, doorways appear
only where a lineage leaves the current view, and centring Colleen in ascent
shows Kevin and Cheryl once they exist.

---

## Task 22 — Bucky proposes family changes; a human confirms

**Do not give Bucky direct write access to the family graph.**

The reason is in the source recording. The first note said "Corey," the second
corrected it to "Korey." A direct-write tool would have created Corey McCabe and
then, quite possibly, a second person named Korey McCabe. A proposal that a human
confirms lets the correction land before anything is written.

The graph also carries invariants that are not obvious from outside — parent
edges attaching to individuals, spouse edges stored one-directional and read
symmetrically, `isMinor` gating what a public route may show. Corrupted descent
does not throw; it renders wrong months later.

### Shape

One tool — something like `propose_family_change` — emitting a structured
changeset:

- people to add (name, display name, minor?, deceased?)
- parent edges (parent → child)
- spouse edges (a ↔ b, current | former)
- corrections to existing people (spelling, display name)

Persist it as a reviewable proposal and surface it the way photo identifications
are surfaced: a clear statement of what will change, confirmed by a tap.

**Apply through the existing matching logic** in `scripts/seed-family-tree.ts`
rather than reimplementing it. That script already matches on `displayName`
first, then full name, and **refuses to guess on ambiguity** rather than merging
two people — "William Craig" is both Sandy's legal name and Greg's son Will.
That property is exactly what protects a spoken "add Corey" when two exist.

**Minors need a human decision.** `isMinor` reduces a person to a first name on
a public route. Never let the model infer it silently; a proposal touching a
possible minor must ask.

**The McCabe changeset is the acceptance test.** Both voice notes are already
captured as memories. Feed them in and the proposal should be: Kevin McCabe,
Cheryl McCabe, Korey McCabe (spelled with a K), Kira, and Isla — with Korey as
the child of Kevin and Cheryl, Colleen as their child too, Kira as Korey's
spouse, and Isla as Korey and Kira's daughter, flagged as a possible minor.

**Done when:** that changeset is produced from the recordings, a human confirms
it, the five people appear in the graph, Colleen becomes a doorway, and centring
her in ascent shows her parents.

---

## Sequencing

19 → 20 → 21 → 22. Boundaries first because the silent failure is live now.
Then the data classification, because the plate work depends on it. Then the
display. Then the write path, which is the only task that can be acceptance-
tested end to end once the rest exists.

## How this will be reviewed

1. **No stored copy of a derived value.** Lineage class is computed. A column
   would drift exactly as `branch` did.
2. **The viewport does not depend on `isBranchRoot`.** Adding a family that does
   not descend from the brothers must render.
3. **`truncated` and `doorway` stay distinct.** They mean different things.
4. **No toggle that draws two lineages at once.**
5. **Bucky does not write to the graph directly**, and applies through the seed
   script's ambiguity-refusing matcher.
6. **The Korey/Corey correction resolves before anything is written.**
7. Existing `family-tree.test.ts` and `family-plate.test.ts` still pass, and the
   archive harnesses have not regressed.
