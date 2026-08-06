import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_BRANCH_DEGREES,
  ancestorPath,
  branchSpans,
  buildAscentPlate,
  buildDescentPlate,
  defaultPlateRoot,
  layoutPlate,
  leafCount,
  onSameLine,
  partnersFor,
  plateCandidates,
} from "./family-plate";
import type { FamilyTree, TreePerson } from "./family-tree";

function person(id: string, overrides: Partial<TreePerson> = {}): TreePerson {
  return {
    id,
    displayName: id,
    fullName: id,
    surname: null,
    maidenName: null,
    initials: id.slice(0, 1).toUpperCase(),
    photoUrl: null,
    branch: null,
    lineage: "affine",
    generation: 0,
    isMinor: false,
    canClaim: true,
    isClaimed: false,
    deceased: false,
    isFounder: false,
    isCurator: false,
    isBoardMember: false,
    boardRole: null,
    needsReview: null,
    parentIds: [],
    childIds: [],
    currentSpouseIds: [],
    formerSpouseIds: [],
    ...overrides,
  };
}

/**
 * Mirrors the shape that actually stresses the plate: a founder couple who later
 * divorced, a remarriage with no descendants, and a son whose child belongs to an
 * earlier marriage than his current one.
 */
function tree(): FamilyTree {
  const people: Record<string, TreePerson> = {
    bill: person("bill", {
      isFounder: true, deceased: true, generation: 0,
      childIds: ["tom", "sandy"], currentSpouseIds: ["lorenza"], formerSpouseIds: ["lois"],
    }),
    lois: person("lois", {
      isFounder: true, deceased: true, generation: 0,
      childIds: ["tom", "sandy"], formerSpouseIds: ["bill"],
    }),
    lorenza: person("lorenza", { generation: 0, currentSpouseIds: ["bill"] }),
    tom: person("tom", {
      generation: 1, parentIds: ["bill", "lois"],
      childIds: ["jeremy"], currentSpouseIds: ["judy"],
    }),
    judy: person("judy", { generation: 1, childIds: ["jeremy"], currentSpouseIds: ["tom"] }),
    sandy: person("sandy", {
      generation: 1, parentIds: ["bill", "lois"],
      childIds: ["riley"], currentSpouseIds: ["andrea"], formerSpouseIds: ["kirsten"],
    }),
    andrea: person("andrea", { generation: 1, currentSpouseIds: ["sandy"] }),
    kirsten: person("kirsten", { generation: 1, childIds: ["riley"], formerSpouseIds: ["sandy"] }),
    riley: person("riley", { generation: 2, parentIds: ["sandy", "kirsten"] }),
    jeremy: person("jeremy", {
      generation: 2, parentIds: ["tom", "judy"],
      childIds: ["jack", "sam"], currentSpouseIds: ["colleen"],
    }),
    colleen: person("colleen", { generation: 2, childIds: ["jack", "sam"], currentSpouseIds: ["jeremy"] }),
    jack: person("jack", { generation: 3, parentIds: ["jeremy", "colleen"] }),
    sam: person("sam", { generation: 3, parentIds: ["jeremy", "colleen"] }),
  };
  return { people, units: [], branches: [], ancestorUnitIds: [], generationCount: 4 };
}

test("the partner shown is the co-parent, not merely the current spouse", () => {
  const t = tree();
  // Bill's current wife is Lorenza, but the plate below him is Lois's children.
  assert.deepEqual(partnersFor(t, "bill"), [
    { id: "lois", coParent: true },
    { id: "lorenza", coParent: false },
  ]);
  // Same rule puts Riley's mother beside Sandy rather than his current wife.
  assert.deepEqual(partnersFor(t, "sandy"), [
    { id: "kirsten", coParent: true },
    { id: "andrea", coParent: false },
  ]);
});

test("a spouse with no children together is never marked co-parent", () => {
  const t = tree();
  const lorenza = partnersFor(t, "bill").find((p) => p.id === "lorenza");
  assert.equal(lorenza?.coParent, false);
});

test("descent nests children inside their own parent", () => {
  const t = tree();
  const root = buildDescentPlate(t, "bill");
  assert.deepEqual(root.children.map((c) => c.id), ["tom", "sandy"]);
  const tom = root.children[0];
  assert.deepEqual(tom.children.map((c) => c.id), ["jeremy"]);
  assert.deepEqual(tom.children[0].children.map((c) => c.id), ["jack", "sam"]);
});

