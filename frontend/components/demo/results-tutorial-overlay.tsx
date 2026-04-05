"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BarChart3, Eye, Edit3, Download, Bot, Sparkles, X, ChevronRight, ChevronLeft, Wrench } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "floorscan_results_tuto_seen";

export function resetResultsTutorial() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

interface TutorialStep {
  icon: React.ReactNode;
  title: Record<string, string>;
  description: Record<string, string>;
  color: string;
  target?: string;
  position?: "bottom" | "top" | "center";
}

const STEPS: TutorialStep[] = [
  {
    icon: <BarChart3 className="w-6 h-6" />,
    title: {
      fr: "Vos résultats d'analyse",
      en: "Your analysis results",
      es: "Sus resultados de análisis",
      de: "Ihre Analyseergebnisse",
      it: "I vostri risultati di analisi",
    },
    description: {
      fr: "Retrouvez ici toutes les métriques détectées par l'IA : nombre de portes, fenêtres, surfaces et périmètres.",
      en: "Find all AI-detected metrics here: doors, windows, surfaces and perimeters.",
      es: "Encuentre aquí todas las métricas detectadas por la IA: puertas, ventanas, superficies y perímetros.",
      de: "Hier finden Sie alle KI-erkannten Metriken: Türen, Fenster, Flächen und Umfänge.",
      it: "Qui trovate tutte le metriche rilevate dall'IA: porte, finestre, superfici e perimetri.",
    },
    color: "text-cyan-400",
    target: '[data-tuto-results="kpis"]',
    position: "bottom",
  },
  {
    icon: <Eye className="w-6 h-6" />,
    title: {
      fr: "Affichez / masquez les calques",
      en: "Show / hide layers",
      es: "Mostrar / ocultar capas",
      de: "Ebenen ein-/ausblenden",
      it: "Mostra / nascondi livelli",
    },
    description: {
      fr: "Activez ou désactivez les masques (portes, fenêtres, murs, pièces...) pour visualiser les détections sur le plan.",
      en: "Toggle masks (doors, windows, walls, rooms...) to visualize detections on the plan.",
      es: "Active o desactive las máscaras (puertas, ventanas, muros, habitaciones...) para visualizar las detecciones.",
      de: "Schalten Sie Masken (Türen, Fenster, Wände, Räume...) ein/aus, um die Erkennungen zu sehen.",
      it: "Attivate/disattivate le maschere (porte, finestre, muri, stanze...) per visualizzare le rilevazioni.",
    },
    color: "text-amber-400",
    target: '[data-tuto-results="overlays"]',
    position: "top",
  },
  {
    icon: <Edit3 className="w-6 h-6" />,
    title: {
      fr: "Validez dans le Mask Editor",
      en: "Validate in Mask Editor",
      es: "Valide en el Mask Editor",
      de: "Validieren im Mask Editor",
      it: "Validate nel Mask Editor",
    },
    description: {
      fr: "Passez par l'éditeur pour valider, corriger ou compléter les détections IA avant d'exporter.",
      en: "Use the editor to validate, correct or complete AI detections before exporting.",
      es: "Use el editor para validar, corregir o completar las detecciones IA antes de exportar.",
      de: "Nutzen Sie den Editor, um KI-Erkennungen zu validieren, zu korrigieren oder zu ergänzen.",
      it: "Usate l'editor per validare, correggere o completare le rilevazioni IA prima di esportare.",
    },
    color: "text-emerald-400",
    target: '[data-tuto-results="editor-btn"]',
    position: "bottom",
  },
  {
    icon: <Download className="w-6 h-6" />,
    title: {
      fr: "Exportez vos données",
      en: "Export your data",
      es: "Exporte sus datos",
      de: "Exportieren Sie Ihre Daten",
      it: "Esportate i vostri dati",
    },
    description: {
      fr: "Téléchargez le rapport PDF complet, l'export XLSX détaillé ou l'image annotée avec les masques.",
      en: "Download the full PDF report, detailed XLSX export or annotated image with masks.",
      es: "Descargue el informe PDF completo, el XLSX detallado o la imagen anotada con máscaras.",
      de: "Laden Sie den vollständigen PDF-Bericht, den detaillierten XLSX-Export oder das annotierte Bild herunter.",
      it: "Scaricate il report PDF completo, l'export XLSX dettagliato o l'immagine annotata.",
    },
    color: "text-sky-400",
    target: '[data-tuto-results="export-btn"]',
    position: "bottom",
  },
  {
    icon: <Wrench className="w-6 h-6" />,
    title: {
      fr: "Outils avancés & IA",
      en: "Advanced tools & AI",
      es: "Herramientas avanzadas e IA",
      de: "Erweiterte Tools & KI",
      it: "Strumenti avanzati e IA",
    },
    description: {
      fr: "Accédez aux outils pro : estimation matériaux, DPGF, CCTP, scénarios, planning, conformité et plus encore.",
      en: "Access pro tools: material estimates, DPGF, CCTP, scenarios, scheduling, compliance and more.",
      es: "Acceda a herramientas pro: estimación de materiales, DPGF, CCTP, escenarios, planificación y más.",
      de: "Zugriff auf Pro-Tools: Materialschätzung, DPGF, CCTP, Szenarien, Planung, Compliance und mehr.",
      it: "Accedete agli strumenti pro: stima materiali, DPGF, CCTP, scenari, pianificazione e altro.",
    },
    color: "text-violet-400",
    target: '[data-tuto-results="advanced"]',
    position: "top",
  },
];

