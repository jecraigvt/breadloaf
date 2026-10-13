import { NextResponse } from "next/server";

function retired() { return NextResponse.json({ error: "Pantry tracking has been retired. Use the shopping list for supplies." }, { status: 410 }); }
export const PATCH = retired;
export const DELETE = retired;
