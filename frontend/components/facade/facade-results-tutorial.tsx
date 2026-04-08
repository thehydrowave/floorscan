"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Filter, ZoomIn, BarChart3, PenSquare, Download, Wrench, ChevronRight, ChevronLeft, X } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "floorscan_facade_results_tuto_seen";

export function resetFacadeResultsTutorial() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

interface TutorialStep {
  icon: React.ReactNode;
  titleKey: DTKey;
  color: string;
  target?: string;
}

const STEPS: TutorialStep[] = [
  { icon: <Filter className="w-6 h-6" />,    titleKey: "tuto_fr_filter" as DTKey,   color: "text-slate-300",   target: '[data-tuto-fr="filter"]' },
  { icon: <BarChart3 className="w-6 h-6" />, titleKey: "tuto_fr_summary" as DTKey,  color: "text-emerald-300", target: '[data-tuto-fr="summary"]' },
  { icon: <PenSquare className="w-6 h-6" />, titleKey: "tuto_fr_edit" as DTKey,     color: "text-amber-300",   target: '[data-tuto-fr="edit"]' },
  { icon: <Download className="w-6 h-6" />,  titleKey: "tuto_fr_export" as DTKey,   color: "text-violet-300",  target: '[data-tuto-fr="export"]' },
  { icon: <ZoomIn className="w-6 h-6" />,    titleKey: "tuto_fr_zoom" as DTKey,     color: "text-sky-300" },
  { icon: <Wrench className="w-6 h-6" />,    titleKey: "tuto_fr_advanced" as DTKey, color: "text-rose-300" },
];

interface SpotlightRect { x: number; y: number; w: number; h: number; }

export default function FacadeResultsTutorial({ forceShow }: { forceShow?: boolean } = {}) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    try { if (!localStorage.getItem(STORAGE_KEY)) { const t = setTimeout(() => setShow(true), 800); return () => clearTimeout(t); } } catch {}
  }, []);

  useEffect(() => { if (forceShow) { setShow(true); setStep(0); } }, [forceShow]);

  // Scroll target into view when step changes
  useEffect(() => {
    if (!show) return;
    const current = STEPS[step];
    if (!current?.target) { setSpotlight(null); return; }
    const el = document.querySelector(current.target);
    if (!el) { setSpotlight(null); return; }
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }, [step, show]);

  // Track spotlight position (updates on scroll/resize)
  const updateSpotlight = useCallback(() => {
    if (!show) { setSpotlight(null); return; }
    const current = STEPS[step];
    if (!current?.target) { setSpotlight(null); return; }
    const el = document.querySelector(current.target);
    if (!el) { setSpotlight(null); return; }
    const rect = el.getBoundingClientRect();
    const pad = 8;
    setSpotlight({ x: rect.left - pad, y: rect.top - pad, w: rect.width + pad * 2, h: rect.height + pad * 2 });
  }, [step, show]);

  useEffect(() => {
    updateSpotlight();
    const onUpdate = () => { cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(updateSpotlight); };
    window.addEventListener("resize", onUpdate);
    window.addEventListener("scroll", onUpdate, true);
    const interval = setInterval(updateSpotlight, 100);
    return () => { window.removeEventListener("resize", onUpdate); window.removeEventListener("scroll", onUpdate, true); clearInterval(interval); cancelAnimationFrame(rafRef.current); };
  }, [updateSpotlight]);

  const dismiss = () => { setShow(false); try { localStorage.setItem(STORAGE_KEY, "1"); } catch {} };
  const next = () => setStep(s => Math.min(STEPS.length - 1, s + 1));
  const prev = () => setStep(s => Math.max(0, s - 1));

  if (!show) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <>
      {/* Dimmed overlay with spotlight cutout */}
      <svg className="fixed inset-0 z-[9999] w-full h-full pointer-events-none">
        <defs>
          <mask id="fr-tuto-mask">
            <rect width="100%" height="100%" fill="white" />
            {spotlight && <rect x={spotlight.x} y={spotlight.y} width={spotlight.w} height={spotlight.h} rx={12} fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.65)" mask="url(#fr-tuto-mask)" />
        {spotlight && <rect x={spotlight.x} y={spotlight.y} width={spotlight.w} height={spotlight.h} rx={12} fill="none" stroke="#f59e0b" strokeWidth={3} className="animate-pulse" />}
      </svg>

      {/* Popup — FIXED bottom-right, always visible regardless of scroll */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.25 }}
          className="fixed bottom-6 right-6 z-[10000] w-96 glass border-2 border-orange-500/50 bg-slate-900/95 rounded-2xl p-5 shadow-2xl shadow-orange-500/20"
        >
          {/* Progress bar */}
          <div className="flex gap-1 mb-4">
            {STEPS.map((_, i) => (
              <div key={i} className={cn("h-1 flex-1 rounded-full transition-colors", i <= step ? "bg-orange-500" : "bg-white/10")} />
            ))}
          </div>

          {/* Close button top-right */}
          <button onClick={dismiss} className="absolute top-3 right-3 text-slate-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>

          {/* Content */}
          <div className="flex items-start gap-3 mb-5 pr-6">
            <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shrink-0", current.color)} style={{ background: "rgba(245,158,11,0.15)" }}>
              {current.icon}
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-orange-400 font-semibold uppercase tracking-wide mb-1">
                {d("common_tutorial" as DTKey)} · {step + 1} {d("tuto_of" as DTKey)} {STEPS.length}
              </div>
              <p className="text-sm text-white leading-relaxed">{d(current.titleKey)}</p>
            </div>
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between gap-3">
            <button onClick={prev} disabled={step === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" /> {d("tuto_prev" as DTKey)}
            </button>
            {isLast ? (
              <button onClick={dismiss} className="px-5 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition-colors">
                {d("tuto_close" as DTKey)}
              </button>
            ) : (
              <button onClick={next} className="flex items-center gap-1 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition-colors">
                {d("tuto_next" as DTKey)} <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </>
  );
}
