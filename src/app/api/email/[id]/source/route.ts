import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMailCurator } from "@/lib/mail-room-access";
import { accessPolicyResponse } from "@/lib/access-policy";
import { readEmailSource } from "@/lib/email-source";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireMailCurator(request);
    const { id } = await params;
    const row = await prisma.emailLog.findUnique({ where: { id }, select: { sourceChecksum: true } });
    if (!row?.sourceChecksum) return NextResponse.json({ error: "Original not available" }, { status: 404 });
    const source = await readEmailSource(row.sourceChecksum);
    return new NextResponse(new Uint8Array(source), { headers: { "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="retained-email.eml"', "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'", "Cache-Control": "private, no-store" } });
  } catch (error) { return accessPolicyResponse(error) || NextResponse.json({ error: "Original email is unavailable" }, { status: 503 }); }
}
