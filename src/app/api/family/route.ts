import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
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
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
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
        name: name.trim(),
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        birthday: birthday?.trim() || null,
        branch: branch?.trim() || null,
        relation: relation?.trim() || null,
        boardRole: boardRole?.trim() || null,
        isBoardMember: Boolean(isBoardMember),
        notes: notes?.trim() || null,
      },
    });

    return NextResponse.json(member);
  } catch (error) {
    console.error("Family member create error:", error);
    return NextResponse.json(
      { error: "Failed to add family member" },
      { status: 500 }
    );
  }
}
