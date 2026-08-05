import { meaningfulAnalysisContent } from "@/lib/document-analysis";

export interface GoldenDocumentHealth {
  analysisState: string;
  aiSummary: string | null;
  aiExtractedText: string | null;
}

export function isGoldenDocumentReady(document: GoldenDocumentHealth): boolean {
  return (
    document.analysisState === "ok" &&
    Boolean(meaningfulAnalysisContent(document.aiSummary, document.aiExtractedText))
  );
}

export function describeGoldenDocumentFailure(document: GoldenDocumentHealth): string {
  if (document.analysisState !== "ok") {
    return `analysisState is ${document.analysisState}`;
  }
  return "analysisState is ok but no meaningful analysis text exists";
}
