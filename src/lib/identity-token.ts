import { createHmac, randomBytes } from "node:crypto";

export function createIdentityToken(): string { return randomBytes(32).toString("base64url"); }

/** Keep the existing verifier format so previously claimed identities remain valid. */
export async function hashIdentityToken(token: string): Promise<string> {
  const secret = process.env.AUTH_SECRET || process.env.FAMILY_PINS || "breadloaf";
  return createHmac("sha256", secret).update(token).digest("base64url");
}
