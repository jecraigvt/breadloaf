import path from "path";

const MAX_TITLE_LENGTH = 100;
const MAX_TITLE_WORDS = 12;

const GENERIC_TITLE = /^(?:untitled(?: document)?|document|file|attachment|scan(?:ned document)?|image|photo|screenshot|screen shot|audio(?: recording)?|voice memo|recording|video(?: recording)?)(?:[\s_-]*\d+)?$/i;
const CAMERA_FILE = /^(?:img|dsc|pxl|mvimg|scan|screenshot|voice memo|audio recording|recording|video)[\s_-]*[a-z0-9_-]*$/i;
const GENERATED_ID = /^(?:[0-9a-f]{8}-[0-9a-f-]{27,}|c[a-z0-9]{20,}|\d{8}(?:[\s_-]?\d{6})?)$/i;

export interface DocumentTitleInput {
  suggestedTitle?: string | null;
  fileName?: string | null;
  summary?: string | null;
  extractedText?: string | null;
  fileType?: string | null;
  createdAt?: Date | string | null;
}

function collapseWhitespace(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

function trimToWords(value: string, limit = MAX_TITLE_WORDS): string {
  const words = value.split(/\s+/).filter(Boolean);
  const trimmed = words.length > limit ? words.slice(0, limit).join(" ") : words.join(" ");
  if (trimmed.length <= MAX_TITLE_LENGTH) return trimmed;

  const clipped = trimmed.slice(0, MAX_TITLE_LENGTH + 1);
  return clipped.slice(0, Math.max(clipped.lastIndexOf(" "), 1)).trim();
}

function cleanTitle(value?: string | null): string {
  if (!value) return "";
  return trimToWords(
    collapseWhitespace(value)
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\.(?:pdf|docx?|xlsx?|csv|txt|rtf|pptx?|jpe?g|png|webp|heic|m4a|mp3|wav|ogg|mp4|mov)$/i, "")
      .replace(/[.!?,;:]+$/g, "")
  );
}

function comparable(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function stemFor(fileName?: string | null): string {
  return fileName ? path.parse(fileName).name : "";
}

function looksMachineGenerated(value: string): boolean {
  const cleaned = collapseWhitespace(value);
  return (
    GENERIC_TITLE.test(cleaned) ||
    CAMERA_FILE.test(cleaned) ||
    GENERATED_ID.test(cleaned) ||
    /^https?:\/\//i.test(cleaned)
  );
}

export function needsDocumentRetitle(title: string, fileName?: string | null): boolean {
  const cleaned = cleanTitle(title);
  if (!cleaned || looksMachineGenerated(cleaned)) return true;

  if (fileName && path.extname(fileName)) {
    return comparable(title) === comparable(fileName);
  }

  const stem = stemFor(fileName);
  return Boolean(stem && comparable(cleaned) === comparable(stem) && looksMachineGenerated(stem));
}

function titleFromNarrative(value?: string | null): string {
  if (!value) return "";
  const firstSentence = collapseWhitespace(value)
    .split(/(?<=[.!?])\s+/)[0]
    .replace(/^(?:this|the)\s+(?:document|file|image|photo|recording|audio|video|email)\s+(?:is|contains|shows|describes|details|documents|summarizes|covers|provides)\s+/i, "")
    .replace(/^(?:it|this)\s+(?:shows|describes|details|documents|summarizes|covers|provides)\s+/i, "")
    .replace(/^(?:a|an|the)\s+(?=[A-Za-z])/i, "");
  const processingMessage =
    /\b(?:categorize manually|ask Bucky|AI analysis|AI categorization|could not (?:be )?(?:read|analy[sz]ed)|unable to analy[sz]e)\b/i;

  if (
    !firstSentence ||
    firstSentence.startsWith("{") ||
    firstSentence.startsWith("[") ||
    firstSentence.includes("``` ") ||
    processingMessage.test(firstSentence) ||
    firstSentence.split(/\s+/).length < 3
  ) {
    return "";
  }

  const title = cleanTitle(firstSentence);
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : "";
}

function titleFromExtractedText(value?: string | null): string {
  if (!value) return "";
  const ignored = /^(?:from|to|cc|date|subject|page|account(?: number)?|invoice(?: number)?|statement date)\s*:/i;
  const lines = value
    .split(/\r?\n/)
    .map(collapseWhitespace)
    .filter((line) => {
      const words = line.split(/\s+/).filter(Boolean);
      return words.length >= 3 && words.length <= MAX_TITLE_WORDS && !ignored.test(line) && !looksMachineGenerated(line);
    });

  return cleanTitle(lines[0]);
}

function humanizeFileName(fileName?: string | null): string {
  const rawStem = stemFor(fileName);
  if (!rawStem || looksMachineGenerated(rawStem)) return "";

  const stem = rawStem
    .replace(/[_-]+/g, " ")
    .replace(/\s+\(?(?:copy|final|scan)\)?\s*$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2");

  const words = collapseWhitespace(stem).split(" ");
  return cleanTitle(
    words
      .map((word, index) => {
        if (/^\d/.test(word) || /^[A-Z0-9]{2,6}$/.test(word)) return word;
        if (index > 0 && /^(?:a|an|and|at|by|for|in|of|on|the|to)$/i.test(word)) {
          return word.toLowerCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(" ")
  );
}

function fallbackLabel(fileType?: string | null): string {
  if (fileType?.startsWith("audio/")) return "Voice Memo";
  if (fileType?.startsWith("video/")) return "Video Recording";
  if (fileType?.startsWith("image/")) return "Archived Photo";
  if (fileType?.includes("spreadsheet") || fileType === "text/csv") return "Archived Spreadsheet";
  if (fileType?.includes("presentation")) return "Archived Presentation";
  if (fileType === "application/pdf") return "Archived PDF";
  return "Archived Document";
}

function dateSuffix(createdAt?: Date | string | null): string {
  if (!createdAt) return "Pending Title";
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "Pending Title";
  return date.toISOString().slice(0, 10);
}

export function resolveDocumentTitle(input: DocumentTitleInput): string {
  const proposed = cleanTitle(input.suggestedTitle);
  if (proposed && !needsDocumentRetitle(input.suggestedTitle || proposed, input.fileName)) {
    return proposed;
  }

  const narrativeTitle = titleFromNarrative(input.summary);
  if (narrativeTitle && !looksMachineGenerated(narrativeTitle)) return narrativeTitle;

  const extractedTitle = titleFromExtractedText(input.extractedText);
  if (extractedTitle && !looksMachineGenerated(extractedTitle)) return extractedTitle;

  const fileTitle = humanizeFileName(input.fileName);
  if (fileTitle) return fileTitle;

  return `${fallbackLabel(input.fileType)} (${dateSuffix(input.createdAt)})`;
}
