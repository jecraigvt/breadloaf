"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import {
  ArrowLeft,
  Calendar,
  Tag,
  User,
  FolderOpen,
  Download,
  Trash2,
  FileText,
  Loader2,
  ExternalLink,
  Link2,
} from "lucide-react";
import Link from "next/link";
import type { DocumentWithCategory } from "@/types";
import "../../fieldguide-archive.css";
import { formatDate, formatFileSize, parseTags } from "@/lib/utils";

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [doc, setDoc] = useState<DocumentWithCategory | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/documents/${params.id}`)
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }

        return (await response.json()) as DocumentWithCategory;
      })
      .then((document) => {
        if (!cancelled) {
          setDoc(document);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDoc(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const handleDelete = async () => {
    if (!confirm("Move this document to Recently Deleted? The original file will be kept.")) return;
    setDeleting(true);
    await fetch(`/api/documents/${params.id}`, { method: "DELETE" });
    router.push("/documents");
  };

  if (loading) {
    return (
      <div className="fg-archive">
        <Header title="Loading..." />
        <div className="flex justify-center py-20">
          <Loader2 size={32} className="animate-spin text-green-700" />
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="fg-archive">
        <Header title="Not Found" />
        <div className="text-center py-12">
          <p className="text-stone-500">Document not found</p>
          <Link href="/documents" className="text-green-700 mt-2 inline-block">
            Back to Archive
          </Link>
        </div>
      </div>
    );
  }

  const tags = parseTags(doc.tags);

  return (
    <div className="fg-archive fg-document-detail">
      <Header title={doc.title} />

      <div className="fg-archive-body fg-document-body space-y-5">
        <div className="fg-archive-topline">
        <Link
          href="/documents"
          className="fg-archive-text-link"
        >
          <ArrowLeft size={16} />
          Back to Archive
        </Link>
        <span className="fg-archive-eyebrow">From the archive</span>
        </div>

        {/* A story belongs to whoever told it. A fact is true regardless of who
            recorded it, so for everything else the uploader stays down in the
            metadata rows — but on a recording the teller is the point, and
            burying the name treats a voice like provenance. */}
        {doc.fileType.startsWith("audio/") && doc.uploadedBy && (
          <p className="text-sm text-stone-600">
            Recorded by <span className="font-medium text-stone-900">{doc.uploadedBy}</span>
          </p>
        )}

        {/* Document Preview */}
        {doc.fileType === "link" ? (
          <a
            href={doc.filePath}
            target="_blank"
            rel="noopener noreferrer"
            className="fg-document-preview block rounded-xl border border-blue-200 bg-blue-50 p-8 text-center hover:bg-blue-100 transition-colors"
          >
            <Link2 size={48} className="mx-auto text-blue-400 mb-3" />
            <p className="text-blue-700 font-medium text-sm break-all">{doc.filePath}</p>
            <span className="inline-flex items-center gap-1 mt-3 text-xs font-medium text-blue-600">
              <ExternalLink size={12} /> Open Link
            </span>
          </a>
        ) : doc.fileType.startsWith("image/") ? (
          <div className="fg-document-preview rounded-xl overflow-hidden border border-stone-200">
            <img src={`/api/documents/${doc.id}/file`} alt={doc.title} className="w-full" />
          </div>
        ) : (
          <a
            href={`/api/documents/${doc.id}/file?download=1`}
            className="fg-document-preview block rounded-xl border border-stone-200 p-12 text-center bg-stone-50 hover:bg-stone-100 transition-colors"
          >
            <FileText size={64} className="mx-auto text-stone-300 mb-2" />
            <p className="text-stone-500">{doc.fileName}</p>
            <span className="inline-flex items-center gap-1 mt-3 text-xs font-medium text-green-700">
              <Download size={12} /> Tap to download
            </span>
          </a>
        )}

        {/* Metadata */}
        <div className="fg-document-metadata bg-white rounded-xl border border-stone-200 divide-y divide-stone-100">
          {doc.category && (
            <div className="flex items-center gap-3 px-4 py-3">
              <FolderOpen size={18} className="text-stone-400" />
              <span className="text-sm text-stone-500">Category</span>
              <span className="ml-auto text-sm font-medium text-stone-800">
                {doc.category.name}
              </span>
            </div>
          )}
          <div className="flex items-center gap-3 px-4 py-3">
            <Calendar size={18} className="text-stone-400" />
            <span className="text-sm text-stone-500">Uploaded</span>
            <span className="ml-auto text-sm text-stone-800">
              {formatDate(doc.createdAt)}
            </span>
          </div>
          {doc.uploadedBy && (
            <div className="flex items-center gap-3 px-4 py-3">
              <User size={18} className="text-stone-400" />
              <span className="text-sm text-stone-500">By</span>
              <span className="ml-auto text-sm text-stone-800">
                {doc.uploadedBy}
              </span>
            </div>
          )}
          {doc.fileType !== "link" && (
            <div className="flex items-center gap-3 px-4 py-3">
              <FileText size={18} className="text-stone-400" />
              <span className="text-sm text-stone-500">Size</span>
              <span className="ml-auto text-sm text-stone-800">
                {formatFileSize(doc.fileSize)}
              </span>
            </div>
          )}
            <div className="flex items-center gap-3 px-4 py-3">
              <FileText size={18} className="text-stone-400" />
              <span className="text-sm text-stone-500">Protection</span>
              <span className="ml-auto text-sm text-amber-700">
                {doc.fileType === "link" ? "External link" : "Local copy only"}
              </span>
            </div>
        </div>

        {/* AI Summary */}
        {doc.aiSummary && (
          <div className="fg-archive-panel fg-document-summary bg-green-50 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-green-800 mb-1">AI Summary</h3>
            <p className="text-sm text-green-700">{doc.aiSummary}</p>
          </div>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Tag size={14} className="text-stone-400" />
            {tags.map((tag) => (
              <span
                key={tag}
                className="bg-stone-100 text-stone-600 px-2 py-1 rounded-full text-xs"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Extracted Text */}
        {doc.aiExtractedText && (
          <details className="fg-archive-panel bg-stone-50 rounded-xl p-4">
            <summary className="text-sm font-medium text-stone-700 cursor-pointer">
              Extracted Text
            </summary>
            <p className="text-sm text-stone-600 mt-2 whitespace-pre-wrap">
              {doc.aiExtractedText}
            </p>
          </details>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          {doc.fileType === "link" ? (
            <a
              href={doc.filePath}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-blue-300 text-blue-700 font-medium hover:bg-blue-50"
            >
              <ExternalLink size={18} />
              Open Document
            </a>
          ) : (
            <a
              href={`/api/documents/${doc.id}/file?download=1`}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-stone-300 text-stone-600 font-medium hover:bg-stone-50"
            >
              <Download size={18} />
              Download
            </a>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl border-2 border-red-200 text-red-600 font-medium hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Trash2 size={18} />
            )}
            <span className="sr-only">Move to Recently Deleted</span>
          </button>
        </div>
      </div>
    </div>
  );
}
