import { NextRequest, NextResponse } from "next/server";

function getFamilyPins(): Record<string, string> {
  const raw = process.env.FAMILY_PINS || "";
  const pins: Record<string, string> = {};
  for (const entry of raw.split(",")) {
    const [name, pin] = entry.split(":").map((s) => s.trim());
    if (name && pin) pins[pin] = name;
  }
  return pins;
}

// POST — Login: validate PIN, set cookie
export async function POST(request: NextRequest) {
  try {
    const { pin } = await request.json();

    if (!pin) {
      return NextResponse.json({ error: "PIN required" }, { status: 400 });
    }

    const pinMap = getFamilyPins();
    const family = pinMap[String(pin)];

    if (!family) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }

    // Create a token: base64(family:pin)
    const token = Buffer.from(`${family}:${pin}`).toString("base64");

    const response = NextResponse.json({ family });
    response.cookies.set("breadloaf_auth", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: "/",
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}

// GET — Check auth status
export async function GET(request: NextRequest) {
  const token = request.cookies.get("breadloaf_auth")?.value;

  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  try {
    const decoded = Buffer.from(token, "base64").toString();
    const [family, pin] = decoded.split(":");

    const pinMap = getFamilyPins();
    if (pinMap[pin] === family) {
      return NextResponse.json({ authenticated: true, family });
    }
  } catch {
    // Invalid token
  }

  return NextResponse.json({ authenticated: false }, { status: 401 });
}

// DELETE — Logout
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set("breadloaf_auth", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}
