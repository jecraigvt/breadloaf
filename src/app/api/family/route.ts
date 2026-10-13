import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requestAccessContext, requirePrivilegedActor, accessPolicyResponse } from "@/lib/access-policy";
import { FamilyProfileCreateSchema } from "@/lib/family-profile-input";
import { ZodError } from "zod";

export async function GET(request: NextRequest) {
 try {
  await requestAccessContext(request);
  const members = await prisma.familyMember.findMany({
    orderBy: [{ branch: "asc" }, { name: "asc" }],
  });

  // Group by branch
  const grouped: Record<string, typeof members> = {};
  for (const member of members) {
    const branch = member.branch || "Extended";
    if (!grouped[branch]) {
      grouped[branch] = [];
    }
    grouped[branch].push(member);
  }

  return NextResponse.json({ members, grouped });
 } catch (error) {
  const denied = accessPolicyResponse(error);
  if (denied) return denied;
  return NextResponse.json({ error: "Unable to load family directory" }, { status: 500 });
 }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requirePrivilegedActor(request);
    const body = FamilyProfileCreateSchema.parse(await request.json());
    if ("isCurator" in body && !actor.isCurator) {
      return NextResponse.json({ error: "Only a verified curator can assign curator access" }, { status: 403 });
    }
    const {
      name,
      email,
      phone,
      birthday,
      branch,
      relation,
      boardRole,
      isBoardMember,
      notes,
    } = body;

    if (!name?.trim()) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    const member = await prisma.familyMember.create({
      data: {
        ...body,
        name: name.trim(),
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        birthday: birthday?.trim() || null,
        branch: branch?.trim() || null,
        relation: relation?.trim() || null,
        boardRole: boardRole?.trim() || null,
        isBoardMember: Boolean(isBoardMember),
        notes: notes?.trim() || null,
        canClaim: body.isMinor || body.deceased ? false : body.canClaim ?? true,
      },
    });

    return NextResponse.json(member);
  } catch (error) {
    const denied = accessPolicyResponse(error);
    if (denied) return denied;
    if (error instanceof ZodError) return NextResponse.json({ error: "Invalid family profile fields" }, { status: 400 });
    console.error("Family member create error:", error);
    return NextResponse.json(
      { error: "Failed to add family member" },
      { status: 500 }
    );
  }
}
