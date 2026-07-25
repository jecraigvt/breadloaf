import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createIdentitySession,
  getDoorFamily,
  getIdentityCookieName,
  getIdentityLifetimeMs,
  hashIdentityToken,
  revokeIdentitySession,
} from "@/lib/actor";

/**
 * Claim an identity by tapping a face. The shared-PIN door is the security boundary,
 * so this needs no per-person secret — unless the member has opted into one, in which
 * case their profile is locked and the PIN is required.
 *
 * Re-claiming is allowed on purpose: without a credential, blocking it would strand
 * anyone who changes phones. "Claimed" means in use, not locked.
 */
export async function POST(request: NextRequest) {
  const doorFamily = await getDoorFamily(request);
  if (!doorFamily) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const memberId = typeof body?.memberId === "string" ? body.memberId : null;
  const pin = typeof body?.pin === "string" ? body.pin : null;

  if (!memberId) {
    return NextResponse.json({ error: "memberId is required" }, { status: 400 });
  }

  const member = await prisma.familyMember.findUnique({
    where: { id: memberId },
    include: { credential: true },
  });

  if (!member) {
    return NextResponse.json({ error: "That profile no longer exists." }, { status: 404 });
  }
  if (!member.canClaim || member.isMinor || member.deceased) {
    return NextResponse.json(
      { error: "That profile can't be claimed." },
      { status: 403 }
    );
  }

  // Locked profiles need their PIN; unlocked ones are a single tap.
  if (member.credential) {
    if (!pin) {
      return NextResponse.json({ error: "PIN required", pinRequired: true }, { status: 401 });
    }
    const attempted = await hashIdentityToken(pin.trim());
    if (attempted !== member.credential.pinHash) {
      return NextResponse.json(
        { error: "That PIN doesn't match.", pinRequired: true },
        { status: 401 }
      );
    }
  }

  // Switching identity on this device retires the previous session.
  const existingToken = request.cookies.get(getIdentityCookieName())?.value;
  if (existingToken) await revokeIdentitySession(existingToken);

  const token = await createIdentitySession(member.id, {
    userAgent: request.headers.get("user-agent"),
    claimedVia: member.credential ? "pin" : "tap",
  });

  const response = NextResponse.json({
    memberId: member.id,
    displayName: member.displayName?.trim() || member.name.split(" ")[0],
  });

  response.cookies.set(getIdentityCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(getIdentityLifetimeMs() / 1000),
  });

  return response;
}

/** Sign out of an identity without leaving the site — "not you?" on a shared device. */
export async function DELETE(request: NextRequest) {
  const token = request.cookies.get(getIdentityCookieName())?.value;
  if (token) await revokeIdentitySession(token);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(getIdentityCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
