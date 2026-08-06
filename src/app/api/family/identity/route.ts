import { NextRequest, NextResponse } from "next/server";
import {
  getCurrentActor,
  getDoorFamily,
  getIdentityLifetimeMs,
  getIdentitySkipCookieName,
} from "@/lib/actor";
import { getFamilyTree } from "@/lib/family-tree";
import {
  claimableIdentityChoices,
  choicesForDoorFamily,
  shouldPromptForIdentity,
} from "@/lib/identity-prompt";

export async function GET(request: NextRequest) {
  const doorFamily = await getDoorFamily(request);
  if (!doorFamily) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const actor = await getCurrentActor(request);
  const wasSkipped = request.cookies.get(getIdentitySkipCookieName())?.value === "1";
  const shouldPrompt = shouldPromptForIdentity({
    doorFamily,
    hasActor: Boolean(actor),
    wasSkipped,
  });

  if (!shouldPrompt) {
    return NextResponse.json({ doorFamily, actor, shouldPrompt, branchMembers: [], allMembers: [] });
  }

  // buildFamilyTree owns the claimability rule, including the minor and deceased
  // exclusions. The door picker consumes that result rather than rebuilding it.
  const tree = await getFamilyTree({ includePrivateDetail: true });
  const allMembers = claimableIdentityChoices(tree);
  const branchMembers = choicesForDoorFamily(allMembers, doorFamily);

  return NextResponse.json({
    doorFamily,
    actor,
    shouldPrompt,
    branchMembers,
    allMembers,
  });
}

export async function POST(request: NextRequest) {
  const doorFamily = await getDoorFamily(request);
  if (!doorFamily) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (body?.action !== "skip") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const response = NextResponse.json({ skipped: true });
  response.cookies.set(getIdentitySkipCookieName(), "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(getIdentityLifetimeMs() / 1000),
  });
  return response;
}
