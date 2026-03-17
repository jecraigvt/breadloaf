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
} from "lucide-react";
import Link from "next/link";

type UploadStep = "select" | "preview" | "uploading" | "categorizing" | "review" | "done";

interface CategorizationResult {
  suggestedCategory: string;
  title: string;
  summary: string;
  tags: string[];
  confidence: number;
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
        }),
      });

      if (catRes.ok) {
        const catData = await catRes.json();
        setResult(catData);
        setEditTitle(catData.title);
      } else {
        // Categorization failed, continue with manual info
        setResult({
          suggestedCategory: "Other",
          title: file.name,
          summary: "",
          tags: [],
          confidence: 0,
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
          categorySlug: result.suggestedCategory,
          tags: result.tags,
          aiSummary: result.summary,
          aiExtractedText: "",
          uploadedBy,
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
    setStep("select");
  };

  return (
    <div>
      <Header
        title="Scan Document"
        subtitle="Capture or upload a document to the archive"
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
            <CameraCapture onCapture={handleFile} />
            <div className="relative flex items-center gap-4">
              <div className="flex-1 h-px bg-stone-200" />
              <span className="text-stone-400 text-sm">or</span>
              <div className="flex-1 h-px bg-stone-200" />
            </div>
            <FileDropzone onFile={handleFile} />
          </>
        )}

        {step === "preview" && file && (
          <div className="space-y-4">
            {preview && (
              <div className="rounded-xl overflow-hidden border border-stone-200">
                <img src={preview} alt="Preview" className="w-full" />
              </div>
            )}
            {!preview && (
              <div className="rounded-xl border border-stone-200 p-8 text-center">
                <FileText size={48} className="mx-auto text-stone-400 mb-2" />
                <p className="text-stone-600 font-medium">{file.name}</p>
                <p className="text-stone-400 text-sm">
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </p>
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

            <div className="flex items-center gap-2 text-sm">
              <FolderOpen size={16} className="text-stone-500" />
              <span className="text-stone-500">Category:</span>
              <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full font-medium">
                {result.suggestedCategory}
              </span>
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
