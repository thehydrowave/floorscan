"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PenLine, PaintBucket, Home, Ruler, Hash, Layers, Download, Sparkles, X, ChevronRight, ChevronLeft } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "floorscan_measure_tuto_seen";

export function resetMeasureTutorial() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

interface TutorialStep {
  icon: React.ReactNode;
  titleKey: DTKey;
  descKey: DTKey;
  color: string;
}

const STEPS: TutorialStep[] = [
  { icon: <PenLine className="w-6 h-6" />,    titleKey: "tuto_me_step1_title" as DTKey, descKey: "tuto_me_step1_desc" as DTKey, color: "text-cyan-400" },
  { icon: <PaintBucket className="w-6 h-6" />, titleKey: "tuto_me_step2_title" as DTKey, descKey: "tuto_me_step2_desc" as DTKey, color: "text-violet-400" },
  { icon: <Home className="w-6 h-6" />,        titleKey: "tuto_me_step3_title" as DTKey, descKey: "tuto_me_step3_desc" as DTKey, color: "text-emerald-400" },
  { icon: <Ruler className="w-6 h-6" />,       titleKey: "tuto_me_step4_title" as DTKey, descKey: "tuto_me_step4_desc" as DTKey, color: "text-amber-400" },
  { icon: <Hash className="w-6 h-6" />,        titleKey: "tuto_me_step5_title" as DTKey, descKey: "tuto_me_step5_desc" as DTKey, color: "text-pink-400" },
  { icon: <Layers className="w-6 h-6" />,      titleKey: "tuto_me_step6_title" as DTKey, descKey: "tuto_me_step6_desc" as DTKey, color: "text-blue-400" },
  { icon: <Download className="w-6 h-6" />,    titleKey: "tuto_me_step7_title" as DTKey, descKey: "tuto_me_step7_desc" as DTKey, color: "text-sky-400" },
];

export default function MeasureTutorialOverlay({ forceShow: externalForce }: { forceShow?: boolean }) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        const t = setTimeout(() => setShow(true), 800);
        return () => clearTimeout(t);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (externalForce) { setShow(true); setStep(0); }
  }, [externalForce]);

  const dismiss = () => { setShow(false); try { localStorage.setItem(STORAGE_KEY, "1"); } catch {} };

  if (!show) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999]" onClick={dismiss}>
          {/* Dark overlay */}
          <div className="absolute inset-0 bg-black/70" />

          {/* Centered tooltip */}
          <motion.div key={step} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 glass rounded-2xl border border-white/15 p-5 w-[380px] shadow-2xl"
            style={{ zIndex: 10000 }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent" />
                <span className="text-sm font-display font-700 text-white">{d("tuto_me_welcome" as DTKey)}</span>
              </div>
              <button onClick={dismiss} className="text-slate-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Progress */}
            <div className="flex gap-1 mb-4">
              {STEPS.map((_, i) => (
                <div key={i} className={cn("h-1 rounded-full flex-1 transition-all duration-300",
                  i === step ? "bg-accent" : i < step ? "bg-accent/40" : "bg-white/10")} />
              ))}
            </div>

            {/* Content */}
            <div className="flex items-start gap-3 mb-5">
              <div className={cn("shrink-0 w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center", current.color)}>
                {current.icon}
              </div>
              <div className="flex-1">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">
                  {step + 1} / {STEPS.length}
                </div>
                <h4 className="text-sm font-semibold text-white mb-1">{d(current.titleKey)}</h4>
                <p className="text-xs text-slate-300 leading-relaxed">{d(current.descKey)}</p>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between items-center">
              <button onClick={() => step > 0 ? setStep(s => s - 1) : dismiss()}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" /> {step > 0 ? d("tuto_prev") : d("tuto_skip")}
              </button>
              <button onClick={() => isLast ? dismiss() : setStep(s => s + 1)}
                className={cn("flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all",
                  isLast ? "bg-accent text-white hover:bg-accent/80" : "bg-white/10 text-white hover:bg-white/15")}>
                {isLast ? d("tuto_begin") : d("tuto_next")}
                {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
