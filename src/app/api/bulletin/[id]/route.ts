import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const message = await prisma.bulletinMessage.update({
    where: { id },
    data: body,
  });

  return NextResponse.json(message);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.bulletinMessage.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
