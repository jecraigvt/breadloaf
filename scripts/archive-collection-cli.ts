import "dotenv/config";
import path from "node:path";
import { backupPassphrase, option } from "./archive-common";
import { readArchiveCollection, saveArchiveCollection } from "./archive-collection";

async function main() {
  const [, , action] = process.argv;
  const repository = option("--repository");
  if (!repository || !path.isAbsolute(repository)) throw new Error("Set --repository to an absolute independent storage path.");
  const passphrase = backupPassphrase();
  if (action === "backup") {
    if (!process.env.DATABASE_URL) throw new Error("The source database connection is unavailable.");
    const result = await saveArchiveCollection({
      repository, passphrase, databaseUrl: process.env.DATABASE_URL,
      originals: option("--originals") || path.join(process.cwd(), "public", "uploads"),
    });
    console.log("Verified " + result.originals + " originals (" + result.copied + " newly copied) and the catalog database. Use --catalog " + result.catalog);
    return;
  }
  const catalog = option("--catalog");
  if (!catalog || (action !== "verify" && action !== "restore")) throw new Error("Use backup, verify --catalog, or restore --catalog --target.");
  const target = action === "restore" ? option("--target") : undefined;
  if (action === "restore" && !target) throw new Error("Restore requires a new --target directory.");
  const databaseUrl = process.argv.includes("--apply-db") && action === "restore" ? process.env.ARCHIVE_RESTORE_DATABASE_URL : undefined;
  if (process.argv.includes("--apply-db") && !databaseUrl) throw new Error("Set ARCHIVE_RESTORE_DATABASE_URL for the disposable restore drill.");
  const verified = await readArchiveCollection({ repository, catalog, passphrase, extractTo: target, databaseUrl });
  console.log("Verified " + (verified.files.length - 1) + " originals and the database dump." +
    (target ? " Originals and catalog were extracted." : "") + (databaseUrl ? " Test database restored." : ""));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : "Collection recovery could not complete.");
  process.exitCode = 1;
});
