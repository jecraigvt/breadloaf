"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import { Search, Grid, List, FolderOpen, Tag, Calendar, Sparkles, Loader2, X, ArrowRight } from "lucide-react";
import Link from "next/link";
import type { DocumentWithCategory } from "@/types";
import { formatDate } from "@/lib/utils";

const CATEGORY_COLORS: Record<string, string> = {
  blue: "bg-blue-100 text-blue-800",
  red: "bg-red-100 text-red-800",
  green: "bg-green-100 text-green-800",
  orange: "bg-orange-100 text-orange-800",
  purple: "bg-purple-100 text-purple-800",
  teal: "bg-teal-100 text-teal-800",
  yellow: "bg-yellow-100 text-yellow-800",
  indigo: "bg-indigo-100 text-indigo-800",
  pink: "bg-pink-100 text-pink-800",
  emerald: "bg-emerald-100 text-emerald-800",
  sky: "bg-sky-100 text-sky-800",
  gray: "bg-stone-100 text-stone-800",
};

interface Category {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  _count: { documents: number };
}

interface LibrarianPlan {
  newCategories: { name: string; description: string; reason: string }[];
  renames: { slug: string; newName: string; newDescription: string; reason: string }[];
  merges: { fromSlug: string; intoSlug: string; reason: string }[];
  refiles: { documentId: string; intoName: string; reason: string }[];
  summary: string;
}

