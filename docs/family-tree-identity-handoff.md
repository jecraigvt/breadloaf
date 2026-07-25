# Family Tree and Lightweight Identity Handoff

Last updated: 2026-07-24

## Status

**Superseded in part — 2026-07-24.** The family tree, graph schema, roster, and tap-to-claim
identity are now implemented. Read `CLAUDE.md` ("Identity: the door and the tap" and "Family
tree data model") for what actually shipped; that is authoritative where it conflicts with
this document. The sections below are kept for the reasoning and for the parts not yet built.

Three deliberate departures from the plan below:

1. **Phrase-only login was rejected.** The plan made a unique memorable phrase both username
   and password, so a collision is not a failed login — it silently signs you in as someone
   else, corrupting the very attribution the rest of the plan exists to protect. Instead the
   shared `FAMILY_PINS` door was kept as the only security boundary, and identity became a
   single tap on your own face in the tree. That is strictly more frictionless than typing a
   phrase, and it defers every hard credential problem (uniqueness, HMAC fingerprints, reset,
   recovery) rather than solving them up front. Per-person PINs are additive and opt-in later.
2. **Children attach to individual parents, not to couples.** See the Sandy/Kirsten/Andrea
   case in `CLAUDE.md`. The "pair spouses visually as one family unit, with children branching
   beneath them" guidance below is a *rendering* rule only; it must not reach the schema.
3. **No `@xyflow/react` or ELK.** Everything renders inside the 440px shell, so the tree is a
   vertical scroll through branch sections, not a pannable graph. A graph library would have
   fought the editorial design system for no benefit at that width.

Still not done, on purpose: converting write routes to derive attribution from `ActorContext`
(step 9 below), passing the actor into Bucky (step 8), and a curator UI for adding people and
editing relationships. Roster edits currently go through `scripts/seed-family-tree.ts`.

The current production baseline already includes Bucky's tiered memory, resilient archive processing, descriptive archive titles, the oversight ledger, and the related documentation. The family-tree identity work should build on that system without reopening it.

## Related Completed Work

Read `docs/bucky-memory-and-operations.md` for the completed architecture and operational details from the earlier part of this work. That track is already live and includes:

- Google overload fallbacks that preserve voice memos, uploads, and emailed attachments even when Gemini cannot process them;
- bounded operational context plus request-specific hybrid memory retrieval;
- chunked document, memory, asset, maintenance, and expense indexing;
- memory scope, subject, provenance, confidence, validity, and supersession metadata;
- Bucky's action ledger and conflict-aware undo for supported actions;
- descriptive content-based archive titles with exact review/apply plans;
- a production reindex of 48 source records; and
- a production archive title cleanup that renamed 12 legacy files and left no filename-like title candidates.

Relevant production commits from that completed track are `5c109b3`, `a5a36a8`, and `349b17c`. The family-tree work discussed here was intentionally left as design-only pending actual family relationship data.

## Product Intent

Replace the shared branch PIN login with a visual family tree and a deliberately simple, family-friendly identity claim flow. The main goals are:

- let each participating family member claim their own identity;
- let returning members remember only one PIN or phrase;
- let a trusted device stay signed in for a long time;
- let Bucky know which family member is speaking;
- attribute uploads, answers, and other changes to that verified member;
- make the family tree a useful part of the website in its own right; and
- support adding parents, grandparents, and earlier generations later without redesigning the model.

The user explicitly does **not** want enterprise-style security at this stage. The family context and low expected damage take precedence over hardening and onboarding ceremony. Security can be revisited later.

## Confirmed Decisions

### Claiming an identity

1. The site has a prebuilt family tree based on family information supplied by Jeremy.
2. A first-time user chooses **Find yourself in the tree** and clicks their name.
3. If that profile is unclaimed, the person can claim it immediately.
4. There is no curator approval gate and no one-time invitation code in the initial version.
5. The person creates any memorable PIN or phrase. It may be short or long; do not impose strict composition rules.
6. The PIN or phrase must be unique across claimed profiles because the intended returning-user flow accepts the phrase alone and resolves it to a member.
7. Recovery email is optional.
8. If the person forgets the phrase and has no recovery email, they ask Jeremy, the website curator, to reset or unclaim the profile.
9. A claimed profile cannot be claimed again unless a curator resets it.

### Returning users

- The login page first offers one simple PIN/phrase field.
- Entering the phrase identifies the member and signs them in; the member does not also need to select their name.
- The browser/device should remain signed in for a long period. A one-year rolling session or an explicit-until-logout session is consistent with the request.
- Also offer **Find yourself in the tree** for first-time claiming.

### Explicitly rejected for now

Do not silently reintroduce these ideas:

- mandatory email login or email OTP;
- required passkeys;
- curator approval before a profile can be claimed;
- per-person invitation codes;
- strict minimum phrase length or character requirements;
- short session expiration;
- a requirement that every directory member have an account or email; or
- a large role/permission system as a prerequisite for launch.

Optional recovery email and future security upgrades remain possible, but they are not the initial experience.

## Credential and Session Design

The user is not concerned about high security, but there is no reason to store phrases in plaintext.

Recommended lightweight implementation:

- Normalize the submitted phrase consistently before lookup: Unicode NFKC, trim outer whitespace, collapse repeated whitespace, and compare case-insensitively.
- Compute a keyed HMAC-SHA-256 fingerprint using `AUTH_SECRET`.
- Put a unique database constraint on the fingerprint. This supports phrase-only login and clean duplicate detection without retaining the phrase.
- Do not log or return the phrase.
- Retain basic request throttling to avoid accidental or automated request floods, but do not build a complicated lockout experience.
- Store long-lived sessions in a `FamilySession` table using an opaque random cookie token whose database value is hashed. This allows curator resets and logout to revoke sessions cleanly.
- A phrase reset should revoke the member's existing sessions.

If security requirements increase later, an Argon2id verifier, passkeys, verified recovery, shorter sessions, and claim approval can be added without changing the family tree or actor-attribution model.

## Proposed Data Model

The current `FamilyMember` model has `name`, `branch`, and a free-text `relation`, but no real graph edges. Do not encode the tree with fixed generation columns or a single `spouseId`.

Add a relationship model similar to:

```prisma
model FamilyRelationship {
  id           String   @id @default(cuid())
  fromMemberId String
  toMemberId   String
  type         String   // parent, spouse
  createdAt    DateTime @default(now())

  @@unique([fromMemberId, toMemberId, type])
  @@index([fromMemberId, type])
  @@index([toMemberId, type])
}
```

Parent relationships are directional. Spouse relationships should be stored in one canonical direction and treated as symmetric by the application. This supports ancestors, multiple generations, and future family changes.

Add identity fields or related models for:

- claim status and `claimedAt`;
- unique phrase fingerprint;
- optional recovery email and verification state;
- curator capability;
- long-lived sessions;
- last login and credential reset metadata; and
- a credential/session version or equivalent revocation mechanism.

Prefer separate `FamilyCredential` and `FamilySession` models over putting session tokens directly on `FamilyMember`.

## Bucky and Attribution

The central behavioral requirement is that identity comes from the server session, not from chat text or browser local storage.

Create one server helper such as `requireActor(request)` / `getCurrentActor(request)` that returns:

```ts
interface ActorContext {
  memberId: string;
  displayName: string;
  branch?: string;
  relation?: string;
  boardRole?: string;
  isBoardMember: boolean;
  isCurator: boolean;
}
```

Pass this actor into Bucky outside the model-controlled tool arguments. Bucky should know whom it is addressing and use the member identity when interpreting phrases such as "my stay," "my branch," or "remember that I prefer..." Personal memories should be scoped to the member; family rules and decisions should remain family-scoped.

Stop treating `localStorage.getItem("breadloaf-username")` or names submitted in request bodies as authoritative. The UI may display session identity, but APIs should derive attribution from `ActorContext`.

Add nullable member-ID relations while preserving existing name strings as historical snapshots. Important attribution surfaces include:

- `Document.uploadedBy`;
- Bucky chat sessions and messages;
- `BuckyLedgerEntry.initiatedBy` and undo attribution;
- `BuckyQuestion.answeredBy`;
- bulletin authors;
- grocery additions and checkoffs;
- pantry updates;
- checklist completion;
- assets and maintenance changes;
- stays and expenses; and
- corporate account audit fields.

Email ingestion should match a normalized sender email to a unique `FamilyMember` when possible. Unknown senders should remain explicitly external rather than being guessed as a family member.

## Current-System Findings

The next session should account for these existing behaviors:

- `src/lib/auth.ts` maps `FAMILY_PINS` to a family/branch string and signs a 30-day cookie.
- `src/middleware.ts` protects the whole site using that signed cookie.
- `src/app/login/page.tsx` is a four-digit PIN interface.
- Login writes the PIN label to `breadloaf-username` in local storage.
- Several pages let the user edit that local name and send it to APIs.
- Many APIs currently trust client-supplied `uploadedBy`, `author`, `addedBy`, `checkedBy`, or `updatedBy` values.
- A few newer governed routes already read the signed session server-side, but they receive only the PIN label rather than a member ID.
- `FamilyMember` currently has directory details but no credential, session, parent, child, or spouse relations.
- Production had 13 `FamilyMember` rows when checked on 2026-07-21: 7 had unique email addresses and 6 had none. Missing email is not a blocker because only participating users need an account and recovery is optional.

## UI Direction: Living Family Tree

The tree should feel like part of Breadloaf Hill's editorial property archive, not like generic genealogy software.

### Desktop

- Use a full-width, pannable tree rather than placing the graph in a decorative card.
- Start with the four brothers as the center generation.
- Pair spouses visually as one family unit, with children branching beneath them.
- Add parents, grandparents, and earlier generations upward.
- Use compact person nodes with name, optional photo or initials, branch, and a subtle claimed/unclaimed state.
- Clicking a person opens a side panel with immediate relationships and, when appropriate, **Claim this profile**.
- Include quiet controls for search, zoom, collapse branch, reset view, and **Center on me**.
- Use restrained connectors and generation labels so a large tree remains scannable.

### Mobile

- Do not shrink the entire tree into unreadable nodes.
- Show a focused branch centered on one person or couple.
- Let the user tap parents, siblings, spouses, or children to navigate.
- Provide a simple generation breadcrumb and branch switcher.
- Keep claim and sign-in actions reachable without competing with the tree.

### Login and claim states

- Default returning-user action: one PIN/phrase field.
- Secondary action: **Find yourself in the tree**.
- Unclaimed profile: **Claim this profile**.
- Claimed profile: no claim button.
- Pending state is unnecessary because there is no approval workflow.
- After login, center the tree on the authenticated member and let Bucky greet them by name.
- Curator mode should support adding and editing people, connecting relationships, resetting claims, and correcting mistakes.
- Do not expose directory email addresses, phone numbers, birthdays, or notes in the pre-login tree.

For implementation, use a proven DOM-based graph library such as `@xyflow/react` plus a layered layout engine such as ELK. Keep layout data derived from relationship records rather than saving screen coordinates as family truth.

## Suggested Implementation Sequence

1. Collect and confirm the initial family relationships. The user said "Fort Brothers," likely dictation for "four brothers"; confirm names and exact relationships.
2. Add relationship, credential, session, and nullable actor-ID schema changes in one reversible Prisma migration.
3. Add relationship validation and tests, including cycle protection for parent links and canonical spouse pairs.
4. Implement phrase normalization, keyed fingerprints, duplicate handling, session issuance, logout, curator reset, and tests.
5. Build read-only tree APIs and the responsive Living Family Tree UI.
6. Add profile claiming and optional recovery-email capture.
7. Introduce the central server-side `ActorContext` helper.
8. Pass verified actor identity into Bucky and scope personal memory correctly.
9. Convert write routes in batches to derive attribution from the actor, preserving legacy display strings.
10. Replace editable local-storage identity controls with session identity.
11. Deploy behind the existing PIN first, claim at least Jeremy's curator profile, and verify reset access.
12. Switch login to phrase-or-tree mode, retain a temporary curator recovery path, then retire `FAMILY_PINS` after production verification.

## Required Family Input

No actual tree relationships have been supplied yet. Natural-language input is fine. A convenient structure is:

```text
Brother:
Spouse:
Children:
Each child's spouse:
Grandchildren:
```

Also identify:

- Jeremy's exact `FamilyMember` record and whether he is the initial curator;
- any second curator desired for operational backup;
- deceased family members who should appear but cannot claim;
- children who should appear but are not eligible to claim yet;
- preferred display names; and
- any photos to use, if available.

## Definition of Done

- The supplied family structure renders correctly on desktop and mobile.
- Earlier generations can be added without schema or layout redesign.
- An unclaimed eligible member can claim their profile with a unique phrase.
- Duplicate normalized phrases are rejected without revealing another member.
- A returning member can sign in using only their phrase.
- A trusted device remains signed in across normal visits.
- Jeremy can reset or unclaim a profile.
- Optional recovery email can be added without being required.
- Bucky receives the authenticated member ID and name server-side.
- New uploads and governed changes carry member-ID attribution.
- Existing historical name attribution remains visible.
- Client-supplied names are no longer authoritative.
- The existing PIN remains available until a verified production cutover.
