import type { FamilyTree, TreePerson } from "@/lib/family-tree";

/**
 * Layout for the descent plate — the circular "growth ring" rendering of the family.
 *
 * Deliberately free of any Prisma import so this can be pulled into a client
 * bundle. It is a pure function of the FamilyTree that `/api/family/tree` already
 * returns; the graph stays the single source of truth and this is one more way to
 * read it.
 *
 * Three rules carry most of the meaning:
 *
 *  - The viewer chooses the centre. Founder is an honour flagged on the member
 *    (`isFounder`), never a consequence of being centred — otherwise adding a
 *    generation above Bill and Lois would silently crown someone new.
 *  - The partner beside someone is whoever CO-PARENTED the people on the plate,
 *    not merely their current spouse. That puts Lois beside Bill and Kirsten
 *    beside Sandy, and keeps later marriages out of positions they never held.
 *  - Children are laid out inside their own parent's slice of arc, so following a
 *    line inward traces actual descent rather than just generation membership.
 */

/** No branch drops below this, however few descendants it has yet. */
export const MIN_BRANCH_DEGREES = 52;

export interface PlatePartner {
  id: string;
  /** True when this partner is a parent of the children shown below the node. */
  coParent: boolean;
}

export interface PlateNode {
  id: string;
  partners: PlatePartner[];
  children: PlateNode[];
  /** Set when depth limiting hid this node's children — the plate shows a marker. */
  truncatedChildren?: number;
}

export interface PlateSlot {
  node: PlateNode;
  /** Dotted path from the root ("2.1.0"). Lineage is prefix matching on this. */
  path: string;
  depth: number;
  startAngle: number;
  endAngle: number;
  midAngle: number;
}

export interface PlateLayout {
  root: PlateNode;
  slots: PlateSlot[];
  branchSpans: number[];
  ringCount: number;
  headcount: number;
}

/**
 * Co-parents first, then any other current spouse. A person who married in after
 * the children were born is still recorded — just never mistaken for their parent.
 */
export function partnersFor(tree: FamilyTree, personId: string): PlatePartner[] {
  const person = tree.people[personId];
  if (!person) return [];

  const coParents: string[] = [];
  for (const childId of person.childIds) {
    const child = tree.people[childId];
    if (!child) continue;
    for (const parentId of child.parentIds) {
      if (parentId !== personId && !coParents.includes(parentId)) coParents.push(parentId);
    }
  }

  const others = person.currentSpouseIds.filter((id) => !coParents.includes(id));

  return [
    ...coParents.map((id) => ({ id, coParent: true })),
    ...others.map((id) => ({ id, coParent: false })),
  ];
}

/** The descendants of one person, as a nested tree. */
export function buildDescentPlate(tree: FamilyTree, rootId: string): PlateNode {
  const seen = new Set<string>();

  const build = (id: string): PlateNode => {
    // Malformed data must not hang the page; a repeated id simply stops descending.
    const descend = !seen.has(id);
    seen.add(id);
    const person = tree.people[id];
    return {
      id,
      partners: partnersFor(tree, id),
      children: descend ? (person?.childIds ?? []).map(build) : [],
    };
  };

  return build(rootId);
}

/** Terminal descendants below a node — the angular weight. */
export function leafCount(node: PlateNode): number {
  if (!node.children.length) return 1;
  return node.children.reduce((total, child) => total + leafCount(child), 0);
}

export function nodeDepth(node: PlateNode): number {
  if (!node.children.length) return 1;
  return 1 + Math.max(...node.children.map(nodeDepth));
}

export function nodeHeadcount(node: PlateNode): number {
  return (
    1 +
    node.partners.length +
    node.children.reduce((total, child) => total + nodeHeadcount(child), 0)
  );
}

/**
 * Branch width blends descendant count with headcount, then a floor keeps the
 * smallest branch legible — weighting by descendants alone squeezed Sandy's side
 * to a 30° sliver.
 */
