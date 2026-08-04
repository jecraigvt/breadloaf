// Reconcile the Craig family roster into FamilyMember + FamilyRelationship.
//
// Idempotent and safe to re-run. Existing rows are matched by normalized name and
// updated in place, so member ids, board roles, and PositionAssignment foreign keys
// survive. Only genuinely missing people are created; nothing is ever deleted.
//
// Dry run (default):  npx tsx scripts/seed-family-tree.ts
// Apply:              npx tsx scripts/seed-family-tree.ts --apply
// Production:         railway run npx tsx scripts/seed-family-tree.ts --apply
//
// Ambiguous matches are reported and skipped rather than guessed — "William Craig"
// is both Sandy's legal name and Greg's son Will, so a blind name match would merge
// two different people.

import { prisma } from "../src/lib/prisma";
import { deriveBranches, type FamilyGraph } from "../src/lib/family-tree";

const APPLY = process.argv.includes("--apply");

const TOM = "Tom's family";
const JIM = "Jim's family";
const SANDY = "Sandy's family";
const GREG = "Greg's family";

interface RosterPerson {
  key: string;
  name: string;
  displayName: string;
  surname?: string;
  maidenName?: string;
  branch?: string;
  isBranchRoot?: boolean;
  sortOrder?: number;
  isMinor?: boolean;
  canClaim?: boolean;
  deceased?: boolean;
  isFounder?: boolean;
  isCurator?: boolean;
  needsReview?: string;
}

