import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { retainedFileResponse } from "@/lib/retained-file-response";

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

  return retainedFileResponse(request, doc, request.nextUrl.searchParams.get("download") === "1");
}
