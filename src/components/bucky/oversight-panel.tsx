"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  CircleHelp,
  FileText,
  History,
  Loader2,
  Send,
  Undo2,
  X,
} from "lucide-react";
import {
  FAMILY_CHANGE_QUESTION_TYPE,
  parseFamilyChangeSet,
  type FamilyChangeSet,
  type FamilyMinorDecisions,
} from "@/lib/family-change-contract";

interface BuckyQuestion {
  id: string;
  question: string;
  context: string | null;
  status: string;
  targetPerson: string | null;
  questionType: string;
  sourceType: string | null;
  sourceId: string | null;
  sourceLabel: string | null;
  options: unknown;
  proposedAction: unknown;
  answer: string | null;
  answeredBy: string | null;
  answeredAt: string | null;
  createdAt: string;
}

interface LedgerEntry {
  id: string;
  actionType: string;
  summary: string;
  details: string | null;
  initiatedBy: string | null;
  sourceType: string | null;
  sourceId: string | null;
  sourceLabel: string | null;
  reversible: boolean;
  revertedAt: string | null;
  revertedBy: string | null;
  createdAt: string;
}

function sourceLink(sourceType: string | null, sourceId: string | null) {
  return sourceType === "document" && sourceId ? `/documents/${sourceId}` : null;
}

