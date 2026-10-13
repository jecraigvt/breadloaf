"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";

interface MailRow { id: string; senderName: string | null; fromEmail: string; subject: string | null; status: string; authenticationStatus: string | null; lastError: string | null; receivedAt: string }
interface MailStatus { configured: boolean; checkedAt: string | null; counts: Record<string, number>; recent: MailRow[]; review: MailRow[]; legacyUnretainedCount: number }
interface MailPreview { id: string; from: string; subject: string | null; status: string; authenticationReason: string | null; sourceAvailable: boolean; preview: { text: string; attachments: { name: string; size: number }[]; additionalAttachments: number } | null }

export default function MailRoomPage() {
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [selected, setSelected] = useState<MailPreview | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const response = await fetch("/api/email/poll", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Mail Room is unavailable");
    setStatus(data);
  }
  useEffect(() => { void load().catch((caught) => setError(caught.message)); }, []);
  async function open(id: string) {
    setError("");
    try { const response = await fetch(`/api/email/${id}`, { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setSelected(data); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to preview email"); }
  }
  async function review(action: "approve" | "dismiss" | "retry") {
    if (!selected || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/email/${selected.id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setMessage(data.message); setSelected(null); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Review could not be saved"); }
    finally { setBusy(false); }
  }
  async function check() {
    setBusy(true); setError(""); setMessage("");
    try { const response = await fetch("/api/email/poll", { method: "POST" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setMessage(data.errors?.length ? "Saved messages are retained; some need another attempt or review." : "Mailbox checked. Saved messages were processed."); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Check failed; originals remain saved"); }
    finally { setBusy(false); }
  }
  const reviewRows = status?.review || [];
  return <div><Header title="Mail Room" subtitle="Review incoming family mail" /><main className="px-5 py-6 space-y-5">
    <p className="text-sm text-stone-600">Verified family mail files automatically. Unknown or unverified senders wait here for a curator to review.</p>
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    {status && <><div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>{status.checkedAt ? `Last check: ${new Date(status.checkedAt).toLocaleString()}` : "Waiting for first scheduled check"}</span><button className="btn-quiet" disabled={busy} onClick={() => void check()}>{busy ? "Working…" : "Check now"}</button></div>
      {!status.configured && <p className="text-sm text-amber-800">Gmail access is not configured. Previously retained mail is still available.</p>}
      {status.legacyUnretainedCount > 0 && <p className="rounded border border-stone-300 p-3 text-xs text-stone-600">{status.legacyUnretainedCount} earlier mail receipts have no original saved here. To repair an earlier failure, open that message in Gmail and check the archive before importing it again.</p>}
      <section><h2 className="font-serif text-xl">Needs review</h2>{!reviewRows.length ? <p className="mt-3 text-sm text-stone-600">No messages need review.</p> : <ul className="mt-3 space-y-2">{reviewRows.map((row) => <li key={row.id}><button onClick={() => void open(row.id)} className="w-full rounded border border-stone-300 p-3 text-left"><span className="block font-medium">{row.subject || "(no subject)"}</span><span className="mt-1 block break-all text-xs text-stone-600">{row.senderName || row.fromEmail} · {row.status}</span>{row.lastError && <span className="mt-2 block text-xs text-amber-900">{row.lastError}</span>}</button></li>)}</ul>}</section>
      {selected && <section className="space-y-3 rounded border border-stone-300 bg-white/60 p-4"><h2 className="font-medium">{selected.subject}</h2><p className="break-all text-xs">From: {selected.from}</p><p className="text-xs text-amber-900">{selected.authenticationReason}</p>{selected.preview && <><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">{selected.preview.text || "No readable message body"}</pre>{selected.preview.attachments.length > 0 && <ul className="space-y-1 text-xs">{selected.preview.attachments.map((attachment, index) => <li key={index}>{attachment.name} · {Math.ceil(attachment.size / 1024)} KB</li>)}</ul>}{selected.preview.additionalAttachments > 0 && <p className="text-xs">More attachments are in the original.</p>}</>}
        {selected.sourceAvailable && <a className="block text-sm underline" href={`/api/email/${selected.id}/source`}>Download original email</a>}
        <p className="text-xs text-stone-600">Approving this message can add visits and archive documents. It does not approve the sender for future messages.</p>
        <div className="flex flex-wrap gap-2"><button className="btn-ember" disabled={busy || !selected.sourceAvailable} onClick={() => void review("approve")}>Approve message</button><button className="btn-quiet" disabled={busy} onClick={() => void review("dismiss")}>Keep without filing</button><button className="btn-quiet" disabled={busy} onClick={() => setSelected(null)}>Close</button></div>
      </section>}
      <p className="text-xs text-stone-500">{status.counts.completed || 0} completed · {status.counts.received || 0} waiting · {status.counts.retry || 0} retrying</p>
    </>}
    <Link className="text-sm underline" href="/access">Family access settings</Link>
  </main></div>;
}