export function branchSpans(branches: PlateNode[]): number[] {
  if (!branches.length) return [];

  const raw = branches.map((b) => leafCount(b) + nodeHeadcount(b) * 0.5);
  const rawTotal = raw.reduce((a, b) => a + b, 0) || 1;
  let spans = raw.map((w) => (360 * w) / rawTotal);

  const floor = Math.min(MIN_BRANCH_DEGREES, 360 / branches.length);
  let deficit = 0;
  spans = spans.map((deg) => {
    if (deg >= floor) return deg;
    deficit += floor - deg;
    return floor;
  });

  const surplus = spans.reduce((total, deg) => total + Math.max(0, deg - floor), 0);
  if (deficit > 0 && surplus > 0) {
    spans = spans.map((deg) =>
      deg > floor ? deg - ((deg - floor) * deficit) / surplus : deg
    );
  }

  return spans;
}

export interface LayoutOptions {
  /**
   * Rings to draw below the centre. Inside the 440px shell there is only room for
   * two before the bands get too thin to stack a couple in, so depth is traded for
   * legibility and the rest is reached by re-centring instead.
   */
  maxDepth?: number;
}

/** Nodes deeper than `maxDepth` are dropped, and their parent marked `truncated`. */
function pruneDepth(node: PlateNode, maxDepth: number, depth = 1): PlateNode {
  if (depth >= maxDepth && node.children.length) {
    return { ...node, children: [], truncatedChildren: node.children.length };
  }
  return {
    ...node,
    children: node.children.map((child) => pruneDepth(child, maxDepth, depth + 1)),
  };
}

/** Place every node, children nested inside their own parent's slice of arc. */
export function layoutPlate(
  tree: FamilyTree,
  rootId: string,
  options: LayoutOptions = {}
): PlateLayout {
  let root = buildDescentPlate(tree, rootId);
  if (options.maxDepth && options.maxDepth > 0) {
    root = { ...root, children: root.children.map((c) => pruneDepth(c, options.maxDepth!)) };
  }
  const branches = root.children;
  const spans = branchSpans(branches);
  const slots: PlateSlot[] = [];

  const place = (node: PlateNode, startAngle: number, endAngle: number, depth: number, path: string) => {
    slots.push({
      node,
      path,
      depth,
      startAngle,
      endAngle,
      midAngle: (startAngle + endAngle) / 2,
    });

    if (!node.children.length) return;
    const weights = node.children.map(leafCount);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let cursor = startAngle;
    node.children.forEach((child, index) => {
      const slice = ((endAngle - startAngle) * weights[index]) / total;
      place(child, cursor, cursor + slice, depth + 1, `${path}.${index}`);
      cursor += slice;
    });
  };

  let cursor = 0;
  branches.forEach((branch, index) => {
    place(branch, cursor, cursor + spans[index], 0, String(index));
    cursor += spans[index];
  });

  return {
    root,
    slots,
    branchSpans: spans,
    ringCount: branches.length ? Math.max(...branches.map(nodeDepth)) : 0,
    headcount: nodeHeadcount(root),
  };
}

/** Is `path` on the same line of descent as `other` — above it or below it? */
export function onSameLine(path: string, other: string): boolean {
  return path === other || path.startsWith(`${other}.`) || other.startsWith(`${path}.`);
}

export interface PlateCandidate {
  id: string;
  label: string;
  isFounder: boolean;
}

/** Anyone with descendants can hold the centre; founders lead as the default view. */
export function plateCandidates(tree: FamilyTree): PlateCandidate[] {
  return Object.values(tree.people)
    .filter((person) => person.childIds.length > 0)
    .sort((a, b) => {
      if (a.isFounder !== b.isFounder) return a.isFounder ? -1 : 1;
      if (a.generation !== b.generation) return a.generation - b.generation;
      return a.displayName.localeCompare(b.displayName);
    })
    .map((person) => ({
      id: person.id,
      label: person.isFounder ? `${person.displayName} (founder)` : person.displayName,
      isFounder: person.isFounder,
    }));
}

/** The default centre: a founder if one exists, else the shallowest person with children. */
export function defaultPlateRoot(tree: FamilyTree): string | null {
  const candidates = plateCandidates(tree);
  return candidates.length ? candidates[0].id : null;
}

export function personLabel(person: TreePerson | undefined): string {
  if (!person) return "—";
  return person.displayName;
}
