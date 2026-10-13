import { z } from "zod";

export const MAINTENANCE_CATEGORIES = ["Septic", "Plumbing", "Electrical", "Roofing", "HVAC", "Grounds", "Pest Control", "Appliances", "General"] as const;
export function normalizeMaintenanceCategory(value: unknown): typeof MAINTENANCE_CATEGORIES[number] {
  const key = typeof value === "string" ? value.trim().toLowerCase().replace(/[_-]+/g, " ") : "general";
  return MAINTENANCE_CATEGORIES.find(category => category.toLowerCase() === key) || "General";
}
export function parseMaintenanceDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Use a calendar date in YYYY-MM-DD format.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid calendar date.");
  return date;
}
export function propertyTodayDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export const calendarDateSchema = z.string().refine(value => { try { parseMaintenanceDate(value); return true; } catch { return false; } }, "Use a valid YYYY-MM-DD calendar date.").transform(parseMaintenanceDate);
const nullableText = z.string().trim().max(10000).nullable().optional();
export const nonnegativeMoneySchema = z.union([z.number(), z.string().regex(/^\d+(?:\.\d{1,2})?$/)]).transform(Number).pipe(z.number().finite().min(0).max(100000000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, "Use cents, with at most two decimal places."));
const fields = {
  title: z.string().trim().min(1).max(200), description: nullableText,
  category: z.string().max(100).transform(normalizeMaintenanceCategory), performedBy: z.string().trim().max(100).nullable().optional(),
  performedAt: calendarDateSchema, nextDueAt: calendarDateSchema.nullable().optional(),
  cost: nonnegativeMoneySchema.nullable().optional(), assetId: z.string().max(100).nullable().optional(),
};
export const maintenanceInputSchema = z.object({ ...fields, category: fields.category.optional().transform(normalizeMaintenanceCategory) }).strict();
export const maintenancePatchSchema = z.object(fields).partial().strict();
