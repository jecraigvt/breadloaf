import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeSignInEmail } from "@/lib/sign-in-policy";
import { consumeAuthAttempt, authClientKey } from "@/lib/auth-rate-limit";
import { sendFamilyAccessRequestNotice } from "@/lib/family-sign-in-email";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const email = normalizeSignInEmail(body?.email);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!email || !name || name.length > 120) return NextResponse.json({ error: "Enter your name and a valid email address." }, { status: 400 });
    if (!await consumeAuthAttempt(`access-request-ip:${authClientKey(request)}`, 10, 24 * 60 * 60 * 1000)) return NextResponse.json({ error: "Please wait before sending another request." }, { status: 429 });
    if (await consumeAuthAttempt(`access-request-email:${email}`, 1, 24 * 60 * 60 * 1000)) {
      await prisma.familyAccessRequest.upsert({ where: { email }, create: { email, name }, update: { name, status: "pending" } });
      await sendFamilyAccessRequestNotice(name, email).catch(() => console.error("Family access request notification failed; request remains saved"));
    }
    return NextResponse.json({ message: "Your request has been saved for the family caretaker. Once approved, use Send sign-in link with this email." });
  } catch { return NextResponse.json({ error: "The request could not be saved. Please try again shortly." }, { status: 503 }); }
}
