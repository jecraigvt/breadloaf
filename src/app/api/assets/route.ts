import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { indexAsset } from "@/lib/embeddings";
import { requestAccessContext, accessibleDocumentScopes, accessPolicyResponse } from "@/lib/access-policy";
import { filterScopedDerivedRows } from "@/lib/derived-source-access";

export async function GET(request: NextRequest) {
 try {
  const scopes = accessibleDocumentScopes(await requestAccessContext(request));
  const assets = await prisma.asset.findMany({
    where: { status: "active" },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    include: {
      records: { orderBy: { performedAt: "desc" } },
      documents: {
        where: { deletedAt: null, accessScope: { in: scopes } },
        select: { id: true, title: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      _count: { select: { documents: { where: { deletedAt: null, accessScope: { in: scopes } } } } },
    },
  });
  const visibleRecords = await filterScopedDerivedRows(assets.flatMap(asset => asset.records), scopes);
  const visibleIds = new Set(visibleRecords.map(record => record.id));
  return NextResponse.json(assets.map(asset => {
    const records = asset.records.filter(record => visibleIds.has(record.id));
    return { ...asset, records: records.slice(0, 5), _count: { documents: asset._count.documents, records: records.length } };
  }));
 } catch (error) {
  const denied = accessPolicyResponse(error);
  return denied || NextResponse.json({ error: "Unable to load property systems" }, { status: 500 });
 }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = (body.name as string)?.trim();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const asset = await prisma.asset.create({
      data: {
        name,
        category: body.category || "other",
        location: body.location || undefined,
        make: body.make || undefined,
        model: body.model || undefined,
        serial: body.serial || undefined,
        installedYear: body.installedYear
          ? parseInt(String(body.installedYear))
          : undefined,
        notes: body.notes || undefined,
        addedBy: body.addedBy || undefined,
      },
    });
    void indexAsset(asset.id);
    return NextResponse.json(asset);
  } catch (error) {
    console.error("Create asset error:", error);
    return NextResponse.json({ error: "Failed to create asset" }, { status: 500 });
  }
}
