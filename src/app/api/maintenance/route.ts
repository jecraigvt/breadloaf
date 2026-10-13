import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { indexMaintenance } from "@/lib/embeddings";
import { dictationDisplaySummaries } from "@/lib/dictation-intelligence";
import { recordingSources } from "@/lib/dictation-analysis";
import { maintenanceInputSchema, normalizeMaintenanceCategory } from "@/lib/maintenance-contract";
import { requestAccessContext, accessibleDocumentScopes, accessPolicyResponse } from "@/lib/access-policy";
import { filterScopedDerivedRows } from "@/lib/derived-source-access";

export async function GET(request: NextRequest) {
 try {
  const access = await requestAccessContext(request);
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");

  const records = await prisma.maintenanceRecord.findMany({
    orderBy: { performedAt: "desc" },
  });
  const visible = await filterScopedDerivedRows(records, accessibleDocumentScopes(access));
  const normalized = visible.map(record => ({ ...record, category: normalizeMaintenanceCategory(record.category) })).filter(record => !category || category === "All" || record.category === normalizeMaintenanceCategory(category));

  const summaries = await dictationDisplaySummaries(visible.flatMap((record) => recordingSources(record.sourceRecordings).map((source) => source.filePath)));
  return NextResponse.json(normalized.map((record) => ({
    ...record,
    displaySummary: summaries.get(recordingSources(record.sourceRecordings)[0]?.filePath) || null,
  })));
 } catch (error) { return accessPolicyResponse(error) || NextResponse.json({ error: "Maintenance history is unavailable" }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  try {
    await requestAccessContext(request);
    const parsed = maintenanceInputSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter a title, valid performed date, and a nonnegative cost." }, { status: 400 });

    const record = await prisma.maintenanceRecord.create({
      data: parsed.data,
    });
    void indexMaintenance(record.id);

    return NextResponse.json(record);
  } catch (error) {
    console.error("Maintenance create error:", error);
    return NextResponse.json(
      { error: "Failed to create maintenance record" },
      { status: 500 }
    );
  }
}
