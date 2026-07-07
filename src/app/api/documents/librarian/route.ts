import { NextRequest, NextResponse } from "next/server";
import { generateLibrarianPlan, applyLibrarianPlan } from "@/lib/librarian";

// The librarian: AI review of the document filing system.
// POST { action: "plan" }              → proposed reorganization (nothing changes)
// POST { action: "apply", plan: ... }  → execute an approved plan

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.action === "plan") {
      const plan = await generateLibrarianPlan();
      return NextResponse.json(plan);
    }

    if (body.action === "apply" && body.plan) {
      const result = await applyLibrarianPlan(body.plan);
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: "action must be 'plan' or 'apply' (with a plan)" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Librarian error:", error);
    return NextResponse.json(
      { error: "Librarian failed — try again" },
      { status: 500 }
    );
  }
}
