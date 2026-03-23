"use client";

/**
 * FacadeToolkitPanel -- Estimation toolkit for building facade renovation.
 * Computes: paint, scaffolding, window/door replacement, ITE insulation, total cost range.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wrench,
  ChevronDown,
  ChevronUp,
  Paintbrush,
  Scaling,
  DoorOpen,
  Thermometer,
  Calculator,
  AlertTriangle,
} from "lucide-react";
import { FacadeAnalysisResult } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/* ---- Props ---- */
interface FacadeToolkitPanelProps {
  result: FacadeAnalysisResult;
}

/* ---- Helpers ---- */
const fmtN = (v: number, d = 1) =>
  v.toLocaleString("fr-FR", { maximumFractionDigits: d });

const fmtEur = (v: number) =>
  v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " \u20AC";

const fmtRange = (lo: number, hi: number) =>
  `${fmtEur(lo)} \u2013 ${fmtEur(hi)}`;

/* ---- Estimation line ---- */
interface EstLine {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  value: string;
  detail: string;
  color: string;
}

/* ---- Component ---- */
export default function FacadeToolkitPanel({ result }: FacadeToolkitPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const isFr = lang === "fr";

  const [expanded, setExpanded] = useState(false);

  const hasArea =
    result.facade_area_m2 != null && result.facade_area_m2 > 0;

  const estimates = useMemo<{
    lines: EstLine[];
    totalLo: number;
    totalHi: number;
  }>(() => {
    if (!hasArea) return { lines: [], totalLo: 0, totalHi: 0 };

    const facadeArea = result.facade_area_m2!;
    const openingsArea = result.openings_area_m2 ?? 0;
    const solidArea = Math.max(0, facadeArea - openingsArea);
    const winCount = result.windows_count;
    const doorCount = result.doors_count;

    /* 1. Paint: solid area * 0.35 L/m2 (2 coats) */
    const paintLiters = solidArea * 0.35;
    const paintCostLo = paintLiters * 8; // ~8 EUR/L budget
    const paintCostHi = paintLiters * 15; // ~15 EUR/L premium

    /* 2. Scaffolding: facade area * 1.1 safety margin, cost ~12-18 EUR/m2 */
    const scaffArea = facadeArea * 1.1;
    const scaffCostLo = scaffArea * 12;
    const scaffCostHi = scaffArea * 18;

    /* 3. Windows: count * 300-800 EUR */
    const winCostLo = winCount * 300;
    const winCostHi = winCount * 800;

    /* 4. Doors: count * 500-1500 EUR */
    const doorCostLo = doorCount * 500;
    const doorCostHi = doorCount * 1500;

    /* 5. ITE: solid area * 0.12m thickness */
    const iteVolume = solidArea * 0.12;
    const iteCostLo = solidArea * 80; // 80 EUR/m2
    const iteCostHi = solidArea * 140; // 140 EUR/m2

    const totalLo = paintCostLo + scaffCostLo + winCostLo + doorCostLo + iteCostLo;
    const totalHi = paintCostHi + scaffCostHi + winCostHi + doorCostHi + iteCostHi;

    const lines: EstLine[] = [
      {
        icon: Paintbrush,
        label: isFr ? "Peinture facade (2 couches)" : "Facade paint (2 coats)",
        value: `${fmtN(paintLiters, 0)} L`,
        detail: isFr
          ? `${fmtN(solidArea)} m\u00B2 \u00D7 0.35 L/m\u00B2 \u2014 ${fmtRange(paintCostLo, paintCostHi)}`
          : `${fmtN(solidArea)} m\u00B2 \u00D7 0.35 L/m\u00B2 \u2014 ${fmtRange(paintCostLo, paintCostHi)}`,
        color: "#f59e0b",
      },
      {
        icon: Scaling,
        label: isFr ? "Echafaudage" : "Scaffolding",
        value: `${fmtN(scaffArea, 0)} m\u00B2`,
        detail: isFr
          ? `${fmtN(facadeArea)} m\u00B2 \u00D7 1.1 (marge) \u2014 ${fmtRange(scaffCostLo, scaffCostHi)}`
          : `${fmtN(facadeArea)} m\u00B2 \u00D7 1.1 (margin) \u2014 ${fmtRange(scaffCostLo, scaffCostHi)}`,
        color: "#64748b",
      },
      {
        icon: DoorOpen,
        label: isFr
          ? `Remplacement fenetres (\u00D7${winCount})`
          : `Window replacement (\u00D7${winCount})`,
        value: winCount > 0 ? fmtRange(winCostLo, winCostHi) : "\u2014",
        detail: isFr
          ? `${winCount} fenetre${winCount > 1 ? "s" : ""} \u00D7 300\u2013800 \u20AC/u.`
          : `${winCount} window${winCount > 1 ? "s" : ""} \u00D7 \u20AC300\u2013800/u.`,
        color: "#60a5fa",
      },
      {
        icon: DoorOpen,
        label: isFr
          ? `Remplacement portes (\u00D7${doorCount})`
          : `Door replacement (\u00D7${doorCount})`,
        value: doorCount > 0 ? fmtRange(doorCostLo, doorCostHi) : "\u2014",
        detail: isFr
          ? `${doorCount} porte${doorCount > 1 ? "s" : ""} \u00D7 500\u20131 500 \u20AC/u.`
          : `${doorCount} door${doorCount > 1 ? "s" : ""} \u00D7 \u20AC500\u20131,500/u.`,
        color: "#f472b6",
      },
      {
        icon: Thermometer,
        label: isFr ? "ITE (isolation 12 cm)" : "ITE (12cm insulation)",
        value: `${fmtN(iteVolume, 1)} m\u00B3`,
        detail: isFr
          ? `${fmtN(solidArea)} m\u00B2 \u00D7 0.12 m \u2014 ${fmtRange(iteCostLo, iteCostHi)}`
          : `${fmtN(solidArea)} m\u00B2 \u00D7 0.12 m \u2014 ${fmtRange(iteCostLo, iteCostHi)}`,
        color: "#a78bfa",
      },
    ];

    return { lines, totalLo, totalHi };
  }, [result, hasArea, isFr]);

  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between w-full p-5 cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Wrench className="w-5 h-5 text-amber-400" />
          <div className="text-left">
            <span className="text-white font-semibold">
              {isFr ? "Toolkit estimation facade" : "Facade Estimation Toolkit"}
            </span>
            <span className="block text-xs text-slate-400">
              {isFr
                ? "Peinture, echafaudage, menuiseries, ITE"
                : "Paint, scaffolding, openings, ITE"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!expanded && hasArea && estimates.totalHi > 0 && (
            <span className="text-xs font-mono text-amber-400 mr-1">
              {fmtRange(estimates.totalLo, estimates.totalHi)}
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-400" />
          )}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="fatk-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {!hasArea ? (
              <div className="flex items-center gap-3 px-5 py-6 text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="text-sm">
                  {isFr
                    ? "Surface facade non disponible. Calibrez l'echelle."
                    : "Facade area not available. Calibrate the scale."}
                </span>
              </div>
            ) : (
              <div className="space-y-4 pb-5">
                {/* Estimation lines */}
                <div className="px-5 space-y-3">
                  {estimates.lines.map((line, i) => {
                    const Icon = line.icon;
                    return (
                      <div
                        key={i}
                        className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5"
                      >
                        <Icon
                          className="w-4 h-4 mt-0.5 shrink-0"
                          style={{ color: line.color }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-slate-200">
                              {line.label}
                            </span>
                            <span
                              className="text-sm font-mono font-semibold shrink-0"
                              style={{ color: line.color }}
                            >
                              {line.value}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {line.detail}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Total */}
                <div className="mx-5 border border-white/10 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-amber-500/10">
                    <div className="flex items-center gap-2">
                      <Calculator className="w-4 h-4 text-amber-400" />
                      <span className="font-semibold text-amber-300">
                        {isFr ? "Estimation totale" : "Total estimate"}
                      </span>
                    </div>
                    <span className="font-display font-bold text-lg text-amber-400">
                      {fmtRange(estimates.totalLo, estimates.totalHi)}
                    </span>
                  </div>
                </div>

                {/* Disclaimer */}
                <div className="mx-5 p-3 rounded-lg bg-white/[0.02] border border-white/5 text-xs text-slate-500 leading-relaxed">
                  {isFr
                    ? "Ces estimations sont indicatives et basees sur des ratios moyens du marche francais. Les couts reels dependent du prestataire, de l'acces au chantier et de l'etat du bati."
                    : "These estimates are indicative and based on average French market ratios. Actual costs depend on the contractor, site access and building condition."}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
