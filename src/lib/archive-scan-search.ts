import { Prisma } from "@prisma/client";
import { tokenizeSearchQuery } from "@/lib/embeddings";
import { prisma } from "@/lib/prisma";

const searchVector = Prisma.sql`to_tsvector('simple'::regconfig, p."text" || ' ' || p."summary")`;

function termsFor(query: string) {
  return tokenizeSearchQuery(query).flatMap(term => term.match(/[a-z0-9]+/g) || []).slice(0, 16);
}

const readablePages = Prisma.sql`FROM "ArchivePage" p
  JOIN "Document" d ON d."id" = p."documentId" AND d."archivePageJobId" = p."jobId"`;

export async function findArchivePages(query: string) {
  const terms = termsFor(query);
  if (!terms.length) return [];
  const dateTerms = terms.filter(term => /^(?:1[5-9]\d{2}|20\d{2})$/.test(term)).map(Number);
  const search = Prisma.sql`to_tsquery('simple'::regconfig, ${terms.join(" | ")})`;
  const filter = dateTerms.length ? Prisma.sql`p.years && ARRAY[${Prisma.join(dateTerms)}]::integer[]` : Prisma.sql`${searchVector} @@ ${search}`;
  return prisma.$queryRaw<Array<{ id: string; title: string; number: number; summary: string; excerpt: string; needsReview: boolean }>>(Prisma.sql`
    SELECT d.id, d.title, p.number, left(p.summary, 500) AS summary, p."needsReview",
      left(ts_headline('simple', p.text, ${search}, 'MaxWords=45, MinWords=12, MaxFragments=2, StartSel="⟦", StopSel="⟧"'), 1100) AS excerpt
    ${readablePages}
    WHERE d."deletedAt" IS NULL AND d."accessScope" = 'family' AND ${filter}
    ORDER BY ts_rank(${searchVector}, ${search}) DESC, d.id, p.number LIMIT 8
  `);
}

export async function findArchiveDocumentsByPage(query: string, scopes: string[], deleted: boolean) {
  const terms = termsFor(query);
  if (!terms.length || !scopes.length) return [];
  const search = Prisma.sql`to_tsquery('simple'::regconfig, ${terms.join(" & ")})`;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT DISTINCT d.id ${readablePages}
    WHERE d."accessScope" IN (${Prisma.join(scopes)})
      AND d."deletedAt" ${deleted ? Prisma.sql`IS NOT NULL` : Prisma.sql`IS NULL`}
      AND ${searchVector} @@ ${search}
  `);
  return rows.map(row => row.id);
}
