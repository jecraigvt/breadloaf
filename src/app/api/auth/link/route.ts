import { NextRequest, NextResponse } from "next/server";
import { issueFamilySignInLink } from "@/lib/family-access";
import { consumeAuthAttempt, authClientKey } from "@/lib/auth-rate-limit";
import { familyEmailConfigured, sendFamilySignInEmail } from "@/lib/family-sign-in-email";
import { emailSignInEnabled, normalizeSignInEmail } from "@/lib/sign-in-policy";
import { prisma } from "@/lib/prisma";

const genericMessage = "If this email is approved for Breadloaf Hill, a sign-in link is on its way. Check your inbox and spam folder.";
export async function POST(request: NextRequest) {
  if (!emailSignInEnabled() || !familyEmailConfigured()) return NextResponse.json({ error: "Email sign-in is not available yet. Please contact the family caretaker." }, { status: 503 });
  try {
    const body = await request.json().catch(() => null);
    const email = normalizeSignInEmail(body?.email);
    if (!email) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    const windowMs = 15 * 60 * 1000;
    if (!await consumeAuthAttempt(`link-ip:${authClientKey(request)}`, 20, windowMs)) return NextResponse.json({ error: "Too many requests. Please wait a few minutes." }, { status: 429, headers: { "Retry-After": "900" } });
    if (!await consumeAuthAttempt(`link-email:${email}`, 3, windowMs)) return NextResponse.json({ error: "Please wait a few minutes before requesting another sign-in link for this email." }, { status: 429, headers: { "Retry-After": "900", "Cache-Control": "no-store" } });
    const link = await issueFamilySignInLink(email, body?.from);
    if (link) {
      try { await sendFamilySignInEmail(email, link.token, link.memberName); }
      catch {
        await prisma.familySignInLink.update({ where: { id: link.id }, data: { usedAt: new Date() } });
        console.error("Family sign-in delivery failed");
        return NextResponse.json({ error: "We could not send your sign-in email. Please try again shortly or contact the family caretaker." }, { status: 503, headers: { "Cache-Control": "no-store" } });
      }
    }
    return NextResponse.json({ message: genericMessage }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Sign-in links are temporarily unavailable. Please try again shortly." }, { status: 503 }); }
}
