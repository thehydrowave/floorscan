"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LayoutGrid, PaintBucket, Hash, Ruler, Search, ChevronRight, ChevronLeft, X, Sparkles, Layers } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "floorscan_editor_tuto_seen";

interface TutorialStep {
  icon: React.ReactNode;
  titleKey: DTKey;
  color: string;
  /** CSS selector for the spotlight target element (data-tuto="xxx") */
  target?: string;
  /** Position of the tooltip relative to the spotlight */
  position?: "bottom" | "top" | "left" | "right";
}

const STEPS: TutorialStep[] = [
  { icon: <Layers className="w-6 h-6" />,      titleKey: "tuto_ed_step1", color: "text-slate-300",   target: '[data-tuto="edit-bar"]',    position: "bottom" },
  { icon: <LayoutGrid className="w-6 h-6" />,  titleKey: "tuto_ed_step2", color: "text-emerald-300", target: '[data-tuto="rooms-btn"]',   position: "bottom" },
  { icon: <PaintBucket className="w-6 h-6" />, titleKey: "tuto_ed_step3", color: "text-violet-300",  target: '[data-tuto="surface-btn"]', position: "bottom" },
  { icon: <Hash className="w-6 h-6" />,        titleKey: "tuto_ed_step4", color: "text-sky-300",     target: '[data-tuto="tools-btn"]',   position: "bottom" },
  { icon: <Ruler className="w-6 h-6" />,       titleKey: "tuto_ed_step5", color: "text-amber-300",   target: '[data-tuto="tools-btn"]',   position: "bottom" },
  { icon: <Search className="w-6 h-6" />,      titleKey: "tuto_ed_step6", color: "text-amber-300",   target: '[data-tuto="vs-btn"]',      position: "bottom" },
];

interface SpotlightRect { x: number; y: number; w: number; h: number; }

export default function EditorTutorialOverlay() {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        const t = setTimeout(() => setShow(true), 1000);
        return () => clearTimeout(t);
      }
    } catch {}
  }, []);

  // Update spotlight position when step changes or on scroll/resize
  const updateSpotlight = useCallback(() => {
    const current = STEPS[step];
    if (!current?.target || !show) { setSpotlight(null); return; }
    const el = document.querySelector(current.target);
    if (!el) { setSpotlight(null); return; }
    const rect = el.getBoundingClientRect();
    const pad = 8;
    setSpotlight({
      x: rect.left - pad,
      y: rect.top - pad,
      w: rect.width + pad * 2,
      h: rect.height + pad * 2,
    });
  }, [step, show]);

  useEffect(() => {
    updateSpotlight();
    const onUpdate = () => { cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(updateSpotlight); };
    window.addEventListener("resize", onUpdate);
    window.addEventListener("scroll", onUpdate, true);
    return () => { window.removeEventListener("resize", onUpdate); window.removeEventListener("scroll", onUpdate, true); cancelAnimationFrame(rafRef.current); };
  }, [updateSpotlight]);

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
  };

  if (!show) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  // Tooltip position near the spotlight
  const tooltipStyle: React.CSSProperties = {};
  if (spotlight) {
    const pos = current.position ?? "bottom";
    if (pos === "bottom") {
      tooltipStyle.top = spotlight.y + spotlight.h + 16;
      tooltipStyle.left = Math.max(16, Math.min(window.innerWidth - 420, spotlight.x));
    } else if (pos === "top") {
      tooltipStyle.bottom = window.innerHeight - spotlight.y + 16;
      tooltipStyle.left = Math.max(16, Math.min(window.innerWidth - 420, spotlight.x));
    } else if (pos === "right") {
      tooltipStyle.top = spotlight.y;
      tooltipStyle.left = spotlight.x + spotlight.w + 16;
    } else {
      tooltipStyle.top = spotlight.y;
      tooltipStyle.right = window.innerWidth - spotlight.x + 16;
    }
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999]"
          onClick={dismiss}
        >
          {/* Dark overlay with spotlight hole */}
          <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
            <defs>
              <mask id="tuto-mask">
                <rect width="100%" height="100%" fill="white" />
                {spotlight && (
                  <rect
                    x={spotlight.x} y={spotlight.y}
                    width={spotlight.w} height={spotlight.h}
                    rx={12} fill="black"
                  />
                )}
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(0,0,0,0.65)" mask="url(#tuto-mask)" />
            {/* Glowing border around spotlight */}
            {spotlight && (
              <rect
                x={spotlight.x} y={spotlight.y}
                width={spotlight.w} height={spotlight.h}
                rx={12} fill="none"
                stroke="#8b5cf6" strokeWidth={2.5}
                className="animate-pulse"
              />
            )}
          </svg>

          {/* Tooltip card */}
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="absolute glass rounded-2xl border border-white/15 p-5 w-[400px] shadow-2xl"
            style={{ ...tooltipStyle, pointerEvents: "all", zIndex: 10000 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent" />
                <span className="text-sm font-display font-700 text-white">{d("tuto_ed_welcome")}</span>
              </div>
              <button onClick={dismiss}
                className="text-slate-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Progress */}
            <div className="flex gap-1 mb-4">
              {STEPS.map((_, i) => (
                <div key={i}
                  className={cn(
                    "h-1 rounded-full flex-1 transition-all duration-300",
                    i === step ? "bg-accent" : i < step ? "bg-accent/40" : "bg-white/10"
                  )}
                />
              ))}
            </div>

            {/* Content */}
            <div className="flex items-start gap-3 mb-5">
              <div className={cn("shrink-0 w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center", current.color)}>
                {current.icon}
              </div>
              <div className="flex-1">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">
                  {step + 1} {d("tuto_of")} {STEPS.length}
                </div>
                <p className="text-sm text-slate-200 leading-relaxed">
                  {d(current.titleKey)}
                </p>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => setStep(s => Math.max(0, s - 1))}
                disabled={step === 0}
                className={cn(
                  "flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                  step === 0 ? "text-slate-600 cursor-not-allowed" : "text-slate-400 hover:text-white hover:bg-white/5"
                )}
              >
                <ChevronLeft className="w-4 h-4" /> {d("tuto_prev")}
              </button>

              {isLast ? (
                <button
                  onClick={dismiss}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent hover:bg-accent/80 text-white text-sm font-semibold transition-all shadow-lg"
                >
                  {d("tuto_close")}
                </button>
              ) : (
                <button
                  onClick={() => setStep(s => s + 1)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition-all"
                >
                  {d("tuto_next")} <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
