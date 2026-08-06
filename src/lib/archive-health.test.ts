import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveVerificationStalenessMessage,
  formatArchiveHealthForBucky,
  LATEST_ARCHIVE_VERIFICATION,
  type ArchiveHealth,
} from "./archive-health";

test("latest archive verification records the reviewed phase 3 result", () => {
  assert.deepEqual(LATEST_ARCHIVE_VERIFICATION.roundTrip, {
    passed: 47,
    total: 50,
    rate: 94,
  });
  assert.deepEqual(LATEST_ARCHIVE_VERIFICATION.golden, {
    passed: 22,
    total: 25,
    rate: 88,
  });
  assert.deepEqual(LATEST_ARCHIVE_VERIFICATION.negativeControls, {
    passed: 4,
    total: 4,
  });
});

test("Bucky receives live analysis counts and the measured retrieval rates", () => {
  const health: ArchiveHealth = {
    totalDocuments: 48,
    readyDocuments: 46,
    issueDocuments: 2,
    documentsAddedAfterMeasurement: 3,
    analysisStates: { ok: 46, provider_error: 2 },
    verification: LATEST_ARCHIVE_VERIFICATION,
  };

  const context = formatArchiveHealthForBucky(health);
  assert.match(context, /46 of 48 active documents/);
  assert.match(context, /provider_error 2/);
  assert.match(context, /Round-trip retrieval: 94\.0% \(47\/50\)/);
  assert.match(context, /Golden questions: 88\.0% \(22\/25\)/);
  assert.match(context, /Negative controls: 4\/4/);
  assert.match(context, /STALE VERIFICATION: Measured before 3 documents were added\./);
});

test("verification staleness is silent when current and grammatical when stale", () => {
  assert.equal(archiveVerificationStalenessMessage(0), null);
  assert.equal(
    archiveVerificationStalenessMessage(1),
    "Measured before 1 document was added."
  );
  assert.equal(
    archiveVerificationStalenessMessage(2),
    "Measured before 2 documents were added."
  );
});
