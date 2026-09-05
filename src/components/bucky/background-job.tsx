"use client";

import Link from "next/link";
import { CheckCircle2, Clock3, FileText, Loader2, TriangleAlert } from "lucide-react";

export interface BackgroundJob {
  id: string;
  kind: "document_analysis" | "archive_review" | "site_improvement";
  status: "queued" | "running" | "succeeded" | "needs_review" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  fallbackAfter?: string | null;
  sourceDocumentId?: string | null;
  request?: { title?: string; instructions?: string } | null;
  result?: Record<string, unknown> | null;
  lastError?: string | null;
}

export type BackgroundJobAction = "expedite" | "cancel" | "retry";

export const isActiveBackgroundJob = (job: BackgroundJob) =>
  job.status === "queued" || job.status === "running";

const kindLabels: Record<BackgroundJob["kind"], string> = {
  document_analysis: "Document analysis",
  archive_review: "Archive review",
  site_improvement: "Site improvement",
};

const statusLabels: Record<BackgroundJob["status"], string> = {
  queued: "Waiting to start",
  running: "In progress",
  succeeded: "Complete",
  needs_review: "Ready for review",
  failed: "Needs another try",
  cancelled: "Cancelled",
};

function resultText(result: BackgroundJob["result"]) {
  if (!result) return null;
  for (const key of ["summary", "report", "message"]) {
    if (typeof result[key] === "string" && result[key]) return result[key] as string;
  }
  return null;
}

