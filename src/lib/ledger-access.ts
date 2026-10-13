import { isPrivilegedActor, type AccessContext } from "@/lib/access-policy";

interface ScopedLedgerEntry {
  actionType: string; entityType: string | null; entityId: string | null; sourceType: string | null; sourceId: string | null;
  beforeState?: unknown; afterState?: unknown;
}

export function ledgerDocumentIds(entry: ScopedLedgerEntry): string[] {
  const ids: string[] = [];
  if (entry.entityType === "document" && entry.entityId) ids.push(entry.entityId);
  if (entry.sourceType === "document" && entry.sourceId) ids.push(entry.sourceId);
  for (const value of [entry.beforeState, entry.afterState]) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const snapshot = value as Record<string, unknown>;
      if (typeof snapshot.documentId === "string") ids.push(snapshot.documentId);
      if (snapshot.entityType === "document" && typeof snapshot.entityId === "string") ids.push(snapshot.entityId);
    }
  }
  return Array.from(new Set(ids));
}

export function ledgerRoleVisible(entry: ScopedLedgerEntry, access: AccessContext): boolean {
  if (entry.entityType === "email") return access.actor?.verified === true && access.actor.isCurator;
  if (entry.entityType === "corporate_account" || entry.entityType === "vault_configuration") return isPrivilegedActor(access.actor) && access.vaultUnlocked;
  return true;
}
