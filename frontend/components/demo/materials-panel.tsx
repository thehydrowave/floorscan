"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Package, ChevronDown, ChevronUp, Download, AlertTriangle } from "lucide-react";
import { AnalysisResult, CustomDetection, MaterialLine } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface MaterialsPanelProps {
  result: AnalysisResult;
  customDetections?: CustomDetection[];
}

export default function MaterialsPanel({ result, customDetections = [] }: MaterialsPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [expanded, setExpanded] = useState(false);
  const [ceilingHeight, setCeilingHeight] = useState(2.5);
  const [wastePct, setWastePct] = useState(10);
  const [paintCoverage, setPaintCoverage] = useState(10);
  const [paintPotSize, setPaintPotSize] = useState(2.5);

  // ── Core material calculations ──────────────────────────────────────────────
  const lines = useMemo<MaterialLine[]>(() => {
    const ppm = result.pixels_per_meter;
    if (!ppm) return [];

    const perimInterior = result.surfaces?.perim_interior_m ?? 0;
    const areaHab = result.surfaces?.area_hab_m2 ?? 0;

    // Paint: (interior perimeter x ceiling height) - openings area
    const openingsArea =
      result.openings
        ?.filter((o) => o.width_m && o.height_m)
        .reduce((s, o) => s + o.width_m! * o.height_m!, 0) ?? 0;
    const paintableArea = Math.max(0, perimInterior * ceilingHeight - openingsArea);
    const paintLiters = paintableArea / paintCoverage;
    const paintPots = Math.ceil(paintLiters / paintPotSize);

    // Baseboards: perimeter - opening widths
    const openingsWidth =
      result.openings?.reduce((s, o) => s + (o.width_m ?? o.length_m ?? 0), 0) ?? 0;
    const plinthes = Math.max(0, perimInterior - openingsWidth);

    // Flooring: habitable area + waste
    const flooring = areaHab * (1 + wastePct / 100);

    // Electrical (NF C 15-100)
    const rooms = result.rooms ?? [];
    let prises = 0;
    rooms.forEach((r) => {
      const t = r.type?.toLowerCase() ?? "";
      if (t.includes("living")) prises += 5;
      else if (t.includes("kitchen") || t.includes("cuisine")) prises += 6;
      else if (t.includes("bedroom") || t.includes("chambre")) prises += 3;
      else if (t.includes("bathroom") || t.includes("salle")) prises += 2;
      else if (t.includes("wc") || t.includes("toilet")) prises += 1;
      else prises += 1;
    });
    if (prises === 0) prises = Math.max(rooms.length, 1);
    const interrupteurs = Math.max(rooms.length, 1);

    const out: MaterialLine[] = [
      {
        material: "mat_paint_wall",
        quantity: Math.round(paintableArea * 10) / 10,
        unit: "m\u00B2",
        detail: `\u2248 ${paintPots} ${d("mat_pots")} (${paintPotSize}L)`,
      },
      {
        material: "mat_plinthes",
        quantity: Math.round(plinthes * 10) / 10,
        unit: "ml",
      },
      {
        material: "mat_flooring",
        quantity: Math.round(flooring * 10) / 10,
        unit: "m\u00B2",
        detail: `+${wastePct}% chute`,
      },
      {
        material: "mat_prises",
        quantity: prises,
        unit: "pcs",
        detail: d("mat_nfc"),
      },
      {
        material: "mat_interrupteurs",
        quantity: interrupteurs,
        unit: "pcs",
      },
      {
        material: "mat_doors_int",
        quantity: result.doors_count,
        unit: "pcs",
      },
      {
        material: "mat_windows_est",
        quantity: result.windows_count,
        unit: "pcs",
      },
    ];
    return out;
  }, [result, ceilingHeight, wastePct, paintCoverage, paintPotSize, d]);

  // ── CSV export ──────────────────────────────────────────────────────────────
  function exportCSV() {
    const header = "Material;Quantity;Unit;Notes\n";
    const rows = lines
      .map(
        (l) =>
          `${d(l.material as DTKey)};${l.quantity};${l.unit};${l.detail ?? ""}`
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "estimation_materiaux.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden">
      {/* Header - toggle expand */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between w-full p-5 cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Package className="w-5 h-5 text-accent" />
          <div className="text-left">
            <span className="text-white font-semibold">{d("mat_title")}</span>
            <span className="block text-xs text-slate-400">
              {d("mat_subtitle")}
            </span>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-slate-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-slate-400" />
        )}
      </button>

      {/* Expandable content */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="materials-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {!result.pixels_per_meter ? (
              /* No scale warning */
              <div className="flex items-center gap-3 p-5 pt-0 text-amber-400">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span className="text-sm">{d("mat_no_scale")}</span>
              </div>
            ) : (
              <div className="space-y-4 pb-5">
                {/* Parameters row */}
                <div className="grid grid-cols-3 gap-4 px-5 pt-0">
                  {/* Ceiling height */}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      {d("mat_height")}
                    </label>
                    <input
                      type="number"
                      step={0.1}
                      min={2.0}
                      max={5.0}
                      value={ceilingHeight}
                      onChange={(e) => setCeilingHeight(parseFloat(e.target.value) || 2.5)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>

                  {/* Waste % */}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      {d("mat_waste")}
                    </label>
                    <input
                      type="number"
                      step={5}
                      min={0}
                      max={30}
                      value={wastePct}
                      onChange={(e) => setWastePct(parseInt(e.target.value, 10) || 10)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>

                  {/* Paint coverage */}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      {d("mat_paint_cov")}
                    </label>
                    <input
                      type="number"
                      step={1}
                      min={5}
                      max={20}
                      value={paintCoverage}
                      onChange={(e) => setPaintCoverage(parseInt(e.target.value, 10) || 10)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>

                {/* Materials table */}
                <div className="px-5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500 text-xs uppercase tracking-wider">
                        <th className="pb-2 font-medium">{d("mat_material")}</th>
                        <th className="pb-2 font-medium text-right">{d("mat_quantity")}</th>
                        <th className="pb-2 font-medium text-right">{d("mat_unit")}</th>
                        <th className="pb-2 font-medium text-right">{d("mat_note")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, i) => (
                        <tr
                          key={i}
                          className="border-b border-white/5 hover:bg-white/5 transition-colors"
                        >
                          <td className="py-2 text-slate-300">
                            {d(line.material as DTKey)}
                          </td>
                          <td className="py-2 text-right font-bold text-white">
                            {line.quantity}
                          </td>
                          <td className="py-2 text-right text-slate-400">
                            {line.unit}
                          </td>
                          <td className="py-2 text-right text-slate-500 text-xs">
                            {line.detail ?? ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Export button */}
                <div className="px-5">
                  <button
                    type="button"
                    onClick={exportCSV}
                    className={cn(
                      "flex items-center gap-2 text-sm text-accent hover:text-white transition-colors"
                    )}
                  >
                    <Download className="w-4 h-4" />
                    {d("mat_export_csv")}
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