export function BuckyQuestionsPanel({ onCountChange }: { onCountChange: (count: number) => void }) {
  const [status, setStatus] = useState<"open" | "answered">("open");
  const [questions, setQuestions] = useState<BuckyQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [minorDecisions, setMinorDecisions] = useState<Record<string, FamilyMinorDecisions>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const loadQuestions = async (selectedStatus = status) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/bucky/questions?status=${selectedStatus}`);
      if (!response.ok) throw new Error("Unable to load questions");
      const data = (await response.json()) as BuckyQuestion[];
      setQuestions(data);
      if (selectedStatus === "open") onCountChange(data.length);
    } catch {
      setQuestions([]);
      if (selectedStatus === "open") onCountChange(0);
      setNotice("Questions are unavailable until the database update is installed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadQuestions(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const submitAnswer = async (question: BuckyQuestion, answer: string) => {
    const cleanAnswer = answer.trim();
    if (!cleanAnswer || processingId) return;
    setProcessingId(question.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/bucky/questions/${question.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: cleanAnswer }),
      });
      if (!response.ok) throw new Error("Unable to save answer");
      const result = (await response.json()) as { processed?: boolean };
      setNotice(
        result.processed
          ? "Answer recorded. Bucky reviewed it and logged any resulting action."
          : "Answer recorded. Bucky could not process it yet, so it remains in the ledger."
      );
      setDrafts((current) => ({ ...current, [question.id]: "" }));
      await loadQuestions("open");
    } catch {
      setNotice("The answer could not be saved. Please try again.");
    } finally {
      setProcessingId(null);
    }
  };

  const dismissQuestion = async (question: BuckyQuestion) => {
    if (processingId) return;
    setProcessingId(question.id);
    try {
      const response = await fetch(`/api/bucky/questions/${question.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      });
      if (!response.ok) throw new Error("Unable to dismiss question");
      await loadQuestions("open");
    } catch {
      setNotice("The question could not be dismissed. Please try again.");
    } finally {
      setProcessingId(null);
    }
  };

  const confirmFamilyChange = async (
    question: BuckyQuestion,
    changeSet: FamilyChangeSet
  ) => {
    if (processingId) return;
    setProcessingId(question.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/bucky/questions/${question.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm_family_change",
          minorDecisions: minorDecisions[question.id] || {},
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Unable to confirm proposal");
      setNotice(`Family tree updated after human confirmation: ${changeSet.summary}`);
      await loadQuestions("open");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The family-tree proposal could not be confirmed.");
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold text-stone-800">Questions from Bucky</h2>
            <p className="text-xs text-stone-500 mt-1">Clarifications that should survive beyond a chat.</p>
          </div>
          <div className="inline-flex rounded-lg border border-stone-200 bg-white p-1">
            {(["open", "answered"] as const).map((value) => (
              <button
                key={value}
                onClick={() => setStatus(value)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize ${
                  status === value ? "bg-stone-800 text-white" : "text-stone-500 hover:text-stone-800"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        {notice && <p className="mb-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-stone-600">{notice}</p>}

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-green-700" /></div>
        ) : questions.length === 0 ? (
          <div className="text-center py-16 text-stone-400">
            <CheckCircle2 size={36} className="mx-auto mb-3 text-green-600" />
            <p className="text-sm">{status === "open" ? "Nothing needs an answer." : "No answered questions yet."}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {questions.map((question) => {
              const options = Array.isArray(question.options) ? question.options.map(String) : [];
              const link = sourceLink(question.sourceType, question.sourceId);
              const isProcessing = processingId === question.id;
              let familyChange: FamilyChangeSet | null = null;
              if (question.questionType === FAMILY_CHANGE_QUESTION_TYPE) {
                try {
                  familyChange = parseFamilyChangeSet(question.proposedAction);
                } catch {
                  familyChange = null;
                }
              }
              const unresolvedMinorKeys = familyChange?.people
                .filter((person) => person.possibleMinor)
                .map((person) => person.key)
                .filter((key) => !minorDecisions[question.id]?.[key]) ?? [];
              return (
                <article key={question.id} className="rounded-lg border border-stone-200 bg-white p-4">
                  <div className="flex gap-3">
                    <CircleHelp size={18} className="mt-0.5 flex-shrink-0 text-amber-600" />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-stone-800">{question.question}</h3>
                      {question.context && <p className="mt-1.5 whitespace-pre-line text-xs leading-5 text-stone-600">{question.context}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-400">
                        {question.targetPerson && <span>For {question.targetPerson}</span>}
                        <span>{new Date(question.createdAt).toLocaleString()}</span>
                        {question.sourceLabel && (link ? (
                          <Link href={link} className="inline-flex items-center gap-1 text-green-700 hover:underline">
                            <FileText size={11} /> {question.sourceLabel}
                          </Link>
                        ) : <span>Source: {question.sourceLabel}</span>)}
                      </div>

                      {status === "answered" ? (
                        <div className="mt-3 border-t border-stone-100 pt-3">
                          <p className="text-sm text-stone-700">{question.answer}</p>
                          <p className="mt-1 text-[11px] text-stone-400">Answered by {question.answeredBy || "a family member"}</p>
                        </div>
                      ) : familyChange ? (
                        <div className="mt-3 space-y-3 border-t border-stone-100 pt-3">
                          {familyChange.people.filter((person) => person.possibleMinor).map((person) => {
                            const decision = minorDecisions[question.id]?.[person.key];
                            return (
                              <fieldset key={person.key} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                                <legend className="px-1 text-xs font-semibold text-amber-900">
                                  Is {person.displayName} a minor?
                                </legend>
                                <p className="mb-2 text-[11px] leading-4 text-amber-800">
                                  Bucky cannot decide this. A minor is shown by first name only on the public tree and cannot claim a profile.
                                </p>
                                <div className="flex gap-2">
                                  {(["minor", "adult"] as const).map((value) => (
                                    <button
                                      key={value}
                                      type="button"
                                      onClick={() => setMinorDecisions((current) => ({
                                        ...current,
                                        [question.id]: {
                                          ...(current[question.id] || {}),
                                          [person.key]: value,
                                        },
                                      }))}
                                      className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                                        decision === value
                                          ? "border-amber-700 bg-amber-700 text-white"
                                          : "border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                                      }`}
                                    >
                                      {value === "minor" ? "Minor" : "Adult"}
                                    </button>
                                  ))}
                                </div>
                              </fieldset>
                            );
                          })}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => void confirmFamilyChange(question, familyChange!)}
                              disabled={Boolean(processingId) || unresolvedMinorKeys.length > 0}
                              className="flex-1 rounded-lg bg-green-700 px-3 py-2.5 text-xs font-semibold text-white hover:bg-green-800 disabled:opacity-40"
                            >
                              {isProcessing ? <Loader2 size={15} className="mx-auto animate-spin" /> : "Confirm these changes"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void dismissQuestion(question)}
                              disabled={Boolean(processingId)}
                              className="rounded-lg border border-stone-200 px-3 py-2.5 text-xs font-medium text-stone-500 hover:bg-stone-50 disabled:opacity-40"
                            >
                              Dismiss
                            </button>
                          </div>
                          {unresolvedMinorKeys.length > 0 && (
                            <p className="text-[11px] text-amber-700">Choose minor or adult before confirming.</p>
                          )}
                        </div>
                      ) : question.questionType === FAMILY_CHANGE_QUESTION_TYPE ? (
                        <div className="mt-3 space-y-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                          <p>This proposal is malformed and cannot be applied. Dismiss it and ask Bucky to propose it again.</p>
                          <button
                            type="button"
                            onClick={() => void dismissQuestion(question)}
                            disabled={Boolean(processingId)}
                            className="rounded-md border border-red-300 bg-white px-2.5 py-1.5 font-medium hover:bg-red-100 disabled:opacity-40"
                          >
                            Dismiss malformed proposal
                          </button>
                        </div>
                      ) : (
                        <div className="mt-3 space-y-2">
                          {options.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {options.map((option) => (
                                <button
                                  key={option}
                                  onClick={() => void submitAnswer(question, option)}
                                  disabled={Boolean(processingId)}
                                  className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-medium text-green-800 hover:bg-green-100 disabled:opacity-50"
                                >
                                  {option}
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="flex gap-2">
                            <input
                              value={drafts[question.id] || ""}
                              onChange={(event) => setDrafts((current) => ({ ...current, [question.id]: event.target.value }))}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") void submitAnswer(question, drafts[question.id] || "");
                              }}
                              placeholder="Write an answer"
                              className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-green-600 focus:outline-none"
                            />
                            <button
                              onClick={() => void submitAnswer(question, drafts[question.id] || "")}
                              disabled={!drafts[question.id]?.trim() || Boolean(processingId)}
                              aria-label="Send answer"
                              className="rounded-lg bg-green-700 p-2.5 text-white hover:bg-green-800 disabled:opacity-40"
                            >
                              {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                            </button>
                            <button
                              onClick={() => void dismissQuestion(question)}
                              disabled={Boolean(processingId)}
                              aria-label="Dismiss question"
                              className="rounded-lg border border-stone-200 p-2.5 text-stone-400 hover:bg-stone-50 hover:text-stone-700 disabled:opacity-40"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function BuckyLedgerPanel() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadEntries = async () => {
    const response = await fetch("/api/bucky/ledger?limit=100");
    if (!response.ok) throw new Error("Unable to load ledger");
    setEntries(await response.json() as LedgerEntry[]);
  };

  useEffect(() => {
    void loadEntries().catch(() => setNotice("The Ledger is unavailable right now.")).finally(() => setLoading(false));
  }, []);

  const undoEntry = async (entry: LedgerEntry) => {
    if (undoingId || !window.confirm(`Undo "${entry.summary}"? Bucky will first verify that nobody changed the record afterward.`)) return;
    setUndoingId(entry.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/bucky/ledger/${entry.id}/undo`, { method: "POST" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Unable to undo this action");
      setNotice("The action was undone and the correction was added to the Ledger.");
      await loadEntries();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The action could not be undone.");
    } finally {
      setUndoingId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <div className="max-w-lg mx-auto">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-stone-800">Bucky&apos;s Ledger</h2>
          <p className="text-xs text-stone-500 mt-1">A permanent account of what Bucky changed and why.</p>
        </div>
        {notice && <p className="mb-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-stone-600">{notice}</p>}
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-green-700" /></div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 text-stone-400">
            <History size={36} className="mx-auto mb-3" />
            <p className="text-sm">Bucky has not logged any actions yet.</p>
          </div>
        ) : (
          <div className="border-l border-stone-200 ml-2 pl-5 space-y-5">
            {entries.map((entry) => {
              const link = sourceLink(entry.sourceType, entry.sourceId);
              return (
                <article key={entry.id} className="relative">
                  <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-green-700 ring-4 ring-stone-50" />
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="min-w-0 text-sm font-medium text-stone-800">{entry.summary}</h3>
                    {entry.reversible && !entry.revertedAt && (
                      <button
                        type="button"
                        onClick={() => void undoEntry(entry)}
                        disabled={Boolean(undoingId)}
                        title="Undo this change"
                        className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-600 hover:border-stone-300 hover:bg-stone-50 disabled:opacity-50"
                      >
                        {undoingId === entry.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
                        Undo
                      </button>
                    )}
                  </div>
                  {entry.details && <p className="mt-1 text-xs leading-5 text-stone-600">{entry.details}</p>}
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-400">
                    <span>{new Date(entry.createdAt).toLocaleString()}</span>
                    {entry.initiatedBy && <span>Requested by {entry.initiatedBy}</span>}
                    {entry.sourceLabel && (link ? (
                      <Link href={link} className="text-green-700 hover:underline">Source: {entry.sourceLabel}</Link>
                    ) : <span>Source: {entry.sourceLabel}</span>)}
                    {entry.revertedAt && <span>Undone{entry.revertedBy ? ` by ${entry.revertedBy}` : ""}</span>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
