# Bucky 2.0 — architecture handoff (August 2026)

**September 5 implementation update:** The hybrid queue, local Codex worker,
budgeted API fallback, task UI, and guarded website proposal pipeline now have a
working implementation. See [current implementation and rollout](bucky-hybrid-implementation.md).
The text below records the original brainstorming; its “not yet built” statements
describe August, not current implementation or deployment status.

Design session, not yet built. Nothing in this document has been implemented. It records
what was decided, what was *diagnosed in the existing code*, and what is still open, so the
next session can resume on the shape rather than re-deriving it.

The goal in one line: **Bucky stops being a function inside a request and becomes an entity
that persists — a custodian of the site, the data, and the family's knowledge.**

---

## 1. What started this: the family tree photo

Jeremy's dad photographed a handwritten family tree, gave it to Bucky in chat, and asked him
to add it to the family plate. Bucky filed it as a document and could not do the rest.

**The failure was not authority.** `propose_family_change` (`src/lib/ai.ts:940`) already does
exactly what was asked — people, parent edges, spouse edges, into a reviewable proposal. It
was available and it never fired. The actual chain:

1. `categorizeDocument` reads images at `detail: "auto"`, so Bucky genuinely saw the
   handwriting **once**, at intake.
2. Intake asks for a *summary* plus `extractedText` = "the key facts from the document —
   names, dates, dollar amounts" (`ai.ts:462`). **A family tree's information is its
   structure.** Prose compression preserves the names and destroys every edge.
3. That compressed prose is what got embedded and stored.
4. On the follow-up turn, `buildBuckyContext` retrieved `aiSummary` plus a couple of text
   chunks (`bucky-context.ts:385`). **Not the image.**
5. Bucky had no way to ask for the original. He answered from a paragraph about a picture he
   could no longer see, and correctly declined to invent forty people.

### The finding that generalizes

> **All 13 of Bucky's tools are writes. Not one is a read.**

`add_grocery_item`, `create_stay`, `add_maintenance_record`, `save_asset`,
`set_document_category`, `add_bulletin_message`, `add_dinner_signup`, `add_pantry_item`,
`add_expense`, `save_memory`, `ask_family`, `propose_family_change`, `update_position`.

He can *change* nine subsystems and cannot *look up* a single one. Everything he knows
arrives pre-loaded by `buildBuckyContext` before the turn starts; if the right thing is not
in that payload his only move is to say so. **He cannot investigate.** That is the root
architectural gap, and it is what makes him feel un-agentic.

### Two things Claude got wrong during this session, recorded so they are not repeated

1. **"A general agent would have hallucinated a weird cousin."** Wrong. Hallucination here is
   a property of *forced structured output from a degraded source with no channel for doubt*
   — all three are properties of the **pipeline**, not of agency. An agent looking at the
   actual image would read what it could, say "I can't tell if that's Riley or Kiley — who is
   this?", and propose only the people it was sure of. The codebase already believes this:
   `possibleMinor`, `ask_family`, and the matcher refusing to merge Corey/Korey are all the
   same instinct.
2. **"Model the teaching layer on CLAUDE.md."** Outdated — see §5.

---

## 2. The shape: inversion, not rewrite

Today the app *contains* Bucky. In 2.0 **Bucky is the process and the Next app becomes one of
the things he tends**, alongside the database and the archive.

That is an inversion of control, not a teardown. The plate, retrieval, intake, the editorial
system, and the guardrails all survive unchanged. What moves is where the loop lives — which
is why this can be 2.0 without a stalled rewrite running beside a 1.0 you still have to keep
alive.

### Four options considered

| Option | What Bucky is | Verdict |
|---|---|---|
| **Job runner** | Work that outlives a request | **Ships first.** Smallest step to real value, no new risk class, fully reversible. |
| **Custodian process** | A persistent entity that owns things | **The destination.** Blocked on undo coverage (§4). |
| **Staff of specialists** | Coordinator + Archivist/Genealogist/Mechanic/Steward/Dev | **Later, if ever.** Over-built for 25 people. Genealogist is the likeliest first split. |
| **Environment** | A place any capable agent can inhabit | **The substrate.** Build this; it is what every other option consumes. |

### Brain / body / hands

The decomposition that made the decision tractable:

- **Hands** — the tools and data Bucky can touch. *The durable, expensive part.* An MCP
  server wrapping the existing `lib/` functions, with read tools added. Consumed identically
  by every candidate runtime. **Build this first; it commits you to nothing.**
