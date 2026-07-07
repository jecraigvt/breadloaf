import mammoth from "mammoth";
import ExcelJS from "exceljs";

// Server-side text extraction for document types Gemini can't read inline.
// Returns null for unsupported types (legacy .doc/.ppt) so callers can fall
// back to manual categorization.

const MAX_CHARS = 20000;
const MAX_ROWS_PER_SHEET = 300;

const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function isExtractableType(fileType: string): boolean {
  return (
    fileType === DOCX_TYPE ||
    fileType === XLSX_TYPE ||
    fileType === "text/plain" ||
    fileType === "text/csv"
  );
}

export async function extractTextFromFile(
  buffer: Buffer,
  fileType: string
): Promise<string | null> {
  try {
    if (fileType === "text/plain" || fileType === "text/csv") {
      return buffer.toString("utf-8").slice(0, MAX_CHARS);
    }

    if (fileType === DOCX_TYPE) {
      const result = await mammoth.extractRawText({ buffer });
      return result.value.slice(0, MAX_CHARS);
    }

    if (fileType === XLSX_TYPE) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      const parts: string[] = [];
      workbook.eachSheet((sheet) => {
        parts.push(`=== Sheet: ${sheet.name} ===`);
        let rowCount = 0;
        sheet.eachRow((row) => {
          if (rowCount >= MAX_ROWS_PER_SHEET) return;
          rowCount++;
          const cells = Array.isArray(row.values)
            ? row.values
                .slice(1) // ExcelJS row.values is 1-indexed
                .map((v) => formatCell(v))
                .join("\t")
            : "";
          if (cells.trim()) parts.push(cells);
        });
      });
      return parts.join("\n").slice(0, MAX_CHARS);
    }

    return null;
  } catch (err) {
    console.error("Text extraction failed:", err);
    return null;
  }
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    // ExcelJS rich values: formulas {result}, rich text {richText}, hyperlinks {text}
    const v = value as Record<string, unknown>;
    if ("result" in v) return formatCell(v.result);
    if ("text" in v) return String(v.text);
    if ("richText" in v && Array.isArray(v.richText)) {
      return (v.richText as { text: string }[]).map((r) => r.text).join("");
    }
    return "";
  }
  return String(value);
}
