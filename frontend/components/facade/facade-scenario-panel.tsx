"use client";

/**
 * FacadeScenarioPanel -- "What-if" scenario panel for facade renovation.
 * 3 presets: Ravalement simple, Ravalement + menuiseries, Renovation complete ITE.
 * Shows cost breakdown per scenario and a comparison table.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GitCompareArrows,
  ChevronDown,
  ChevronUp,
  Paintbrush,
  DoorOpen,
  Layers,
  AlertTriangle,
  Check,
} from "lucide-react";
import { FacadeAnalysisResult } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/* ---- Types ---- */
interface ScenarioPreset {
  id: string;
  label_fr: string;
  label_en: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  /** cost per m2 range (low, high) */
  range_per_m2: [number, number];
  includeWindows: boolean;
  includeDoors: boolean;
  includeIte: boolean;
}

interface ScenarioCostLine {
  label: string;
  costLo: number;
  costHi: number;
}

interface ScenarioResult {
  preset: ScenarioPreset;
  lines: ScenarioCostLine[];
  totalLo: number;
  totalHi: number;
}

/* ---- Presets ---- */
const PRESETS: ScenarioPreset[] = [
  {
    id: "simple",
    label_fr: "Ravalement simple",
    label_en: "Simple repaint",
    icon: Paintbrush,
    color: "#34d399",
    range_per_m2: [40, 60],
    includeWindows: false,
    includeDoors: false,
    includeIte: false,
  },
  {
    id: "menuiseries",
    label_fr: "Ravalement + menuiseries",
    label_en: "Repaint + openings",
    icon: DoorOpen,
    color: "#60a5fa",
    range_per_m2: [80, 120],
    includeWindows: true,
    includeDoors: true,
    includeIte: false,
  },
  {
    id: "complete",
    label_fr: "Renovation complete ITE",
    label_en: "Full ITE renovation",
    icon: Layers,
    color: "#a78bfa",
    range_per_m2: [150, 250],
    includeWindows: true,
    includeDoors: true,
    includeIte: true,
  },
];

/* ---- Props ---- */
interface FacadeScenarioPanelProps {
  result: FacadeAnalysisResult;
}

/* ---- Helpers ---- */
const fmtEur = (v: number) =>
  v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " \u20AC";

const fmtRange = (lo: number, hi: number) =>
  `${fmtEur(lo)} \u2013 ${fmtEur(hi)}`;

