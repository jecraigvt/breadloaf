"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Header } from "@/components/layout/header";
import {
  Plus,
  Minus,
  Search,
  Trash2,
  Loader2,
  Package,
  ChevronDown,
  X,
  ShoppingCart,
  Pencil,
  Check,
} from "lucide-react";

interface PantryItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string | null;
  expiresAt: string | null;
  notes: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = [
  "Canned Goods",
  "Dry Goods",
  "Spices & Seasonings",
  "Condiments",
  "Beverages",
  "Snacks",
  "Baking",
  "Paper & Cleaning",
  "Other",
] as const;

const CATEGORY_EMOJI: Record<string, string> = {
  "Canned Goods": "🥫",
  "Dry Goods": "🌾",
  "Spices & Seasonings": "🧂",
  Condiments: "🫙",
  Beverages: "☕",
  Snacks: "🍿",
  Baking: "🧁",
  "Paper & Cleaning": "🧻",
  Other: "📦",
  General: "📦",
};

export default function PantryPage() {
  const [items, setItems] = useState<PantryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("All");
  const [showCategoryFilter, setShowCategoryFilter] = useState(false);

  // Quick add state
  const [newName, setNewName] = useState("");
  const [newQuantity, setNewQuantity] = useState("1");
  const [newUnit, setNewUnit] = useState("");
  const [newCategory, setNewCategory] = useState<string>("General");
  const [showNewCategoryPicker, setShowNewCategoryPicker] = useState(false);
  const [adding, setAdding] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [editNotes, setEditNotes] = useState("");

  // Move to grocery state
  const [movingToGrocery, setMovingToGrocery] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const categoryFilterRef = useRef<HTMLDivElement>(null);
  const newCategoryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem("breadloaf-username") || "";
    setUserName(stored);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        categoryFilterRef.current &&
        !categoryFilterRef.current.contains(e.target as Node)
      ) {
        setShowCategoryFilter(false);
      }
      if (
        newCategoryRef.current &&
        !newCategoryRef.current.contains(e.target as Node)
      ) {
        setShowNewCategoryPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const fetchItems = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set("search", searchQuery);
      if (filterCategory !== "All") params.set("category", filterCategory);

      const res = await fetch(`/api/pantry?${params.toString()}`);
      if (res.ok) {
        setItems(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch pantry items:", err);
    }
    setLoading(false);
  }, [searchQuery, filterCategory]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const addItem = async () => {
    const name = newName.trim();
    if (!name || adding) return;

    setAdding(true);

    // Optimistic add
    const tempId = `temp-${Date.now()}`;
    const optimisticItem: PantryItem = {
      id: tempId,
      name,
      category: newCategory,
      quantity: parseInt(newQuantity, 10) || 1,
      unit: newUnit.trim() || null,
      expiresAt: null,
      notes: null,
      updatedBy: userName || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setItems((prev) => [...prev, optimisticItem]);
    setNewName("");
    setNewQuantity("1");
    setNewUnit("");
    inputRef.current?.focus();

    try {
      const res = await fetch("/api/pantry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category: newCategory,
          quantity: parseInt(newQuantity, 10) || 1,
          unit: newUnit.trim() || null,
          updatedBy: userName || null,
        }),
      });

      if (res.ok) {
        const created = await res.json();
        setItems((prev) =>
          prev.map((item) => (item.id === tempId ? created : item))
        );
      } else {
        setItems((prev) => prev.filter((item) => item.id !== tempId));
      }
    } catch {
      setItems((prev) => prev.filter((item) => item.id !== tempId));
    }

    setAdding(false);
  };

  const adjustQuantity = async (item: PantryItem, delta: number) => {
    const newQty = Math.max(0, item.quantity + delta);

    // Optimistic update
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? { ...i, quantity: newQty, updatedBy: userName || i.updatedBy }
          : i
      )
    );

    try {
      await fetch(`/api/pantry/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: newQty,
          updatedBy: userName || null,
        }),
      });

      // If quantity hits 0, offer to move to grocery list
      if (newQty === 0) {
        setMovingToGrocery(item.id);
      }
    } catch {
      // Revert on error
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? item : i))
      );
    }
  };

  const moveToGroceryList = async (item: PantryItem) => {
    try {
      // Add to grocery list
      await fetch("/api/grocery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: item.name + (item.unit ? ` (${item.unit})` : ""),
          category: "Pantry",
          addedBy: userName || null,
        }),
      });

      // Delete from pantry
      await fetch(`/api/pantry/${item.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setMovingToGrocery(null);
    } catch {
      console.error("Failed to move to grocery list");
    }
  };

  const deleteItem = async (id: string) => {
    const removedItem = items.find((i) => i.id === id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    setMovingToGrocery(null);

    try {
      const res = await fetch(`/api/pantry/${id}`, { method: "DELETE" });
      if (!res.ok && removedItem) {
        setItems((prev) => [...prev, removedItem]);
      }
    } catch {
      if (removedItem) {
        setItems((prev) => [...prev, removedItem]);
      }
    }
  };

  const startEdit = (item: PantryItem) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditQuantity(item.quantity.toString());
    setEditUnit(item.unit || "");
    setEditNotes(item.notes || "");
  };

  const saveEdit = async (item: PantryItem) => {
    if (!editName.trim()) return;

    const updated = {
      name: editName.trim(),
      quantity: parseInt(editQuantity, 10) || 1,
      unit: editUnit.trim() || null,
      notes: editNotes.trim() || null,
      updatedBy: userName || null,
    };

    // Optimistic
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, ...updated } : i
      )
    );
    setEditingId(null);

    try {
      await fetch(`/api/pantry/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
    } catch {
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? item : i))
      );
    }
  };

  // Group items by category
  const groupedByCategory: Record<string, PantryItem[]> = {};
  for (const cat of CATEGORIES) {
    const catItems = items.filter((i) => i.category === cat);
    if (catItems.length > 0) {
      groupedByCategory[cat] = catItems;
    }
  }
  // Catch uncategorized
  const otherItems = items.filter(
    (i) => !(CATEGORIES as readonly string[]).includes(i.category)
  );
  if (otherItems.length > 0) {
    groupedByCategory["Other"] = [
      ...(groupedByCategory["Other"] || []),
      ...otherItems,
    ];
  }

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);

  const formatTimeAgo = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="min-h-screen bg-stone-50">
      <Header
        title="Pantry Inventory"
        subtitle="What's already at the property"
      />

      <div className="max-w-5xl mx-auto px-4 py-4 pb-24 space-y-4">
        {/* Quick Add Bar */}
        <div className="bg-white rounded-xl border border-stone-200 p-3 shadow-sm sticky top-0 z-30">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addItem();
              }}
              placeholder="Add item to pantry..."
              className="flex-1 pl-4 pr-4 py-3 rounded-lg border border-stone-200 text-base focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-stone-50 placeholder:text-stone-400"
              autoComplete="off"
            />
            <input
              type="number"
              value={newQuantity}
              onChange={(e) => setNewQuantity(e.target.value)}
              min="1"
              className="w-16 px-2 py-3 rounded-lg border border-stone-200 text-base text-center focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-stone-50"
              placeholder="Qty"
            />
            <input
              type="text"
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value)}
              placeholder="Unit"
              className="w-20 sm:w-24 px-2 py-3 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-stone-50 placeholder:text-stone-400"
            />
            <button
              onClick={addItem}
              disabled={!newName.trim() || adding}
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

          {/* Category and name row */}
          <div className="flex items-center gap-2 mt-2.5">
            <div className="relative" ref={newCategoryRef}>
              <button
                onClick={() =>
                  setShowNewCategoryPicker(!showNewCategoryPicker)
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-stone-100 hover:bg-stone-200 text-sm text-stone-600 transition-colors"
              >
                <span>{CATEGORY_EMOJI[newCategory] || "📦"}</span>
                <span>{newCategory}</span>
                <ChevronDown
                  size={14}
                  className={`transition-transform ${showNewCategoryPicker ? "rotate-180" : ""}`}
                />
              </button>

              {showNewCategoryPicker && (
                <div className="absolute top-full left-0 mt-1 bg-white rounded-xl border border-stone-200 shadow-lg py-1 z-40 min-w-[200px]">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => {
                        setNewCategory(cat);
                        setShowNewCategoryPicker(false);
                        inputRef.current?.focus();
                      }}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-stone-50 transition-colors ${
                        newCategory === cat
                          ? "text-green-700 font-medium bg-green-50"
                          : "text-stone-600"
                      }`}
                    >
                      <span>{CATEGORY_EMOJI[cat]}</span>
                      <span>{cat}</span>
                      {newCategory === cat && (
                        <Check
                          size={14}
                          className="ml-auto text-green-600"
                        />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

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

        {/* Search and filter bar */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search pantry..."
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="relative" ref={categoryFilterRef}>
            <button
              onClick={() => setShowCategoryFilter(!showCategoryFilter)}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm transition-colors ${
                filterCategory !== "All"
                  ? "border-green-300 bg-green-50 text-green-700"
                  : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
              }`}
            >
              <span>
                {filterCategory === "All"
                  ? "All"
                  : CATEGORY_EMOJI[filterCategory] || "📦"}
              </span>
              <ChevronDown
                size={14}
                className={`transition-transform ${showCategoryFilter ? "rotate-180" : ""}`}
              />
            </button>

            {showCategoryFilter && (
              <div className="absolute top-full right-0 mt-1 bg-white rounded-xl border border-stone-200 shadow-lg py-1 z-40 min-w-[200px]">
                <button
                  onClick={() => {
                    setFilterCategory("All");
                    setShowCategoryFilter(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-stone-50 transition-colors ${
                    filterCategory === "All"
                      ? "text-green-700 font-medium bg-green-50"
                      : "text-stone-600"
                  }`}
                >
                  All categories
                </button>
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => {
                      setFilterCategory(cat);
                      setShowCategoryFilter(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-stone-50 transition-colors ${
                      filterCategory === cat
                        ? "text-green-700 font-medium bg-green-50"
                        : "text-stone-600"
                    }`}
                  >
                    <span>{CATEGORY_EMOJI[cat]}</span>
                    <span>{cat}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Summary */}
        {!loading && items.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-stone-500">
              <span className="font-semibold text-stone-700">
                {items.length}
              </span>{" "}
              items
            </span>
            <span className="text-sm text-stone-400">
              {totalItems} total units
            </span>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="bg-white rounded-xl h-16 animate-pulse border border-stone-100"
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && items.length === 0 && (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
              <Package size={36} className="text-green-300" />
            </div>
            <p className="text-stone-500 font-medium text-lg">
              Pantry is empty
            </p>
            <p className="text-stone-400 text-sm mt-1.5 max-w-xs mx-auto">
              {searchQuery || filterCategory !== "All"
                ? "No items match your search. Try adjusting your filters."
                : "Add items above to start tracking what's at the property."}
            </p>
          </div>
        )}

        {/* Category groups */}
        {!loading &&
          Object.entries(groupedByCategory).map(([category, catItems]) => (
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
                  <div key={item.id}>
                    {/* Zero quantity overlay */}
                    {item.quantity === 0 && movingToGrocery === item.id && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-1.5 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <ShoppingCart
                            size={16}
                            className="text-amber-600"
                          />
                          <span className="text-sm text-amber-800">
                            Out of{" "}
                            <span className="font-medium">{item.name}</span>
                            . Add to grocery list?
                          </span>
                        </div>
                        <div className="flex gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => moveToGroceryList(item)}
                            className="px-3 py-1 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 transition-colors active:scale-95"
                          >
                            Add to list
                          </button>
                          <button
                            onClick={() => deleteItem(item.id)}
                            className="px-3 py-1 rounded-lg text-stone-500 text-xs hover:bg-stone-100 transition-colors"
                          >
                            Remove
                          </button>
                          <button
                            onClick={() => setMovingToGrocery(null)}
                            className="p-1 rounded-lg text-stone-400 hover:text-stone-600 transition-colors"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    )}

                    {editingId === item.id ? (
                      /* Edit mode */
                      <div className="bg-white rounded-xl border border-green-200 p-3 shadow-sm">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="col-span-2 px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                            placeholder="Item name"
                            autoFocus
                          />
                          <input
                            type="number"
                            value={editQuantity}
                            onChange={(e) => setEditQuantity(e.target.value)}
                            min="0"
                            className="px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                            placeholder="Qty"
                          />
                          <input
                            type="text"
                            value={editUnit}
                            onChange={(e) => setEditUnit(e.target.value)}
                            className="px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                            placeholder="Unit"
                          />
                        </div>
                        <input
                          type="text"
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          className="w-full mt-2 px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                          placeholder="Notes (optional)"
                        />
                        <div className="flex gap-2 justify-end mt-2">
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1.5 rounded-lg text-sm text-stone-600 hover:bg-stone-100 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => saveEdit(item)}
                            className="px-3 py-1.5 rounded-lg bg-green-700 text-white text-sm font-medium hover:bg-green-800 transition-colors active:scale-95"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Normal display */
                      <div
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                          item.quantity === 0
                            ? "bg-stone-50 border-stone-100 opacity-60"
                            : "bg-white border-stone-200 shadow-sm"
                        }`}
                      >
                        {/* Quantity display and controls */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => adjustQuantity(item, -1)}
                            className="w-7 h-7 rounded-lg bg-stone-100 hover:bg-red-100 hover:text-red-600 flex items-center justify-center text-stone-500 transition-colors active:scale-90"
                            aria-label="Decrease quantity"
                          >
                            <Minus size={14} strokeWidth={2.5} />
                          </button>

                          <div className="w-10 text-center">
                            <span
                              className={`text-lg font-bold ${
                                item.quantity === 0
                                  ? "text-red-400"
                                  : item.quantity <= 2
                                    ? "text-amber-600"
                                    : "text-stone-800"
                              }`}
                            >
                              {item.quantity}
                            </span>
                          </div>

                          <button
                            onClick={() => adjustQuantity(item, 1)}
                            className="w-7 h-7 rounded-lg bg-stone-100 hover:bg-green-100 hover:text-green-600 flex items-center justify-center text-stone-500 transition-colors active:scale-90"
                            aria-label="Increase quantity"
                          >
                            <Plus size={14} strokeWidth={2.5} />
                          </button>
                        </div>

                        {/* Item details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-sm font-medium text-stone-800 truncate">
                              {item.name}
                            </span>
                            {item.unit && (
                              <span className="text-xs text-stone-400 flex-shrink-0">
                                {item.unit}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-stone-400 mt-0.5">
                            {item.updatedBy && (
                              <span>{item.updatedBy}</span>
                            )}
                            <span>{formatTimeAgo(item.updatedAt)}</span>
                            {item.notes && (
                              <span className="text-stone-300 italic truncate">
                                {item.notes}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <button
                            onClick={() => startEdit(item)}
                            className="p-1.5 rounded-lg text-stone-300 hover:text-green-600 hover:bg-green-50 transition-colors"
                            aria-label="Edit item"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => deleteItem(item.id)}
                            className="p-1.5 rounded-lg text-stone-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                            aria-label="Delete item"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
      </div>
    </div>
  );
}
