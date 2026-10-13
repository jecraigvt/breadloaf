import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { localFamilyEmailTestTransport } from "@/lib/family-email-test-transport";
import { consumeAuthAttempt } from "@/lib/auth-rate-limit";

export const PROPERTY_EMAIL_ACCOUNT = "breadloafhillsite@gmail.com";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const IDENTITY_SCOPES = new Set(["openid", "email", "https://www.googleapis.com/auth/userinfo.email"]);
const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_PROVIDER_BYTES = 64 * 1024;
const PROVIDER_TIMEOUT_MS = 15000;
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

type Environment = Record<string, string | undefined>;
type Fetch = typeof globalThis.fetch;
export interface PropertyEmail {
  displayName: "Breadloaf Hill" | "Bucky at Breadloaf Hill";
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  headers: Record<string, string>;
}

export class MailDeliveryError extends Error {
  constructor() { super("Property email delivery is temporarily unavailable"); this.name = "MailDeliveryError"; }
}
export class MailDeliveryBudgetError extends MailDeliveryError {
  constructor() { super(); this.name = "MailDeliveryBudgetError"; }
}

function settings(env: Environment) {
  const local = localFamilyEmailTestTransport(env);
  if (local) return { type: "test-smtp" as const, local };
  const clientId = env.GMAIL_SEND_CLIENT_ID?.trim();
  const clientSecret = env.GMAIL_SEND_CLIENT_SECRET?.trim();
  const refreshToken = env.GMAIL_SEND_REFRESH_TOKEN?.trim();
  if (clientId || clientSecret || refreshToken) {
    // Never quietly use the blocked SMTP transport after a partial OAuth rollout.
    if (!clientId || !clientSecret || !refreshToken || [clientId, clientSecret, refreshToken].some(value => /\s/.test(value) || value.length > 8192)) throw new MailDeliveryError();
    return { type: "gmail-api" as const, clientId, clientSecret, refreshToken };
  }
  const password = env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  // This app uses Railway Hobby, where outbound SMTP is disabled. Retain the
  // older app-password transport only for environments where SMTP is available.
  const railway = env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_SERVICE_ID || env.RAILWAY_PUBLIC_DOMAIN;
  if (!password || railway) throw new MailDeliveryError();
  return { type: "smtp" as const, password };
}

export function mailDeliveryConfigured(env: Environment = process.env): boolean {
  try { if (settings(env).type !== "test-smtp") dailyBudget(env); return true; } catch { return false; }
}

function dailyBudget(env: Environment) {
  const dailyLimit = Number(env.GMAIL_SEND_DAILY_BUDGET || 100);
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 100) throw new MailDeliveryError();
  return dailyLimit;
}

function mailOptions(input: PropertyEmail) {
  const recipients = (Array.isArray(input.to) ? input.to : [input.to]).map(email => email.trim().toLowerCase());
  if (!recipients.length || recipients.length > 100 || recipients.some(email => email.length > 254 || !/^[^\s@<>,;:]+@[^\s@<>,;:]+\.[^\s@<>,;:]+$/.test(email)) ||
      !["Breadloaf Hill", "Bucky at Breadloaf Hill"].includes(input.displayName) || /[\r\n]/.test(input.subject) ||
      Object.entries(input.headers).some(([name, value]) => !/^(?:Auto-Submitted|X-Breadloaf-[A-Za-z0-9-]+)$/i.test(name) || /[\r\n]/.test(value))) throw new MailDeliveryError();
  if (Buffer.byteLength(input.subject + input.text + (input.html || "")) > MAX_MESSAGE_BYTES) throw new MailDeliveryError();
  return {
    from: { name: input.displayName, address: PROPERTY_EMAIL_ACCOUNT },
    to: recipients.map(address => ({ address })), subject: input.subject, text: input.text, html: input.html,
    headers: input.headers, disableFileAccess: true, disableUrlAccess: true,
  };
}

