import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export function byteRange(value: string | null, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size <= 0) throw new Error("Invalid range");
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || start > end) throw new Error("Invalid range");
  return { start, end };
}

export async function retainedFileResponse(request: Request, file: { filePath: string; fileName: string; fileType: string }, download = false) {
  if (!file.filePath.startsWith("/uploads/")) return NextResponse.json({ error: "Invalid retained file" }, { status: 404 });
  try {
    const root = await realpath(path.join(process.cwd(), "public", "uploads"));
    const resolved = await realpath(path.join(root, file.filePath.slice("/uploads/".length)));
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return NextResponse.json({ error: "Invalid retained file" }, { status: 404 });
    const bytes = await readFile(resolved);
    const headers = {
      "Content-Type": file.fileType || "application/octet-stream",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${file.fileName.replace(/["\r\n]/g, "")}"`,
      "Cache-Control": "private, max-age=3600", "Accept-Ranges": "bytes",
    };
    let range;
    try { range = byteRange(request.headers.get("range"), bytes.length); }
    catch { return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${bytes.length}` } }); }
    const body = range ? bytes.subarray(range.start, range.end + 1) : bytes;
    return new NextResponse(new Uint8Array(body), { status: range ? 206 : 200, headers: {
      ...headers, "Content-Length": String(body.length),
      ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${bytes.length}` } : {}),
    } });
  } catch {
    return NextResponse.json({ error: "Original file is unavailable. It may need to be uploaded again." }, { status: 404 });
  }
}
