import type { Interactions as interactions } from "@google/genai";
import { createGeminiInteraction, completedGeminiOutput, type GeminiInteractionParams } from "@/lib/gemini-generation";

interface GeminiChatOptions {
  model: GeminiInteractionParams["model"];
  instructions: string;
  input: interactions.Step[];
  tools: GeminiInteractionParams["tools"];
  thinkingLevel: "low" | "high";
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

/** Replay native model steps verbatim so thought signatures survive tool rounds. */
export async function runGeminiChat(options: GeminiChatOptions): Promise<string> {
  const history = [...options.input];
  for (let round = 0; round <= 8; round++) {
    const result = await createGeminiInteraction({
      model: options.model,
      system_instruction: options.instructions,
      input: history,
      tools: options.tools,
      generation_config: { thinking_level: options.thinkingLevel },
    }, { retries: 2 });
    if (result.errors?.length || result.steps.some((step) => step.type === "model_output" && step.error)) {
      throw new Error("Gemini could not complete this conversation turn");
    }
    const calls = result.steps.filter((step) => step.type === "function_call");
    if (calls.length === 0) return completedGeminiOutput(result);
    if (result.status !== "requires_action" && result.status !== "completed") {
      throw new Error(`Gemini returned incomplete tool calls (${result.status})`);
    }
    if (round === 8) {
      return "I’ve reached the action limit for this turn. Completed actions have been saved; please ask me to continue.";
    }
    // Model thoughts and tool IDs belong to this exact response. Keep them intact.
    history.push(...result.steps);
    for (const call of calls) {
      let output: unknown;
      let isError = false;
      try {
        if (!call.id || !call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)) {
          throw new Error("Invalid tool arguments");
        }
        output = await options.executeTool(call.name, call.arguments);
      } catch (error) {
        isError = true;
        output = { error: `Failed: ${error instanceof Error ? error.message : "Unknown error"}` };
      }
      history.push({
        type: "function_result",
        name: call.name,
        call_id: call.id,
        result: [{ type: "text", text: JSON.stringify(output) }],
        ...(isError ? { is_error: true } : {}),
      });
    }
  }
  throw new Error("Bucky exceeded its conversation limit");
}
