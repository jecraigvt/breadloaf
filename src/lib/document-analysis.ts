import {
  categorizeDocument,
  categorizeText,
  processMediaFile,
  triageInlineDocument,
  triageTextDocument,
  type CategoryOption,
} from "@/lib/ai";
import type { IntakeDocumentType } from "@/lib/document-intake";
import { loadHistoricalPhotoRoster } from "@/lib/historical-photo";
import { extractTextFromFile, isExtractableType } from "@/lib/extract-text";
import { PdfSampleTooLargeError, samplePdfPages } from "@/lib/pdf-sampling";

export const AI_SIZE_LIMIT = 15 * 1024 * 1024;

export const ANALYSIS_STATES = [
  "pending",
  "ok",
  "unsupported_type",
  "too_large",
  "provider_error",
] as const;

export type AnalysisState = (typeof ANALYSIS_STATES)[number];
export type CategorizedDocument = Awaited<ReturnType<typeof categorizeDocument>>;

export interface DocumentAnalysisOutcome {
  state: AnalysisState;
  error: string | null;
  result: CategorizedDocument | null;
}

export interface StoredDocumentAnalysis {
  analysisState: AnalysisState;
  analysisError: string | null;
  aiSummary: string | null;
  aiExtractedText: string | null;
}

const HISTORICAL_UPLOAD_PLACEHOLDER =
  /^Document uploaded\s*[—-]\s*categorize manually or ask Bucky about it$/i;
const HISTORICAL_OVERSIZE_PLACEHOLDER =
  /^File too large for AI analysis\s*[—-]\s*categorize manually$/i;

function normalizedType(fileType: string): string {
  return fileType.split(";")[0].trim().toLowerCase();
}

function readableInlineType(fileType: string): boolean {
  // Historical classification must reflect the pipeline that wrote the row,
  // not today's expanded extractor support. Legacy .doc/.xls were unsupported
  // when the Phase 1 migration classified the existing archive.
  return (
    fileType.startsWith("audio/") ||
    fileType.startsWith("video/") ||
    fileType.startsWith("image/") ||
    fileType === "application/pdf" ||
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.oasis.opendocument.text",
      "application/vnd.oasis.opendocument.spreadsheet",
      "application/vnd.oasis.opendocument.presentation",
      "text/plain",
      "text/csv",
    ].includes(fileType)
  );
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 500) || "Unknown analysis error";
}

async function triageWithFallback(
  fileName: string,
  triage: () => Promise<{ documentType: IntakeDocumentType }>
): Promise<IntakeDocumentType> {
  try {
    return (await triage()).documentType;
  } catch (error) {
    // The deep pass is still useful without triage, and intake durability must
    // not become worse because a cheap routing call failed.
    console.warn(`[Archive] intake triage failed for ${fileName}; using generic deep pass`, error);
    return "other";
  }
}

export function isHistoricalAnalysisPlaceholder(value?: string | null): boolean {
  const text = value?.trim() || "";
  return (
    HISTORICAL_UPLOAD_PLACEHOLDER.test(text) ||
    HISTORICAL_OVERSIZE_PLACEHOLDER.test(text)
  );
}

export function isAnalysisState(value: unknown): value is AnalysisState {
  return typeof value === "string" && ANALYSIS_STATES.includes(value as AnalysisState);
}

export function meaningfulAnalysisContent(
  summary?: string | null,
  extractedText?: string | null
): string {
  const cleanSummary = isHistoricalAnalysisPlaceholder(summary) ? "" : summary?.trim() || "";
  const cleanText = extractedText?.trim() || "";
  return [cleanSummary, cleanText].filter(Boolean).join("\n\n");
}

export function normalizeStoredAnalysis(input: {
  analysisState?: unknown;
  analysisError?: unknown;
  aiSummary?: unknown;
  aiExtractedText?: unknown;
}): StoredDocumentAnalysis {
  const summary =
    typeof input.aiSummary === "string" &&
    input.aiSummary.trim() &&
    !isHistoricalAnalysisPlaceholder(input.aiSummary)
      ? input.aiSummary.trim()
      : null;
  const extractedText =
    typeof input.aiExtractedText === "string" && input.aiExtractedText.trim()
      ? input.aiExtractedText.trim()
      : null;
  const hasContent = Boolean(summary || extractedText);
  const requestedState = isAnalysisState(input.analysisState)
    ? input.analysisState
    : null;
  const analysisState =
    requestedState === "ok" && !hasContent
      ? "provider_error"
      : requestedState || (hasContent ? "ok" : "provider_error");

  if (analysisState === "ok") {
    return {
      analysisState,
      analysisError: null,
      aiSummary: summary,
      aiExtractedText: extractedText,
    };
  }

  if (analysisState === "pending") return { analysisState, analysisError: null, aiSummary: null, aiExtractedText: null };

  const analysisError =
    typeof input.analysisError === "string" && input.analysisError.trim()
      ? input.analysisError.replace(/\s+/g, " ").trim().slice(0, 500)
      : "Document analysis did not complete.";
  return {
    analysisState,
    analysisError,
    aiSummary: null,
    aiExtractedText: null,
  };
}

