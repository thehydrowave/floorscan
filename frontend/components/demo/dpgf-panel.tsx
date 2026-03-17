"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  Download,
  Table2,
  AlertTriangle,
  Hammer,
  Layers,
  DoorOpen,
  LayoutGrid,
  Grid3X3,
  Paintbrush,
  Zap,
  Droplets,
  Minus,
  FileSignature,
} from "lucide-react";
import {
  AnalysisResult,
  CustomDetection,
  DpgfState,
  DpgfLot,
  DpgfLineItem,
} from "@/lib/types";
import { buildDefaultDpgf } from "@/lib/dpgf-defaults";
import { downloadDpgfPdf } from "@/lib/dpgf-pdf";
import DevisDialog from "./devis-dialog";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

// ── Props ───────────────────────────────────────────────────────────────────────

interface DpgfPanelProps {
  result: AnalysisResult;
  customDetections?: CustomDetection[];
}

// ── Icon mapping ────────────────────────────────────────────────────────────────

const LOT_ICONS: Record<string, React.ComponentType<any>> = {
  Hammer,
  Layers,
  DoorOpen,
  LayoutGrid,
  Grid3X3,
  Paintbrush,
  Zap,
  Droplets,
  Minus,
};

// ── EUR formatter ───────────────────────────────────────────────────────────────

const fmtEur = (v: number) =>
  v.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " \u20AC";

// ── Component ───────────────────────────────────────────────────────────────────

