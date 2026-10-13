import assert from "node:assert/strict";
import test from "node:test";
import { expenseInputSchema, expensePatchSchema, summarizeExpenseLedger } from "./expense-ledger";

test("ledger reconciles cents and recorded payers without inventing shareholder debts", () => {
  const totals = summarizeExpenseLedger([
    { amount: 0.1, category: "supplies", type: "operating", paidBy: "Jim Craig" },
    { amount: 0.2, category: "supplies", type: "operating", paidBy: "Shared" },
    { amount: 10, category: "maintenance", type: "capital", paidBy: "__proto__" },
  ]);
  assert.equal(totals.total, 10.3); assert.equal(totals.byCategory.supplies, 0.3);
  assert.equal(totals.byPayer["Jim Craig"], 0.1); assert.equal(totals.byPayer.Shared, 0.2); assert.equal(totals.byPayer["__proto__"], 10);
  assert.equal(Object.values(totals.byPayer).reduce((sum, amount) => sum + Math.round(amount * 100), 0), Math.round(totals.total * 100));
  assert.equal("familyBalances" in totals, false); assert.equal("perFamilyShare" in totals, false);
  const saved = expenseInputSchema.parse({ date: "2026-01-01", amount: "0", description: "No charge" });
  assert.equal(saved.date.getUTCFullYear(), 2026); assert.equal(saved.amount, 0);
  assert.equal(expensePatchSchema.safeParse({ fiscalYear: 1900, amount: -1 }).success, false);
});
