import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

// Guardrails for the evolving document categorization scheme.
// The AI may propose new categories; this module decides whether a
// proposal is genuinely new (create it), a near-duplicate of an
// existing category (map to it), or too uncertain (Needs Review).

const MAX_CATEGORIES = 30;
const MIN_CONFIDENCE_TO_FILE = 0.45; // below this → Needs Review
const MIN_CONFIDENCE_TO_CREATE = 0.6; // below this → never create a category
const SIMILARITY_THRESHOLD = 0.72; // bigram Dice score treated as "same category"

const NEW_CATEGORY_COLORS = [
  "blue", "green", "orange", "purple", "teal", "rose", "amber", "cyan",
];

export function slugifyCategory(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Sørensen–Dice similarity over character bigrams — cheap, no deps,
// good at catching "Tax Documents" vs "Tax Records" style duplicates.
function bigrams(s: string): Map<string, number> {
  const t = s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
  const grams = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  return grams;
}

// "Insurance" vs "Insurance Policies", "Meeting Minutes" vs "Board Meeting
// Minutes" — one name's words contained in the other's means same category.
export function isTokenSubset(a: string, b: string): boolean {
  const tokens = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
      .filter((t) => t.length > 1 && t !== "and" && t !== "the" && t !== "of");
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return small.every((t) => large.includes(t));
}

export function categorySimilarity(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let overlap = 0, totalA = 0, totalB = 0;
  ga.forEach((n) => { totalA += n; });
  gb.forEach((n) => { totalB += n; });
  ga.forEach((n, g) => {
    const m = gb.get(g);
    if (m) overlap += Math.min(n, m);
  });
  return (2 * overlap) / (totalA + totalB);
}

export interface CategoryResolution {
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  categoryCreated: boolean;
  needsReview: boolean;
}

interface ResolveInput {
  suggestedCategory?: string | null;
  newCategoryProposal?: { name: string; description?: string | null } | null;
  confidence?: number | null;
}

// Resolve an AI categorization result to a real Category row.
// Order: exact match → fuzzy match → create from proposal (guarded) → Needs Review.
export async function resolveDocumentCategory(
  input: ResolveInput,
  database: Pick<Prisma.TransactionClient, "category"> = prisma
): Promise<CategoryResolution> {
  const confidence = input.confidence ?? 0;
  const categories = await database.category.findMany({
    select: { id: true, name: true, slug: true },
  });

  const matchExisting = (raw: string | null | undefined) => {
    if (!raw?.trim()) return null;
    const name = raw.trim();
    const slug = slugifyCategory(name);
    const exact = categories.find(
      (c) => c.name.toLowerCase() === name.toLowerCase() || c.slug === slug
    );
    if (exact) return exact;
    const subset = categories.find((c) => isTokenSubset(c.name, name));
    if (subset) return subset;
    let best: { cat: (typeof categories)[number]; score: number } | null = null;
    for (const c of categories) {
      const score = categorySimilarity(c.name, name);
      if (score >= SIMILARITY_THRESHOLD && (!best || score > best.score)) {
        best = { cat: c, score };
      }
    }
    return best?.cat ?? null;
  };

  const asResolution = (
    cat: { id: string; name: string; slug: string } | null,
    created = false
  ): CategoryResolution => ({
    categoryId: cat?.id ?? null,
    categoryName: cat?.name ?? null,
    categorySlug: cat?.slug ?? null,
    categoryCreated: created,
    needsReview: !cat,
  });

  // Too uncertain to file anywhere — surface in Needs Review.
  if (confidence < MIN_CONFIDENCE_TO_FILE) return asResolution(null);

  const matched =
    matchExisting(input.suggestedCategory) ??
    matchExisting(input.newCategoryProposal?.name);
  if (matched) return asResolution(matched);

  // Nothing matched — consider creating the proposed category.
  const proposal = input.newCategoryProposal;
  if (
    proposal?.name?.trim() &&
    confidence >= MIN_CONFIDENCE_TO_CREATE &&
    categories.length < MAX_CATEGORIES
  ) {
    const name = proposal.name.trim();
    const slug = slugifyCategory(name);
    if (slug) {
      try {
        const created = await database.category.create({
          data: {
            name,
            slug,
            description: proposal.description?.trim() || null,
            icon: "Folder",
            color: NEW_CATEGORY_COLORS[categories.length % NEW_CATEGORY_COLORS.length],
          },
          select: { id: true, name: true, slug: true },
        });
        return asResolution(created, true);
      } catch {
        // Unique collision (concurrent create) — re-match instead.
        const again = await database.category.findFirst({
          where: { OR: [{ slug }, { name }] },
          select: { id: true, name: true, slug: true },
        });
        if (again) return asResolution(again);
      }
    }
  }

  return asResolution(null);
}
