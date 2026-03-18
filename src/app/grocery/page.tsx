"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Header } from "@/components/layout/header";
import {
  Plus,
  Check,
  Trash2,
  Star,
  ShoppingCart,
  Loader2,
  ChevronDown,
  X,
  Sparkles,
} from "lucide-react";

interface GroceryItem {
  id: string;
  name: string;
  category: string;
  checked: boolean;
  addedBy: string | null;
  checkedBy: string | null;
  priority: boolean;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = [
  "General",
  "Pantry",
  "Kitchen",
  "Cleaning",
  "Bathroom",
  "Tools & Hardware",
  "Outdoor",
] as const;

const CATEGORY_EMOJI: Record<string, string> = {
  General: "📦",
  Pantry: "🥫",
  Kitchen: "🍳",
  Cleaning: "🧹",
  Bathroom: "🛁",
  "Tools & Hardware": "🔧",
  Outdoor: "🌿",
};

export default function GroceryPage() {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newItem, setNewItem] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("General");
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [clearingChecked, setClearingChecked] = useState(false);
  const [userName, setUserName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);

  // Load username from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("breadloaf-username") || "";
    setUserName(stored);
  }, []);

  // Close category picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        categoryRef.current &&
        !categoryRef.current.contains(e.target as Node)
      ) {
        setShowCategoryPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/grocery");
      if (res.ok) {
        setItems(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch grocery items:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Auto-focus the input on mount
  useEffect(() => {
    if (!loading) {
      inputRef.current?.focus();
    }
  }, [loading]);

  const addItem = async () => {
    const name = newItem.trim();
    if (!name || adding) return;

    setAdding(true);

    // Optimistic: add a temporary item immediately
    const tempId = `temp-${Date.now()}`;
    const optimisticItem: GroceryItem = {
      id: tempId,
      name,
      category: selectedCategory,
      checked: false,
      addedBy: userName || null,
      checkedBy: null,
      priority: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setItems((prev) => [optimisticItem, ...prev]);
    setNewItem("");
    inputRef.current?.focus();

    try {
      const res = await fetch("/api/grocery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category: selectedCategory,
          addedBy: userName || null,
        }),
      });

      if (res.ok) {
        const created = await res.json();
        // Replace temp item with real one
        setItems((prev) =>
          prev.map((item) => (item.id === tempId ? created : item))
        );
      } else {
        // Remove optimistic item on failure
        setItems((prev) => prev.filter((item) => item.id !== tempId));
      }
    } catch {
      setItems((prev) => prev.filter((item) => item.id !== tempId));
    }

    setAdding(false);
  };

  const toggleChecked = async (item: GroceryItem) => {
    const newChecked = !item.checked;

    // Optimistic update
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? {
              ...i,
              checked: newChecked,
              checkedBy: newChecked ? userName || null : null,
            }
          : i
      )
    );

    try {
      await fetch(`/api/grocery/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checked: newChecked,
          checkedBy: newChecked ? userName || null : null,
        }),
      });
    } catch {
      // Revert on error
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? item : i))
      );
    }
  };

  const togglePriority = async (item: GroceryItem) => {
    const newPriority = !item.priority;

    // Optimistic update
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, priority: newPriority } : i
      )
    );

    try {
      await fetch(`/api/grocery/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: newPriority }),
      });
    } catch {
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? item : i))
      );
    }
  };

  const deleteItem = async (id: string) => {
    setDeletingIds((prev) => new Set(prev).add(id));

    // Optimistic: remove immediately
    const removedItem = items.find((i) => i.id === id);
    setItems((prev) => prev.filter((i) => i.id !== id));

    try {
      const res = await fetch(`/api/grocery/${id}`, { method: "DELETE" });
      if (!res.ok && removedItem) {
        // Restore on failure
        setItems((prev) => [...prev, removedItem]);
      }
    } catch {
      if (removedItem) {
        setItems((prev) => [...prev, removedItem]);
      }
    }

    setDeletingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const clearChecked = async () => {
    const checkedItems = items.filter((i) => i.checked);
    if (checkedItems.length === 0) return;

    setClearingChecked(true);

    // Optimistic
    setItems((prev) => prev.filter((i) => !i.checked));

    try {
      const res = await fetch("/api/grocery", { method: "DELETE" });
      if (!res.ok) {
        // Restore on failure
        setItems((prev) => [...prev, ...checkedItems]);
      }
    } catch {
      setItems((prev) => [...prev, ...checkedItems]);
    }

    setClearingChecked(false);
  };

  // Sort: unchecked first, priority at top, then by creation date
  const sortedItems = [...items].sort((a, b) => {
    if (a.checked !== b.checked) return a.checked ? 1 : -1;
    if (!a.checked && !b.checked && a.priority !== b.priority)
      return a.priority ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // Group by category
  const uncheckedItems = sortedItems.filter((i) => !i.checked);
  const checkedItems = sortedItems.filter((i) => i.checked);

  // Priority items (unchecked only)
  const priorityItems = uncheckedItems.filter((i) => i.priority);
  const regularItems = uncheckedItems.filter((i) => !i.priority);

  // Group regular unchecked items by category
  const groupedByCategory = CATEGORIES.reduce(
    (acc, cat) => {
      const catItems = regularItems.filter((i) => i.category === cat);
      if (catItems.length > 0) acc[cat] = catItems;
      return acc;
    },
    {} as Record<string, GroceryItem[]>
  );

  // Also catch any items with categories not in the predefined list
  const otherItems = regularItems.filter(
    (i) => !(CATEGORIES as readonly string[]).includes(i.category)
  );
  if (otherItems.length > 0) {
    groupedByCategory["Other"] = otherItems;
  }

  const totalUnchecked = uncheckedItems.length;
  const totalChecked = checkedItems.length;

  return (
    <div className="min-h-screen bg-stone-50">
      <Header
        title="Grocery & Supplies"
        subtitle="Shared shopping list for the property"
      />

      <div className="max-w-5xl mx-auto px-4 py-4 pb-24 space-y-4">
        {/* Quick Add Bar */}
        <div className="bg-white rounded-xl border border-stone-200 p-3 shadow-sm sticky top-0 z-30">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                type="text"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addItem();
                }}
                placeholder="Add an item..."
                className="w-full pl-4 pr-4 py-3 rounded-lg border border-stone-200 text-base focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-stone-50 placeholder:text-stone-400"
                autoComplete="off"
              />
            </div>
            <button
              onClick={addItem}
              disabled={!newItem.trim() || adding}
              className="px-4 py-3 rounded-lg bg-green-700 text-white hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 font-medium active:scale-95"
            >
              {adding ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Plus size={20} strokeWidth={2.5} />
              )}
              <span className="hidden sm:inline">Add</span>
            </button>
          </div>

          {/* Category selector row */}
          <div className="flex items-center gap-2 mt-2.5">
            {/* Category dropdown */}
            <div className="relative" ref={categoryRef}>
              <button
                onClick={() => setShowCategoryPicker(!showCategoryPicker)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-stone-100 hover:bg-stone-200 text-sm text-stone-600 transition-colors"
              >
                <span>{CATEGORY_EMOJI[selectedCategory] || "📦"}</span>
                <span>{selectedCategory}</span>
                <ChevronDown
                  size={14}
                  className={`transition-transform ${showCategoryPicker ? "rotate-180" : ""}`}
                />
              </button>

              {showCategoryPicker && (
                <div className="absolute top-full left-0 mt-1 bg-white rounded-xl border border-stone-200 shadow-lg py-1 z-40 min-w-[180px]">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => {
                        setSelectedCategory(cat);
                        setShowCategoryPicker(false);
                        inputRef.current?.focus();
                      }}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-stone-50 transition-colors ${
                        selectedCategory === cat
                          ? "text-green-700 font-medium bg-green-50"
                          : "text-stone-600"
                      }`}
                    >
                      <span>{CATEGORY_EMOJI[cat]}</span>
                      <span>{cat}</span>
                      {selectedCategory === cat && (
                        <Check size={14} className="ml-auto text-green-600" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Username input */}
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-xs text-stone-400 hidden sm:inline">
                Adding as:
              </span>
              <input
                type="text"
                value={userName}
                onChange={(e) => {
                  setUserName(e.target.value);
                  localStorage.setItem("breadloaf-username", e.target.value);
                }}
                placeholder="Your name"
                className="w-24 sm:w-28 px-2.5 py-1.5 rounded-lg border border-stone-200 text-xs text-stone-600 focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-transparent bg-stone-50"
              />
            </div>
          </div>
        </div>

        {/* Summary bar */}
        {!loading && items.length > 0 && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm text-stone-500">
                <span className="font-semibold text-stone-700">
                  {totalUnchecked}
                </span>{" "}
                to get
              </span>
              {totalChecked > 0 && (
                <span className="text-sm text-stone-400">
                  {totalChecked} done
                </span>
              )}
            </div>
            {totalChecked > 0 && (
              <button
                onClick={clearChecked}
                disabled={clearingChecked}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-red-600 hover:bg-red-50 transition-colors active:scale-95"
              >
                {clearingChecked ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                Clear checked
              </button>
            )}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="bg-white rounded-xl h-14 animate-pulse border border-stone-100"
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && items.length === 0 && (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
              <ShoppingCart size={36} className="text-green-300" />
            </div>
            <p className="text-stone-500 font-medium text-lg">
              Shopping list is empty
            </p>
            <p className="text-stone-400 text-sm mt-1.5 max-w-xs mx-auto">
              Add items above to start building the list. Everyone at the
              property can see and update it.
            </p>
          </div>
        )}

        {/* Priority items */}
        {priorityItems.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={14} className="text-amber-500" />
              <h3 className="text-xs font-semibold text-amber-600 uppercase tracking-wider">
                Priority
              </h3>
              <span className="text-xs text-amber-400 font-medium">
                {priorityItems.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {priorityItems.map((item) => (
                <GroceryItemRow
                  key={item.id}
                  item={item}
                  isPriority
                  isDeleting={deletingIds.has(item.id)}
                  onToggleChecked={toggleChecked}
                  onTogglePriority={togglePriority}
                  onDelete={deleteItem}
                />
              ))}
            </div>
          </section>
        )}

        {/* Category groups */}
        {Object.entries(groupedByCategory).map(([category, catItems]) => (
          <section key={category}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">
                {CATEGORY_EMOJI[category] || "📦"}
              </span>
              <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
                {category}
              </h3>
              <span className="text-xs text-stone-400 font-medium bg-stone-100 rounded-full px-2 py-0.5">
                {catItems.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {catItems.map((item) => (
                <GroceryItemRow
                  key={item.id}
                  item={item}
                  isDeleting={deletingIds.has(item.id)}
                  onToggleChecked={toggleChecked}
                  onTogglePriority={togglePriority}
                  onDelete={deleteItem}
                />
              ))}
            </div>
          </section>
        ))}

        {/* Checked items */}
        {checkedItems.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-2 mt-4">
              <Check size={14} className="text-stone-400" />
              <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
                Done
              </h3>
              <span className="text-xs text-stone-300 font-medium bg-stone-100 rounded-full px-2 py-0.5">
                {checkedItems.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {checkedItems.map((item) => (
                <GroceryItemRow
                  key={item.id}
                  item={item}
                  isDeleting={deletingIds.has(item.id)}
                  onToggleChecked={toggleChecked}
                  onTogglePriority={togglePriority}
                  onDelete={deleteItem}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function GroceryItemRow({
  item,
  isPriority,
  isDeleting,
  onToggleChecked,
  onTogglePriority,
  onDelete,
}: {
  item: GroceryItem;
  isPriority?: boolean;
  isDeleting: boolean;
  onToggleChecked: (item: GroceryItem) => void;
  onTogglePriority: (item: GroceryItem) => void;
  onDelete: (id: string) => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [swiped, setSwiped] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  // Swipe to reveal delete (mobile)
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (diff > 80) {
      setSwiped(true);
    } else if (diff < -40) {
      setSwiped(false);
    }
    setTouchStartX(null);
  };

  // Close swipe on outside click
  useEffect(() => {
    if (!swiped) return;
    function handleClick(e: MouseEvent) {
      if (rowRef.current && !rowRef.current.contains(e.target as Node)) {
        setSwiped(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [swiped]);

  return (
    <div
      ref={rowRef}
      className="relative overflow-hidden rounded-xl"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => {
        setShowActions(false);
      }}
    >
      {/* Swipe-to-delete background */}
      <div className="absolute inset-y-0 right-0 w-20 bg-red-500 flex items-center justify-center rounded-r-xl">
        <Trash2 size={18} className="text-white" />
      </div>

      {/* Main row */}
      <div
        className={`relative flex items-center gap-3 px-3 py-3 border transition-all duration-200 rounded-xl ${
          item.checked
            ? "bg-stone-50 border-stone-100"
            : isPriority
              ? "bg-amber-50 border-amber-200 shadow-sm"
              : "bg-white border-stone-200 shadow-sm"
        } ${isDeleting ? "opacity-40 scale-95" : ""} ${swiped ? "-translate-x-20" : "translate-x-0"}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{ transition: "transform 200ms ease, opacity 200ms ease" }}
      >
        {/* Check button */}
        <button
          onClick={() => onToggleChecked(item)}
          className={`flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all active:scale-90 ${
            item.checked
              ? "bg-green-600 border-green-600 text-white"
              : "border-stone-300 hover:border-green-500 text-transparent hover:text-green-300"
          }`}
          aria-label={item.checked ? "Uncheck item" : "Check item"}
        >
          <Check size={14} strokeWidth={3} />
        </button>

        {/* Item name and meta */}
        <div
          className="flex-1 min-w-0 cursor-pointer select-none"
          onClick={() => onToggleChecked(item)}
        >
          <p
            className={`text-sm transition-all ${
              item.checked
                ? "line-through text-stone-400"
                : "text-stone-800 font-medium"
            }`}
          >
            {item.name}
          </p>
          {item.addedBy && (
            <p className="text-xs text-stone-400 mt-0.5">
              {item.addedBy}
              {item.checked && item.checkedBy && (
                <span className="text-stone-300">
                  {" "}
                  &middot; checked by {item.checkedBy}
                </span>
              )}
            </p>
          )}
        </div>

        {/* Priority star */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePriority(item);
          }}
          className={`flex-shrink-0 p-1.5 rounded-lg transition-all active:scale-90 ${
            item.priority
              ? "text-amber-500 hover:text-amber-600"
              : item.checked
                ? "text-stone-200"
                : "text-stone-200 hover:text-amber-400"
          } ${!showActions && !item.priority && !swiped ? "sm:opacity-0" : "sm:opacity-100"}`}
          aria-label={item.priority ? "Remove priority" : "Mark as priority"}
        >
          <Star
            size={16}
            fill={item.priority ? "currentColor" : "none"}
          />
        </button>

        {/* Delete button (desktop - hover reveal) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item.id);
          }}
          className={`flex-shrink-0 p-1.5 rounded-lg text-stone-300 hover:text-red-500 hover:bg-red-50 transition-all active:scale-90 ${
            !showActions && !swiped ? "sm:opacity-0" : "sm:opacity-100"
          }`}
          aria-label="Delete item"
        >
          <X size={16} />
        </button>
      </div>

      {/* Swipe delete tap target (mobile) */}
      {swiped && (
        <button
          onClick={() => {
            setSwiped(false);
            onDelete(item.id);
          }}
          className="absolute inset-y-0 right-0 w-20 z-10"
          aria-label="Delete item"
        />
      )}
    </div>
  );
}
