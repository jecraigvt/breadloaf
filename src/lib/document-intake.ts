export const INTAKE_DOCUMENT_TYPES = [
  "receipt_invoice",
  "corporate_record",
  "historical_photo",
  "property_condition_photo",
  "voice_memo",
  "manual_guide",
  "other",
] as const;

export type IntakeDocumentType = (typeof INTAKE_DOCUMENT_TYPES)[number];

export interface TypeSpecificAnalysisFields {
  intakeType?: IntakeDocumentType;
  receiptSubtotal?: number | null;
  receiptSalesTax?: number | null;
  receiptTotal?: number | null;
  historicalPhotoCandidateIds?: string[];
  historicalPhotoEra?: string | null;
  historicalPhotoSetting?: string | null;
}

export function intakeDeepPassGuidance(type: IntakeDocumentType): string {
  switch (type) {
    case "receipt_invoice":
      return `RECEIPT / INVOICE DEEP PASS:
- Extract the vendor, transaction or invoice date, every purchased item or service, subtotal, discounts, sales tax, fees, and final total.
- Preserve order, invoice, check, and payment reference numbers when legible, redacting account numbers to their last four digits.
- Put subtotal, sales tax, and total into their dedicated numeric fields. Never infer an amount that is not legible.
- Make extractedText a compact factual record suitable for exact retrieval, not a generic description of a photographed receipt.`;
    case "corporate_record":
      return `CORPORATE RECORD DEEP PASS:
- Extract the record type, corporation name, meeting or effective date, attendees/signers, motions, votes, appointments, deadlines, dollar amounts, obligations, and operative clauses.
- Preserve exact section names and succession, ownership, and governance language when present.`;
    case "historical_photo":
      return `HISTORICAL PHOTO DEEP PASS:
- Describe visible people, approximate era, setting, clothing, objects, buildings, landscape, handwritten notes, captions, and photo condition.
- Distinguish observed facts from tentative identifications. Make extractedText specific enough to retrieve this photo without relying on its filename.`;
    case "property_condition_photo":
      return `PROPERTY-CONDITION PHOTO DEEP PASS:
- Identify the structure, room, system, or component shown; its likely location; observed condition; damage or deterioration; safety concerns; and useful follow-up.
- Describe only visible evidence. Do not claim a diagnosis that the image cannot support.`;
    case "voice_memo":
      return `VOICE MEMO DEEP PASS:
- Preserve every distinct fact, name, date, amount, location, decision, task, warning, and open question from the transcript.
- Organize the summary by topic when several subjects are discussed; do not compress away item-level detail.`;
    case "manual_guide":
      return `MANUAL / GUIDE DEEP PASS:
- Extract equipment names, manufacturer/model identifiers, prerequisites, step-by-step procedures, settings, maintenance intervals, warnings, troubleshooting cues, and contact information.
- Preserve the sequence and exact values needed to follow the instructions safely.`;
    case "other":
      return "";
  }
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function applyTypeSpecificExtraction<
  T extends TypeSpecificAnalysisFields & {
    extractedText: string;
    maintenanceVendor?: string | null;
    maintenanceDate?: string | null;
  },
>(result: T, intakeType: IntakeDocumentType): T & { intakeType: IntakeDocumentType } {
  if (intakeType !== "receipt_invoice") return { ...result, intakeType };

  const receiptLines = [
    result.maintenanceVendor ? `Vendor: ${result.maintenanceVendor}` : null,
    result.maintenanceDate ? `Purchase date: ${result.maintenanceDate}` : null,
    result.receiptSubtotal != null ? `Subtotal: ${money(result.receiptSubtotal)}` : null,
    result.receiptSalesTax != null ? `Sales tax: ${money(result.receiptSalesTax)}` : null,
    result.receiptTotal != null ? `Total: ${money(result.receiptTotal)}` : null,
  ].filter((line): line is string => Boolean(line));

  if (receiptLines.length === 0) return { ...result, intakeType };
  return {
    ...result,
    intakeType,
    extractedText: [result.extractedText.trim(), "Receipt facts:", ...receiptLines]
      .filter(Boolean)
      .join("\n"),
  };
}
