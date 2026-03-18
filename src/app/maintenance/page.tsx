"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import {
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  Wrench,
  Calendar,
  DollarSign,
  User,
  Filter,
  X,
  ChevronDown,
  ChevronUp,
  Pencil,
} from "lucide-react";

interface MaintenanceRecord {
  id: string;
  title: string;
  description: string | null;
  category: string;
  performedBy: string | null;
  performedAt: string;
  nextDueAt: string | null;
  cost: number | null;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = [
  "Septic",
  "Plumbing",
  "Electrical",
  "Roofing",
  "HVAC",
  "Grounds",
  "Pest Control",
  "Appliances",
  "General",
];

const CATEGORY_COLORS: Record<string, string> = {
  Septic: "bg-amber-100 text-amber-700",
  Plumbing: "bg-blue-100 text-blue-700",
  Electrical: "bg-yellow-100 text-yellow-700",
  Roofing: "bg-orange-100 text-orange-700",
  HVAC: "bg-cyan-100 text-cyan-700",
  Grounds: "bg-green-100 text-green-700",
  "Pest Control": "bg-red-100 text-red-700",
  Appliances: "bg-purple-100 text-purple-700",
  General: "bg-stone-100 text-stone-700",
};

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isOverdue(nextDueAt: string | null): boolean {
  if (!nextDueAt) return false;
  return new Date(nextDueAt) < new Date();
}

function toInputDate(date: string | null): string {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
}

export default function MaintenancePage() {
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState("General");
  const [formPerformedBy, setFormPerformedBy] = useState("");
  const [formPerformedAt, setFormPerformedAt] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [formNextDueAt, setFormNextDueAt] = useState("");
  const [formCost, setFormCost] = useState("");

  useEffect(() => {
    fetchRecords();
  }, [filterCategory]);

  const fetchRecords = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterCategory !== "All") params.set("category", filterCategory);
    const res = await fetch(`/api/maintenance?${params}`);
    if (res.ok) {
      setRecords(await res.json());
    }
    setLoading(false);
  };

  const resetForm = () => {
    setFormTitle("");
    setFormDescription("");
    setFormCategory("General");
    setFormPerformedBy("");
    setFormPerformedAt(new Date().toISOString().split("T")[0]);
    setFormNextDueAt("");
    setFormCost("");
    setEditingId(null);
  };

  const startEdit = (record: MaintenanceRecord) => {
    setFormTitle(record.title);
    setFormDescription(record.description || "");
    setFormCategory(record.category);
    setFormPerformedBy(record.performedBy || "");
    setFormPerformedAt(toInputDate(record.performedAt));
    setFormNextDueAt(toInputDate(record.nextDueAt));
    setFormCost(record.cost?.toString() || "");
    setEditingId(record.id);
    setShowForm(true);
  };

  const submitForm = async () => {
    if (!formTitle.trim() || !formPerformedAt) return;
    setSubmitting(true);

    const body = {
      title: formTitle,
      description: formDescription || null,
      category: formCategory,
      performedBy: formPerformedBy || null,
      performedAt: formPerformedAt,
      nextDueAt: formNextDueAt || null,
      cost: formCost || null,
    };

    const url = editingId
      ? `/api/maintenance/${editingId}`
      : "/api/maintenance";
    const method = editingId ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      resetForm();
      setShowForm(false);
      fetchRecords();
    }
    setSubmitting(false);
  };

  const deleteRecord = async (id: string) => {
    if (!confirm("Delete this maintenance record?")) return;
    await fetch(`/api/maintenance/${id}`, { method: "DELETE" });
    setRecords((prev) => prev.filter((r) => r.id !== id));
  };

  const overdueRecords = records.filter((r) => isOverdue(r.nextDueAt));

  return (
    <div>
      <Header
        title="Maintenance Log"
        subtitle="Property maintenance history and upcoming tasks"
      />

      <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {/* Overdue warnings */}
        {overdueRecords.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={18} className="text-red-600" />
              <span className="font-semibold text-red-800 text-sm">
                {overdueRecords.length} Overdue{" "}
                {overdueRecords.length === 1 ? "Item" : "Items"}
              </span>
            </div>
            <div className="space-y-1">
              {overdueRecords.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2 text-sm text-red-700"
                >
                  <span className="font-medium">{r.title}</span>
                  <span className="text-red-500">
                    — due {formatDate(r.nextDueAt!)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={() => {
              resetForm();
              setShowForm(!showForm);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-700 text-white text-sm font-medium hover:bg-green-800 transition-colors"
          >
            <Plus size={16} />
            Add Record
          </button>

          <div className="flex items-center gap-2 ml-auto">
            <Filter size={14} className="text-stone-400" />
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
            >
              <option value="All">All Categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Add/Edit form */}
        {showForm && (
          <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-stone-800 text-sm">
                {editingId ? "Edit Record" : "New Maintenance Record"}
              </h3>
              <button
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="p-1 text-stone-400 hover:text-stone-600"
              >
                <X size={16} />
              </button>
            </div>

            <input
              type="text"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="Title (e.g., Septic tank pumped)"
              className="w-full px-4 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              autoFocus
            />

            <textarea
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Description or notes (optional)"
              rows={2}
              className="w-full px-4 py-2.5 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-stone-500 mb-1">
                  Category
                </label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">
                  Performed By
                </label>
                <input
                  type="text"
                  value={formPerformedBy}
                  onChange={(e) => setFormPerformedBy(e.target.value)}
                  placeholder="Name or company"
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">
                  Date Performed
                </label>
                <input
                  type="date"
                  value={formPerformedAt}
                  onChange={(e) => setFormPerformedAt(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">
                  Next Due Date (optional)
                </label>
                <input
                  type="date"
                  value={formNextDueAt}
                  onChange={(e) => setFormNextDueAt(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">
                  Cost (optional)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    value={formCost}
                    onChange={(e) => setFormCost(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-7 pr-3 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={submitForm}
                disabled={!formTitle.trim() || !formPerformedAt || submitting}
                className="px-4 py-2 rounded-lg bg-green-700 text-white text-sm font-medium hover:bg-green-800 disabled:opacity-50 transition-colors"
              >
                {submitting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : editingId ? (
                  "Save Changes"
                ) : (
                  "Add Record"
                )}
              </button>
              <button
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="px-4 py-2 rounded-lg text-stone-500 text-sm hover:bg-stone-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Timeline */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-stone-100 rounded-xl h-28 animate-pulse"
              />
            ))}
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-12">
            <Wrench size={48} className="mx-auto text-stone-300 mb-3" />
            <p className="text-stone-500 font-medium">
              No maintenance records yet
            </p>
            <p className="text-stone-400 text-sm mt-1">
              Add your first record to start tracking
            </p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-6 top-0 bottom-0 w-px bg-stone-200 hidden sm:block" />

            <div className="space-y-3">
              {records.map((record) => {
                const overdue = isOverdue(record.nextDueAt);
                const isExpanded = expandedId === record.id;

                return (
                  <div
                    key={record.id}
                    className={`relative bg-white rounded-xl border p-4 sm:ml-12 ${
                      overdue
                        ? "border-red-200 bg-red-50/30"
                        : "border-stone-200"
                    }`}
                  >
                    {/* Timeline dot */}
                    <div
                      className={`absolute -left-[2.05rem] top-5 w-3 h-3 rounded-full border-2 border-white hidden sm:block ${
                        overdue ? "bg-red-500" : "bg-green-600"
                      }`}
                    />

                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-semibold text-stone-800 text-sm">
                            {record.title}
                          </h3>
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                              CATEGORY_COLORS[record.category] ||
                              CATEGORY_COLORS.General
                            }`}
                          >
                            {record.category}
                          </span>
                          {overdue && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                              <AlertTriangle size={10} />
                              Overdue
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-xs text-stone-400 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Calendar size={11} />
                            {formatDate(record.performedAt)}
                          </span>
                          {record.performedBy && (
                            <span className="flex items-center gap-1">
                              <User size={11} />
                              {record.performedBy}
                            </span>
                          )}
                          {record.cost != null && (
                            <span className="flex items-center gap-1">
                              <DollarSign size={11} />${record.cost.toFixed(2)}
                            </span>
                          )}
                          {record.nextDueAt && (
                            <span
                              className={`flex items-center gap-1 ${
                                overdue ? "text-red-500 font-medium" : ""
                              }`}
                            >
                              <Calendar size={11} />
                              Next: {formatDate(record.nextDueAt)}
                            </span>
                          )}
                        </div>

                        {/* Expandable description */}
                        {record.description && (
                          <button
                            onClick={() =>
                              setExpandedId(isExpanded ? null : record.id)
                            }
                            className="flex items-center gap-1 text-xs text-green-700 mt-2 hover:text-green-800"
                          >
                            {isExpanded ? (
                              <ChevronUp size={12} />
                            ) : (
                              <ChevronDown size={12} />
                            )}
                            {isExpanded ? "Hide details" : "Show details"}
                          </button>
                        )}
                        {isExpanded && record.description && (
                          <p className="text-sm text-stone-600 mt-2 bg-stone-50 rounded-lg p-3">
                            {record.description}
                          </p>
                        )}
                      </div>

                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          onClick={() => startEdit(record)}
                          className="p-1.5 rounded-lg text-stone-300 hover:text-green-600 hover:bg-green-50 transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => deleteRecord(record.id)}
                          className="p-1.5 rounded-lg text-stone-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
