import { canonicalSiteUrl } from "@/lib/sign-in-policy";
import { prisma } from "@/lib/prisma";
import { mailDeliveryConfigured, sendPropertyEmail } from "@/lib/mail-delivery";

export function familyEmailConfigured(): boolean { return mailDeliveryConfigured(); }
function escape(value: string) { return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!)); }

export async function sendFamilySignInEmail(email: string, token: string, name: string) {
  const url = `${canonicalSiteUrl()}/login/confirm#token=${encodeURIComponent(token)}`;
  await sendPropertyEmail({ displayName: "Breadloaf Hill", to: email, subject: "Your Breadloaf Hill sign-in link",
      text: `Hi ${name},\n\nOpen Breadloaf Hill on this device:\n${url}\n\nThis link works once and expires in 20 minutes. The site will remember your device. If you did not ask for this link, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#233d30"><h1 style="font-family:Georgia,serif;font-weight:normal">Breadloaf Hill</h1><p>Hi ${escape(name)},</p><p>Your place in the family is ready.</p><p><a href="${escape(url)}" style="display:inline-block;background:#2c4c35;color:white;padding:14px 20px;text-decoration:none;border-radius:4px">Open Breadloaf Hill</a></p><p>This link works once and expires in 20 minutes. The site will remember this device.</p><p>If you did not ask for this link, you can ignore this email.</p></div>`,
      headers: { "Auto-Submitted": "auto-generated", "X-Breadloaf-Notification": "family-sign-in" } });
}

export async function sendFamilyAccessRequestNotice(name: string, email: string) {
  if (!familyEmailConfigured()) return;
  const caretakers = await prisma.familyMember.findMany({ where: { accessApproved: true, isCurator: true, canClaim: true, isMinor: false, deceased: false, email: { not: null } }, select: { email: true } });
  if (!caretakers.length) return;
  await sendPropertyEmail({ displayName: "Breadloaf Hill", to: caretakers.map(c => c.email!), subject: "A family access request for Breadloaf Hill", text: `${name} requested family access using ${email}.\n\nReview the request inside the family site:\n${canonicalSiteUrl()}/access\n\nAccess is not granted until you approve it.`, headers: { "Auto-Submitted": "auto-generated", "X-Breadloaf-Notification": "family-access-request" } });
}
