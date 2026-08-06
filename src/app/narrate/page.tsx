"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Plus, RotateCcw, Square, Trash2 } from "lucide-react";
import type { EditableNarratedMemoryItem } from "@/lib/bulk-narration";

const RECORDING_MIME_TYPES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
const RECORDING_WARN_SECONDS = 25 * 60;

type Stage = "ready" | "recording" | "processing" | "review" | "saving" | "done";

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function freshCaptureId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function freshItemId(): string {
  return typeof crypto.randomUUID === "function"
    ? `manual-${crypto.randomUUID()}`
    : `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function NarratePage() {
  const [stage, setStage] = useState<Stage>("ready");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recordingFile, setRecordingFile] = useState<File | null>(null);
  const [captureId, setCaptureId] = useState("");
  const [transcript, setTranscript] = useState("");
  const [items, setItems] = useState<EditableNarratedMemoryItem[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discardRef = useRef(false);
  const startingRef = useRef(false);

  const releaseRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setSeconds(0);
  };

  const processRecording = async (file: File) => {
    setRecordingFile(file);
    setStage("processing");
    setError(null);
    try {
      const formData = new FormData();
      formData.append("recording", file);
      const response = await fetch("/api/narration", { method: "POST", body: formData });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        transcript?: string;
        items?: EditableNarratedMemoryItem[];
      };
      if (!response.ok) throw new Error(body.error || "Bucky could not process this recording.");
      if (!body.transcript || !body.items?.length) {
        throw new Error("No cataloguable items were found in that recording.");
      }
      setTranscript(body.transcript);
      setItems(body.items);
      setCaptureId(freshCaptureId());
      setStage("review");
    } catch (processingError) {
      setError(processingError instanceof Error ? processingError.message : "Bucky could not process this recording.");
      setStage("ready");
    }
  };

  const startRecording = async () => {
    if (startingRef.current || recorderRef.current) return;
    startingRef.current = true;
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("This browser does not support audio recording.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = RECORDING_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      discardRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const discarded = discardRef.current;
        const chunks = chunksRef.current;
        const type = recorder.mimeType || "audio/webm";
        releaseRecording();
        if (discarded || chunks.length === 0) {
          setStage("ready");
          return;
        }
        const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const file = new File(
          [new Blob(chunks, { type })],
          `Attic catalogue ${new Date().toISOString().slice(0, 10)}.${extension}`,
          { type }
        );
        void processRecording(file);
      };

      recorder.start(1000);
      startingRef.current = false;
      setStage("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch (recordingError) {
      startingRef.current = false;
      releaseRecording();
      setStage("ready");
      setError(recordingError instanceof Error
        ? recordingError.message
        : "Could not access the microphone. Check this site's microphone permission.");
    }
  };

  const stopRecording = (discard: boolean) => {
    discardRef.current = discard;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else {
      releaseRecording();
      setStage("ready");
    }
  };

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const updateItem = (index: number, changes: Partial<EditableNarratedMemoryItem>) => {
    setItems((current) => current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...changes } : item
    ));
  };

  const addItem = () => {
    setItems((current) => [...current, {
      clientId: freshItemId(),
      type: "semantic",
      topic: "",
      subject: null,
      location: null,
      scope: "property",
      content: "",
    }]);
  };

  const commitItems = async () => {
    if (!items.length || items.some((item) => !item.topic.trim() || !item.content.trim())) {
      setError("Every item needs a topic and description before it can be saved.");
      return;
    }
    setStage("saving");
    setError(null);
    try {
      const response = await fetch("/api/narration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captureId, items }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; savedCount?: number };
      if (!response.ok) throw new Error(body.error || "The memories could not be saved.");
      setSavedCount(body.savedCount || items.length);
      setStage("done");
    } catch (savingError) {
      setError(savingError instanceof Error ? savingError.message : "The memories could not be saved.");
      setStage("review");
    }
  };

  const reset = () => {
    setStage("ready");
    setError(null);
    setRecordingFile(null);
    setCaptureId("");
    setTranscript("");
    setItems([]);
    setSavedCount(0);
  };

  return (
    <div className="fade-in">
      <div className="chrome-top">
        <Link href="/more" className="ctr">&larr; Directory</Link>
        <span className="wordmark"><em>Breadloaf</em> Hill</span>
        <span className="ctr">Catalogue</span>
      </div>

      <div className="chapter-intro">
        <div className="number">One recording, item by item</div>
        <div className="lede">Tell the story of a shelf or box. <em>Check every item before it becomes family memory.</em></div>
      </div>

      {error && (
        <div className="mx-5 mb-4 border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      {(stage === "ready" || stage === "recording" || stage === "processing") && (
        <section className="px-5 pb-8">
          <div className="border border-stone-300 bg-white/50 p-5 text-center">
            {stage === "ready" && (
              <>
                <Mic size={34} className="mx-auto mb-4 text-green-800" />
                <h1 className="font-serif text-2xl text-stone-900">Record the whole catalogue</h1>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-stone-600">
                  Name each item, what it contains, and exactly where it lives. Pause between items. You will edit the list before anything is saved.
                </p>
                <button type="button" onClick={() => void startRecording()} className="btn-ember mt-5">
                  Start recording
                </button>
                {recordingFile && (
                  <button type="button" onClick={() => void processRecording(recordingFile)} className="btn-quiet">
                    Retry the last recording
                  </button>
                )}
              </>
            )}

            {stage === "recording" && (
              <>
                <span className="mx-auto mb-4 block h-3 w-3 animate-pulse rounded-full bg-red-600" />
                <div className="font-mono text-sm uppercase tracking-[0.18em] text-red-700">
                  Recording {formatClock(seconds)}
                </div>
                {seconds >= RECORDING_WARN_SECONDS && (
                  <p className="mt-3 text-sm text-amber-800">Wrap up soon so the recording stays within the transcription limit.</p>
                )}
                <div className="mt-6 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => stopRecording(true)} className="btn-quiet !mt-0">
                    Cancel
                  </button>
                  <button type="button" onClick={() => stopRecording(false)} className="btn-ember flex items-center justify-center gap-2">
                    <Square size={13} fill="currentColor" /> Stop &amp; transcribe
                  </button>
                </div>
              </>
            )}

            {stage === "processing" && (
              <div className="py-8">
                <Loader2 size={30} className="mx-auto animate-spin text-green-800" />
                <p className="mt-4 font-serif text-xl">Listening and separating the items&hellip;</p>
                <p className="mt-2 text-sm text-stone-500">Nothing is being saved yet.</p>
              </div>
            )}
          </div>
        </section>
      )}

      {(stage === "review" || stage === "saving") && (
        <section className="pb-8">
          <div className="section-head">
            <div className="lt">Review <em>{items.length} item{items.length === 1 ? "" : "s"}</em></div>
            <div className="rt">Edit before saving</div>
          </div>

          <div className="space-y-4 px-5">
            {items.map((item, index) => (
              <article key={item.clientId} className="border border-stone-300 bg-white/55 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">Item {index + 1}</span>
                  <button
                    type="button"
                    onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    className="p-1 text-stone-400 hover:text-red-700"
                    aria-label={`Remove item ${index + 1}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <label className="block text-xs font-medium text-stone-700">
                  Topic
                  <input
                    value={item.topic}
                    onChange={(event) => updateItem(index, { topic: event.target.value })}
                    className="mt-1 w-full border border-stone-300 bg-white px-3 py-2 text-sm"
                    maxLength={120}
                  />
                </label>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="block text-xs font-medium text-stone-700">
                    Memory type
                    <select
                      value={item.type}
                      onChange={(event) => updateItem(index, { type: event.target.value as EditableNarratedMemoryItem["type"] })}
                      className="mt-1 w-full border border-stone-300 bg-white px-2 py-2 text-sm"
                    >
                      <option value="semantic">Fact</option>
                      <option value="episodic">Event</option>
                      <option value="procedural">Instructions</option>
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-stone-700">
                    Scope
                    <select
                      value={item.scope}
                      onChange={(event) => updateItem(index, { scope: event.target.value as EditableNarratedMemoryItem["scope"] })}
                      className="mt-1 w-full border border-stone-300 bg-white px-2 py-2 text-sm"
                    >
                      <option value="property">Property</option>
                      <option value="family">Family</option>
                      <option value="entity">Organization</option>
                    </select>
                  </label>
                </div>

                <label className="mt-3 block text-xs font-medium text-stone-700">
                  Subject <span className="font-normal text-stone-400">(optional)</span>
                  <input
                    value={item.subject || ""}
                    onChange={(event) => updateItem(index, { subject: event.target.value || null })}
                    className="mt-1 w-full border border-stone-300 bg-white px-3 py-2 text-sm"
                    maxLength={160}
                  />
                </label>

                <label className="mt-3 block text-xs font-medium text-stone-700">
                  Physical location <span className="font-normal text-stone-400">(optional)</span>
                  <input
                    value={item.location || ""}
                    onChange={(event) => updateItem(index, { location: event.target.value || null })}
                    placeholder="Attic, north wall, shelf 3"
                    className="mt-1 w-full border border-stone-300 bg-white px-3 py-2 text-sm"
                    maxLength={240}
                  />
                </label>

                <label className="mt-3 block text-xs font-medium text-stone-700">
                  Description
                  <textarea
                    value={item.content}
                    onChange={(event) => updateItem(index, { content: event.target.value })}
                    className="mt-1 min-h-28 w-full border border-stone-300 bg-white px-3 py-2 text-sm leading-5"
                    maxLength={8000}
                  />
                </label>
              </article>
            ))}

            <button type="button" onClick={addItem} className="btn-quiet flex items-center justify-center gap-2">
              <Plus size={14} /> Add a missed item
            </button>

            <details className="border-t border-stone-300 pt-3 text-sm text-stone-600">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.18em]">Original transcript</summary>
              <p className="mt-3 whitespace-pre-wrap leading-6">{transcript}</p>
            </details>

            <button
              type="button"
              onClick={() => void commitItems()}
              disabled={stage === "saving" || items.length === 0}
              className="btn-ember flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {stage === "saving" && <Loader2 size={14} className="animate-spin" />}
              Save &amp; index {items.length} item{items.length === 1 ? "" : "s"}
            </button>
            <button type="button" onClick={reset} disabled={stage === "saving"} className="btn-quiet">
              Discard this catalogue
            </button>
          </div>
        </section>
      )}

      {stage === "done" && (
        <section className="px-5 pb-10 text-center">
          <div className="border border-green-300 bg-green-50/70 p-6">
            <div className="font-serif text-3xl text-green-900">{savedCount} memories catalogued</div>
            <p className="mt-3 text-sm leading-6 text-stone-600">Each item has its own searchable memory, including its physical location when provided.</p>
            <button type="button" onClick={reset} className="btn-ember mt-5 flex items-center justify-center gap-2">
              <RotateCcw size={14} /> Record another catalogue
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
