import { NextRequest, NextResponse } from "next/server";
import { getCurrentActor } from "@/lib/actor";
import { assertDocumentAccess, requestAccessContext, accessPolicyResponse } from "@/lib/access-policy";
import { fileDocumentFromBuffer } from "@/lib/file-document";
import { STORED_FILE_SIZE_LIMIT } from "@/lib/file-storage";
import { saveUploadedFile } from "@/lib/upload";

export async function POST(request: NextRequest) {
  try {
    const access = await requestAccessContext(request);
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (formData.get("archive") === "true") {
      assertDocumentAccess("family", access);
      if (file.size > STORED_FILE_SIZE_LIMIT) {
        return NextResponse.json({ error: "File too large (max 100MB)" }, { status: 413 });
      }
      const actor = await getCurrentActor(request);
      const document = await fileDocumentFromBuffer({
        buffer: Buffer.from(await file.arrayBuffer()),
        fileName: file.name,
        contentType: file.type,
        uploadedBy: actor?.fullName || "Family member",
      });
      return NextResponse.json({ id: document.id });
    }

    const result = await saveUploadedFile(file);

    return NextResponse.json(result);
  } catch (error) {
    const denied = accessPolicyResponse(error);
    if (denied) return denied;
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
