"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Plus, ShoppingCart, Star, Trash2 } from "lucide-react";
import { Header } from "@/components/layout/header";
import { resolveCategory } from "@/lib/grocery-categories";
import { requestSavedState } from "@/lib/saved-state";

interface GroceryItem { id: string; name: string; checked: boolean; priority: boolean; addedBy: string | null; checkedBy: string | null; createdAt: string; }

export default function ShoppingList() {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const pending = useRef(new Set<string>());
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await requestSavedState<GroceryItem[]>("/api/grocery", { cache: "no-store" })); setError(""); }
    catch { setError("The shopping list could not be loaded. Try again."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { setUsername(localStorage.getItem("breadloaf-username") || ""); void load(); }, [load]);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value || adding) return;
    setAdding(true); setError("");
    try {
      const created = await requestSavedState<GroceryItem>("/api/grocery", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: value, category: resolveCategory(null, value), addedBy: username || null }),
      });
      setItems(previous => [created, ...previous]); setName(""); input.current?.focus();
    } catch { setError("The item was not saved. Your text is still here; try again."); }
    finally { setAdding(false); }
  };

  const change = async (item: GroceryItem, patch: Partial<GroceryItem> | null) => {
    if (pending.current.has(item.id) || clearing) return;
    pending.current.add(item.id); setBusy(new Set(pending.current)); setError("");
    setItems(previous => patch ? previous.map(row => row.id === item.id ? { ...row, ...patch } : row) : previous.filter(row => row.id !== item.id));
    try {
      const saved = await requestSavedState<GroceryItem>(`/api/grocery/${item.id}`, {
        method: patch ? "PATCH" : "DELETE", headers: { "Content-Type": "application/json" },
        ...(patch ? { body: JSON.stringify(patch) } : {}),
      });
      if (patch) setItems(previous => previous.map(row => row.id === item.id ? saved : row));
    } catch {
      setItems(previous => patch ? previous.map(row => row.id === item.id ? item : row) : [...previous, item]);
      setError(`Could not save the change to ${item.name}. The previous state has been restored.`);
    } finally { pending.current.delete(item.id); setBusy(new Set(pending.current)); }
  };

  const clear = async () => {
    if (clearing || pending.current.size) return;
    const checked = items.filter(item => item.checked);
    if (!checked.length) return;
    setClearing(true); setError(""); setItems(previous => previous.filter(item => !item.checked));
    try { await requestSavedState("/api/grocery", { method: "DELETE" }); }
    catch { setItems(previous => [...previous, ...checked]); setError("Bought items could not be cleared. They have been restored."); }
    finally { setClearing(false); }
  };

  const sorted = [...items].sort((a, b) => Number(a.checked) - Number(b.checked) || Number(b.priority) - Number(a.priority));
  const needed = items.filter(item => !item.checked).length;
  return <div className="fade-in">
    <Header title="Shopping List" subtitle="Add what we need. Check it off when it’s bought." />
    <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
      <form onSubmit={add} className="flex gap-2">
        <label htmlFor="shopping-item" className="sr-only">Item to buy</label>
        <input id="shopping-item" ref={input} value={name} onChange={event => setName(event.target.value)} placeholder="Milk, coffee, paper towels…" maxLength={200} disabled={adding || clearing || loading} className="flex-1 min-w-0 p-3 border border-stone-300 rounded-lg bg-white" />
        <button aria-label="Add item to shopping list" disabled={!name.trim() || adding || clearing || loading} className="btn-ember p-3 rounded-lg disabled:opacity-50">{adding ? <Loader2 className="animate-spin" size={20} /> : <Plus size={20} />}</button>
      </form>
      {error && <div role="alert" className="p-3 border border-red-200 rounded-lg text-red-800"><p>{error}</p>{!items.length && <button className="underline mt-2" onClick={() => void load()}>Try loading again</button>}</div>}
      <div className="flex justify-between items-center text-sm text-stone-600"><span>{needed} {needed === 1 ? "item" : "items"} needed</span>{items.some(item => item.checked) && <button onClick={() => void clear()} disabled={clearing || busy.size > 0} className="underline disabled:opacity-50">{clearing ? "Clearing…" : "Clear bought items"}</button>}</div>
      {loading ? <p role="status">Loading the shopping list…</p> : !items.length ? (!error && <div className="text-center py-8 text-stone-600"><ShoppingCart size={32} className="mx-auto mb-3" /><p>Nothing on the list. Add what you need for the next visit.</p></div>) : <ul className="space-y-2">
        {sorted.map(item => <li key={item.id} className={`flex items-center gap-2 p-3 border rounded-lg ${item.checked ? "bg-stone-100 border-stone-200" : "bg-white border-stone-300"}`}>
          <button role="checkbox" aria-checked={item.checked} aria-label={`${item.checked ? "Mark needed" : "Mark bought"}: ${item.name}`} disabled={busy.has(item.id) || clearing} onClick={() => void change(item, { checked: !item.checked, checkedBy: !item.checked ? username || null : null })} className={`w-10 h-10 border rounded-full flex-shrink-0 flex items-center justify-center disabled:opacity-50 ${item.checked ? "bg-green-700 text-white" : "border-stone-400"}`}><Check size={20} className={item.checked ? "" : "opacity-0"} /></button>
          <div className="flex-1 min-w-0"><p className={item.checked ? "line-through text-stone-500" : "text-stone-800"}>{item.name}</p><p className="text-xs text-stone-500">Added {new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{item.addedBy ? ` by ${item.addedBy}` : ""}</p>{item.checkedBy && item.checked && <p className="text-xs text-stone-500">Bought by {item.checkedBy}</p>}</div>
          <button aria-label={`${item.priority ? "Remove priority from" : "Prioritize"} ${item.name}`} aria-pressed={item.priority} disabled={busy.has(item.id) || clearing} onClick={() => void change(item, { priority: !item.priority })} className="p-3 text-amber-700 disabled:opacity-50"><Star size={18} fill={item.priority ? "currentColor" : "none"} /></button>
          <button aria-label={`Delete ${item.name}`} disabled={busy.has(item.id) || clearing} onClick={() => void change(item, null)} className="p-3 text-stone-600 hover:text-red-700 disabled:opacity-50"><Trash2 size={18} /></button>
        </li>)}
      </ul>}
      <label className="block text-sm text-stone-600">Your name (optional)<input value={username} onChange={event => { setUsername(event.target.value); localStorage.setItem("breadloaf-username", event.target.value); }} className="block w-full mt-1 p-2 border border-stone-300 rounded-lg bg-white" /></label>
    </div>
  </div>;
}