export default function DpgfPanel({
  result,
  customDetections = [],
}: DpgfPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  // ── State ───────────────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState(false);
  const [expandedLots, setExpandedLots] = useState<Set<number>>(new Set());
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>(
    {}
  );
  const [tvaRate, setTvaRate] = useState(0.1);
  const [ceilingHeight, setCeilingHeight] = useState(2.5);
  const [projectName, setProjectName] = useState("");
  const [projectAddress, setProjectAddress] = useState("");
  const [devisOpen, setDevisOpen] = useState(false);

  // ── DPGF computation ────────────────────────────────────────────────────────
  const dpgf = useMemo<DpgfState>(() => {
    const base = buildDefaultDpgf(result, customDetections, { ceilingHeight });

    // Apply user price overrides and recompute line totals
    for (const lot of base.lots) {
      for (const item of lot.items) {
        if (priceOverrides[item.id] !== undefined) {
          item.unit_price = priceOverrides[item.id];
        }
        item.total_ht =
          Math.round(item.quantity * item.unit_price * 100) / 100;
      }
      lot.subtotal_ht = lot.items.reduce((s, i) => s + i.total_ht, 0);
    }

    base.total_ht = base.lots.reduce((s, l) => s + l.subtotal_ht, 0);
    base.tva_rate = Math.round(tvaRate * 1000) / 10; // store as percentage (e.g. 10, 5.5, 20)
    base.tva_amount = Math.round(base.total_ht * tvaRate * 100) / 100;
    base.total_ttc = base.total_ht + base.tva_amount;
    base.project_name = projectName;
    base.project_address = projectAddress;

    return base;
  }, [
    result,
    customDetections,
    ceilingHeight,
    priceOverrides,
    tvaRate,
    projectName,
    projectAddress,
  ]);

  // ── Lot toggle ──────────────────────────────────────────────────────────────
  function toggleLot(lotNumber: number) {
    setExpandedLots((prev) => {
      const next = new Set(prev);
      if (next.has(lotNumber)) next.delete(lotNumber);
      else next.add(lotNumber);
      return next;
    });
  }

  // ── PDF export ──────────────────────────────────────────────────────────────
  function exportPdf() {
    downloadDpgfPdf(dpgf, lang);
  }

  // ── CSV export ──────────────────────────────────────────────────────────────
  function exportCsv() {
    const BOM = "\uFEFF";
    const dateStr = new Date().toLocaleDateString("fr-FR");
    const rows: string[] = [];

    // Metadata header
    rows.push("# FloorScan -- DPGF");
    if (dpgf.project_name) rows.push(`# ${d("dpgf_project" as DTKey)}: ${dpgf.project_name}`);
    if (dpgf.project_address) rows.push(`# ${d("dpgf_address" as DTKey)}: ${dpgf.project_address}`);
    rows.push(`# Date: ${dateStr}`);
    rows.push("");

    // Column headers (i18n)
    rows.push(
      [
        "Lot",
        d("dpgf_desc" as DTKey),
        d("dpgf_qty" as DTKey),
        d("dpgf_unit" as DTKey),
        d("dpgf_pu_ht" as DTKey),
        d("dpgf_total_line" as DTKey),
      ].join(";")
    );

    for (const lot of dpgf.lots) {
      for (const item of lot.items) {
        rows.push(
          [
            `LOT ${lot.lot_number}`,
            d(item.description_key as DTKey),
            item.quantity.toFixed(2),
            item.unit,
            item.unit_price.toFixed(2),
            item.total_ht.toFixed(2),
          ].join(";")
        );
      }
      rows.push(
        [
          `LOT ${lot.lot_number}`,
          d("dpgf_subtotal" as DTKey),
          "",
          "",
          "",
          lot.subtotal_ht.toFixed(2),
        ].join(";")
      );
      // Blank line between lots
      rows.push("");
    }

    rows.push(["", d("dpgf_total_ht" as DTKey), "", "", "", dpgf.total_ht.toFixed(2)].join(";"));
    rows.push(
      [
        "",
        `${d("dpgf_tva" as DTKey)} ${(tvaRate * 100).toFixed(tvaRate === 0.055 ? 1 : 0)}%`,
        "",
        "",
        "",
        dpgf.tva_amount.toFixed(2),
      ].join(";")
    );
    rows.push(
      ["", d("dpgf_total_ttc" as DTKey), "", "", "", dpgf.total_ttc.toFixed(2)].join(";")
    );

    const safeName = (dpgf.project_name || "dpgf").replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
    const fileName = `floorscan_dpgf_${safeName}_${dateStr.replace(/\//g, "-")}.csv`;

    const blob = new Blob([BOM + rows.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden mt-4">
      {/* ── Header toggle button ──────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
          <span className="font-display font-semibold text-white text-sm">
            {d("dpgf_title" as DTKey)}
          </span>
          <span className="text-[10px] bg-emerald-500/20 border border-emerald-500/30 rounded px-1.5 py-0.5 font-semibold text-emerald-400 uppercase tracking-wider">
            {d("dpgf_wip" as DTKey)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!expanded && dpgf.total_ht > 0 && (
            <span className="font-mono text-sm text-emerald-400 mr-2">
              {fmtEur(dpgf.total_ttc)}
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-400" />
          )}
        </div>
      </button>

      {/* ── Expandable content ────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="dpgf-content"
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
                {d("dpgf_no_scale" as DTKey)}
              </div>
            )}

            {/* Project info inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-5 mb-4">
              <input
                type="text"
                placeholder={d("dpgf_project" as DTKey)}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <input
                type="text"
                placeholder={d("dpgf_address" as DTKey)}
                value={projectAddress}
                onChange={(e) => setProjectAddress(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            {/* Parameters row */}
            <div className="grid grid-cols-2 gap-3 px-5 mb-5">
              <label className="text-xs text-slate-500">
                {d("dpgf_height" as DTKey)}
                <input
                  type="number"
                  value={ceilingHeight}
                  step={0.05}
                  min={2}
                  max={4}
                  onChange={(e) =>
                    setCeilingHeight(parseFloat(e.target.value) || 2.5)
                  }
                  className="ml-2 w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-sm text-right focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </label>
              <label className="text-xs text-slate-500">
                {d("dpgf_tva_rate" as DTKey)}
                <select
                  value={String(tvaRate)}
                  onChange={(e) => setTvaRate(parseFloat(e.target.value))}
                  className="ml-2 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="0.20">20 %</option>
                  <option value="0.10">10 %</option>
                  <option value="0.055">5,5 %</option>
                </select>
              </label>
            </div>

            {/* ── Lot sections ────────────────────────────────────────────── */}
            {dpgf.lots.map((lot) => {
              const Icon = LOT_ICONS[lot.icon] ?? Hammer;
              const isOpen = expandedLots.has(lot.lot_number);

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
                    <Icon
                      className="w-4 h-4"
                      style={{ color: lot.color }}
                    />
                    <span className="text-sm text-white font-medium flex-1 text-left">
                      {d(lot.title_key as DTKey)}
                    </span>
                    <span
                      className="font-mono text-sm font-semibold"
                      style={{ color: lot.color }}
                    >
                      {fmtEur(lot.subtotal_ht)}
                    </span>
                    {isOpen ? (
                      <ChevronUp className="w-4 h-4 text-slate-500" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    )}
                  </button>

                  {/* Lot items table */}
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        key={`lot-${lot.lot_number}`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-slate-500 border-b border-white/5">
                              <th className="text-left px-5 py-1.5 font-medium">
                                {d("dpgf_desc" as DTKey)}
                              </th>
                              <th className="text-right px-2 py-1.5 font-medium w-16">
                                {d("dpgf_qty" as DTKey)}
                              </th>
                              <th className="text-center px-2 py-1.5 font-medium w-12">
                                {d("dpgf_unit" as DTKey)}
                              </th>
                              <th className="text-right px-2 py-1.5 font-medium w-24">
                                {d("dpgf_pu_ht" as DTKey)}
                              </th>
                              <th className="text-right px-5 py-1.5 font-medium w-24">
                                {d("dpgf_total_line" as DTKey)}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {lot.items.map((item) => (
                              <tr
                                key={item.id}
                                className="border-b border-white/[0.03] hover:bg-white/[0.02]"
                              >
                                <td className="px-5 py-2 text-slate-300">
                                  {d(item.description_key as DTKey)}
                                </td>
                                <td className="text-right px-2 py-2 font-mono text-slate-400">
                                  {item.quantity.toFixed(2)}
                                </td>
                                <td className="text-center px-2 py-2 text-slate-500">
                                  {item.unit}
                                </td>
                                <td className="text-right px-2 py-2">
                                  <input
                                    type="number"
                                    value={
                                      priceOverrides[item.id] ?? item.unit_price
                                    }
                                    step={0.5}
                                    min={0}
                                    onChange={(e) =>
                                      setPriceOverrides((prev) => ({
                                        ...prev,
                                        [item.id]:
                                          parseFloat(e.target.value) || 0,
                                      }))
                                    }
                                    className="w-20 bg-white/5 border border-white/10 rounded px-2 py-0.5 text-white text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                  />
                                </td>
                                <td className="text-right px-5 py-2 font-mono font-semibold text-white">
                                  {fmtEur(item.total_ht)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="bg-white/[0.02]">
                              <td
                                colSpan={4}
                                className="text-right px-5 py-2 text-slate-400 font-medium"
                              >
                                {d("dpgf_subtotal" as DTKey)}
                              </td>
                              <td
                                className="text-right px-5 py-2 font-mono font-bold"
                                style={{ color: lot.color }}
                              >
                                {fmtEur(lot.subtotal_ht)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            {/* ── Export buttons ───────────────────────────────────────────── */}
            <div className="flex gap-2 px-5 py-4 border-t border-white/5">
              <button
                type="button"
                onClick={exportPdf}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                {d("dpgf_export_pdf" as DTKey)}
              </button>
              <button
                type="button"
                onClick={() => setDevisOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                <FileSignature className="w-3.5 h-3.5" />
                {d("devis_generate" as DTKey)}
              </button>
              <button
                type="button"
                onClick={exportCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg text-xs font-semibold border border-white/10 transition-colors"
              >
                <Table2 className="w-3.5 h-3.5" />
                {d("dpgf_export_csv" as DTKey)}
              </button>
            </div>

            {/* Devis dialog */}
            {devisOpen && <DevisDialog dpgf={dpgf} onClose={() => setDevisOpen(false)} />}

            {/* ── Total bar ───────────────────────────────────────────────── */}
            <div className="bg-ink/80 backdrop-blur border-t border-white/10 px-5 py-4 flex flex-wrap items-center justify-between gap-4">
              <div className="text-sm text-slate-400">
                {d("dpgf_total_ht" as DTKey)} :{" "}
                <span className="font-mono font-semibold text-white">
                  {fmtEur(dpgf.total_ht)}
                </span>
              </div>
              <div className="text-sm text-slate-400">
                {d("dpgf_tva" as DTKey)}{" "}
                {(tvaRate * 100).toFixed(tvaRate === 0.055 ? 1 : 0)}% :{" "}
                <span className="font-mono text-white">
                  {fmtEur(dpgf.tva_amount)}
                </span>
              </div>
              <div className="text-base font-bold text-emerald-400">
                {d("dpgf_total_ttc" as DTKey)} :{" "}
                <span className="font-mono text-lg">
                  {fmtEur(dpgf.total_ttc)}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
