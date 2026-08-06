import { prisma } from "@/lib/prisma";

/**
 * Family graph helpers.
 *
 * The relationship rows are the source of truth for the tree; `FamilyMember.branch`
 * is a derived cache kept in sync by `scripts/seed-family-tree.ts` so older queries
 * that group by branch keep working.
 *
 * Two rules make remarriages and step-relationships behave:
 *  - parent edges attach to INDIVIDUAL parents, never to a couple;
 *  - couples are grouped at render time from current spouse edges.
 * Riley is Sandy + Kirsten's child while Sandy's current marriage is to Andrea, so
 * anything that treats a couple as the structural container misplaces her.
 */

export type RelationshipType = "parent" | "spouse";
export type RelationshipStatus = "current" | "former";
export type LineageClass = "descendant" | "ancestor" | "affine";

export interface GraphMember {
  id: string;
  name: string;
  displayName: string | null;
  surname: string | null;
  maidenName: string | null;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  branch: string | null;
  boardRole: string | null;
  isBoardMember: boolean;
  notes: string | null;
  photoUrl: string | null;
  isBranchRoot: boolean;
  isFounder: boolean;
  sortOrder: number;
  isMinor: boolean;
  canClaim: boolean;
  deceased: boolean;
  needsReview: string | null;
  isCurator: boolean;
  claimedAt: Date | null;
}

export interface GraphRelationship {
  fromMemberId: string;
  toMemberId: string;
  type: string;
  status: string;
}

export interface FamilyGraph {
  members: GraphMember[];
  relationships: GraphRelationship[];
}

/** A person as the tree renders them, with edges already resolved to ids. */
export interface TreePerson {
  id: string;
  displayName: string;
  fullName: string;
  surname: string | null;
  maidenName: string | null;
  initials: string;
  photoUrl: string | null;
  branch: string | null;
  /** Derived from graph edges relative to the branch roots; never stored. */
  lineage: LineageClass;
  generation: number;
  isMinor: boolean;
  canClaim: boolean;
  isClaimed: boolean;
  deceased: boolean;
  isFounder: boolean;
  isCurator: boolean;
  isBoardMember: boolean;
  boardRole: string | null;
  needsReview: string | null;
  parentIds: string[];
  childIds: string[];
  currentSpouseIds: string[];
  formerSpouseIds: string[];
  /** Contact detail is omitted entirely for unauthenticated viewers. */
  email?: string | null;
  phone?: string | null;
  birthday?: string | null;
  notes?: string | null;
}

/** A couple (or a single person) rendered as one unit within a generation band. */
export interface TreeUnit {
  id: string;
  memberIds: string[];
  /** Former partners are listed separately so they never absorb the current partner's children. */
  formerPartnerIds: string[];
  childIds: string[];
  branch: string | null;
  generation: number;
}

export interface TreeBranch {
  key: string;
  label: string;
  rootUnitId: string;
  unitIds: string[];
}

export interface FamilyTree {
  people: Record<string, TreePerson>;
  units: TreeUnit[];
  branches: TreeBranch[];
  /** Ancestors above the branch split (grandparents and up), oldest first. */
  ancestorUnitIds: string[];
  generationCount: number;
}

export async function loadFamilyGraph(): Promise<FamilyGraph> {
  const [members, relationships] = await Promise.all([
    prisma.familyMember.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.familyRelationship.findMany(),
  ]);

  return {
    members: members as unknown as GraphMember[],
    relationships: relationships as unknown as GraphRelationship[],
  };
}

function spouseEdges(relationships: GraphRelationship[], status?: RelationshipStatus) {
  return relationships.filter(
    (rel) => rel.type === "spouse" && (!status || rel.status === status)
  );
}

function parentEdges(relationships: GraphRelationship[]) {
  return relationships.filter((rel) => rel.type === "parent");
}

/**
 * Spouse edges are stored in one canonical direction. Every read path must treat
 * them as symmetric, so resolve partners by checking both ends.
 */
export function partnersOf(
  memberId: string,
  relationships: GraphRelationship[],
  status: RelationshipStatus
): string[] {
  const partners = new Set<string>();
  for (const rel of spouseEdges(relationships, status)) {
    if (rel.fromMemberId === memberId) partners.add(rel.toMemberId);
    if (rel.toMemberId === memberId) partners.add(rel.fromMemberId);
  }
  return Array.from(partners);
}

