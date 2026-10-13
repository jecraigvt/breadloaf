import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "@/lib/archive-integrity";
import { MAX_EMAIL_SOURCE_BYTES } from "@/lib/email-inbox";

const sourceRoot = () => path.join(process.cwd(), "public", "uploads", ".mail-room-source");

export async function retainEmailSource(source: Buffer, root = sourceRoot()): Promise<string> {
  if (source.length > MAX_EMAIL_SOURCE_BYTES) throw new Error("Email source is too large");
  const checksum = sha256(source);
  await mkdir(root, { recursive: true });
  try { await writeFile(path.join(root, `${checksum}.eml`), source, { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  return checksum;
}

export async function readEmailSource(checksum: string, root = sourceRoot()): Promise<Buffer> {
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error("Invalid retained email source");
  const realRoot = await realpath(root);
  const file = await realpath(path.join(realRoot, `${checksum}.eml`));
  if (path.dirname(file) !== realRoot) throw new Error("Invalid retained email source");
  const source = await readFile(file);
  if (source.length > MAX_EMAIL_SOURCE_BYTES || sha256(source) !== checksum) throw new Error("Retained email source failed integrity verification");
  return source;
}
