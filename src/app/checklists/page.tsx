"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "@/components/layout/header";
import { requestSavedState } from "@/lib/saved-state";
import {
  CheckSquare,
  Square,
  Plus,
  RotateCcw,
  Trash2,
  Loader2,
  Droplets,
  Flame,
  UtensilsCrossed,
  TreePine,
  ShieldCheck,
  Wrench,
  ChevronDown,
  ChevronRight,
  User,
  Clock,
} from "lucide-react";

interface ChecklistItem {
  id: string;
  name: string;
  list: string;
  section: string;
  sortOrder: number;
  checked: boolean;
  checkedBy: string | null;
  checkedAt: string | null;
  createdAt: string;
}

interface ChecklistRun { id: string; archivedAt: string; archivedBy: string | null; items: ChecklistItem[]; }

const SECTIONS = [
  "Water System",
  "Heating",
  "Kitchen",
  "Exterior",
  "Safety",
  "General",
];

const SECTION_ICONS: Record<string, React.ReactNode> = {
  "Water System": <Droplets size={16} />,
  Heating: <Flame size={16} />,
  Kitchen: <UtensilsCrossed size={16} />,
  Exterior: <TreePine size={16} />,
  Safety: <ShieldCheck size={16} />,
  General: <Wrench size={16} />,
};

