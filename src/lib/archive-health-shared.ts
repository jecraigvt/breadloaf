export function archiveVerificationStalenessMessage(
  documentsAddedAfterMeasurement: number
): string | null {
  if (documentsAddedAfterMeasurement <= 0) return null;
  return `Measured before ${documentsAddedAfterMeasurement} document${
    documentsAddedAfterMeasurement === 1 ? " was" : "s were"
  } added.`;
}
export function archiveAnalysisIssueMessage(state: string, error?: string | null): string {
  if (state === "pending") return "Analysis is queued or in progress. The original is saved.";
  if (/no readable text|contains no readable text/i.test(error || "")) {
    return "No readable text was found in the saved file. Upload a copy with content if this should contain text.";
  }
  if (state === "too_large") return "The original is saved, but it exceeds the standard analysis limit. Try background analysis.";
  if (state === "unsupported_type") return "The original is saved, but this format could not be read. Upload a PDF or supported document.";
  return "Analysis did not complete. The original is saved and can be retried.";
}
