"use client";

/**
 * FacadeMaterialsPanel — Estimation des matériaux de ravalement façade.
 * Calcule : surface murale nette, peinture façade, menuiseries, garde-corps, ITE.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Package, ChevronDown, ChevronUp, Download, AlertTriangle } from "lucide-react";
import { FacadeAnalysisResult } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface MaterialLine {
  label: string;
  quantity: number;
  unit: string;
  note?: string;
  color?: string;
}

interface FacadeMaterialsPanelProps {
  result: FacadeAnalysisResult;
}

export default function FacadeMaterialsPanel({ result }: FacadeMaterialsPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [expanded, setExpanded] = useState(false);
  const [floorH, setFloorH] = useState(2.8);
  const [paintCov, setPaintCov] = useState(8); // m²/L for facade paint
  const [wastePct, setWastePct] = useState(10);

  const hasArea = result.facade_area_m2 != null && result.facade_area_m2 > 0;

  const lines = useMemo<MaterialLine[]>(() => {
    if (!hasArea) return [];

    const facadeArea = result.facade_area_m2!;
    const openingsArea = result.openings_area_m2 ?? 0;
    const wallArea = Math.max(0, facadeArea - openingsArea);
    const wallWithWaste = wallArea * (1 + wastePct / 100);

    // Menuiseries
    const windowCount = result.windows_count;
    const doorCount   = result.doors_count;
    const balconyCount = result.balconies_count;

    // Balcony railing: estimate 2× balcony width perimeter
    const balconies = result.elements.filter(e => e.type === "balcony");
    const totalBalconyPerim = balconies.reduce((s, e) => {
      // Use bbox proportional width if no exact dims
      const bw = e.bbox_norm.w * (result.pixels_per_meter ? 1 : 1); // normalized
      // Approximate: balcony perimeter ≈ 3× width (front + 2 sides)
      return s + (e.area_m2 ?? 0) / (floorH * 0.4) * 3;
    }, 0);
    const railingMl = balconies.length > 0
      ? Math.max(totalBalconyPerim, balconies.length * 3.5)
      : 0;

    // Paint liters
    const paintLiters = wallWithWaste / paintCov;
    const paintPots10L = Math.ceil(paintLiters / 10);

    return [
      {
        label: d("fam_wall_area" as DTKey),
        quantity: Math.round(wallArea * 10) / 10,
        unit: "m²",
        color: "#64748b",
      },
      {
        label: d("fam_paint_facade" as DTKey),
        quantity: Math.round(wallWithWaste * 10) / 10,
        unit: "m²",
        note: `≈ ${paintPots10L} pots 10L (${paintCov} m²/L)`,
        color: "#f59e0b",
      },
      {
        label: d("fam_menuiseries_win" as DTKey),
        quantity: windowCount,
        unit: "u.",
        note: lang === "fr" ? "Remplacement / rénovation" : "Replacement / renovation",
        color: "#60a5fa",
      },
      {
        label: d("fam_menuiseries_door" as DTKey),
        quantity: doorCount,
        unit: "u.",
        color: "#f472b6",
      },
      ...(balconyCount > 0 ? [{
        label: d("fam_balcony_rail" as DTKey),
        quantity: Math.round(railingMl * 10) / 10,
        unit: "ml",
        note: `${balconyCount} balcon${balconyCount > 1 ? "s" : ""}`,
        color: "#34d399",
      }] : []),
      {
        label: d("fam_ite" as DTKey),
        quantity: Math.round(wallWithWaste * 10) / 10,
        unit: "m²",
        note: lang === "fr" ? "si isolation par l'ext." : "if external insulation",
        color: "#a78bfa",
      },
    ];
  }, [result, floorH, paintCov, wastePct, hasArea, lang, d]);

  function exportCSV() {
    const BOM = "\uFEFF";
    const header = `${d("fam_material" as DTKey)};${d("fam_qty" as DTKey)};${d("fam_unit" as DTKey)};${d("fam_note" as DTKey)}\n`;
    const rows = lines.map(l => `${l.label};${l.quantity};${l.unit};${l.note ?? ""}`).join("\n");
    const blob = new Blob([BOM + header + rows], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "facade_materiaux.csv";
    a.click();
    URL.revokeObjectURL(a.href);
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
          <Package className="w-5 h-5 text-amber-400" />
          <div className="text-left">
            <span className="text-white font-semibold">{d("fam_title" as DTKey)}</span>
            <span className="block text-xs text-slate-400">{d("fam_subtitle" as DTKey)}</span>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="fam-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {!hasArea ? (
              <div className="flex items-center gap-3 px-5 py-6 text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="text-sm">{d("fam_no_data" as DTKey)}</span>
              </div>
            ) : (
              <div className="space-y-4 pb-5">
                {/* Parameters */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 px-5 pt-0">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">{d("fam_floor_h" as DTKey)}</label>
                    <input
                      type="number" step={0.1} min={2} max={6}
                      value={floorH}
                      onChange={e => setFloorH(parseFloat(e.target.value) || 2.8)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">{d("fam_paint_cov" as DTKey)}</label>
                    <input
                      type="number" step={1} min={4} max={20}
                      value={paintCov}
                      onChange={e => setPaintCov(parseInt(e.target.value, 10) || 8)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Chute (%)</label>
                    <input
                      type="number" step={5} min={0} max={30}
                      value={wastePct}
                      onChange={e => setWastePct(parseInt(e.target.value, 10) || 10)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                </div>

                {/* Materials table */}
                <div className="px-5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500 text-xs uppercase tracking-wider">
                        <th className="pb-2 font-medium">{d("fam_material" as DTKey)}</th>
                        <th className="pb-2 font-medium text-right">{d("fam_qty" as DTKey)}</th>
                        <th className="pb-2 font-medium text-right">{d("fam_unit" as DTKey)}</th>
                        <th className="pb-2 font-medium text-right hidden sm:table-cell">{d("fam_note" as DTKey)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, i) => (
                        <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="py-2 text-slate-300 flex items-center gap-2">
                            {line.color && (
                              <span className="inline-block w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: line.color }} />
                            )}
                            {line.label}
                          </td>
                          <td className="py-2 text-right font-bold text-white">{line.quantity}</td>
                          <td className="py-2 text-right text-slate-400">{line.unit}</td>
                          <td className="py-2 text-right text-slate-500 text-xs hidden sm:table-cell">{line.note ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Export */}
                <div className="px-5">
                  <button
                    type="button"
                    onClick={exportCSV}
                    className="flex items-center gap-2 text-sm text-amber-400 hover:text-amber-300 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    {d("fam_export_csv" as DTKey)}
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
