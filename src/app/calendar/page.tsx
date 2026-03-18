"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/layout/header";
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
  isWithinInterval,
  isBefore,
  isAfter,
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

export default function CalendarPage() {
  const [rooms, setRooms] = useState<RoomWithStays[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [view, setView] = useState<"month" | "list">("month");

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
    allStays.filter((stay) => {
      const ci = startOfDay(new Date(stay.checkIn));
      const co = startOfDay(new Date(stay.checkOut));
      return isWithinInterval(startOfDay(day), { start: ci, end: co });
    });

  const upcomingStays = allStays
    .filter((s) => isAfter(new Date(s.checkOut), new Date()))
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
      }
    } catch (err) {
      console.error("Failed to add stay:", err);
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

  const feedUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/calendar`
    : "/api/calendar";

  const googleSubscribeUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedUrl.replace("https://", "webcal://").replace("http://", "webcal://"))}`;

  if (loading) {
    return (
      <div>
        <Header title="Calendar" subtitle="Family visits and events" />
        <div className="max-w-5xl mx-auto px-4 py-12 text-center">
          <div className="animate-pulse text-stone-400">Loading calendar...</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header title="Calendar" subtitle="See who's coming to Breadloaf Hill" />

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        {/* Top Bar: View Toggle + Actions */}
        <div className="flex items-center justify-between">
          <div className="flex bg-stone-100 rounded-lg p-1">
            <button
              onClick={() => setView("month")}
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
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-stone-600 border border-stone-200 rounded-lg hover:bg-stone-50 transition-colors"
              >
                <Share2 size={15} />
                Share
              </button>

              {showShareMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowShareMenu(false)} />
                  <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl border border-stone-200 shadow-lg z-50 overflow-hidden">
                    <div className="p-3 border-b border-stone-100">
                      <p className="text-sm font-medium text-stone-800">Share Calendar</p>
                      <p className="text-xs text-stone-500 mt-0.5">
                        Subscribe from any calendar app
                      </p>
                    </div>
                    <div className="p-2 space-y-1">
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
                            Add to Google Calendar
                          </p>
                          <p className="text-xs text-stone-400">Subscribe to live feed</p>
                        </div>
                        <ExternalLink size={14} className="text-stone-300 ml-auto" />
                      </a>
                      <a
                        href="/api/calendar"
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
                          <p className="text-xs text-stone-400">Apple Calendar, Outlook, etc.</p>
                        </div>
                      </a>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(feedUrl);
                          setShowShareMenu(false);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-stone-50 transition-colors"
                      >
                        <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                          <Share2 size={16} className="text-purple-600" />
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-medium text-stone-800">
                            Copy feed URL
                          </p>
                          <p className="text-xs text-stone-400">For any calendar app</p>
                        </div>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-green-700 rounded-lg hover:bg-green-800 transition-colors"
            >
              <Plus size={15} />
              Add Visit
            </button>
          </div>
        </div>

        {/* Month View */}
        {view === "month" && (
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
            {/* Month Header */}
            <div className="flex items-center justify-between p-4 border-b border-stone-100">
              <button
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                className="p-2 hover:bg-stone-100 rounded-lg transition-colors"
              >
                <ChevronLeft size={20} />
              </button>
              <div className="text-center">
                <h3 className="text-lg font-semibold text-stone-800">
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
                className="p-2 hover:bg-stone-100 rounded-lg transition-colors"
              >
                <ChevronRight size={20} />
              </button>
            </div>

            {/* Day Headers */}
            <div className="grid grid-cols-7 border-b border-stone-100">
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
            <div className="grid grid-cols-7">
              {paddedDays.map((day, i) => {
                if (!day) {
                  return (
                    <div
                      key={`pad-${i}`}
                      className="min-h-[5rem] sm:min-h-[6rem] bg-stone-50/50 border-b border-r border-stone-100"
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
                    className={`min-h-[5rem] sm:min-h-[6rem] p-1.5 text-left border-b border-r border-stone-100 transition-colors ${
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
            <div className="flex items-center gap-4 p-3 border-t border-stone-100 bg-stone-50/50">
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
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden animate-fade-in-up">
            <div className="flex items-center justify-between p-4 border-b border-stone-100">
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
                        className={`rounded-xl border p-4 ${statusColors[stay.status] || "border-stone-200"}`}
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

        {/* List View: Upcoming Stays */}
        {view === "list" && (
          <div className="space-y-3">
            {upcomingStays.length === 0 ? (
              <div className="bg-white rounded-2xl border border-stone-200 p-10 text-center">
                <CalendarDays size={36} className="mx-auto text-stone-300 mb-3" />
                <p className="text-stone-600 font-medium mb-1">No upcoming visits</p>
                <p className="text-sm text-stone-400 mb-4">
                  Plan the next trip to Breadloaf Hill
                </p>
                <button
                  onClick={() => setShowAddForm(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-green-700 rounded-lg hover:bg-green-800 transition-colors"
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
                    className="bg-white rounded-xl border border-stone-200 p-4 card-hover"
                  >
                    <div className="flex items-start gap-4">
                      {/* Date block */}
                      <div className="flex-shrink-0 w-14 text-center">
                        <p className="text-xs text-stone-400 uppercase font-medium">
                          {format(new Date(stay.checkIn), "MMM")}
                        </p>
                        <p className="text-2xl font-bold text-stone-800">
                          {format(new Date(stay.checkIn), "d")}
                        </p>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
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

                      <div className="flex items-center gap-1 flex-shrink-0">
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

      {/* Add Stay Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-stone-100">
              <h3 className="font-semibold text-stone-800 text-lg">Plan a Visit</h3>
              <button
                onClick={() => setShowAddForm(false)}
                className="p-2 hover:bg-stone-100 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddStay} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  Who&apos;s coming?
                </label>
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  className="w-full border border-stone-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="Name or family"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Arriving
                  </label>
                  <input
                    type="date"
                    value={checkIn}
                    onChange={(e) => setCheckIn(e.target.value)}
                    className="w-full border border-stone-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Leaving
                  </label>
                  <input
                    type="date"
                    value={checkOut}
                    onChange={(e) => setCheckOut(e.target.value)}
                    className="w-full border border-stone-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  Room preference
                </label>
                <select
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
                <div className="flex gap-2">
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
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full border border-stone-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none resize-none"
                  rows={2}
                  placeholder="Arriving late, bringing kids, dietary needs..."
                />
              </div>

              <button
                type="submit"
                className="w-full bg-green-700 text-white rounded-lg py-3 font-medium hover:bg-green-800 transition-colors"
              >
                Add Visit
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
