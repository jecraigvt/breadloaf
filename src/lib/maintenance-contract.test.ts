import assert from "node:assert/strict";
import test from "node:test";
import { maintenanceInputSchema, maintenancePatchSchema, normalizeMaintenanceCategory, parseMaintenanceDate, propertyTodayDateKey } from "./maintenance-contract";

test("maintenance categories and dates preserve actual work history without date guessing", () => {
  assert.equal(normalizeMaintenanceCategory("hvac"), "HVAC");
  assert.equal(normalizeMaintenanceCategory("pest-control"), "Pest Control");
  const input = { title: "Tank pumped", category: "septic", performedAt: "2024-11-20", cost: "0" };
  const saved = maintenanceInputSchema.parse(input);
  assert.equal(saved.category, "Septic"); assert.equal(saved.cost, 0); assert.equal(saved.performedAt.toISOString(), "2024-11-20T00:00:00.000Z");
  assert.equal(maintenanceInputSchema.safeParse({ title: "Historical work" }).success, false);
  for (const date of ["2026-02-30", "2026-13-01", "yesterday", "2026-02-01T00:00:00Z"]) assert.throws(() => parseMaintenanceDate(date));
  for (const cost of ["12garbage", -1, Infinity, 1.234]) assert.equal(maintenancePatchSchema.safeParse({ cost }).success, false);
  assert.equal(propertyTodayDateKey(new Date("2026-01-01T02:00:00Z")), "2025-12-31");
});
