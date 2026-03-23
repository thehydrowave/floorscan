"use client";

/**
 * FacadeChatPanel — Assistant IA chat pour l'analyse facade.
 * Envoie les messages a /api/chat avec le contexte facade (surface, elements, ratio).
 * Implementation simple fetch-based (pas de streaming necessaire).
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Loader2,
  Trash2,
  User,
  Bot,
} from "lucide-react";
import { FacadeAnalysisResult } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/* ── Types ── */
interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface FacadeChatPanelProps {
  result: FacadeAnalysisResult;
}

/* ── Suggestions ── */
const SUGGESTIONS_FR = [
  "Quelle est la surface murale nette ?",
  "Mon ratio vitrage est-il conforme RE2020 ?",
  "Quel budget pour le ravalement ?",
  "Combien de menuiseries par etage ?",
  "Quels materiaux pour l'ITE ?",
];

const SUGGESTIONS_EN = [
  "What is the net wall area?",
  "Is my glazing ratio RE2020 compliant?",
  "What budget for facade renovation?",
  "How many openings per floor?",
  "What materials for external insulation?",
];

/* ── Minimal markdown to HTML ── */
function fmtMd(md: string): string {
  return md
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-slate-700/60 text-amber-300 text-xs">$1</code>')
    .replace(/^### (.+)$/gm, '<h4 class="font-semibold text-amber-300 mt-2 mb-1">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="font-semibold text-amber-200 mt-2 mb-1">$1</h3>')
    .replace(/^- (.+)$/gm, '<li class="ml-3">$1</li>')
    .replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul class="list-disc pl-2 mb-2">$1</ul>')
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br/>")
    .replace(/^(.+)/, "<p>$1</p>");
}

/* ── Component ── */
export default function FacadeChatPanel({ result }: FacadeChatPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const isFr = lang === "fr";

  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const suggestions = isFr ? SUGGESTIONS_FR : SUGGESTIONS_EN;

  /* ── Auto-scroll on new messages ── */
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  /* ── Build facade context for the system prompt ── */
  const buildContext = useCallback(() => {
    const facadeArea = result.facade_area_m2;
    const openingsArea = result.openings_area_m2;
    const wallArea = facadeArea != null && openingsArea != null
      ? Math.max(0, facadeArea - openingsArea)
      : null;
    const ratioPct = result.ratio_openings != null
      ? (result.ratio_openings * 100).toFixed(1)
      : null;

    // Element counts per type
    const typeCounts: Record<string, number> = {};
    for (const el of result.elements) {
      typeCounts[el.type] = (typeCounts[el.type] ?? 0) + 1;
    }

    // Elements per floor
    const floorCounts: Record<number, number> = {};
    for (const el of result.elements) {
      const lvl = el.floor_level ?? 0;
      floorCounts[lvl] = (floorCounts[lvl] ?? 0) + 1;
    }

    return {
      windows_count: result.windows_count,
      doors_count: result.doors_count,
      balconies_count: result.balconies_count,
      floors_count: result.floors_count,
      facade_area_m2: facadeArea,
      openings_area_m2: openingsArea,
      wall_area_m2: wallArea,
      ratio_openings_pct: ratioPct,
      pixels_per_meter: result.pixels_per_meter,
      type_counts: typeCounts,
      floor_counts: floorCounts,
      elements: result.elements.map(e => ({
        type: e.type,
        floor_level: e.floor_level,
        area_m2: e.area_m2,
        confidence: e.confidence,
      })),
    };
  }, [result]);

  /* ── Send message ── */
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    setError(null);

    const userMsg: ChatMsg = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text.trim(),
    };

    const allMsgs = [...messages, userMsg];
    setMessages(allMsgs);
    setInput("");
    setLoading(true);

    try {
      const ctx = buildContext();
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: allMsgs.map(m => ({ role: m.role, content: m.content })),
          analysisContext: ctx,
          mode: "facade",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      // Read full response (non-streaming)
      const responseText = await res.text();

      const assistantMsg: ChatMsg = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: responseText,
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [messages, loading, buildContext]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex items-center justify-between w-full p-5 cursor-pointer hover:bg-white/5 transition-colors"
        style={{
          background: expanded
            ? "linear-gradient(135deg, rgba(168,85,247,0.10) 0%, rgba(99,102,241,0.07) 100%)"
            : undefined,
        }}
      >
        <div className="flex items-center gap-3">
          <MessageSquare className="w-5 h-5 text-violet-400" />
          <div className="text-left">
            <span className="text-white font-semibold">
              {isFr ? "Assistant IA Facade" : "AI Facade Assistant"}
            </span>
            <span className="block text-xs text-slate-400">
              {isFr ? "Posez vos questions sur l'analyse" : "Ask questions about the analysis"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!expanded && messages.length > 0 && (
            <span className="text-xs text-violet-400 font-mono mr-1">
              {messages.length} msg
            </span>
          )}
          {expanded
            ? <ChevronUp className="w-5 h-5 text-slate-400" />
            : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </div>
      </button>

      {/* Content */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="fachat-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="flex flex-col" style={{ height: "420px" }}>
              {/* Messages area */}
              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scroll-smooth"
              >
                {/* Empty state with suggestions */}
                {messages.length === 0 && !loading && (
                  <div className="flex flex-col items-center justify-center h-full gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-violet-600/10 flex items-center justify-center border border-violet-500/10">
                      <Bot className="w-7 h-7 text-violet-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-slate-200">
                        {isFr ? "Assistant facade" : "Facade assistant"}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {isFr
                          ? "Surfaces, ratio vitrage, travaux — demandez-moi tout"
                          : "Areas, glazing ratio, works — ask me anything"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center max-w-[380px]">
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

                {/* Message list */}
                {messages.map(msg => (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex gap-2",
                      msg.role === "user" ? "justify-end" : "justify-start"
                    )}
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
                        <div
                          className="prose prose-sm prose-invert max-w-none [&>p]:mb-2 [&>ul]:mb-2 [&>ol]:mb-2 [&_li]:text-slate-300 [&_strong]:text-violet-300"
                          dangerouslySetInnerHTML={{ __html: fmtMd(msg.content) }}
                        />
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

                {/* Loading indicator */}
                {loading && (
                  <div className="flex gap-2 justify-start">
                    <div className="w-6 h-6 rounded-md bg-violet-600/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="w-3.5 h-3.5 text-violet-400" />
                    </div>
                    <div className="bg-slate-800/80 rounded-2xl rounded-bl-md border border-slate-700/40 px-3.5 py-2.5">
                      <div className="flex gap-1.5 py-1">
                        <span className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Error display */}
                {error && (
                  <div className="mx-auto px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300 max-w-[90%]">
                    {error.includes("API key") || error.includes("401")
                      ? (isFr ? "Cle API non configuree" : "API key not configured")
                      : `${isFr ? "Erreur" : "Error"} : ${error}`}
                  </div>
                )}
              </div>

              {/* Input area */}
              <div className="border-t border-white/5 px-3 py-3 bg-slate-900/50">
                {/* Clear button */}
                {messages.length > 0 && (
                  <div className="flex justify-end mb-2">
                    <button
                      type="button"
                      onClick={() => { setMessages([]); setError(null); }}
                      className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      {isFr ? "Effacer" : "Clear"}
                    </button>
                  </div>
                )}
                <form onSubmit={handleSubmit} className="flex items-center gap-2">
                  <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder={
                      isFr
                        ? "Posez une question sur la facade..."
                        : "Ask a question about the facade..."
                    }
                    disabled={loading}
                    className={cn(
                      "flex-1 px-4 py-2.5 text-sm rounded-xl",
                      "bg-slate-800/80 border border-slate-600/40",
                      "text-white placeholder:text-slate-500",
                      "focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50",
                      "disabled:opacity-50"
                    )}
                    autoFocus={false}
                  />
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    aria-label="Send"
                    className={cn(
                      "p-2.5 rounded-xl transition-all",
                      input.trim() && !loading
                        ? "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/20"
                        : "bg-slate-700/50 text-slate-500 cursor-not-allowed"
                    )}
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                </form>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
