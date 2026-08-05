"use client";

import { useState } from "react";
import { Header } from "@/components/layout/header";
import { CameraCapture } from "@/components/upload/camera-capture";
import { FileDropzone } from "@/components/upload/file-dropzone";
import {
  Loader2,
  CheckCircle2,
  Tag,
  FolderOpen,
  FileText,
  X,
  Wrench,
  Link2,
  Mic,
  Video,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";

type UploadStep = "select" | "preview" | "uploading" | "categorizing" | "review" | "done" | "link" | "batch";

interface BatchItem {
  file: File;
  status: "queued" | "uploading" | "categorizing" | "filed" | "needs-review" | "error";
  title?: string;
  categoryName?: string | null;
  categoryCreated?: boolean;
  error?: string;
}

interface CategorizationResult {
  suggestedCategory: string;
  title: string;
  summary: string | null;
  extractedText?: string | null;
  tags: string[];
  confidence: number;
  resolvedCategorySlug?: string | null;
  resolvedCategoryName?: string | null;
  categoryCreated?: boolean;
  needsReview?: boolean;
  analysisState: "ok" | "unsupported_type" | "too_large" | "provider_error";
  analysisError: string | null;
  maintenanceCost?: number | null;
  maintenanceDate?: string | null;
  maintenanceVendor?: string | null;
}

export default function UploadPage() {
  const [step, setStep] = useState<UploadStep>("select");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploadedBy, setUploadedBy] = useState(
    typeof window !== "undefined"
      ? localStorage.getItem("breadloaf-username") || ""
      : ""
  );
  const [result, setResult] = useState<CategorizationResult | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [savedDocId, setSavedDocId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Link form state
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkCategory, setLinkCategory] = useState("");
  const [linkDescription, setLinkDescription] = useState("");
  const [linkContentSummary, setLinkContentSummary] = useState("");
  const [linkPageText, setLinkPageText] = useState("");
  const [savingLink, setSavingLink] = useState(false);
  const [analyzingLink, setAnalyzingLink] = useState(false);
  const [categories, setCategories] = useState<{ name: string; slug: string }[]>([]);

  // Fetch categories for the link form
  const fetchCategories = async () => {
    try {
      const res = await fetch("/api/documents?categoriesOnly=true");
      if (res.ok) {
        const data = await res.json();
        setCategories(data);
      }
    } catch {
      // ignore
    }
  };

  // Auto-analyze URL when pasted
  const analyzeLink = async (url: string) => {
    if (!url.trim() || !url.startsWith("http")) return;
    setAnalyzingLink(true);
    try {
      const res = await fetch("/api/documents/analyze-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.title) setLinkTitle(data.title);
        if (data.categorySlug) setLinkCategory(data.categorySlug);
        if (data.description) setLinkDescription(data.description);
        if (data.contentSummary) setLinkContentSummary(data.contentSummary);
        if (data.pageText) setLinkPageText(data.pageText);
      }
    } catch {
      // Analysis failed — user can fill in manually
    }
    setAnalyzingLink(false);
  };

  const handleSaveLink = async () => {
    if (!linkUrl.trim() || !linkTitle.trim()) return;
    setSavingLink(true);
    setError(null);

    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: linkTitle.trim(),
          description: linkDescription.trim() || undefined,
          fileName: linkTitle.trim(),
          filePath: linkUrl.trim(),
          fileType: "link",
          fileSize: 0,
          categorySlug: linkCategory || undefined,
          tags: [],
          aiSummary: linkContentSummary || linkDescription.trim() || undefined,
          aiExtractedText: linkPageText || undefined,
          uploadedBy,
        }),
      });

      if (!res.ok) throw new Error(await res.text());

      const doc = await res.json();
      setSavedDocId(doc.id);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save link");
    }
    setSavingLink(false);
  };

  const handleFile = (f: File) => {
    setFile(f);
    setError(null);
    if (f.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target?.result as string);
      reader.readAsDataURL(f);
    } else {
      setPreview(null);
    }
    setStep("preview");
  };

  const handleUpload = async () => {
    if (!file) return;
    setError(null);

    // Save username
    if (uploadedBy) {
      localStorage.setItem("breadloaf-username", uploadedBy);
    }

    try {
      // Step 1: Upload file
      setStep("uploading");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("uploadedBy", uploadedBy);

      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!uploadRes.ok) {
        throw new Error(await uploadRes.text());
      }

      const uploadData = await uploadRes.json();

      // Step 2: Categorize with AI
      setStep("categorizing");
      const catRes = await fetch("/api/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: uploadData.filePath,
          fileType: uploadData.fileType,
          fileName: uploadData.fileName,
        }),
      });

      if (catRes.ok) {
        const catData = await catRes.json();
        setResult(catData);
        setEditTitle(catData.title);
      } else {
        // Categorization failed, continue with manual info
        setResult({
          suggestedCategory: "",
          title: file.name,
          summary: null,
          tags: [],
          confidence: 0,
          needsReview: true,
          analysisState: "provider_error",
          analysisError: `Categorization request failed (${catRes.status}).`,
        });
        setEditTitle(file.name);
      }

      // Store upload data for final save
      setFile(Object.assign(file, { uploadData }));
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setStep("preview");
    }
  };

  // ─── Batch mode: dump many files, they file themselves ─────────
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);

  const handleFiles = (files: File[]) => {
    if (uploadedBy) localStorage.setItem("breadloaf-username", uploadedBy);
    const items: BatchItem[] = files.map((file) => ({ file, status: "queued" }));
    setBatchItems(items);
    setStep("batch");
    setError(null);
    processBatch(items);
  };

  const updateBatchItem = (index: number, patch: Partial<BatchItem>) => {
    setBatchItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
  };

  const processBatch = async (items: BatchItem[]) => {
    setBatchRunning(true);
    // Sequential to keep the AI happy and progress legible
    for (let i = 0; i < items.length; i++) {
      try {
        updateBatchItem(i, { status: "uploading" });
        const formData = new FormData();
        formData.append("file", items[i].file);
        formData.append("uploadedBy", uploadedBy);
        const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
        if (!uploadRes.ok) throw new Error(await uploadRes.text());
        const uploadData = await uploadRes.json();

        updateBatchItem(i, { status: "categorizing" });
        const catRes = await fetch("/api/categorize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filePath: uploadData.filePath,
            fileType: uploadData.fileType,
            fileName: uploadData.fileName,
          }),
        });
        const catData: CategorizationResult = catRes.ok
          ? await catRes.json()
          : {
              suggestedCategory: "",
              title: items[i].file.name,
              summary: null,
              tags: [],
              confidence: 0,
              needsReview: true,
              analysisState: "provider_error",
              analysisError: `Categorization request failed (${catRes.status}).`,
            };

        const saveRes = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: catData.title || items[i].file.name,
            description: catData.summary,
            fileName: uploadData.fileName,
            filePath: uploadData.filePath,
            fileType: uploadData.fileType,
            fileSize: uploadData.fileSize,
            checksum: uploadData.checksum,
            categorySlug: catData.resolvedCategorySlug ?? "",
            tags: catData.tags,
            aiSummary: catData.summary,
            aiExtractedText: catData.extractedText ?? null,
            analysisState: catData.analysisState,
            analysisError: catData.analysisError,
            uploadedBy,
            maintenanceCost: catData.maintenanceCost,
            maintenanceDate: catData.maintenanceDate,
            maintenanceVendor: catData.maintenanceVendor,
          }),
        });
        if (!saveRes.ok) throw new Error(await saveRes.text());
        const savedDocument = await saveRes.json();

        updateBatchItem(i, {
          status: catData.needsReview ? "needs-review" : "filed",
          title: savedDocument.title,
          categoryName: catData.resolvedCategoryName,
          categoryCreated: catData.categoryCreated,
        });
      } catch (err) {
        updateBatchItem(i, {
          status: "error",
          error: err instanceof Error ? err.message : "Failed",
        });
      }
    }
    setBatchRunning(false);
  };

  const handleSave = async () => {
    if (!file || !result) return;
    setError(null);

    try {
      const uploadData = (file as File & { uploadData: Record<string, string> }).uploadData;

      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle || result.title,
          description: result.summary,
          fileName: uploadData.fileName,
          filePath: uploadData.filePath,
          fileType: uploadData.fileType,
          fileSize: uploadData.fileSize,
          checksum: uploadData.checksum,
          categorySlug: result.resolvedCategorySlug ?? result.suggestedCategory,
          tags: result.tags,
          aiSummary: result.summary,
          aiExtractedText: result.extractedText ?? null,
          analysisState: result.analysisState,
          analysisError: result.analysisError,
          uploadedBy,
          maintenanceCost: result.maintenanceCost,
          maintenanceDate: result.maintenanceDate,
          maintenanceVendor: result.maintenanceVendor,
        }),
      });

      if (!res.ok) throw new Error(await res.text());

      const doc = await res.json();
      setSavedDocId(doc.id);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setEditTitle("");
    setSavedDocId(null);
    setError(null);
    setBatchItems([]);
    setBatchRunning(false);
    setLinkUrl("");
    setLinkTitle("");
    setLinkCategory("");
    setLinkDescription("");
    setLinkContentSummary("");
    setLinkPageText("");
    setStep("select");
  };

  return (
    <div>
      <Header
        title="Add to Archive"
        subtitle="Upload documents, recordings, videos, or link a URL"
      />

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm flex items-start gap-2">
            <X size={16} className="mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}

        {step === "select" && (
          <>
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              <ShieldAlert size={18} className="mt-0.5 flex-shrink-0" />
              <p>
                Vault protection is not active yet. Do not upload passwords, account numbers,
                or safe-deposit details.
              </p>
            </div>
            <CameraCapture onCapture={handleFile} />
            <div className="relative flex items-center gap-4">
              <div className="flex-1 h-px bg-stone-200" />
              <span className="text-stone-400 text-sm">or</span>
              <div className="flex-1 h-px bg-stone-200" />
            </div>
            <FileDropzone onFile={handleFile} onFiles={handleFiles} />
            <div className="relative flex items-center gap-4">
              <div className="flex-1 h-px bg-stone-200" />
              <span className="text-stone-400 text-sm">or</span>
              <div className="flex-1 h-px bg-stone-200" />
            </div>
            <button
              onClick={() => { setStep("link"); fetchCategories(); }}
              className="w-full flex items-center justify-center gap-3 border-2 border-dashed border-stone-300 text-stone-500 py-4 rounded-xl text-base font-medium hover:border-green-400 hover:text-green-700 transition-colors"
            >
              <Link2 size={20} />
              Link a Document (URL)
            </button>
          </>
        )}

        {step === "batch" && (
          <div className="space-y-4">
            <div className={`rounded-xl p-4 border ${batchRunning ? "bg-green-50 border-green-200" : "bg-stone-50 border-stone-200"}`}>
              <h3 className="font-semibold text-stone-800 flex items-center gap-2">
                {batchRunning ? (
                  <Loader2 size={18} className="animate-spin text-green-600" />
                ) : (
                  <CheckCircle2 size={18} className="text-green-600" />
                )}
                {batchRunning
                  ? `Processing ${batchItems.filter((b) => b.status === "filed" || b.status === "needs-review" || b.status === "error").length} of ${batchItems.length}...`
                  : `Done — ${batchItems.filter((b) => b.status === "filed").length} filed, ${batchItems.filter((b) => b.status === "needs-review").length} need review, ${batchItems.filter((b) => b.status === "error").length} failed`}
              </h3>
              {!batchRunning && batchItems.some((b) => b.status === "needs-review") && (
                <p className="text-sm text-stone-500 mt-1">
                  Items needing review are in the amber bucket on the Documents page.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              {batchItems.map((item, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm ${
                    item.status === "error"
                      ? "bg-red-50 border-red-200"
                      : item.status === "needs-review"
                        ? "bg-amber-50 border-amber-200"
                        : "bg-white border-stone-200"
                  }`}
                >
                  <span className="flex-shrink-0">
                    {item.status === "queued" && <FileText size={16} className="text-stone-300" />}
                    {(item.status === "uploading" || item.status === "categorizing") && (
                      <Loader2 size={16} className="animate-spin text-green-600" />
                    )}
                    {item.status === "filed" && <CheckCircle2 size={16} className="text-green-600" />}
                    {item.status === "needs-review" && <FolderOpen size={16} className="text-amber-600" />}
                    {item.status === "error" && <X size={16} className="text-red-500" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-stone-800 truncate">
                      {item.title || item.file.name}
                    </p>
                    <p className="text-xs text-stone-400 truncate">
                      {item.status === "queued" && "Waiting..."}
                      {item.status === "uploading" && "Uploading..."}
                      {item.status === "categorizing" && "Reading & filing..."}
                      {item.status === "filed" && (
                        <>
                          Filed under <span className="text-green-700 font-medium">{item.categoryName}</span>
                          {item.categoryCreated && <span className="text-blue-600"> (new category)</span>}
                        </>
                      )}
                      {item.status === "needs-review" && "Saved — needs review"}
                      {item.status === "error" && (item.error || "Failed")}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {!batchRunning && (
              <div className="flex gap-3">
                <button
                  onClick={reset}
                  className="flex-1 py-3 rounded-xl border-2 border-stone-300 text-stone-600 font-medium hover:bg-stone-50"
                >
                  Upload More
                </button>
                <Link
                  href="/documents"
                  className="flex-1 py-3 rounded-xl bg-green-700 text-white font-medium hover:bg-green-800 text-center"
                >
                  View Archive
                </Link>
              </div>
            )}
          </div>
        )}

        {step === "link" && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">URL</label>
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData("text");
                  if (pasted.startsWith("http")) {
                    setTimeout(() => analyzeLink(pasted), 100);
                  }
                }}
                onBlur={() => {
                  if (linkUrl.startsWith("http") && !linkTitle) {
                    analyzeLink(linkUrl);
                  }
                }}
                placeholder="https://docs.google.com/..."
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                autoFocus
              />
            </div>

            {analyzingLink && (
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-3">
                <Loader2 size={18} className="animate-spin text-green-600" />
                <span className="text-sm text-green-700">Analyzing document...</span>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Title</label>
              <input
                type="text"
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                placeholder={analyzingLink ? "Detecting..." : "e.g., 2025 Bylaws"}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Category</label>
              <select
                value={linkCategory}
                onChange={(e) => setLinkCategory(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
              >
                <option value="">{analyzingLink ? "Detecting..." : "Select a category..."}</option>
                {categories.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Description</label>
              <input
                type="text"
                value={linkDescription}
                onChange={(e) => setLinkDescription(e.target.value)}
                placeholder={analyzingLink ? "Generating..." : "Brief description of this document"}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Your name</label>
              <input
                type="text"
                value={uploadedBy}
                onChange={(e) => setUploadedBy(e.target.value)}
                placeholder="Who's adding this?"
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={reset}
                className="flex-1 py-3 rounded-xl border-2 border-stone-300 text-stone-600 font-medium hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveLink}
                disabled={!linkUrl.trim() || !linkTitle.trim() || savingLink || analyzingLink}
                className="flex-1 py-3 rounded-xl bg-green-700 text-white font-medium hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {savingLink ? <Loader2 size={18} className="animate-spin" /> : <Link2 size={18} />}
                Save to Archive
              </button>
            </div>
          </div>
        )}

        {step === "preview" && file && (
          <div className="space-y-4">
            {preview && (
              <div className="rounded-xl overflow-hidden border border-stone-200">
                {/* Local object URLs cannot be optimized by next/image. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Preview" className="w-full" />
              </div>
            )}
            {!preview && (
              <div className="rounded-xl border border-stone-200 p-8 text-center">
                {file.type.startsWith("audio/") ? (
                  <Mic size={48} className="mx-auto text-purple-400 mb-2" />
                ) : file.type.startsWith("video/") ? (
                  <Video size={48} className="mx-auto text-blue-400 mb-2" />
                ) : (
                  <FileText size={48} className="mx-auto text-stone-400 mb-2" />
                )}
                <p className="text-stone-600 font-medium">{file.name}</p>
                <p className="text-stone-400 text-sm">
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </p>
                {(file.type.startsWith("audio/") || file.type.startsWith("video/")) && (
                  <p className="text-green-600 text-xs mt-2 font-medium">
                    Bucky will transcribe and analyze this {file.type.startsWith("audio/") ? "recording" : "video"}
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Your name
              </label>
              <input
                type="text"
                value={uploadedBy}
                onChange={(e) => setUploadedBy(e.target.value)}
                placeholder="Who's uploading this?"
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={reset}
                className="flex-1 py-3 rounded-xl border-2 border-stone-300 text-stone-600 font-medium hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                className="flex-1 py-3 rounded-xl bg-green-700 text-white font-medium hover:bg-green-800"
              >
                Upload & Analyze
              </button>
            </div>
          </div>
        )}

        {(step === "uploading" || step === "categorizing") && (
          <div className="text-center py-12">
            <Loader2 size={48} className="mx-auto text-green-700 animate-spin mb-4" />
            <p className="text-stone-600 font-medium">
              {step === "uploading" ? "Uploading document..." : "AI is analyzing your document..."}
            </p>
            <p className="text-stone-400 text-sm mt-1">
              {step === "categorizing" && "Categorizing, extracting text, and generating summary"}
            </p>
          </div>
        )}

        {step === "review" && result && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <h3 className="font-semibold text-green-800 flex items-center gap-2">
                <CheckCircle2 size={18} />
                AI Analysis Complete
              </h3>
              <p className="text-green-700 text-sm mt-1">
                Confidence: {Math.round(result.confidence * 100)}%
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Document Title
              </label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>

            <div className="flex items-center gap-2 text-sm flex-wrap">
              <FolderOpen size={16} className="text-stone-500" />
              <span className="text-stone-500">Category:</span>
              {result.needsReview ? (
                <span className="bg-amber-100 text-amber-800 px-3 py-1 rounded-full font-medium">
                  Needs review — file it from the Documents page
                </span>
              ) : (
                <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full font-medium">
                  {result.resolvedCategoryName || result.suggestedCategory}
                </span>
              )}
              {result.categoryCreated && (
                <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium">
                  new category
                </span>
              )}
            </div>

            {result.summary && (
              <div className="bg-stone-50 rounded-xl p-4">
                <p className="text-sm text-stone-600">{result.summary}</p>
              </div>
            )}

            {result.tags.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <Tag size={14} className="text-stone-400" />
                {result.tags.map((tag) => (
                  <span
                    key={tag}
                    className="bg-stone-100 text-stone-600 px-2 py-1 rounded-full text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {(result.maintenanceCost || result.maintenanceVendor) && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                <div className="flex items-center gap-2 text-orange-800 text-sm font-medium">
                  <Wrench size={16} />
                  Maintenance record will be auto-created
                </div>
                <div className="text-orange-700 text-xs mt-1 space-y-0.5">
                  {result.maintenanceVendor && (
                    <p>Vendor: {result.maintenanceVendor}</p>
                  )}
                  {result.maintenanceCost && (
                    <p>Cost: ${result.maintenanceCost.toFixed(2)}</p>
                  )}
                  {result.maintenanceDate && (
                    <p>Date: {new Date(result.maintenanceDate).toLocaleDateString()}</p>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={reset}
                className="flex-1 py-3 rounded-xl border-2 border-stone-300 text-stone-600 font-medium hover:bg-stone-50"
              >
                Discard
              </button>
              <button
                onClick={handleSave}
                className="flex-1 py-3 rounded-xl bg-green-700 text-white font-medium hover:bg-green-800"
              >
                Save to Archive
              </button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="text-center py-12">
            <CheckCircle2 size={64} className="mx-auto text-green-600 mb-4" />
            <h2 className="text-xl font-bold text-stone-800">Archived!</h2>
            <p className="text-stone-500 mt-1">
              Document saved and categorized successfully.
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={reset}
                className="flex-1 py-3 rounded-xl border-2 border-green-700 text-green-700 font-medium hover:bg-green-50"
              >
                Scan Another
              </button>
              {savedDocId && (
                <Link
                  href={`/documents/${savedDocId}`}
                  className="flex-1 py-3 rounded-xl bg-green-700 text-white font-medium hover:bg-green-800 text-center"
                >
                  View Document
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
