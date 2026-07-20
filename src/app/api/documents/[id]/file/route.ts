import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";

// Stream a document's file from the uploads volume. Next.js only
// guarantees serving public/ assets present at BUILD time, so runtime
// uploads need this route. Also keeps file access behind the PIN.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc || doc.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (doc.fileType === "link") {
    return NextResponse.redirect(doc.filePath);
  }

  try {
    const fullPath = path.join(process.cwd(), "public", doc.filePath);
    const buffer = await readFile(fullPath);
    const download = request.nextUrl.searchParams.get("download") === "1";
    const safeName = (doc.fileName || "document").replace(/["\r\n]/g, "");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": doc.fileType || "application/octet-stream",
        "Content-Length": String(buffer.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "File missing — it may predate the July 2026 storage fix and need re-uploading" },
      { status: 404 }
    );
  }
}