/**
 * Branch = which Craig brother you belong to.
 *
 * Branch roots are flagged explicitly (`isBranchRoot`) rather than inferred from
 * "has a branch label and no parents". The derived branch is cached back onto every
 * member, so an inferred rule would promote married-in spouses to roots on the second
 * run. Blood descent propagates down parent edges first, then anyone still unassigned
 * inherits from their spouse. Doing blood before marriage matters: it stops a
 * married-in partner from handing a branch sideways into the wrong family.
 *
 * Generations above the split (grandparents, once they exist) are roots with no
 * branch label and correctly resolve to null rather than being forced into a branch.
 */
export function deriveBranches(graph: FamilyGraph): Map<string, string | null> {
  const { members, relationships } = graph;
  const byId = new Map(members.map((member) => [member.id, member]));
  const parents = parentEdges(relationships);

  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const rel of parents) {
    if (!childrenOf.has(rel.fromMemberId)) childrenOf.set(rel.fromMemberId, []);
    childrenOf.get(rel.fromMemberId)!.push(rel.toMemberId);
    hasParent.add(rel.toMemberId);
  }

  const branchOf = new Map<string, string | null>();
  for (const member of members) branchOf.set(member.id, null);

  // 1. Seed the branch roots.
  const queue: string[] = [];
  for (const member of members) {
    if (member.isBranchRoot && member.branch) {
      branchOf.set(member.id, member.branch);
      queue.push(member.id);
    }
  }

  // 2. Propagate down blood lines.
  const visited = new Set<string>(queue);
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const branch = branchOf.get(currentId) ?? null;
    for (const childId of childrenOf.get(currentId) ?? []) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      branchOf.set(childId, branch);
      queue.push(childId);
    }
  }

  // 3. Marriage fills in the rest. Current partners win over former ones so a
  //    remarried person's ex does not override the current spouse's branch.
  for (const member of members) {
    if (branchOf.get(member.id)) continue;
    const current = partnersOf(member.id, relationships, "current");
    const former = partnersOf(member.id, relationships, "former");
    for (const partnerId of [...current, ...former]) {
      const partnerBranch = branchOf.get(partnerId);
      if (partnerBranch && visited.has(partnerId)) {
        branchOf.set(member.id, partnerBranch);
        break;
      }
    }
  }

  // Anyone still unresolved keeps whatever label they were given by hand.
  for (const member of members) {
    if (!branchOf.get(member.id) && member.branch) {
      branchOf.set(member.id, byId.get(member.id)?.branch ?? null);
    }
  }

  return branchOf;
}

/**
 * Classify each person relative to the Craig branch roots without consulting the
 * decorative branch cache. Descendants walk parent edges down from those roots;
 * ancestors walk the same edges upward. Everyone outside those two blood sets is
 * affine — their attached family enters the Craig graph through a spouse edge.
 *
 * Descendant wins if malformed cyclic data makes the traversals overlap. The
 * classification is deliberately computed on every read: storing it would merely
 * recreate the drift that made `branch: null` carry several meanings.
 */
export function deriveLineageClasses(graph: FamilyGraph): Map<string, LineageClass> {
  const memberIds = new Set(graph.members.map((member) => member.id));
  const childrenOf = new Map<string, string[]>();
  const parentsOf = new Map<string, string[]>();

  for (const rel of parentEdges(graph.relationships)) {
    if (!memberIds.has(rel.fromMemberId) || !memberIds.has(rel.toMemberId)) continue;
    if (!childrenOf.has(rel.fromMemberId)) childrenOf.set(rel.fromMemberId, []);
    childrenOf.get(rel.fromMemberId)!.push(rel.toMemberId);
    if (!parentsOf.has(rel.toMemberId)) parentsOf.set(rel.toMemberId, []);
    parentsOf.get(rel.toMemberId)!.push(rel.fromMemberId);
  }

  const roots = graph.members.filter((member) => member.isBranchRoot).map((member) => member.id);
  const walk = (starts: string[], edges: Map<string, string[]>): Set<string> => {
    const reached = new Set<string>();
    const queue = [...starts];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (reached.has(id)) continue;
      reached.add(id);
      queue.push(...(edges.get(id) ?? []));
    }
    return reached;
  };

  const descendants = walk(roots, childrenOf);
  const ancestorStarts = roots.flatMap((id) => parentsOf.get(id) ?? []);
  const ancestors = walk(ancestorStarts, parentsOf);
  const result = new Map<string, LineageClass>();

  for (const member of graph.members) {
    result.set(
      member.id,
      descendants.has(member.id)
        ? "descendant"
        : ancestors.has(member.id)
          ? "ancestor"
          : "affine"
    );
  }

  return result;
}

/**
 * Depth from the top of the blood line. Spouses adopt their partner's generation so
 * a couple always sits on one band.
 */
