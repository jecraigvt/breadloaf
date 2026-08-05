import { categorizeText, type CategoryOption } from "@/lib/ai";
import type { DocumentAnalysisOutcome } from "@/lib/document-analysis";

const MAX_LINK_BYTES = 2 * 1024 * 1024;
const MAX_LINK_CHARS = 20000;

export function linkedDocumentFetchUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported link protocol: ${url.protocol}`);
  }
  const googleDoc = url.hostname === "docs.google.com"
    ? url.pathname.match(/^\/document\/d\/([^/]+)/)
    : null;
  return googleDoc
    ? new URL(`https://docs.google.com/document/d/${googleDoc[1]}/export?format=txt`)
    : url;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function linkedHtmlToText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

export async function fetchLinkedDocumentText(value: string): Promise<{
  text: string;
  fetchedUrl: string;
}> {
  const url = linkedDocumentFetchUrl(value);
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; BreadloafHill/1.0; +https://breadloafhill.com)",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Link fetch returned HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_LINK_BYTES) {
    throw new Error(`Linked content exceeds ${MAX_LINK_BYTES} bytes`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_LINK_BYTES) {
    throw new Error(`Linked content exceeds ${MAX_LINK_BYTES} bytes`);
  }
  const contentType = response.headers.get("content-type") || "";
  const raw = bytes.toString("utf8").replace(/^\uFEFF/, "");
  const text = (contentType.includes("html") ? linkedHtmlToText(raw) : raw)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_LINK_CHARS);
  if (!text) throw new Error("Linked document contains no readable text");
  return { text, fetchedUrl: url.toString() };
}

export async function analyzeLinkedDocumentText(input: {
  text: string;
  fileName: string;
  categories: CategoryOption[];
}): Promise<DocumentAnalysisOutcome> {
  try {
    const result = await categorizeText(input.text, input.fileName, input.categories);
    if (!result.summary.trim() && !result.extractedText.trim()) {
      return {
        state: "provider_error",
        error: "AI analysis returned no usable linked-document content.",
        result: null,
      };
    }
    return { state: "ok", error: null, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      state: "provider_error",
      error: message.replace(/\s+/g, " ").trim().slice(0, 500),
      result: null,
    };
  }
}
