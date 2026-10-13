"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { RoomWithStays, StayType } from "@/types";
import { stayDateKey } from "@/lib/stay-dates";
import type { StayConflict } from "@/lib/stay-input";

export function VisitForm({ rooms, stay, initialDate, initialRoom, onClose, onSaved }: {
  rooms: RoomWithStays[]; stay?: StayType | null; initialDate?: string; initialRoom?: string;
  onClose(): void; onSaved(stay: StayType): void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const [guestName, setGuestName] = useState(stay?.guestName || "");
  const [roomId, setRoomId] = useState(stay?.roomId || initialRoom || "");
  const [checkIn, setCheckIn] = useState(stay ? stayDateKey(stay.checkIn) : initialDate || "");
  const [checkOut, setCheckOut] = useState(stay ? stayDateKey(stay.checkOut) : "");
  const [notes, setNotes] = useState(stay?.notes || "");
  const [status, setStatus] = useState(stay?.status || "confirmed");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<StayConflict[]>([]);
  const [allowRoomOverlap, setAllowRoomOverlap] = useState(false);

  useEffect(() => {
    setAllowRoomOverlap(false);
    setConflicts([]);
    setError(null);
  }, [roomId, checkIn, checkOut]);

  useEffect(() => {
    const container = dialog.current;
    if (!container) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    container.querySelector<HTMLInputElement>("input")?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", trapFocus);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(stay ? `/api/stays/${stay.id}` : "/api/stays", {
        method: stay ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestName, roomId: roomId || null, checkIn, checkOut, notes, status,
          allowRoomOverlap, ...(stay ? { expectedRevision: stay.calendarSyncRevision } : {}) }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setError(result?.error || "We could not save this visit. Try again.");
        if (response.status === 409 && Array.isArray(result?.conflicts)) setConflicts(result.conflicts);
        return;
      }
      if (!result?.id) throw new Error("No saved visit returned");
      onSaved(result);
    } catch { setError("We could not confirm the save. Check your connection and try again; identical visits will not be added twice."); }
    finally { setSaving(false); }
  }

  const fieldClass = "w-full border border-stone-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 outline-none";
  return <div className="fg-visit-overlay">
    <div ref={dialog} className="fg-visit-dialog" role="dialog" aria-modal="true" aria-labelledby="visit-form-title"
      onKeyDown={(event) => { if (event.key === "Escape" && !saving) { event.preventDefault(); onClose(); } }}>
      <div className="cal-months fg-panel-heading"><h3 id="visit-form-title">{stay ? "Edit this visit" : "Plan a visit"}</h3>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Close visit form" className="p-2"><X size={18} /></button>
      </div>
      <form onSubmit={submit} className="fg-visit-form">
        <div><label htmlFor="visit-guest" className="block text-sm font-medium mb-1">Who’s coming?</label>
          <input id="visit-guest" value={guestName} onChange={(event) => setGuestName(event.target.value)} autoComplete="name" maxLength={200} required className={fieldClass} placeholder="Name or family" /></div>
        <div className="fg-visit-date-fields">
          <div><label htmlFor="visit-arrival" className="block text-sm font-medium mb-1">Arriving</label><input id="visit-arrival" type="date" value={checkIn} onChange={(event) => setCheckIn(event.target.value)} required className={fieldClass} /></div>
          <div><label htmlFor="visit-departure" className="block text-sm font-medium mb-1">Leaving</label><input id="visit-departure" type="date" value={checkOut} onChange={(event) => setCheckOut(event.target.value)} min={checkIn || undefined} required className={fieldClass} /></div>
        </div>
        <div><label htmlFor="visit-room" className="block text-sm font-medium mb-1">Room</label><select id="visit-room" value={roomId} onChange={(event) => setRoomId(event.target.value)} className={fieldClass}>
          <option value="">Decide later</option>{rooms.filter((room) => room.id !== "unassigned").map((room) => <option key={room.id} value={room.id}>{room.name} (sleeps {room.maxCapacity})</option>)}
        </select></div>
        <div><label htmlFor="visit-status" className="block text-sm font-medium mb-1">Plans</label><select id="visit-status" value={status} onChange={(event) => setStatus(event.target.value)} className={fieldClass}>
          <option value="confirmed">Confirmed</option><option value="tentative">Maybe</option><option value="requested">Requested</option>
        </select></div>
        <div><label htmlFor="visit-notes" className="block text-sm font-medium mb-1">Notes</label><textarea id="visit-notes" rows={2} maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} className={fieldClass} placeholder="Arrival time, guests, anything the family should know" /></div>
        {error && <p role="alert" className="fg-visit-form-error">{error}</p>}
        {conflicts.length > 0 && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <ul className="space-y-1">{conflicts.map((conflict) => <li key={conflict.id}>{conflict.guestName}: {conflict.checkIn}–{conflict.checkOut} ({conflict.status})</li>)}</ul>
          <label className="flex items-start gap-2 mt-3"><input type="checkbox" checked={allowRoomOverlap} onChange={(event) => setAllowRoomOverlap(event.target.checked)} className="mt-1" />I checked these plans with the family. We will share this room.</label>
        </div>}
        <button type="submit" disabled={saving || (conflicts.length > 0 && !allowRoomOverlap)} aria-busy={saving} className="fg-visit-primary fg-visit-submit">{saving ? "Saving…" : stay ? "Save changes" : "Add visit"}</button>
      </form>
    </div>
  </div>;
}
