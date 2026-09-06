"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Send, Loader2, Mountain, User, Trash2, Paperclip, FileText, X, Mic, Square, MessageCircle, CircleHelp, History, ArrowUpRight, CalendarDays, Clock3 } from "lucide-react";
import { BuckyLedgerPanel, BuckyQuestionsPanel } from "@/components/bucky/oversight-panel";
import {
  formatRecordingClock,
  RECORDING_WARN_SECONDS,
  useVoiceRecorder,
} from "@/components/voice/use-voice-recorder";
import { consumeVoiceHandoff } from "@/lib/voice-handoff";
import "../fieldguide-bucky.css";

interface Message {
  role: "user" | "model";
  content: string;
}

const ACCEPTED_FILES =
  "image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,audio/*,video/*";

// The shared recorder keeps Safari's AAC preference aligned across every entry point.

// Transcription reads files up to ~15MB (~30 min of AAC) — nudge people to
// wrap up before a memo silently exceeds what Bucky can listen to.
function voiceMemoName(extension: string): string {
  const stamp = new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Voice memo ${stamp}.${extension}`.replace(/[,:]/g, "");
}

export default function AssistantPage() {
  const [activeTab, setActiveTab] = useState<"chat" | "questions" | "ledger">("chat");
  const [questionCount, setQuestionCount] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const entryHandledRef = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: messages.length ? scrollRef.current.scrollHeight : 0,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    if (requestedTab === "questions" || requestedTab === "ledger" || requestedTab === "chat") {
      setActiveTab(requestedTab);
    }
  }, []);

  useEffect(() => {
    fetch("/api/bucky/questions?status=open")
      .then((response) => response.ok ? response.json() : [])
      .then((questions: unknown[]) => setQuestionCount(questions.length))
      .catch(() => {});
  }, []);

  const sendMessage = async (options?: { files?: File[]; text?: string }) => {
    const files = options?.files ?? attachments;
    const typedText = options?.text ?? input;
    if ((!typedText.trim() && files.length === 0) || loading) return;
    // Attachment names go into the visible message (and the transcript the
    // model sees) so the conversation reads naturally later
    const attachmentLines = files.map((f) => `📎 ${f.name}`).join("\n");
    const content =
      [typedText.trim(), attachmentLines].filter(Boolean).join("\n") || "📎";

    const userMessage: Message = { role: "user", content };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setAttachments([]);
    setLoading(true);

    // Until the server accepts the turn, nothing has been processed server-side,
    // so a failure is safe to recover from by restoring the composer for a
    // one-tap retry (crucial for a voice memo that can't be re-typed).
    let responseStarted = false;
    try {
      let res: Response;
      if (files.length > 0) {
        // The server triages recordings before deciding whether they are
        // quick memories or permanent archive documents.
        const formData = new FormData();
        formData.append("messages", JSON.stringify(newMessages));
        for (const f of files) formData.append("files", f);
        res = await fetch("/api/assistant", { method: "POST", body: formData });
      } else {
        res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: newMessages }),
        });
      }

      if (!res.ok) {
        // The server sends a human-readable reason (e.g. Gemini overloaded)
        const serverMessage = await res.text().catch(() => "");
        throw new Error(serverMessage || "Failed to get response");
      }

      // Server accepted the turn — for attachments it has ALREADY filed them,
      // so from here a later error must not restore the composer (that would
      // risk re-sending and duplicating).
      responseStarted = true;

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
      if (!responseStarted) {
        // Nothing was processed server-side. Drop the optimistic user bubble
        // and put the text + attachments back in the composer so a voice memo
        // isn't lost — one tap of Send retries the whole message.
        setMessages([...messages, { role: "model", content: serverMessage }]);
        setInput(typedText);
        setAttachments(files);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "model", content: serverMessage },
        ]);
      }
    } finally {
      setLoading(false);
    }
  };

  // Submit immediately when recording stops. This matches the homepage mic and
  // avoids leaving an irreplaceable recording in an unsent attachment chip.
  const recorder = useVoiceRecorder({
    fileName: voiceMemoName,
    onComplete: (file) => void sendMessage({ files: [file], text: input }),
  });

  useEffect(() => {
    if (entryHandledRef.current) return;
    entryHandledRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const voiceToken = params.get("voice");
    const shouldRecord = params.get("record") === "1";

    if (voiceToken) {
      const file = consumeVoiceHandoff(voiceToken);
      if (file) void sendMessage({ files: [file], text: "" });
      else setEntryError("That recording is no longer available. Tap the microphone to record it again.");
    } else if (shouldRecord) {
      void recorder.startRecording();
    }

    if (voiceToken || shouldRecord) {
      params.delete("voice");
      params.delete("record");
      const query = params.toString();
      window.history.replaceState({}, "", `/assistant${query ? `?${query}` : ""}`);
    }
    // This is an arrival action. Running again would resend or restart audio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearChat = () => {
    setMessages([]);
  };

  return (
    <div className="fg-bucky-page">
      <Header
        title="Bucky Dragon"
        subtitle="Your family property assistant"
      />

      <div className="fg-bucky-topline">
        <Link href="/bucky/jobs"><Clock3 size={16} aria-hidden="true" /> Bucky’s tasks <ArrowUpRight size={15} aria-hidden="true" /></Link>
      </div>
      <div className="fg-bucky-workspace">
      <section className="fg-bucky-panel" aria-label="Bucky assistant">
      <div className="fg-bucky-tabs">
        <div className="fg-bucky-tab-list" role="tablist" aria-label="Bucky views">
          {([
            { id: "chat", label: "Chat", icon: MessageCircle },
            { id: "questions", label: "Questions", icon: CircleHelp },
            { id: "ledger", label: "Ledger", icon: History },
          ] as const).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              type="button"
              role="tab"
              id={`bucky-tab-${id}`}
              aria-controls={`bucky-panel-${id}`}
              aria-selected={activeTab === id}
              tabIndex={activeTab === id ? 0 : -1}
              onKeyDown={(event) => {
                const tabs = ["chat", "questions", "ledger"] as const;
                const index = tabs.indexOf(id);
                const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
                  : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
                  : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
                if (next === null) return;
                event.preventDefault();
                setActiveTab(tabs[next]);
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
              }}
              className={`fg-bucky-tab ${activeTab === id ? "is-active" : ""}`}
            >
              <Icon size={14} />
              <span>{label}</span>
              {id === "questions" && questionCount > 0 && (
                <span className="fg-bucky-question-count">{questionCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "chat" ? (
        <div className="fg-bucky-chat" id="bucky-panel-chat" role="tabpanel" aria-labelledby="bucky-tab-chat">

      {/* Chat Messages */}
      <div
        ref={scrollRef}
        className="fg-bucky-messages chat-scroll"
        role="log"
        aria-label="Conversation with Bucky"
        aria-live="polite"
        aria-busy={loading}
      >
        {messages.length === 0 && (
          <div className="fg-bucky-welcome">
            <div className="fg-bucky-welcome-heading">
            <div className="fg-bucky-welcome-mark"><Mountain size={32} aria-hidden="true" /></div>
            <div>
            <p className="fg-bucky-eyebrow">The family notebook</p>
            <h2>What’s on your mind?</h2>
            </div>
            </div>
            <p className="fg-bucky-intro">
              Ask about the house, attach a document, or leave a voice memo for
              the family notebook.
            </p>
            <div className="fg-bucky-suggestions">
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
                  className="fg-bucky-suggestion"
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
            className={`fg-bucky-message ${msg.role === "user" ? "is-user" : "is-bucky"}`}
          >
            {msg.role === "model" && (
              <div className="fg-bucky-avatar">
                <Mountain size={16} aria-hidden="true" />
              </div>
            )}
            <div
              className="fg-bucky-bubble"
            >
              <span className="fg-bucky-speaker">{msg.role === "user" ? "You" : "Bucky"}</span>
              <p>{msg.content}</p>
            </div>
            {msg.role === "user" && (
              <div className="fg-bucky-avatar">
                <User size={16} aria-hidden="true" />
              </div>
            )}
          </div>
        ))}

        {loading && messages[messages.length - 1]?.role === "user" && (
          <div className="fg-bucky-message is-bucky" role="status">
            <div className="fg-bucky-avatar">
              <Mountain size={16} aria-hidden="true" />
            </div>
            <div className="fg-bucky-thinking">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              <span className="sr-only">Bucky is thinking</span>
              {messages[messages.length - 1]?.content.includes("📎") && (
                <span>
                  Processing your attachment...
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Input Bar — in normal flow at the bottom of the chat column, so it
          can never float over messages; the messages area scrolls above it */}
      <div className="fg-bucky-composer">
        <div className="space-y-2">
          {(entryError || recorder.error) && (
            <div role="alert" className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <span className="flex-1">{entryError || recorder.error}</span>
              <button onClick={() => { setEntryError(null); recorder.clearError(); }} aria-label="Dismiss">
                <X size={12} />
              </button>
            </div>
          )}
          {recorder.recording && (
            <div className="fg-bucky-recording flex flex-wrap items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
              <span className="text-sm font-medium text-red-700 tabular-nums">
                Recording {formatRecordingClock(recorder.seconds)}
              </span>
              {recorder.seconds >= RECORDING_WARN_SECONDS && (
                <span className="text-xs text-amber-700">
                  Getting long — wrap up so Bucky can listen to all of it
                </span>
              )}
              <span className="flex-1" />
              <button
                onClick={() => recorder.stopRecording(true)}
                className="px-2 py-1 rounded-lg text-xs text-stone-500 hover:bg-stone-100"
              >
                Cancel
              </button>
              <button
                onClick={() => recorder.stopRecording(false)}
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
          <div className="fg-bucky-composer-controls">
            <input
              ref={inputRef}
              type="text"
              aria-label="Message Bucky"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder={
                attachments.length > 0
                  ? "Add a note about these files (optional)..."
                  : "Ask, or attach a document to file..."
              }
              className="fg-bucky-input"
            />
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
              disabled={loading || recorder.recording || recorder.starting}
              className="fg-bucky-composer-button fg-bucky-attach"
              aria-label="Attach a document"
            >
              <Paperclip size={20} />
            </button>
            <button
              onClick={() => (recorder.recording ? recorder.stopRecording(false) : void recorder.startRecording())}
              disabled={loading || recorder.starting}
              className={`fg-bucky-composer-button fg-bucky-record ${
                recorder.recording
                  ? "text-red-600 bg-red-50"
                  : "text-stone-400 hover:text-green-700 hover:bg-green-50"
              }`}
              aria-label={recorder.recording ? "Stop recording" : "Record a voice memo"}
            >
              <Mic size={20} />
            </button>
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="fg-bucky-composer-button fg-bucky-clear"
                aria-label="Clear chat"
              >
                <Trash2 size={20} />
              </button>
            )}
            <button
              onClick={() => void sendMessage()}
              disabled={(!input.trim() && attachments.length === 0) || loading || recorder.recording}
              className="fg-bucky-composer-button fg-bucky-send"
              aria-label="Send message to Bucky"
            >
              <Send size={20} />
            </button>
          </div>
        </div>
      </div>
        </div>
      ) : activeTab === "questions" ? (
        <div className="fg-bucky-oversight" id="bucky-panel-questions" role="tabpanel" aria-labelledby="bucky-tab-questions"><BuckyQuestionsPanel onCountChange={setQuestionCount} /></div>
      ) : (
        <div className="fg-bucky-oversight" id="bucky-panel-ledger" role="tabpanel" aria-labelledby="bucky-tab-ledger"><BuckyLedgerPanel /></div>
      )}
      </section>
      <aside className="fg-bucky-sidebar" aria-label="Bucky shortcuts">
        <p className="fg-bucky-eyebrow">Take a shortcut</p>
        <h2>A few things<br /><em>I can help with.</em></h2>
        <div className="fg-bucky-shortcuts">
          <Link href="/calendar"><CalendarDays size={18} aria-hidden="true" /><span>Plan your next visit</span><ArrowUpRight size={16} aria-hidden="true" /></Link>
          <Link href="/upload"><FileText size={18} aria-hidden="true" /><span>Add to Archive</span><ArrowUpRight size={16} aria-hidden="true" /></Link>
          <Link href="/bucky/jobs"><Clock3 size={18} aria-hidden="true" /><span>Bucky’s tasks</span><ArrowUpRight size={16} aria-hidden="true" /></Link>
        </div>
        <div className="fg-bucky-sidebar-note">
          <p className="fg-bucky-eyebrow">The family notebook</p>
          <p>Questions keeps track of things Bucky needs your help with. The Ledger records changes and lets you undo supported actions.</p>
        </div>
      </aside>
      </div>
    </div>
  );
}
