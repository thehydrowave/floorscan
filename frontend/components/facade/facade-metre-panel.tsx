"use client";

/**
 * FacadeMetrePanel — Surface calculation panel (metre) for facade analysis.
 * Table of all surface types with computed values + ratio pleins/vides.
 * Export button copies data to clipboard.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Ruler, ChevronDown, ChevronUp, AlertTriangle, ClipboardCopy, Check } from "lucide-react";
import { FacadeAnalysisResult } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/* ── Types ── */
interface MetreLine {
  label: string;
  value: string;
  numericValue: number;
  unit: string;
  color: string;
  highlight?: boolean;
}

interface FacadeMetrePanelProps {
  result: FacadeAnalysisResult;
}

export default function FacadeMetrePanel({ result }: FacadeMetrePanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const isFr = lang === "fr";

  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasArea = result.facade_area_m2 != null && result.facade_area_m2 > 0;

  const lines = useMemo<MetreLine[]>(() => {
    if (!hasArea) return [];

    const facadeArea   = result.facade_area_m2!;
    const openingsArea = result.openings_area_m2 ?? 0;
    const wallArea     = Math.max(0, facadeArea - openingsArea);
    const ratio        = result.ratio_openings ?? (facadeArea > 0 ? openingsArea / facadeArea : 0);
    const winCount     = result.windows_count;
    const doorCount    = result.doors_count;
    const balcCount    = result.balconies_count;

    // Compute window and door areas from elements
    const windowElements = result.elements.filter(e => e.type === "window");
    const doorElements   = result.elements.filter(e => e.type === "door");
    const balcElements   = result.elements.filter(e => e.type === "balcony");

    const windowArea = windowElements.reduce((s, e) => s + (e.area_m2 ?? 0), 0);
    const doorArea   = doorElements.reduce((s, e) => s + (e.area_m2 ?? 0), 0);
    const balcArea   = balcElements.reduce((s, e) => s + (e.area_m2 ?? 0), 0);

    // If individual areas are 0 but we have total openingsArea, distribute proportionally
    const computedWindowArea = windowArea > 0 ? windowArea : (winCount > 0 && openingsArea > 0
      ? openingsArea * winCount / (winCount + doorCount + balcCount || 1) : 0);
    const computedDoorArea = doorArea > 0 ? doorArea : (doorCount > 0 && openingsArea > 0
      ? openingsArea * doorCount / (winCount + doorCount + balcCount || 1) : 0);
    const computedBalcArea = balcArea > 0 ? balcArea : (balcCount > 0 && openingsArea > 0
      ? openingsArea * balcCount / (winCount + doorCount + balcCount || 1) : 0);

    const solidRatio = facadeArea > 0 ? (wallArea / facadeArea) * 100 : 0;
    const voidRatio  = facadeArea > 0 ? (openingsArea / facadeArea) * 100 : 0;

    return [
      {
        label: isFr ? "Surface totale facade" : "Total facade area",
        value: facadeArea.toFixed(1),
        numericValue: facadeArea,
        unit: "m2",
        color: "#f59e0b",
        highlight: true,
      },
      {
        label: isFr ? "Surface murale (pleins)" : "Wall surface (solid)",
        value: wallArea.toFixed(1),
        numericValue: wallArea,
        unit: "m2",
        color: "#94a3b8",
      },
      {
        label: isFr ? "Surface vitree (fenetres)" : "Glazed surface (windows)",
        value: computedWindowArea > 0 ? computedWindowArea.toFixed(1) : "—",
        numericValue: computedWindowArea,
        unit: computedWindowArea > 0 ? "m2" : "",
        color: "#60a5fa",
      },
      {
        label: isFr ? "Surface portes" : "Door surface",
        value: computedDoorArea > 0 ? computedDoorArea.toFixed(1) : "—",
        numericValue: computedDoorArea,
        unit: computedDoorArea > 0 ? "m2" : "",
        color: "#f472b6",
      },
      {
        label: isFr ? "Surface balcons" : "Balcony surface",
        value: computedBalcArea > 0 ? computedBalcArea.toFixed(1) : "—",
        numericValue: computedBalcArea,
        unit: computedBalcArea > 0 ? "m2" : "",
        color: "#34d399",
      },
      {
        label: isFr ? "Surface ouvertures totale" : "Total openings area",
        value: openingsArea.toFixed(1),
        numericValue: openingsArea,
        unit: "m2",
        color: "#a78bfa",
      },
      {
        label: isFr ? "Ratio pleins / vides" : "Solid / void ratio",
        value: `${solidRatio.toFixed(1)}% / ${voidRatio.toFixed(1)}%`,
        numericValue: ratio * 100,
        unit: "",
        color: ratio > 0.3 ? "#fb923c" : "#34d399",
        highlight: true,
      },
    ];
  }, [result, hasArea, isFr]);

  /* ── Counts summary ── */
  const counts = useMemo(() => {
    if (!hasArea) return null;
    return {
      windows: result.windows_count,
      doors: result.doors_count,
      balconies: result.balconies_count,
      floors: result.floors_count,
    };
  }, [result, hasArea]);

  async function copyToClipboard() {
    if (lines.length === 0) return;

    const header = isFr ? "FloorScan — Metre facade" : "FloorScan — Facade metre";
    const separator = "—".repeat(40);
    const rows = lines.map(l => `${l.label}: ${l.value} ${l.unit}`.trim());

    const countLines = counts ? [
      "",
      separator,
      isFr ? "Comptages :" : "Counts:",
      isFr ? `  Fenetres : ${counts.windows}` : `  Windows: ${counts.windows}`,
      isFr ? `  Portes : ${counts.doors}` : `  Doors: ${counts.doors}`,
      isFr ? `  Balcons : ${counts.balconies}` : `  Balconies: ${counts.balconies}`,
      isFr ? `  Niveaux : ${counts.floors}` : `  Floors: ${counts.floors}`,
    ] : [];

    const text = [header, separator, ...rows, ...countLines, "", separator, `Export: ${new Date().toLocaleString()}`].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex items-center justify-between w-full p-5 cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Ruler className="w-5 h-5 text-emerald-400" />
          <div className="text-left">
            <span className="text-white font-semibold">{d("fametre_title" as DTKey)}</span>
            <span className="block text-xs text-slate-400">{d("fametre_subtitle" as DTKey)}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!expanded && hasArea && result.facade_area_m2 != null && (
            <span className="text-xs font-mono text-emerald-400 mr-1">{result.facade_area_m2.toFixed(1)} m2</span>
          )}
          {expanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="fametre-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {!hasArea ? (
              <div className="flex items-center gap-3 px-5 py-6 text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="text-sm">{d("fametre_no_data" as DTKey)}</span>
              </div>
            ) : (
              <div className="pb-5 space-y-4">
                {/* Counts badges */}
                {counts && (
                  <div className="px-5 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
                      <span className="font-mono font-bold">{counts.windows}</span>
                      {isFr ? "fenetre(s)" : "window(s)"}
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-pink-500/10 border border-pink-500/20 text-xs text-pink-300">
                      <span className="font-mono font-bold">{counts.doors}</span>
                      {isFr ? "porte(s)" : "door(s)"}
                    </span>
                    {counts.balconies > 0 && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
                        <span className="font-mono font-bold">{counts.balconies}</span>
                        {isFr ? "balcon(s)" : "balcony(ies)"}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-500/10 border border-slate-500/20 text-xs text-slate-300">
                      <span className="font-mono font-bold">{counts.floors}</span>
                      {isFr ? "niveau(x)" : "floor(s)"}
                    </span>
                  </div>
                )}

                {/* Surface table */}
                <div className="px-5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500 text-xs uppercase tracking-wider">
                        <th className="pb-2 font-medium">{isFr ? "Designation" : "Designation"}</th>
                        <th className="pb-2 font-medium text-right">{isFr ? "Valeur" : "Value"}</th>
                        <th className="pb-2 font-medium text-right">{isFr ? "Unite" : "Unit"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, i) => (
                        <tr
                          key={i}
                          className={cn(
                            "border-b border-white/5 transition-colors",
                            line.highlight ? "bg-white/3" : "hover:bg-white/5"
                          )}
                        >
                          <td className="py-2.5 text-slate-300 flex items-center gap-2">
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: line.color }}
                            />
                            <span className={cn(line.highlight && "font-semibold text-white")}>
                              {line.label}
                            </span>
                          </td>
                          <td className={cn(
                            "py-2.5 text-right font-mono",
                            line.highlight ? "font-bold text-white text-base" : "font-semibold text-slate-200"
                          )}>
                            {line.value}
                          </td>
                          <td className="py-2.5 text-right text-slate-500 text-xs">
                            {line.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Ratio visual bar */}
                {hasArea && result.facade_area_m2! > 0 && (
                  <div className="px-5">
                    <div className="text-xs text-slate-500 mb-1.5">{isFr ? "Repartition pleins / vides" : "Solid / void breakdown"}</div>
                    <div className="h-4 rounded-full overflow-hidden flex bg-white/5">
                      <div
                        className="h-full transition-all duration-500"
                        style={{
                          width: `${Math.max(0, 100 - (result.ratio_openings ?? 0) * 100)}%`,
                          backgroundColor: "#94a3b8",
                          opacity: 0.6,
                        }}
                      />
                      <div
                        className="h-full transition-all duration-500"
                        style={{
                          width: `${(result.ratio_openings ?? 0) * 100}%`,
                          backgroundColor: "#60a5fa",
                          opacity: 0.7,
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-xs mt-1">
                      <span className="text-slate-500">
                        {isFr ? "Pleins" : "Solid"} {(100 - (result.ratio_openings ?? 0) * 100).toFixed(0)}%
                      </span>
                      <span className="text-blue-400">
                        {isFr ? "Vides" : "Voids"} {((result.ratio_openings ?? 0) * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                )}

                {/* Export button */}
                <div className="px-5">
                  <button
                    type="button"
                    onClick={copyToClipboard}
                    className="flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    {copied
                      ? <><Check className="w-4 h-4" /> {isFr ? "Copie !" : "Copied!"}</>
                      : <><ClipboardCopy className="w-4 h-4" /> {d("fametre_export" as DTKey)}</>
                    }
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