function deriveGenerations(graph: FamilyGraph): Map<string, number> {
  const { members, relationships } = graph;
  const parents = parentEdges(relationships);

  const parentsOf = new Map<string, string[]>();
  for (const rel of parents) {
    if (!parentsOf.has(rel.toMemberId)) parentsOf.set(rel.toMemberId, []);
    parentsOf.get(rel.toMemberId)!.push(rel.fromMemberId);
  }

  const generation = new Map<string, number>();

  // Longest path from a root, so a person is always below every one of their parents.
  const resolve = (memberId: string, seen: Set<string>): number => {
    if (generation.has(memberId)) return generation.get(memberId)!;
    if (seen.has(memberId)) return 0; // cycle guard — malformed data must not hang the page
    seen.add(memberId);

    const parentIds = parentsOf.get(memberId) ?? [];
    const depth =
      parentIds.length === 0
        ? 0
        : Math.max(...parentIds.map((parentId) => resolve(parentId, seen) + 1));

    generation.set(memberId, depth);
    seen.delete(memberId);
    return depth;
  };

  for (const member of members) resolve(member.id, new Set());

  // Married-in partners have no parents here, so they resolve to 0. Pull them down
  // to their partner's band.
  for (const member of members) {
    const parentIds = parentsOf.get(member.id) ?? [];
    if (parentIds.length > 0) continue;
    const partners = [
      ...partnersOf(member.id, relationships, "current"),
      ...partnersOf(member.id, relationships, "former"),
    ];
    const partnerDepths = partners
      .filter((partnerId) => (parentsOf.get(partnerId) ?? []).length > 0)
      .map((partnerId) => generation.get(partnerId) ?? 0);
    if (partnerDepths.length > 0) {
      generation.set(member.id, Math.max(...partnerDepths));
    }
  }

  return generation;
}

function initialsFor(displayName: string, surname: string | null): string {
  const first = displayName.trim()[0] ?? "?";
  const last = surname?.trim()[0] ?? "";
  return `${first}${last}`.toUpperCase();
}

export interface BuildTreeOptions {
  /** Unauthenticated viewers see no contact detail, and minors show a first name only. */
  includePrivateDetail: boolean;
}

