import { timingSafeEqual } from "node:crypto";

export const GMAIL_SEND_ACCOUNT = "breadloafhillsite@gmail.com";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_SEND_IDENTITY_SCOPES = [GMAIL_SEND_SCOPE, "openid", "email"] as const;
const CANONICAL_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

export interface GmailSendAuthorizationReceipt {
  version: 1;
  account: typeof GMAIL_SEND_ACCOUNT;
  scopes: string[];
  authorizedAt: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  subject: string;
}
export interface VerifiedMailIdentity {
  email?: string; email_verified?: boolean; sub?: string; nonce?: string;
}

/** Identity must first come from Google's signature/audience-verified ID token.
 * This validator allows only sending mail plus the requested identity proof. */
export function validateGmailSendAuthorization(input: { scopes: string[]; refreshToken: string; identity: VerifiedMailIdentity; nonce: string }): Pick<GmailSendAuthorizationReceipt, "account" | "subject" | "scopes"> {
  const canonicalScopes = Array.from(new Set(input.scopes.map(scope => scope === "email" ? CANONICAL_EMAIL_SCOPE : scope)));
  const expected = new Set([GMAIL_SEND_SCOPE, "openid", CANONICAL_EMAIL_SCOPE]);
  if (canonicalScopes.length !== expected.size || canonicalScopes.some(scope => !expected.has(scope))) {
    throw new Error("Authorize only Gmail send, OpenID identity, and email identity. No mail credentials were saved.");
  }
  if (!/^[\x21-\x7e]{20,4096}$/.test(input.refreshToken)) throw new Error("Google did not provide valid offline mail authorization. No mail credentials were saved.");
  const identity = input.identity;
  if (identity.email?.trim().toLowerCase() !== GMAIL_SEND_ACCOUNT || identity.email_verified !== true || !identity.sub) {
    throw new Error("The verified account must be the property mailbox. No mail credentials were saved.");
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.nonce) || !identity.nonce || !/^[A-Za-z0-9_-]{43}$/.test(identity.nonce) || !timingSafeEqual(Buffer.from(input.nonce), Buffer.from(identity.nonce))) {
    throw new Error("Google identity did not match this local consent request. No mail credentials were saved.");
  }
  return { account: GMAIL_SEND_ACCOUNT, subject: identity.sub, scopes: canonicalScopes };
}