function formatDateTime(date: string) {
  return new Date(date).toLocaleString("en-US", {
    year: "numeric",
    timeZone: "America/New_York",
    timeZoneName: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ChecklistsPage() {
  const [activeTab, setActiveTab] = useState<"opening" | "closing">("opening");
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState(
    typeof window !== "undefined"
      ? localStorage.getItem("breadloaf-username") || ""
      : ""
  );
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemSection, setNewItemSection] = useState("General");
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<ChecklistRun[]>([]);
  const pending = useRef(new Set<string>());
  const activeList = useRef(activeTab);
  activeList.current = activeTab;
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set()
  );

  const fetchItems = useCallback(async () => {
    const list = activeTab;
    setLoading(true);
    try {
      const [saved, runs] = await Promise.all([
        requestSavedState<ChecklistItem[]>(`/api/checklists?list=${list}`, { cache: "no-store" }),
        requestSavedState<ChecklistRun[]>(`/api/checklists/history?list=${list}`, { cache: "no-store" }),
      ]);
      if (activeList.current === list) { setItems(saved); setHistory(runs); setError(""); }
    } catch { if (activeList.current === list) setError("The checklist could not be loaded. Try again."); }
    finally { if (activeList.current === list) setLoading(false); }
  }, [activeTab]);

  useEffect(() => { setItems([]); setHistory([]); void fetchItems(); }, [fetchItems]);

  const toggleItem = async (item: ChecklistItem) => {
    if (pending.current.has(item.id) || resetting) return;
    if (!item.checked && !username.trim()) {
      setError("Enter your name so the family knows who completed the task.");
      return;
    }

    localStorage.setItem("breadloaf-username", username);
    pending.current.add(item.id); setBusy(new Set(pending.current)); setError("");

    // Optimistic update
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? {
              ...i,
              checked: !i.checked,
              checkedBy: !i.checked ? username : null,
              checkedAt: !i.checked ? new Date().toISOString() : null,
            }
          : i
      )
    );

    try {
      const saved = await requestSavedState<ChecklistItem>(`/api/checklists/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checked: !item.checked,
        checkedBy: username.trim(),
      }),
      });
      setItems(previous => previous.map(row => row.id === item.id ? saved : row));
    } catch {
      setItems(previous => previous.map(row => row.id === item.id ? item : row));
      setError(`Could not save ${item.name}. Its previous state has been restored.`);
    } finally { pending.current.delete(item.id); setBusy(new Set(pending.current)); }
  };

  const addItem = async () => {
    if (!newItemName.trim() || adding || resetting) return;
    setAdding(true);
    setError("");
    try {
      await requestSavedState("/api/checklists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newItemName.trim(),
        list: activeTab,
        section: newItemSection,
      }),
      });
      setNewItemName("");
      setShowAddForm(false);
      await fetchItems();
    } catch { setError("The new task was not saved. Your text is still here; try again."); }
    finally { setAdding(false); }
  };

  const deleteItem = async (id: string) => {
    if (pending.current.has(id) || resetting) return;
    if (!confirm("Delete this checklist item?")) return;
    pending.current.add(id); setBusy(new Set(pending.current)); setError("");
    try {
      await requestSavedState(`/api/checklists/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch { setError("The task could not be deleted. It remains on the checklist."); }
    finally { pending.current.delete(id); setBusy(new Set(pending.current)); }
  };

  const resetAll = async () => {
    if (resetting || pending.current.size || adding) return;
    if (
      !confirm(
        `Save this ${activeTab} checklist to history and start a new season? Completed tasks, names, and dates will remain in history.`
      )
    )
      return;

    setResetting(true);
    setError("");
    try {
      await requestSavedState("/api/checklists/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ list: activeTab, archivedBy: username.trim() || null }),
      });
      await fetchItems();
    } catch { setError("A new season could not be started. The current checklist is unchanged."); }
    finally { setResetting(false); }
  };

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // Group items by section
  const groupedItems = items.reduce(
    (acc, item) => {
      if (!acc[item.section]) acc[item.section] = [];
      acc[item.section].push(item);
      return acc;
    },
    {} as Record<string, ChecklistItem[]>
  );

  // Sort sections by predefined order
  const sortedSections = Object.keys(groupedItems).sort((a, b) => {
    const aIdx = SECTIONS.indexOf(a);
    const bIdx = SECTIONS.indexOf(b);
    if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  const totalItems = items.length;
  const checkedItems = items.filter((i) => i.checked).length;
  const progress = totalItems > 0 ? (checkedItems / totalItems) * 100 : 0;

  return (
    <div>
      <Header
        title="Opening & Closing"
        subtitle="Seasonal checklists for the property"
      />

      <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {error && <div role="alert" className="p-3 border border-red-200 rounded-lg text-red-800"><p>{error}</p>{!items.length && <button className="underline mt-2" onClick={() => void fetchItems()}>Try again</button>}</div>}
        {/* Username input */}
        <div className="flex items-center gap-3">
          <User size={16} className="text-stone-400" />
          <input
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              localStorage.setItem("breadloaf-username", e.target.value);
            }}
            placeholder="Your name"
            aria-label="Your name for completed tasks"
            className="w-40 px-3 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          <button
            disabled={resetting || busy.size > 0 || adding}
            aria-pressed={activeTab === "opening"}
            onClick={() => setActiveTab("opening")}
            className={`flex-1 py-3 px-4 rounded-xl font-medium text-sm transition-colors ${
              activeTab === "opening"
                ? "bg-green-700 text-white shadow-sm"
                : "bg-white text-stone-600 border border-stone-200 hover:bg-stone-50"
            }`}
          >
            Opening
          </button>
          <button
            disabled={resetting || busy.size > 0 || adding}
            aria-pressed={activeTab === "closing"}
            onClick={() => setActiveTab("closing")}
            className={`flex-1 py-3 px-4 rounded-xl font-medium text-sm transition-colors ${
              activeTab === "closing"
                ? "bg-green-700 text-white shadow-sm"
                : "bg-white text-stone-600 border border-stone-200 hover:bg-stone-50"
            }`}
          >
            Closing
          </button>
        </div>

        {/* Progress bar */}
        {totalItems > 0 && (
          <div className="bg-white rounded-xl border border-stone-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-stone-700">
                Progress
              </span>
              <span className="text-sm text-stone-500">
                {checkedItems} / {totalItems} complete
              </span>
            </div>
            <div className="w-full h-3 bg-stone-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-600 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-700 text-white text-sm font-medium hover:bg-green-800 transition-colors"
          >
            <Plus size={16} />
            Add Item
          </button>
          {totalItems > 0 && (
            <button
              onClick={resetAll}
              disabled={resetting || busy.size > 0 || adding || loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-stone-600 text-sm font-medium border border-stone-200 hover:bg-stone-50 transition-colors disabled:opacity-50"
            >
              {resetting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RotateCcw size={16} />
              )}
              Start a new season
            </button>
          )}
        </div>

        {/* Add form */}
        {showAddForm && (
          <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
            <input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addItem()}
              placeholder="Item name (e.g., Turn on water main)"
              className="w-full px-4 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              autoFocus
            />
            <div className="flex gap-3 items-center">
              <select
                value={newItemSection}
                onChange={(e) => setNewItemSection(e.target.value)}
                className="px-3 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              >
                {SECTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                onClick={addItem}
                disabled={!newItemName.trim() || adding}
                className="px-4 py-2 rounded-lg bg-green-700 text-white text-sm font-medium hover:bg-green-800 disabled:opacity-50 transition-colors"
              >
                {adding ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  "Add"
                )}
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setNewItemName("");
                }}
                className="px-4 py-2 rounded-lg text-stone-500 text-sm hover:bg-stone-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Checklist sections */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-stone-100 rounded-xl h-32 animate-pulse"
              />
            ))}
          </div>
        ) : items.length === 0 && !error ? (
          <div className="text-center py-12">
            <CheckSquare size={48} className="mx-auto text-stone-300 mb-3" />
            <p className="text-stone-500 font-medium">No checklist items yet</p>
            <p className="text-stone-400 text-sm mt-1">
              Add your first {activeTab} checklist item above
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedSections.map((section) => {
              const sectionItems = groupedItems[section];
              const sectionChecked = sectionItems.filter(
                (i) => i.checked
              ).length;
              const isCollapsed = collapsedSections.has(section);

              return (
                <div
                  key={section}
                  className="bg-white rounded-xl border border-stone-200 overflow-hidden"
                >
                  {/* Section header */}
                  <button
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleSection(section)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-stone-50 transition-colors"
                  >
                    <span className="text-green-700">
                      {SECTION_ICONS[section] || <Wrench size={16} />}
                    </span>
                    <span className="font-semibold text-stone-800 text-sm flex-1 text-left">
                      {section}
                    </span>
                    <span className="text-xs text-stone-400 mr-2">
                      {sectionChecked}/{sectionItems.length}
                    </span>
                    {isCollapsed ? (
                      <ChevronRight size={16} className="text-stone-400" />
                    ) : (
                      <ChevronDown size={16} className="text-stone-400" />
                    )}
                  </button>

                  {/* Section items */}
                  {!isCollapsed && (
                    <div className="border-t border-stone-100">
                      {sectionItems.map((item) => (
                        <div
                          key={item.id}
                          className={`flex items-start gap-3 px-4 py-3 border-b border-stone-50 last:border-b-0 ${
                            item.checked ? "bg-green-50/50" : ""
                          }`}
                        >
                          <button
                            role="checkbox"
                            aria-checked={item.checked}
                            aria-label={`${item.checked ? "Uncheck" : "Complete"}: ${item.name}`}
                            disabled={busy.has(item.id) || resetting}
                            onClick={() => toggleItem(item)}
                            className="mt-0.5 w-10 h-10 flex items-center justify-center flex-shrink-0 disabled:opacity-50"
                          >
                            {item.checked ? (
                              <CheckSquare
                                size={20}
                                className="text-green-600"
                              />
                            ) : (
                              <Square
                                size={20}
                                className="text-stone-300 hover:text-green-500 transition-colors"
                              />
                            )}
                          </button>
                          <div className="flex-1 min-w-0">
                            <span
                              className={`text-sm ${
                                item.checked
                                  ? "text-stone-400 line-through"
                                  : "text-stone-700"
                              }`}
                            >
                              {item.name}
                            </span>
                            {item.checked && item.checkedBy && (
                              <div className="flex items-center gap-2 mt-1 text-xs text-stone-400">
                                <User size={11} />
                                <span>{item.checkedBy}</span>
                                {item.checkedAt && (
                                  <>
                                    <Clock size={11} />
                                    <span>
                                      {formatDateTime(item.checkedAt)}
                                    </span>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          <button
                            aria-label={`Delete ${item.name}`}
                            disabled={busy.has(item.id) || resetting}
                            onClick={() => deleteItem(item.id)}
                            className="p-3 rounded-lg text-stone-500 hover:text-red-700 hover:bg-red-50 transition-colors flex-shrink-0 disabled:opacity-50"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {history.length > 0 && <section aria-label="Previous seasons" className="space-y-3"><h2 className="text-lg font-semibold">Previous seasons</h2>{history.map(run => <details key={run.id} className="p-4 bg-white border border-stone-200 rounded-lg"><summary className="cursor-pointer">{formatDateTime(run.archivedAt)} · {run.items.filter(item => item.checked).length}/{run.items.length} complete{run.archivedBy ? ` · saved by ${run.archivedBy}` : ""}</summary><ul className="mt-3 space-y-2">{run.items.map(item => <li key={item.id} className="text-sm">{item.checked ? "✓" : "○"} {item.name}{item.checkedBy ? ` — ${item.checkedBy}` : ""}{item.checkedAt ? ` · ${formatDateTime(item.checkedAt)}` : ""}</li>)}</ul></details>)}</section>}
      </div>
    </div>
  );
}