export function classifyHistoricalAnalysis(input: {
  fileType: string;
  fileSize: number;
  aiSummary?: string | null;
  aiExtractedText?: string | null;
}): { state: AnalysisState; error: string | null } {
  const type = normalizedType(input.fileType);
  const summary = input.aiSummary?.trim() || "";

  if (meaningfulAnalysisContent(input.aiSummary, input.aiExtractedText)) {
    return { state: "ok", error: null };
  }
  if (
    input.fileSize > AI_SIZE_LIMIT ||
    HISTORICAL_OVERSIZE_PLACEHOLDER.test(summary)
  ) {
    return {
      state: "too_large",
      error: "Historical intake skipped AI analysis because the file exceeded the 15 MB limit.",
    };
  }
  if (!readableInlineType(type) && type !== "link") {
    return {
      state: "unsupported_type",
      error: `Historical intake could not analyze unsupported file type: ${type || "unknown"}.`,
    };
  }
  return {
    state: "provider_error",
    error: "Historical intake did not record a successful analysis.",
  };
}

export async function analyzeDocumentBuffer(input: {
  buffer: Buffer;
  fileName: string;
  fileType: string;
  categories: CategoryOption[];
}): Promise<DocumentAnalysisOutcome> {
  const { buffer, fileName, categories } = input;
  const type = normalizedType(input.fileType);

  if (buffer.length > AI_SIZE_LIMIT && type !== "application/pdf") {
    return {
      state: "too_large",
      error: `File is ${(buffer.length / 1024 / 1024).toFixed(1)} MB; AI analysis is limited to 15 MB.`,
      result: null,
    };
  }

  try {
    let result: CategorizedDocument | null = null;
    if (type.startsWith("audio/") || type.startsWith("video/")) {
      result = await processMediaFile(buffer.toString("base64"), type, categories, fileName);
    } else if (type === "application/pdf" && buffer.length > AI_SIZE_LIMIT) {
      const sample = await samplePdfPages(buffer, AI_SIZE_LIMIT);
      const sampleBase64 = sample.buffer.toString("base64");
      const intakeType = await triageWithFallback(fileName, () =>
        triageInlineDocument(sampleBase64, type, fileName)
      );
      const historicalPhotoRoster =
        intakeType === "historical_photo"
          ? await loadHistoricalPhotoRoster()
          : undefined;
      result = await categorizeDocument(
        sampleBase64,
        type,
        categories,
        fileName,
        {
          intakeType,
          historicalPhotoRoster,
          pdfSample: {
            sourcePageCount: sample.sourcePageCount,
            sampledPageNumbers: sample.sampledPageNumbers,
          },
        }
      );
    } else if (type.startsWith("image/") || type === "application/pdf") {
      const base64 = buffer.toString("base64");
      const intakeType = await triageWithFallback(fileName, () =>
        triageInlineDocument(base64, type, fileName)
      );
      const historicalPhotoRoster =
        intakeType === "historical_photo"
          ? await loadHistoricalPhotoRoster()
          : undefined;
      result = await categorizeDocument(base64, type, categories, fileName, {
        intakeType,
        historicalPhotoRoster,
      });
    } else if (isExtractableType(type)) {
      const extracted = await extractTextFromFile(buffer, type);
      if (!extracted?.trim()) {
        return {
          state: "provider_error",
          error: `No readable text could be extracted from ${type}.`,
          result: null,
        };
      }
      const intakeType = await triageWithFallback(fileName, () =>
        triageTextDocument(extracted, fileName)
      );
      result = await categorizeText(extracted, fileName, categories, { intakeType });
    } else {
      return {
        state: "unsupported_type",
        error: `Unsupported file type: ${type || "unknown"}.`,
        result: null,
      };
    }

    if (!meaningfulAnalysisContent(result.summary, result.extractedText)) {
      return {
        state: "provider_error",
        error: "AI analysis returned no usable document content.",
        result: null,
      };
    }
    return { state: "ok", error: null, result };
  } catch (error) {
    if (error instanceof PdfSampleTooLargeError) {
      return { state: "too_large", error: cleanError(error), result: null };
    }
    return { state: "provider_error", error: cleanError(error), result: null };
  }
}
