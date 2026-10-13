import { NextResponse } from "next/server";

export function POST() { return NextResponse.json({ error: "Pantry scanning has been retired. Add supplies to the shopping list." }, { status: 410 }); }