const planIsEmpty = (p: LibrarianPlan) =>
  p.newCategories.length + p.renames.length + p.merges.length + p.refiles.length === 0;

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentWithCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDocuments();
    fetchCategories();
    fetchUncategorizedCount();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => fetchDocuments(), 300);
    return () => clearTimeout(timer);
  }, [search, selectedCategory]);

  const fetchDocuments = async () => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (selectedCategory) params.set("category", selectedCategory);

    const res = await fetch(`/api/documents?${params}`);
    if (res.ok) {
      const data = await res.json();
      setDocuments(data);
    }
    setLoading(false);
  };

  const fetchCategories = async () => {
    const res = await fetch("/api/documents?categoriesOnly=true");
    if (res.ok) {
      const data = await res.json();
      setCategories(data);
    }
  };

  const fetchUncategorizedCount = async () => {
    const res = await fetch("/api/documents?category=uncategorized");
    if (res.ok) {
      const data = await res.json();
      setUncategorizedCount(data.length);
    }
  };

  // ─── Librarian ────────────────────────────────────────────────
  const [librarianState, setLibrarianState] = useState<"idle" | "planning" | "reviewing" | "applying">("idle");
  const [plan, setPlan] = useState<LibrarianPlan | null>(null);
  const [librarianMessage, setLibrarianMessage] = useState<string | null>(null);

  const runLibrarian = async () => {
    setLibrarianState("planning");
    setLibrarianMessage(null);
    try {
      const res = await fetch("/api/documents/librarian", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "plan" }),
      });
      if (!res.ok) throw new Error();
      const p: LibrarianPlan = await res.json();
      setPlan(p);
      setLibrarianState("reviewing");
    } catch {
      setLibrarianMessage("The librarian hit a snag — try again in a minute.");
      setLibrarianState("idle");
    }
  };

  const applyPlan = async () => {
    if (!plan) return;
    setLibrarianState("applying");
    try {
      const res = await fetch("/api/documents/librarian", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", plan }),
      });
      if (!res.ok) throw new Error();
      const { applied } = await res.json();
      setLibrarianMessage(
        `Tidied up: ${applied.merges} merged, ${applied.renames} renamed, ${applied.newCategories} new, ${applied.refiles} re-filed.`
      );
      setPlan(null);
      setLibrarianState("idle");
      fetchDocuments();
      fetchCategories();
      fetchUncategorizedCount();
    } catch {
      setLibrarianMessage("Applying the plan failed — nothing may have changed. Try again.");
      setLibrarianState("reviewing");
    }
  };

  const categoryNameBySlug = (slug: string) =>
    categories.find((c) => c.slug === slug)?.name || slug;

  const assignCategory = async (docId: string, categoryId: string) => {
    if (!categoryId) return;
    const res = await fetch(`/api/documents/${docId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId }),
    });
    if (res.ok) {
      fetchDocuments();
      fetchCategories();
      fetchUncategorizedCount();
    }
  };

  return (
    <div>
      <Header title="Document Archive" subtitle="Browse and search all property documents" />

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents..."
            className="w-full pl-10 pr-4 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>

        {/* Category Filters */}
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              !selectedCategory
                ? "bg-green-700 text-white"
                : "bg-stone-100 text-stone-600 hover:bg-stone-200"
            }`}
          >
            All
          </button>
          {uncategorizedCount > 0 && (
            <button
              onClick={() =>
                setSelectedCategory(
                  selectedCategory === "uncategorized" ? null : "uncategorized"
                )
              }
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                selectedCategory === "uncategorized"
                  ? "bg-amber-600 text-white"
                  : "bg-amber-100 text-amber-800 hover:bg-amber-200"
              }`}
            >
              Needs Review ({uncategorizedCount})
            </button>
          )}
          {categories
            .filter((c) => c._count.documents > 0)
            .map((cat) => (
              <button
                key={cat.id}
                onClick={() =>
                  setSelectedCategory(selectedCategory === cat.slug ? null : cat.slug)
                }
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  selectedCategory === cat.slug
                    ? "bg-green-700 text-white"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                }`}
              >
                {cat.name} ({cat._count.documents})
              </button>
            ))}
        </div>

        {/* View Toggle + Librarian */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-stone-500">
            {documents.length} document{documents.length !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-1">
            <Link
              href="/upload"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white bg-green-700 hover:bg-green-800 transition-colors"
            >
              + Add
            </Link>
            <button
              onClick={runLibrarian}
              disabled={librarianState !== "idle"}
              className="flex items-center gap-1.5 px-3 py-1.5 mr-1 rounded-lg text-sm text-purple-700 bg-purple-50 hover:bg-purple-100 disabled:opacity-50 transition-colors"
              title="AI review of the filing system"
            >
              {librarianState === "planning" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              {librarianState === "planning" ? "Reviewing..." : "Tidy Up"}
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2 rounded-lg ${viewMode === "grid" ? "bg-stone-200" : "hover:bg-stone-100"}`}
            >
              <Grid size={16} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-2 rounded-lg ${viewMode === "list" ? "bg-stone-200" : "hover:bg-stone-100"}`}
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {librarianMessage && (
          <div className="flex items-center justify-between bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 text-sm text-purple-800">
            <span>{librarianMessage}</span>
            <button onClick={() => setLibrarianMessage(null)} className="text-purple-400 hover:text-purple-600">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Librarian plan review */}
        {(librarianState === "reviewing" || librarianState === "applying") && plan && (
          <div className="bg-white border border-purple-200 rounded-xl p-4 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-stone-800 flex items-center gap-2">
                  <Sparkles size={16} className="text-purple-600" />
                  Librarian&apos;s Proposal
                </h3>
                <p className="text-sm text-stone-600 mt-1">{plan.summary}</p>
              </div>
              <button
                onClick={() => { setPlan(null); setLibrarianState("idle"); }}
                className="text-stone-400 hover:text-stone-600 flex-shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            {planIsEmpty(plan) ? (
              <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
                Everything looks tidy — no changes needed.
              </p>
            ) : (
              <div className="space-y-3 text-sm">
                {plan.merges.length > 0 && (
                  <div>
                    <p className="font-medium text-stone-700 mb-1">Merge categories</p>
                    {plan.merges.map((m, i) => (
                      <div key={i} className="flex items-start gap-2 text-stone-600 py-0.5">
                        <ArrowRight size={14} className="mt-0.5 text-purple-400 flex-shrink-0" />
                        <span>
                          <span className="font-medium">{categoryNameBySlug(m.fromSlug)}</span>
                          {" → "}
                          <span className="font-medium">{categoryNameBySlug(m.intoSlug)}</span>
                          <span className="text-stone-400"> — {m.reason}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {plan.renames.length > 0 && (
                  <div>
                    <p className="font-medium text-stone-700 mb-1">Rename</p>
                    {plan.renames.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 text-stone-600 py-0.5">
                        <ArrowRight size={14} className="mt-0.5 text-purple-400 flex-shrink-0" />
                        <span>
                          <span className="font-medium">{categoryNameBySlug(r.slug)}</span>
                          {" → "}
                          <span className="font-medium">{r.newName}</span>
                          <span className="text-stone-400"> — {r.reason}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {plan.newCategories.length > 0 && (
                  <div>
                    <p className="font-medium text-stone-700 mb-1">New categories</p>
                    {plan.newCategories.map((n, i) => (
                      <div key={i} className="flex items-start gap-2 text-stone-600 py-0.5">
                        <ArrowRight size={14} className="mt-0.5 text-purple-400 flex-shrink-0" />
                        <span>
                          <span className="font-medium">{n.name}</span>
                          <span className="text-stone-400"> — {n.reason}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {plan.refiles.length > 0 && (
                  <div>
                    <p className="font-medium text-stone-700 mb-1">
                      Re-file {plan.refiles.length} document{plan.refiles.length !== 1 ? "s" : ""}
                    </p>
                    {plan.refiles.slice(0, 8).map((f, i) => (
                      <div key={i} className="flex items-start gap-2 text-stone-600 py-0.5">
                        <ArrowRight size={14} className="mt-0.5 text-purple-400 flex-shrink-0" />
                        <span>
                          into <span className="font-medium">{f.intoName}</span>
                          <span className="text-stone-400"> — {f.reason}</span>
                        </span>
                      </div>
                    ))}
                    {plan.refiles.length > 8 && (
                      <p className="text-stone-400 pl-6">…and {plan.refiles.length - 8} more</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {!planIsEmpty(plan) && (
              <div className="flex gap-3">
                <button
                  onClick={() => { setPlan(null); setLibrarianState("idle"); }}
                  disabled={librarianState === "applying"}
                  className="flex-1 py-2.5 rounded-xl border-2 border-stone-200 text-stone-600 font-medium hover:bg-stone-50 disabled:opacity-50"
                >
                  Not Now
                </button>
                <button
                  onClick={applyPlan}
                  disabled={librarianState === "applying"}
                  className="flex-1 py-2.5 rounded-xl bg-purple-600 text-white font-medium hover:bg-purple-700 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {librarianState === "applying" && <Loader2 size={14} className="animate-spin" />}
                  {librarianState === "applying" ? "Applying..." : "Apply Changes"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Documents */}
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-stone-100 rounded-xl h-48 animate-pulse" />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-12">
            <FolderOpen size={48} className="mx-auto text-stone-300 mb-3" />
            <p className="text-stone-500 font-medium">No documents found</p>
            <p className="text-stone-400 text-sm mt-1">
              {search ? "Try a different search" : "Start by scanning a document"}
            </p>
            {!search && (
              <Link
                href="/upload"
                className="inline-block mt-4 px-6 py-2 bg-green-700 text-white rounded-xl font-medium hover:bg-green-800"
              >
                Scan Document
              </Link>
            )}
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-2 gap-3">
            {documents.map((doc) => (
              <Link
                key={doc.id}
                href={`/documents/${doc.id}`}
                className="bg-white rounded-xl border border-stone-200 overflow-hidden hover:shadow-md transition-shadow"
              >
                {doc.fileType.startsWith("image/") ? (
                  <div className="h-32 bg-stone-100">
                    <img
                      src={doc.filePath}
                      alt={doc.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="h-32 bg-stone-50 flex items-center justify-center">
                    <FolderOpen size={32} className="text-stone-300" />
                  </div>
                )}
                <div className="p-3">
                  <p className="font-medium text-sm text-stone-800 line-clamp-2">
                    {doc.title}
                  </p>
                  {doc.category ? (
                    <span
                      className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        CATEGORY_COLORS[doc.category.color || "gray"]
                      }`}
                    >
                      {doc.category.name}
                    </span>
                  ) : (
                    <select
                      defaultValue=""
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onChange={(e) => {
                        e.preventDefault();
                        assignCategory(doc.id, e.target.value);
                      }}
                      className="mt-1 w-full px-2 py-1 rounded-lg border border-amber-300 bg-amber-50 text-xs text-amber-800"
                    >
                      <option value="" disabled>
                        File under…
                      </option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <Link
                key={doc.id}
                href={`/documents/${doc.id}`}
                className="flex items-start gap-3 bg-white rounded-xl border border-stone-200 p-3 hover:shadow-md transition-shadow"
              >
                {doc.fileType.startsWith("image/") ? (
                  <div className="w-16 h-16 rounded-lg bg-stone-100 flex-shrink-0 overflow-hidden">
                    <img
                      src={doc.filePath}
                      alt={doc.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-stone-50 flex-shrink-0 flex items-center justify-center">
                    <FolderOpen size={24} className="text-stone-300" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-stone-800 truncate">{doc.title}</p>
                  {doc.aiSummary && (
                    <p className="text-stone-500 text-sm line-clamp-1 mt-0.5">
                      {doc.aiSummary}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-xs text-stone-400">
                    {doc.category ? (
                      <span className="flex items-center gap-1">
                        <Tag size={10} />
                        {doc.category.name}
                      </span>
                    ) : (
                      <select
                        defaultValue=""
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onChange={(e) => {
                          e.preventDefault();
                          assignCategory(doc.id, e.target.value);
                        }}
                        className="px-2 py-0.5 rounded-lg border border-amber-300 bg-amber-50 text-xs text-amber-800"
                      >
                        <option value="" disabled>
                          File under…
                        </option>
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <span className="flex items-center gap-1">
                      <Calendar size={10} />
                      {formatDate(doc.createdAt)}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
