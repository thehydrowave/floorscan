"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, X, Minus, ChevronUp,
  Sparkles, Trash2, Settings2, Loader2, Bot, User,
  HelpCircle, ScanLine,
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
  result?: AnalysisResult | null;
  currentStep?: number;
  autoOpen?: boolean;
  dpgf?: any;
  compliance?: any[];
}

/* ── Suggestions per context ──────────────────────────────────────────── */

const ANALYSIS_SUGGESTIONS_FR = [
  "Quelle est la surface habitable totale ?",
  "Détaille-moi le coût du lot peinture",
  "Les pièces sont-elles conformes PMR ?",
  "Quelles optimisations pour réduire le budget ?",
];

const ANALYSIS_SUGGESTIONS_EN = [
  "What is the total living area?",
  "Break down the painting costs",
  "Are the rooms PMR compliant?",
  "What optimizations to reduce the budget?",
];

const HELP_SUGGESTIONS_FR = [
  "Comment utiliser FloorScan ?",
  "Comment importer un plan PDF ?",
  "Comment calibrer l'échelle ?",
  "Quels formats de fichier sont supportés ?",
];

const HELP_SUGGESTIONS_EN = [
  "How do I use FloorScan?",
  "How do I import a PDF plan?",
  "How do I calibrate the scale?",
  "What file formats are supported?",
];

/* ── Avatar SVG ────────────────────────────────────────────────────────── */

function AvatarIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="url(#av_grad)" />
      <path d="M12 28c0-4.418 3.582-8 8-8s8 3.582 8 8" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" />
      <circle cx="20" cy="15" r="5" fill="white" opacity="0.9" />
      <path d="M14 13l2 2m10-2l-2 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <path d="M8 20h2m20 0h2M20 8v2" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
      <defs>
        <linearGradient id="av_grad" x1="0" y1="0" x2="40" y2="40">
          <stop stopColor="#7c3aed" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ── Component ──────────────────────────────────────────────────────────── */

