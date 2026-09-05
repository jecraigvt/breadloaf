import type { UserInput } from "@openai/codex-sdk";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { codexEnvironment } from "../../src/lib/bucky-codex-policy";
import { readCodexAvailability } from "../../src/lib/bucky-codex-account";
import { MODELS } from "../../src/lib/ai-models";
import type { WorkerConfig } from "./config";
import type { SourcePart } from "./client";

export interface ModelUsage { inputTokens: number; outputTokens: number; model?: string; costCents: number }
export interface StructuredRunner {
  run(prompt: string, schema: Record<string, unknown>, images?: string[]): Promise<unknown>;
  usage: ModelUsage;
}
export class SubscriptionUnavailableError extends Error {}

export async function createCodexRunner(config: WorkerConfig, directory: string, signal: AbortSignal): Promise<StructuredRunner> {
  const { Codex } = await import("@openai/codex-sdk");
  // A separate Codex home keeps personal MCP servers, plugins, hooks, memories,
  // and repository instructions out of unattended jobs. Credentials remain local.
  const isolatedHome = path.join(directory, "codex-home");
  await mkdir(isolatedHome, { recursive: true, mode: 0o700 });
  const authPath = path.join(process.env.CODEX_HOME || path.join(homedir(), ".codex"), "auth.json");
  await copyFile(authPath, path.join(isolatedHome, "auth.json"));
  // Fail closed when the managed login uses an unsupported credential store.
  const auth = JSON.parse(await readFile(path.join(isolatedHome, "auth.json"), "utf8"));
  if (!auth.tokens || auth.OPENAI_API_KEY) throw new Error("This Codex credential store is not supported by the isolated worker; use managed ChatGPT file authentication");
  const codex = new Codex({
    codexPathOverride: config.codexPath,
    env: { ...codexEnvironment(), CODEX_HOME: isolatedHome },
    config: {
      forced_login_method: "chatgpt", cli_auth_credentials_store: "file", project_doc_max_bytes: 0,
      features: { shell_tool: false, apps: false, plugins: false, hooks: false, browser_use: false,
        computer_use: false, multi_agent: false, memories: false, skip_host_skill_discovery: true,
        prevent_idle_sleep: false, view_image: false, image_generation: false, workspace_dependencies: false,
        browser_use_external: false, in_app_browser: false, sleep_tool: false },
    },
  });
  const usage: ModelUsage = { inputTokens: 0, outputTokens: 0, costCents: 0, model: MODELS.pro };
  return {
    usage,
    async run(prompt, schema, images = []) {
      signal.throwIfAborted();
      const availability = await readCodexAvailability(config.codexPath);
      if (!availability.ready) throw new SubscriptionUnavailableError(availability.reason);
      signal.throwIfAborted();
      const thread = codex.startThread({ model: MODELS.pro, workingDirectory: directory, sandboxMode: "read-only",
        networkAccessEnabled: false, webSearchMode: "disabled", approvalPolicy: "never", skipGitRepoCheck: true });
      const inputs: UserInput[] = [{ type: "text", text: prompt }, ...images.map((file) => ({ type: "local_image" as const, path: file }))];
      const result = await thread.run(inputs, { outputSchema: schema, signal });
      if (result.items.some((item) => ["command_execution", "mcp_tool_call", "file_change", "web_search"].includes(item.type)))
        throw new Error("Unattended Codex attempted a tool outside its read-only analysis contract");
      usage.inputTokens += result.usage?.input_tokens || 0;
      usage.outputTokens += result.usage?.output_tokens || 0;
      return JSON.parse(result.finalResponse);
    },
  };
}

/** PDF inputs arrive as one page, so memory does not grow with document length. */
export async function partImages(part: SourcePart, directory: string): Promise<string[]> {
  if (part.imageBase64) {
    if (!/^image\/(png|jpeg|webp)$/.test(part.mimeType)) throw new Error("Unsupported source image format");
    const file = path.join(directory, `source.${part.mimeType === "image/jpeg" ? "jpg" : part.mimeType.split("/")[1]}`);
    await writeFile(file, Buffer.from(part.imageBase64, "base64"), { mode: 0o600 });
    return [file];
  }
  if (!part.fileBase64) return [];
  if (part.mimeType !== "application/pdf") throw new Error("Unsupported source attachment");
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const packageRequire = createRequire(path.join(process.cwd(), "package.json"));
  const standardFontDataUrl = path.join(path.dirname(packageRequire.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep;
  const document = await getDocument({ data: new Uint8Array(Buffer.from(part.fileBase64, "base64")),
    useSystemFonts: false, standardFontDataUrl, isEvalSupported: false }).promise;
  try {
    if (document.numPages !== 1) throw new Error("Source endpoint must send one PDF page per part");
    const page = await document.getPage(1);
    const raw = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 2200 / Math.max(raw.width, raw.height)) });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D, viewport }).promise;
    const file = path.join(directory, "source.png");
    await writeFile(file, canvas.toBuffer("image/png"), { mode: 0o600 });
    return [file];
  } finally { await document.destroy(); }
}
