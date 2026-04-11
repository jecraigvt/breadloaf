"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/layout/header";
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
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isToday, isWithinInterval, startOfDay } from "date-fns";

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

export default function StaysPage() {
  const [rooms, setRooms] = useState<RoomWithStays[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);

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
    allStays.filter((stay) => {
      const ci = startOfDay(new Date(stay.checkIn));
      const co = startOfDay(new Date(stay.checkOut));
      return isWithinInterval(startOfDay(day), { start: ci, end: co });
    });

  // Room capacity calculations
  const totalCapacity = rooms
    .filter((r) => r.type !== "offsite")
    .reduce((sum, r) => sum + r.maxCapacity, 0);

  const activeRoomCount = rooms.filter((r) => r.type !== "offsite" && r.type !== "tent").length;

  if (loading) {
    return (
      <div>
        <Header title="Stays & Rooms" subtitle="Room assignments and visits" />
        <div className="max-w-5xl mx-auto px-4 py-12 text-center">
          <div className="animate-pulse text-stone-400">Loading rooms...</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header title="Stays & Rooms" subtitle="Plan visits and pick your room" />

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Property Overview */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-stone-200 p-4 text-center">
            <p className="text-2xl font-bold text-stone-800">{activeRoomCount}</p>
            <p className="text-xs text-stone-500">Rooms</p>
          </div>
          <div className="bg-white rounded-xl border border-stone-200 p-4 text-center">
            <p className="text-2xl font-bold text-stone-800">{totalCapacity}</p>
            <p className="text-xs text-stone-500">Max guests</p>
          </div>
          <div className="bg-white rounded-xl border border-stone-200 p-4 text-center">
            <p className="text-2xl font-bold text-stone-800">
              {allStays.filter((s) => {
                const co = new Date(s.checkOut);
                return co >= new Date();
              }).length}
            </p>
            <p className="text-xs text-stone-500">Upcoming stays</p>
          </div>
        </div>

        {/* Calendar View */}
        <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-stone-100">
            <button
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              className="p-2 hover:bg-stone-100 rounded-lg transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <h3 className="font-semibold text-stone-800">
              {format(currentMonth, "MMMM yyyy")}
            </h3>
            <button
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              className="p-2 hover:bg-stone-100 rounded-lg transition-colors"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="grid grid-cols-7 text-center text-xs text-stone-400 font-medium py-2 border-b border-stone-100">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="py-1">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {paddedDays.map((day, i) => {
              if (!day) return <div key={`pad-${i}`} className="p-2 min-h-[4rem]" />;
              const dayStays = getStaysForDay(day);
              const today = isToday(day);

              return (
                <div
                  key={day.toISOString()}
                  className={`p-1.5 min-h-[4rem] border-b border-r border-stone-50 ${
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
          className="w-full flex items-center justify-center gap-2 bg-green-700 text-white rounded-xl py-3 font-medium hover:bg-green-800 transition-colors"
        >
          <Plus size={18} />
          Add a Stay
        </button>

        {/* Add Stay Form */}
        {showAddForm && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-stone-100">
                <h3 className="font-semibold text-stone-800 text-lg">Add a Stay</h3>
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
                    Guest name
                  </label>
                  <input
                    type="text"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    className="w-full border border-stone-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                    placeholder="Who's coming?"
                    required
                  />
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
                    <option value="">No preference yet</option>
                    {rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name} (sleeps {room.maxCapacity})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">
                      Check in
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
                      Check out
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
                    Status
                  </label>
                  <div className="flex gap-2">
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
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full border border-stone-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none resize-none"
                    rows={2}
                    placeholder="Number of guests, arriving late, bringing kids, need crib, etc."
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-green-700 text-white rounded-lg py-3 font-medium hover:bg-green-800 transition-colors"
                >
                  Add Stay
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Room Cards */}
        <div>
          <h2 className="font-semibold text-stone-800 text-lg mb-4 flex items-center gap-2">
            <BedDouble size={20} className="text-stone-400" />
            All Rooms
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {rooms.map((room) => {
              const Icon = roomTypeIcons[room.type] || Home;
              const colorClass = roomTypeColors[room.type] || roomTypeColors.bedroom;
              const bed = bedInfo[room.slug];
              const upcomingStays = room.stays.filter(
                (s) => new Date(s.checkOut) >= new Date()
              );
              const isExpanded = selectedRoom === room.id;

              return (
                <div
                  key={room.id}
                  className="bg-white rounded-xl border border-stone-200 overflow-hidden card-hover"
                >
                  <button
                    onClick={() => setSelectedRoom(isExpanded ? null : room.id)}
                    className="w-full text-left p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${colorClass}`}>
                        <Icon size={20} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-stone-800">{room.name}</h3>
                        <div className="flex items-center gap-3 text-xs text-stone-500 mt-1">
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
                        <span className="text-xs font-medium bg-green-100 text-green-700 rounded-full px-2 py-0.5">
                          {upcomingStays.length} upcoming
                        </span>
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-stone-100 p-4 bg-stone-50/50">
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
                                className="flex items-center gap-3 bg-white rounded-lg p-3 border border-stone-200"
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
        </div>
      </div>
    </div>
  );
}
