"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Loader2, RefreshCw } from "lucide-react";
import {
  BackgroundJobCard,
  isActiveBackgroundJob,
  type BackgroundJob,
  type BackgroundJobAction,
} from "@/components/bucky/background-job";

export default function BackgroundJobsPage() {
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<Record<string, BackgroundJobAction>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<"archive_review" | "site_improvement">("archive_review");
  const [instructions, setInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [budget, setBudget] = useState<{ spentCents: number; reservedCents: number; limitCents: number } | null>(null);
  const mounted = useRef(true);
  const fetching = useRef(false);
  const refreshRequested = useRef(false);

  const fetchJobs = useCallback(async (): Promise<void> => {
    if (fetching.current) {
      refreshRequested.current = true;
      return;
    }
    fetching.current = true;
    setRefreshing(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/bucky/jobs", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!Array.isArray(data.jobs)) throw new Error();
      if (mounted.current) {
        setJobs(data.jobs);
        setCanManage(data.canManage === true);
        if (data.budget && [data.budget.spentCents, data.budget.reservedCents, data.budget.limitCents].every((amount) => typeof amount === "number" && Number.isFinite(amount))) setBudget(data.budget);
        setError(null);
      }
    } catch {
      if (mounted.current) setError("We could not check Bucky’s tasks. Refresh to try again.");
    } finally {
      window.clearTimeout(timeout);
      fetching.current = false;
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
        if (refreshRequested.current) {
          refreshRequested.current = false;
          void fetchJobs();
        }
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void fetchJobs();
    return () => { mounted.current = false; };
  }, [fetchJobs]);

  const activeCount = jobs.filter(isActiveBackgroundJob).length;
  const reviewCount = jobs.filter((job) => job.status === "needs_review").length;
  useEffect(() => {
    if (!activeCount) return;
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void fetchJobs();
    };
    const timer = window.setInterval(refreshVisible, 5000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [activeCount, fetchJobs]);

  useEffect(() => {
    if (!canManage && kind === "site_improvement") setKind("archive_review");
  }, [canManage, kind]);

  const handleAction = async (id: string, action: BackgroundJobAction) => {
    setPendingActions((current) => ({ ...current, [id]: action }));
    setActionErrors((current) => ({ ...current, [id]: "" }));
    try {
      const response = await fetch(`/api/bucky/jobs/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error();
      await fetchJobs();
    } catch {
      setActionErrors((current) => ({ ...current, [id]: "That request did not go through. Refresh the task and try again." }));
    } finally {
      setPendingActions((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  };

  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!instructions.trim() || submitting) return;
    setSubmitting(true);
    setRequestMessage(null);
    setRequestError(null);
    try {
      const response = await fetch("/api/bucky/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, instructions: instructions.trim() }),
      });
      if (!response.ok) throw new Error();
      setInstructions("");
      setRequestMessage("Request saved. You can come back here to review Bucky’s findings.");
      await fetchJobs();
    } catch {
      setRequestError("We could not save this request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="text-[var(--ink)]">
      <header className="border-b border-[var(--rule)] px-5 py-5">
        <Link href="/assistant" className="inline-flex min-h-11 items-center gap-1 text-sm text-[var(--pine)]">
          <ChevronLeft size={16} aria-hidden="true" /> Back to Bucky
        </Link>
        <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]" style={{ fontFamily: "var(--mono)" }}>The family’s ongoing work</p>
        <h1 className="mt-1 text-4xl italic" style={{ fontFamily: "var(--serif)" }}>Bucky’s tasks</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">Leave a task with Bucky and return when it is ready. Uploaded originals stay saved while analysis is pending.</p>
      </header>

      <main className="space-y-5 px-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/upload" className="min-h-11 rounded-lg bg-[var(--pine)] px-4 py-3 text-sm font-medium text-white">Add documents</Link>
          <button type="button" onClick={() => void fetchJobs()} disabled={refreshing} className="inline-flex min-h-11 items-center gap-2 px-3 text-sm text-[var(--muted)] disabled:opacity-50">
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} aria-hidden="true" /> Refresh
          </button>
        </div>
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {canManage && budget && (
          <p className="text-xs text-[var(--muted)]">Background analysis this month: ${(budget.spentCents / 100).toFixed(2)} used of ${(budget.limitCents / 100).toFixed(2)}{budget.reservedCents > 0 ? `, with $${(budget.reservedCents / 100).toFixed(2)} set aside for work in progress` : ""}.</p>
        )}
        {loading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-[var(--muted)]"><Loader2 size={18} className="animate-spin" aria-hidden="true" /> Checking tasks…</p>
        ) : (
          <>
            <p role="status" className="text-sm text-[var(--muted)]">{activeCount ? `${activeCount} task${activeCount === 1 ? "" : "s"} in progress or waiting. This page updates while work is pending.` : reviewCount ? `${reviewCount} task${reviewCount === 1 ? " is" : "s are"} ready for review.` : jobs.length ? "No tasks are waiting or in progress." : "No background tasks yet. Choose “Analyze in background” when you add a document, or leave a review request below."}</p>
            <div className="space-y-3">
              {jobs.map((job) => <BackgroundJobCard key={job.id} job={job} pendingAction={pendingActions[job.id]} error={actionErrors[job.id]} onAction={handleAction} canAct={job.kind !== "site_improvement" || canManage} />)}
            </div>
          </>
        )}

        <details className="rounded-xl border border-stone-300 bg-white/40 p-4">
          <summary className="cursor-pointer py-1 font-medium">Leave a review request</summary>
          <p className="mt-3 text-sm text-[var(--muted)]">Bucky can review the archive{canManage ? " or prepare a site improvement proposal" : ""}. You review the findings before any proposed changes are applied.</p>
          <form onSubmit={submitRequest} className="mt-4 space-y-3">
            <label className="block text-sm">Task
              <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} disabled={submitting} className="mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-stone-800">
                <option value="archive_review">Review the archive</option>
                {canManage && <option value="site_improvement">Suggest a site improvement</option>}
              </select>
            </label>
            <label className="block text-sm" htmlFor="job-instructions">What would you like Bucky to look at?</label>
            <textarea id="job-instructions" value={instructions} onChange={(event) => setInstructions(event.target.value)} required maxLength={8000} rows={4} disabled={submitting} placeholder={kind === "archive_review" ? "For example: look for duplicate meeting minutes and suggest which copies to keep." : "For example: review how easy it is to find an available room for a family visit."} className="w-full rounded-lg border border-stone-300 bg-white p-3 text-sm text-stone-800" />
            <button type="submit" disabled={submitting || !instructions.trim()} className="min-h-11 rounded-lg bg-[var(--pine)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50">{submitting ? "Saving request…" : "Save request"}</button>
            {requestMessage && <p role="status" className="text-sm text-green-800">{requestMessage}</p>}
            {requestError && <p role="alert" className="text-sm text-red-700">{requestError}</p>}
          </form>
        </details>
        <Link href="/documents" className="inline-flex min-h-11 items-center text-sm text-[var(--pine)] underline underline-offset-4">Return to the archive</Link>
      </main>
    </div>
  );
}
