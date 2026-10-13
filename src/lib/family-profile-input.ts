import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const photoUrl = optionalText(1000).refine((value) => {
  if (!value) return true;
  if (/^\/(?:photos|uploads)\/[A-Za-z0-9._/-]+$/.test(value) && !value.includes("..")) return true;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}, "Use a valid photo URL");

// No IDs, nested relations, session tokens, credentials, or Prisma operations.
export const FamilyProfilePatchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  displayName: optionalText(80), surname: optionalText(100), maidenName: optionalText(100),
  email: z.string().trim().email().max(254).nullable().optional().or(z.literal("")),
  phone: optionalText(80), birthday: optionalText(40), branch: optionalText(80),
  relation: optionalText(200), boardRole: optionalText(160), notes: optionalText(10000),
  photoUrl, needsReview: optionalText(2000),
  isBoardMember: z.boolean().optional(), isCurator: z.boolean().optional(),
  isMinor: z.boolean().optional(), canClaim: z.boolean().optional(), deceased: z.boolean().optional(),
  isBranchRoot: z.boolean().optional(), isFounder: z.boolean().optional(), sortOrder: z.number().int().min(0).max(10000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Choose fields to update");

export const FamilyProfileCreateSchema = FamilyProfilePatchSchema.and(z.object({ name: z.string().trim().min(1).max(160) }));