interface SpotlightRect { x: number; y: number; w: number; h: number; }

export default function ResultsTutorialOverlay({ forceShow: externalForce }: { forceShow?: boolean }) {
  const { lang } = useLang();
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
  if (!spotlight) {
    tooltipStyle.top = "50%";
    tooltipStyle.left = "50%";
    tooltipStyle.transform = "translate(-50%, -50%)";
  } else {
    const tooltipH = 200;
    const spaceBelow = window.innerHeight - (spotlight.y + spotlight.h + 20);
    const spaceAbove = spotlight.y - 20;
    const useTop = spaceBelow < tooltipH && spaceAbove > spaceBelow;
    tooltipStyle.left = Math.max(16, Math.min(window.innerWidth - 380, spotlight.x + spotlight.w / 2 - 170));
    if (useTop) {
      tooltipStyle.bottom = window.innerHeight - spotlight.y + 16;
    } else {
      tooltipStyle.top = spotlight.y + spotlight.h + 16;
    }
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999]" onClick={dismiss}>
          <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
            <defs>
              <mask id="results-tuto-mask">
                <rect width="100%" height="100%" fill="white" />
                {spotlight && <rect x={spotlight.x} y={spotlight.y} width={spotlight.w} height={spotlight.h} rx={12} fill="black" />}
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(0,0,0,0.7)" mask="url(#results-tuto-mask)" />
            {spotlight && <rect x={spotlight.x} y={spotlight.y} width={spotlight.w} height={spotlight.h} rx={12} fill="none" stroke="#22d3ee" strokeWidth={2.5} className="animate-pulse" />}
          </svg>

          <motion.div key={step} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="absolute glass rounded-2xl border border-white/15 p-4 w-[340px] shadow-2xl"
            style={{ ...tooltipStyle, pointerEvents: "all", zIndex: 10000 }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent" />
                <span className="text-sm font-display font-700 text-white">Tutoriel</span>
              </div>
              <button onClick={dismiss} className="text-slate-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex gap-1 mb-3">
              {STEPS.map((_, i) => (
                <div key={i} className={cn("h-1 rounded-full flex-1 transition-all duration-300",
                  i === step ? "bg-accent" : i < step ? "bg-accent/40" : "bg-white/10")} />
              ))}
            </div>
            <div className="flex items-start gap-3 mb-4">
              <div className={cn("shrink-0 w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center", current.color)}>
                {current.icon}
              </div>
              <div className="flex-1">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">{step + 1} / {STEPS.length}</div>
                <h4 className="text-sm font-semibold text-white mb-0.5">{current.title[lang] ?? current.title.fr}</h4>
                <p className="text-xs text-slate-300 leading-relaxed">{current.description[lang] ?? current.description.fr}</p>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <button onClick={() => step > 0 ? setStep(s => s - 1) : dismiss()}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" /> {step > 0 ? "Pr\u00e9c\u00e9dent" : "Passer"}
              </button>
              <button onClick={() => isLast ? dismiss() : setStep(s => s + 1)}
                className={cn("flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all",
                  isLast ? "bg-accent text-white hover:bg-accent/80" : "bg-white/10 text-white hover:bg-white/15")}>
                {isLast ? "C'est parti !" : "Suivant"}
                {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
