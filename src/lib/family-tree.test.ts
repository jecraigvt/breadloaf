import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFamilyTree,
  deriveBranches,
  partnersOf,
  type FamilyGraph,
  type GraphMember,
  type GraphRelationship,
} from "./family-tree";

function member(id: string, overrides: Partial<GraphMember> = {}): GraphMember {
  return {
    id,
    name: id,
    displayName: id,
    surname: "Craig",
    maidenName: null,
    email: `${id}@example.com`,
    phone: "555-0100",
    birthday: "March 1",
    branch: null,
    boardRole: null,
    isBoardMember: false,
    notes: null,
    photoUrl: null,
    isBranchRoot: false,
    sortOrder: 0,
    isMinor: false,
    canClaim: true,
    deceased: false,
    needsReview: null,
    isCurator: false,
    claimedAt: null,
    ...overrides,
  };
}

function parent(from: string, to: string): GraphRelationship {
  return { fromMemberId: from, toMemberId: to, type: "parent", status: "current" };
}

function spouse(
  from: string,
  to: string,
  status: "current" | "former" = "current"
): GraphRelationship {
  return { fromMemberId: from, toMemberId: to, type: "spouse", status };
}

/**
 * Mirrors the shape of the real roster that actually stresses the model: a remarried
 * brother whose child belongs to the earlier marriage, and a spouse who marries into
 * a branch from outside the graph.
 */
function graph(): FamilyGraph {
  return {
    members: [
      member("sandy", { branch: "Sandy's family", isBranchRoot: true, sortOrder: 4 }),
      member("andrea", { surname: null }),
      member("kirsten", { surname: null, canClaim: false }),
      member("riley", { sortOrder: 1 }),
      member("greg", { branch: "Greg's family", isBranchRoot: true, sortOrder: 2 }),
      member("derry", { surname: null }),
      member("mary", { sortOrder: 4 }),
      member("rama", { surname: null }),
      member("kid", { isMinor: true, canClaim: false, surname: "Craig" }),
    ],
    relationships: [
      spouse("sandy", "andrea", "current"),
      spouse("sandy", "kirsten", "former"),
      parent("sandy", "riley"),
      parent("kirsten", "riley"),
      spouse("greg", "derry", "current"),
      parent("greg", "mary"),
      parent("derry", "mary"),
      spouse("mary", "rama", "current"),
      parent("mary", "kid"),
      parent("rama", "kid"),
    ],
  };
}

test("spouse edges read symmetrically from either end", () => {
  const { relationships } = graph();
  assert.deepEqual(partnersOf("andrea", relationships, "current"), ["sandy"]);
  assert.deepEqual(partnersOf("sandy", relationships, "current"), ["andrea"]);
  assert.deepEqual(partnersOf("sandy", relationships, "former"), ["kirsten"]);
});

test("branch derives down blood lines and sideways through marriage", () => {
  const branches = deriveBranches(graph());
  assert.equal(branches.get("sandy"), "Sandy's family");
  assert.equal(branches.get("riley"), "Sandy's family");
  assert.equal(branches.get("mary"), "Greg's family");
  // Married in from outside the graph — inherits from the blood partner.
  assert.equal(branches.get("rama"), "Greg's family");
  assert.equal(branches.get("derry"), "Greg's family");
});

test("a former spouse keeps the branch she married into", () => {
  const branches = deriveBranches(graph());
  assert.equal(branches.get("kirsten"), "Sandy's family");
  assert.equal(branches.get("andrea"), "Sandy's family");
});

test("re-running derivation on cached branches does not create new roots", () => {
  // The branch cache is written back to every member, so a second pass sees
  // married-in spouses already carrying a branch. Only isBranchRoot may seed.
  const base = graph();
  const cached: FamilyGraph = {
    members: base.members.map((m) => ({
      ...m,
      branch: deriveBranches(base).get(m.id) ?? null,
    })),
    relationships: base.relationships,
  };
  const second = deriveBranches(cached);
  assert.equal(second.get("rama"), "Greg's family");
  assert.equal(second.get("riley"), "Sandy's family");
  assert.equal(second.get("kirsten"), "Sandy's family");
});

test("a remarriage does not reparent the earlier marriage's child", () => {
  const tree = buildFamilyTree(graph(), { includePrivateDetail: true });
  const sandyUnit = tree.units.find((unit) => unit.memberIds.includes("sandy"));
  assert.ok(sandyUnit);
  // Sandy's current unit is Sandy + Andrea...
  assert.deepEqual(sandyUnit!.memberIds, ["sandy", "andrea"]);
  // ...and Riley still hangs off it via Sandy, without Andrea becoming her parent.
  assert.deepEqual(sandyUnit!.childIds, ["riley"]);
  assert.deepEqual(tree.people.andrea.childIds, []);
  assert.deepEqual(tree.people.riley.parentIds.sort(), ["kirsten", "sandy"]);
  // The former partner is surfaced separately, not merged into the couple.
  assert.deepEqual(sandyUnit!.formerPartnerIds, ["kirsten"]);
});

