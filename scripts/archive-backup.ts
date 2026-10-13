import "dotenv/config";
import { backupPassphrase, option } from "./archive-common";
import { createArchiveSnapshot } from "./archive-snapshot";

async function main() {
  const output = option("--output");
  const databaseUrl = process.env.DATABASE_URL;
  if (!output || !databaseUrl) throw new Error("Set DATABASE_URL and provide --output <independent-destination/file.blhbackup>.");
  const manifest = await createArchiveSnapshot({ output, databaseUrl, originals: option("--originals"), passphrase: backupPassphrase() });
  console.log(`Encrypted snapshot created and verified: ${manifest.files.length - 1} originals plus PostgreSQL dump. Destination independence and a restore drill still need operator verification.`);
}

void main().catch(error => { console.error(error instanceof Error ? error.message : "Archive snapshot failed."); process.exitCode = 1; });