function ReviewFindings({ result }: { result: BackgroundJob["result"] }) {
  if (!result) return null;
  const findings = Array.isArray(result.findings) ? result.findings.filter((finding): finding is { sourceId?: string; problem: string; suggestion: string } =>
    !!finding && typeof finding === "object" && typeof finding.problem === "string" && typeof finding.suggestion === "string"
  ) : [];
  const tests = Array.isArray(result.tests) ? result.tests.filter((test): test is { command: string; passed: boolean } =>
    !!test && typeof test === "object" && typeof test.command === "string" && typeof test.passed === "boolean"
  ) : [];
  const proposalUrl = typeof result.proposalUrl === "string" && /^https?:\/\//i.test(result.proposalUrl) ? result.proposalUrl : null;
  return (
    <>
      {findings.length > 0 && (
        <ol className="list-decimal space-y-3 pl-5 text-sm text-stone-700">
          {findings.map((finding, index) => (
            <li key={index} className="break-words">
              <p className="font-medium">{finding.problem}</p>
              <p className="mt-1">{finding.suggestion}</p>
              {finding.sourceId && <Link href={`/documents/${encodeURIComponent(finding.sourceId)}`} className="inline-flex min-h-11 items-center text-green-800 underline underline-offset-4">View source document</Link>}
            </li>
          ))}
        </ol>
      )}
      {tests.length > 0 && (
        <details className="text-sm text-stone-600">
          <summary className="cursor-pointer py-1">Checks: {tests.filter((test) => test.passed).length} of {tests.length} passed</summary>
          <ul className="mt-2 space-y-1">
            {tests.map((test, index) => <li key={index} className="break-words">{test.passed ? "Passed" : "Did not pass"}: {test.command}</li>)}
          </ul>
        </details>
      )}
      {proposalUrl && <a href={proposalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-medium text-green-800 underline underline-offset-4">View proposal</a>}
    </>
  );
}

export function BackgroundJobCard({
  job,
  pendingAction,
  error,
  onAction,
  canAct = true,
}: {
  job: BackgroundJob;
  pendingAction?: BackgroundJobAction;
  error?: string;
  onAction: (id: string, action: BackgroundJobAction) => void;
  canAct?: boolean;
}) {
  const active = isActiveBackgroundJob(job);
  const documentId = job.sourceDocumentId;
  const summary = resultText(job.result);
  const title = job.request?.title || kindLabels[job.kind];
  const published = job.kind === "site_improvement" && job.result?.publishStatus === "published";
  const canRetry = job.status === "failed" || job.status === "cancelled" || (job.status === "needs_review" && typeof job.result?.reviewReason === "string");
  const buttonClass = "min-h-11 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50";

  return (
    <article id={`job-${job.id}`} className="rounded-xl border border-stone-300 bg-white/60 p-4 space-y-3 scroll-mt-4">
      <div className="flex items-start gap-3">
        {job.status === "running" ? (
          <Loader2 size={19} className="mt-0.5 shrink-0 animate-spin text-green-700" aria-hidden="true" />
        ) : job.status === "succeeded" ? (
          <CheckCircle2 size={19} className="mt-0.5 shrink-0 text-green-700" aria-hidden="true" />
        ) : job.status === "needs_review" || job.status === "failed" ? (
          <TriangleAlert size={19} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
        ) : (
          <Clock3 size={19} className="mt-0.5 shrink-0 text-stone-500" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-stone-800 break-words">{title}</h2>
          <p className="text-sm text-stone-600">{published ? "Published" : statusLabels[job.status]}</p>
          <p className="mt-1 text-xs text-stone-500">
            {kindLabels[job.kind]} · Requested {new Date(job.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </p>
        </div>
      </div>

      {job.kind === "document_analysis" && active && (
        <p className="text-sm text-stone-600">Your file is saved in the archive. Bucky will add the analysis here when it is ready. You can leave this page.</p>
      )}
      {job.status === "queued" && canAct && (
        <p className="text-sm text-stone-600">Need it sooner? Process now moves it forward without waiting here.</p>
      )}
      {job.status === "failed" && (
        <p className="text-sm text-amber-800">Bucky could not finish this task. {documentId ? "Your original file is still saved. " : ""}You can try again.</p>
      )}
      {job.status === "cancelled" && documentId && (
        <p className="text-sm text-stone-600">Analysis was cancelled. Your original file is still in the archive.</p>
      )}
      {job.status === "needs_review" && !published && (
        <p className="text-sm text-amber-800">{typeof job.result?.reviewReason === "string" ? job.result.reviewReason : job.kind === "document_analysis" ? "Bucky needs your help to finish filing this document." : "Bucky has prepared a proposal for review. No proposed changes have been applied."}</p>
      )}
      {published && <p className="text-sm text-green-800">The verified presentation change has been merged. The proposal link records the change and its checks.</p>}

      {job.request?.instructions && (
        <details className="text-sm text-stone-600">
          <summary className="cursor-pointer py-1">Your request</summary>
          <p className="mt-2 whitespace-pre-wrap break-words">{job.request.instructions}</p>
        </details>
      )}
      {summary && <p className="whitespace-pre-wrap break-words text-sm text-stone-700">{summary}</p>}
      <ReviewFindings result={job.result} />

      <div className="flex flex-wrap gap-2">
        {documentId && (
          <Link href={`/documents/${encodeURIComponent(documentId)}`} className={`${buttonClass} inline-flex items-center gap-2`}>
            <FileText size={15} aria-hidden="true" /> View document
          </Link>
        )}
        {job.status === "queued" && canAct && (
          <button type="button" disabled={!!pendingAction} onClick={() => onAction(job.id, "expedite")} className={buttonClass}>
            {pendingAction === "expedite" ? "Requesting…" : "Process now"}
          </button>
        )}
        {active && canAct && (
          <button type="button" disabled={!!pendingAction} onClick={() => onAction(job.id, "cancel")} className={buttonClass}>
            {pendingAction === "cancel" ? "Cancelling…" : "Cancel task"}
          </button>
        )}
        {canRetry && canAct && (
          <button type="button" disabled={!!pendingAction} onClick={() => onAction(job.id, "retry")} className={buttonClass}>
            {pendingAction === "retry" ? "Requesting…" : "Try again"}
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </article>
  );
}
