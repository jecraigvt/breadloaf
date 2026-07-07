"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Header } from "@/components/layout/header";
import {
  Plus,
  Minus,
  Check,
  Trash2,
  Star,
  ShoppingCart,
  Loader2,
  ChevronDown,
  X,
  Sparkles,
  Search,
  Package,
  Pencil,
  Camera,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import {
  GROCERY_CATEGORIES,
  GROCERY_EMOJI,
  resolveCategory,
} from "@/lib/grocery-categories";

type Tab = "shopping" | "inventory";

// ─── Grocery types ─────────────────────────────────────────────
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

const AUTO_CATEGORY = "Auto";

// ─── Pantry types ──────────────────────────────────────────────
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

const PANTRY_CATEGORIES = [
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

const PANTRY_EMOJI: Record<string, string> = {
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

// ─── Scan types ────────────────────────────────────────────────
interface ScannedItem {
  name: string;
  quantity: number;
  unit: string;
  category: string;
  selected: boolean;
}

// ═══════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════
export default function SuppliesPage() {
  const [activeTab, setActiveTab] = useState<Tab>("shopping");
  const [userName, setUserName] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("breadloaf-username") || "";
    setUserName(stored);
  }, []);

  const updateUserName = (name: string) => {
    setUserName(name);
    localStorage.setItem("breadloaf-username", name);
  };

  return (
    <div className="min-h-screen bg-stone-50">
      <Header
        title="Supplies"
        subtitle={
          activeTab === "shopping"
            ? "Shared shopping list"
            : "What's at the property"
        }
      />

      <div className="max-w-5xl mx-auto px-4 py-4 pb-24 space-y-4">
        {/* Tab Bar */}
        <div className="flex bg-stone-200/60 rounded-xl p-1">
          <button
            onClick={() => setActiveTab("shopping")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === "shopping"
                ? "bg-white text-stone-800 shadow-sm"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            <ShoppingCart size={16} />
            Shopping List
          </button>
          <button
            onClick={() => setActiveTab("inventory")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === "inventory"
                ? "bg-white text-stone-800 shadow-sm"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            <Package size={16} />
            In Stock
          </button>
        </div>

        {activeTab === "shopping" ? (
          <ShoppingListTab
            userName={userName}
            onUpdateUserName={updateUserName}
          />
        ) : (
          <InventoryTab
            userName={userName}
            onUpdateUserName={updateUserName}
          />
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Shopping List Tab
// ═══════════════════════════════════════════════════════════════
function ShoppingListTab({
  userName,
  onUpdateUserName,
}: {
  userName: string;
  onUpdateUserName: (name: string) => void;
}) {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newItem, setNewItem] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>(AUTO_CATEGORY);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [clearingChecked, setClearingChecked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);

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
      if (res.ok) setItems(await res.json());
    } catch (err) {
      console.error("Failed to fetch grocery items:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [loading]);

  const addItem = async () => {
    const name = newItem.trim();
    if (!name || adding) return;
    setAdding(true);

    const category =
      selectedCategory === AUTO_CATEGORY
        ? resolveCategory(null, name)
        : selectedCategory;

    const tempId = `temp-${Date.now()}`;
    const optimisticItem: GroceryItem = {
      id: tempId,
      name,
      category,
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
        body: JSON.stringify({ name, category, addedBy: userName || null }),
      });
      if (res.ok) {
        const created = await res.json();
        setItems((prev) => prev.map((item) => (item.id === tempId ? created : item)));
      } else {
        setItems((prev) => prev.filter((item) => item.id !== tempId));
      }
    } catch {
      setItems((prev) => prev.filter((item) => item.id !== tempId));
    }
    setAdding(false);
  };

  const toggleChecked = async (item: GroceryItem) => {
    const newChecked = !item.checked;
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? { ...i, checked: newChecked, checkedBy: newChecked ? userName || null : null }
          : i
      )
    );
    try {
      await fetch(`/api/grocery/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checked: newChecked, checkedBy: newChecked ? userName || null : null }),
      });
    } catch {
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
    }
  };

  const togglePriority = async (item: GroceryItem) => {
    const newPriority = !item.priority;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, priority: newPriority } : i)));
    try {
      await fetch(`/api/grocery/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: newPriority }),
      });
    } catch {
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
    }
  };

  const deleteItem = async (id: string) => {
    setDeletingIds((prev) => new Set(prev).add(id));
    const removedItem = items.find((i) => i.id === id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/grocery/${id}`, { method: "DELETE" });
      if (!res.ok && removedItem) setItems((prev) => [...prev, removedItem]);
    } catch {
      if (removedItem) setItems((prev) => [...prev, removedItem]);
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
    setItems((prev) => prev.filter((i) => !i.checked));
    try {
      const res = await fetch("/api/grocery", { method: "DELETE" });
      if (!res.ok) setItems((prev) => [...prev, ...checkedItems]);
    } catch {
      setItems((prev) => [...prev, ...checkedItems]);
    }
    setClearingChecked(false);
  };

  const sortedItems = [...items].sort((a, b) => {
    if (a.checked !== b.checked) return a.checked ? 1 : -1;
    if (!a.checked && !b.checked && a.priority !== b.priority) return a.priority ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const uncheckedItems = sortedItems.filter((i) => !i.checked);
  const checkedItems = sortedItems.filter((i) => i.checked);
  const priorityItems = uncheckedItems.filter((i) => i.priority);
  const regularItems = uncheckedItems.filter((i) => !i.priority);

  // Group via resolveCategory so legacy rows (lowercase categories from
  // the assistant, old "General" defaults) still land in the right aisle.
  const groupedByCategory = GROCERY_CATEGORIES.reduce(
    (acc, cat) => {
      const catItems = regularItems.filter(
        (i) => resolveCategory(i.category, i.name) === cat
      );
      if (catItems.length > 0) acc[cat] = catItems;
      return acc;
    },
    {} as Record<string, GroceryItem[]>
  );

  return (
    <>
      {/* Quick Add Bar */}
      <div className="bg-white rounded-xl border border-stone-200 p-3 shadow-sm sticky top-0 z-30">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addItem(); }}
            placeholder="Add an item..."
            className="flex-1 pl-4 pr-4 py-3 rounded-lg border border-stone-200 text-base focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-stone-50 placeholder:text-stone-400"
            autoComplete="off"
          />
          <button
            onClick={addItem}
            disabled={!newItem.trim() || adding}
            className="px-4 py-3 rounded-lg bg-green-700 text-white hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 font-medium active:scale-95"
          >
            {adding ? <Loader2 size={20} className="animate-spin" /> : <Plus size={20} strokeWidth={2.5} />}
            <span className="hidden sm:inline">Add</span>
          </button>
        </div>
        <div className="flex items-center gap-2 mt-2.5">
          <div className="relative" ref={categoryRef}>
            <button
              onClick={() => setShowCategoryPicker(!showCategoryPicker)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-stone-100 hover:bg-stone-200 text-sm text-stone-600 transition-colors"
            >
              <span>{selectedCategory === AUTO_CATEGORY ? "✨" : GROCERY_EMOJI[selectedCategory] || "📦"}</span>
              <span>{selectedCategory === AUTO_CATEGORY ? "Auto-sort" : selectedCategory}</span>
              <ChevronDown size={14} className={`transition-transform ${showCategoryPicker ? "rotate-180" : ""}`} />
            </button>
            {showCategoryPicker && (
              <div className="absolute top-full left-0 mt-1 bg-white rounded-xl border border-stone-200 shadow-lg py-1 z-40 min-w-[180px] max-h-72 overflow-y-auto">
                <button
                  onClick={() => { setSelectedCategory(AUTO_CATEGORY); setShowCategoryPicker(false); inputRef.current?.focus(); }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-stone-50 transition-colors ${selectedCategory === AUTO_CATEGORY ? "text-green-700 font-medium bg-green-50" : "text-stone-600"}`}
                >
                  <span>✨</span>
                  <span>Auto-sort</span>
                  {selectedCategory === AUTO_CATEGORY && <Check size={14} className="ml-auto text-green-600" />}
                </button>
                {GROCERY_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => { setSelectedCategory(cat); setShowCategoryPicker(false); inputRef.current?.focus(); }}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-stone-50 transition-colors ${selectedCategory === cat ? "text-green-700 font-medium bg-green-50" : "text-stone-600"}`}
                  >
                    <span>{GROCERY_EMOJI[cat]}</span>
                    <span>{cat}</span>
                    {selectedCategory === cat && <Check size={14} className="ml-auto text-green-600" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-xs text-stone-400 hidden sm:inline">Adding as:</span>
            <input
              type="text"
              value={userName}
              onChange={(e) => onUpdateUserName(e.target.value)}
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
              <span className="font-semibold text-stone-700">{uncheckedItems.length}</span> to get
            </span>
            {checkedItems.length > 0 && (
              <span className="text-sm text-stone-400">{checkedItems.length} done</span>
            )}
          </div>
          {checkedItems.length > 0 && (
            <button
              onClick={clearChecked}
              disabled={clearingChecked}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-red-600 hover:bg-red-50 transition-colors active:scale-95"
            >
              {clearingChecked ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Clear checked
            </button>
          )}
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-white rounded-xl h-14 animate-pulse border border-stone-100" />
          ))}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-center py-16">
          <div className="w-20 h-20 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
            <ShoppingCart size={36} className="text-green-300" />
          </div>
          <p className="text-stone-500 font-medium text-lg">Shopping list is empty</p>
          <p className="text-stone-400 text-sm mt-1.5 max-w-xs mx-auto">
            Add items above to start building the list. Everyone at the property can see and update it.
          </p>
        </div>
      )}

      {priorityItems.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={14} className="text-amber-500" />
            <h3 className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Priority</h3>
            <span className="text-xs text-amber-400 font-medium">{priorityItems.length}</span>
          </div>
          <div className="space-y-1.5">
            {priorityItems.map((item) => (
              <GroceryItemRow key={item.id} item={item} isPriority isDeleting={deletingIds.has(item.id)} onToggleChecked={toggleChecked} onTogglePriority={togglePriority} onDelete={deleteItem} />
            ))}
          </div>
        </section>
      )}

      {Object.entries(groupedByCategory).map(([category, catItems]) => (
        <section key={category}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm">{GROCERY_EMOJI[category] || "📦"}</span>
            <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider">{category}</h3>
            <span className="text-xs text-stone-400 font-medium bg-stone-100 rounded-full px-2 py-0.5">{catItems.length}</span>
          </div>
          <div className="space-y-1.5">
            {catItems.map((item) => (
              <GroceryItemRow key={item.id} item={item} isDeleting={deletingIds.has(item.id)} onToggleChecked={toggleChecked} onTogglePriority={togglePriority} onDelete={deleteItem} />
            ))}
          </div>
        </section>
      ))}

      {checkedItems.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-2 mt-4">
            <Check size={14} className="text-stone-400" />
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Done</h3>
            <span className="text-xs text-stone-300 font-medium bg-stone-100 rounded-full px-2 py-0.5">{checkedItems.length}</span>
          </div>
          <div className="space-y-1.5">
            {checkedItems.map((item) => (
              <GroceryItemRow key={item.id} item={item} isDeleting={deletingIds.has(item.id)} onToggleChecked={toggleChecked} onTogglePriority={togglePriority} onDelete={deleteItem} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ─── Grocery Item Row ──────────────────────────────────────────
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

  const handleTouchStart = (e: React.TouchEvent) => setTouchStartX(e.touches[0].clientX);
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (diff > 80) setSwiped(true);
    else if (diff < -40) setSwiped(false);
    setTouchStartX(null);
  };

  useEffect(() => {
    if (!swiped) return;
    function handleClick(e: MouseEvent) {
      if (rowRef.current && !rowRef.current.contains(e.target as Node)) setSwiped(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [swiped]);

  return (
    <div ref={rowRef} className="relative overflow-hidden rounded-xl" onMouseEnter={() => setShowActions(true)} onMouseLeave={() => setShowActions(false)}>
      <div className="absolute inset-y-0 right-0 w-20 bg-red-500 flex items-center justify-center rounded-r-xl">
        <Trash2 size={18} className="text-white" />
      </div>
      <div
        className={`relative flex items-center gap-3 px-3 py-3 border transition-all duration-200 rounded-xl ${
          item.checked ? "bg-stone-50 border-stone-100" : isPriority ? "bg-amber-50 border-amber-200 shadow-sm" : "bg-white border-stone-200 shadow-sm"
        } ${isDeleting ? "opacity-40 scale-95" : ""} ${swiped ? "-translate-x-20" : "translate-x-0"}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{ transition: "transform 200ms ease, opacity 200ms ease" }}
      >
        <button
          onClick={() => onToggleChecked(item)}
          className={`flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all active:scale-90 ${
            item.checked ? "bg-green-600 border-green-600 text-white" : "border-stone-300 hover:border-green-500 text-transparent hover:text-green-300"
          }`}
        >
          <Check size={14} strokeWidth={3} />
        </button>
        <div className="flex-1 min-w-0 cursor-pointer select-none" onClick={() => onToggleChecked(item)}>
          <p className={`text-sm transition-all ${item.checked ? "line-through text-stone-400" : "text-stone-800 font-medium"}`}>{item.name}</p>
          {item.addedBy && (
            <p className="text-xs text-stone-400 mt-0.5">
              {item.addedBy}
              {item.checked && item.checkedBy && <span className="text-stone-300"> &middot; checked by {item.checkedBy}</span>}
            </p>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePriority(item); }}
          className={`flex-shrink-0 p-1.5 rounded-lg transition-all active:scale-90 ${
            item.priority ? "text-amber-500 hover:text-amber-600" : item.checked ? "text-stone-200" : "text-stone-200 hover:text-amber-400"
          } ${!showActions && !item.priority && !swiped ? "sm:opacity-0" : "sm:opacity-100"}`}
        >
          <Star size={16} fill={item.priority ? "currentColor" : "none"} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
          className={`flex-shrink-0 p-1.5 rounded-lg text-stone-300 hover:text-red-500 hover:bg-red-50 transition-all active:scale-90 ${
            !showActions && !swiped ? "sm:opacity-0" : "sm:opacity-100"
          }`}
        >
          <X size={16} />
        </button>
      </div>
      {swiped && (
        <button onClick={() => { setSwiped(false); onDelete(item.id); }} className="absolute inset-y-0 right-0 w-20 z-10" />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Inventory (In Stock) Tab
// ═══════════════════════════════════════════════════════════════
function InventoryTab({
  userName,
  onUpdateUserName,
}: {
  userName: string;
  onUpdateUserName: (name: string) => void;
}) {
  const [items, setItems] = useState<PantryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("All");
  const [showCategoryFilter, setShowCategoryFilter] = useState(false);

  // Quick add
  const [newName, setNewName] = useState("");
  const [newQuantity, setNewQuantity] = useState("1");
  const [newUnit, setNewUnit] = useState("");
  const [newCategory, setNewCategory] = useState<string>("General");
  const [showNewCategoryPicker, setShowNewCategoryPicker] = useState(false);
  const [adding, setAdding] = useState(false);

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [editNotes, setEditNotes] = useState("");

  // Move to grocery
  const [movingToGrocery, setMovingToGrocery] = useState<string | null>(null);

  // Scan
  const [scanMode, setScanMode] = useState<"off" | "camera" | "scanning" | "review">("off");
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [addingScanned, setAddingScanned] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const categoryFilterRef = useRef<HTMLDivElement>(null);
  const newCategoryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (categoryFilterRef.current && !categoryFilterRef.current.contains(e.target as Node)) setShowCategoryFilter(false);
      if (newCategoryRef.current && !newCategoryRef.current.contains(e.target as Node)) setShowNewCategoryPicker(false);
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
      if (res.ok) setItems(await res.json());
    } catch (err) {
      console.error("Failed to fetch pantry items:", err);
    }
    setLoading(false);
  }, [searchQuery, filterCategory]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // ─── Camera helpers ────────────────────────────────────────
  const startCamera = async () => {
    try {
      setScanMode("camera");
      setCameraReady(false);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraReady(true);
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(() => setScanMode("off"));
        };
        setTimeout(() => {
          videoRef.current?.play().catch(() => {});
        }, 500);
      }
    } catch {
      setScanMode("off");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  };

  const captureAndScan = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    stopCamera();
    setScanMode("scanning");

    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    const base64 = dataUrl.split(",")[1];

    try {
      const res = await fetch("/api/pantry/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, fileType: "image/jpeg" }),
      });
      if (res.ok) {
        const { items: identified } = await res.json();
        setScannedItems(identified.map((i: Omit<ScannedItem, "selected">) => ({ ...i, selected: true })));
        setScanMode("review");
      } else {
        setScanMode("off");
      }
    } catch {
      setScanMode("off");
    }
  };

  const addScannedItems = async () => {
    const toAdd = scannedItems.filter((i) => i.selected);
    if (toAdd.length === 0) return;
    setAddingScanned(true);

    for (const item of toAdd) {
      try {
        await fetch("/api/pantry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: item.name,
            category: item.category,
            quantity: item.quantity,
            unit: item.unit,
            updatedBy: userName || null,
          }),
        });
      } catch {
        // Continue with remaining items
      }
    }

    setAddingScanned(false);
    setScanMode("off");
    setScannedItems([]);
    fetchItems();
  };

  const cancelScan = () => {
    stopCamera();
    setScanMode("off");
    setScannedItems([]);
  };

  // ─── Pantry CRUD helpers ───────────────────────────────────
  const addItem = async () => {
    const name = newName.trim();
    if (!name || adding) return;
    setAdding(true);

    const tempId = `temp-${Date.now()}`;
    const optimisticItem: PantryItem = {
      id: tempId, name, category: newCategory, quantity: parseInt(newQuantity, 10) || 1,
      unit: newUnit.trim() || null, expiresAt: null, notes: null,
      updatedBy: userName || null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    setItems((prev) => [...prev, optimisticItem]);
    setNewName(""); setNewQuantity("1"); setNewUnit("");
    inputRef.current?.focus();

    try {
      const res = await fetch("/api/pantry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category: newCategory, quantity: parseInt(newQuantity, 10) || 1, unit: newUnit.trim() || null, updatedBy: userName || null }),
      });
      if (res.ok) {
        const created = await res.json();
        setItems((prev) => prev.map((item) => (item.id === tempId ? created : item)));
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
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, quantity: newQty, updatedBy: userName || i.updatedBy } : i)));
    try {
      await fetch(`/api/pantry/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: newQty, updatedBy: userName || null }),
      });
      if (newQty === 0) setMovingToGrocery(item.id);
    } catch {
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
    }
  };

  const moveToGroceryList = async (item: PantryItem) => {
    try {
      await fetch("/api/grocery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: item.name + (item.unit ? ` (${item.unit})` : ""), addedBy: userName || null }),
      });
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
      if (!res.ok && removedItem) setItems((prev) => [...prev, removedItem]);
    } catch {
      if (removedItem) setItems((prev) => [...prev, removedItem]);
    }
  };

  const startEdit = (item: PantryItem) => {
    setEditingId(item.id); setEditName(item.name); setEditQuantity(item.quantity.toString());
    setEditUnit(item.unit || ""); setEditNotes(item.notes || "");
  };

  const saveEdit = async (item: PantryItem) => {
    if (!editName.trim()) return;
    const updated = { name: editName.trim(), quantity: parseInt(editQuantity, 10) || 1, unit: editUnit.trim() || null, notes: editNotes.trim() || null, updatedBy: userName || null };
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...updated } : i)));
    setEditingId(null);
    try {
      await fetch(`/api/pantry/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) });
    } catch {
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
    }
  };

  // Group items
  const groupedByCategory: Record<string, PantryItem[]> = {};
  for (const cat of PANTRY_CATEGORIES) {
    const catItems = items.filter((i) => i.category === cat);
    if (catItems.length > 0) groupedByCategory[cat] = catItems;
  }
  const otherPantryItems = items.filter((i) => !(PANTRY_CATEGORIES as readonly string[]).includes(i.category));
  if (otherPantryItems.length > 0) groupedByCategory["Other"] = [...(groupedByCategory["Other"] || []), ...otherPantryItems];

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);

  const formatTimeAgo = (dateStr: string): string => {
    const date = new Date(dateStr);
    const diffMs = Date.now() - date.getTime();
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

  // ─── Scan overlay ──────────────────────────────────────────
  if (scanMode !== "off") {
    return (
      <>
        <canvas ref={canvasRef} className="hidden" />

        {scanMode === "camera" && (
          <div className="space-y-4">
            <div className="relative rounded-xl overflow-hidden bg-black">
              <video ref={videoRef} autoPlay playsInline muted className="w-full" />
              {cameraReady && (
                <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                  <button
                    onClick={captureAndScan}
                    className="w-16 h-16 rounded-full bg-white border-4 border-teal-600 shadow-lg active:scale-95 transition-transform"
                  />
                </div>
              )}
            </div>
            <button
              onClick={cancelScan}
              className="w-full py-3 rounded-xl border-2 border-stone-300 text-stone-600 font-medium hover:bg-stone-50"
            >
              Cancel
            </button>
          </div>
        )}

        {scanMode === "scanning" && (
          <div className="text-center py-16">
            <Loader2 size={48} className="mx-auto text-teal-600 animate-spin mb-4" />
            <p className="text-stone-600 font-medium">Identifying pantry items...</p>
            <p className="text-stone-400 text-sm mt-1">AI is analyzing your photo</p>
          </div>
        )}

        {scanMode === "review" && (
          <div className="space-y-4">
            <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
              <h3 className="font-semibold text-teal-800 flex items-center gap-2">
                <CheckCircle2 size={18} />
                Found {scannedItems.length} items
              </h3>
              <p className="text-teal-700 text-sm mt-1">
                Tap items to select/deselect, then add to inventory.
              </p>
            </div>

            <div className="space-y-1.5">
              {scannedItems.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() =>
                    setScannedItems((prev) =>
                      prev.map((si, i) => (i === idx ? { ...si, selected: !si.selected } : si))
                    )
                  }
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border transition-all text-left ${
                    item.selected
                      ? "bg-white border-teal-300 shadow-sm"
                      : "bg-stone-50 border-stone-100 opacity-50"
                  }`}
                >
                  <div className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                    item.selected ? "bg-teal-600 border-teal-600 text-white" : "border-stone-300"
                  }`}>
                    {item.selected && <Check size={14} strokeWidth={3} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-stone-800">{item.name}</span>
                    <span className="text-xs text-stone-400 ml-2">
                      {item.quantity} {item.unit}
                    </span>
                  </div>
                  <span className="text-xs text-stone-400 bg-stone-100 rounded-full px-2 py-0.5">
                    {PANTRY_EMOJI[item.category] || "📦"} {item.category}
                  </span>
                </button>
              ))}
            </div>

            {scannedItems.length === 0 && (
              <div className="text-center py-8">
                <p className="text-stone-500">No items identified. Try taking another photo with better lighting.</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={cancelScan}
                className="flex-1 py-3 rounded-xl border-2 border-stone-300 text-stone-600 font-medium hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                onClick={() => { cancelScan(); startCamera(); }}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-teal-300 text-teal-700 font-medium hover:bg-teal-50"
              >
                <RotateCcw size={16} />
                Retake
              </button>
              <button
                onClick={addScannedItems}
                disabled={addingScanned || scannedItems.filter((i) => i.selected).length === 0}
                className="flex-1 py-3 rounded-xl bg-teal-600 text-white font-medium hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {addingScanned ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                Add {scannedItems.filter((i) => i.selected).length} items
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // ─── Normal inventory view ─────────────────────────────────
  return (
    <>
      <canvas ref={canvasRef} className="hidden" />

      {/* Scan Pantry button */}
      <button
        onClick={startCamera}
        className="w-full flex items-center justify-center gap-3 bg-teal-600 text-white py-3.5 rounded-xl text-base font-medium hover:bg-teal-700 transition-colors active:scale-[0.98]"
      >
        <Camera size={20} />
        Scan Pantry
      </button>

      {/* Quick Add Bar */}
      <div className="bg-white rounded-xl border border-stone-200 p-3 shadow-sm">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addItem(); }}
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
            {adding ? <Loader2 size={20} className="animate-spin" /> : <Plus size={20} strokeWidth={2.5} />}
            <span className="hidden sm:inline">Add</span>
          </button>
        </div>
        <div className="flex items-center gap-2 mt-2.5">
          <div className="relative" ref={newCategoryRef}>
            <button
              onClick={() => setShowNewCategoryPicker(!showNewCategoryPicker)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-stone-100 hover:bg-stone-200 text-sm text-stone-600 transition-colors"
            >
              <span>{PANTRY_EMOJI[newCategory] || "📦"}</span>
              <span>{newCategory}</span>
              <ChevronDown size={14} className={`transition-transform ${showNewCategoryPicker ? "rotate-180" : ""}`} />
            </button>
            {showNewCategoryPicker && (
              <div className="absolute top-full left-0 mt-1 bg-white rounded-xl border border-stone-200 shadow-lg py-1 z-40 min-w-[200px]">
                {PANTRY_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => { setNewCategory(cat); setShowNewCategoryPicker(false); inputRef.current?.focus(); }}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-stone-50 transition-colors ${newCategory === cat ? "text-green-700 font-medium bg-green-50" : "text-stone-600"}`}
                  >
                    <span>{PANTRY_EMOJI[cat]}</span>
                    <span>{cat}</span>
                    {newCategory === cat && <Check size={14} className="ml-auto text-green-600" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-xs text-stone-400 hidden sm:inline">Adding as:</span>
            <input
              type="text"
              value={userName}
              onChange={(e) => onUpdateUserName(e.target.value)}
              placeholder="Your name"
              className="w-24 sm:w-28 px-2.5 py-1.5 rounded-lg border border-stone-200 text-xs text-stone-600 focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-transparent bg-stone-50"
            />
          </div>
        </div>
      </div>

      {/* Search and filter */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search pantry..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="relative" ref={categoryFilterRef}>
          <button
            onClick={() => setShowCategoryFilter(!showCategoryFilter)}
            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm transition-colors ${
              filterCategory !== "All" ? "border-green-300 bg-green-50 text-green-700" : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
            }`}
          >
            <span>{filterCategory === "All" ? "All" : PANTRY_EMOJI[filterCategory] || "📦"}</span>
            <ChevronDown size={14} className={`transition-transform ${showCategoryFilter ? "rotate-180" : ""}`} />
          </button>
          {showCategoryFilter && (
            <div className="absolute top-full right-0 mt-1 bg-white rounded-xl border border-stone-200 shadow-lg py-1 z-40 min-w-[200px]">
              <button onClick={() => { setFilterCategory("All"); setShowCategoryFilter(false); }} className={`w-full text-left px-3 py-2 text-sm hover:bg-stone-50 transition-colors ${filterCategory === "All" ? "text-green-700 font-medium bg-green-50" : "text-stone-600"}`}>
                All categories
              </button>
              {PANTRY_CATEGORIES.map((cat) => (
                <button key={cat} onClick={() => { setFilterCategory(cat); setShowCategoryFilter(false); }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-stone-50 transition-colors ${filterCategory === cat ? "text-green-700 font-medium bg-green-50" : "text-stone-600"}`}>
                  <span>{PANTRY_EMOJI[cat]}</span>
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
          <span className="text-sm text-stone-500"><span className="font-semibold text-stone-700">{items.length}</span> items</span>
          <span className="text-sm text-stone-400">{totalItems} total units</span>
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-white rounded-xl h-16 animate-pulse border border-stone-100" />
          ))}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-center py-16">
          <div className="w-20 h-20 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
            <Package size={36} className="text-green-300" />
          </div>
          <p className="text-stone-500 font-medium text-lg">Pantry is empty</p>
          <p className="text-stone-400 text-sm mt-1.5 max-w-xs mx-auto">
            {searchQuery || filterCategory !== "All"
              ? "No items match your search."
              : "Scan the pantry or add items above."}
          </p>
        </div>
      )}

      {/* Category groups */}
      {!loading &&
        Object.entries(groupedByCategory).map(([category, catItems]) => (
          <section key={category}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">{PANTRY_EMOJI[category] || "📦"}</span>
              <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider">{category}</h3>
              <span className="text-xs text-stone-400 font-medium bg-stone-100 rounded-full px-2 py-0.5">{catItems.length}</span>
            </div>
            <div className="space-y-1.5">
              {catItems.map((item) => (
                <div key={item.id}>
                  {item.quantity === 0 && movingToGrocery === item.id && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-1.5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <ShoppingCart size={16} className="text-amber-600" />
                        <span className="text-sm text-amber-800">Out of <span className="font-medium">{item.name}</span>. Add to shopping list?</span>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <button onClick={() => moveToGroceryList(item)} className="px-3 py-1 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 transition-colors active:scale-95">Add to list</button>
                        <button onClick={() => deleteItem(item.id)} className="px-3 py-1 rounded-lg text-stone-500 text-xs hover:bg-stone-100 transition-colors">Remove</button>
                        <button onClick={() => setMovingToGrocery(null)} className="p-1 rounded-lg text-stone-400 hover:text-stone-600 transition-colors"><X size={14} /></button>
                      </div>
                    </div>
                  )}

                  {editingId === item.id ? (
                    <div className="bg-white rounded-xl border border-green-200 p-3 shadow-sm">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="col-span-2 px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="Item name" autoFocus />
                        <input type="number" value={editQuantity} onChange={(e) => setEditQuantity(e.target.value)} min="0" className="px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="Qty" />
                        <input type="text" value={editUnit} onChange={(e) => setEditUnit(e.target.value)} className="px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="Unit" />
                      </div>
                      <input type="text" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="w-full mt-2 px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="Notes (optional)" />
                      <div className="flex gap-2 justify-end mt-2">
                        <button onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded-lg text-sm text-stone-600 hover:bg-stone-100 transition-colors">Cancel</button>
                        <button onClick={() => saveEdit(item)} className="px-3 py-1.5 rounded-lg bg-green-700 text-white text-sm font-medium hover:bg-green-800 transition-colors active:scale-95">Save</button>
                      </div>
                    </div>
                  ) : (
                    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${item.quantity === 0 ? "bg-stone-50 border-stone-100 opacity-60" : "bg-white border-stone-200 shadow-sm"}`}>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => adjustQuantity(item, -1)} className="w-7 h-7 rounded-lg bg-stone-100 hover:bg-red-100 hover:text-red-600 flex items-center justify-center text-stone-500 transition-colors active:scale-90"><Minus size={14} strokeWidth={2.5} /></button>
                        <div className="w-10 text-center">
                          <span className={`text-lg font-bold ${item.quantity === 0 ? "text-red-400" : item.quantity <= 2 ? "text-amber-600" : "text-stone-800"}`}>{item.quantity}</span>
                        </div>
                        <button onClick={() => adjustQuantity(item, 1)} className="w-7 h-7 rounded-lg bg-stone-100 hover:bg-green-100 hover:text-green-600 flex items-center justify-center text-stone-500 transition-colors active:scale-90"><Plus size={14} strokeWidth={2.5} /></button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-sm font-medium text-stone-800 truncate">{item.name}</span>
                          {item.unit && <span className="text-xs text-stone-400 flex-shrink-0">{item.unit}</span>}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-stone-400 mt-0.5">
                          {item.updatedBy && <span>{item.updatedBy}</span>}
                          <span>{formatTimeAgo(item.updatedAt)}</span>
                          {item.notes && <span className="text-stone-300 italic truncate">{item.notes}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => startEdit(item)} className="p-1.5 rounded-lg text-stone-300 hover:text-green-600 hover:bg-green-50 transition-colors"><Pencil size={14} /></button>
                        <button onClick={() => deleteItem(item.id)} className="p-1.5 rounded-lg text-stone-300 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
    </>
  );
}
