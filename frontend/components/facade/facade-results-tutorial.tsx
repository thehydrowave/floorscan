"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
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
  { icon: <ZoomIn className="w-6 h-6" />,    titleKey: "tuto_fr_zoom" as DTKey,     color: "text-sky-300",     target: '[data-tuto-fr="zoom"]' },
  { icon: <Download className="w-6 h-6" />,  titleKey: "tuto_fr_export" as DTKey,   color: "text-violet-300",  target: '[data-tuto-fr="export"]' },
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

  const updateSpotlight = useCallback(() => {
    if (!show) { setSpotlight(null); return; }
    const current = STEPS[step];
    if (!current?.target) { setSpotlight(null); return; }
    const el = document.querySelector(current.target);
    if (!el) { setSpotlight(null); return; }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) { setSpotlight(null); return; }
    const pad = 6;
    setSpotlight({ x: rect.left - pad, y: rect.top - pad, w: rect.width + pad * 2, h: rect.height + pad * 2 });
  }, [step, show]);

  // Clear spotlight immediately on step change, then scroll + recompute
  useEffect(() => {
    if (!show) return;
    setSpotlight(null); // clear stale position from previous step
    const current = STEPS[step];
    if (!current?.target) return;
    const el = document.querySelector(current.target);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    // Recompute spotlight after scroll animation completes
    const timeouts = [100, 350, 600, 900].map(t => setTimeout(updateSpotlight, t));
    return () => { timeouts.forEach(clearTimeout); };
  }, [step, show, updateSpotlight]);

  // Re-position on resize
  useEffect(() => {
    if (!show) return;
    const onResize = () => { cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(updateSpotlight); };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); cancelAnimationFrame(rafRef.current); };
  }, [show, updateSpotlight]);

  const dismiss = () => { setShow(false); try { localStorage.setItem(STORAGE_KEY, "1"); } catch {} };
  const next = () => setStep(s => Math.min(STEPS.length - 1, s + 1));
  const prev = () => setStep(s => Math.max(0, s - 1));

  if (!show) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const sp = spotlight;

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      {/* 4 dark divs around the spotlight (or one full overlay if no spotlight) */}
      {sp ? (
        <>
          <div className="fixed left-0 right-0 top-0 z-[9999] bg-black/75 pointer-events-auto" style={{ height: Math.max(0, sp.y) }} onClick={e => e.stopPropagation()} />
          <div className="fixed left-0 right-0 z-[9999] bg-black/75 pointer-events-auto" style={{ top: sp.y + sp.h, bottom: 0 }} onClick={e => e.stopPropagation()} />
          <div className="fixed top-0 z-[9999] bg-black/75 pointer-events-auto" style={{ left: 0, top: sp.y, width: Math.max(0, sp.x), height: sp.h }} onClick={e => e.stopPropagation()} />
          <div className="fixed z-[9999] bg-black/75 pointer-events-auto" style={{ left: sp.x + sp.w, top: sp.y, right: 0, height: sp.h }} onClick={e => e.stopPropagation()} />
          {/* Orange highlight border */}
          <div className="fixed z-[9999] border-2 border-orange-500 rounded-xl pointer-events-none animate-pulse" style={{ left: sp.x, top: sp.y, width: sp.w, height: sp.h, boxShadow: "0 0 30px rgba(245,158,11,0.6)" }} />
        </>
      ) : (
        <div className="fixed inset-0 z-[9999] bg-black/75 pointer-events-auto" onClick={e => e.stopPropagation()} />
      )}

      {/* Popup — bottom-center, always visible */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.2 }}
          className="fixed top-6 left-1/2 -translate-x-1/2 z-[10000] w-[min(480px,calc(100vw-32px))] glass border-2 border-orange-500/60 bg-slate-900/98 rounded-2xl p-5 shadow-2xl"
          style={{ boxShadow: "0 0 60px rgba(245,158,11,0.3)" }}
        >
          <div className="flex gap-1 mb-4">
            {STEPS.map((_, i) => (
              <div key={i} className={cn("h-1 flex-1 rounded-full transition-colors", i <= step ? "bg-orange-500" : "bg-white/10")} />
            ))}
          </div>
          <button onClick={dismiss} className="absolute top-3 right-3 text-slate-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-start gap-3 mb-4 pr-6">
            <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shrink-0", current.color)} style={{ background: "rgba(245,158,11,0.15)" }}>
              {current.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] text-orange-400 font-semibold uppercase tracking-wide mb-1">
                {d("common_tutorial" as DTKey)} · {step + 1} / {STEPS.length}
              </div>
              <p className="text-sm text-white leading-relaxed">{d(current.titleKey)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <button onClick={prev} disabled={step === 0}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
              <ChevronLeft className="w-4 h-4" /> {d("tuto_prev" as DTKey)}
            </button>
            {isLast ? (
              <button onClick={dismiss} className="px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors shadow-lg">
                {d("tuto_close" as DTKey)} ✓
              </button>
            ) : (
              <button onClick={next} className="flex items-center gap-1 px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors shadow-lg">
                {d("tuto_next" as DTKey)} <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </>,
    document.body
  );
}
