"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/layout/header";
import {
  ChefHat,
  Users,
  Pencil,
  Trash2,
  X,
  Loader2,
  UtensilsCrossed,
  Plus,
  StickyNote,
} from "lucide-react";

interface DinnerSignup {
  id: string;
  date: string;
  chef: string;
  meal: string | null;
  notes: string | null;
  headCount: number | null;
  createdAt: string;
  updatedAt: string;
}

function formatDayLabel(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";

  return target.toLocaleDateString("en-US", { weekday: "long" });
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function DinnersPage() {
  const [dinners, setDinners] = useState<DinnerSignup[]>([]);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("");
  const [showForm, setShowForm] = useState<string | null>(null); // date key
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form fields
  const [formChef, setFormChef] = useState("");
  const [formMeal, setFormMeal] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formHeadCount, setFormHeadCount] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("breadloaf-username") || "";
    setUserName(stored);
  }, []);

  const fetchDinners = useCallback(async () => {
    try {
      const res = await fetch("/api/dinners");
      if (res.ok) {
        setDinners(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch dinners:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDinners();
  }, [fetchDinners]);

  // Generate next 14 days
  const days: Date[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    days.push(d);
  }

  // Map dinners to day keys
  const dinnersByDay: Record<string, DinnerSignup> = {};
  for (const dinner of dinners) {
    const d = new Date(dinner.date);
    const key = getDayKey(d);
    dinnersByDay[key] = dinner;
  }

  const openSignupForm = (dateKey: string) => {
    setFormChef(userName || "");
    setFormMeal("");
    setFormNotes("");
    setFormHeadCount("");
    setFormError("");
    setEditingId(null);
    setShowForm(dateKey);
  };

  const openEditForm = (dinner: DinnerSignup) => {
    const d = new Date(dinner.date);
    const key = getDayKey(d);
    setFormChef(dinner.chef);
    setFormMeal(dinner.meal || "");
    setFormNotes(dinner.notes || "");
    setFormHeadCount(dinner.headCount?.toString() || "");
    setFormError("");
    setEditingId(dinner.id);
    setShowForm(key);
  };

  const closeForm = () => {
    setShowForm(null);
    setEditingId(null);
    setFormError("");
  };

  const handleSubmit = async () => {
    if (!formChef.trim()) {
      setFormError("Who's cooking? Enter a name.");
      return;
    }

    setSaving(true);
    setFormError("");

    try {
      if (editingId) {
        // Update
        const res = await fetch(`/api/dinners/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chef: formChef,
            meal: formMeal || null,
            notes: formNotes || null,
            headCount: formHeadCount ? parseInt(formHeadCount, 10) : null,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          setFormError(data.error || "Failed to update");
          setSaving(false);
          return;
        }
      } else {
        // Create
        const res = await fetch("/api/dinners", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: showForm,
            chef: formChef,
            meal: formMeal || null,
            notes: formNotes || null,
            headCount: formHeadCount || null,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          setFormError(data.error || "Failed to sign up");
          setSaving(false);
          return;
        }
      }

      await fetchDinners();
      closeForm();
    } catch {
      setFormError("Something went wrong. Try again.");
    }

    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this dinner sign-up?")) return;

    setDeletingId(id);

    try {
      const res = await fetch(`/api/dinners/${id}`, { method: "DELETE" });
      if (res.ok) {
        setDinners((prev) => prev.filter((d) => d.id !== id));
      }
    } catch {
      console.error("Failed to delete dinner");
    }

    setDeletingId(null);
  };

  const isWeekend = (date: Date): boolean => {
    const day = date.getDay();
    return day === 0 || day === 5 || day === 6;
  };

  return (
    <div className="min-h-screen bg-stone-50">
      <Header
        title="Dinner Sign-up"
        subtitle="Who's cooking tonight?"
      />

      <div className="max-w-5xl mx-auto px-4 py-4 pb-24 space-y-3">
        {/* Username bar */}
        <div className="bg-white rounded-xl border border-stone-200 p-3 shadow-sm flex items-center gap-3">
          <ChefHat size={18} className="text-green-700 flex-shrink-0" />
          <span className="text-sm text-stone-500">Your name:</span>
          <input
            type="text"
            value={userName}
            onChange={(e) => {
              setUserName(e.target.value);
              localStorage.setItem("breadloaf-username", e.target.value);
            }}
            placeholder="Enter your name"
            className="flex-1 px-3 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-stone-50"
          />
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div
                key={i}
                className="bg-white rounded-xl h-28 animate-pulse border border-stone-100"
              />
            ))}
          </div>
        )}

        {/* Day cards */}
        {!loading && (
          <div className="space-y-3">
            {days.map((day) => {
              const key = getDayKey(day);
              const dinner = dinnersByDay[key];
              const isToday = key === getDayKey(new Date());
              const weekend = isWeekend(day);

              return (
                <div key={key}>
                  {/* Day Card */}
                  <div
                    className={`rounded-xl border overflow-hidden transition-all ${
                      isToday
                        ? "border-green-300 bg-green-50/50 shadow-md ring-1 ring-green-200"
                        : weekend
                          ? "border-amber-200 bg-amber-50/30 shadow-sm"
                          : "border-stone-200 bg-white shadow-sm"
                    }`}
                  >
                    {/* Day header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100/60">
                      <div className="flex items-center gap-3">
                        <div
                          className={`text-center min-w-[44px] ${
                            isToday ? "text-green-700" : "text-stone-600"
                          }`}
                        >
                          <div className="text-xs font-medium uppercase tracking-wider opacity-70">
                            {day.toLocaleDateString("en-US", {
                              weekday: "short",
                            })}
                          </div>
                          <div className="text-2xl font-bold leading-none mt-0.5">
                            {day.getDate()}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-stone-800">
                            {formatDayLabel(day)}
                          </div>
                          <div className="text-xs text-stone-400">
                            {formatDateShort(day)}
                          </div>
                        </div>
                      </div>
                      {isToday && (
                        <span className="text-xs font-medium text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
                          Tonight
                        </span>
                      )}
                    </div>

                    {/* Dinner content */}
                    <div className="px-4 py-3">
                      {dinner ? (
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <ChefHat
                                  size={16}
                                  className="text-green-600 flex-shrink-0"
                                />
                                <span className="font-semibold text-stone-800 text-sm">
                                  {dinner.chef}
                                </span>
                              </div>
                              {dinner.meal && (
                                <div className="flex items-center gap-2 mt-1.5">
                                  <UtensilsCrossed
                                    size={14}
                                    className="text-stone-400 flex-shrink-0"
                                  />
                                  <span className="text-sm text-stone-600">
                                    {dinner.meal}
                                  </span>
                                </div>
                              )}
                              {dinner.notes && (
                                <div className="flex items-start gap-2 mt-1">
                                  <StickyNote
                                    size={14}
                                    className="text-stone-300 flex-shrink-0 mt-0.5"
                                  />
                                  <span className="text-xs text-stone-400 italic">
                                    {dinner.notes}
                                  </span>
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-1 flex-shrink-0">
                              {dinner.headCount && (
                                <div className="flex items-center gap-1 text-stone-500 mr-2">
                                  <Users size={14} />
                                  <span className="text-sm font-medium">
                                    {dinner.headCount}
                                  </span>
                                </div>
                              )}
                              <button
                                onClick={() => openEditForm(dinner)}
                                className="p-1.5 rounded-lg text-stone-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                                aria-label="Edit"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                onClick={() => handleDelete(dinner.id)}
                                disabled={deletingId === dinner.id}
                                className="p-1.5 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                                aria-label="Delete"
                              >
                                {deletingId === dinner.id ? (
                                  <Loader2
                                    size={14}
                                    className="animate-spin"
                                  />
                                ) : (
                                  <Trash2 size={14} />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-stone-400 italic">
                            No one signed up yet
                          </span>
                          <button
                            onClick={() => openSignupForm(key)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-700 text-white text-sm font-medium hover:bg-green-800 transition-colors active:scale-95"
                          >
                            <Plus size={14} />
                            Sign up
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Inline Form */}
                  {showForm === key && (
                    <div className="mt-2 bg-white rounded-xl border border-green-200 p-4 shadow-lg animate-in slide-in-from-top-2">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-stone-800 text-sm">
                          {editingId ? "Edit sign-up" : "Sign up to cook"} --{" "}
                          {formatDayLabel(day)}, {formatDateShort(day)}
                        </h3>
                        <button
                          onClick={closeForm}
                          className="p-1 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-stone-500 mb-1 block">
                            Who&apos;s cooking? *
                          </label>
                          <input
                            type="text"
                            value={formChef}
                            onChange={(e) => setFormChef(e.target.value)}
                            placeholder="e.g. Tom & Lisa, Greg&apos;s crew"
                            className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-stone-50"
                            autoFocus
                          />
                        </div>

                        <div>
                          <label className="text-xs font-medium text-stone-500 mb-1 block">
                            What&apos;s for dinner?
                          </label>
                          <input
                            type="text"
                            value={formMeal}
                            onChange={(e) => setFormMeal(e.target.value)}
                            placeholder="e.g. Grilled chicken, Taco night"
                            className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-stone-50"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium text-stone-500 mb-1 block">
                              Head count
                            </label>
                            <input
                              type="number"
                              value={formHeadCount}
                              onChange={(e) => setFormHeadCount(e.target.value)}
                              placeholder="e.g. 12"
                              min="1"
                              className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-stone-50"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-stone-500 mb-1 block">
                              Notes
                            </label>
                            <input
                              type="text"
                              value={formNotes}
                              onChange={(e) => setFormNotes(e.target.value)}
                              placeholder="Dietary notes, timing..."
                              className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-stone-50"
                            />
                          </div>
                        </div>

                        {formError && (
                          <p className="text-red-600 text-xs font-medium">
                            {formError}
                          </p>
                        )}

                        <div className="flex gap-2 justify-end pt-1">
                          <button
                            onClick={closeForm}
                            className="px-4 py-2 rounded-lg text-sm text-stone-600 hover:bg-stone-100 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSubmit}
                            disabled={saving}
                            className="px-4 py-2 rounded-lg bg-green-700 text-white text-sm font-medium hover:bg-green-800 disabled:opacity-40 transition-colors flex items-center gap-1.5 active:scale-95"
                          >
                            {saving ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <ChefHat size={14} />
                            )}
                            {editingId ? "Update" : "Sign up"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Empty state - only if truly nothing loaded */}
        {!loading && dinners.length === 0 && (
          <div className="text-center py-8">
            <p className="text-stone-400 text-sm">
              No dinners signed up yet. Pick a day and volunteer to cook!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
