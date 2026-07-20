import { createHash } from "crypto";

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function shortChecksum(checksum?: string | null): string | null {
  return checksum ? checksum.slice(0, 12) : null;
}