- **Body** — the harness running the loop. Hermes / Claude Agent SDK / Claude Managed Agents.
- **Brain** — the model. Cheap to swap.

Hermes Agent is a *body*, not a brain — it runs on any provider (Anthropic, OpenAI, Google,
DeepSeek, local via Ollama).

---

## 3. Decisions made

### Runtime: Hermes on the Hetzner box

- Nous Research **Hermes Agent** (open source, released Feb 2026), already running on
  Jeremy's Hetzner server.
- Powered by **ChatGPT Plus via Codex device-code OAuth** — credentials in
  `~/.hermes/auth.json`, can import from `~/.codex/auth.json`. No API key, no per-token bill.
- Weekly Codex caps and the "personal use" framing were raised and **explicitly accepted** by
  Jeremy: a seasonal summer home used by one family is nowhere near those limits. Not an open
  question; do not re-litigate.
- Consequence worth keeping: **cheap tokens buy carefulness.** Bucky can afford to re-read
  the original file, check three sources, and re-examine the photo rather than working from a
  summary. The "investigate rather than guess" behaviour stops being a cost tradeoff.

### Not the Windows desktop

Checked during the session: Docker Desktop and WSL2 are installed, so it *would* run. Ruled
out anyway:

- `powercfg /a` confirms **S3 standby and hibernate are live**. A midnight job on a sleeping
  machine does not fail — it silently does not happen. Windows 11 Home also forces update
  reboots. **The failure mode is silence**, which is the worst possible one for something
  whose whole job is to report.
- **OneDrive.** The repo lives at `C:\Users\Jeremy\OneDrive\Documents\Vibe coding\breadloaf`.
  Automated checkouts and branch switches at midnight while OneDrive syncs `.git` is a real
  corruption path. **Any agent working copy must live outside OneDrive.**
- Blast radius: daily driver with FRReader, quiz generators, browser profiles, credentials.
- Linux-first tooling; WSL2 adds a layer that breaks in undocumented ways.

**The split:** the machine you sit at runs work you watch (Claude Code, interactive co-dev).
The machine that never sleeps runs work you don't.

### Isolation from the personal Hermes agent

Same hardware is fine; same user is not.

- Hermes ships **five sandbox backends** — local, Docker, SSH, Singularity, Modal. The
  partition question is a config line, not something to build.
- Separate system user, its own `~/.hermes`, Docker sandbox backend, and family data
  reachable **only through the MCP tools, never the filesystem**.
