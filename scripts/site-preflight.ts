import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const [database] = await db.$queryRaw<Array<{ timezone: string; version: string }>>`SELECT current_setting('TimeZone') AS timezone, current_setting('server_version') AS version`;
  const extensions = await db.$queryRaw<Array<{ extname: string; extversion: string }>>`SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'`;
  const transport = await db.$queryRaw<Array<{ ssl: boolean; version: string | null; cipher: string | null }>>`SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid()`;
  const members = await db.$queryRaw<Array<{ id: string; isCurator: boolean; canClaim: boolean; isMinor: boolean; deceased: boolean; hasEmail: boolean }>>`SELECT "id", "isCurator", "canClaim", "isMinor", "deceased", ("email" IS NOT NULL AND btrim("email") <> '') AS "hasEmail" FROM "FamilyMember" WHERE lower("name") = 'jeremy craig'`;
  const migrations = await db.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 2`;
  console.log(JSON.stringify({ database, transport, vector: extensions, caretaker: members, latestMigrations: migrations }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Preflight failed"); process.exitCode = 1; }).finally(() => db.$disconnect());
