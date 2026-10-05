import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-static";

// Serve the authored guide as its own document, outside the family hub layout.
export async function GET() {
  const html = await readFile(
    join(process.cwd(), "public", "smoothproof", "index.html"),
    "utf8"
  );

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
