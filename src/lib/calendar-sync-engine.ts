import { createHash } from "node:crypto";

export interface CalendarSyncStay {
  id: string; guestName: string; checkIn: Date; checkOut: Date; notes: string | null;
  roomId: string | null; room?: { name: string } | null; status: string;
  googleEventId: string | null; deletedAt: Date | null;
  calendarSyncRevision: number; calendarSyncState: string;
}

export interface CalendarSyncStore {
  claim(id: string, now: Date, leaseUntil: Date): Promise<CalendarSyncStay | null>;
  rememberEventId(id: string, eventId: string, leaseUntil: Date): Promise<void>;
  settle(id: string, revision: number, leaseUntil: Date, error: string | null): Promise<boolean>;
  release(id: string, leaseUntil: Date): Promise<void>;
}

export interface CalendarSyncProvider {
  upsert(stay: CalendarSyncStay, eventId: string, isNew: boolean): Promise<void>;
  remove(eventId: string): Promise<void>;
}

export function stableCalendarEventId(stayId: string): string {
  // Google accepts base32hex characters; hexadecimal fits that alphabet.
  return `breadloaf${createHash("sha256").update(stayId).digest("hex")}`;
}

/** Durable desired state wins over stale pull results; a revision gates settlement. */
export async function syncCalendarStay(
  store: CalendarSyncStore, provider: CalendarSyncProvider, id: string, now = new Date(),
): Promise<{ attempted: boolean; synced: boolean; error: string | null }> {
  const leaseUntil = new Date(now.getTime() + 120000);
  const stay = await store.claim(id, now, leaseUntil);
  if (!stay) return { attempted: false, synced: false, error: null };
  let error: string | null = null;
  try {
    if (stay.deletedAt) {
      if (stay.googleEventId) await provider.remove(stay.googleEventId);
    } else {
      const eventId = stay.googleEventId || stableCalendarEventId(stay.id);
      // Persist the deterministic link before insert. A crash or a concurrent
      // delete can still retry or remove the very same external event.
      await store.rememberEventId(stay.id, eventId, leaseUntil);
      await provider.upsert(stay, eventId, !stay.googleEventId);
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message.replace(/\s+/g, " ").slice(0, 400) : "Google Calendar could not be reached";
  }
  try {
    const settled = await store.settle(stay.id, stay.calendarSyncRevision, leaseUntil, error);
    return { attempted: true, synced: settled && !error, error };
  } finally {
    await store.release(stay.id, leaseUntil);
  }
}
