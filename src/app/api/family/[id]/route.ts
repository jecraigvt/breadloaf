import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const member = await prisma.familyMember.update({
      where: { id },
      data: body,
    });

    return NextResponse.json(member);
  } catch (error) {
    console.error("Family member update error:", error);
    return NextResponse.json(
      { error: "Failed to update family member" },
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
    await prisma.familyMember.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Family member delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete family member" },
      { status: 500 }
    );
  }
}
