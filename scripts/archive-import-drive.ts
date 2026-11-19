import "dotenv/config";
import { archiveOriginalDrive } from "../src/lib/archive-original-drive";
import { option } from "./archive-common";

void archiveOriginalDrive.setupFolder(option("--viewer")).then(result => {
  console.log(JSON.stringify(result));
}).catch(error => {
  console.error(error instanceof Error ? error.message : "The private scan folder could not be prepared.");
  process.exitCode = 1;
});
