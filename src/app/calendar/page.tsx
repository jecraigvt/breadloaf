"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { addMonths, eachDayOfInterval, endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { BedDouble, CalendarDays, ChevronLeft, ChevronRight, Download, Plus, RefreshCw, Share2, X } from "lucide-react";
import { Header } from "@/components/layout/header";
import { VisitCard } from "@/components/stays/visit-card";
import { VisitForm } from "@/components/stays/visit-form";
import { localCalendarDay, propertyToday, stayActiveOnDay, stayDateKey } from "@/lib/stay-dates";
import type { RoomWithStays, StayType } from "@/types";
import "../fieldguide-visits.css";

export default function CalendarPage() {
  const [rooms, setRooms] = useState<RoomWithStays[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(() => new Date(`${propertyToday()}T12:00:00`));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [view, setView] = useState<"month" | "list">("month");
  const [showPast, setShowPast] = useState(false);
  const [form, setForm] = useState<{ stay?: StayType; date?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [feedToken, setFeedToken] = useState<string | null>(null);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const syncInProgress = useRef(false);

  const loadVisits = useCallback(async () => {
    try {
      const response = await fetch("/api/stays");
      const result = await response.json();
      if (!response.ok || !Array.isArray(result)) throw new Error("Visits could not be loaded");
      setRooms(result); setError(null);
    } catch { setError("We could not load the visits. Check your connection and try again."); }
    finally { setLoading(false); }
  }, []);

  const refreshCalendar = useCallback(async () => {
    if (syncInProgress.current) return;
    syncInProgress.current = true; setSyncing(true);
    try {
      const response = await fetch("/api/stays/sync", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error("Sync failed");
      if (result.error) setNotice(result.error);
      else if (result.pending) setNotice(`${result.pending} saved change${result.pending === 1 ? " is" : "s are"} waiting to reach Google Calendar. You can keep using the visits here.`);
      else setNotice(null);
      await loadVisits();
    } catch { setNotice("Saved visits remain available here. Google Calendar could not be refreshed; try again later."); }
    finally { syncInProgress.current = false; setSyncing(false); }
  }, [loadVisits]);

  useEffect(() => { void loadVisits().then(refreshCalendar); }, [loadVisits, refreshCalendar]);
  useEffect(() => {
    fetch("/api/calendar/token").then(async (response) => response.ok ? response.json() : null)
      .then((result) => setFeedToken(result?.token || null)).catch(() => {});
  }, []);

  const today = propertyToday();
  const allStays = rooms.flatMap((room) => room.stays.map((stay) => ({ stay, roomName: room.name })))
    .sort((a, b) => stayDateKey(a.stay.checkIn).localeCompare(stayDateKey(b.stay.checkIn)));
  const selectedStays = selectedDay ? allStays.filter(({ stay }) => stayActiveOnDay(stay, selectedDay)) : [];
  const listedStays = allStays.filter(({ stay }) => showPast || stayDateKey(stay.checkOut) > today);
  const monthStart = startOfMonth(currentMonth);
  const days: (Date | null)[] = Array(monthStart.getDay()).fill(null).concat(eachDayOfInterval({ start: monthStart, end: endOfMonth(currentMonth) }));
  if (days.length % 7) days.push(...Array(7 - days.length % 7).fill(null));
  const feedPath = feedToken ? `/api/calendar?token=${encodeURIComponent(feedToken)}` : "/api/calendar";
  const feedUrl = typeof window !== "undefined" ? `${window.location.origin}${feedPath}` : "";

  async function removeVisit(stay: StayType) {
    if (deleting || !window.confirm(`Remove ${stay.guestName}’s visit?`)) return;
    setDeleting(stay.id); setError(null);
    try {
      const response = await fetch(`/api/stays/${stay.id}`, { method: "DELETE" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "Could not remove visit");
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
    void loadVisits();
  }

  return <div className="fg-visits">
    <Header title="Calendar" subtitle="See who’s coming to Breadloaf Hill" />
    <div className="fg-visits-content">
      {error && <div role="alert" className="fg-visit-form-error mb-3">{error} <button type="button" onClick={() => void loadVisits()} className="underline">Try again</button></div>}
      {notice && <p role="status" className="text-sm text-stone-600 mb-3">{notice}</p>}
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <button type="button" onClick={() => setView("month")} aria-pressed={view === "month"} className="fg-visit-secondary">Month</button>
        <button type="button" onClick={() => setView("list")} aria-pressed={view === "list"} className="fg-visit-secondary">Visits</button>
        <button type="button" onClick={() => setForm({})} className="fg-visit-primary"><Plus size={16} />Add visit</button>
        <button type="button" onClick={() => void refreshCalendar()} disabled={syncing} className="fg-visit-secondary" aria-label="Refresh Google Calendar"><RefreshCw size={16} className={syncing ? "animate-spin" : ""} />{syncing ? "Syncing…" : "Refresh"}</button>
        <button type="button" onClick={() => setShowShareMenu(!showShareMenu)} aria-expanded={showShareMenu} className="fg-visit-secondary"><Share2 size={16} />Subscribe</button>
      </div>
      {showShareMenu && <section className="fg-visit-panel p-4 mb-4" aria-label="Calendar subscription">
        <h2 className="font-semibold mb-2">Keep visits in your calendar</h2>
        <p className="text-sm text-stone-600 mb-3">Subscribe for automatic updates, or download a snapshot. A subscription link gives access to visit dates and names; share it only with the family.</p>
        {feedToken && <div className="flex flex-wrap gap-3 mb-3"><a className="fg-visit-secondary" href={feedUrl.replace(/^https?:/, "webcal:")}><CalendarDays size={16} />Subscribe</a><a className="fg-visit-secondary" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedUrl.replace(/^https?:/, "webcal:"))}`} target="_blank" rel="noopener noreferrer">Google Calendar</a></div>}
        {feedToken && <label className="block text-sm mb-3">Subscription link<input type="text" readOnly value={feedUrl} onFocus={(event) => event.currentTarget.select()} className="block w-full border border-stone-300 rounded-lg p-2 text-xs mt-1" /></label>}
        {feedToken && <button type="button" className="fg-visit-secondary mr-2" onClick={async () => {
          try { await navigator.clipboard.writeText(feedUrl); setNotice("Calendar subscription link copied."); }
          catch { setNotice("Select the subscription link above to copy it."); }
        }}>Copy link</button>}
        <a href={`${feedPath}${feedToken ? "&" : "?"}download=true`} className="fg-visit-secondary"><Download size={16} />Download .ics</a>
      </section>}
      {loading ? <p className="text-stone-500 py-8" role="status">Loading visits…</p> : view === "month" ? <div className="fg-room-layout">
        <section className="fg-visit-panel fg-calendar-panel" aria-label="Visit calendar">
          <div className="cal-months fg-panel-heading"><button type="button" onClick={() => { setCurrentMonth(subMonths(currentMonth, 1)); setSelectedDay(null); }} aria-label="Previous month" className="fg-visit-icon-button"><ChevronLeft size={18} /></button><h2 className="ym">{format(currentMonth, "MMMM yyyy")}</h2><button type="button" onClick={() => { setCurrentMonth(addMonths(currentMonth, 1)); setSelectedDay(null); }} aria-label="Next month" className="fg-visit-icon-button"><ChevronRight size={18} /></button></div>
          <div className="cal-dows">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="py-1">{day}</div>)}</div>
          <div className="cal-grid">{days.map((day, index) => {
            if (!day) return <div key={`pad-${index}`} className="cal-cell out fg-calendar-empty" />;
            const visits = allStays.filter(({ stay }) => stayActiveOnDay(stay, day));
            const key = localCalendarDay(day), selected = selectedDay && key === localCalendarDay(selectedDay);
            return <button key={key} type="button" onClick={() => setSelectedDay(day)} aria-label={`${format(day, "EEEE, MMMM d, yyyy")}, ${visits.length} visits`} aria-pressed={Boolean(selected)} aria-current={key === today ? "date" : undefined}
              className={`cal-cell fg-calendar-day ${selected ? "bg-green-50 ring-2 ring-inset ring-green-300" : key === today ? "bg-amber-50" : key < today ? "bg-stone-50" : "hover:bg-stone-50"}`}>
              <span className={`text-xs inline-flex w-6 h-6 items-center justify-center rounded-full ${key === today ? "bg-green-700 text-white" : "text-stone-600"}`}>{format(day, "d")}</span>
              <div className="mt-1 space-y-0.5">{visits.slice(0, 3).map(({ stay }) => <div key={stay.id} className="flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${stay.status === "confirmed" ? "bg-green-500" : stay.status === "tentative" ? "bg-amber-500" : "bg-blue-500"}`} /><span className="text-[11px] truncate text-stone-600">{stay.guestName}</span></div>)}{visits.length > 3 && <span className="text-[10px] text-stone-500">+{visits.length - 3} more</span>}</div>
            </button>;
          })}</div>
          <p className="text-xs text-stone-500 p-3">Green: confirmed · Amber: maybe · Blue: requested. Departure days are free for the next visit.</p>
        </section>
        {selectedDay ? <section className="fg-visit-panel fg-selected-day">
          <div className="cal-months fg-panel-heading"><h2>{format(selectedDay, "EEEE, MMMM d")}</h2><button type="button" onClick={() => setSelectedDay(null)} aria-label="Close selected day"><X size={18} /></button></div>
          <div className="p-4 space-y-3">{selectedStays.length === 0 && <p className="text-sm text-stone-500">No one visiting this day.</p>}{selectedStays.map(({ stay, roomName }) => <VisitCard key={stay.id} stay={stay} roomName={roomName} onEdit={(visit) => setForm({ stay: visit })} onDelete={(visit) => void removeVisit(visit)} deleting={deleting === stay.id} />)}<button type="button" onClick={() => setForm({ date: localCalendarDay(selectedDay) })} className="fg-visit-primary"><Plus size={16} />Add visit</button></div>
        </section> : <aside className="fg-visit-panel fg-calendar-guide"><p className="fg-visit-eyebrow">Planning a visit</p><h2>A place for everyone</h2><p>Choose a day to see who’s coming. Edit a visit to change its dates or choose a room.</p><Link href="/stays" className="fg-visit-secondary"><BedDouble size={16} />See rooms</Link><div className="fg-calendar-guide-photo" aria-hidden="true" /></aside>}
      </div> : <section className="fg-upcoming-visits" aria-label="Visits">
        <label className="flex gap-2 text-sm text-stone-600 mb-4"><input type="checkbox" checked={showPast} onChange={(event) => setShowPast(event.target.checked)} />Include past visits</label>
        {listedStays.length === 0 ? <div className="fg-visit-panel fg-visit-empty"><CalendarDays size={32} className="mx-auto text-stone-400 mb-2" /><p>No upcoming visits.</p><button type="button" onClick={() => setForm({})} className="fg-visit-primary mt-3">Plan a visit</button></div> : listedStays.map(({ stay, roomName }) => <VisitCard key={stay.id} stay={stay} roomName={roomName} onEdit={(visit) => setForm({ stay: visit })} onDelete={(visit) => void removeVisit(visit)} deleting={deleting === stay.id} />)}
      </section>}
    </div>
    {form && <VisitForm rooms={rooms} stay={form.stay} initialDate={form.date} onClose={() => setForm(null)} onSaved={saved} />}
  </div>;
}
