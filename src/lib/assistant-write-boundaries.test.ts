import assert from "node:assert/strict";
import test from "node:test";
import { executeToolFunction } from "./ai";
import { prisma } from "./prisma";

test("assistant refuses retired inventory, unverified positions, fabricated dates and invalid money", async () => {
  const actor = { memberId: "synthetic", displayName: "Caretaker", fullName: "Synthetic Caretaker", branch: null, boardRole: null, isCurator: true, isBoardMember: true, verified: false };
  assert.equal((await executeToolFunction("add_pantry_item", { name: "Coffee", quantity: 5 })).success, false);
  assert.equal((await executeToolFunction("update_position", { personName: "Anyone", position: "President" }, undefined, { actor })).success, false);
  assert.equal((await executeToolFunction("add_maintenance_record", { title: "Historical roof work" })).success, false);
  assert.equal((await executeToolFunction("add_maintenance_record", { title: "Roof work", performedAt: "2026-02-30", cost: 300 })).success, false);
  for (const amount of [-1, NaN, Infinity, 12.345]) {
    assert.equal((await executeToolFunction("add_expense", { date: "2026-10-13", amount, description: "A bill", paidBy: "Tom" })).success, false);
  }
  assert.equal((await executeToolFunction("add_expense", { date: "2026-10-13", amount: 12, description: "A bill" })).success, false);
  assert.equal((await executeToolFunction("create_stay", { guestName: "Family", checkIn: "2026-02-30", checkOut: "2026-03-04" })).success, false);
});

test("assistant filing cannot obtain or change a private document through its ID", async () => {
  const previous = prisma.document.findFirst;
  try {
    (prisma.document as unknown as { findFirst: unknown }).findFirst = async (input: { where: { accessScope: string } }) => {
      assert.equal(input.where.accessScope, "family");
      return null;
    };
    const result = await executeToolFunction("set_document_category", { documentId: "private-synthetic", categoryName: "Bank Statements" });
    assert.equal(result.success, false);
  } finally { prisma.document.findFirst = previous; }
});
