import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { indexMaintenance, removeFromIndex } from "@/lib/embeddings";
import { maintenancePatchSchema } from "@/lib/maintenance-contract";
import { requestAccessContext, accessibleDocumentScopes, accessPolicyResponse, AccessPolicyError } from "@/lib/access-policy";
import { filterScopedDerivedRows } from "@/lib/derived-source-access";

async function assertRecordAccess(request: NextRequest, id: string) {
  const access = await requestAccessContext(request);
  const record = await prisma.maintenanceRecord.findUnique({ where: { id } });
  if (!record) throw new AccessPolicyError("Not found", 404);
  if (!(await filterScopedDerivedRows([record], accessibleDocumentScopes(access))).length) throw new AccessPolicyError("This maintenance source requires verified permission or an unlocked vault", 403);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await assertRecordAccess(request, id);
    const parsed = maintenancePatchSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid maintenance change." }, { status: 400 });

    const record = await prisma.maintenanceRecord.update({
      where: { id },
      data: parsed.data,
    });
    void indexMaintenance(record.id);

    return NextResponse.json(record);
  } catch (error) {
    const denied = accessPolicyResponse(error); if (denied) return denied;
    console.error("Maintenance update error:", error);
    return NextResponse.json(
      { error: "Failed to update maintenance record" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await assertRecordAccess(_request, id);
    await prisma.maintenanceRecord.delete({ where: { id } });
    void removeFromIndex("maintenance", id).catch((error) =>
      console.error("Maintenance index cleanup failed:", error)
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    const denied = accessPolicyResponse(error); if (denied) return denied;
    console.error("Maintenance delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete maintenance record" },
      { status: 500 }
    );
  }
}
