import { z } from "zod";
import { calendarDateSchema, nonnegativeMoneySchema } from "./maintenance-contract";

const fields = {
  date: calendarDateSchema, amount: nonnegativeMoneySchema,
  description: z.string().trim().min(1).max(500), category: z.string().trim().min(1).max(100),
  type: z.enum(["operating", "capital"]), paidBy: z.string().trim().min(1).max(100),
  vendor: z.string().trim().max(200).nullable().optional(), documentId: z.string().max(100).nullable().optional(), notes: z.string().trim().max(10000).nullable().optional(),
};
export const expenseInputSchema = z.object({ ...fields, category: fields.category.default("other"), type: fields.type.default("operating"), paidBy: fields.paidBy.default("Shared") }).strict();
export const expensePatchSchema = z.object(fields).partial().strict();

/** Recorded spending totals in integer cents. Reimbursement policy is not inferred. */
export function summarizeExpenseLedger(expenses: Array<{ amount: number; category: string; type: string; paidBy: string }>) {
  const byCategory: Record<string, number> = Object.create(null);
  const byType: Record<string, number> = Object.assign(Object.create(null), { operating: 0, capital: 0 });
  const byPayer: Record<string, number> = Object.create(null);
  let totalCents = 0;
  for (const expense of expenses) {
    const cents = Math.round(expense.amount * 100); totalCents += cents;
    byCategory[expense.category] = (byCategory[expense.category] || 0) + cents;
    byType[expense.type] = (byType[expense.type] || 0) + cents;
    byPayer[expense.paidBy] = (byPayer[expense.paidBy] || 0) + cents;
  }
  const dollars = (values: Record<string, number>) => Object.fromEntries(Object.entries(values).map(([key, cents]) => [key, cents / 100]));
  return { total: totalCents / 100, expenseCount: expenses.length, byCategory: dollars(byCategory), byType: dollars(byType), byPayer: dollars(byPayer) };
}
