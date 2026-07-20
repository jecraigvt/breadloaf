import { NextRequest, NextResponse } from "next/server";
import {
  createCalendarFeedToken,
  getAuthCookieName,
  getFamilyFromAuthToken,
} from "@/lib/auth";

export async function GET(request: NextRequest) {
  const family = await getFamilyFromAuthToken(
    request.cookies.get(getAuthCookieName())?.value
  );

  if (!family) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await createCalendarFeedToken(family);
  if (!token) {
    return NextResponse.json(
      { error: "Calendar feed token unavailable" },
      { status: 500 }
    );
  }

  return NextResponse.json({ token });
}
