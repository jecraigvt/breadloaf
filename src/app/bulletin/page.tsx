"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import {
  Pin,
  Send,
  Trash2,
  User,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { formatDate } from "@/lib/utils";

interface BulletinMessage {
  id: string;
  author: string;
  content: string;
  pinned: boolean;
  createdAt: string;
}

export default function BulletinPage() {
  const [messages, setMessages] = useState<BulletinMessage[]>([]);
  const [author, setAuthor] = useState(
    typeof window !== "undefined"
      ? localStorage.getItem("breadloaf-username") || ""
      : ""
  );
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    fetchMessages();
  }, []);

  const fetchMessages = async () => {
    const res = await fetch("/api/bulletin");
    if (res.ok) {
      setMessages(await res.json());
    }
    setLoading(false);
  };

  const postMessage = async () => {
    if (!content.trim() || !author.trim()) return;
    setPosting(true);

    localStorage.setItem("breadloaf-username", author);

    const res = await fetch("/api/bulletin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: author.trim(), content: content.trim() }),
    });

    if (res.ok) {
      setContent("");
      fetchMessages();
    }
    setPosting(false);
  };

  const deleteMessage = async (id: string) => {
    if (!confirm("Delete this message?")) return;
    await fetch(`/api/bulletin/${id}`, { method: "DELETE" });
    fetchMessages();
  };

  const togglePin = async (id: string, pinned: boolean) => {
    await fetch(`/api/bulletin/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !pinned }),
    });
    fetchMessages();
  };

  const pinnedMessages = messages.filter((m) => m.pinned);
  const regularMessages = messages.filter((m) => !m.pinned);

  return (
    <div>
      <Header
        title="Family Board"
        subtitle="Notes, announcements, and to-dos"
      />

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* New Message Form */}
        <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
          <div className="flex gap-3">
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Your name"
              className="w-32 px-3 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && postMessage()}
              placeholder="Share a note with the family..."
              className="flex-1 px-4 py-2.5 rounded-lg border border-stone-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
            <button
              onClick={postMessage}
              disabled={!content.trim() || !author.trim() || posting}
              className="px-4 py-2.5 rounded-lg bg-green-700 text-white hover:bg-green-800 disabled:opacity-50 transition-colors"
            >
              {posting ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Send size={18} />
              )}
            </button>
          </div>
        </div>

        {/* Pinned Messages */}
        {pinnedMessages.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider flex items-center gap-1">
              <Pin size={12} /> Pinned
            </h3>
            {pinnedMessages.map((msg) => (
              <MessageCard
                key={msg.id}
                message={msg}
                onDelete={deleteMessage}
                onTogglePin={togglePin}
              />
            ))}
          </div>
        )}

        {/* Messages */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-stone-100 rounded-xl h-24 animate-pulse" />
            ))}
          </div>
        ) : regularMessages.length === 0 && pinnedMessages.length === 0 ? (
          <div className="text-center py-12">
            <MessageSquare size={48} className="mx-auto text-stone-300 mb-3" />
            <p className="text-stone-500 font-medium">No messages yet</p>
            <p className="text-stone-400 text-sm mt-1">
              Post the first family update!
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {regularMessages.map((msg) => (
              <MessageCard
                key={msg.id}
                message={msg}
                onDelete={deleteMessage}
                onTogglePin={togglePin}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageCard({
  message,
  onDelete,
  onTogglePin,
}: {
  message: BulletinMessage;
  onDelete: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
}) {
  return (
    <div
      className={`bg-white rounded-xl border p-4 ${
        message.pinned ? "border-amber-200 bg-amber-50" : "border-stone-200"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <User size={14} className="text-stone-400" />
            <span className="text-sm font-medium text-stone-700">
              {message.author}
            </span>
            <span className="text-xs text-stone-400">
              {formatDate(message.createdAt)}
            </span>
          </div>
          <p className="text-stone-600">{message.content}</p>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={() => onTogglePin(message.id, message.pinned)}
            className={`p-1.5 rounded-lg transition-colors ${
              message.pinned
                ? "text-amber-600 hover:bg-amber-100"
                : "text-stone-300 hover:text-stone-500 hover:bg-stone-100"
            }`}
          >
            <Pin size={14} />
          </button>
          <button
            onClick={() => onDelete(message.id)}
            className="p-1.5 rounded-lg text-stone-300 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
