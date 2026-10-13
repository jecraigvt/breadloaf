"use client";

import { format } from "date-fns";
import { BedDouble, CalendarDays, Pencil, Trash2 } from "lucide-react";
import type { StayType } from "@/types";
import { daysUntilStay, stayDisplayDate, stayNights } from "@/lib/stay-dates";
import { googleVisitTemplate } from "@/lib/stay-calendar-links";

export function VisitCard({ stay, roomName, onEdit, onDelete, deleting = false }: {
  stay: StayType; roomName: string; onEdit(stay: StayType): void; onDelete(stay: StayType): void; deleting?: boolean;
}) {
  const nights = stayNights(stay.checkIn, stay.checkOut);
  const daysUntil = daysUntilStay(stay.checkIn);
  return <article className="fg-upcoming-visit">
    <div className="stay fg-stay-row">
      <div className="mark fg-visit-date"><p className="text-xs text-stone-400 uppercase">{format(stayDisplayDate(stay.checkIn), "MMM")}</p><p className="day">{format(stayDisplayDate(stay.checkIn), "d")}</p></div>
      <div className="flex-1 min-w-0">
        <div className="fg-visit-name-status"><h3 className="font-semibold text-stone-800">{stay.guestName}</h3><span className={`text-xs px-2 py-0.5 rounded-full ${stay.status === "confirmed" ? "bg-green-100 text-green-700" : stay.status === "tentative" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>{stay.status === "tentative" ? "Maybe" : stay.status === "requested" ? "Requested" : "Confirmed"}</span></div>
        <p className="text-sm text-stone-500">{format(stayDisplayDate(stay.checkIn), "MMM d, yyyy")}–{format(stayDisplayDate(stay.checkOut), "MMM d, yyyy")} · {nights} night{nights === 1 ? "" : "s"}</p>
        <p className="text-sm text-stone-500 flex items-center gap-1"><BedDouble size={13} />{roomName}</p>
        {stay.notes && <p className="text-sm text-stone-500 whitespace-pre-wrap mt-1">{stay.notes}</p>}
        {daysUntil === 0 && <p className="text-xs text-green-700 mt-1">Arriving today</p>}
        {stay.calendarSyncState && stay.calendarSyncState !== "synced" && <p className="text-xs text-amber-700 mt-1">Saved here · Google Calendar sync waiting</p>}
      </div>
      <div className="fg-stay-actions">
        <button type="button" onClick={() => onEdit(stay)} disabled={deleting} className="p-2 text-stone-500 hover:text-green-700 rounded-lg" aria-label={`Edit ${stay.guestName}’s visit`} title="Edit dates or room"><Pencil size={16} /></button>
        <a href={googleVisitTemplate(stay, roomName)} target="_blank" rel="noopener noreferrer" className="p-2 text-stone-500 hover:text-blue-700 rounded-lg" aria-label={`Add ${stay.guestName}’s visit to your Google Calendar`} title="Add to your Google Calendar"><CalendarDays size={16} /></a>
        <button type="button" onClick={() => onDelete(stay)} disabled={deleting} className="p-2 text-stone-500 hover:text-red-600 rounded-lg" aria-label={`Remove ${stay.guestName}’s visit`}><Trash2 size={16} /></button>
      </div>
    </div>
  </article>;
}
