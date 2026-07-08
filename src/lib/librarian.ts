import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "@/lib/prisma";
import { slugifyCategory } from "@/lib/document-categories";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

// The librarian reviews the whole filing system and proposes a
// reorganization plan. Nothing is applied without explicit approval —
// the plan is validated, shown to the user, then executed verbatim.

export interface LibrarianPlan {
  newCategories: { name: string; description: string; reason: string }[];
  renames: { slug: string; newName: string; newDescription: string; reason: string }[];
  // Merge: refile all docs from `fromSlug` into `intoSlug`, then delete `fromSlug`
  merges: { fromSlug: string; intoSlug: string; reason: string }[];
  // Refile individual misfiled documents (intoName may be a newCategories name)
  refiles: { documentId: string; intoName: string; reason: string }[];
  summary: string;
}

const MAX_OPERATIONS = 40;

export async function generateLibrarianPlan(): Promise<LibrarianPlan> {
  const categories = await prisma.category.findMany({
    include: { _count: { select: { documents: true } } },
    orderBy: { name: "asc" },
  });
  const documents = await prisma.document.findMany({
    select: {
      id: true,
      title: true,
      aiSummary: true,
      category: { select: { name: true, slug: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  const categoryList = categories
    .map(
      (c) =>
        `- ${c.name} (slug: ${c.slug}, ${c._count.documents} docs)${c.description ? ` — ${c.description}` : ""}`
    )
    .join("\n");

  const docList = documents
    .map(
      (d) =>
        `- id:${d.id} | category:${d.category?.name ?? "UNCATEGORIZED"} | ${d.title}${d.aiSummary ? ` — ${d.aiSummary.slice(0, 150)}` : ""}`
    )
    .join("\n");

  const prompt = `You are the librarian for the Breadloaf Hill family property archive (a Vermont property owned by an S-Corp with four Craig brothers as shareholders). Review the filing system and propose a reorganization plan.

CURRENT CATEGORIES:
${categoryList}

ALL DOCUMENTS:
${docList}

Propose ONLY changes that clearly improve the archive:
1. MERGE categories that overlap or duplicate each other (fewer, clearer categories beats many vague ones)
2. RENAME categories whose names are vague or misleading; also use renames to fill in missing/weak descriptions
3. NEW categories only when an existing category has grown two clearly distinct piles of 4+ documents each (propose the new category and refile those docs into it)
4. REFILE documents that are obviously in the wrong category (use the document's title/summary as evidence)

Rules:
- Be conservative: an empty plan is a good plan if the system is already tidy. Do not invent work.
- Never merge or rename these S-Corp categories: Meeting Minutes, Corporate Filings, Financial Statements, K-1 Forms, Bank Statements, Capital Accounts. Refiling documents INTO them is encouraged.
- "Other" is the catch-all; never rename or merge it.
- Do not propose deleting documents. Only categories emptied by a merge get removed.

Return ONLY valid JSON (no markdown fences):
{
  "newCategories": [{"name": "...", "description": "...", "reason": "..."}],
  "renames": [{"slug": "existing-slug", "newName": "...", "newDescription": "...", "reason": "..."}],
  "merges": [{"fromSlug": "...", "intoSlug": "...", "reason": "..."}],
  "refiles": [{"documentId": "...", "intoName": "exact category name (existing, renamed, or from newCategories)", "reason": "..."}],
  "summary": "1-2 sentence plain-English summary of the plan (or say the archive is tidy)"
}`;

  // Pro gives the best reorganization judgment, but quota for it is thin —
  // fall back to Flash rather than failing the whole review.
  let result;
  try {
    const pro = genAI.getGenerativeModel({ model: "gemini-3.1-pro-preview" });
    result = await pro.generateContent(prompt);
  } catch (err) {
    console.warn("[Librarian] Pro model unavailable, falling back to Flash:", String(err).slice(0, 200));
    const flash = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
    result = await flash.generateContent(prompt);
  }

  const text = result.response.text();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const raw = JSON.parse(jsonMatch ? jsonMatch[0] : text);

  return validatePlan(raw, categories, documents);
}

const PROTECTED_SLUGS = new Set([
  "other",
  "meeting-minutes",
  "corporate-filings",
  "financial-statements",
  "k1-forms",
  "bank-statements",
  "capital-accounts",
]);

// Drop anything that references unknown slugs/ids or touches protected
// categories — the plan must be safe to apply verbatim after approval.
function validatePlan(
  raw: Partial<LibrarianPlan>,
  categories: { slug: string; name: string }[],
  documents: { id: string }[]
): LibrarianPlan {
  const slugs = new Set(categories.map((c) => c.slug));
  const docIds = new Set(documents.map((d) => d.id));
  const existingNames = new Set(categories.map((c) => c.name.toLowerCase()));

  const newCategories = (raw.newCategories ?? [])
    .filter(
      (n) =>
        n?.name?.trim() &&
        !existingNames.has(n.name.trim().toLowerCase()) &&
        slugifyCategory(n.name)
    )
    .slice(0, 5);
  const newNames = new Set(newCategories.map((n) => n.name.trim().toLowerCase()));

  const renames = (raw.renames ?? [])
    .filter(
      (r) =>
        r?.slug &&
        slugs.has(r.slug) &&
        !PROTECTED_SLUGS.has(r.slug) &&
        r.newName?.trim()
    )
    .slice(0, 10);

  const merges = (raw.merges ?? [])
    .filter(
      (m) =>
        m?.fromSlug &&
        m?.intoSlug &&
        slugs.has(m.fromSlug) &&
        slugs.has(m.intoSlug) &&
        m.fromSlug !== m.intoSlug &&
        !PROTECTED_SLUGS.has(m.fromSlug)
    )
    .slice(0, 10);

  // A category can only be merged away once, and can't also be renamed
  const seen = new Set<string>();
  const dedupedMerges = merges.filter((m) => {
    if (seen.has(m.fromSlug)) return false;
    seen.add(m.fromSlug);
    return true;
  });
  const mergedAway = new Set(dedupedMerges.map((m) => m.fromSlug));
  const safeRenames = renames.filter((r) => !mergedAway.has(r.slug));

  const validTargetNames = new Set<string>();
  categories
    .filter((c) => !mergedAway.has(c.slug))
    .forEach((c) => validTargetNames.add(c.name.toLowerCase()));
  safeRenames.forEach((r) => validTargetNames.add(r.newName.trim().toLowerCase()));
  newNames.forEach((n) => validTargetNames.add(n));

  const refiles = (raw.refiles ?? [])
    .filter(
      (f) =>
        f?.documentId &&
        docIds.has(f.documentId) &&
        f.intoName?.trim() &&
        validTargetNames.has(f.intoName.trim().toLowerCase())
    )
    .slice(0, MAX_OPERATIONS);

  return {
    newCategories,
    renames: safeRenames,
    merges: dedupedMerges,
    refiles,
    summary: raw.summary?.trim() || "Reorganization plan generated.",
  };
}

const NEW_CATEGORY_COLORS = [
  "blue", "green", "orange", "purple", "teal", "rose", "amber", "cyan",
];

export async function applyLibrarianPlan(plan: LibrarianPlan): Promise<{
  applied: { newCategories: number; renames: number; merges: number; refiles: number };
}> {
  // Re-validate against current DB state (plan may be stale)
  const categories = await prisma.category.findMany({
    select: { id: true, slug: true, name: true },
  });
  const documents = await prisma.document.findMany({ select: { id: true } });
  const validated = validatePlan(plan, categories, documents);

  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const bySlug = new Map(categories.map((c) => [c.slug, c]));

  // 1. Create new categories
  let created = 0;
  for (const nc of validated.newCategories) {
    try {
      const cat = await prisma.category.create({
        data: {
          name: nc.name.trim(),
          slug: slugifyCategory(nc.name),
          description: nc.description?.trim() || null,
          icon: "Folder",
          color: NEW_CATEGORY_COLORS[(categories.length + created) % NEW_CATEGORY_COLORS.length],
        },
      });
      byName.set(cat.name.toLowerCase(), cat);
      created++;
    } catch {
      // slug/name collision — skip
    }
  }

  // 2. Renames (update name/description, keep slug stable so URLs keep working)
  let renamed = 0;
  for (const r of validated.renames) {
    const cat = bySlug.get(r.slug);
    if (!cat) continue;
    try {
      byName.delete(cat.name.toLowerCase());
      const updated = await prisma.category.update({
        where: { id: cat.id },
        data: { name: r.newName.trim(), description: r.newDescription?.trim() || undefined },
      });
      byName.set(updated.name.toLowerCase(), updated);
      renamed++;
    } catch {
      // name collision — skip
    }
  }

  // 3. Merges: refile all docs, then delete the emptied source
  let merged = 0;
  for (const m of validated.merges) {
    const from = bySlug.get(m.fromSlug);
    const into = bySlug.get(m.intoSlug);
    if (!from || !into) continue;
    await prisma.document.updateMany({
      where: { categoryId: from.id },
      data: { categoryId: into.id },
    });
    const remaining = await prisma.document.count({ where: { categoryId: from.id } });
    if (remaining === 0) {
      await prisma.category.delete({ where: { id: from.id } });
      byName.delete(from.name.toLowerCase());
      bySlug.delete(from.slug);
      merged++;
    }
  }

  // 4. Individual refiles
  let refiled = 0;
  for (const f of validated.refiles) {
    const target = byName.get(f.intoName.trim().toLowerCase());
    if (!target) continue;
    try {
      await prisma.document.update({
        where: { id: f.documentId },
        data: { categoryId: target.id },
      });
      refiled++;
    } catch {
      // doc deleted since plan — skip
    }
  }

  return {
    applied: { newCategories: created, renames: renamed, merges: merged, refiles: refiled },
  };
}