// Generation rule applied here: everyone in the brothers' and cousins' generations is
// treated as an adult who may claim a profile; the six grandchildren are marked minors,
// which withholds their surname from the ungated tree and blocks claiming.
const ROSTER: RosterPerson[] = [
  // ---- The forebears ----
  // Above the branch split, so they intentionally derive to no branch at all. The
  // brothers stay isBranchRoot even though they now have parents — that flag, not
  // "has no parents", is what seeds branch derivation.
  {
    key: "bill",
    name: "William Craig",
    displayName: "Bill",
    surname: "Craig",
    sortOrder: 1,
    deceased: true,
    canClaim: false,
    isFounder: true,
  },
  {
    key: "lois",
    name: "Lois Bestor Craig",
    displayName: "Lois",
    surname: "Craig",
    maidenName: "Bestor",
    sortOrder: 2,
    deceased: true,
    canClaim: false,
    isFounder: true,
  },
  {
    // Bill's second wife, after the divorce from Lois. Recorded as a current marriage
    // rather than former — it ended with his death, not a separation.
    key: "lorenza",
    name: "Lorenza",
    displayName: "Lorenza",
    sortOrder: 3,
    needsReview: "Surname unconfirmed; confirm whether she is living.",
  },

  // ---- Generation I: the four brothers, in birth order ----
  {
    // Shares a legal name with Greg's son James. They are told apart by displayName,
    // and the matcher refuses to merge them on a bare "James Craig".
    key: "jim",
    name: "James Craig",
    displayName: "Jim",
    surname: "Craig",
    branch: JIM,
    isBranchRoot: true,
    sortOrder: 1,
  },
  {
    key: "greg",
    name: "Gregory Craig",
    displayName: "Greg",
    surname: "Craig",
    branch: GREG,
    isBranchRoot: true,
    sortOrder: 2,
  },
  {
    key: "tom",
    name: "Thomas Craig",
    displayName: "Tom",
    surname: "Craig",
    branch: TOM,
    isBranchRoot: true,
    sortOrder: 3,
  },
  {
    key: "sandy",
    name: "William Craig",
    displayName: "Sandy",
    surname: "Craig",
    branch: SANDY,
    isBranchRoot: true,
    sortOrder: 4,
  },

  // ---- Generation I spouses ----
  // Surnames are left null where they were never stated rather than assumed.
  { key: "mira", name: "Almira Craig", displayName: "Mira", surname: "Craig", sortOrder: 1 },
  { key: "derry", name: "Derry Craig", displayName: "Derry", surname: "Craig", sortOrder: 1 },
  {
    key: "judy",
    name: "Helen Veronica Judith Craig",
    displayName: "Judy",
    surname: "Craig",
    maidenName: "Norman",
    sortOrder: 1,
  },
  // Kept her own surname, so no maidenName — the tree should not render a "née".
  {
    key: "andrea",
    name: "Andrea DeLaBruere",
    displayName: "Andrea",
    surname: "DeLaBruere",
    sortOrder: 1,
  },
  {
    key: "kirsten",
    name: "Kirsten",
    displayName: "Kirsten",
    sortOrder: 2,
    canClaim: false,
    needsReview:
      "Former spouse of Sandy and Riley's mother — kept in the tree for accuracy. Surname unconfirmed.",
  },

  // ---- Generation II: Jim's ----
  {
    key: "kc",
    name: "Katherine Keller",
    displayName: "KC",
    surname: "Keller",
    maidenName: "Craig",
    sortOrder: 1,
  },
  { key: "rob", name: "Robert Keller", displayName: "Rob", surname: "Keller", sortOrder: 1 },
  { key: "ethan", name: "Ethan Craig", displayName: "Ethan", surname: "Craig", sortOrder: 2 },
  {
    key: "annie",
    name: "Annie Craig",
    displayName: "Annie",
    surname: "Craig",
    sortOrder: 1,
    needsReview: "Maiden name unknown.",
  },

  // ---- Generation II: Greg's ----
  { key: "will", name: "William Craig", displayName: "Will", surname: "Craig", sortOrder: 1 },
  { key: "ziza", name: "Eliza Craig", displayName: "Ziza", surname: "Craig", sortOrder: 2 },
  { key: "maggie", name: "Margaret Craig", displayName: "Maggie", surname: "Craig", sortOrder: 3 },
  { key: "mary", name: "Mary Craig", displayName: "Mary", surname: "Craig", sortOrder: 4 },
  { key: "jamesG", name: "James Craig", displayName: "James", surname: "Craig", sortOrder: 5 },
  {
    key: "rama",
    name: "Rama",
    displayName: "Rama",
    sortOrder: 1,
    needsReview:
      "Surname unknown. Married to Mary, who is recorded as keeping Craig — confirm both.",
  },

  // ---- Generation II: Tom's ----
  {
    key: "vanessa",
    name: "Vanessa Devlin",
    displayName: "Vanessa",
    surname: "Devlin",
    maidenName: "Craig",
    sortOrder: 1,
  },
  { key: "ben", name: "Benjamin Devlin", displayName: "Ben", surname: "Devlin", sortOrder: 1 },
  {
    key: "jeremy",
    name: "Jeremy Craig",
    displayName: "Jeremy",
    surname: "Craig",
    sortOrder: 2,
    isCurator: true,
  },
  {
    key: "colleen",
    name: "Colleen Craig",
    displayName: "Colleen",
    surname: "Craig",
    maidenName: "McCabe",
    sortOrder: 1,
  },

  // ---- Generation II: Sandy's ----
  { key: "riley", name: "Riley Craig", displayName: "Riley", surname: "Craig", sortOrder: 1 },

  // ---- Generation III: the grandchildren ----
  {
    key: "craigKeller",
    name: "Craig Keller",
    displayName: "Craig",
    surname: "Keller",
    sortOrder: 1,
    isMinor: true,
    canClaim: false,
  },
  {
    // "Eleanor", confirmed 2026-07-24 — the dictated roster's "Elenor" was a slip.
    key: "ellie",
    name: "Eleanor Craig",
    displayName: "Ellie",
    surname: "Craig",
    sortOrder: 1,
    isMinor: true,
    canClaim: false,
  },
  {
    key: "jacob",
    name: "Jacob Devlin",
    displayName: "Jacob",
    surname: "Devlin",
    sortOrder: 1,
    isMinor: true,
    canClaim: false,
  },
  {
    key: "jonathan",
    name: "Jonathan Devlin",
    displayName: "Jonathan",
    surname: "Devlin",
    sortOrder: 2,
    isMinor: true,
    canClaim: false,
  },
  {
    key: "jack",
    name: "Jack Craig",
    displayName: "Jack",
    surname: "Craig",
    sortOrder: 1,
    isMinor: true,
    canClaim: false,
  },
  {
    key: "sam",
    name: "Sam Craig",
    displayName: "Sam",
    surname: "Craig",
    sortOrder: 2,
    isMinor: true,
    canClaim: false,
  },
];

// Spouse edges are stored one-directional and read symmetrically. The Craig side is
// listed first purely so the canonical direction is stable across re-runs.
const MARRIAGES: Array<[string, string, "current" | "former"]> = [
  ["bill", "lois", "former"],
  ["bill", "lorenza", "current"],
  ["jim", "mira", "current"],
  ["greg", "derry", "current"],
  ["tom", "judy", "current"],
  ["sandy", "andrea", "current"],
  ["sandy", "kirsten", "former"],
  ["kc", "rob", "current"],
  ["ethan", "annie", "current"],
  ["mary", "rama", "current"],
  ["vanessa", "ben", "current"],
  ["jeremy", "colleen", "current"],
];

