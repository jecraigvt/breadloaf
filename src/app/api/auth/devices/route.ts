import { NextRequest, NextResponse } from "next/server";
import { getVerifiedActor } from "@/lib/actor";
import { getAuthCookieName } from "@/lib/auth";
import { rememberedFamilySession } from "@/lib/family-access";
import { clearFamilyDeviceCookies } from "@/lib/auth-cookies";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const actor = await getVerifiedActor(request);
  if (!actor) return NextResponse.json({ error: "Use an email sign-in link to manage your remembered devices." }, { status: 401 });
  const current = await rememberedFamilySession(request.cookies.get(getAuthCookieName())?.value);
  const sessions = await prisma.familySession.findMany({ where: { memberId: actor.memberId, verifiedAt: { not: null }, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastUsedAt: "desc" }, select: { id: true, userAgent: true, lastUsedAt: true, createdAt: true, expiresAt: true } });
  return NextResponse.json({ actor, devices: sessions.map(s => ({ ...s, current: s.id === current?.id })) }, { headers: { "Cache-Control": "no-store" } });
}
export async function DELETE(request: NextRequest) {
  const actor = await getVerifiedActor(request);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (typeof body?.sessionId !== "string") return NextResponse.json({ error: "Choose a device." }, { status: 400 });
  const current = await rememberedFamilySession(request.cookies.get(getAuthCookieName())?.value);
  const result = await prisma.familySession.updateMany({ where: { id: body.sessionId, memberId: actor.memberId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!result.count) return NextResponse.json({ error: "Device not found." }, { status: 404 });
  const response = NextResponse.json({ success: true, signedOut: current?.id === body.sessionId });
  if (current?.id === body.sessionId) clearFamilyDeviceCookies(response, request);
  return response;
}
