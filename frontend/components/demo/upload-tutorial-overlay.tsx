"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileUp, MousePointerClick, Sparkles, X, ChevronRight, ChevronLeft } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "floorscan_upload_tuto_seen";

/** Call this to force the tutorial to show again */
export function resetUploadTutorial() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

interface TutorialStep {
  icon: React.ReactNode;
  title: Record<string, string>;
  description: Record<string, string>;
  color: string;
  target?: string;
  position?: "bottom" | "top" | "left" | "right" | "center";
}

const STEPS: TutorialStep[] = [
  {
    icon: <Upload className="w-6 h-6" />,
    title: {
      fr: "Bienvenue dans AI Floor Analysis",
      en: "Welcome to AI Floor Analysis",
      es: "Bienvenido a AI Floor Analysis",
      de: "Willkommen bei AI Floor Analysis",
      it: "Benvenuto in AI Floor Analysis",
    },
    description: {
      fr: "Importez un plan PDF ou image pour démarrer l'analyse IA automatique.",
      en: "Import a PDF plan or image to start automatic AI analysis.",
      es: "Importe un plano PDF o imagen para iniciar el análisis IA.",
      de: "Importieren Sie einen PDF-Plan oder ein Bild für die KI-Analyse.",
      it: "Importate un piano PDF o un'immagine per l'analisi IA.",
    },
    color: "text-accent",
    position: "center",
  },
  {
    icon: <FileUp className="w-6 h-6" />,
    title: {
      fr: "Glissez-déposez votre fichier",
      en: "Drag & drop your file",
      es: "Arrastre y suelte su archivo",
      de: "Datei per Drag & Drop ablegen",
      it: "Trascinate il vostro file",
    },
    description: {
      fr: "Glissez un fichier PDF, JPG ou PNG sur cette zone.",
      en: "Drag a PDF, JPG or PNG file onto this area.",
      es: "Arrastre un PDF, JPG o PNG a esta zona.",
      de: "Ziehen Sie eine PDF/JPG/PNG-Datei hierher.",
      it: "Trascinate un PDF, JPG o PNG qui.",
    },
    color: "text-cyan-400",
    target: '[data-tuto-upload="dropzone"]',
    position: "bottom",
  },
  {
    icon: <MousePointerClick className="w-6 h-6" />,
    title: {
      fr: "Ou cliquez pour parcourir",
      en: "Or click to browse",
      es: "O haga clic para explorar",
      de: "Oder klicken zum Durchsuchen",
      it: "Oppure cliccate per sfogliare",
    },
    description: {
      fr: "Ou cliquez sur la zone pour parcourir vos fichiers.",
      en: "Or click the area to browse your files.",
      es: "O haga clic para explorar sus archivos.",
      de: "Oder klicken Sie zum Durchsuchen.",
      it: "O cliccate per sfogliare i file.",
    },
    color: "text-amber-400",
    target: '[data-tuto-upload="dropzone"]',
    position: "bottom",
  },
];

interface SpotlightRect { x: number; y: number; w: number; h: number; }

export default function UploadTutorialOverlay({ forceShow: externalForce }: { forceShow?: boolean }) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const rafRef = useRef(0);

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

  const updateSpotlight = useCallback(() => {
    const current = STEPS[step];
    if (!current?.target || !show) { setSpotlight(null); return; }
    const el = document.querySelector(current.target);
    if (!el) { setSpotlight(null); return; }
    const rect = el.getBoundingClientRect();
    const pad = 12;
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

  const tooltipStyle: React.CSSProperties = {};
  if (current.position === "center" || !spotlight) {
    tooltipStyle.top = "50%";
    tooltipStyle.left = "50%";
    tooltipStyle.transform = "translate(-50%, -50%)";
  } else if (spotlight) {
    const tooltipH = 200; // estimated tooltip height
    const spaceBelow = window.innerHeight - (spotlight.y + spotlight.h + 20);
    const spaceAbove = spotlight.y - 20;
    // Auto-pick: above if not enough space below
    const useTop = spaceBelow < tooltipH && spaceAbove > spaceBelow;
    tooltipStyle.left = Math.max(16, Math.min(window.innerWidth - 440, spotlight.x + spotlight.w / 2 - 200));
    if (useTop) {
      tooltipStyle.bottom = window.innerHeight - spotlight.y + 16;
    } else {
      tooltipStyle.top = spotlight.y + spotlight.h + 16;
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
              <mask id="upload-tuto-mask">
                <rect width="100%" height="100%" fill="white" />
                {spotlight && (
                  <rect x={spotlight.x} y={spotlight.y} width={spotlight.w} height={spotlight.h} rx={16} fill="black" />
                )}
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(0,0,0,0.7)" mask="url(#upload-tuto-mask)" />
            {spotlight && (
              <rect x={spotlight.x} y={spotlight.y} width={spotlight.w} height={spotlight.h} rx={16}
                fill="none" stroke="#22d3ee" strokeWidth={2.5} className="animate-pulse" />
            )}
          </svg>

          {/* Tooltip card */}
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="absolute glass rounded-2xl border border-white/15 p-4 w-[360px] shadow-2xl"
            style={{ ...tooltipStyle, pointerEvents: "all", zIndex: 10000 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent" />
                <span className="text-sm font-display font-700 text-white">{d("tuto_header")}</span>
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
                <h4 className="text-sm font-semibold text-white mb-1">{current.title[lang] ?? current.title.fr}</h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {current.description[lang] ?? current.description.fr}
                </p>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between items-center">
              <button onClick={() => step > 0 ? setStep(s => s - 1) : dismiss()}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" />
                {step > 0 ? d("tuto_prev") : d("tuto_skip")}
              </button>
              <button onClick={() => isLast ? dismiss() : setStep(s => s + 1)}
                className={cn("flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all",
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
