export function archiveVerificationStalenessMessage(
  documentsAddedAfterMeasurement: number
): string | null {
  if (documentsAddedAfterMeasurement <= 0) return null;
  return `Measured before ${documentsAddedAfterMeasurement} document${
    documentsAddedAfterMeasurement === 1 ? " was" : "s were"
  } added.`;
}
