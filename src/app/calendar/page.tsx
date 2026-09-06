"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "@/components/layout/header";
import "../fieldguide-visits.css";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  Check,
  Clock,
  HelpCircle,
  CalendarDays,
  ExternalLink,
  Download,
  Share2,
  BedDouble,
  Trash2,
} from "lucide-react";
import { RoomWithStays, StayType } from "@/types";
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isToday,
  isBefore,
  startOfDay,
  differenceInDays,
  addDays,
} from "date-fns";

const statusColors: Record<string, string> = {
  confirmed: "bg-green-100 text-green-700 border-green-200",
  tentative: "bg-amber-100 text-amber-700 border-amber-200",
  requested: "bg-blue-100 text-blue-700 border-blue-200",
};

const statusDotColors: Record<string, string> = {
  confirmed: "bg-green-500",
  tentative: "bg-amber-500",
  requested: "bg-blue-500",
};

const statusIcons: Record<string, typeof Check> = {
  confirmed: Check,
  tentative: Clock,
  requested: HelpCircle,
};

interface StayWithRoom extends StayType {
  roomName: string;
  roomSlug: string;
  roomType: string;
}

function isStayActiveOnDay(
  stay: Pick<StayType, "checkIn" | "checkOut">,
  day: Date
): boolean {
  const checkIn = startOfDay(new Date(stay.checkIn));
  const checkOut = startOfDay(new Date(stay.checkOut));
  const currentDay = startOfDay(day);

  return currentDay >= checkIn && currentDay < checkOut;
}

