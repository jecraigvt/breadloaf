import { NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";

export async function GET() {
  const results: string[] = [];

  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  results.push(`GOOGLE_CALENDAR_ID: ${calendarId || "NOT SET"}`);
  results.push(`GOOGLE_SERVICE_ACCOUNT_KEY: ${credentials ? `SET (${credentials.length} chars)` : "NOT SET"}`);

  if (!credentials || !calendarId) {
    return NextResponse.json({ results, error: "Missing env vars" });
  }

  try {
    const key = JSON.parse(credentials);
    results.push(`Service account: ${key.client_email}`);
    results.push(`Project: ${key.project_id}`);
    results.push(`Has private_key: ${!!key.private_key}`);

    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });

    const calendar = google.calendar({ version: "v3", auth: auth as unknown as string });

    // Test listing events
    const listRes = await calendar.events.list({
      calendarId,
      timeMin: new Date().toISOString(),
      maxResults: 3,
    });
    results.push(`List events: SUCCESS (${listRes.data.items?.length || 0} events)`);

    // Test creating an event
    const createRes = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: "Breadloaf Hill Sync Test",
        start: { date: "2026-07-04" },
        end: { date: "2026-07-05" },
        location: "Breadloaf Hill, Vermont",
      },
    });
    results.push(`Create event: SUCCESS (ID: ${createRes.data.id})`);

    // Clean up test event
    if (createRes.data.id) {
      await calendar.events.delete({ calendarId, eventId: createRes.data.id });
      results.push("Delete test event: SUCCESS");
    }

    return NextResponse.json({ results, status: "ALL GOOD" });
  } catch (err: unknown) {
    const error = err as Error & { code?: number; response?: { data: unknown } };
    results.push(`ERROR: ${error.message}`);
    if (error.code) results.push(`Code: ${error.code}`);
    return NextResponse.json({ results, status: "FAILED" });
  }
}
