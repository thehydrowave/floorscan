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
  position?: "bottom" | "top" | "left" | "right";
}

const STEPS: TutorialStep[] = [
  { icon: <Filter className="w-6 h-6" />,     titleKey: "tuto_fr_filter" as DTKey,   color: "text-slate-300",   target: '[data-tuto-fr="filter"]',  position: "bottom" },
  { icon: <ZoomIn className="w-6 h-6" />,     titleKey: "tuto_fr_zoom" as DTKey,     color: "text-sky-300",     target: '[data-tuto-fr="zoom"]',    position: "left" },
  { icon: <BarChart3 className="w-6 h-6" />,  titleKey: "tuto_fr_summary" as DTKey,  color: "text-emerald-300", target: '[data-tuto-fr="summary"]', position: "bottom" },
  { icon: <PenSquare className="w-6 h-6" />,  titleKey: "tuto_fr_edit" as DTKey,     color: "text-amber-300",   target: '[data-tuto-fr="edit"]',    position: "bottom" },
  { icon: <Download className="w-6 h-6" />,   titleKey: "tuto_fr_export" as DTKey,   color: "text-violet-300",  target: '[data-tuto-fr="export"]',  position: "bottom" },
  { icon: <Wrench className="w-6 h-6" />,     titleKey: "tuto_fr_advanced" as DTKey, color: "text-rose-300" },
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
    const current = STEPS[step];
    if (!current?.target || !show) { setSpotlight(null); return; }
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
    return () => { window.removeEventListener("resize", onUpdate); window.removeEventListener("scroll", onUpdate, true); cancelAnimationFrame(rafRef.current); };
  }, [updateSpotlight]);

  const dismiss = () => { setShow(false); try { localStorage.setItem(STORAGE_KEY, "1"); } catch {} };
  if (!show) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  let tipX = spotlight ? spotlight.x + spotlight.w / 2 : typeof window !== "undefined" ? window.innerWidth / 2 : 400;
  let tipY = spotlight ? spotlight.y + spotlight.h + 12 : typeof window !== "undefined" ? window.innerHeight / 2 : 300;
  if (current?.position === "top" && spotlight) tipY = spotlight.y - 12;
  if (current?.position === "left" && spotlight) { tipX = spotlight.x - 12; tipY = spotlight.y + spotlight.h / 2; }
  tipX = Math.max(16, Math.min(tipX, (typeof window !== "undefined" ? window.innerWidth : 800) - 320));
  tipY = Math.max(16, Math.min(tipY, (typeof window !== "undefined" ? window.innerHeight : 600) - 160));

  return (
    <>
      <div className="fixed inset-0 z-[9999]" onClick={dismiss}>
        <svg className="w-full h-full">
          <defs>
            <mask id="fr-tuto-mask">
              <rect width="100%" height="100%" fill="white" />
              {spotlight && <rect x={spotlight.x} y={spotlight.y} width={spotlight.w} height={spotlight.h} rx={12} fill="black" />}
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#fr-tuto-mask)" />
          {spotlight && <rect x={spotlight.x} y={spotlight.y} width={spotlight.w} height={spotlight.h} rx={12} fill="none" stroke="#8b5cf6" strokeWidth={2.5} className="animate-pulse" />}
        </svg>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}
          className="fixed z-[10000] w-80 glass border border-white/20 rounded-2xl p-5 shadow-2xl"
          style={{ left: tipX, top: tipY }} onClick={e => e.stopPropagation()}>
          <div className="flex gap-1 mb-3">{STEPS.map((_, i) => <div key={i} className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-violet-500" : "bg-white/10")} />)}</div>
          <div className="flex items-start gap-3 mb-4">
            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", current.color)} style={{ background: "rgba(139,92,246,0.15)" }}>{current.icon}</div>
            <div>
              <div className="text-[10px] text-slate-500 mb-1">{step + 1} {d("tuto_of" as DTKey)} {STEPS.length}</div>
              <p className="text-sm text-slate-200 leading-relaxed">{d(current.titleKey)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <button onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white disabled:opacity-30"><ChevronLeft className="w-3.5 h-3.5" /> {d("tuto_prev" as DTKey)}</button>
            {isLast
              ? <button onClick={dismiss} className="px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-500">{d("tuto_close" as DTKey)}</button>
              : <button onClick={() => setStep(s => s + 1)} className="flex items-center gap-1 text-xs text-white font-semibold">{d("tuto_next" as DTKey)} <ChevronRight className="w-3.5 h-3.5" /></button>}
          </div>
        </motion.div>
      </AnimatePresence>
    </>
  );
}