test("generations put married-in partners on their partner's band", () => {
  const tree = buildFamilyTree(graph(), { includePrivateDetail: true });
  assert.equal(tree.people.sandy.generation, 0);
  assert.equal(tree.people.andrea.generation, 0);
  assert.equal(tree.people.mary.generation, 1);
  assert.equal(tree.people.rama.generation, 1);
  assert.equal(tree.people.kid.generation, 2);
  assert.equal(tree.generationCount, 3);
});

test("public view withholds contact detail and minors' surnames", () => {
  const tree = buildFamilyTree(graph(), { includePrivateDetail: false });
  assert.equal(tree.people.kid.surname, null);
  assert.equal(tree.people.kid.fullName, "kid");
  assert.equal(tree.people.kid.initials, "K");
  assert.equal(tree.people.sandy.email, undefined);
  assert.equal(tree.people.sandy.phone, undefined);
  assert.equal(tree.people.sandy.birthday, undefined);
  // Adults keep their surname; only minors are reduced.
  assert.equal(tree.people.mary.surname, "Craig");
});

test("signed-in view restores contact detail", () => {
  const tree = buildFamilyTree(graph(), { includePrivateDetail: true });
  assert.equal(tree.people.sandy.email, "sandy@example.com");
  assert.equal(tree.people.kid.surname, "Craig");
});

test("minors and former spouses cannot claim a profile", () => {
  const tree = buildFamilyTree(graph(), { includePrivateDetail: true });
  assert.equal(tree.people.kid.canClaim, false);
  assert.equal(tree.people.kirsten.canClaim, false);
  assert.equal(tree.people.mary.canClaim, true);
});

test("every person lands in exactly one unit", () => {
  const tree = buildFamilyTree(graph(), { includePrivateDetail: true });
  const placed = tree.units.flatMap((unit) => unit.memberIds);
  assert.equal(placed.length, new Set(placed).size, "a person was placed twice");
  assert.equal(placed.length, Object.keys(tree.people).length);
});

/**
 * Adding a generation above the branch split must not require touching the branch
 * model: the brothers keep isBranchRoot even though they now have parents, and the
 * forebears derive to no branch at all.
 */
function graphWithForebears(): FamilyGraph {
  const base = graph();
  return {
    members: [
      ...base.members,
      member("bill", { deceased: true, canClaim: false, sortOrder: 1 }),
      member("lois", { maidenName: "Bestor", deceased: true, canClaim: false, sortOrder: 2 }),
    ],
    relationships: [
      ...base.relationships,
      spouse("bill", "lois", "former"), // divorced
      parent("bill", "sandy"),
      parent("lois", "sandy"),
      parent("bill", "greg"),
      parent("lois", "greg"),
    ],
  };
}

test("forebears sit above the branch split and derive to no branch", () => {
  const branches = deriveBranches(graphWithForebears());
  assert.equal(branches.get("bill"), null);
  assert.equal(branches.get("lois"), null);
  // Their sons still anchor their own branches.
  assert.equal(branches.get("sandy"), "Sandy's family");
  assert.equal(branches.get("greg"), "Greg's family");
  assert.equal(branches.get("rama"), "Greg's family");
});

test("adding a generation above pushes everyone down one band", () => {
  const tree = buildFamilyTree(graphWithForebears(), { includePrivateDetail: true });
  assert.equal(tree.people.bill.generation, 0);
  assert.equal(tree.people.sandy.generation, 1);
  assert.equal(tree.people.andrea.generation, 1);
  assert.equal(tree.people.mary.generation, 2);
  assert.equal(tree.people.kid.generation, 3);
  assert.equal(tree.generationCount, 4);
});

test("a divorced forebear couple is not listed twice", () => {
  const tree = buildFamilyTree(graphWithForebears(), { includePrivateDetail: true });
  // Bill has no current spouse, so Lois would otherwise anchor a redundant unit
  // alongside appearing as his former partner.
  assert.equal(tree.ancestorUnitIds.length, 1);
  const forebearUnit = tree.units.find((unit) => unit.id === tree.ancestorUnitIds[0]);
  assert.deepEqual(forebearUnit!.memberIds, ["bill"]);
  assert.deepEqual(forebearUnit!.formerPartnerIds, ["lois"]);
  assert.deepEqual(forebearUnit!.childIds.sort(), ["greg", "sandy"]);
});

test("the deceased cannot claim a profile", () => {
  const tree = buildFamilyTree(graphWithForebears(), { includePrivateDetail: true });
  assert.equal(tree.people.bill.canClaim, false);
  assert.equal(tree.people.lois.canClaim, false);
});

test("a parent cycle does not hang generation resolution", () => {
  const cyclic: FamilyGraph = {
    members: [member("a"), member("b")],
    relationships: [parent("a", "b"), parent("b", "a")],
  };
  const tree = buildFamilyTree(cyclic, { includePrivateDetail: true });
  assert.equal(Object.keys(tree.people).length, 2);
});
