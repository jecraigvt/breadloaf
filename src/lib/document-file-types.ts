export const DOC_TYPE = "application/msword";
export const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLS_TYPE = "application/vnd.ms-excel";
export const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const ODF_TYPES = [
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
] as const;

export const FILE_DROPZONE_ACCEPT: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
  "application/pdf": [".pdf"],
  [DOC_TYPE]: [".doc"],
  [DOCX_TYPE]: [".docx"],
  [XLS_TYPE]: [".xls"],
  [XLSX_TYPE]: [".xlsx"],
  "application/vnd.oasis.opendocument.text": [".odt"],
  "application/vnd.oasis.opendocument.spreadsheet": [".ods"],
  "application/vnd.oasis.opendocument.presentation": [".odp"],
  "text/plain": [".txt"],
  "text/csv": [".csv"],
  "audio/mpeg": [".mp3"],
  "audio/wav": [".wav"],
  "audio/mp4": [".m4a"],
  "audio/x-m4a": [".m4a"],
  "video/mp4": [".mp4"],
  "video/quicktime": [".mov"],
  "video/webm": [".webm"],
};

const ADDITIONAL_SERVER_TYPES = [
  "audio/mp3",
  "audio/x-wav",
  "audio/m4a",
  "audio/ogg",
  "audio/webm",
  "video/x-msvideo",
] as const;

export const SUPPORTED_UPLOAD_TYPES = new Set([
  ...Object.keys(FILE_DROPZONE_ACCEPT),
  ...ADDITIONAL_SERVER_TYPES,
]);

const EXTRACTABLE_TYPES = new Set([
  DOC_TYPE,
  DOCX_TYPE,
  XLS_TYPE,
  XLSX_TYPE,
  ...ODF_TYPES,
  "text/plain",
  "text/csv",
]);

const EXTENSION_TYPE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(FILE_DROPZONE_ACCEPT).flatMap(([type, extensions]) =>
    extensions.map((extension) => [extension.slice(1).toLowerCase(), type])
  )
);
Object.assign(EXTENSION_TYPE_MAP, {
  avi: "video/x-msvideo",
  ogg: "audio/ogg",
});

export function normalizeMimeType(fileType: string): string {
  return fileType.split(";")[0].trim().toLowerCase();
}

export function isExtractableMimeType(fileType: string): boolean {
  return EXTRACTABLE_TYPES.has(normalizeMimeType(fileType));
}

export function isInlineAnalyzableMimeType(fileType: string): boolean {
  const type = normalizeMimeType(fileType);
  return (
    type.startsWith("image/") ||
    type.startsWith("audio/") ||
    type.startsWith("video/") ||
    type === "application/pdf"
  );
}

export function isAnalyzableMimeType(fileType: string): boolean {
  return isInlineAnalyzableMimeType(fileType) || isExtractableMimeType(fileType);
}

export function resolveSupportedFileType(
  declaredType: string,
  fileName: string
): string | null {
  const declared = normalizeMimeType(declaredType);
  if (SUPPORTED_UPLOAD_TYPES.has(declared) && isAnalyzableMimeType(declared)) {
    return declared;
  }

  if (!declared || declared === "application/octet-stream") {
    const extension = fileName.split(".").pop()?.toLowerCase() || "";
    const inferred = EXTENSION_TYPE_MAP[extension];
    return inferred && isAnalyzableMimeType(inferred) ? inferred : null;
  }

  return null;
}