// Each child is linked to BOTH parents individually. Riley is deliberately linked to
// Sandy and Kirsten — not to Sandy's current marriage.
const CHILDREN: Array<[string, string[]]> = [
  ["bill", ["jim", "greg", "tom", "sandy"]],
  ["lois", ["jim", "greg", "tom", "sandy"]],
  ["jim", ["kc", "ethan"]],
  ["mira", ["kc", "ethan"]],
  ["greg", ["will", "ziza", "maggie", "mary", "jamesG"]],
  ["derry", ["will", "ziza", "maggie", "mary", "jamesG"]],
  ["tom", ["vanessa", "jeremy"]],
  ["judy", ["vanessa", "jeremy"]],
  ["sandy", ["riley"]],
  ["kirsten", ["riley"]],
  ["kc", ["craigKeller"]],
  ["rob", ["craigKeller"]],
  ["ethan", ["ellie"]],
  ["annie", ["ellie"]],
  ["vanessa", ["jacob", "jonathan"]],
  ["ben", ["jacob", "jonathan"]],
  ["jeremy", ["jack", "sam"]],
  ["colleen", ["jack", "sam"]],
];

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”‘’"']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Directory rows often carry an inline nickname — `Katherine "K.C." Keller`. Drop the
 * quoted or parenthesised part so the row still matches on the plain legal name.
 */
