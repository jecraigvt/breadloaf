"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "@/components/layout/header";
import { Search, Grid, List, FolderOpen, Tag, Calendar, Sparkles, Loader2, X, ArrowRight, Trash2, ArchiveRestore, CircleCheck, TriangleAlert, Clock3 } from "lucide-react";
import Link from "next/link";
import type { DocumentWithCategory } from "@/types";
import { formatDate } from "@/lib/utils";
import type { ArchiveHealth } from "@/lib/archive-health";
import { archiveVerificationStalenessMessage, archiveAnalysisIssueMessage } from "@/lib/archive-health-shared";
import { dictationDisplaySummary } from "@/lib/dictation-analysis";
import { requestSavedState } from "@/lib/saved-state";
import "../fieldguide-archive.css";

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
  duplicates: { keepId: string; removeIds: string[]; title: string }[];
  summary: string;
}

const planIsEmpty = (p: LibrarianPlan) =>
  p.newCategories.length + p.renames.length + p.merges.length + p.refiles.length +
    (p.duplicates?.length ?? 0) === 0;

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentWithCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showDeleted, setShowDeleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [archiveHealth, setArchiveHealth] = useState<ArchiveHealth | null>(null);
  const [totalDocuments, setTotalDocuments] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<{ message: string; append: boolean } | null>(null);
  const [metadataError, setMetadataError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDocuments, setPendingDocuments] = useState<Set<string>>(new Set());
  const requestVersion = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const nextOffset = useRef(0);

  const fetchDocuments = useCallback(async (append = false) => {
    const version = ++requestVersion.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    if (append) setLoadingMore(true); else setLoading(true);
    setListError(null);
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (selectedCategory) params.set("category", selectedCategory);
    if (showDeleted) params.set("deleted", "true");
    params.set("limit", "50");
    const requestedOffset = append ? nextOffset.current : 0;
    params.set("offset", String(requestedOffset));
    try {
      const res = await fetch(`/api/documents?${params}`, { signal: controller.signal });
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data)) throw new Error(data?.error || "Could not load documents. Please try again.");
      const total = Number(res.headers.get("X-Total-Count"));
      const offset = Number(res.headers.get("X-Next-Offset"));
      if (res.headers.get("X-Total-Count") === null || res.headers.get("X-Next-Offset") === null || !Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(offset) || offset !== requestedOffset + data.length) throw new Error("The archive did not confirm this page. Please try again.");
      if (version !== requestVersion.current || controller.signal.aborted) return;
      setDocuments(previous => append ? [...previous, ...data.filter(doc => !previous.some(existing => existing.id === doc.id))] : data);
      setTotalDocuments(total);
      nextOffset.current = offset;
      setHasMore(res.headers.get("X-Has-More") === "true");
    } catch (error) {
      if (version === requestVersion.current && !controller.signal.aborted) setListError({ message: error instanceof Error ? error.message : "Could not load documents. Please try again.", append });
    } finally {
      if (version === requestVersion.current && !controller.signal.aborted) { setLoading(false); setLoadingMore(false); }
    }
  }, [search, selectedCategory, showDeleted]);
  const currentFetchDocuments = useRef(fetchDocuments);
  useEffect(() => { currentFetchDocuments.current = fetchDocuments; }, [fetchDocuments]);

  const fetchCategories = useCallback(async () => {
    const res = await fetch("/api/documents?categoriesOnly=true");
    if (!res.ok) throw new Error("Categories unavailable");
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Categories unavailable");
    setCategories(data);
  }, []);

  const fetchUncategorizedCount = useCallback(async () => {
    const res = await fetch("/api/documents?category=uncategorized&limit=1");
    const count = Number(res.headers.get("X-Total-Count"));
    if (!res.ok || res.headers.get("X-Total-Count") === null || !Number.isSafeInteger(count)) throw new Error("Review count unavailable");
    setUncategorizedCount(count);
  }, []);

  const fetchArchiveHealth = useCallback(async () => {
    const res = await fetch("/api/documents?healthOnly=true");
    if (!res.ok) throw new Error("Archive health unavailable");
    setArchiveHealth(await res.json());
  }, []);

  const refreshMetadata = useCallback(async () => {
    const results = await Promise.allSettled([fetchCategories(), fetchUncategorizedCount(), fetchArchiveHealth()]);
    setMetadataError(results.some(result => result.status === "rejected"));
  }, [fetchCategories, fetchUncategorizedCount, fetchArchiveHealth]);

  useEffect(() => { void refreshMetadata(); }, [refreshMetadata]);

  useEffect(() => {
    ++requestVersion.current;
    activeRequest.current?.abort();
    setDocuments([]); setTotalDocuments(null); setHasMore(false); setListError(null);
    setLoading(true); setLoadingMore(false); nextOffset.current = 0;
    const timer = setTimeout(() => void fetchDocuments(), search ? 300 : 0);
    return () => { clearTimeout(timer); activeRequest.current?.abort(); };
  }, [fetchDocuments, search]);

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
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "");
      }
      const p: LibrarianPlan = await res.json();
      setPlan(p);
      setLibrarianState("reviewing");
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : "The librarian hit a snag — try again in a minute.";
      setLibrarianMessage(detail);
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
        `Tidied up: ${applied.merges} merged, ${applied.renames} renamed, ${applied.newCategories} new, ${applied.refiles} re-filed, ${applied.duplicatesRemoved ?? 0} duplicate${(applied.duplicatesRemoved ?? 0) === 1 ? "" : "s"} moved to Recently Deleted.`
      );
      setPlan(null);
      setLibrarianState("idle");
      void currentFetchDocuments.current();
      void refreshMetadata();
    } catch {
      setLibrarianMessage("Applying the plan failed — nothing may have changed. Try again.");
      setLibrarianState("reviewing");
    }
  };

  const categoryNameBySlug = (slug: string) =>
    categories.find((c) => c.slug === slug)?.name || slug;

  const assignCategory = async (docId: string, categoryId: string) => {
    if (!categoryId || pendingDocuments.has(docId)) return;
    setPendingDocuments(previous => new Set(previous).add(docId)); setActionError(null);
    try {
      await requestSavedState(`/api/documents/${docId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoryId }) });
      await currentFetchDocuments.current(); await refreshMetadata();
    } catch (error) { setActionError(error instanceof Error ? error.message : "The category could not be saved."); }
    finally { setPendingDocuments(previous => { const next = new Set(previous); next.delete(docId); return next; }); }
  };

  const restoreDocument = async (docId: string) => {
    if (pendingDocuments.has(docId)) return;
    setPendingDocuments(previous => new Set(previous).add(docId)); setActionError(null);
    try {
      await requestSavedState(`/api/documents/${docId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore" }) });
      await currentFetchDocuments.current(); await refreshMetadata();
    } catch (error) { setActionError(error instanceof Error ? error.message : "The document could not be restored."); }
    finally { setPendingDocuments(previous => { const next = new Set(previous); next.delete(docId); return next; }); }
  };

  return (
    <div className="fg-archive">
      <Header title="Document Archive" subtitle="Browse and search all property documents" />

      <div className="fg-archive-body space-y-5">
        <div className="fg-archive-topline">
          <span className="fg-archive-eyebrow">The family record</span>
          <Link href="/bucky/jobs" className="fg-archive-text-link">
            <Clock3 size={16} aria-hidden="true" /> Bucky’s background tasks
          </Link>
        </div>
        {archiveHealth && (
          <section
            aria-label="Archive health"
            className={`fg-archive-health rounded-xl border p-3 ${
              archiveHealth.issueDocuments === 0
                ? "border-green-200 bg-green-50"
                : "border-amber-200 bg-amber-50"
            }`}
          >
            <div className="flex items-start gap-2.5">
              {archiveHealth.issueDocuments === 0 ? (
                <CircleCheck size={18} className="mt-0.5 shrink-0 text-green-700" />
              ) : (
                <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amber-700" />
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <h2 className="text-sm font-semibold text-stone-800">Archive health</h2>
                  <span className="text-xs text-stone-600">
                    {archiveHealth.readyDocuments}/{archiveHealth.totalDocuments} analyzed
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-stone-600">
                  {archiveHealth.issueDocuments === 0
                    ? "Every active document has usable analysis. "
                    : `${archiveHealth.issueDocuments} active document${archiveHealth.issueDocuments === 1 ? "" : "s"} awaiting analysis or needing attention. `}
                  Latest retrieval checks: {archiveHealth.verification.roundTrip.rate.toFixed(1)}% round-trip, {archiveHealth.verification.golden.rate.toFixed(1)}% golden, {archiveHealth.verification.negativeControls.passed}/{archiveHealth.verification.negativeControls.total} safety controls.
                </p>
                {Boolean(archiveHealth.issues?.length) && (
                  <ul className="mt-2 space-y-2 text-xs leading-5 text-stone-700">
                    {archiveHealth.issues!.map((issue) => (
                      <li key={issue.id}>
                        <Link href={`/documents/${issue.id}`} className="font-medium text-green-800 underline">{issue.title}</Link>
                        {" — "}{archiveAnalysisIssueMessage(issue.analysisState, issue.analysisError)}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-0.5 text-[11px] text-stone-500">
                  Measured {archiveHealth.verification.measuredAt}
                </p>
                {archiveVerificationStalenessMessage(
                  archiveHealth.documentsAddedAfterMeasurement
                ) && (
                  <p className="mt-1 text-[11px] font-medium text-amber-800">
                    {archiveVerificationStalenessMessage(
                      archiveHealth.documentsAddedAfterMeasurement
                    )}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Search Bar */}
        <section className="fg-archive-panel fg-archive-search-panel" aria-label="Find a document">
        <div className="fg-archive-section-heading">
          <h2>From the shelves.</h2>
          <p>Search by a word you remember, or browse a category.</p>
        </div>
        <div className="relative fg-archive-search">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents..."
            aria-label="Search documents"
            maxLength={300}
            className="w-full pl-10 pr-4 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>

        {/* Category Filters */}
        {!showDeleted && (
        <div
          className="fg-archive-filters flex flex-wrap gap-2"
          role="group"
          aria-label="Filter documents by category"
        >
          <button
            onClick={() => setSelectedCategory(null)}
            aria-pressed={!selectedCategory}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              !selectedCategory
                ? "bg-green-700 text-white"
                : "bg-stone-100 text-stone-600 hover:bg-stone-200"
            }`}
          >
            All
          </button>
          {uncategorizedCount > 0 && (
            <button
              aria-pressed={selectedCategory === "uncategorized"}
              onClick={() =>
                setSelectedCategory(
                  selectedCategory === "uncategorized" ? null : "uncategorized"
                )
              }
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
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
                aria-pressed={selectedCategory === cat.slug}
                onClick={() =>
                  setSelectedCategory(selectedCategory === cat.slug ? null : cat.slug)
                }
                className={`max-w-full px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  selectedCategory === cat.slug
                    ? "bg-green-700 text-white"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                }`}
              >
                {cat.name} ({cat._count.documents})
              </button>
            ))}
        </div>
        )}
        </section>

        {/* View Toggle + Librarian */}
        <div className="fg-archive-toolbar">
          <span className="text-sm text-stone-500">
            {loading ? "Loading documents…" : totalDocuments === null ? "Documents unavailable" : `Showing ${documents.length} of ${totalDocuments} document${totalDocuments !== 1 ? "s" : ""}`}
          </span>
          <div className="fg-archive-tools">
            <button
              onClick={() => {
                setShowDeleted((current) => !current);
                setSelectedCategory(null);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                showDeleted ? "bg-stone-800 text-white" : "text-stone-600 bg-stone-100 hover:bg-stone-200"
              }`}
              title="Recently Deleted"
              aria-pressed={showDeleted}
            >
              <Trash2 size={14} />
              <span>Deleted</span>
            </button>
            {!showDeleted && (
            <Link
              href="/upload"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white bg-green-700 hover:bg-green-800 transition-colors"
            >
              + Add
            </Link>
            )}
            {!showDeleted && (
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
            )}
            {!showDeleted && (
              <span className="fg-archive-views" role="group" aria-label="Document view">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`p-2 rounded-lg ${viewMode === "grid" ? "bg-stone-200" : "hover:bg-stone-100"}`}
                  title="Grid view"
                  aria-pressed={viewMode === "grid"}
                >
                  <Grid size={16} />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`p-2 rounded-lg ${viewMode === "list" ? "bg-stone-200" : "hover:bg-stone-100"}`}
                  title="List view"
                  aria-pressed={viewMode === "list"}
                >
                  <List size={16} />
                </button>
              </span>
            )}
          </div>
        </div>

        {metadataError && <p role="status" className="text-sm text-amber-800">Some category counts or archive health could not load. <button type="button" className="underline" onClick={() => void refreshMetadata()}>Retry details</button></p>}
        {listError && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p>{listError.message}</p><button type="button" className="underline mt-2" onClick={() => void fetchDocuments(listError.append)}>Try again</button></div>}
        {actionError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{actionError}</p>}

        {librarianMessage && (
          <div className="flex items-center justify-between bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 text-sm text-purple-800">
            <span>{librarianMessage}</span>
            <button aria-label="Dismiss librarian message" onClick={() => setLibrarianMessage(null)} className="text-purple-400 hover:text-purple-600">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Librarian plan review */}
        {(librarianState === "reviewing" || librarianState === "applying") && plan && (
          <div className="fg-archive-panel bg-white border border-purple-200 rounded-xl p-4 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-stone-800 flex items-center gap-2">
                  <Sparkles size={16} className="text-purple-600" />
                  Librarian&apos;s Proposal
                </h3>
                <p className="text-sm text-stone-600 mt-1">{plan.summary}</p>
              </div>
              <button
                aria-label="Close librarian proposal"
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
                {(plan.duplicates?.length ?? 0) > 0 && (
                  <div>
                    <p className="font-medium text-stone-700 mb-1">Remove exact duplicates</p>
                    {plan.duplicates.map((d, i) => (
                      <div key={i} className="flex items-start gap-2 text-stone-600 py-0.5">
                        <ArrowRight size={14} className="mt-0.5 text-purple-400 flex-shrink-0" />
                        <span>
                          <span className="font-medium">{d.title}</span>
                          <span className="text-stone-400">
                            {" "}— keep 1 copy, remove {d.removeIds.length} identical{" "}
                            {d.removeIds.length === 1 ? "copy" : "copies"} (byte-for-byte match)
                          </span>
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
          <div className="fg-archive-grid" aria-label="Loading documents" role="status">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-stone-100 rounded-xl h-48 animate-pulse" />
            ))}
          </div>
        ) : listError && !listError.append ? null : documents.length === 0 ? (
          <div className="fg-archive-empty text-center py-12">
            <FolderOpen size={48} className="mx-auto text-stone-300 mb-3" />
            <p className="text-stone-500 font-medium">{showDeleted ? "Recently Deleted is empty" : "No documents found"}</p>
            <p className="text-stone-400 text-sm mt-1">
              {search ? "Try a different search" : showDeleted ? "Deleted documents will remain recoverable here." : "Start by scanning a document"}
            </p>
            {!search && !showDeleted && (
              <Link
                href="/upload"
                className="inline-block mt-4 px-6 py-2 bg-green-700 text-white rounded-xl font-medium hover:bg-green-800"
              >
                Scan Document
              </Link>
            )}
          </div>
        ) : showDeleted ? (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white p-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-stone-100">
                  <Trash2 size={17} className="text-stone-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-stone-800">{doc.title}</p>
                  <p className="mt-0.5 text-xs text-stone-400">
                    Deleted {doc.deletedAt ? formatDate(doc.deletedAt) : "recently"}{doc.deletedBy ? ` by ${doc.deletedBy}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => void restoreDocument(doc.id)}
                  disabled={pendingDocuments.has(doc.id)}
                  className="flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-medium text-green-800 hover:bg-green-100"
                >
                  <ArchiveRestore size={14} /> Restore
                </button>
              </div>
            ))}
          </div>
        ) : viewMode === "grid" ? (
          <div className="fg-archive-grid">
            {documents.map((doc) => (
              <article key={doc.id} className="fg-archive-card">
              <Link href={`/documents/${doc.id}`} className="fg-archive-card-link">
                {doc.fileType.startsWith("image/") ? (
                  <div className="fg-archive-card-image">
                    <img
                      src={`/api/documents/${doc.id}/file`}
                      alt={doc.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="fg-archive-card-image fg-archive-card-placeholder">
                    <FolderOpen size={32} aria-hidden="true" />
                    <span className="fg-archive-eyebrow">From the archive</span>
                  </div>
                )}
                <div className="fg-archive-card-copy">
                  <h3 className="line-clamp-2">
                    {doc.title}
                  </h3>
                  {doc.category && (
                    <span
                      className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        CATEGORY_COLORS[doc.category.color || "gray"]
                      }`}
                    >
                      {doc.category.name}
                    </span>
                  )}
                  <p className="fg-archive-card-date">{formatDate(doc.createdAt)}</p>
                </div>
              </Link>
              {!doc.category && (
                <div className="fg-archive-card-filing">
                    <select
                      defaultValue=""
                      aria-label={`File ${doc.title} under category`}
                      onChange={(e) => { const select = e.currentTarget; void assignCategory(doc.id, select.value).finally(() => { select.value = ""; }); }}
                      disabled={pendingDocuments.has(doc.id)}
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
                </div>
              )}
              </article>
            ))}
          </div>
        ) : (
          <div className="fg-archive-list">
            {documents.map((doc) => (
              <article key={doc.id} className="fg-archive-list-card">
              <Link href={`/documents/${doc.id}`} className="fg-archive-list-link">
                {doc.fileType.startsWith("image/") ? (
                  <div className="w-16 h-16 rounded-lg bg-stone-100 flex-shrink-0 overflow-hidden">
                    <img
                      src={`/api/documents/${doc.id}/file`}
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
                  <h3 className="line-clamp-2">{doc.title}</h3>
                  {doc.aiSummary && (
                    <p className="text-stone-500 text-sm line-clamp-1 mt-0.5">
                      {doc.fileType.startsWith("audio/") ? doc.displaySummary || dictationDisplaySummary(doc.aiSummary, doc.title) : doc.aiSummary}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-stone-500">
                    {doc.category && (
                      <span className="flex items-center gap-1">
                        <Tag size={10} />
                        {doc.category.name}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Calendar size={10} />
                      {formatDate(doc.createdAt)}
                    </span>
                  </div>
                </div>
              </Link>
              {!doc.category && (
                <div className="fg-archive-list-filing">
                  <select
                    defaultValue=""
                    aria-label={`File ${doc.title} under category`}
                    onChange={(e) => { const select = e.currentTarget; void assignCategory(doc.id, select.value).finally(() => { select.value = ""; }); }}
                    disabled={pendingDocuments.has(doc.id)}
                    className="w-full px-2 py-1 rounded-lg border border-amber-300 bg-amber-50 text-xs text-amber-800"
                  >
                    <option value="" disabled>File under…</option>
                    {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                  </select>
                </div>
              )}
              </article>
            ))}
          </div>
        )}
        {!loading && hasMore && (!listError || listError.append) && <div className="flex justify-center"><button type="button" className="btn-quiet flex items-center gap-2" disabled={loadingMore} onClick={() => void fetchDocuments(true)}>{loadingMore && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}{loadingMore ? "Loading more…" : "Load more documents"}</button></div>}
      </div>
    </div>
  );
}
