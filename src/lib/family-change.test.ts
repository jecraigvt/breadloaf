import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFamilyTree,
  deriveLineageClasses,
  type FamilyGraph,
  type GraphMember,
  type GraphRelationship,
} from "./family-tree";
import { layoutPlate } from "./family-plate";
import { FamilyChangeValidationError, planFamilyChange } from "./family-change";
import type { FamilyChangeSet } from "./family-change-contract";

function member(id: string, overrides: Partial<GraphMember> = {}): GraphMember {
  return {
    id,
    name: `${id} Craig`,
    displayName: id,
    surname: "Craig",
    maidenName: null,
    email: null,
    phone: null,
    birthday: null,
    branch: null,
    boardRole: null,
    isBoardMember: false,
    notes: null,
    photoUrl: null,
    isBranchRoot: false,
    isFounder: false,
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

const baseGraph: FamilyGraph = {
  members: [
    member("bill", { name: "William Craig", displayName: "Bill", isFounder: true, deceased: true }),
    member("lois", { name: "Lois Bestor Craig", displayName: "Lois", isFounder: true, deceased: true }),
    member("tom", { name: "Thomas Craig", displayName: "Tom", branch: "Tom's family", isBranchRoot: true }),
    member("judy", { name: "Helen Veronica Judith Craig", displayName: "Judy", maidenName: "Norman" }),
    member("jeremy", { name: "Jeremy Craig", displayName: "Jeremy" }),
    member("colleen", { name: "Colleen Craig", displayName: "Colleen", maidenName: "McCabe" }),
  ],
  relationships: [
    { fromMemberId: "bill", toMemberId: "tom", type: "parent", status: "current" },
    { fromMemberId: "lois", toMemberId: "tom", type: "parent", status: "current" },
    { fromMemberId: "tom", toMemberId: "judy", type: "spouse", status: "current" },
    { fromMemberId: "tom", toMemberId: "jeremy", type: "parent", status: "current" },
    { fromMemberId: "judy", toMemberId: "jeremy", type: "parent", status: "current" },
    { fromMemberId: "jeremy", toMemberId: "colleen", type: "spouse", status: "current" },
  ],
};

const mcCabeChangeSet: FamilyChangeSet = {
  version: 1,
  summary: "Add Colleen's McCabe parents, brother, sister-in-law, and niece",
  sourceMemoryIds: ["voice-1", "voice-2"],
  people: [
    { key: "kevin", name: "Kevin McCabe", displayName: "Kevin", surname: "McCabe", possibleMinor: false, deceased: false },
    { key: "cheryl", name: "Cheryl McCabe", displayName: "Cheryl", surname: "McCabe", possibleMinor: false, deceased: false },
    { key: "korey", name: "Korey McCabe", displayName: "Korey", surname: "McCabe", possibleMinor: false, deceased: false },
    { key: "kira", name: "Kira", displayName: "Kira", surname: null, possibleMinor: false, deceased: false },
    { key: "isla", name: "Isla", displayName: "Isla", surname: null, possibleMinor: true, deceased: false },
  ],
  parentEdges: [
    { parent: "kevin", child: "Colleen" },
    { parent: "cheryl", child: "Colleen" },
    { parent: "kevin", child: "korey" },
    { parent: "cheryl", child: "korey" },
    { parent: "korey", child: "isla" },
    { parent: "kira", child: "isla" },
  ],
  spouseEdges: [{ personA: "korey", personB: "kira", status: "current" }],
  corrections: [],
};

function graphAfterPlan(graph: FamilyGraph, plan: ReturnType<typeof planFamilyChange>): FamilyGraph {
  const created = plan.creates.map((create) => member(create.token, {
    name: create.name,
    displayName: create.displayName,
    surname: create.surname,
    maidenName: create.maidenName,
    isMinor: create.isMinor,
    canClaim: !create.isMinor && !create.deceased,
    deceased: create.deceased,
  }));
  const relationships: GraphRelationship[] = [
    ...graph.relationships,
    ...plan.parentEdges.map((edge) => ({
      fromMemberId: edge.fromToken,
      toMemberId: edge.toToken,
      type: "parent",
      status: "current",
    })),
    ...plan.spouseEdges.map((edge) => ({
      fromMemberId: edge.fromToken,
      toMemberId: edge.toToken,
      type: "spouse",
      status: edge.status,
    })),
  ];
  return { members: [...graph.members, ...created], relationships };
}

test("a possible minor blocks the entire family proposal until a human decides", () => {
  assert.throws(
    () => planFamilyChange(baseGraph, mcCabeChangeSet, {}),
    (error) => error instanceof FamilyChangeValidationError && /Isla.*human decision/i.test(error.message)
  );
});

test("the corrected McCabe proposal contains Korey once and no Corey write", () => {
  const plan = planFamilyChange(baseGraph, mcCabeChangeSet, { isla: "minor" });

  assert.deepEqual(plan.creates.map((person) => person.name), [
    "Kevin McCabe",
    "Cheryl McCabe",
    "Korey McCabe",
    "Kira",
    "Isla",
  ]);
  assert.equal(plan.creates.some((person) => /Corey/i.test(person.name)), false);
  assert.equal(plan.creates.find((person) => person.key === "isla")?.isMinor, true);
  assert.deepEqual(plan.matchedPeople, [{ key: "existing:colleen", memberId: "colleen" }]);
  assert.equal(plan.parentEdges.length, 6);
  assert.equal(plan.spouseEdges.length, 1);
});

test("McCabe in-law parents produce a doorway and ascent without becoming Forebears", () => {
  const beforeLineage = deriveLineageClasses(baseGraph);
  const beforeDescendants = Array.from(beforeLineage.values()).filter((value) => value === "descendant").length;
  const beforeAncestors = Array.from(beforeLineage.values()).filter((value) => value === "ancestor").length;
  const plan = planFamilyChange(baseGraph, mcCabeChangeSet, { isla: "minor" });
  const graph = graphAfterPlan(baseGraph, plan);
  const lineage = deriveLineageClasses(graph);
  const tree = buildFamilyTree(graph, { includePrivateDetail: true });

  assert.equal(
    Array.from(lineage.values()).filter((value) => value === "descendant").length,
    beforeDescendants
  );
  assert.equal(
    Array.from(lineage.values()).filter((value) => value === "ancestor").length,
    beforeAncestors
  );
  for (const id of ["new:kevin", "new:cheryl", "new:korey", "new:kira", "new:isla"]) {
    assert.equal(lineage.get(id), "affine");
  }

  const descent = layoutPlate(tree, "bill", { direction: "descent", maxDepth: 3 });
  assert.deepEqual(descent.doorwayIds, ["colleen"]);
  const ascent = layoutPlate(tree, "colleen", { direction: "ascent", maxDepth: 1 });
  assert.deepEqual(new Set(ascent.slots.map((slot) => slot.node.id)), new Set(["new:kevin", "new:cheryl"]));

  const forebearMemberIds = tree.ancestorUnitIds.flatMap(
    (unitId) => tree.units.find((unit) => unit.id === unitId)?.memberIds ?? []
  );
  assert.equal(forebearMemberIds.includes("new:kevin"), false);
  assert.equal(forebearMemberIds.includes("new:cheryl"), false);
  assert.deepEqual(new Set(forebearMemberIds), new Set(["bill", "lois"]));
});

test("an ambiguous existing name aborts before a write plan exists", () => {
  const ambiguousGraph: FamilyGraph = {
    ...baseGraph,
    members: [
      ...baseGraph.members,
      member("sandy", { name: "William Craig", displayName: "Sandy" }),
      member("will", { name: "William Craig", displayName: "Will" }),
    ],
  };
  const correction: FamilyChangeSet = {
    version: 1,
    summary: "Correct William Craig",
    sourceMemoryIds: [],
    people: [],
    parentEdges: [],
    spouseEdges: [],
    corrections: [{ target: "William Craig", changes: { displayName: "William" } }],
  };

  assert.throws(
    () => planFamilyChange(ambiguousGraph, correction, {}),
    (error) => error instanceof FamilyChangeValidationError && /Ambiguous.*nothing was written/i.test(error.message)
  );
});

test("an explicit correction resolves through the shared matcher without creating a person", () => {
  const correction: FamilyChangeSet = {
    version: 1,
    summary: "Correct Colleen's display name",
    sourceMemoryIds: [],
    people: [],
    parentEdges: [],
    spouseEdges: [],
    corrections: [{ target: "Colleen Craig", changes: { displayName: "Colleen" } }],
  };

  const plan = planFamilyChange(baseGraph, correction, {});
  assert.deepEqual(plan.creates, []);
  assert.deepEqual(plan.corrections, [{
    memberId: "colleen",
    target: "Colleen Craig",
    changes: { displayName: "Colleen" },
  }]);
});
