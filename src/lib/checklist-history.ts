import { Prisma, type PrismaClient } from "@prisma/client";

/** Snapshot and reset commit together; a failed archive never clears completion. */
export async function archiveChecklistAndReset(db: Pick<PrismaClient, "$transaction">, list: string, archivedBy: string | null) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        const items = await tx.checklistItem.findMany({ where: { list }, orderBy: [{ section: "asc" }, { sortOrder: "asc" }, { name: "asc" }] });
        const run = await tx.checklistRun.create({ data: { list, archivedBy, items: JSON.parse(JSON.stringify(items)) as Prisma.InputJsonValue } });
        await tx.checklistItem.updateMany({ where: { list }, data: { checked: false, checkedBy: null, checkedAt: null } });
        return run;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2034" || attempt >= 2) throw error;
    }
  }
}
