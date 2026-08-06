import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHistoricalPhotoQuestionProposal,
  buildHistoricalPhotoRoster,
  formatHistoricalPhotoRoster,
} from "./historical-photo";
import type { FamilyGraph, GraphMember } from "./family-tree";

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
    branch: "Tom's family",
    boardRole: null,
    isBoardMember: false,
    notes: null,
    photoUrl: null,
    isBranchRoot: false,
    isFounder: false,
    sortOrder: 1,
    isMinor: false,
    canClaim: true,
    deceased: false,
    needsReview: null,
    isCurator: false,
    claimedAt: null,
    ...overrides,
  };
}

test("the photo roster uses the family tree's minor redaction", () => {
  const graph: FamilyGraph = {
    members: [
      member("bill", { displayName: "Bill", name: "William Craig", deceased: true }),
      member("ellie", { displayName: "Ellie", name: "Eleanor Craig", isMinor: true }),
    ],
    relationships: [],
  };
  const roster = buildHistoricalPhotoRoster(graph);
  const prompt = formatHistoricalPhotoRoster(roster);

  assert.match(prompt, /bill \| Bill Craig \| full name: William Craig/);
  assert.match(prompt, /ellie \| Ellie \| full name: Ellie/);
  assert.doesNotMatch(prompt, /Eleanor Craig/);
  assert.doesNotMatch(prompt, /Ellie Craig/);
});

test("a validated roster proposal becomes a specific tap question", () => {
  const roster = buildHistoricalPhotoRoster({
    members: [
      member("bill", { displayName: "Bill" }),
      member("lois", { displayName: "Lois", sortOrder: 2 }),
    ],
    relationships: [],
  });
  const proposal = buildHistoricalPhotoQuestionProposal(
    {
      intakeType: "historical_photo",
      historicalPhotoCandidateIds: ["bill", "lois", "invented"],
      historicalPhotoSetting: "the Ripton porch",
      historicalPhotoEra: "early 1960s",
    },
    roster
  );

  assert.equal(
    proposal?.question,
    "Is this Bill Craig and Lois Craig at the Ripton porch, early 1960s?"
  );
  assert.deepEqual(proposal?.options, [
    "Yes — Bill Craig and Lois Craig",
    "Only Bill Craig",
    "Only Lois Craig",
    "Someone else",
    "Not sure",
  ]);
  assert.doesNotMatch(proposal?.question || "", /invented/);
});

test("no generic question is created when the model proposes nobody valid", () => {
  assert.equal(
    buildHistoricalPhotoQuestionProposal(
      { intakeType: "historical_photo", historicalPhotoCandidateIds: [] },
      []
    ),
    null
  );
});
