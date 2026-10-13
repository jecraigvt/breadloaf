import { NextRequest, NextResponse } from "next/server";
import { generateLibrarianPlan, applyLibrarianPlan, parseLibrarianPlan } from "@/lib/librarian";
import { requestAccessContext, requirePrivilegedActor, accessPolicyResponse } from "@/lib/access-policy";
import { ZodError } from "zod";

// The librarian: AI review of the document filing system.
// POST { action: "plan" }              → proposed reorganization (nothing changes)
// POST { action: "apply", plan: ... }  → execute an approved plan

export async function POST(request: NextRequest) {
  try {
    await requestAccessContext(request);
    const body = await request.json();

    if (body.action === "plan") {
      const plan = await generateLibrarianPlan();
      return NextResponse.json(plan);
    }

    if (body.action === "apply" && body.plan) {
      await requirePrivilegedActor(request);
      const result = await applyLibrarianPlan(parseLibrarianPlan(body.plan));
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: "action must be 'plan' or 'apply' (with a plan)" },
      { status: 400 }
    );
  } catch (error) {
    const denied = accessPolicyResponse(error);
    if (denied) return denied;
    if (error instanceof ZodError) return NextResponse.json({ error: "Invalid filing plan" }, { status: 400 });
    console.error("Librarian error:", error);
    const msg = String(error);
    if (msg.includes("429") || msg.toLowerCase().includes("quota")) {
      return NextResponse.json(
        { error: "The AI's daily free-tier quota is used up — upgrade the Gemini API key to pay-as-you-go, or try again tomorrow." },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: "Librarian failed — try again" },
      { status: 500 }
    );
  }
}