export default function CalendarPage() {
  const [rooms, setRooms] = useState<RoomWithStays[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const visitDialogRef = useRef<HTMLDivElement>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [view, setView] = useState<"month" | "list">("month");
  const [feedToken, setFeedToken] = useState<string | null>(null);

  useEffect(() => {
    if (!showAddForm) return;
    setFormError(null);
    const dialog = visitDialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.querySelector<HTMLInputElement>("input")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowAddForm(false);
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'
      ));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [showAddForm]);

  // Form state
  const [guestName, setGuestName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("confirmed");

  const fetchRooms = useCallback(async (sync = false) => {
    try {
      const url = sync ? "/api/stays?sync=true" : "/api/stays";
      const res = await fetch(url);
      const data = await res.json();
      setRooms(data);
    } catch (err) {
      console.error("Failed to fetch rooms:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Sync from Google Calendar on first load
    fetchRooms(true);
  }, [fetchRooms]);

  useEffect(() => {
    fetch("/api/calendar/token")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { token?: string };
      })
      .then((data) => setFeedToken(data?.token || null))
      .catch(() => setFeedToken(null));
  }, []);

  // All stays flattened with room info
  const allStays: StayWithRoom[] = rooms.flatMap((room) =>
    room.stays.map((stay) => ({
      ...stay,
      roomName: room.name,
      roomSlug: room.slug,
      roomType: room.type,
    }))
  );

  const getStaysForDay = (day: Date) =>
    allStays.filter((stay) => isStayActiveOnDay(stay, day));

  const upcomingStays = allStays
    .filter((stay) => startOfDay(new Date(stay.checkOut)) > startOfDay(new Date()))
    .sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime());

  // Calendar grid
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDayOfWeek = monthStart.getDay();
  const paddedDays: (Date | null)[] = Array(startDayOfWeek).fill(null).concat(calendarDays);
  // Pad end to complete the last week
  const remaining = 7 - (paddedDays.length % 7);
  if (remaining < 7) {
    paddedDays.push(...Array(remaining).fill(null));
  }

  const handleAddStay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/stays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestName,
          roomId: roomId || null,
          checkIn,
          checkOut,
          notes,
          status,
        }),
      });
      if (res.ok) {
        setGuestName("");
        setRoomId("");
        setCheckIn("");
        setCheckOut("");
        setNotes("");
        setStatus("confirmed");
        setShowAddForm(false);
        fetchRooms();
      } else {
        const result = await res.json().catch(() => null);
        setFormError(result?.error || "We couldn’t save this visit. Please try again.");
      }
    } catch (err) {
      console.error("Failed to add stay:", err);
      setFormError("We couldn’t reach the site. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteStay = async (stayId: string) => {
    if (!confirm("Remove this stay?")) return;
    try {
      await fetch(`/api/stays/${stayId}`, { method: "DELETE" });
      fetchRooms();
      setSelectedDay(null);
    } catch (err) {
      console.error("Failed to delete stay:", err);
    }
  };

  const openAddFormForDay = (day: Date) => {
    setCheckIn(format(day, "yyyy-MM-dd"));
    setCheckOut(format(addDays(day, 3), "yyyy-MM-dd"));
    setShowAddForm(true);
  };

  const getGoogleCalendarUrl = (stay: StayWithRoom) => {
    const title = encodeURIComponent(`${stay.guestName} at Breadloaf Hill`);
    const details = encodeURIComponent(
      `Room: ${stay.roomName}\n${stay.notes || ""}`
    );
    const location = encodeURIComponent("Breadloaf Hill, Vermont");
    const startDate = format(new Date(stay.checkIn), "yyyyMMdd");
    const endDate = format(new Date(stay.checkOut), "yyyyMMdd");
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startDate}/${endDate}&details=${details}&location=${location}`;
  };

  const encodedFeedToken = feedToken ? encodeURIComponent(feedToken) : null;
  const calendarFeedPath = encodedFeedToken
    ? `/api/calendar?token=${encodedFeedToken}`
    : "/api/calendar";
  const downloadPath = encodedFeedToken
    ? `/api/calendar?token=${encodedFeedToken}&download=true`
    : "/api/calendar?download=true";
  const feedUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${calendarFeedPath}`
      : calendarFeedPath;

  const webcalUrl = feedUrl.replace("https://", "webcal://").replace("http://", "webcal://");
  const googleSubscribeUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`;
  const outlookSubscribeUrl = `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl)}&name=${encodeURIComponent("Breadloaf Hill Visits")}`;
  const secureFeedReady = Boolean(feedToken);

  if (loading) {
    return (
      <div className="fg-visits">
        <Header title="Calendar" subtitle="Family visits and events" />
        <div className="fg-visits-content fg-visits-loading">
          <div className="animate-pulse text-stone-400">Loading calendar...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fg-visits">
      <Header title="Calendar" subtitle="See who's coming to Breadloaf Hill" />

      <div className="fg-visits-content">
        {/* Top Bar: View Toggle + Actions */}
        <div className="fg-calendar-actions">
          <div className="fg-visit-view-toggle" role="group" aria-label="Calendar view">
            <button
              onClick={() => setView("month")}
              aria-pressed={view === "month"}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                view === "month"
                  ? "bg-white text-stone-800 shadow-sm"
                  : "text-stone-500 hover:text-stone-700"
              }`}
            >
              Month
            </button>
            <button
              onClick={() => setView("list")}
              aria-pressed={view === "list"}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                view === "list"
                  ? "bg-white text-stone-800 shadow-sm"
                  : "text-stone-500 hover:text-stone-700"
              }`}
            >
              Upcoming
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setShowShareMenu(!showShareMenu)}
                aria-expanded={showShareMenu}
                aria-controls="calendar-sharing"
                className="fg-visit-secondary"
              >
                <Share2 size={15} />
                Share
              </button>

              {showShareMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowShareMenu(false)} />
                  <div className="fg-calendar-share" id="calendar-sharing">
                    <div className="p-3 border-b border-stone-100">
                      <p className="text-sm font-medium text-stone-800">Add to Your Calendar</p>
                      <p className="text-xs text-stone-500 mt-0.5">
                        Private feed links for Apple, Google, and Outlook
                      </p>
                    </div>
                    <div className="p-2 space-y-1">
                      {secureFeedReady ? (
                        <>
                          <a
                            href={webcalUrl}
                            className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-stone-50 transition-colors"
                          >
                            <div className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center">
                              <CalendarDays size={16} className="text-stone-600" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-stone-800">
                                Apple Calendar
                              </p>
                              <p className="text-xs text-stone-400">iPhone, iPad, Mac</p>
                            </div>
                            <ExternalLink size={14} className="text-stone-300 ml-auto" />
                          </a>
                          <a
                            href={googleSubscribeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-stone-50 transition-colors"
                          >
                            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                              <CalendarDays size={16} className="text-blue-600" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-stone-800">
                                Google Calendar
                              </p>
                              <p className="text-xs text-stone-400">Gmail, Android</p>
                            </div>
                            <ExternalLink size={14} className="text-stone-300 ml-auto" />
                          </a>
                          <a
                            href={outlookSubscribeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-stone-50 transition-colors"
                          >
                            <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center">
                              <CalendarDays size={16} className="text-sky-600" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-stone-800">
                                Outlook
                              </p>
                              <p className="text-xs text-stone-400">Outlook.com, Microsoft 365</p>
                            </div>
                            <ExternalLink size={14} className="text-stone-300 ml-auto" />
                          </a>
                        </>
                      ) : (
                        <div className="px-3 py-2.5 text-xs text-stone-400">
                          Preparing secure calendar links...
                        </div>
                      )}
                      <div className="border-t border-stone-100 my-1" />
                      <a
                        href={downloadPath}
                        download="breadloaf-hill.ics"
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-stone-50 transition-colors"
                      >
                        <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                          <Download size={16} className="text-green-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-stone-800">
                            Download .ics file
                          </p>
                          <p className="text-xs text-stone-400">One-time import to any app</p>
                        </div>
                      </a>
                      <button
                        onClick={() => {
                          if (!secureFeedReady) return;
                          navigator.clipboard.writeText(feedUrl);
                          setShowShareMenu(false);
                        }}
                        disabled={!secureFeedReady}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-stone-50 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                          <Share2 size={16} className="text-purple-600" />
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-medium text-stone-800">
                            Copy feed URL
                          </p>
                          <p className="text-xs text-stone-400">Paste into any calendar app</p>
                        </div>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => setShowAddForm(true)}
              className="fg-visit-primary"
            >
              <Plus size={15} />
              Add Visit
            </button>
          </div>
        </div>

        <div className="fg-calendar-layout">
        {/* Month View */}
        {view === "month" && (
          <div className="fg-visit-panel fg-calendar-panel">
            {/* Month Header */}
            <div className="cal-months fg-panel-heading">
              <button
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                aria-label="Previous month"
                className="fg-visit-icon-button"
              >
                <ChevronLeft size={20} />
              </button>
              <div className="text-center">
                <h3 className="ym">
                  {format(currentMonth, "MMMM yyyy")}
                </h3>
                <button
                  onClick={() => setCurrentMonth(new Date())}
                  className="text-xs text-green-700 hover:text-green-800 font-medium"
                >
                  Today
                </button>
              </div>
              <button
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                aria-label="Next month"
                className="fg-visit-icon-button"
              >
                <ChevronRight size={20} />
              </button>
            </div>

            {/* Day Headers */}
            <div className="cal-dows">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div
                  key={d}
                  className="py-2.5 text-center text-xs font-semibold text-stone-400 uppercase tracking-wider"
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="cal-grid">
              {paddedDays.map((day, i) => {
                if (!day) {
                  return (
                    <div
                      key={`pad-${i}`}
                      className="cal-cell out fg-calendar-empty"
                    />
                  );
                }

                const dayStays = getStaysForDay(day);
                const today = isToday(day);
                const isSelected = selectedDay && format(day, "yyyy-MM-dd") === format(selectedDay, "yyyy-MM-dd");
                const isPast = isBefore(startOfDay(day), startOfDay(new Date()));

                return (
                  <button
                    key={day.toISOString()}
                    onClick={() => setSelectedDay(isSelected ? null : day)}
                    aria-label={`${format(day, "EEEE, MMMM d, yyyy")}, ${dayStays.length} visit${dayStays.length === 1 ? "" : "s"}`}
                    aria-pressed={Boolean(isSelected)}
                    aria-current={today ? "date" : undefined}
                    className={`cal-cell fg-calendar-day ${
                      isSelected
                        ? "bg-green-50 ring-2 ring-inset ring-green-300"
                        : today
                        ? "bg-amber-50/40"
                        : isPast
                        ? "bg-stone-50/30"
                        : "hover:bg-stone-50"
                    }`}
                  >
                    <span
                      className={`text-xs font-medium inline-flex items-center justify-center w-6 h-6 rounded-full ${
                        today
                          ? "bg-green-700 text-white"
                          : isPast
                          ? "text-stone-400"
                          : "text-stone-700"
                      }`}
                    >
                      {format(day, "d")}
                    </span>

                    <div className="mt-1 space-y-0.5">
                      {dayStays.slice(0, 3).map((stay) => (
                        <div
                          key={stay.id}
                          className="flex items-center gap-1"
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              statusDotColors[stay.status] || "bg-stone-400"
                            }`}
                          />
                          <span className="text-[10px] sm:text-[11px] leading-tight truncate text-stone-600">
                            {stay.guestName.split(" ")[0]}
                          </span>
                        </div>
                      ))}
                      {dayStays.length > 3 && (
                        <span className="text-[10px] text-stone-400 pl-2.5">
                          +{dayStays.length - 3} more
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="fg-calendar-legend">
              <div className="flex items-center gap-1.5 text-xs text-stone-500">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                Confirmed
              </div>
              <div className="flex items-center gap-1.5 text-xs text-stone-500">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                Tentative
              </div>
              <div className="flex items-center gap-1.5 text-xs text-stone-500">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                Requested
              </div>
            </div>
          </div>
        )}

        {/* Selected Day Detail */}
        {view === "month" && selectedDay && (
          <div className="fg-visit-panel fg-selected-day">
            <div className="cal-months fg-panel-heading">
              <h3 className="font-semibold text-stone-800">
                {format(selectedDay, "EEEE, MMMM d")}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openAddFormForDay(selectedDay)}
                  className="text-sm text-green-700 hover:text-green-800 font-medium flex items-center gap-1"
                >
                  <Plus size={14} />
                  Add visit
                </button>
                <button
                  onClick={() => setSelectedDay(null)}
                  aria-label="Close selected day"
                  className="p-1.5 hover:bg-stone-100 rounded-lg"
                >
                  <X size={16} className="text-stone-400" />
                </button>
              </div>
            </div>

            <div className="p-4">
              {getStaysForDay(selectedDay).length === 0 ? (
                <div className="text-center py-6">
                  <CalendarDays size={28} className="mx-auto text-stone-300 mb-2" />
                  <p className="text-sm text-stone-500">No one visiting this day</p>
                  <button
                    onClick={() => openAddFormForDay(selectedDay)}
                    className="text-sm text-green-700 font-medium mt-2 inline-flex items-center gap-1"
                  >
                    <Plus size={14} />
                    Plan a visit
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {getStaysForDay(selectedDay).map((stay) => {
                    const StatusIcon = statusIcons[stay.status] || Check;
                    const nights = differenceInDays(
                      new Date(stay.checkOut),
                      new Date(stay.checkIn)
                    );

                    return (
                      <div
                        key={stay.id}
                        className={`fg-day-visit ${statusColors[stay.status] || "border-stone-200"}`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <StatusIcon size={16} />
                              <h4 className="font-semibold">{stay.guestName}</h4>
                            </div>
                            <div className="mt-2 space-y-1 text-sm opacity-80">
                              <p>
                                {format(new Date(stay.checkIn), "MMM d")} — {format(new Date(stay.checkOut), "MMM d")}
                                {" "}({nights} night{nights !== 1 ? "s" : ""})
                              </p>
                              <p className="flex items-center gap-1">
                                <BedDouble size={13} />
                                {stay.roomName}
                              </p>
                              {stay.notes && <p>{stay.notes}</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <a
                              href={getGoogleCalendarUrl(stay)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 hover:bg-white/50 rounded-lg transition-colors"
                              title="Add to Google Calendar"
                            >
                              <ExternalLink size={14} />
                            </a>
                            <button
                              onClick={() => handleDeleteStay(stay.id)}
                              aria-label={`Remove ${stay.guestName}’s stay`}
                              className="p-1.5 hover:bg-white/50 rounded-lg transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {view === "month" && !selectedDay && (
          <aside className="fg-visit-panel fg-calendar-guide">
            <p className="fg-visit-eyebrow">Planning a visit</p>
            <h2>A place for everyone</h2>
            <p>Choose a day to see who’s visiting, or add your dates to the family calendar.</p>
            <a href="/stays" className="fg-visit-secondary"><BedDouble size={16} /> See rooms</a>
            <div className="fg-calendar-guide-photo" aria-hidden="true" />
          </aside>
        )}
        {/* List View: Upcoming Stays */}
        {view === "list" && (
          <div className="fg-upcoming-visits">
            {upcomingStays.length === 0 ? (
              <div className="fg-visit-panel fg-visit-empty">
                <CalendarDays size={36} className="mx-auto text-stone-300 mb-3" />
                <p className="text-stone-600 font-medium mb-1">No upcoming visits</p>
                <p className="text-sm text-stone-400 mb-4">
                  Plan the next trip to Breadloaf Hill
                </p>
                <button
                  onClick={() => setShowAddForm(true)}
                  className="fg-visit-primary"
                >
                  <Plus size={15} />
                  Add a Visit
                </button>
              </div>
            ) : (
              upcomingStays.map((stay) => {
                const StatusIcon = statusIcons[stay.status] || Check;
                const nights = differenceInDays(
                  new Date(stay.checkOut),
                  new Date(stay.checkIn)
                );
                const daysUntil = differenceInDays(
                  startOfDay(new Date(stay.checkIn)),
                  startOfDay(new Date())
                );

                return (
                  <div
                    key={stay.id}
                    className="fg-upcoming-visit"
                  >
                    <div className="stay fg-stay-row">
                      {/* Date block */}
                      <div className="mark fg-visit-date">
                        <p className="text-xs text-stone-400 uppercase font-medium">
                          {format(new Date(stay.checkIn), "MMM")}
                        </p>
                        <p className="day">
                          {format(new Date(stay.checkIn), "d")}
                        </p>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="fg-visit-name-status">
                          <h3 className="font-semibold text-stone-800">
                            {stay.guestName}
                          </h3>
                          <span
                            className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                              statusColors[stay.status] || "bg-stone-100 text-stone-600"
                            }`}
                          >
                            <StatusIcon size={10} />
                            {stay.status}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone-500">
                          <span>
                            {format(new Date(stay.checkIn), "MMM d")} — {format(new Date(stay.checkOut), "MMM d")}
                          </span>
                          <span>{nights} night{nights !== 1 ? "s" : ""}</span>
                          <span className="flex items-center gap-1">
                            <BedDouble size={13} />
                            {stay.roomName}
                          </span>
                        </div>
                        {stay.notes && (
                          <p className="text-sm text-stone-400 mt-1">{stay.notes}</p>
                        )}
                        {daysUntil >= 0 && (
                          <p className="text-xs text-green-700 font-medium mt-2">
                            {daysUntil === 0
                              ? "Arriving today!"
                              : daysUntil === 1
                              ? "Arriving tomorrow"
                              : `In ${daysUntil} days`}
                          </p>
                        )}
                      </div>

                      <div className="fg-stay-actions">
                        <a
                          href={getGoogleCalendarUrl(stay)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-stone-400 hover:text-blue-600 rounded-lg hover:bg-stone-50 transition-colors"
                          title="Add to Google Calendar"
                        >
                          <CalendarDays size={16} />
                        </a>
                        <button
                          onClick={() => handleDeleteStay(stay.id)}
                              aria-label={`Remove ${stay.guestName}’s stay`}
                          className="p-2 text-stone-400 hover:text-red-500 rounded-lg hover:bg-stone-50 transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
        </div>
      </div>

      {/* Add Stay Modal */}
      {showAddForm && (
        <div className="fg-visit-overlay">
          <div ref={visitDialogRef} className="fg-visit-dialog" role="dialog" aria-modal="true" aria-labelledby="calendar-form-title">
            <div className="cal-months fg-panel-heading">
              <h3 id="calendar-form-title">Plan a Visit</h3>
              <button
                onClick={() => setShowAddForm(false)}
                  aria-label="Close visit form"
                className="p-2 hover:bg-stone-100 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddStay} className="fg-visit-form">
              <div>
                <label htmlFor="calendar-guest" className="block text-sm font-medium text-stone-700 mb-1">
                  Who&apos;s coming?
                </label>
                <input
                  type="text"
                  id="calendar-guest"
                  autoComplete="name"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  className="w-full border border-stone-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="Name or family"
                  required
                />
              </div>

              <div className="fg-visit-date-fields">
                <div>
                  <label htmlFor="calendar-check-in" className="block text-sm font-medium text-stone-700 mb-1">
                  Arriving
                </label>
                  <input
                    type="date"
                    id="calendar-check-in"
                    value={checkIn}
                    onChange={(e) => setCheckIn(e.target.value)}
                    className="w-full border border-stone-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="calendar-check-out" className="block text-sm font-medium text-stone-700 mb-1">
                  Leaving
                </label>
                  <input
                    type="date"
                    id="calendar-check-out"
                    value={checkOut}
                    onChange={(e) => setCheckOut(e.target.value)}
                    className="w-full border border-stone-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="calendar-room" className="block text-sm font-medium text-stone-700 mb-1">
                  Room preference
                </label>
                <select
                  id="calendar-room"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  className="w-full border border-stone-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                >
                  <option value="">Decide later</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name} (sleeps {room.maxCapacity})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1.5">
                  Status
                </label>
                <div className="fg-visit-status-options" role="group" aria-label="Status">
                  {[
                    { value: "confirmed", label: "Confirmed", icon: Check },
                    { value: "tentative", label: "Maybe", icon: Clock },
                    { value: "requested", label: "Requested", icon: HelpCircle },
                  ].map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setStatus(opt.value)}
                          aria-pressed={status === opt.value}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                          status === opt.value
                            ? statusColors[opt.value] + " border-current"
                            : "border-stone-200 text-stone-400 hover:border-stone-300"
                        }`}
                      >
                        <Icon size={14} />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label htmlFor="calendar-notes" className="block text-sm font-medium text-stone-700 mb-1">
                  Notes
                </label>
                <textarea
                  id="calendar-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full border border-stone-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none resize-none"
                  rows={2}
                  placeholder="Arriving late, bringing kids, dietary needs..."
                />
              </div>

              {formError && <p className="fg-visit-form-error" role="alert">{formError}</p>}

              <button
                type="submit"
                disabled={saving}
                aria-busy={saving}
                className="fg-visit-primary fg-visit-submit"
              >
                {saving ? "Saving…" : "Add Visit"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