test("the plate can be re-rooted on anyone with descendants", () => {
  const t = tree();
  const fromTom = layoutPlate(t, "tom");
  assert.equal(fromTom.root.id, "tom");
  assert.equal(fromTom.headcount, 6); // tom, judy, jeremy, colleen, jack, sam
  assert.equal(fromTom.ringCount, 2);

  // bill, lois, lorenza, tom, judy, sandy, kirsten, andrea, jeremy, colleen,
  // jack, sam, riley — later spouses are on the plate too, just not as parents.
  const fromBill = layoutPlate(t, "bill");
  assert.equal(fromBill.headcount, 13);
  assert.equal(fromBill.ringCount, 3);
});

test("founder is a flag, not a consequence of being centred", () => {
  const t = tree();
  // Re-rooting on Tom does not make him a founder, and does not unmake Bill.
  assert.equal(t.people.tom.isFounder, false);
  assert.equal(t.people.bill.isFounder, true);
  assert.equal(defaultPlateRoot(t), "bill");
  assert.equal(plateCandidates(t)[0].label, "bill (founder)");
});

test("a thin branch is widened to the floor and the surplus comes off the wide one", () => {
  const t = tree();
  const layout = layoutPlate(t, "bill");
  const [tomSpan, sandySpan] = layout.branchSpans;
  // Tom's line has more descendants, so it stays the wider of the two...
  assert.ok(tomSpan > sandySpan, "expected Tom's branch to be wider");
  // ...but Sandy's is never squeezed below the floor.
  assert.ok(sandySpan >= MIN_BRANCH_DEGREES, `sandy span ${sandySpan} below floor`);
  assert.ok(Math.abs(tomSpan + sandySpan - 360) < 0.001, "spans must fill the circle");
});

test("the floor never exceeds an equal share", () => {
  // Eight branches cannot all have 52°; the floor has to yield.
  const many = Array.from({ length: 8 }, () => ({ id: "x", partners: [], children: [] }));
  const spans = branchSpans(many);
  assert.equal(spans.length, 8);
  assert.ok(Math.abs(spans.reduce((a, b) => a + b, 0) - 360) < 0.001);
  spans.forEach((s) => assert.ok(s > 0));
});

test("lineage is prefix matching in both directions", () => {
  assert.ok(onSameLine("0.1.0", "0.1"), "a child is on its parent's line");
  assert.ok(onSameLine("0.1", "0.1.0"), "a parent is on its child's line");
  assert.ok(onSameLine("0.1", "0.1"));
  assert.ok(!onSameLine("0.1", "0.2"), "siblings are not on one line");
  assert.ok(!onSameLine("0.10", "0.1"), "prefix match must respect the separator");
});

test("slot paths address the nesting", () => {
  const t = tree();
  const layout = layoutPlate(t, "bill");
  const byId = new Map(layout.slots.map((s) => [s.node.id, s]));
  assert.equal(byId.get("tom")!.path, "0");
  assert.equal(byId.get("jeremy")!.path, "0.0");
  assert.equal(byId.get("jack")!.path, "0.0.0");
  assert.equal(byId.get("sandy")!.path, "1");
  // Grandchildren sit inside their own parent's arc.
  const jeremy = byId.get("jeremy")!;
  const jack = byId.get("jack")!;
  assert.ok(jack.midAngle > jeremy.startAngle && jack.midAngle < jeremy.endAngle);
});

test("leaf weighting counts terminal descendants", () => {
  const t = tree();
  const root = buildDescentPlate(t, "bill");
  assert.equal(leafCount(root), 3); // jack, sam, riley
});

test("depth limiting trims the outer rings and flags what was hidden", () => {
  const t = tree();
  const shallow = layoutPlate(t, "bill", { maxDepth: 2 });
  assert.equal(shallow.ringCount, 2);

  const ids = shallow.slots.map((s) => s.node.id);
  assert.ok(ids.includes("jeremy"), "second ring still drawn");
  assert.ok(!ids.includes("jack"), "third ring dropped");

  const jeremy = shallow.slots.find((s) => s.node.id === "jeremy")!;
  assert.equal(jeremy.node.truncatedChildren, 2, "hidden children are counted");

  // Re-centring reaches what depth limiting hid.
  const deeper = layoutPlate(t, "jeremy", { maxDepth: 2 });
  assert.ok(deeper.slots.map((s) => s.node.id).includes("jack"));
});

test("today's descent plate has zero doorways", () => {
  const layout = layoutPlate(tree(), "bill", { maxDepth: 2 });
  assert.deepEqual(layout.doorwayIds, []);
});

