import mammoth from "mammoth";
import ExcelJS from "exceljs";
import JSZip from "jszip";

// Server-side text extraction for document types Gemini can't read inline.
// Returns null for unsupported types (legacy .doc/.ppt) so callers can fall
// back to manual categorization.

const MAX_CHARS = 20000;
const MAX_ROWS_PER_SHEET = 300;

const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// OpenDocument (LibreOffice/OpenOffice): text, spreadsheet, presentation
const ODF_TYPES = new Set([
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
]);

export function isExtractableType(fileType: string): boolean {
  return (
    fileType === DOCX_TYPE ||
    fileType === XLSX_TYPE ||
    ODF_TYPES.has(fileType) ||
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

    if (ODF_TYPES.has(fileType)) {
      return await extractOdfText(buffer);
    }

    return null;
  } catch (err) {
    console.error("Text extraction failed:", err);
    return null;
  }
}

// OpenDocument files are zips containing content.xml. Convert structural
// tags to whitespace, strip the rest, decode basic entities.
async function extractOdfText(buffer: Buffer): Promise<string | null> {
  const zip = await JSZip.loadAsync(buffer);
  const contentXml = await zip.file("content.xml")?.async("string");
  if (!contentXml) return null;
  const text = contentXml
    .replace(/<text:tab[^>]*\/>/g, "\t")
    .replace(/<text:line-break[^>]*\/>/g, "\n")
    .replace(/<\/text:(p|h)>/g, "\n")
    .replace(/<\/table:table-cell>/g, "\t")
    .replace(/<\/table:table-row>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.slice(0, MAX_CHARS) || null;
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
