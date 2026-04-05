"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Ruler, MousePointerClick, Sparkles, X, ChevronRight, ChevronLeft, Crosshair } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "floorscan_scale_tuto_seen";

export function resetScaleTutorial() {
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
    icon: <Ruler className="w-6 h-6" />,
    title: { fr: "Calibrez l'échelle", en: "Calibrate the scale", es: "Calibre la escala", de: "Maßstab kalibrieren", it: "Calibrate la scala" },
    description: { fr: "Placez 2 points sur une distance connue du plan (ex: un mur coté).", en: "Place 2 points on a known distance on the plan (e.g. a dimensioned wall).", es: "Coloque 2 puntos en una distancia conocida del plano.", de: "Setzen Sie 2 Punkte auf eine bekannte Strecke.", it: "Posizionate 2 punti su una distanza nota." },
    color: "text-cyan-400",
    target: '[data-tuto-scale="image"]',
    position: "top",
  },
  {
    icon: <Crosshair className="w-6 h-6" />,
    title: { fr: "Clic gauche = poser un point", en: "Left click = place a point", es: "Clic izquierdo = colocar punto", de: "Linksklick = Punkt setzen", it: "Clic sinistro = posiziona punto" },
    description: { fr: "Cliquez sur le point A puis le point B. Zoomez avec la molette pour plus de précision.", en: "Click point A then point B. Scroll to zoom for precision.", es: "Haga clic en A luego B. Rueda para zoom.", de: "Klicken Sie A dann B. Scrollen zum Zoomen.", it: "Cliccate A poi B. Rotella per zoom." },
    color: "text-amber-400",
    target: '[data-tuto-scale="image"]',
    position: "top",
  },
  {
    icon: <MousePointerClick className="w-6 h-6" />,
    title: { fr: "Entrez la distance réelle", en: "Enter the real distance", es: "Ingrese la distancia real", de: "Reale Distanz eingeben", it: "Inserite la distanza reale" },
    description: { fr: "Indiquez la longueur réelle en mètres, puis validez. Vous pouvez aussi passer cette étape.", en: "Enter the real length in meters, then confirm. You can also skip this step.", es: "Ingrese la longitud real en metros y confirme. Puede saltar este paso.", de: "Geben Sie die reale Länge in Metern ein. Sie können auch überspringen.", it: "Inserite la lunghezza reale in metri. Potete anche saltare." },
    color: "text-emerald-400",
    target: '[data-tuto-scale="buttons"]',
    position: "top",
  },
];

interface SpotlightRect { x: number; y: number; w: number; h: number; }

export default function ScaleTutorialOverlay({ forceShow: externalForce }: { forceShow?: boolean }) {
  const { lang } = useLang();
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const rafRef = useRef(0);

  useEffect(() => { try { if (!localStorage.getItem(STORAGE_KEY)) { const t = setTimeout(() => setShow(true), 600); return () => clearTimeout(t); } } catch {} }, []);
  useEffect(() => { if (externalForce) { setShow(true); setStep(0); } }, [externalForce]);

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
    window.addEventListener("resize", onUpdate); window.addEventListener("scroll", onUpdate, true);
    return () => { window.removeEventListener("resize", onUpdate); window.removeEventListener("scroll", onUpdate, true); cancelAnimationFrame(rafRef.current); };
  }, [updateSpotlight]);

  const dismiss = () => { setShow(false); try { localStorage.setItem(STORAGE_KEY, "1"); } catch {} };
  if (!show) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const tooltipStyle: React.CSSProperties = {};
  if (!spotlight) { tooltipStyle.top = "50%"; tooltipStyle.left = "50%"; tooltipStyle.transform = "translate(-50%, -50%)"; }
  else {
    const tooltipH = 180;
    const spaceBelow = window.innerHeight - (spotlight.y + spotlight.h + 20);
    const spaceAbove = spotlight.y - 20;
    const useTop = spaceBelow < tooltipH && spaceAbove > spaceBelow;
    tooltipStyle.left = Math.max(16, Math.min(window.innerWidth - 360, spotlight.x + spotlight.w / 2 - 160));
    if (useTop) { tooltipStyle.bottom = window.innerHeight - spotlight.y + 16; }
    else { tooltipStyle.top = spotlight.y + spotlight.h + 16; }
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[9999]" onClick={dismiss}>
          <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
            <defs><mask id="scale-tuto-mask"><rect width="100%" height="100%" fill="white" />{spotlight && <rect x={spotlight.x} y={spotlight.y} width={spotlight.w} height={spotlight.h} rx={12} fill="black" />}</mask></defs>
            <rect width="100%" height="100%" fill="rgba(0,0,0,0.7)" mask="url(#scale-tuto-mask)" />
            {spotlight && <rect x={spotlight.x} y={spotlight.y} width={spotlight.w} height={spotlight.h} rx={12} fill="none" stroke="#22d3ee" strokeWidth={2.5} className="animate-pulse" />}
          </svg>
          <motion.div key={step} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }}
            className="absolute glass rounded-2xl border border-white/15 p-4 w-[340px] shadow-2xl" style={{ ...tooltipStyle, pointerEvents: "all", zIndex: 10000 }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-accent" /><span className="text-sm font-display font-700 text-white">Tutoriel</span></div>
              <button onClick={dismiss} className="text-slate-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex gap-1 mb-3">{STEPS.map((_, i) => (<div key={i} className={cn("h-1 rounded-full flex-1 transition-all duration-300", i === step ? "bg-accent" : i < step ? "bg-accent/40" : "bg-white/10")} />))}</div>
            <div className="flex items-start gap-3 mb-4">
              <div className={cn("shrink-0 w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center", current.color)}>{current.icon}</div>
              <div className="flex-1">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">{step + 1} / {STEPS.length}</div>
                <h4 className="text-sm font-semibold text-white mb-0.5">{current.title[lang] ?? current.title.fr}</h4>
                <p className="text-xs text-slate-300 leading-relaxed">{current.description[lang] ?? current.description.fr}</p>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <button onClick={() => step > 0 ? setStep(s => s - 1) : dismiss()} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"><ChevronLeft className="w-3.5 h-3.5" />{step > 0 ? "Précédent" : "Passer"}</button>
              <button onClick={() => isLast ? dismiss() : setStep(s => s + 1)} className={cn("flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all", isLast ? "bg-accent text-white hover:bg-accent/80" : "bg-white/10 text-white hover:bg-white/15")}>{isLast ? "Commencer" : "Suivant"}{!isLast && <ChevronRight className="w-3.5 h-3.5" />}</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