- Two concrete reasons, not general caution: Hermes documents that **external skill
  directories are not write-protected** (two self-improving agents sharing a skill dir will
  overwrite each other's learned procedures), and Bucky's data includes S-Corp records, K-1s,
  bank statements, and the accounts vault.

### The portability rule — Jeremy's core requirement

> *"Bucky doesn't go away, his abilities just get better."*

> **Everything Bucky learns lives in the repo or the database. Never only in the runtime's
> home directory.**

| Layer | Portable today? |
|---|---|
| Data (Postgres) | Yes |
| Tools (MCP) | Yes — protocol standard |
| History (`BuckyLedgerEntry`) | Yes |
| Persona and rules | Yes — plain files |
| **Learned skills** | **⚠️ At risk** |

Hermes stores skills in `~/.hermes/skills/` using the **agentskills.io open standard** — good
news, it is a published format rather than a proprietary blob. The *location* is the problem.
**Make `~/.hermes/skills/` a checkout or sync target of a directory inside the breadloaf
repo.** The repo is the source of truth; Hermes is a consumer of it.

Two benefits fall out: swapping harnesses becomes pointing something new at the same folder,
and every skill Bucky writes shows up as **a diff the family can review** — teaching becomes
version-controlled by construction. It also means git tells you if the personal agent ever
writes into shared skills.

### Code and data are different risk classes — do not merge them

- **Code:** PR-only, never direct to `main`. Note **merge *is* deploy** (GitHub auto-deploy),
  so the approval gate is the only thing between Bucky and four families' live site.
- **Data:** ledger + undo, autonomy graded by reversibility. Generalizes the existing
  `BUCKY_ACTION_BOUNDARY` and propose/confirm pattern rather than inventing a new one.

---

## 4. Findings in the existing code

Each of these was verified this session.

### Undo coverage is 2 of 13 — the blocker for autonomous data writes

`BuckyLedgerEntry` has `beforeState`, `afterState`, `reversible`, `initiatedBy`, `revertedAt`.
The schema is right and was designed before it was needed. But
`undoBuckyLedgerEntry` (`src/lib/bucky-undo.ts:193`) implements undo for **two** action types:
`set_document_category` and `update_position`. Eleven others record a `beforeState` that
nothing can replay.

**Backups are the wrong granularity for agent mistakes.** When Bucky merges two people wrongly
and it is noticed 200 writes later, you do not want to restore the whole database to Tuesday —
you want to undo *that action*. Backups protect against catastrophe; undo coverage is what
makes ownership survivable. Closing 2 → 13 is the highest-value work before any autonomous
write authority, and it is useful even if 2.0 is never built.

*Also unconfirmed: whether a database backup schedule exists at all.*

### The context builder is the anti-pattern — and the fix is already half-built

`buildBuckyContext` pre-computes operational context, knowledge directory, *and* retrieved
knowledge into a ~10k-token system prompt on **every turn**, whether the question is "who's
cooking Saturday?" or a full archive investigation.

But `ai.ts:1738` already has `KNOWLEDGE DIRECTORY (what exists beyond the front desk)` — which
is **exactly** the lightweight-identifier layer that current guidance describes, invented
independently. Because Bucky has no read tools, he cannot act on the directory, so
`relevantKnowledge` had to be pre-computed and jammed in alongside it.

**The directory is a map with no legs attached.** Same finding as the family tree photo, from
a different angle. Moving to just-in-time retrieval is simultaneously the better architecture
and a direct cost cut.

### Other verified facts

- **No staging.** `railway status` → one environment, `production`. Shapes everything in §6.
- **Five pages un-ported** to the editorial system — `calendar`, `stays`, `guide`, `weather`,
  `bulletin` have **zero** editorial classes between them. Reference designs exist in
  `.design-handoff/project/pages.jsx`.
- **35 test files, no UI tests.**
- `propose_family_change` accepts only `sourceMemoryIds` ("exact MEMORY ids"). A
  document-sourced proposal has nowhere to cite provenance — needs `sourceDocumentIds`.

---

## 5. Memory architecture — corrected mid-session

Jeremy correctly pushed back on modelling the teaching layer on CLAUDE.md. Current Anthropic
guidance:

- Static instruction files are **demoted and shrunk** — the "Goldilocks zone", the *minimal*
  set of information that outlines expected behaviour.
- Replaced for long-running agents by **three dynamic artifacts**: a structured state/feature
  registry, a **progress file that explicitly records failed approaches and why** (without
  them, later sessions re-walk dead ends), and git history as timestamped documentation.
- **Just-in-time context** — hold lightweight identifiers (paths, queries, ids), load content
  at runtime through tools.
- **Progressive disclosure** — discover context by exploring, assembling understanding layer
  by layer.
- File-based **memory tools/stores** the agent reads and writes across sessions.

The sting: the project's own `CLAUDE.md` is ~10k words and much of it is *knowledge* (calendar
IDs, env inventory, seed counts, the archive's 88.0%). The incident-and-reason parts stay in
the small always-loaded layer; the reference material should become retrievable.

Hermes's skills system is already this pattern — on-demand knowledge documents, progressive
disclosure, agent-writable via `skill_manage`, with an Autonomous Curator that consolidates
overlap and archives stale entries.

### The three layers for Bucky

1. **Always loaded, small** — who he is, action boundaries, and an index of what exists. His
   constitution, not his encyclopedia.
2. **Fetched on demand** — documents, family graph, expenses, history, prior decisions.
3. **Written back** — memory files, a decision/progress log *including what did not work*, and
   PRs.

The governance argument survives the correction: rules the family can read and diff. That
argues for **plain files in git**, which the progress-file and memory-directory patterns
satisfy — it was never an argument for one large file loaded every turn.

---

## 6. Proactive improvement — designed, not yet built

Jeremy's idea: once or twice a week Bucky researches UX/UI improvements, writes some code,
sends a proposal, Jeremy approves and merges.

**The shape is right.** The input needs changing.

### Why "find improvements" fails

An open-ended generative mandate always produces output — producing *a* change is easier than
concluding "this is fine." You get a branch every week whether or not one was warranted; ~50
PRs a year of drift on a site four families have already learned. The review cost lands on the
wrong side: Bucky's time is free, Jeremy's is not. And with no usage data, "UX research"
collapses to generic best practice (contrast, tap targets, aria labels) which sands the
editorial voice — mono-caps eyebrows, Roman numerals, `FIG. 01` badges, the 440px frame —
toward conventional, one defensible PR at a time.

### The two changes that make it work

1. **Point him at his own logs, not the web.** He has the ledger, `ask_family`, the bulletin,
   and every conversation he has ever had. If eight people asked "which rooms are free that
   weekend", the calendar is not answering a question people keep asking. That is real signal
   about *this* family, nobody else has it, and right now nobody reads it.
2. **Weekly he proposes the problem, not the solution.** A short observation list; Jeremy
   picks what to pursue. Two minutes instead of twenty, and coding only happens on something
   already wanted.

### First real coding task: the five un-ported pages

Bounded, the design decision is already made, the reference exists, and success is checkable —
it either matches `.design-handoff/project/pages.jsx` or it does not. It cannot drift into
taste territory. **Let him earn code trust on work where "did he get it right?" has an answer.**

Every proposal needs before/after screenshots attached — Playwright is available and this is
cheap to wire up.

### Fresh-user testing

Jeremy's idea, and the strongest one in the session. It catches the failure nothing else
surfaces: the person who tries to book a room, cannot work it out, and **texts Jeremy instead
of reporting a bug**. The text arrives, the signal never does, the page stays broken.

- **"Without background knowledge" cannot be done by instruction.** Bucky knows the schema and
  every decision in CLAUDE.md; told to *pretend* to be naive he will roleplay while navigating
  on insider knowledge, and produce output that sounds like fresh-user feedback and is not —
  worse than no signal, because you would act on it. **The fix is structural:** a separate
  session with no repo, no CLAUDE.md, no schema. Just a browser, the URL, a PIN, and a goal.
- **Tasks, not browsing.** "Use the site" yields vague output; *"you're Greg's daughter-in-law,
  invited for a week in August, find out where you're sleeping"* yields pass/fail with a
  specific failure point. The task list comes from the logs — **logs → tasks → fresh run →
  observations → weekly list.** The loop closes.
- **Start read-only. There is no staging.** Form submits would create real stays, dinner
  signups, and bulletin posts on a board four families read — and could write a real
  `FamilySession` attributing a device to an actual person. Navigate and observe only; that
  still catches discoverability, dead ends, confusing labels, and outright breakage. Give it a
  **dedicated test PIN** so anything it touches is attributable and sweepable.
- **Point it at the door and claim flow first.** Claiming moved to the door in August because
  discovery-based claiming reached one person out of twenty-five. Every real family member gets
  exactly **one** first impression of that flow and all twenty-five are spent. A fresh agent
  context is a renewable supply of first impressions at the only screen where that is
  irreplaceable.

---

## 7. Where to resume

**The immediate next task, offered three times and never done: spec the MCP tool surface and
the autonomy gradient** — which reads Bucky gets, which writes he makes freely, and which he
proposes. That decision determines everything else. Plan mode was suggested for it.

Ordered backlog:

1. **MCP tool surface + autonomy gradient spec.** ← start here
2. **`read_document(id)`** — re-opens the original file, image included, at full fidelity. The
   smallest change that would have made the family tree request work. Useful immediately,
   independent of 2.0.
3. **Undo coverage 2 → 13.** Gates all autonomous data writes. Confirm a backup schedule exists.
4. **Structure-preserving intake for tree-shaped sources** — when triage sees a genealogy
   chart, extract *edges*, not prose. Add `sourceDocumentIds` to `propose_family_change`.
5. **Move skills into the repo** and point `~/.hermes/skills/` at it.
6. **Just-in-time context** — shrink the system prompt, let the knowledge directory do its job.
7. **Instrument token cost per action type** on the ledger. Measure before letting cost
   constrain the design.
8. **Staging environment.** Unblocks write-path fresh-user testing.
9. **Fresh-user run, read-only**, pointed at the door.
10. **The five un-ported pages** as Bucky's first real branch.

Nothing above 3 requires committing to Hermes, or to 2.0 at all.

---

## Sources consulted

- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Scaling Managed Agents: decoupling the brain from the hands](https://www.anthropic.com/engineering/managed-agents)
- [Hermes Agent docs](https://hermes-agent.nousresearch.com/docs/) · [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
- [Managed Agents memory](https://platform.claude.com/docs/en/managed-agents/memory) · [Accessing GitHub](https://platform.claude.com/docs/en/managed-agents/github)
