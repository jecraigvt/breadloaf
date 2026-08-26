import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMaintenanceDate,
  isMaintenanceOverdue,
  toMaintenanceInputDate,
} from "./maintenance-dates";

test("maintenance dates retain their calendar day", () => {
  assert.equal(formatMaintenanceDate("2026-08-06T00:00:00.000Z"), "Aug 6, 2026");
  assert.equal(toMaintenanceInputDate("2026-08-06T00:00:00.000Z"), "2026-08-06");
});

test("a maintenance item becomes overdue only after its due day", () => {
  const dueAt = "2026-08-06T00:00:00.000Z";
  assert.equal(isMaintenanceOverdue(dueAt, "2026-08-06"), false);
  assert.equal(isMaintenanceOverdue(dueAt, "2026-08-07"), true);
  assert.equal(isMaintenanceOverdue(null, "2026-08-07"), false);
});
