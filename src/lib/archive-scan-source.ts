import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, rm, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import sharp from "sharp";
import { archiveOriginalDrive, type ArchiveOriginalDrive, type ArchiveDriveObject } from "@/lib/archive-original-drive";
import { readArchiveOriginal } from "@/lib/archive-original-response";
import { BuckyJobError } from "@/lib/bucky-jobs";
import { privateStagingDirectory, removeStagingDirectory } from "../../scripts/archive-common";

const execNative = promisify(execFile);
const maxPagePixels = 48_000_000;
const maxRenderedBytes = 5 * 1024 ** 2;
export const MAX_ARCHIVE_SCAN_PAGES = 10_000;
const diskReserve = 64 * 1024 ** 2;
const cacheMillis = 30 * 60_000;

async function pdfTool(name: "pdfinfo" | "pdftotext" | "pdftoppm", args: string[]) {
  const program = process.env["ARCHIVE_" + name.toUpperCase() + "_PATH"] || name;
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"].includes(key.toUpperCase())));
  const limit = process.platform === "linux";
  try {
    const { stdout } = await execNative(limit ? "prlimit" : program, limit ? ["--as=805306368", "--", program, ...args] : args, {
      env: { ...environment, LANG: "C", NODE_ENV: process.env.NODE_ENV }, timeout: 90_000, killSignal: "SIGKILL", maxBuffer: 256_000, windowsHide: true,
    });
    return stdout;
  } catch {
    throw new BuckyJobError("A PDF page could not be opened within the archive reader's limits.", 422);
  }
}

interface StagedScan {
  key: string;
  directory: string;
  file: string;
  pageCount: number;
}

export class ArchiveScanReader {
  private tail: Promise<unknown> = Promise.resolve();
  private stage?: StagedScan;
  private timer?: NodeJS.Timeout;

  constructor(private readonly drive: ArchiveOriginalDrive = archiveOriginalDrive) {}

  private serial<T>(operation: () => Promise<T>) {
    const task = this.tail.then(async () => {
      if (this.timer) clearTimeout(this.timer);
      try { return await operation(); }
      finally {
        this.timer = setTimeout(() => { void this.close().catch(() => undefined); }, cacheMillis);
        this.timer.unref();
      }
    });
    this.tail = task.catch(() => undefined);
    return task;
  }

  async close() {
    await this.tail;
    if (this.timer) clearTimeout(this.timer);
    await this.discardStage();
  }

  private async discardStage() {
    const previous = this.stage;
    this.stage = undefined;
    if (previous) await removeStagingDirectory(previous.directory);
  }

  private async spool(original: ArchiveDriveObject) {
    const key = original.driveId + ":" + original.sha256;
    if (this.stage?.key === key) return this.stage;
    await this.discardStage();
    const size = Number(original.sizeBytes);
    const disk = await statfs(tmpdir());
    if (disk.bavail * disk.bsize < size + diskReserve) throw new BuckyJobError("There is not enough temporary disk space to read this scan.", 503);
    const directory = await privateStagingDirectory();
    try {
      const file = path.join(directory, "original");
      const response = await readArchiveOriginal(original, { drive: this.drive });
      if (!response.body || response.status !== 200) throw new BuckyJobError("Drive did not return the original scan.", 502);
      const hash = createHash("sha256");
      let received = 0;
      const verify = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length;
          if (received > size) { callback(new Error("Original is larger than expected")); return; }
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body as NodeWebStream<Uint8Array>), verify, createWriteStream(file, { flags: "wx", mode: 0o600 }));
      if (received !== size || hash.digest("hex") !== original.sha256) throw new BuckyJobError("The original does not match its archive checksum.", 409);
      const pageCount = original.fileType === "application/pdf"
        ? Number(/^Pages:\s+(\d+)/m.exec(await pdfTool("pdfinfo", [file]))?.[1])
        : (await sharp(file, { limitInputPixels: maxPagePixels, failOn: "error" }).metadata()).pages || 1;
      if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > MAX_ARCHIVE_SCAN_PAGES) {
        throw new BuckyJobError("The original is saved. Its page count is outside the limits of the reader.", 422);
      }
      this.stage = { key, directory, file, pageCount };
      return this.stage;
    } catch (error) {
      await removeStagingDirectory(directory);
      throw error;
    }
  }

  pageCount(original: ArchiveDriveObject) {
    return this.serial(async () => (await this.spool(original)).pageCount);
  }

  render(original: ArchiveDriveObject, number: number) {
    return this.serial(async (): Promise<{ text: string } | { imageBase64: string }> => {
      const stage = await this.spool(original);
      if (!Number.isInteger(number) || number < 1 || number > stage.pageCount) throw new BuckyJobError("Page is out of range.", 404);
      if (original.fileType === "application/pdf") {
        const page = String(number);
        const text = (await pdfTool("pdftotext", ["-f", page, "-l", page, "-layout", "-enc", "UTF-8", stage.file, "-"])).trim();
        if (text.replace(/\s/g, "").length >= 40 && text.length <= 24_000) return { text };
        const prefix = path.join(stage.directory, "page");
        const rendered = prefix + ".png";
        try {
          await pdfTool("pdftoppm", ["-f", page, "-l", page, "-scale-to", "2200", "-singlefile", "-png", stage.file, prefix]);
          const bytes = await readFile(rendered);
          if (bytes.length > maxRenderedBytes) {
            return { imageBase64: (await sharp(rendered).png({ palette: true }).toBuffer()).toString("base64") };
          }
          return { imageBase64: bytes.toString("base64") };
        } finally {
          await rm(rendered, { force: true });
        }
      }
      const jpeg = await sharp(stage.file, { page: number - 1, limitInputPixels: maxPagePixels, sequentialRead: true, failOn: "error" })
        .autoOrient().resize(2200, 2200, { fit: "inside", withoutEnlargement: true }).flatten({ background: "white" }).jpeg({ quality: 86 }).toBuffer();
      return { imageBase64: jpeg.toString("base64") };
    });
  }
}

export const archiveScanReader = new ArchiveScanReader();
