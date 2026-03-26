"use client";

import { useState, useEffect } from "react";
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
}

const STEPS: TutorialStep[] = [
  { icon: <Layers className="w-6 h-6" />,      titleKey: "tuto_ed_step1", color: "text-slate-300" },
  { icon: <LayoutGrid className="w-6 h-6" />,  titleKey: "tuto_ed_step2", color: "text-emerald-300" },
  { icon: <PaintBucket className="w-6 h-6" />, titleKey: "tuto_ed_step3", color: "text-violet-300" },
  { icon: <Hash className="w-6 h-6" />,        titleKey: "tuto_ed_step4", color: "text-sky-300" },
  { icon: <Ruler className="w-6 h-6" />,       titleKey: "tuto_ed_step5", color: "text-amber-300" },
  { icon: <Search className="w-6 h-6" />,      titleKey: "tuto_ed_step6", color: "text-amber-300" },
];

export default function EditorTutorialOverlay() {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        const t = setTimeout(() => setShow(true), 1000);
        return () => clearTimeout(t);
      }
    } catch {}
  }, []);

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
  };

  if (!show) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={dismiss}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", duration: 0.4 }}
            className="glass rounded-2xl border border-white/15 p-6 max-w-lg w-full mx-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-5 h-5 text-accent" />
                <h3 className="text-lg font-display font-700 text-white">
                  {d("tuto_ed_welcome")}
                </h3>
              </div>
              <button onClick={dismiss}
                className="text-slate-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step indicator */}
            <div className="flex gap-1.5 mb-5">
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
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="mb-6"
              >
                <div className="flex items-start gap-4">
                  <div className={cn("shrink-0 w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center", current.color)}>
                    {current.icon}
                  </div>
                  <div className="flex-1">
                    <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">
                      {step + 1} {d("tuto_of")} {STEPS.length}
                    </div>
                    <p className="text-sm text-slate-200 leading-relaxed">
                      {d(current.titleKey)}
                    </p>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Navigation */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => setStep(s => Math.max(0, s - 1))}
                disabled={step === 0}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                  step === 0 ? "text-slate-600 cursor-not-allowed" : "text-slate-400 hover:text-white hover:bg-white/5"
                )}
              >
                <ChevronLeft className="w-4 h-4" /> {d("tuto_prev")}
              </button>

              {isLast ? (
                <button
                  onClick={dismiss}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-accent hover:bg-accent/80 text-white text-sm font-semibold transition-all shadow-lg"
                >
                  {d("tuto_close")}
                </button>
              ) : (
                <button
                  onClick={() => setStep(s => s + 1)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition-all"
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
