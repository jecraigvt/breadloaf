import mammoth from "mammoth";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import WordExtractor from "word-extractor";
import * as XLSX from "xlsx";
import {
  DOC_TYPE,
  DOCX_TYPE,
  XLS_TYPE,
  XLSX_TYPE,
  ODF_TYPES,
  isExtractableMimeType,
  normalizeMimeType,
} from "@/lib/document-file-types";

// Server-side text extraction for document types the AI cannot read inline.
// Returns null for malformed or genuinely empty files. Unsupported types are
// refused before persistence by document-file-types.ts.

const MAX_CHARS = 20000;
const MAX_ROWS_PER_SHEET = 300;

const ODF_TYPE_SET = new Set<string>(ODF_TYPES);

export function isExtractableType(fileType: string): boolean {
  return isExtractableMimeType(fileType);
}

export async function extractTextFromFile(
  buffer: Buffer,
  fileType: string,
  options: { maxChars?: number; maxRowsPerSheet?: number } = {}
): Promise<string | null> {
  const type = normalizeMimeType(fileType);
  const maxChars = options.maxChars ?? MAX_CHARS;
  const maxRows = options.maxRowsPerSheet ?? MAX_ROWS_PER_SHEET;
  try {
    if (type === "text/plain" || type === "text/csv") {
      return normalizeExtractedText(buffer.toString("utf-8"), maxChars);
    }

    if (type === DOC_TYPE) {
      const extractor = new WordExtractor();
      const document = await extractor.extract(buffer);
      return normalizeExtractedText([
        document.getBody(),
        document.getHeaders({ includeFooters: false }),
        document.getFooters(),
        document.getFootnotes(),
        document.getEndnotes(),
        document.getAnnotations(),
        document.getTextboxes(),
      ].filter(Boolean).join("\n"), maxChars);
    }

    if (type === DOCX_TYPE) {
      const result = await mammoth.extractRawText({ buffer });
      return normalizeExtractedText(result.value, maxChars);
    }

    if (type === XLS_TYPE) {
      return extractLegacySpreadsheetText(buffer, maxChars, maxRows);
    }

    if (type === XLSX_TYPE) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      const parts: string[] = [];
      workbook.eachSheet((sheet) => {
        parts.push(`=== Sheet: ${sheet.name} ===`);
        let rowCount = 0;
        sheet.eachRow((row) => {
          if (rowCount >= maxRows) return;
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
      return normalizeExtractedText(parts.join("\n"), maxChars);
    }

    if (ODF_TYPE_SET.has(type)) {
      return await extractOdfText(buffer, maxChars);
    }

    return null;
  } catch (err) {
    console.error("Text extraction failed:", err);
    return null;
  }
}

function normalizeExtractedText(value: string, maxChars = MAX_CHARS): string | null {
  const text = value.replace(/\u0000/g, "").trim();
  return text ? text.slice(0, maxChars) : null;
}

function extractLegacySpreadsheetText(buffer: Buffer, maxChars = MAX_CHARS, maxRows = MAX_ROWS_PER_SHEET): string | null {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    parts.push(`=== Sheet: ${sheetName} ===`);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });
    for (const row of rows.slice(0, maxRows)) {
      const cells = Array.isArray(row) ? row.map((value) => formatCell(value)).join("\t") : "";
      if (cells.trim()) parts.push(cells);
    }
  }
  return normalizeExtractedText(parts.join("\n"), maxChars);
}

// OpenDocument files are zips containing content.xml. Convert structural
// tags to whitespace, strip the rest, decode basic entities.
async function extractOdfText(buffer: Buffer, maxChars = MAX_CHARS): Promise<string | null> {
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
  return normalizeExtractedText(text, maxChars);
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
