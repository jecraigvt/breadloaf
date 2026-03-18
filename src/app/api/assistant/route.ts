import { NextRequest } from "next/server";
import { chatWithAssistant } from "@/lib/ai";
import { syncFromGoogleCalendar } from "@/lib/google-calendar";

export async function POST(request: NextRequest) {
  try {
    const { messages, username } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response("Messages array required", { status: 400 });
    }

    // Sync calendar before responding so assistant has latest data
    await syncFromGoogleCalendar().catch(() => {});

    const responseText = await chatWithAssistant(messages, username);

    return new Response(responseText, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("Assistant error:", error);
    return new Response("Failed to get response from assistant", {
      status: 500,
    });
  }
}
