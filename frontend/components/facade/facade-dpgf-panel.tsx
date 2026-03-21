"use client";

/**
 * FacadeDpgfPanel — DPGF Ravalement façade.
 * 5 lots : Préparation, Réparation/Enduit, Peinture/Finition, Menuiseries, ITE.
 * Prix au m² typiques du marché français (BTP 2024).
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Receipt, ChevronDown, ChevronUp, Download, AlertTriangle } from "lucide-react";
import { FacadeAnalysisResult } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/* ── Types ── */
interface DpgfItem {
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  totalHt: number;
}

interface DpgfLot {
  number: number;
  title: string;
  icon: string;
  color: string;
  items: DpgfItem[];
  subtotalHt: number;
}

interface FacadeDpgfPanelProps {
  result: FacadeAnalysisResult;
}

const TVA_RATE = 10; // TVA taux réduit travaux rénovation

function fmtEur(n: number) {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

export default function FacadeDpgfPanel({ result }: FacadeDpgfPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [expanded, setExpanded] = useState(false);
  const [openLots, setOpenLots] = useState<Set<number>>(new Set([1, 2, 3]));
  const [includeIte, setIncludeIte] = useState(false);

  const toggleLot = (n: number) =>
    setOpenLots(prev => { const s = new Set(prev); s.has(n) ? s.delete(n) : s.add(n); return s; });

  const hasArea = result.facade_area_m2 != null && result.facade_area_m2 > 0;

  const { lots, totalHt, tvaAmount, totalTtc } = useMemo(() => {
    if (!hasArea) return { lots: [], totalHt: 0, tvaAmount: 0, totalTtc: 0 };

    const facadeArea   = result.facade_area_m2!;
    const openingsArea = result.openings_area_m2 ?? 0;
    const wallArea     = Math.max(0, facadeArea - openingsArea);
    const winCount     = result.windows_count;
    const doorCount    = result.doors_count;
    const balcCount    = result.balconies_count;

    const item = (description: string, qty: number, unit: string, unitPrice: number): DpgfItem => ({
      description,
      qty: Math.round(qty * 10) / 10,
      unit,
      unitPrice,
      totalHt: Math.round(qty * unitPrice),
    });

    const isEn = lang === "en";

    const lot1Items: DpgfItem[] = [
      item(isEn ? "Facade cleaning (high-pressure or chemical)"  : "Nettoyage façade (HP ou chimique)",   facadeArea, "m²", 12),
      item(isEn ? "Scaffolding installation and removal"         : "Mise en place et démontage échafaudages", wallArea * 0.3, "ml", 18),
      item(isEn ? "Protection of surroundings"                   : "Protection des abords et sols", 1, "forf.", 350),
    ];

    const lot2Items: DpgfItem[] = [
      item(isEn ? "Crack repair and fissure treatment"           : "Rebouchage des fissures et reprises", wallArea * 0.05, "m²", 85),
      item(isEn ? "Siding / exterior render"                     : "Ravalement / enduit minéral extérieur", wallArea, "m²", 35),
      item(isEn ? "Corner bead and edge treatment"               : "Pose de baguettes d'angles et retours", wallArea * 0.04, "ml", 12),
    ];

    const lot3Items: DpgfItem[] = [
      item(isEn ? "Facade paint — 2 coats"                       : "Peinture façade 2 couches", wallArea, "m²", 22),
      item(isEn ? "Window surround painting"                     : "Peinture des encadrements de fenêtres", winCount * 1.2, "u.", 65),
      ...(balcCount > 0 ? [item(isEn ? "Balcony soffits and floors" : "Plafonds et sols des balcons", balcCount * 4, "m²", 45)] : []),
    ];

    const lot4Items: DpgfItem[] = [
      ...(winCount > 0 ? [item(isEn ? "PVC/ALU windows (double glazing)" : "Fenêtres PVC/ALU double vitrage",  winCount,   "u.", 650)] : []),
      ...(doorCount > 0 ? [item(isEn ? "Entrance doors (exterior)"       : "Portes d'entrée extérieures",    doorCount, "u.", 1200)] : []),
      ...(balcCount > 0 ? [item(isEn ? "Balcony railing renovation"      : "Rénovation garde-corps balcons", balcCount, "u.", 480)] : []),
    ];

    const lot5Items: DpgfItem[] = includeIte ? [
      item(isEn ? "EPS insulation panels (14cm)"  : "Pose panneaux isolants EPS 14cm", wallArea, "m²", 80),
      item(isEn ? "Reinforcement mesh + adhesive" : "Treillis armature + colle", wallArea, "m²", 22),
      item(isEn ? "Finishing coat (mineral render)": "Enduit de finition (minéral)",    wallArea, "m²", 30),
      item(isEn ? "Connections and finishing"      : "Raccords et finitions ITE",       wallArea * 0.1, "m²", 45),
    ] : [];

    const makeLot = (number: number, title: string, icon: string, color: string, items: DpgfItem[]): DpgfLot => ({
      number, title, icon, color, items,
      subtotalHt: items.reduce((s, i) => s + i.totalHt, 0),
    });

    const allLots: DpgfLot[] = [
      makeLot(1, d("fadpgf_lot1" as DTKey), "🔧", "#fb923c", lot1Items),
      makeLot(2, d("fadpgf_lot2" as DTKey), "🏗️", "#f59e0b", lot2Items),
      makeLot(3, d("fadpgf_lot3" as DTKey), "🎨", "#34d399", lot3Items),
      makeLot(4, d("fadpgf_lot4" as DTKey), "🪟", "#60a5fa", lot4Items.filter(i => i.qty > 0)),
      ...(includeIte ? [makeLot(5, d("fadpgf_lot5" as DTKey), "🧱", "#a78bfa", lot5Items)] : []),
    ];

    const totalHt = allLots.reduce((s, l) => s + l.subtotalHt, 0);
    const tvaAmount = Math.round(totalHt * TVA_RATE / 100);
    const totalTtc = totalHt + tvaAmount;

    return { lots: allLots, totalHt, tvaAmount, totalTtc };
  }, [result, hasArea, includeIte, lang, d]);

  function exportCSV() {
    const BOM = "\uFEFF";
    const lines: string[] = [`# FloorScan — DPGF Ravalement façade`];
    lines.push(`Lot;Description;Qté;Unité;PU HT (€);Total HT (€)`);
    for (const lot of lots) {
      for (const item of lot.items) {
        lines.push(`${lot.number};${item.description};${item.qty};${item.unit};${item.unitPrice};${item.totalHt}`);
      }
      lines.push(`${lot.number};;;;;;${lot.subtotalHt} €`);
      lines.push("");
    }
    lines.push(`Total HT;;;;;;;${totalHt}`);
    lines.push(`TVA ${TVA_RATE}%;;;;;;;${tvaAmount}`);
    lines.push(`Total TTC;;;;;;;${totalTtc}`);
    const blob = new Blob([BOM + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dpgf_facade.csv";
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
          <Receipt className="w-5 h-5 text-amber-400" />
          <div className="text-left">
            <span className="text-white font-semibold">{d("fadpgf_title" as DTKey)}</span>
            <span className="block text-xs text-slate-400">{d("fadpgf_subtitle" as DTKey)}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!expanded && hasArea && totalTtc > 0 && (
            <span className="text-xs font-mono text-amber-400 mr-1">{fmtEur(totalTtc)} TTC</span>
          )}
          {expanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="fadpgf-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {!hasArea ? (
              <div className="flex items-center gap-3 px-5 py-6 text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="text-sm">{d("fadpgf_no_data" as DTKey)}</span>
              </div>
            ) : (
              <div className="pb-5">
                {/* ITE toggle */}
                <div className="px-5 py-3 border-t border-white/5 flex items-center gap-3">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <div
                      onClick={() => setIncludeIte(v => !v)}
                      className={cn(
                        "w-9 h-5 rounded-full transition-all duration-200 relative",
                        includeIte ? "bg-amber-500" : "bg-white/10"
                      )}>
                      <div className={cn(
                        "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-200",
                        includeIte ? "left-4" : "left-0.5"
                      )} />
                    </div>
                    <span className="text-xs text-slate-300">
                      {lang === "fr" ? "Inclure ITE (isolation thermique par l'ext.)" : "Include ITE (external thermal insulation)"}
                    </span>
                  </label>
                </div>

                {/* Lots */}
                {lots.map(lot => (
                  <div key={lot.number} className="border-t border-white/5">
                    <button
                      type="button"
                      onClick={() => toggleLot(lot.number)}
                      className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">{lot.icon}</span>
                        <span className="text-sm font-semibold text-slate-200">
                          Lot {lot.number} — {lot.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono" style={{ color: lot.color }}>
                          {fmtEur(lot.subtotalHt)}
                        </span>
                        {openLots.has(lot.number)
                          ? <ChevronUp className="w-4 h-4 text-slate-500" />
                          : <ChevronDown className="w-4 h-4 text-slate-500" />}
                      </div>
                    </button>

                    <AnimatePresence initial={false}>
                      {openLots.has(lot.number) && (
                        <motion.div
                          key={`lot-${lot.number}`}
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <table className="w-full text-xs mx-5" style={{ width: "calc(100% - 2.5rem)" }}>
                            <thead>
                              <tr className="text-slate-600 border-b border-white/5">
                                <th className="text-left py-1.5 pr-4 font-medium">Description</th>
                                <th className="text-right py-1.5 pr-3 font-medium">Qté</th>
                                <th className="text-right py-1.5 pr-3 font-medium">U.</th>
                                <th className="text-right py-1.5 pr-3 font-medium">PU HT</th>
                                <th className="text-right py-1.5 font-medium">Total HT</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lot.items.map((item, i) => (
                                <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                                  <td className="py-1.5 pr-4 text-slate-300">{item.description}</td>
                                  <td className="py-1.5 pr-3 text-right font-mono text-white">{item.qty}</td>
                                  <td className="py-1.5 pr-3 text-right text-slate-400">{item.unit}</td>
                                  <td className="py-1.5 pr-3 text-right text-slate-400">{item.unitPrice}€</td>
                                  <td className="py-1.5 text-right font-mono font-semibold" style={{ color: lot.color }}>
                                    {fmtEur(item.totalHt)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}

                {/* Totals */}
                <div className="mx-5 mt-5 border border-white/10 rounded-xl overflow-hidden">
                  <div className="flex justify-between px-4 py-2.5 text-sm border-b border-white/5">
                    <span className="text-slate-400">{d("fadpgf_total_ht" as DTKey)}</span>
                    <span className="font-mono font-semibold text-white">{fmtEur(totalHt)}</span>
                  </div>
                  <div className="flex justify-between px-4 py-2.5 text-sm border-b border-white/5">
                    <span className="text-slate-400">{d("fadpgf_tva" as DTKey)}</span>
                    <span className="font-mono text-slate-300">{fmtEur(tvaAmount)}</span>
                  </div>
                  <div className="flex justify-between px-4 py-3 bg-amber-500/10">
                    <span className="font-semibold text-amber-300">{d("fadpgf_total_ttc" as DTKey)}</span>
                    <span className="font-display font-700 text-xl text-amber-400">{fmtEur(totalTtc)}</span>
                  </div>
                </div>

                {/* Export */}
                <div className="px-5 mt-4">
                  <button
                    type="button"
                    onClick={exportCSV}
                    className="flex items-center gap-2 text-sm text-amber-400 hover:text-amber-300 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    {d("fadpgf_export" as DTKey)}
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