export default function ChatPanel({ result, currentStep, autoOpen, dpgf, compliance }: ChatPanelProps) {
  const { lang } = useLang();
  const d = (k: Parameters<typeof dt>[0]) => dt(k, lang);

  const hasAnalysis = !!result;

  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [serverHasKey, setServerHasKey] = useState<boolean | null>(null);
  const autoOpenedRef = useRef(false);
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Check on mount whether the server has an API key configured
  useEffect(() => {
    fetch("/api/chat")
      .then((r) => r.json())
      .then((data) => setServerHasKey(!!data.configured))
      .catch(() => setServerHasKey(false));
  }, []);

  // Build context (no base64 images — just structured data)
  const buildCtx = useCallback(() => {
    if (!result) return null;
    return {
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
    };
  }, [result, dpgf, compliance]);

  // Auto-open once when autoOpen becomes true
  useEffect(() => {
    if (autoOpen && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      // Small delay so the page renders first
      const t = setTimeout(() => { setOpen(true); setMinimized(false); }, 1200);
      return () => clearTimeout(t);
    }
  }, [autoOpen]);

  // Auto-show settings when chat opens and no key is available anywhere
  const needsKey = serverHasKey === false && !apiKey;
  useEffect(() => {
    if (open && needsKey) {
      setShowSettings(true);
    }
  }, [open, needsKey]);

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
          mode: hasAnalysis ? "analysis" : "help",
          currentStep: currentStep ?? null,
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
  }, [messages, streaming, buildCtx, apiKey, hasAnalysis, currentStep]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  // Contextual suggestions
  const suggestions = hasAnalysis
    ? (lang === "fr" ? ANALYSIS_SUGGESTIONS_FR : ANALYSIS_SUGGESTIONS_EN)
    : (lang === "fr" ? HELP_SUGGESTIONS_FR : HELP_SUGGESTIONS_EN);

  const welcomeMsg = hasAnalysis ? d("chat_welcome") : d("chat_welcome_help");
  const welcomeSub = hasAnalysis ? d("chat_welcome_sub") : d("chat_welcome_help_sub");

  /* ── Closed: floating button with avatar ─────────────────────────── */

  if (!open) {
    return (
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.8, type: "spring", stiffness: 200 }}
        onClick={() => { setOpen(true); setMinimized(false); }}
        className={cn(
          "fixed bottom-6 right-6 z-50",
          "w-14 h-14 rounded-full",
          "bg-gradient-to-br from-violet-600 to-indigo-700",
          "shadow-lg shadow-violet-500/30",
          "flex items-center justify-center",
          "hover:scale-110 transition-transform",
          "ring-2 ring-violet-400/30 ring-offset-2 ring-offset-slate-950",
          "group"
        )}
        title={d("chat_title")}
        aria-label={d("chat_title")}
      >
        <AvatarIcon size={30} />
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-slate-950 animate-pulse" />
        {/* Tooltip label */}
        <span className="absolute right-16 bg-slate-800/95 text-white text-xs px-3 py-1.5 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none border border-slate-700/50 shadow-lg">
          {hasAnalysis ? d("chat_tooltip_analyze") : d("chat_tooltip_help")}
        </span>
      </motion.button>
    );
  }

  /* ── Minimized: slim bar with avatar ────────────────────────────────── */

  if (minimized) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className={cn(
          "fixed bottom-6 right-6 z-50",
          "flex items-center gap-2.5",
          "px-4 py-2.5 rounded-2xl",
          "bg-slate-900/95 backdrop-blur-xl",
          "border border-slate-700/50",
          "shadow-lg shadow-violet-500/10",
          "cursor-pointer hover:border-violet-500/30 transition-colors"
        )}
        onClick={() => setMinimized(false)}
      >
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600/40 to-indigo-600/40 flex items-center justify-center border border-violet-500/20 flex-shrink-0">
          <AvatarIcon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white truncate">{d("chat_title")}</p>
          <p className="text-[10px] text-slate-400 truncate">
            {messages.length > 0
              ? `${messages.length} ${d("chat_msg_count")}`
              : d("chat_click_open")}
          </p>
        </div>
        <ChevronUp className="w-4 h-4 text-slate-400" />
        {streaming && <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />}
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(false); setMinimized(false); }}
          className="p-1 rounded-md hover:bg-slate-700/50 text-slate-500 hover:text-slate-300 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </motion.div>
    );
  }

  /* ── Expanded: full chat window ─────────────────────────────────────── */

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
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600/40 to-indigo-600/40 flex items-center justify-center border border-violet-500/20">
            <AvatarIcon size={24} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
              {d("chat_title")}
              {hasAnalysis && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-medium">
                  {d("chat_data_badge")}
                </span>
              )}
            </h3>
            <p className="text-[10px] text-slate-400">
              {hasAnalysis ? d("chat_subtitle") : d("chat_subtitle_help")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
            title={d("chat_settings")}
            aria-label={d("chat_settings")}
          >
            <Settings2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setMessages([]); setError(null); }}
            className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
            title={d("chat_clear")}
            aria-label={d("chat_clear")}
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setMinimized(true)}
            className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
            title={d("chat_minimize")}
            aria-label={d("chat_minimize")}
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setOpen(false); setMinimized(false); abortRef.current?.abort(); }}
            className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
            title={d("chat_close")}
            aria-label={d("chat_close")}
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
            <div className="px-4 py-3 bg-slate-800/50 space-y-2">
              {needsKey && (
                <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <span className="text-amber-400 text-sm mt-0.5">⚠</span>
                  <p className="text-[11px] text-amber-300 leading-relaxed">
                    {d("chat_no_key_hint")}
                  </p>
                </div>
              )}
              <label className="text-xs text-slate-400 block">{d("chat_api_key")}</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setError(null); }}
                placeholder="sk-proj-..."
                autoFocus={needsKey}
                className="w-full px-3 py-1.5 text-xs rounded-lg bg-slate-900/80 border border-slate-600/50 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
              <p className="text-[10px] text-slate-500">{d("chat_api_hint")}</p>
              {apiKey && (
                <button
                  onClick={() => setShowSettings(false)}
                  className="w-full py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 text-xs font-medium transition-colors border border-violet-500/20"
                >
                  ✓ {d("chat_key_saved")}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Messages ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scroll-smooth">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-16 h-16 rounded-2xl bg-violet-600/10 flex items-center justify-center border border-violet-500/10">
              {hasAnalysis ? (
                <ScanLine className="w-8 h-8 text-violet-400" />
              ) : (
                <AvatarIcon size={36} />
              )}
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-slate-200">{welcomeMsg}</p>
              <p className="text-xs text-slate-500 mt-1">{welcomeSub}</p>
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
                <AvatarIcon size={18} />
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
              : `${d("chat_error_prefix")} : ${error}`}
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
          placeholder={hasAnalysis ? d("chat_placeholder") : d("chat_placeholder_help")}
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
          aria-label="Send"
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