/* ---- Component ---- */
export default function FacadeScenarioPanel({ result }: FacadeScenarioPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const isFr = lang === "fr";

  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("simple");

  const hasArea = result.facade_area_m2 != null && result.facade_area_m2 > 0;

  /* ---- Build all scenarios ---- */
  const scenarios = useMemo<ScenarioResult[]>(() => {
    if (!hasArea) return [];

    const facadeArea = result.facade_area_m2!;
    const openingsArea = result.openings_area_m2 ?? 0;
    const solidArea = Math.max(0, facadeArea - openingsArea);
    const winCount = result.windows_count;
    const doorCount = result.doors_count;

    return PRESETS.map((preset) => {
      const lines: ScenarioCostLine[] = [];

      /* Scaffolding always included */
      lines.push({
        label: isFr ? "Echafaudage et protection" : "Scaffolding & protection",
        costLo: facadeArea * 12,
        costHi: facadeArea * 18,
      });

      /* Cleaning / preparation */
      lines.push({
        label: isFr ? "Nettoyage et preparation" : "Cleaning & preparation",
        costLo: facadeArea * 8,
        costHi: facadeArea * 14,
      });

      /* Ravalement / paint */
      lines.push({
        label: isFr ? "Ravalement / peinture facade" : "Facade render / paint",
        costLo: solidArea * 20,
        costHi: solidArea * 35,
      });

      /* Windows */
      if (preset.includeWindows && winCount > 0) {
        lines.push({
          label: isFr
            ? `Remplacement fenetres (\u00D7${winCount})`
            : `Window replacement (\u00D7${winCount})`,
          costLo: winCount * 450,
          costHi: winCount * 800,
        });
      }

      /* Doors */
      if (preset.includeDoors && doorCount > 0) {
        lines.push({
          label: isFr
            ? `Remplacement portes (\u00D7${doorCount})`
            : `Door replacement (\u00D7${doorCount})`,
          costLo: doorCount * 600,
          costHi: doorCount * 1500,
        });
      }

      /* ITE */
      if (preset.includeIte) {
        lines.push({
          label: isFr ? "ITE (isolation 14 cm + finition)" : "ITE (14cm insulation + render)",
          costLo: solidArea * 80,
          costHi: solidArea * 140,
        });
      }

      const totalLo = lines.reduce((s, l) => s + l.costLo, 0);
      const totalHi = lines.reduce((s, l) => s + l.costHi, 0);

      return { preset, lines, totalLo, totalHi };
    });
  }, [result, hasArea, isFr]);

  const selected = scenarios.find((s) => s.preset.id === selectedId) ?? scenarios[0];

  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between w-full p-5 cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <GitCompareArrows className="w-5 h-5 text-violet-400" />
          <div className="text-left">
            <span className="text-white font-semibold">
              {isFr ? "Scenarios de renovation" : "Renovation Scenarios"}
            </span>
            <span className="block text-xs text-slate-400">
              {isFr ? "Comparez 3 niveaux d'intervention" : "Compare 3 intervention levels"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-semibold tracking-wide uppercase">
            {isFr ? "Comparateur" : "Comparator"}
          </span>
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
            key="fascn-content"
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
                {/* Scenario selector buttons */}
                <div className="px-5 flex flex-wrap gap-2">
                  {PRESETS.map((p) => {
                    const Icon = p.icon;
                    const active = p.id === selectedId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className={cn(
                          "relative flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all",
                          active
                            ? "bg-current/10 text-white"
                            : "border-slate-600/50 text-slate-500 hover:text-slate-300"
                        )}
                        style={
                          active
                            ? { borderColor: p.color, color: p.color }
                            : undefined
                        }
                      >
                        <Icon className="w-4 h-4" />
                        <span className="font-medium">
                          {isFr ? p.label_fr : p.label_en}
                        </span>
                        {active && <Check className="w-3 h-3" />}
                      </button>
                    );
                  })}
                </div>

                {/* Cost breakdown for selected scenario */}
                {selected && (
                  <div className="px-5 space-y-2">
                    <h4
                      className="text-xs font-semibold uppercase tracking-wider"
                      style={{ color: selected.preset.color }}
                    >
                      {isFr ? "Detail des couts" : "Cost breakdown"}
                    </h4>
                    <div className="space-y-1.5">
                      {selected.lines.map((line, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5"
                        >
                          <span className="text-slate-300">{line.label}</span>
                          <span className="font-mono text-white text-xs">
                            {fmtRange(line.costLo, line.costHi)}
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Selected total */}
                    <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-white/10 bg-white/[0.04]">
                      <span className="text-sm font-semibold text-white">
                        {isFr ? "Total HT" : "Total excl. tax"}
                      </span>
                      <span
                        className="font-display font-bold text-lg"
                        style={{ color: selected.preset.color }}
                      >
                        {fmtRange(selected.totalLo, selected.totalHi)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Comparison table */}
                <div className="px-5">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    {isFr ? "Comparaison des scenarios" : "Scenario comparison"}
                  </h4>
                  <div className="overflow-x-auto -mx-5 px-5">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-700/50">
                          <th className="text-left py-2 text-slate-400 font-medium">
                            {isFr ? "Scenario" : "Scenario"}
                          </th>
                          <th className="text-right py-2 text-slate-400 font-medium px-2">
                            {isFr ? "Fourchette basse" : "Low estimate"}
                          </th>
                          <th className="text-right py-2 text-slate-400 font-medium px-2">
                            {isFr ? "Fourchette haute" : "High estimate"}
                          </th>
                          <th className="text-right py-2 text-slate-400 font-medium px-2">
                            \u20AC/m\u00B2
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {scenarios.map((sc) => {
                          const facadeArea = result.facade_area_m2!;
                          const perM2Lo = facadeArea > 0 ? sc.totalLo / facadeArea : 0;
                          const perM2Hi = facadeArea > 0 ? sc.totalHi / facadeArea : 0;
                          const isActive = sc.preset.id === selectedId;
                          return (
                            <tr
                              key={sc.preset.id}
                              className={cn(
                                "border-b border-white/5 cursor-pointer transition-colors",
                                isActive
                                  ? "bg-white/[0.04]"
                                  : "hover:bg-white/[0.02]"
                              )}
                              onClick={() => setSelectedId(sc.preset.id)}
                            >
                              <td className="py-2.5">
                                <div className="flex items-center gap-2">
                                  <span
                                    className="inline-block w-2 h-2 rounded-full shrink-0"
                                    style={{ backgroundColor: sc.preset.color }}
                                  />
                                  <span
                                    className={cn(
                                      "font-medium",
                                      isActive ? "text-white" : "text-slate-300"
                                    )}
                                  >
                                    {isFr ? sc.preset.label_fr : sc.preset.label_en}
                                  </span>
                                </div>
                              </td>
                              <td className="py-2.5 text-right font-mono px-2 text-slate-300">
                                {fmtEur(sc.totalLo)}
                              </td>
                              <td className="py-2.5 text-right font-mono px-2 text-white font-semibold">
                                {fmtEur(sc.totalHi)}
                              </td>
                              <td className="py-2.5 text-right font-mono px-2 text-slate-400">
                                {perM2Lo.toFixed(0)}\u2013{perM2Hi.toFixed(0)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Visual bars */}
                <div className="px-5 space-y-2">
                  {scenarios.map((sc) => {
                    const maxVal =
                      scenarios.length > 0
                        ? Math.max(...scenarios.map((s) => s.totalHi))
                        : 1;
                    const pctLo =
                      maxVal > 0 ? (sc.totalLo / maxVal) * 100 : 0;
                    const pctHi =
                      maxVal > 0 ? (sc.totalHi / maxVal) * 100 : 0;
                    return (
                      <div key={sc.preset.id} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span
                            className="font-medium"
                            style={{ color: sc.preset.color }}
                          >
                            {isFr ? sc.preset.label_fr : sc.preset.label_en}
                          </span>
                          <span className="font-mono text-white">
                            {fmtRange(sc.totalLo, sc.totalHi)}
                          </span>
                        </div>
                        <div className="h-3 rounded-full bg-slate-700/50 overflow-hidden relative">
                          {/* low range */}
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.max(pctLo, 2)}%` }}
                            transition={{ duration: 0.6 }}
                            className="h-full rounded-full absolute top-0 left-0 opacity-40"
                            style={{ backgroundColor: sc.preset.color }}
                          />
                          {/* high range */}
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.max(pctHi, 3)}%` }}
                            transition={{ duration: 0.6 }}
                            className="h-full rounded-full absolute top-0 left-0 opacity-70"
                            style={{ backgroundColor: sc.preset.color }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Disclaimer */}
                <div className="mx-5 p-3 rounded-lg bg-white/[0.02] border border-white/5 text-xs text-slate-500 leading-relaxed">
                  {isFr
                    ? "Les fourchettes de prix sont basees sur les moyennes du marche francais 2024. Les couts reels varient selon la region, l'accessibilite et l'etat du bati."
                    : "Price ranges are based on 2024 French market averages. Actual costs vary by region, accessibility and building condition."}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
