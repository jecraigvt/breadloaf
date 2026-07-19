"use client";

import { useState, useRef, useEffect } from "react";
import { Header } from "@/components/layout/header";
import { Send, Loader2, Mountain, User, Trash2, Paperclip, FileText, X, Mic, Square } from "lucide-react";

interface Message {
  role: "user" | "model";
  content: string;
}

const ACCEPTED_FILES =
  "image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,audio/*,video/*";

// Preferred recording formats, best first. Safari records AAC (audio/mp4 —
// verified through the transcription pipeline); Chrome/Android record WebM.
const RECORDING_MIME_TYPES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];

// Transcription reads files up to ~15MB (~30 min of AAC) — nudge people to
// wrap up before a memo silently exceeds what Bucky can listen to.
const RECORDING_WARN_SECONDS = 25 * 60;

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Voice recording state — the finished recording becomes a normal
  // attachment, so everything downstream (multipart send, transcription,
  // filing, asset discovery) is the existing pipeline untouched.
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [recError, setRecError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discardRef = useRef(false);
  const startingRef = useRef(false); // true while the mic permission prompt is pending

  const releaseRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
    setRecSeconds(0);
  };

  const startRecording = async () => {
    // Guard double-taps and a still-pending permission prompt — a second
    // start while one is underway would let the first's failure handler
    // tear down the active recording
    if (recording || startingRef.current || recorderRef.current) return;
    startingRef.current = true;
    setRecError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = RECORDING_MIME_TYPES.find(
        (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)
      );
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      discardRef.current = false;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        if (!discardRef.current && chunksRef.current.length > 0) {
          const type = recorder.mimeType || "audio/webm";
          const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
          const stamp = new Date().toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          });
          const file = new File(
            [new Blob(chunksRef.current, { type })],
            `Voice memo ${stamp}.${ext}`.replace(/[,:]/g, ""),
            { type }
          );
          setAttachments((prev) => [...prev, file]);
        }
        releaseRecording();
      };

      recorder.start(1000); // collect chunks each second
      startingRef.current = false;
      setRecording(true);
      setRecSeconds(0);
      timerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    } catch {
      startingRef.current = false;
      releaseRecording();
      setRecError(
        "Couldn't access the microphone — check that mic permission is allowed for this site."
      );
    }
  };

  const stopRecording = (discard: boolean) => {
    discardRef.current = discard;
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop(); // onstop finishes up and releases the mic
    } else {
      releaseRecording();
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const sendMessage = async () => {
    if ((!input.trim() && attachments.length === 0) || loading) return;

    const files = attachments;
    // Attachment names go into the visible message (and the transcript the
    // model sees) so the conversation reads naturally later
    const attachmentLines = files.map((f) => `📎 ${f.name}`).join("\n");
    const content =
      [input.trim(), attachmentLines].filter(Boolean).join("\n") || "📎";

    const userMessage: Message = { role: "user", content };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setAttachments([]);
    setLoading(true);

    try {
      const storedName =
        typeof window !== "undefined"
          ? localStorage.getItem("breadloaf-username") || ""
          : "";
      let res: Response;
      if (files.length > 0) {
        // Multipart: server files the attachments into the archive, then chats
        const formData = new FormData();
        formData.append("messages", JSON.stringify(newMessages));
        formData.append("username", storedName);
        for (const f of files) formData.append("files", f);
        res = await fetch("/api/assistant", { method: "POST", body: formData });
      } else {
        res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: newMessages, username: storedName }),
        });
      }

      if (!res.ok) {
        // The server sends a human-readable reason (e.g. Gemini overloaded)
        const serverMessage = await res.text().catch(() => "");
        throw new Error(serverMessage || "Failed to get response");
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error("No reader available");

      // Add empty assistant message
      setMessages((prev) => [...prev, { role: "model", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === "model") {
            last.content += text;
          }
          return [...updated];
        });
      }
    } catch (err) {
      // Prefer the server's specific reason (Gemini overloaded, etc.) over a
      // generic — and misleading — connection message
      const serverMessage =
        err instanceof Error && err.message && err.message !== "Failed to get response"
          ? err.message
          : "Sorry, I had trouble answering that. Give it a moment and try again.";
      setMessages((prev) => [
        ...prev,
        { role: "model", content: serverMessage },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-screen">
      <Header
        title="Bucky Dragon"
        subtitle="Your family property assistant"
      />

      {/* Chat Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto chat-scroll px-4 py-4 space-y-4 pb-36"
      >
        {messages.length === 0 && (
          <div className="text-center py-12">
            <Mountain size={48} className="mx-auto text-green-200 mb-4" />
            <h2 className="text-lg font-semibold text-stone-700">
              Bucky Dragon
            </h2>
            <p className="text-stone-400 text-sm mt-2 max-w-xs mx-auto">
              Your family property hub — I know about visits, rooms, documents,
              expenses, supplies, and everything Breadloaf Hill. Ask me anything,
              attach a document (📎) to file it, or tap the mic and just talk —
              walkthroughs of the property become the family notebook.
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-6">
              {[
                "What can you help with?",
                "Add paper towels to the grocery list",
                "Who's coming to visit next?",
                "How much have we spent this year?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setInput(q);
                    inputRef.current?.focus();
                  }}
                  className="bg-white border border-stone-200 rounded-full px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50 hover:border-green-300 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "model" && (
              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <Mountain size={16} className="text-green-700" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                msg.role === "user"
                  ? "bg-green-700 text-white"
                  : "bg-white border border-stone-200 text-stone-700"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
            {msg.role === "user" && (
              <div className="w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center flex-shrink-0">
                <User size={16} className="text-stone-600" />
              </div>
            )}
          </div>
        ))}

        {loading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
              <Mountain size={16} className="text-green-700" />
            </div>
            <div className="bg-white border border-stone-200 rounded-2xl px-4 py-3 flex items-center gap-2">
              <Loader2 size={16} className="animate-spin text-green-700" />
              {messages[messages.length - 1]?.content.includes("📎") && (
                <span className="text-xs text-stone-400">
                  Reading &amp; filing your document...
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Input Bar */}
      <div className="fixed bottom-16 left-0 right-0 bg-white border-t border-stone-200 px-4 py-3">
        <div className="max-w-lg mx-auto space-y-2">
          {recError && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <span className="flex-1">{recError}</span>
              <button onClick={() => setRecError(null)} aria-label="Dismiss">
                <X size={12} />
              </button>
            </div>
          )}
          {recording && (
            <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
              <span className="text-sm font-medium text-red-700 tabular-nums">
                Recording {formatClock(recSeconds)}
              </span>
              {recSeconds >= RECORDING_WARN_SECONDS && (
                <span className="text-xs text-amber-700">
                  Getting long — wrap up so Bucky can listen to all of it
                </span>
              )}
              <span className="flex-1" />
              <button
                onClick={() => stopRecording(true)}
                className="px-2 py-1 rounded-lg text-xs text-stone-500 hover:bg-stone-100"
              >
                Cancel
              </button>
              <button
                onClick={() => stopRecording(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700"
              >
                <Square size={12} fill="currentColor" />
                Stop
              </button>
            </div>
          )}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-1.5 bg-green-50 border border-green-200 text-green-800 rounded-full pl-2.5 pr-1.5 py-1 text-xs font-medium"
                >
                  <FileText size={12} />
                  <span className="max-w-[140px] truncate">{f.name}</span>
                  <button
                    onClick={() =>
                      setAttachments((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    className="rounded-full p-0.5 hover:bg-green-100"
                    aria-label={`Remove ${f.name}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="p-3 rounded-xl text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                <Trash2 size={20} />
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_FILES}
              className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files || []);
                if (picked.length > 0) {
                  setAttachments((prev) => [...prev, ...picked]);
                }
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || recording}
              className="p-3 rounded-xl text-stone-400 hover:text-green-700 hover:bg-green-50 disabled:opacity-50 transition-colors"
              aria-label="Attach a document"
            >
              <Paperclip size={20} />
            </button>
            <button
              onClick={() => (recording ? stopRecording(false) : startRecording())}
              disabled={loading}
              className={`p-3 rounded-xl transition-colors disabled:opacity-50 ${
                recording
                  ? "text-red-600 bg-red-50"
                  : "text-stone-400 hover:text-green-700 hover:bg-green-50"
              }`}
              aria-label={recording ? "Stop recording" : "Record a voice memo"}
            >
              <Mic size={20} />
            </button>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder={
                attachments.length > 0
                  ? "Add a note about these files (optional)..."
                  : "Ask, or attach a document to file..."
              }
              className="flex-1 px-4 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
            <button
              onClick={sendMessage}
              disabled={(!input.trim() && attachments.length === 0) || loading || recording}
              className="p-3 rounded-xl bg-green-700 text-white hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
