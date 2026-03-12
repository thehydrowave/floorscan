"use client";

import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Download,
  Copy,
  Check,
  AlertTriangle,
} from "lucide-react";
import type { AnalysisResult, CustomDetection, DpgfState } from "@/lib/types";
import { buildDefaultDpgf } from "@/lib/dpgf-defaults";
import { CCTP_TEMPLATES, CctpLotTemplate } from "@/lib/cctp-templates";
import { downloadCctpPdf } from "@/lib/cctp-pdf";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

// ── Props ───────────────────────────────────────────────────────────────────────

interface CctpPanelProps {
  result: AnalysisResult;
  customDetections?: CustomDetection[];
}

// ── Component ───────────────────────────────────────────────────────────────────

export default function CctpPanel({
  result,
  customDetections = [],
}: CctpPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  // ── State ─────────────────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState(false);
  const [expandedLots, setExpandedLots] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  // ── Build DPGF to get quantities ──────────────────────────────────────────────
  const dpgf = useMemo<DpgfState>(
    () => buildDefaultDpgf(result, customDetections, { ceilingHeight: 2.5 }),
    [result, customDetections]
  );

  // ── Build CCTP lots with quantities ───────────────────────────────────────────
  const cctpLots = useMemo(() => {
    return CCTP_TEMPLATES.map((tpl) => {
      const dpgfLot = dpgf.lots.find((l) => l.lot_number === tpl.lot_number);
      // Filter items that have quantity > 0 in the DPGF
      const dpgfKeys = new Set(
        (dpgfLot?.items ?? [])
          .filter((i) => i.quantity > 0)
          .map((i) => i.description_key)
      );
      const activeItems = tpl.items.filter((it) => dpgfKeys.has(it.dpgf_key));
      return {
        ...tpl,
        items: activeItems,
        hasContent: activeItems.length > 0,
      };
    }).filter((l) => l.hasContent);
  }, [dpgf]);

  // ── Lot toggle ────────────────────────────────────────────────────────────────
  function toggleLot(lotNumber: number) {
    setExpandedLots((prev) => {
      const next = new Set(prev);
      if (next.has(lotNumber)) next.delete(lotNumber);
      else next.add(lotNumber);
      return next;
    });
  }

  // ── Build plain text for copy ─────────────────────────────────────────────────
  const buildPlainText = useCallback(() => {
    const lines: string[] = [];
    lines.push("CCTP — " + d("cctp_title" as DTKey));
    lines.push("=" .repeat(60));
    lines.push("");

    for (const lot of cctpLots) {
      const dpgfLot = dpgf.lots.find((l) => l.lot_number === lot.lot_number);
      lines.push(`LOT ${lot.lot_number} — ${d((dpgfLot?.title_key ?? ("dpgf_lot" + lot.lot_number)) as DTKey)}`);
      lines.push("-".repeat(50));
      lines.push(d(lot.intro_key as DTKey));
      lines.push("");

      for (const item of lot.items) {
        const dpgfItem = dpgfLot?.items.find(
          (i) => i.description_key === item.dpgf_key
        );
        lines.push(`  ▸ ${d(item.title_key as DTKey)}${dpgfItem ? ` (${dpgfItem.quantity.toFixed(2)} ${dpgfItem.unit})` : ""}`);
        lines.push(`    Réf. : ${item.dtu_ref}`);
        lines.push(`    ${d(item.template_key as DTKey)}`);
        lines.push("");
      }
      lines.push("");
    }

    return lines.join("\n");
  }, [cctpLots, dpgf, lang]);

  // ── Copy handler ──────────────────────────────────────────────────────────────
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildPlainText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  }

  // ── PDF export ────────────────────────────────────────────────────────────────
  function exportPdf() {
    downloadCctpPdf(dpgf, cctpLots, lang);
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden mt-4">
      {/* ── Header toggle ──────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <BookOpen className="w-5 h-5 text-sky-400" />
          <span className="font-display font-semibold text-white text-sm">
            {d("cctp_title" as DTKey)}
          </span>
          <span className="text-[10px] bg-sky-500/20 border border-sky-500/30 rounded px-1.5 py-0.5 font-semibold text-sky-400 uppercase tracking-wider">
            {d("cctp_wip" as DTKey)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!expanded && (
            <span className="text-xs text-slate-500 mr-2">
              {cctpLots.length} lots
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-400" />
          )}
        </div>
      </button>

      {/* ── Expandable content ──────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="cctp-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {/* No scale warning */}
            {!result.pixels_per_meter && (
              <div className="mx-5 mb-4 flex items-center gap-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {d("cctp_no_data" as DTKey)}
              </div>
            )}

            {/* Subtitle */}
            <div className="px-5 pb-3 text-xs text-slate-500">
              {d("cctp_subtitle" as DTKey)}
            </div>

            {/* ── Lot sections ──────────────────────────────────────────────── */}
            {cctpLots.map((lot) => {
              const isOpen = expandedLots.has(lot.lot_number);
              const dpgfLot = dpgf.lots.find(
                (l) => l.lot_number === lot.lot_number
              );

              return (
                <div key={lot.lot_number} className="border-t border-white/5">
                  {/* Lot header */}
                  <button
                    type="button"
                    onClick={() => toggleLot(lot.lot_number)}
                    className="w-full px-5 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition-colors cursor-pointer"
                  >
                    <span className="font-mono text-xs text-slate-500 w-12">
                      LOT {lot.lot_number}
                    </span>
                    <BookOpen
                      className="w-4 h-4 text-sky-400"
                    />
                    <span className="text-sm text-white font-medium flex-1 text-left">
                      {d(dpgfLot?.title_key as DTKey ?? ("dpgf_lot" + lot.lot_number) as DTKey)}
                    </span>
                    <span className="text-xs text-slate-500">
                      {lot.items.length} articles
                    </span>
                    {isOpen ? (
                      <ChevronUp className="w-4 h-4 text-slate-500" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    )}
                  </button>

                  {/* Lot content */}
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        key={`cctp-lot-${lot.lot_number}`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-4 space-y-4">
                          {/* Lot intro */}
                          <p className="text-xs text-slate-400 italic leading-relaxed">
                            {d(lot.intro_key as DTKey)}
                          </p>

                          {/* Items */}
                          {lot.items.map((item, idx) => {
                            const dpgfItem = dpgfLot?.items.find(
                              (i) => i.description_key === item.dpgf_key
                            );
                            return (
                              <div
                                key={idx}
                                className="bg-white/[0.02] rounded-lg px-4 py-3 space-y-2"
                              >
                                {/* Item title + quantity + DTU badge */}
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm text-white font-medium">
                                    {d(item.title_key as DTKey)}
                                  </span>
                                  {dpgfItem && (
                                    <span className="text-xs font-mono text-sky-300">
                                      {dpgfItem.quantity.toFixed(2)}{" "}
                                      {dpgfItem.unit}
                                    </span>
                                  )}
                                  <span className="text-[10px] bg-sky-500/20 border border-sky-500/30 rounded px-1.5 py-0.5 font-mono text-sky-400">
                                    {item.dtu_ref}
                                  </span>
                                </div>
                                {/* Prescriptive text */}
                                <p className="text-xs text-slate-400 leading-relaxed">
                                  {d(item.template_key as DTKey)}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            {/* ── Export buttons ──────────────────────────────────────────────── */}
            <div className="flex gap-2 px-5 py-4 border-t border-white/5">
              <button
                type="button"
                onClick={exportPdf}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                {d("cctp_export_pdf" as DTKey)}
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg text-xs font-semibold border border-white/10 transition-colors"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-green-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copied
                  ? d("cctp_copied" as DTKey)
                  : d("cctp_export_txt" as DTKey)}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