export function buildFamilyTree(
  graph: FamilyGraph,
  options: BuildTreeOptions
): FamilyTree {
  const { members, relationships } = graph;
  const branchOf = deriveBranches(graph);
  const lineageOf = deriveLineageClasses(graph);
  const generationOf = deriveGenerations(graph);

  const childrenOf = new Map<string, string[]>();
  const parentsOf = new Map<string, string[]>();
  for (const rel of parentEdges(relationships)) {
    if (!childrenOf.has(rel.fromMemberId)) childrenOf.set(rel.fromMemberId, []);
    childrenOf.get(rel.fromMemberId)!.push(rel.toMemberId);
    if (!parentsOf.has(rel.toMemberId)) parentsOf.set(rel.toMemberId, []);
    parentsOf.get(rel.toMemberId)!.push(rel.fromMemberId);
  }

  const orderOf = new Map(members.map((member) => [member.id, member.sortOrder]));
  const bySortOrder = (a: string, b: string) =>
    (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0);

  const people: Record<string, TreePerson> = {};
  for (const member of members) {
    const displayName = member.displayName?.trim() || member.name.split(" ")[0];
    // A minor's surname is the identifying part, so it is what gets withheld.
    const redactMinor = member.isMinor && !options.includePrivateDetail;
    const surname = redactMinor ? null : member.surname;

    people[member.id] = {
      id: member.id,
      displayName,
      fullName: redactMinor ? displayName : member.name,
      surname,
      maidenName: redactMinor ? null : member.maidenName,
      initials: initialsFor(displayName, surname),
      photoUrl: member.photoUrl,
      branch: branchOf.get(member.id) ?? null,
      lineage: lineageOf.get(member.id) ?? "affine",
      generation: generationOf.get(member.id) ?? 0,
      isMinor: member.isMinor,
      canClaim: member.canClaim && !member.isMinor && !member.deceased,
      isClaimed: Boolean(member.claimedAt),
      deceased: member.deceased,
      isFounder: member.isFounder,
      isCurator: member.isCurator,
      isBoardMember: member.isBoardMember,
      boardRole: member.boardRole,
      needsReview: options.includePrivateDetail ? member.needsReview : null,
      parentIds: (parentsOf.get(member.id) ?? []).sort(bySortOrder),
      childIds: (childrenOf.get(member.id) ?? []).sort(bySortOrder),
      currentSpouseIds: partnersOf(member.id, relationships, "current"),
      formerSpouseIds: partnersOf(member.id, relationships, "former"),
      ...(options.includePrivateDetail
        ? {
            email: member.email,
            phone: member.phone,
            birthday: member.birthday,
            notes: member.notes,
          }
        : {}),
    };
  }

  // Group current couples into units. Children are unioned from BOTH partners
  // individually, so a child of an earlier marriage still appears under the parent
  // they actually belong to without being attributed to the current partner.
  const units: TreeUnit[] = [];
  const unitOfMember = new Map<string, string>();
  const placed = new Set<string>();

  // A unit must be anchored on the blood relative, not on whoever happens to sort
  // first — otherwise a married-in partner with a lower sortOrder leads the pair and
  // the tree reads "Andrea and Sandy". Blood = a branch root, or anyone with parents
  // in the graph.
  const isBlood = (memberId: string) =>
    members.find((m) => m.id === memberId)?.isBranchRoot === true ||
    (parentsOf.get(memberId) ?? []).length > 0;

  const orderedMembers = [...members].sort(
    (a, b) =>
      (generationOf.get(a.id) ?? 0) - (generationOf.get(b.id) ?? 0) ||
      Number(isBlood(b.id)) - Number(isBlood(a.id)) ||
      a.sortOrder - b.sortOrder
  );

  for (const member of orderedMembers) {
    if (placed.has(member.id)) continue;

    const person = people[member.id];
    const partners = person.currentSpouseIds.filter((id) => {
      if (placed.has(id)) return false;
      // Forebears are a blood-line section, not a branch:null bucket. Keep an
      // affine current spouse in their own unit so they cannot ride into it.
      const partnerLineage = people[id]?.lineage;
      return (
        (person.lineage !== "ancestor" && partnerLineage !== "ancestor") ||
        person.lineage === partnerLineage
      );
    });
    const memberIds = [member.id, ...partners];
    memberIds.forEach((id) => placed.add(id));

    const childIds = Array.from(
      new Set(memberIds.flatMap((id) => people[id]?.childIds ?? []))
    ).sort(bySortOrder);

    const unit: TreeUnit = {
      id: `unit-${member.id}`,
      memberIds,
      formerPartnerIds: person.formerSpouseIds.filter((id) => !memberIds.includes(id)),
      childIds,
      branch: person.branch,
      generation: person.generation,
    };
    units.push(unit);
    memberIds.forEach((id) => unitOfMember.set(id, unit.id));
  }

  // Branch columns are anchored on the shallowest unit carrying each branch label.
  const branchMap = new Map<string, TreeBranch>();
  for (const unit of units) {
    if (!unit.branch) continue;
    const existing = branchMap.get(unit.branch);
    if (!existing) {
      branchMap.set(unit.branch, {
        key: unit.branch,
        label: unit.branch,
        rootUnitId: unit.id,
        unitIds: [unit.id],
      });
      continue;
    }
    existing.unitIds.push(unit.id);
  }

  const branchOrder = (key: string) => {
    const rootUnit = units.find((unit) => unit.id === branchMap.get(key)?.rootUnitId);
    const anchorId = rootUnit?.memberIds[0];
    return anchorId ? orderOf.get(anchorId) ?? 0 : 0;
  };

  const branches = Array.from(branchMap.values()).sort(
    (a, b) => branchOrder(a.key) - branchOrder(b.key)
  );

  // Blood ancestors above the branch split are collected by lineage, not branch:null.
  // A divorced forebear leaves two units — one anchored on each partner —
  // and the former partner is already surfaced inside the other unit. Drop the
  // redundant one, but only when it adds nothing: a single person whose children are
  // all already accounted for. A former partner with children from elsewhere stays.
  const rawAncestorUnits = units
    .filter((unit) => unit.memberIds.some((id) => people[id]?.lineage === "ancestor"))
    .sort((a, b) => a.generation - b.generation);

  // Only an EARLIER unit may absorb a later one. Both halves of a divorced couple
  // list each other as a former partner, so a symmetric rule eliminates both.
  const ancestorUnitIds = rawAncestorUnits
    .filter((unit, index) => {
      if (unit.memberIds.length !== 1) return true;
      const [onlyMemberId] = unit.memberIds;
      return !rawAncestorUnits.some(
        (other, otherIndex) =>
          otherIndex < index &&
          other.formerPartnerIds.includes(onlyMemberId) &&
          unit.childIds.every((childId) => other.childIds.includes(childId))
      );
    })
    .map((unit) => unit.id);

  const generationCount =
    units.length === 0 ? 0 : Math.max(...units.map((unit) => unit.generation)) + 1;

  return { people, units, branches, ancestorUnitIds, generationCount };
}

export async function getFamilyTree(options: BuildTreeOptions): Promise<FamilyTree> {
  const graph = await loadFamilyGraph();
  return buildFamilyTree(graph, options);
}
