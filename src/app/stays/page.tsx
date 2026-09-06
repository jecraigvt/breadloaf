"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "@/components/layout/header";
import "../fieldguide-visits.css";
import {
  BedDouble,
  BedSingle,
  Home,
  TreePine,
  Tent,
  MapPin,
  Users,
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  Baby,
  Bath,
  Leaf,
  Check,
  Clock,
  HelpCircle,
  Trash2,
} from "lucide-react";
import { RoomWithStays } from "@/types";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isToday, startOfDay } from "date-fns";

const roomTypeIcons: Record<string, typeof Home> = {
  bedroom: BedDouble,
  annex: Home,
  loft: Home,
  cabin: TreePine,
  tent: Tent,
  offsite: MapPin,
};

const roomTypeColors: Record<string, string> = {
  bedroom: "bg-green-100 text-green-700 border-green-200",
  annex: "bg-blue-100 text-blue-700 border-blue-200",
  loft: "bg-purple-100 text-purple-700 border-purple-200",
  cabin: "bg-amber-100 text-amber-700 border-amber-200",
  tent: "bg-emerald-100 text-emerald-700 border-emerald-200",
  offsite: "bg-stone-100 text-stone-600 border-stone-200",
};

const statusColors: Record<string, string> = {
  confirmed: "bg-green-100 text-green-700",
  tentative: "bg-amber-100 text-amber-700",
  requested: "bg-blue-100 text-blue-700",
};

const statusIcons: Record<string, typeof Check> = {
  confirmed: Check,
  tentative: Clock,
  requested: HelpCircle,
};

const bedInfo: Record<string, string> = {
  "greg-craig": "Queen bed",
  "tom-craig": "Queen bed",
  "sandy-craig": "King bed",
  "jim-craig": "Queen bed",
  "wedge-room": "Twin beds",
  "upper-annex": "Twin beds",
  "lower-annex": "Twin beds",
  "loft": "Twin beds",
  "woods-cabin": "Twin beds",
};

function isStayActiveOnDay(
  stay: { checkIn: string | Date; checkOut: string | Date },
  day: Date
): boolean {
  const checkIn = startOfDay(new Date(stay.checkIn));
  const checkOut = startOfDay(new Date(stay.checkOut));
  const currentDay = startOfDay(day);

  return currentDay >= checkIn && currentDay < checkOut;
}

