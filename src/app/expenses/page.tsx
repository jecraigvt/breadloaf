"use client";

import { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/layout/header";
import {
  Plus,
  Loader2,
  X,
  Trash2,
  DollarSign,
  TrendingUp,
  Users,
  PieChart,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  Filter,
} from "lucide-react";

interface Expense {
  id: string;
  date: string;
  amount: number;
  description: string;
  category: string;
  type: string;
  paidBy: string;
  vendor: string | null;
  documentId: string | null;
  notes: string | null;
  fiscalYear: number;
  createdAt: string;
}

interface Summary {
  year: number;
  total: number;
  expenseCount: number;
  byCategory: Record<string, number>;
  byType: Record<string, number>;
  byPayer: Record<string, number>;
  perFamilyShare: number;
  familyBalances: Record<string, { paid: number; owes: number; balance: number }>;
  availableYears: number[];
}

type ViewMode = "dashboard" | "list";

const CATEGORIES = [
  { value: "utilities", label: "Utilities", emoji: "💡" },
  { value: "maintenance", label: "Maintenance", emoji: "🔧" },
  { value: "insurance", label: "Insurance", emoji: "🛡️" },
  { value: "taxes", label: "Taxes", emoji: "🏛️" },
  { value: "improvements", label: "Improvements", emoji: "🏗️" },
  { value: "supplies", label: "Supplies", emoji: "📦" },
  { value: "professional-services", label: "Professional Services", emoji: "💼" },
  { value: "other", label: "Other", emoji: "📋" },
];

const FAMILIES = ["Tom", "Jim", "Sandy", "Greg", "Shared"];
const TYPES = [
  { value: "operating", label: "Operating" },
  { value: "capital", label: "Capital" },
];

const CATEGORY_EMOJI: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.emoji])
);