function stripInlineNickname(value: string): string {
  return value
    .replace(/[“‘"']\s*[^”’"']*\s*[”’"']/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every spelling of an existing row we are willing to match against the roster. */
function rowMatchKeys(name: string): string[] {
  const keys = new Set<string>([normalize(name), normalize(stripInlineNickname(name))]);
  return Array.from(keys).filter(Boolean);
}

/** Every spelling of a roster person an existing directory row might plausibly use. */
function matchKeysFor(person: RosterPerson): string[] {
  const keys = new Set<string>();
  const first = person.name.split(" ")[0];
  keys.add(normalize(person.name));
  keys.add(normalize(person.displayName));
  if (person.surname) {
    keys.add(normalize(`${person.displayName} ${person.surname}`));
    keys.add(normalize(`${first} ${person.surname}`));
  }
  return Array.from(keys).filter(Boolean);
}

async function main() {
  console.log(`Craig family roster — ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`${ROSTER.length} people, ${MARRIAGES.length} marriages\n`);

  const existing = await prisma.familyMember.findMany();
  console.log(`Existing FamilyMember rows: ${existing.length}\n`);

  // Build normalized name -> roster keys, so collisions are visible instead of silent.
  const claimants = new Map<string, string[]>();
  for (const person of ROSTER) {
    for (const key of matchKeysFor(person)) {
      if (!claimants.has(key)) claimants.set(key, []);
      claimants.get(key)!.push(person.key);
    }
  }

  const matchedId = new Map<string, string>(); // roster key -> existing member id
  const claimedRowIds = new Set<string>();
  const ambiguous: string[] = [];
  const unmatchedRows: string[] = [];

  // Pass 1 — displayName, which this script itself writes and which is unique across
  // the roster. This is what makes re-runs exact: after the first apply, "William
  // Craig" is ambiguous by name but "Sandy" and "Will" are not.
  const byDisplayName = new Map(
    ROSTER.map((person) => [normalize(person.displayName), person.key])
  );
  for (const row of existing) {
    if (!row.displayName) continue;
    const rosterKey = byDisplayName.get(normalize(row.displayName));
    if (!rosterKey || matchedId.has(rosterKey)) continue;
    matchedId.set(rosterKey, row.id);
    claimedRowIds.add(row.id);
  }

  // Pass 2 — fall back to the full name for rows this script has never touched.
  for (const row of existing) {
    if (claimedRowIds.has(row.id)) continue;

    const candidates = Array.from(
      new Set(rowMatchKeys(row.name).flatMap((key) => claimants.get(key) ?? []))
    ).filter((key) => !matchedId.has(key));

    if (candidates.length === 0) {
      unmatchedRows.push(`${row.name} (${row.id})`);
      continue;
    }
    if (candidates.length > 1) {
      ambiguous.push(
        `"${row.name}" could be: ${candidates.join(", ")} — set displayName by hand to resolve`
      );
      continue;
    }
    matchedId.set(candidates[0], row.id);
    claimedRowIds.add(row.id);
  }

  const toUpdate = ROSTER.filter((person) => matchedId.has(person.key));
  const toCreate = ROSTER.filter((person) => !matchedId.has(person.key));

  console.log(`Matched to existing rows: ${toUpdate.length}`);
  for (const person of toUpdate) {
    console.log(`  update  ${person.displayName.padEnd(10)} <- ${matchedId.get(person.key)}`);
  }
  console.log(`\nWill create: ${toCreate.length}`);
  for (const person of toCreate) console.log(`  create  ${person.displayName}`);

  if (ambiguous.length > 0) {
    console.log(`\nAMBIGUOUS — skipped, resolve by hand:`);
    for (const line of ambiguous) console.log(`  ! ${line}`);
  }
  if (unmatchedRows.length > 0) {
    console.log(`\nExisting rows not in the roster (left untouched):`);
    for (const line of unmatchedRows) console.log(`  ? ${line}`);
  }

  if (!APPLY) {
    console.log(`\nDry run — nothing written. Re-run with --apply to commit.`);
    return;
  }

  // ---- Write members ----
  const idByKey = new Map<string, string>();

  for (const person of ROSTER) {
    const data = {
      name: person.name,
      displayName: person.displayName,
      surname: person.surname ?? null,
      maidenName: person.maidenName ?? null,
      // Only branch roots carry a hand-set branch; everyone else is derived below.
      branch: person.isBranchRoot ? person.branch ?? null : undefined,
      isBranchRoot: Boolean(person.isBranchRoot),
      sortOrder: person.sortOrder ?? 0,
      isMinor: Boolean(person.isMinor),
      canClaim: person.canClaim ?? true,
      deceased: Boolean(person.deceased),
      isFounder: Boolean(person.isFounder),
      isCurator: Boolean(person.isCurator),
      needsReview: person.needsReview ?? null,
    };

    const existingId = matchedId.get(person.key);
    if (existingId) {
      // Contact details, notes, and board roles already on the row are left alone.
      const updated = await prisma.familyMember.update({
        where: { id: existingId },
        data,
      });
      idByKey.set(person.key, updated.id);
    } else {
      const created = await prisma.familyMember.create({
        data: { ...data, branch: person.isBranchRoot ? person.branch ?? null : null },
      });
      idByKey.set(person.key, created.id);
    }
  }
  console.log(`\nMembers written: ${idByKey.size}`);

  // ---- Write relationships ----
  const resolve = (key: string): string => {
    const id = idByKey.get(key);
    if (!id) throw new Error(`Roster key "${key}" has no member id`);
    return id;
  };

  let relationshipCount = 0;

  for (const [fromKey, toKey, status] of MARRIAGES) {
    const fromMemberId = resolve(fromKey);
    const toMemberId = resolve(toKey);
    await prisma.familyRelationship.upsert({
      where: {
        fromMemberId_toMemberId_type: { fromMemberId, toMemberId, type: "spouse" },
      },
      create: { fromMemberId, toMemberId, type: "spouse", status },
      update: { status },
    });
    relationshipCount++;
  }

  for (const [parentKey, childKeys] of CHILDREN) {
    for (const childKey of childKeys) {
      const fromMemberId = resolve(parentKey);
      const toMemberId = resolve(childKey);
      await prisma.familyRelationship.upsert({
        where: {
          fromMemberId_toMemberId_type: { fromMemberId, toMemberId, type: "parent" },
        },
        create: { fromMemberId, toMemberId, type: "parent", status: "current" },
        update: {},
      });
      relationshipCount++;
    }
  }
  console.log(`Relationships written: ${relationshipCount}`);

  // ---- Refresh the derived branch cache ----
  const [members, relationships] = await Promise.all([
    prisma.familyMember.findMany(),
    prisma.familyRelationship.findMany(),
  ]);
  const graph = { members, relationships } as unknown as FamilyGraph;
  const branchOf = deriveBranches(graph);

  let branchUpdates = 0;
  for (const member of members) {
    const derived = branchOf.get(member.id) ?? null;
    if (derived !== member.branch) {
      await prisma.familyMember.update({
        where: { id: member.id },
        data: { branch: derived },
      });
      branchUpdates++;
    }
  }
  console.log(`Branch cache updated on ${branchUpdates} rows`);

  const summary = new Map<string, number>();
  for (const branch of Array.from(branchOf.values())) {
    const label = branch ?? "(no branch)";
    summary.set(label, (summary.get(label) ?? 0) + 1);
  }
  console.log(`\nDerived branches:`);
  for (const [label, count] of Array.from(summary.entries()).sort()) {
    console.log(`  ${label.padEnd(16)} ${count}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
