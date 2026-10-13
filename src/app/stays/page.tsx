"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Baby, BedDouble, BedSingle, CalendarDays, Home, MapPin, Plus, RefreshCw, Tent, TreePine, Users } from "lucide-react";
import { Header } from "@/components/layout/header";
import { VisitCard } from "@/components/stays/visit-card";
import { VisitForm } from "@/components/stays/visit-form";
import { propertyToday, stayDateKey } from "@/lib/stay-dates";
import type { RoomWithStays, StayType } from "@/types";
import "../fieldguide-visits.css";

const roomIcons: Record<string, typeof Home> = { bedroom: BedDouble, annex: Home, loft: Home, cabin: TreePine, tent: Tent, offsite: MapPin };
const bedInfo: Record<string, string> = { "greg-craig": "Queen bed", "tom-craig": "Queen bed", "sandy-craig": "King bed", "jim-craig": "Queen bed", "wedge-room": "Twin beds", "upper-annex": "Twin beds", "lower-annex": "Twin beds", loft: "Twin beds", "woods-cabin": "Twin beds" };

export default function StaysPage() {
  const [rooms, setRooms] = useState<RoomWithStays[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);
  const [form, setForm] = useState<{ stay?: StayType; room?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const syncInProgress = useRef(false);

  const loadVisits = useCallback(async () => {
    try {
      const response = await fetch("/api/stays");
      const result = await response.json();
      if (!response.ok || !Array.isArray(result)) throw new Error("Visits could not be loaded");
      setRooms(result); setError(null);
    } catch { setError("We could not load the rooms and visits. Check your connection and try again."); }
    finally { setLoading(false); }
  }, []);

  const refreshCalendar = useCallback(async () => {
    if (syncInProgress.current) return;
    syncInProgress.current = true; setSyncing(true);
    try {
      const response = await fetch("/api/stays/sync", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error("Sync failed");
      setNotice(result.error || (result.pending ? `${result.pending} saved change${result.pending === 1 ? " is" : "s are"} waiting to reach Google Calendar. You can keep using the visits here.` : null));
      await loadVisits();
    } catch { setNotice("Saved visits remain available here. Google Calendar could not be refreshed; try again later."); }
    finally { syncInProgress.current = false; setSyncing(false); }
  }, [loadVisits]);

  useEffect(() => { void loadVisits().then(refreshCalendar); }, [loadVisits, refreshCalendar]);
  const today = propertyToday();
  const realRooms = rooms.filter((room) => room.id !== "unassigned");
  const unassigned = rooms.find((room) => room.id === "unassigned")?.stays.filter((stay) => stayDateKey(stay.checkOut) > today) || [];
  const upcomingCount = rooms.reduce((sum, room) => sum + room.stays.filter((stay) => stayDateKey(stay.checkOut) > today).length, 0);
  const capacity = realRooms.filter((room) => room.type !== "offsite").reduce((sum, room) => sum + room.maxCapacity, 0);

  async function removeVisit(stay: StayType) {
    if (deleting || !window.confirm(`Remove ${stay.guestName}’s visit?`)) return;
    setDeleting(stay.id); setError(null);
    try {
      const response = await fetch(`/api/stays/${stay.id}`, { method: "DELETE" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "Visit could not be removed");
      setRooms((previous) => previous.map((room) => ({ ...room, stays: room.stays.filter((visit) => visit.id !== stay.id) })));
      setNotice(result?.calendarSyncState === "synced" ? "Visit removed." : "Visit removed here. Its Google Calendar removal is saved and will retry.");
      await loadVisits();
    } catch { setError("We could not confirm the removal. The visit is still shown until the server confirms it."); }
    finally { setDeleting(null); }
  }

  function saved(stay: StayType & { alreadyExisted?: boolean }) {
    setForm(null);
    setNotice(stay.alreadyExisted ? "That visit is already on the calendar. Open it to edit its details."
      : stay.calendarSyncState === "synced" ? "Visit saved." : "Visit saved here. Google Calendar synchronization is waiting and will retry.");
    if (stay.roomId) setExpandedRoom(stay.roomId);
    void loadVisits();
  }

  return <div className="fg-visits">
    <Header title="Stays & Rooms" subtitle="Plan visits and pick your room" />
    <div className="fg-visits-content">
      {error && <div role="alert" className="fg-visit-form-error mb-3">{error} <button type="button" onClick={() => void loadVisits()} className="underline">Try again</button></div>}
      {notice && <p role="status" className="text-sm text-stone-600 mb-3">{notice}</p>}
      <div className="fg-room-overview mb-4"><div className="fg-room-overview-stat"><p>{realRooms.filter((room) => room.type !== "offsite" && room.type !== "tent").length}</p><p>Rooms</p></div><div className="fg-room-overview-stat"><p>{capacity}</p><p>Max guests</p></div><div className="fg-room-overview-stat"><p>{upcomingCount}</p><p>Current & upcoming</p></div></div>
      <div className="flex flex-wrap gap-2 mb-5"><button type="button" onClick={() => setForm({})} className="fg-visit-primary"><Plus size={16} />Add a stay</button><Link href="/calendar" className="fg-visit-secondary"><CalendarDays size={16} />See dates</Link><button type="button" onClick={() => void refreshCalendar()} disabled={syncing} className="fg-visit-secondary"><RefreshCw size={16} className={syncing ? "animate-spin" : ""} />{syncing ? "Syncing…" : "Refresh"}</button></div>
      {loading ? <p role="status" className="text-stone-500 py-8">Loading rooms…</p> : <>
        {unassigned.length > 0 && <section className="mb-6" aria-labelledby="unassigned-visits"><h2 id="unassigned-visits" className="section-head fg-room-section-head">Choose a room</h2><p className="text-sm text-stone-600 mb-3">These visits are on the calendar. Edit a visit to choose a room when the plans are ready.</p><div className="fg-upcoming-visits">{unassigned.map((stay) => <VisitCard key={stay.id} stay={stay} roomName="Room to be decided" onEdit={(visit) => setForm({ stay: visit })} onDelete={(visit) => void removeVisit(visit)} deleting={deleting === stay.id} />)}</div></section>}
        <section className="fg-room-directory" aria-labelledby="all-rooms"><h2 id="all-rooms" className="section-head fg-room-section-head">All rooms</h2><div className="fg-room-grid">
          {realRooms.map((room) => {
            const Icon = roomIcons[room.type] || Home;
            const upcoming = room.stays.filter((stay) => stayDateKey(stay.checkOut) > today);
            const past = room.stays.filter((stay) => stayDateKey(stay.checkOut) <= today);
            const expanded = room.id === expandedRoom;
            return <article key={room.id} className="fg-room-card">
              <button type="button" className="room fg-room-summary" onClick={() => setExpandedRoom(expanded ? null : room.id)} aria-expanded={expanded} aria-controls={`room-visits-${room.id}`}>
                <div className="fg-room-summary-content"><span className="fg-room-icon"><Icon size={20} /></span><div><h3 className="name">{room.name}</h3><div className="fg-room-details"><span className="flex gap-1 items-center"><Users size={12} />Sleeps {room.minCapacity === room.maxCapacity ? room.maxCapacity : `${room.minCapacity}–${room.maxCapacity}`}</span>{bedInfo[room.slug] && <span className="flex gap-1 items-center"><BedSingle size={12} />{bedInfo[room.slug]}</span>}{room.hasCrib && <span className="flex gap-1 items-center"><Baby size={12} />Crib</span>}</div>{room.description && <p className="text-xs text-stone-500 mt-2">{room.description}</p>}</div><span className="fg-room-upcoming">{upcoming.length ? `${upcoming.length} current/upcoming` : "No upcoming visits"}</span></div>
              </button>
              {expanded && <div id={`room-visits-${room.id}`} className="fg-room-stays space-y-3">
                {upcoming.map((stay) => <VisitCard key={stay.id} stay={stay} roomName={room.name} onEdit={(visit) => setForm({ stay: visit })} onDelete={(visit) => void removeVisit(visit)} deleting={deleting === stay.id} />)}
                {upcoming.length === 0 && <p className="text-sm text-stone-500">No current or upcoming visits assigned here.</p>}
                <button type="button" onClick={() => setForm({ room: room.id })} className="fg-visit-secondary"><Plus size={16} />Plan a stay here</button>
                {past.length > 0 && <details><summary className="text-sm text-stone-600 cursor-pointer">{past.length} past visit{past.length === 1 ? "" : "s"}</summary><div className="space-y-3 mt-3">{past.map((stay) => <VisitCard key={stay.id} stay={stay} roomName={room.name} onEdit={(visit) => setForm({ stay: visit })} onDelete={(visit) => void removeVisit(visit)} deleting={deleting === stay.id} />)}</div></details>}
              </div>}
            </article>;
          })}
        </div></section>
      </>}
    </div>
    {form && <VisitForm rooms={rooms} stay={form.stay} initialRoom={form.room} onClose={() => setForm(null)} onSaved={saved} />}
  </div>;
}