export default function ExpensesPage() {
  const [view, setView] = useState<ViewMode>("dashboard");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [filterCategory, setFilterCategory] = useState("");
  const [filterPaidBy, setFilterPaidBy] = useState("");
  const [filterType, setFilterType] = useState("");

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [formDate, setFormDate] = useState(new Date().toISOString().split("T")[0]);
  const [formAmount, setFormAmount] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formCategory, setFormCategory] = useState("other");
  const [formType, setFormType] = useState("operating");
  const [formPaidBy, setFormPaidBy] = useState("Shared");
  const [formVendor, setFormVendor] = useState("");
  const [formNotes, setFormNotes] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ year: String(selectedYear) });
    if (filterCategory) params.set("category", filterCategory);
    if (filterPaidBy) params.set("paidBy", filterPaidBy);
    if (filterType) params.set("type", filterType);

    const [expRes, sumRes] = await Promise.all([
      fetch(`/api/expenses?${params.toString()}`),
      fetch(`/api/expenses/summary?year=${selectedYear}`),
    ]);

    if (expRes.ok) setExpenses(await expRes.json());
    if (sumRes.ok) setSummary(await sumRes.json());
    setLoading(false);
  }, [selectedYear, filterCategory, filterPaidBy, filterType]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const addExpense = async () => {
    if (!formAmount || !formDesc || adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: formDate,
          amount: parseFloat(formAmount),
          description: formDesc,
          category: formCategory,
          type: formType,
          paidBy: formPaidBy,
          vendor: formVendor || undefined,
          notes: formNotes || undefined,
        }),
      });
      if (res.ok) {
        setFormAmount(""); setFormDesc(""); setFormVendor(""); setFormNotes("");
        setShowAdd(false);
        fetchData();
      }
    } catch {
      // error
    }
    setAdding(false);
  };

  const deleteExpense = async (id: string) => {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    try {
      await fetch(`/api/expenses/${id}`, { method: "DELETE" });
      fetchData();
    } catch {
      fetchData();
    }
  };

  const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

  const availableYears = summary?.availableYears?.length
    ? summary.availableYears
    : [new Date().getFullYear()];

  return (
    <div className="min-h-screen bg-stone-50">
      <Header title="Finances" subtitle="S-Corp expense tracking & family splits" />

      <div className="max-w-5xl mx-auto px-4 py-4 pb-24 space-y-4">
        {/* Controls bar */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Year selector */}
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-sm font-medium text-stone-700 focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {availableYears.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
            {!availableYears.includes(new Date().getFullYear()) && (
              <option value={new Date().getFullYear()}>{new Date().getFullYear()}</option>
            )}
          </select>

          {/* View toggle */}
          <div className="flex bg-stone-200/60 rounded-lg p-0.5">
            <button
              onClick={() => setView("dashboard")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                view === "dashboard" ? "bg-white text-stone-800 shadow-sm" : "text-stone-500"
              }`}
            >
              <PieChart size={14} className="inline mr-1" />
              Dashboard
            </button>
            <button
              onClick={() => setView("list")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                view === "list" ? "bg-white text-stone-800 shadow-sm" : "text-stone-500"
              }`}
            >
              <Filter size={14} className="inline mr-1" />
              All Expenses
            </button>
          </div>

          <div className="ml-auto">
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-green-700 text-white text-sm font-medium hover:bg-green-800 transition-colors active:scale-95"
            >
              <Plus size={16} />
              Add Expense
            </button>
          </div>
        </div>

        {/* Add expense form */}
        {showAdd && (
          <div className="bg-white rounded-xl border border-green-200 p-4 shadow-sm space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Date</label>
                <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Amount ($)</label>
                <input type="number" step="0.01" value={formAmount} onChange={(e) => setFormAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Category</label>
                <select value={formCategory} onChange={(e) => setFormCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Type</label>
                <select value={formType} onChange={(e) => setFormType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-stone-500 mb-1">Description</label>
                <input type="text" value={formDesc} onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="What was this expense for?"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Paid By</label>
                <select value={formPaidBy} onChange={(e) => setFormPaidBy(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  {FAMILIES.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Vendor (optional)</label>
                <input type="text" value={formVendor} onChange={(e) => setFormVendor(e.target.value)}
                  placeholder="Company or contractor name"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Notes (optional)</label>
                <input type="text" value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Additional details"
                  className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-lg text-sm text-stone-600 hover:bg-stone-100 transition-colors">Cancel</button>
              <button onClick={addExpense} disabled={!formAmount || !formDesc || adding}
                className="px-4 py-2 rounded-lg bg-green-700 text-white text-sm font-medium hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5">
                {adding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Add Expense
              </button>
            </div>
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl h-20 animate-pulse border border-stone-100" />
            ))}
          </div>
        )}

        {/* Dashboard View */}
        {!loading && view === "dashboard" && summary && (
          <>
            {/* Top stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-stone-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                    <DollarSign size={16} className="text-green-700" />
                  </div>
                </div>
                <p className="text-xl font-bold text-stone-800">{fmt(summary.total)}</p>
                <p className="text-xs text-stone-400 mt-0.5">Total {selectedYear}</p>
              </div>
              <div className="bg-white rounded-xl border border-stone-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                    <Users size={16} className="text-blue-700" />
                  </div>
                </div>
                <p className="text-xl font-bold text-stone-800">{fmt(summary.perFamilyShare)}</p>
                <p className="text-xs text-stone-400 mt-0.5">Per family (1/4)</p>
              </div>
              <div className="bg-white rounded-xl border border-stone-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                    <TrendingUp size={16} className="text-amber-700" />
                  </div>
                </div>
                <p className="text-xl font-bold text-stone-800">{fmt(summary.byType.operating || 0)}</p>
                <p className="text-xs text-stone-400 mt-0.5">Operating</p>
              </div>
              <div className="bg-white rounded-xl border border-stone-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                    <TrendingUp size={16} className="text-purple-700" />
                  </div>
                </div>
                <p className="text-xl font-bold text-stone-800">{fmt(summary.byType.capital || 0)}</p>
                <p className="text-xs text-stone-400 mt-0.5">Capital</p>
              </div>
            </div>

            {/* Family balances */}
            <div className="bg-white rounded-xl border border-stone-200 p-4">
              <h3 className="text-sm font-semibold text-stone-700 mb-3 flex items-center gap-2">
                <Users size={16} className="text-stone-400" />
                Family Balances
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {["Tom", "Jim", "Sandy", "Greg"].map((name) => {
                  const bal = summary.familyBalances[name];
                  if (!bal) return null;
                  const isOver = bal.balance > 0;
                  const isUnder = bal.balance < 0;
                  return (
                    <div key={name} className="rounded-xl bg-stone-50 p-3">
                      <p className="text-sm font-semibold text-stone-700">{name}</p>
                      <p className="text-xs text-stone-400 mt-1">Paid: {fmt(bal.paid)}</p>
                      <p className="text-xs text-stone-400">Share: {fmt(bal.owes)}</p>
                      <div className={`flex items-center gap-1 mt-2 text-sm font-bold ${
                        isOver ? "text-green-600" : isUnder ? "text-red-500" : "text-stone-500"
                      }`}>
                        {isOver ? <ArrowUpRight size={14} /> : isUnder ? <ArrowDownRight size={14} /> : null}
                        {isOver ? `+${fmt(bal.balance)}` : fmt(bal.balance)}
                      </div>
                      <p className="text-[10px] text-stone-400">
                        {isOver ? "Owed back" : isUnder ? "Owes" : "Even"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* By category breakdown */}
            <div className="bg-white rounded-xl border border-stone-200 p-4">
              <h3 className="text-sm font-semibold text-stone-700 mb-3 flex items-center gap-2">
                <PieChart size={16} className="text-stone-400" />
                By Category
              </h3>
              {Object.keys(summary.byCategory).length === 0 ? (
                <p className="text-sm text-stone-400">No expenses recorded for {selectedYear}.</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(summary.byCategory)
                    .sort(([, a], [, b]) => b - a)
                    .map(([cat, amount]) => {
                      const pct = summary.total > 0 ? (amount / summary.total) * 100 : 0;
                      const catInfo = CATEGORIES.find((c) => c.value === cat);
                      return (
                        <div key={cat}>
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="text-stone-600">
                              {catInfo?.emoji || "📋"} {catInfo?.label || cat}
                            </span>
                            <span className="font-medium text-stone-700">{fmt(amount)}</span>
                          </div>
                          <div className="w-full bg-stone-100 rounded-full h-2">
                            <div
                              className="bg-green-600 h-2 rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Recent expenses */}
            <div className="bg-white rounded-xl border border-stone-200 p-4">
              <h3 className="text-sm font-semibold text-stone-700 mb-3 flex items-center gap-2">
                <Calendar size={16} className="text-stone-400" />
                Recent Expenses
              </h3>
              {expenses.length === 0 ? (
                <p className="text-sm text-stone-400">No expenses yet. Add one above!</p>
              ) : (
                <div className="space-y-2">
                  {expenses.slice(0, 10).map((e) => (
                    <ExpenseRow key={e.id} expense={e} onDelete={deleteExpense} />
                  ))}
                  {expenses.length > 10 && (
                    <button onClick={() => setView("list")} className="w-full text-center text-sm text-green-700 hover:text-green-800 py-2">
                      View all {expenses.length} expenses
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* List View */}
        {!loading && view === "list" && (
          <>
            {/* Filters */}
            <div className="flex gap-2 flex-wrap">
              <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
                className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-sm text-stone-600 focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="">All Categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>
                ))}
              </select>
              <select value={filterPaidBy} onChange={(e) => setFilterPaidBy(e.target.value)}
                className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-sm text-stone-600 focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="">All Payers</option>
                {FAMILIES.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
                className="px-3 py-2 rounded-xl border border-stone-200 bg-white text-sm text-stone-600 focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="">All Types</option>
                <option value="operating">Operating</option>
                <option value="capital">Capital</option>
              </select>
              {(filterCategory || filterPaidBy || filterType) && (
                <button onClick={() => { setFilterCategory(""); setFilterPaidBy(""); setFilterType(""); }}
                  className="px-3 py-2 rounded-xl text-sm text-red-600 hover:bg-red-50 flex items-center gap-1 transition-colors">
                  <X size={14} /> Clear
                </button>
              )}
            </div>

            {/* Summary line */}
            <div className="flex items-center gap-3 text-sm text-stone-500">
              <span><span className="font-semibold text-stone-700">{expenses.length}</span> expenses</span>
              <span>{fmt(expenses.reduce((s, e) => s + e.amount, 0))} total</span>
            </div>

            {expenses.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-20 h-20 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
                  <DollarSign size={36} className="text-green-300" />
                </div>
                <p className="text-stone-500 font-medium text-lg">No expenses found</p>
                <p className="text-stone-400 text-sm mt-1.5">
                  {filterCategory || filterPaidBy || filterType ? "Try adjusting your filters." : "Add your first expense above."}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {expenses.map((e) => (
                  <ExpenseRow key={e.id} expense={e} onDelete={deleteExpense} showCategory />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ExpenseRow({
  expense: e,
  onDelete,
  showCategory,
}: {
  expense: Expense;
  onDelete: (id: string) => void;
  showCategory?: boolean;
}) {
  const [showActions, setShowActions] = useState(false);

  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white border border-stone-200 shadow-sm"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="w-9 h-9 rounded-lg bg-stone-100 flex items-center justify-center flex-shrink-0 text-sm">
        {CATEGORY_EMOJI[e.category] || "📋"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-stone-800 truncate">{e.description}</span>
          {e.vendor && <span className="text-xs text-stone-400 hidden sm:inline">{e.vendor}</span>}
        </div>
        <div className="flex items-center gap-2 text-xs text-stone-400 mt-0.5">
          <span>{new Date(e.date).toLocaleDateString()}</span>
          <span>{e.paidBy}</span>
          {showCategory && (
            <span className="bg-stone-100 rounded-full px-1.5 py-0.5">{e.category}</span>
          )}
          {e.type === "capital" && (
            <span className="bg-purple-100 text-purple-700 rounded-full px-1.5 py-0.5">capital</span>
          )}
        </div>
      </div>
      <span className="text-sm font-bold text-stone-800 flex-shrink-0">
        ${e.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
      </span>
      <button
        onClick={() => onDelete(e.id)}
        className={`flex-shrink-0 p-1.5 rounded-lg text-stone-300 hover:text-red-500 hover:bg-red-50 transition-all ${
          showActions ? "sm:opacity-100" : "sm:opacity-0"
        }`}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
