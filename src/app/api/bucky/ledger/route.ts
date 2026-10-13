import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isUndoSupportedAction } from "@/lib/bucky-ledger";
import { requestAccessContext, accessibleDocumentScopes, isPrivilegedActor, accessPolicyResponse } from "@/lib/access-policy";
import { ledgerDocumentIds, ledgerRoleVisible } from "@/lib/ledger-access";
import { filterScopedDerivedRows } from "@/lib/derived-source-access";

export async function GET(request: NextRequest) {
 try {
  const access = await requestAccessContext(request);
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 100);
  const entries = await prisma.buckyLedgerEntry.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      actionType: true,
      summary: true,
      details: true,
      initiatedBy: true,
      sourceType: true,
      sourceId: true,
      sourceLabel: true,
      reversible: true,
      revertedAt: true,
      revertedBy: true,
      createdAt: true,
      entityType: true, entityId: true, beforeState: true, afterState: true,
    },
  });
  const documentIds = Array.from(new Set(entries.flatMap(ledgerDocumentIds)));
  const accessible = new Set((documentIds.length ? await prisma.document.findMany({ where: { id: { in: documentIds }, accessScope: { in: accessibleDocumentScopes(access) } }, select: { id: true } }) : []).map((document) => document.id));
  const sourceVisible = await filterScopedDerivedRows(entries.map(entry => ({ ...entry, sourceType: entry.entityType === "question" ? "question" : entry.sourceType, sourceId: entry.entityType === "question" ? entry.entityId : entry.sourceId })), accessibleDocumentScopes(access));
  const visible = sourceVisible.filter((entry) => ledgerRoleVisible(entry, access) && ledgerDocumentIds(entry).every((id) => accessible.has(id)));
  return NextResponse.json(visible.map(({ beforeState: _before, afterState: _after, entityType: _type, entityId: _id, ...entry }) => ({
    ...entry, reversible: entry.reversible && isUndoSupportedAction(entry.actionType) && (entry.actionType !== "update_position" || isPrivilegedActor(access.actor)),
  })), { headers: { "Cache-Control": "private, no-store" } });
 } catch (error) { return accessPolicyResponse(error) || NextResponse.json({ error: "Activity history is unavailable" }, { status: 503 }); }
}