export default function StaysPage() {
  const [rooms, setRooms] = useState<RoomWithStays[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showAddForm, setShowAddForm] = useState(false);
  const visitDialogRef = useRef<HTMLDivElement>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);

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

  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch("/api/stays?sync=true");
      const data = await res.json();
      setRooms(data);
    } catch (err) {
      console.error("Failed to fetch rooms:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

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
    } catch (err) {
      console.error("Failed to delete stay:", err);
    }
  };

  // Calendar helpers
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Pad to start on Sunday
  const startDay = monthStart.getDay();
  const paddedDays: (Date | null)[] = Array(startDay).fill(null).concat(calendarDays);
  // Pad end to complete the last week
  const remaining = 7 - (paddedDays.length % 7);
  if (remaining < 7) {
    paddedDays.push(...Array(remaining).fill(null));
  }

  // Get all stays across all rooms for the calendar
  const allStays = rooms.flatMap((room) =>
    room.stays.map((stay) => ({ ...stay, roomName: room.name, roomSlug: room.slug }))
  );

  const getStaysForDay = (day: Date) =>
    allStays.filter((stay) => isStayActiveOnDay(stay, day));

  // Room capacity calculations
  const totalCapacity = rooms
    .filter((r) => r.type !== "offsite")
    .reduce((sum, r) => sum + r.maxCapacity, 0);

  const activeRoomCount = rooms.filter((r) => r.type !== "offsite" && r.type !== "tent").length;

  if (loading) {
    return (
      <div className="fg-visits">
        <Header title="Stays & Rooms" subtitle="Room assignments and visits" />
        <div className="fg-visits-content fg-visits-loading">
          <div className="animate-pulse text-stone-400">Loading rooms...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fg-visits">
      <Header title="Stays & Rooms" subtitle="Plan visits and pick your room" />

      <div className="fg-visits-content">
        {/* Property Overview */}
        <div className="fg-room-overview">
          <div className="fg-room-overview-stat">
            <p className="text-2xl font-bold text-stone-800">{activeRoomCount}</p>
            <p className="text-xs text-stone-500">Rooms</p>
          </div>
          <div className="fg-room-overview-stat">
            <p className="text-2xl font-bold text-stone-800">{totalCapacity}</p>
            <p className="text-xs text-stone-500">Max guests</p>
          </div>
          <div className="fg-room-overview-stat">
            <p className="text-2xl font-bold text-stone-800">
              {allStays.filter((s) => {
                return startOfDay(new Date(s.checkOut)) > startOfDay(new Date());
              }).length}
            </p>
            <p className="text-xs text-stone-500">Upcoming stays</p>
          </div>
        </div>

        <div className="fg-room-layout">
        {/* Calendar View */}
        <div className="fg-visit-panel fg-calendar-panel">
          <div className="cal-months fg-panel-heading">
            <button
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                aria-label="Previous month"
              className="fg-visit-icon-button"
            >
              <ChevronLeft size={18} />
            </button>
            <h3 className="ym">
              {format(currentMonth, "MMMM yyyy")}
            </h3>
            <button
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                aria-label="Next month"
              className="fg-visit-icon-button"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="cal-dows">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="py-1">{d}</div>
            ))}
          </div>

          <div className="cal-grid">
            {paddedDays.map((day, i) => {
              if (!day) return <div key={`pad-${i}`} className="cal-cell out fg-calendar-empty" />;
              const dayStays = getStaysForDay(day);
              const today = isToday(day);

              return (
                <div
                  key={day.toISOString()}
                  className={`cal-cell fg-calendar-day ${
                    today ? "bg-green-50/50" : ""
                  }`}
                >
                  <span
                    className={`text-xs font-medium inline-flex items-center justify-center w-6 h-6 rounded-full ${
                      today
                        ? "bg-green-700 text-white"
                        : "text-stone-600"
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                  <div className="mt-0.5 space-y-0.5">
                    {dayStays.slice(0, 2).map((stay) => (
                      <div
                        key={stay.id}
                        className={`text-[10px] leading-tight px-1 py-0.5 rounded truncate ${
                          statusColors[stay.status] || "bg-stone-100 text-stone-600"
                        }`}
                        title={`${stay.guestName} — ${stay.roomName}`}
                      >
                        {stay.guestName.split(" ")[0]}
                      </div>
                    ))}
                    {dayStays.length > 2 && (
                      <div className="text-[10px] text-stone-400 pl-1">
                        +{dayStays.length - 2} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Add Stay Button */}
        <button
          onClick={() => setShowAddForm(true)}
          className="fg-visit-primary fg-room-add"
        >
          <Plus size={18} />
          Add a Stay
        </button>

        {/* Add Stay Form */}
        {showAddForm && (
          <div className="fg-visit-overlay">
            <div ref={visitDialogRef} className="fg-visit-dialog" role="dialog" aria-modal="true" aria-labelledby="stays-form-title">
              <div className="cal-months fg-panel-heading">
                <h3 id="stays-form-title">Add a Stay</h3>
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
                  <label htmlFor="stays-guest" className="block text-sm font-medium text-stone-700 mb-1">
                  Guest name
                </label>
                  <input
                    type="text"
                    id="stays-guest"
                  autoComplete="name"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    className="w-full border border-stone-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                    placeholder="Who's coming?"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="stays-room" className="block text-sm font-medium text-stone-700 mb-1">
                  Room preference
                </label>
                  <select
                    id="stays-room"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    className="w-full border border-stone-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  >
                    <option value="">No preference yet</option>
                    {rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name} (sleeps {room.maxCapacity})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="fg-visit-date-fields">
                  <div>
                    <label htmlFor="stays-check-in" className="block text-sm font-medium text-stone-700 mb-1">
                  Check in
                </label>
                    <input
                      type="date"
                      id="stays-check-in"
                      value={checkIn}
                      onChange={(e) => setCheckIn(e.target.value)}
                      className="w-full border border-stone-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="stays-check-out" className="block text-sm font-medium text-stone-700 mb-1">
                  Check out
                </label>
                    <input
                      type="date"
                      id="stays-check-out"
                      value={checkOut}
                      onChange={(e) => setCheckOut(e.target.value)}
                      className="w-full border border-stone-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Status
                  </label>
                  <div className="fg-visit-status-options" role="group" aria-label="Status">
                    {[
                      { value: "confirmed", label: "Confirmed", icon: Check },
                      { value: "tentative", label: "Tentative", icon: Clock },
                      { value: "requested", label: "Requested", icon: HelpCircle },
                    ].map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setStatus(opt.value)}
                          aria-pressed={status === opt.value}
                          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                            status === opt.value
                              ? statusColors[opt.value] + " border-current"
                              : "border-stone-200 text-stone-500 hover:border-stone-300"
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
                  <label htmlFor="stays-notes" className="block text-sm font-medium text-stone-700 mb-1">
                  Notes
                </label>
                  <textarea
                    id="stays-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full border border-stone-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none resize-none"
                    rows={2}
                    placeholder="Number of guests, arriving late, bringing kids, need crib, etc."
                  />
                </div>

                {formError && <p className="fg-visit-form-error" role="alert">{formError}</p>}

                <button
                  type="submit"
                  disabled={saving}
                  aria-busy={saving}
                  className="fg-visit-primary fg-visit-submit"
                >
                  {saving ? "Saving…" : "Add Stay"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Room Cards */}
        <section className="fg-room-directory">
          <h2 className="section-head fg-room-section-head">
            <BedDouble size={20} className="text-stone-400" />
            All Rooms
          </h2>

          <div className="fg-room-grid">
            {rooms.map((room) => {
              const Icon = roomTypeIcons[room.type] || Home;
              const colorClass = roomTypeColors[room.type] || roomTypeColors.bedroom;
              const bed = bedInfo[room.slug];
              const upcomingStays = room.stays.filter(
                (s) => startOfDay(new Date(s.checkOut)) > startOfDay(new Date())
              );
              const isExpanded = selectedRoom === room.id;

              return (
                <div
                  key={room.id}
                  className="fg-room-card"
                >
                  <button
                    onClick={() => setSelectedRoom(isExpanded ? null : room.id)}
                    aria-expanded={isExpanded}
                    aria-controls={`room-stays-${room.id}`}
                    className="room fg-room-summary"
                  >
                    <div className="fg-room-summary-content">
                      <div className={`fg-room-icon ${colorClass}`}>
                        <Icon size={20} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="name">{room.name}</h3>
                        <div className="fg-room-details">
                          <span className="flex items-center gap-1">
                            <Users size={12} />
                            Sleeps {room.minCapacity === room.maxCapacity
                              ? room.maxCapacity
                              : `${room.minCapacity}-${room.maxCapacity}`}
                          </span>
                          {bed && (
                            <span className="flex items-center gap-1">
                              <BedSingle size={12} />
                              {bed}
                            </span>
                          )}
                          {room.hasCrib && (
                            <span className="flex items-center gap-1">
                              <Baby size={12} />
                              Crib
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 text-xs text-stone-400">
                          {room.description?.includes("Private") && (
                            <span className="flex items-center gap-1">
                              <Bath size={11} />
                              Private bath
                            </span>
                          )}
                          {room.description?.includes("Compost") && (
                            <span className="flex items-center gap-1">
                              <Leaf size={11} />
                              Compost toilet
                            </span>
                          )}
                          {room.description?.includes("Camp") && (
                            <span className="flex items-center gap-1">
                              <Bath size={11} />
                              Shared bath
                            </span>
                          )}
                        </div>
                      </div>
                      {upcomingStays.length > 0 && (
                        <span className="fg-room-upcoming">
                          {upcomingStays.length} upcoming
                        </span>
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="fg-room-stays" id={`room-stays-${room.id}`}>
                      {upcomingStays.length === 0 ? (
                        <p className="text-sm text-stone-400 text-center py-2">
                          No upcoming stays
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {upcomingStays.map((stay) => {
                            const StatusIcon = statusIcons[stay.status] || Check;
                            return (
                              <div
                                key={stay.id}
                                className="fg-room-stay"
                              >
                                <StatusIcon size={14} className={
                                  stay.status === "confirmed" ? "text-green-600" :
                                  stay.status === "tentative" ? "text-amber-600" : "text-blue-600"
                                } />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-stone-800">
                                    {stay.guestName}
                                  </p>
                                  <p className="text-xs text-stone-400">
                                    {format(new Date(stay.checkIn), "MMM d")} — {format(new Date(stay.checkOut), "MMM d, yyyy")}
                                  </p>
                                  {stay.notes && (
                                    <p className="text-xs text-stone-500 mt-0.5">{stay.notes}</p>
                                  )}
                                </div>
                                <button
                                  onClick={() => handleDeleteStay(stay.id)}
                              aria-label={`Remove ${stay.guestName}’s stay`}
                                  className="p-1.5 text-stone-300 hover:text-red-500 transition-colors"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        </div>
      </div>
    </div>
  );
}
