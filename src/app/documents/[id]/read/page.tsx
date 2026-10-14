"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { Header } from "@/components/layout/header";

interface OriginalText {
  title: string;
  fileName: string;
  text: string;
  truncated: boolean;
}

export default function OriginalDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const [document, setDocument] = useState<OriginalText | null>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const fileUrl = `/api/documents/${encodeURIComponent(id)}/file`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setDocument(null);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(`${fileUrl}?view=text`, { cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setError({
            status: response.status,
            message: response.status === 401 ? "Please sign in to read this document."
              : response.status === 403 ? "Your current access does not allow this document."
              : response.status === 404 ? "The original document is unavailable."
              : [413, 415, 422].includes(response.status) ? "This document cannot be shown as text. You can download the original file instead."
              : "The document could not be loaded. Please try again.",
          });
          return;
        }
        if (!body || typeof body.title !== "string" || typeof body.fileName !== "string" || typeof body.text !== "string" || typeof body.truncated !== "boolean") {
          setError({ status: 502, message: "The document could not be loaded. Please try again." });
          return;
        }
        setDocument(body);
      } catch {
        if (!controller.signal.aborted) setError({ status: 0, message: "The document could not be loaded. Please try again." });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [fileUrl, attempt]);

  return (
    <div className="fade-in history-page">
      <Header title={document?.title || "Read the original"} subtitle="From the family archive" />
      <div className="history-article original-reader">
        <div className="original-reader-actions">
          <Link href="/history"><ArrowLeft size={16} aria-hidden="true" />History of the hill</Link>
          <Link href={`/documents/${encodeURIComponent(id)}`}>Archive record</Link>
          {(document || (error && [413, 415, 422].includes(error.status))) && <a href={`${fileUrl}?download=1`}><Download size={16} aria-hidden="true" />Download original</a>}
        </div>
        {loading && <p role="status" className="original-reader-status"><Loader2 size={18} className="animate-spin" aria-hidden="true" />Opening the original document…</p>}
        {error && <div role="alert" className="original-reader-status">
          <p>{error.message}</p>
          {error.status === 401 ? <Link href={`/login?from=${encodeURIComponent(`/documents/${id}/read`)}`}>Sign in</Link>
            : [0, 500, 502, 503, 504].includes(error.status) && <button type="button" className="btn-quiet" onClick={() => setAttempt(value => value + 1)}>Try again</button>}
        </div>}
        {document && <>
          <p className="original-reader-note">Text from <strong>{document.fileName}</strong>. Download the original for its formatting and images.</p>
          {document.truncated && <p role="status" className="original-reader-note">This text view shows the beginning of a long document. Download the original to read it in full.</p>}
          <article aria-label={`Original text of ${document.title}`} className="original-reader-text">{document.text}</article>
        </>}
      </div>
    </div>
  );
}