test("a doorway stays distinct from depth truncation", () => {
  const t = tree();
  t.people.colleen = {
    ...t.people.colleen,
    parentIds: ["outside-parent-a", "outside-parent-b"],
  };
  t.people["outside-parent-a"] = person("outside-parent-a", {
    childIds: ["colleen"],
  });
  t.people["outside-parent-b"] = person("outside-parent-b", {
    childIds: ["colleen"],
  });

  const layout = layoutPlate(t, "bill", { maxDepth: 2 });
  assert.deepEqual(layout.doorwayIds, ["colleen"]);
  assert.equal(
    layout.slots.find((slot) => slot.node.id === "jeremy")?.node.truncatedChildren,
    2
  );
});

test("ascent gives both parents equal first-ring standing and then stops", () => {
  const t = tree();
  const ascent = buildAscentPlate(t, "jeremy");
  assert.deepEqual(ascent.children.map((parentNode) => parentNode.id), ["tom", "judy"]);
  assert.deepEqual(ascent.children[0].children.map((parentNode) => parentNode.id), ["bill", "lois"]);
  assert.ok(ascent.children.every((parentNode) => parentNode.partners.length === 0));

  const layout = layoutPlate(t, "jeremy", { direction: "ascent", maxDepth: 1 });
  assert.deepEqual(layout.slots.map((slot) => slot.node.id), ["tom", "judy"]);
  assert.deepEqual(layout.branchSpans, [180, 180]);
  assert.equal(layout.slots[0].node.truncatedChildren, 2);
  assert.deepEqual(layout.doorwayIds, ["jeremy"]);
});

test("either plate direction can start from a family without a branch-root flag", () => {
  const t = tree();
  t.people["outside-parent"] = person("outside-parent", { childIds: ["outside-child"] });
  t.people["outside-child"] = person("outside-child", { parentIds: ["outside-parent"] });

  assert.deepEqual(
    layoutPlate(t, "outside-parent").slots.map((slot) => slot.node.id),
    ["outside-child"]
  );
  assert.deepEqual(
    layoutPlate(t, "outside-child", { direction: "ascent" }).slots.map((slot) => slot.node.id),
    ["outside-parent"]
  );
});

test("the ancestor path reads oldest first and is the plate's way back up", () => {
  const t = tree();
  assert.deepEqual(ancestorPath(t, "jack"), ["bill", "tom", "jeremy", "jack"]);
  assert.deepEqual(ancestorPath(t, "riley"), ["bill", "sandy", "riley"]);
  // A founder sits at the top of their own path with nothing above them.
  assert.deepEqual(ancestorPath(t, "bill"), ["bill"]);
});

test("the ancestor path follows blood, not whichever parent sorts first", () => {
  // Birth order puts the married-in parent first — Judy's sortOrder beats Tom's —
  // so a naive parentIds[0] walk dead-ends on her instead of reaching the founders.
  const t = tree();
  t.people.jeremy = { ...t.people.jeremy, parentIds: ["judy", "tom"] };
  t.people.riley = { ...t.people.riley, parentIds: ["kirsten", "sandy"] };

  assert.deepEqual(ancestorPath(t, "jeremy"), ["bill", "tom", "jeremy"]);
  assert.deepEqual(ancestorPath(t, "riley"), ["bill", "sandy", "riley"]);
});

test("with no blood signal the path prefers a founder", () => {
  const t = tree();
  // Neither of Tom's parents has parents; Bill and Lois are both founders, so the
  // first founder wins rather than an arbitrary pick.
  t.people.tom = { ...t.people.tom, parentIds: ["lois", "bill"] };
  assert.equal(ancestorPath(t, "tom")[0], "lois");
});

test("the ancestor path survives a parent cycle", () => {
  const people: Record<string, TreePerson> = {
    a: person("a", { parentIds: ["b"] }),
    b: person("b", { parentIds: ["a"] }),
  };
  const cyclic: FamilyTree = {
    people, units: [], branches: [], ancestorUnitIds: [], generationCount: 1,
  };
  assert.deepEqual(ancestorPath(cyclic, "a"), ["b", "a"]);
});

test("a cycle in the data does not hang the layout", () => {
  const people: Record<string, TreePerson> = {
    a: person("a", { childIds: ["b"] }),
    b: person("b", { childIds: ["a"] }),
  };
  const cyclic: FamilyTree = {
    people, units: [], branches: [], ancestorUnitIds: [], generationCount: 1,
  };
  const layout = layoutPlate(cyclic, "a");
  assert.ok(layout.slots.length > 0);
});
