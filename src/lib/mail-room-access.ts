import type { NextRequest } from "next/server";
import { requirePrivilegedActor, AccessPolicyError } from "@/lib/access-policy";

export async function requireMailCurator(request: NextRequest) {
  const actor = await requirePrivilegedActor(request);
  if (!actor.isCurator) throw new AccessPolicyError("Only a verified curator can review incoming mail", 403);
  return actor;
}
