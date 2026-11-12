// Explicit, tiny live-provider smoke. No database access or real family actions.
// Run with GOOGLE_AI_API_KEY, or railway run --service breadloaf-app npx tsx scripts/verify-hydrogen.ts.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { z } from "zod";
import { MODELS } from "../src/lib/ai-models";
import { createGeminiInteraction, generateGeminiStructured } from "../src/lib/gemini-generation";
import { runGeminiChat } from "../src/lib/gemini-chat";
import { backgroundApiUsage } from "../src/lib/bucky-api-cost";
import { assistantTools } from "../src/lib/ai";

async function main() {
  const json = await generateGeminiStructured({
    model: MODELS.flash,
    input: "Return ok true and label hydrogen-smoke.",
    schema: z.object({ ok: z.literal(true), label: z.literal("hydrogen-smoke") }),
    maxOutputTokens: 512,
  });
  assert.equal(json.ok, true);
  console.log("PASS Hydrogen structured text");

  let calls = 0;
  const text = await runGeminiChat({
    model: MODELS.flash,
    instructions: "Call smoke_echo exactly once with marker hydrogen-smoke. Then return the tool's result as your final answer.",
    input: [{ type: "user_input", content: [{ type: "text", text: "Please run the smoke echo." }] }],
    tools: [{ type: "function", name: "smoke_echo", description: "Echo a synthetic marker; no side effects.", parameters: {
      type: "object", properties: { marker: { type: "string" } }, required: ["marker"],
    } }],
    thinkingLevel: "low",
    executeTool: async (name, args) => {
      assert.equal(name, "smoke_echo");
      assert.equal(args.marker, "hydrogen-smoke");
      calls++;
      return { marker: "hydrogen-smoke-confirmed" };
    },
  });
  assert.equal(calls, 1);
  assert.match(text, /hydrogen-smoke-confirmed/);
  console.log("PASS Hydrogen stateless tool round trip");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([300, 200]).drawText("Synthetic service receipt: total $42.00", { x: 15, y: 100, size: 12, font });
  const receipt = await generateGeminiStructured({
    model: MODELS.flash,
    input: [{ type: "document", data: Buffer.from(await pdf.save()).toString("base64"), mime_type: "application/pdf" },
      { type: "text", text: "Read the total on this synthetic receipt as a number in dollars." }],
    schema: z.object({ total: z.number() }),
    maxOutputTokens: 512,
  });
  assert.equal(receipt.total, 42);
  console.log("PASS Hydrogen PDF input");

  const videoIndex = process.argv.indexOf("--video");
  if (videoIndex !== -1) {
    const video = await readFile(process.argv[videoIndex + 1]);
    const result = await generateGeminiStructured({
      model: MODELS.videoTranscription,
      input: [{ type: "video", data: video.toString("base64"), mime_type: "video/mp4" },
        { type: "text", text: "Does this synthetic video contain audible spoken words? Return speechDetected as a boolean." }],
      schema: z.object({ speechDetected: z.boolean() }),
      maxOutputTokens: 512,
    });
    assert.equal(result.speechDetected, false);
    console.log("PASS Hydrogen native video input (silent synthetic clip)");
  }

  const metered = await createGeminiInteraction({
    model: MODELS.pro,
    input: "Reply with the word ready. Do not call any tools.",
    tools: assistantTools,
    generation_config: { thinking_level: "high", max_output_tokens: 512 },
  }, { retries: 2 });
  assert.equal(metered.status, "completed");
  const usage = backgroundApiUsage(metered.usage);
  console.log(JSON.stringify({ check: "Hydrogen metered high-thinking response", model: MODELS.pro, ...usage }));
}

main().catch((error: unknown) => {
  // Never dump request objects or environment credentials in verification logs.
  const candidate = error as { name?: string; status?: number; message?: string; cause?: { code?: string } };
  const message = (candidate.message ?? "Unknown failure").replaceAll(process.env.GOOGLE_AI_API_KEY ?? "\u0000", "[redacted]");
  console.error(JSON.stringify({ error: candidate.name, status: candidate.status, message, cause: candidate.cause?.code }));
  process.exitCode = 1;
});
