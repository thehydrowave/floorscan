"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageCircle, Send, X,
  Sparkles, Trash2, Settings2, Loader2, Bot, User,
} from "lucide-react";
import { AnalysisResult } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/* ── Types ──────────────────────────────────────────────────────────────── */

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ChatPanelProps {
  result: AnalysisResult;
  dpgf?: any;
  compliance?: any[];
}

/* ── Suggestions ────────────────────────────────────────────────────────── */

const SUGGESTIONS_FR = [
  "Quelle est la surface habitable totale ?",
  "Détaille-moi le coût du lot peinture",
  "Les pièces sont-elles conformes PMR ?",
  "Quelles optimisations pour réduire le budget ?",
];

const SUGGESTIONS_EN = [
  "What is the total living area?",
  "Break down the painting costs",
  "Are the rooms PMR compliant?",
  "What optimizations to reduce the budget?",
];

/* ── Component ──────────────────────────────────────────────────────────── */

export default function ChatPanel({ result, dpgf, compliance }: ChatPanelProps) {
  const { lang } = useLang();
  const d = (k: Parameters<typeof dt>[0]) => dt(k, lang);

  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Build context (no base64 images — just structured data)
  const buildCtx = useCallback(() => ({
    surfaces: result.surfaces,
    doors_count: result.doors_count,
    windows_count: result.windows_count,
    pixels_per_meter: result.pixels_per_meter,
    openings: result.openings?.map((o) => ({
      class: o.class, length_m: o.length_m, width_m: o.width_m, height_m: o.height_m,
    })),
    rooms: result.rooms?.map((r) => ({
      type: r.type, label_fr: r.label_fr, area_m2: r.area_m2, perimeter_m: r.perimeter_m,
    })),
    ...(dpgf ? { dpgf } : {}),
    ...(compliance ? { compliance } : {}),
  }), [result, dpgf, compliance]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Send message
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;
    setError(null);

    const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: "user", content: text.trim() };
    const assistantMsg: ChatMsg = { id: `a-${Date.now()}`, role: "assistant", content: "" };

    const allMsgs = [...messages, userMsg];
    setMessages([...allMsgs, assistantMsg]);
    setInput("");
    setStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: allMsgs.map((m) => ({ role: m.role, content: m.content })),
          analysisContext: buildCtx(),
          apiKey: apiKey || undefined,
        }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      // Stream text chunks
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.role === "assistant") {
              updated[updated.length - 1] = { ...last, content: accumulated };
            }
            return updated;
          });
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setError(err.message);
      // Remove empty assistant message on error
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && !last.content) return prev.slice(0, -1);
        return prev;
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [messages, streaming, buildCtx, apiKey]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const suggestions = lang === "fr" ? SUGGESTIONS_FR : SUGGESTIONS_EN;

  /* ── Floating button ──────────────────────────────────────────────────── */

  if (!open) {
    return (
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 1, type: "spring", stiffness: 200 }}
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-6 right-6 z-50",
          "w-14 h-14 rounded-full",
          "bg-gradient-to-br from-violet-600 to-indigo-700",
          "shadow-lg shadow-violet-500/30",
          "flex items-center justify-center",
          "hover:scale-110 transition-transform",
          "ring-2 ring-violet-400/30 ring-offset-2 ring-offset-slate-950"
        )}
        title={d("chat_title")}
      >
        <MessageCircle className="w-6 h-6 text-white" />
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-slate-950 animate-pulse" />
      </motion.button>
    );
  }

  /* ── Chat window ──────────────────────────────────────────────────────── */

  return (
    <motion.div
      initial={{ opacity: 0, y: 40, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 40, scale: 0.9 }}
      className={cn(
        "fixed bottom-6 right-6 z-50",
        "w-[420px] max-w-[calc(100vw-2rem)]",
        "h-[600px] max-h-[calc(100vh-4rem)]",
        "flex flex-col",
        "bg-slate-900/95 backdrop-blur-xl",
        "border border-slate-700/50",
        "rounded-2xl shadow-2xl shadow-violet-500/10",
        "overflow-hidden"
      )}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-violet-600/20 to-indigo-600/20 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-600/30 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-violet-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">{d("chat_title")}</h3>
            <p className="text-[10px] text-slate-400">{d("chat_subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
            title="Settings"
          >
            <Settings2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setMessages([]); setError(null); }}
            className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
            title={d("chat_clear")}
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setOpen(false); abortRef.current?.abort(); }}
            className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Settings panel ── */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-slate-700/50"
          >
            <div className="px-4 py-3 bg-slate-800/50">
              <label className="text-xs text-slate-400 block mb-1">{d("chat_api_key")}</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full px-3 py-1.5 text-xs rounded-lg bg-slate-900/80 border border-slate-600/50 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">{d("chat_api_hint")}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Messages ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scroll-smooth">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-16 h-16 rounded-2xl bg-violet-600/10 flex items-center justify-center">
              <Bot className="w-8 h-8 text-violet-400" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-slate-200">{d("chat_welcome")}</p>
              <p className="text-xs text-slate-500 mt-1">{d("chat_welcome_sub")}</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-[340px]">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(s)}
                  className="text-[11px] px-3 py-1.5 rounded-full bg-violet-600/10 text-violet-300 hover:bg-violet-600/20 border border-violet-500/20 transition-colors text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn("flex gap-2", msg.role === "user" ? "justify-end" : "justify-start")}
          >
            {msg.role === "assistant" && (
              <div className="w-6 h-6 rounded-md bg-violet-600/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-violet-400" />
              </div>
            )}
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                msg.role === "user"
                  ? "bg-violet-600 text-white rounded-br-md"
                  : "bg-slate-800/80 text-slate-200 rounded-bl-md border border-slate-700/40"
              )}
            >
              {msg.role === "assistant" ? (
                msg.content ? (
                  <div
                    className="prose prose-sm prose-invert max-w-none [&>p]:mb-2 [&>ul]:mb-2 [&>ol]:mb-2 [&_li]:text-slate-300 [&_strong]:text-violet-300"
                    dangerouslySetInnerHTML={{ __html: fmtMd(msg.content) }}
                  />
                ) : (
                  <div className="flex gap-1.5 py-1">
                    <span className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                )
              ) : (
                <span>{msg.content}</span>
              )}
            </div>
            {msg.role === "user" && (
              <div className="w-6 h-6 rounded-md bg-slate-600/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <User className="w-3.5 h-3.5 text-slate-400" />
              </div>
            )}
          </div>
        ))}

        {error && (
          <div className="mx-auto px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300 max-w-[90%]">
            {error.includes("API key") || error.includes("401")
              ? d("chat_no_key")
              : `Erreur : ${error}`}
          </div>
        )}
      </div>

      {/* ── Input ── */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-3 py-3 border-t border-slate-700/50 bg-slate-900/80"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={d("chat_placeholder")}
          disabled={streaming}
          className={cn(
            "flex-1 px-4 py-2.5 text-sm rounded-xl",
            "bg-slate-800/80 border border-slate-600/40",
            "text-white placeholder:text-slate-500",
            "focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50",
            "disabled:opacity-50"
          )}
          autoFocus
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className={cn(
            "p-2.5 rounded-xl transition-all",
            input.trim() && !streaming
              ? "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/20"
              : "bg-slate-700/50 text-slate-500 cursor-not-allowed"
          )}
        >
          {streaming ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </form>
    </motion.div>
  );
}

/* ── Minimal markdown → HTML ────────────────────────────────────────────── */

function fmtMd(md: string): string {
  return md
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-slate-700/60 text-violet-300 text-xs">$1</code>')
    .replace(/^### (.+)$/gm, '<h4 class="font-semibold text-violet-300 mt-2 mb-1">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="font-semibold text-violet-200 mt-2 mb-1">$1</h3>')
    .replace(/^- (.+)$/gm, '<li class="ml-3">$1</li>')
    .replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul class="list-disc pl-2 mb-2">$1</ul>')
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br/>")
    .replace(/^(.+)/, "<p>$1</p>");
}