async function providerJson(url: string, init: RequestInit, fetcher: Fetch): Promise<Record<string, unknown>> {
  try {
    const response = await fetcher(url, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
    if (!response.ok || !response.body || Number(response.headers.get("content-length") || 0) > MAX_PROVIDER_BYTES) throw new MailDeliveryError();
    const reader = response.body.getReader();
    const parts: Buffer[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_PROVIDER_BYTES) throw new MailDeliveryError();
        parts.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const value: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new MailDeliveryError();
    return value as Record<string, unknown>;
  } catch { throw new MailDeliveryError(); }
}

/** Shared by sign-in links, caretaker requests and Bucky notifications. Only the
 * fixed property account can send; tokens and provider error bodies never escape.
 * A send is attempted once because a lost HTTP response may still have sent it. */
export async function sendPropertyEmail(input: PropertyEmail, options: { env?: Environment; fetch?: Fetch;
  reserveAttempt?: (limit: number, windowMs: number) => Promise<boolean> } = {}): Promise<{ provider: "gmail-api" | "smtp" | "test-smtp" }> {
  const env = options.env || process.env;
  const transport = settings(env);
  const message = mailOptions(input);
  if (transport.type !== "test-smtp") {
    const dailyLimit = dailyBudget(env);
    const reserve = options.reserveAttempt || ((limit: number, windowMs: number) => consumeAuthAttempt("property-email-outbound", limit, windowMs));
    let permitted: boolean;
    try { permitted = await reserve(dailyLimit, DAILY_WINDOW_MS); } catch { throw new MailDeliveryError(); }
    if (!permitted) throw new MailDeliveryBudgetError();
  }
  if (transport.type !== "gmail-api") {
    const smtp = transport.type === "test-smtp"
      ? nodemailer.createTransport({ ...transport.local, secure: false, ignoreTLS: true, connectionTimeout: 5000, socketTimeout: 5000 })
      : nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true,
        auth: { user: PROPERTY_EMAIL_ACCOUNT, pass: transport.password }, connectionTimeout: 15000, socketTimeout: 20000 });
    try { await smtp.sendMail(message); } catch { throw new MailDeliveryError(); } finally { smtp.close(); }
    return { provider: transport.type };
  }
  const mime = await new MailComposer(message).compile().build();
  if (mime.length > MAX_MESSAGE_BYTES) throw new MailDeliveryError();
  const fetcher = options.fetch || globalThis.fetch;
  const token = await providerJson("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: transport.clientId, client_secret: transport.clientSecret,
      refresh_token: transport.refreshToken, grant_type: "refresh_token" }).toString(),
  }, fetcher);
  const scopes = typeof token.scope === "string" ? token.scope.split(/\s+/).filter(Boolean) : [];
  if (!scopes.includes(GMAIL_SEND_SCOPE) || !scopes.some(scope => scope === "email" || scope === "https://www.googleapis.com/auth/userinfo.email") ||
      scopes.some(scope => scope !== GMAIL_SEND_SCOPE && !IDENTITY_SCOPES.has(scope)) || token.token_type !== "Bearer" ||
      typeof token.access_token !== "string" || !token.access_token || token.access_token.length > 8192 || /\s/.test(token.access_token) ||
      typeof token.expires_in !== "number" || token.expires_in <= 0 || token.expires_in > 86400) throw new MailDeliveryError();
  const authorization = { Authorization: `Bearer ${token.access_token}` };
  const identity = await providerJson("https://openidconnect.googleapis.com/v1/userinfo", { headers: authorization }, fetcher);
  if (typeof identity.email !== "string" || identity.email.toLowerCase() !== PROPERTY_EMAIL_ACCOUNT || identity.email_verified !== true) throw new MailDeliveryError();
  const sent = await providerJson("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { ...authorization, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: mime.toString("base64url") }),
  }, fetcher);
  if (typeof sent.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(sent.id)) throw new MailDeliveryError();
  return { provider: "gmail-api" };
}
