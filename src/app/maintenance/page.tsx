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
import {
  formatMaintenanceDate,
  isMaintenanceOverdue,
  toMaintenanceInputDate,
} from "@/lib/maintenance-dates";

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

interface Asset {
  id: string;
  name: string;
  category: string;
  location: string | null;
  make: string | null;
  model: string | null;
  serial: string | null;
  installedYear: number | null;
  notes: string | null;
  records: { id: string; title: string; performedAt: string; cost: number | null }[];
  documents: { id: string; title: string }[];
  _count: { records: number; documents: number };
}

const ASSET_CATEGORY_LABELS: Record<string, string> = {
  water: "Water",
  power: "Power",
  hvac: "Heating & Air",
  structure: "Structure",
  appliance: "Appliances",
  grounds: "Grounds",
  safety: "Safety",
  other: "Other",
};

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

export default function MaintenancePage() {
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
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

  useEffect(() => {
    fetch("/api/assets")
      .then((res) => (res.ok ? res.json() : []))
      .then(setAssets)
      .catch(() => {});
  }, []);

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
    setFormPerformedAt(toMaintenanceInputDate(record.performedAt));
    setFormNextDueAt(toMaintenanceInputDate(record.nextDueAt));
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

  const overdueRecords = records.filter((r) => isMaintenanceOverdue(r.nextDueAt));

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
                    — due {formatMaintenanceDate(r.nextDueAt!)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Property systems — the equipment "notebook" Bucky maintains */}
        {assets.length > 0 && (
          <div>
            <h2 className="font-semibold text-stone-800 text-sm mb-2 flex items-center gap-2">
              <Wrench size={15} className="text-green-700" />
              Property Systems
              <span className="text-xs font-normal text-stone-400">
                — tell Bucky about equipment and it shows up here
              </span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {assets.map((asset) => {
                const isOpen = expandedAssetId === asset.id;
                const specs = [
                  asset.make,
                  asset.model,
                  asset.installedYear ? `installed ${asset.installedYear}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <button
                    key={asset.id}
                    onClick={() => setExpandedAssetId(isOpen ? null : asset.id)}
                    className={`text-left bg-white rounded-xl border p-3 transition-colors ${
                      isOpen ? "border-green-300 sm:col-span-2" : "border-stone-200 hover:border-green-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-stone-800 text-sm truncate">
                        {asset.name}
                      </span>
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600 flex-shrink-0">
                        {ASSET_CATEGORY_LABELS[asset.category] || asset.category}
                      </span>
                    </div>
                    <div className="text-xs text-stone-400 mt-0.5 truncate">
                      {[asset.location, specs].filter(Boolean).join(" — ") || "No details yet"}
                    </div>
                    {isOpen && (
                      <div className="mt-3 space-y-2 text-sm text-stone-600">
                        {asset.serial && (
                          <p className="text-xs text-stone-500">Serial: {asset.serial}</p>
                        )}
                        {asset.notes && (
                          <p className="bg-stone-50 rounded-lg p-3 whitespace-pre-wrap text-sm">
                            {asset.notes}
                          </p>
                        )}
                        {asset.records.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-stone-500 mb-1">
                              Service history ({asset._count.records})
                            </p>
                            {asset.records.map((r) => (
                              <p key={r.id} className="text-xs text-stone-500">
                                • {r.title} — {formatMaintenanceDate(r.performedAt)}
                                {r.cost != null ? ` ($${r.cost.toFixed(2)})` : ""}
                              </p>
                            ))}
                          </div>
                        )}
                        {asset.documents.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-stone-500 mb-1">
                              Documents ({asset._count.documents})
                            </p>
                            {asset.documents.map((d) => (
                              <p key={d.id} className="text-xs text-green-700">
                                • {d.title}
                              </p>
                            ))}
                          </div>
                        )}
                        {!asset.notes && asset.records.length === 0 && asset.documents.length === 0 && (
                          <p className="text-xs text-stone-400">
                            Nothing recorded yet — tell Bucky what you know about it.
                          </p>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
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
                const overdue = isMaintenanceOverdue(record.nextDueAt);
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
                            {formatMaintenanceDate(record.performedAt)}
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
                              Next: {formatMaintenanceDate(record.nextDueAt)}
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
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-green-200 bg-green-50 text-green-700 transition-colors hover:border-green-300 hover:bg-green-100 hover:text-green-800 focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2"
                          aria-label={`Edit ${record.title}`}
                          title="Edit record"
                        >
                          <Pencil size={16} strokeWidth={2.25} />
                        </button>
                        <button
                          onClick={() => deleteRecord(record.id)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 transition-colors hover:border-red-300 hover:bg-red-100 hover:text-red-800 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
                          aria-label={`Delete ${record.title}`}
                          title="Delete record"
                        >
                          <Trash2 size={16} strokeWidth={2.25} />
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
