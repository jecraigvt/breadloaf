"use client";

import { useState, useRef, useEffect } from "react";
import { Header } from "@/components/layout/header";
import { Send, Loader2, Mountain, User, Trash2 } from "lucide-react";

interface Message {
  role: "user" | "model";
  content: string;
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const storedName =
        typeof window !== "undefined"
          ? localStorage.getItem("breadloaf-username") || ""
          : "";
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, username: storedName }),
      });

      if (!res.ok) throw new Error("Failed to get response");

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
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "model",
          content:
            "Sorry, I had trouble connecting. Please check that the Google AI API key is configured and try again.",
        },
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
              expenses, supplies, and everything Breadloaf Hill. Ask me anything
              or tell me to do something.
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
            <div className="bg-white border border-stone-200 rounded-2xl px-4 py-3">
              <Loader2 size={16} className="animate-spin text-green-700" />
            </div>
          </div>
        )}
      </div>

      {/* Input Bar */}
      <div className="fixed bottom-16 left-0 right-0 bg-white border-t border-stone-200 px-4 py-3">
        <div className="max-w-lg mx-auto flex gap-2">
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="p-3 rounded-xl text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <Trash2 size={20} />
            </button>
          )}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Ask about your property..."
            className="flex-1 px-4 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="p-3 rounded-xl bg-green-700 text-white hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
