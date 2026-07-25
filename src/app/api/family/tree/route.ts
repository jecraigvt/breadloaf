import { NextRequest, NextResponse } from "next/server";
import { getFamilyTree } from "@/lib/family-tree";
import { getCurrentActor, getDoorFamily } from "@/lib/actor";

/**
 * The tree is intentionally readable without signing in so family members can find
 * themselves and claim a profile. Anything private is withheld until the shared-PIN
 * door has been passed: contact details, notes, curator review flags, and minors'
 * surnames. See buildFamilyTree's `includePrivateDetail`.
 */
export async function GET(request: NextRequest) {
  const doorFamily = await getDoorFamily(request);
  const includePrivateDetail = Boolean(doorFamily);

  const [tree, actor] = await Promise.all([
    getFamilyTree({ includePrivateDetail }),
    includePrivateDetail ? getCurrentActor(request) : Promise.resolve(null),
  ]);

  return NextResponse.json({
    tree,
    actor,
    signedIn: includePrivateDetail,
    doorBranch: doorFamily,
  });
}
