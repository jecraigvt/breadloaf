import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

/** Atomic across instances; keys contain one-way hashes, never email addresses or IPs. */
export async function consumeAuthAttempt(key: string, limit: number, windowMs: number): Promise<boolean> {
  const identifier = createHash("sha256").update(key).digest("hex");
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "AuthRateLimit" ("key", "count", "windowEndsAt")
      VALUES (${identifier}, 1, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + ${windowMs} * INTERVAL '1 millisecond')
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "AuthRateLimit"."windowEndsAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN 1 ELSE "AuthRateLimit"."count" + 1 END,
      "windowEndsAt" = CASE WHEN "AuthRateLimit"."windowEndsAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + ${windowMs} * INTERVAL '1 millisecond' ELSE "AuthRateLimit"."windowEndsAt" END
    RETURNING "count"`;
  return Boolean(rows[0] && rows[0].count <= limit);
}

export function authClientKey(request: Request): string {
  // Railway appends its verified peer. Use the rightmost address, not a caller-supplied first value.
  return request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
}
