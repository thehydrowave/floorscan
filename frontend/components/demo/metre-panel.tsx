"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Ruler,
  ChevronDown,
  ChevronUp,
  Download,
  Table2,
  AlertTriangle,
} from "lucide-react";
import type { AnalysisResult } from "@/lib/types";
import { computeMetre, MetreResult, RoomMetre } from "@/lib/metre-calculator";
import { downloadMetrePdf } from "@/lib/metre-pdf";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

// ── Props ───────────────────────────────────────────────────────────────────────

interface MetrePanelProps {
  result: AnalysisResult;
}

// ── Type color mapping ──────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  living: "#3b82f6",
  kitchen: "#f59e0b",
  bedroom: "#8b5cf6",
  bathroom: "#06b6d4",
  wc: "#94a3b8",
  corridor: "#64748b",
  other: "#6b7280",
  global: "#a855f7",
  total: "#10b981",
};

function typeColor(type: string): string {
  const t = type.toLowerCase();
  for (const [key, color] of Object.entries(TYPE_COLORS)) {
    if (t.includes(key)) return color;
  }
  return TYPE_COLORS.other;
}

// ── Format number ───────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toFixed(2);
}

// ── Component ───────────────────────────────────────────────────────────────────

export default function MetrePanel({ result }: MetrePanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  // ── State ─────────────────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState(false);
  const [ceilingHeight, setCeilingHeight] = useState(2.5);

  // ── Compute metre ─────────────────────────────────────────────────────────────
  const metre = useMemo<MetreResult>(
    () => computeMetre(result, { ceilingHeight }),
    [result, ceilingHeight]
  );

  // ── PDF export ────────────────────────────────────────────────────────────────
  function exportPdf() {
    downloadMetrePdf(metre, lang, ceilingHeight);
  }

  // ── CSV export ────────────────────────────────────────────────────────────────
  function exportCsv() {
    const BOM = "\uFEFF";
    const dateStr = new Date().toLocaleDateString("fr-FR");
    const rows: string[] = [];

    // Metadata header
    rows.push("# FloorScan -- Metre");
    rows.push(`# ${d("metre_ceiling_height" as DTKey) || "Hauteur plafond"}: ${ceilingHeight.toFixed(2)} m`);
    rows.push(`# Date: ${dateStr}`);
    rows.push("");

    // Column headers (i18n with units)
    rows.push(
      [
        d("metre_room" as DTKey),
        "Type",
        `${d("metre_floor" as DTKey)} (m\u00b2)`,
        `${d("metre_perim" as DTKey)} (ml)`,
        `${d("metre_walls_gross" as DTKey)} (m\u00b2)`,
        `${d("metre_openings" as DTKey)} (m\u00b2)`,
        `${d("metre_walls_net" as DTKey)} (m\u00b2)`,
        `${d("metre_ceiling" as DTKey)} (m\u00b2)`,
        `${d("metre_plinth" as DTKey)} (ml)`,
        d("metre_doors" as DTKey),
        d("metre_windows" as DTKey),
      ].join(";")
    );

    for (const r of metre.rooms) {
      rows.push(
        [
          r.room_label,
          r.room_type,
          fmt(r.floor_area_m2),
          fmt(r.perimeter_m),
          fmt(r.wall_area_gross_m2),
          fmt(r.openings_area_m2),
          fmt(r.wall_area_net_m2),
          fmt(r.ceiling_area_m2),
          fmt(r.plinth_length_m),
          String(r.doors_count),
          String(r.windows_count),
        ].join(";")
      );
    }

    // Blank line before totals
    rows.push("");

    // Totals
    const t = metre.totals;
    rows.push(
      [
        "TOTAL",
        "",
        fmt(t.floor_area_m2),
        fmt(t.perimeter_m),
        fmt(t.wall_area_gross_m2),
        fmt(t.openings_area_m2),
        fmt(t.wall_area_net_m2),
        fmt(t.ceiling_area_m2),
        fmt(t.plinth_length_m),
        String(t.doors_count),
        String(t.windows_count),
      ].join(";")
    );

    const fileName = `floorscan_metre_${dateStr.replace(/\//g, "-")}.csv`;

    const blob = new Blob([BOM + rows.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── Column definitions ────────────────────────────────────────────────────────
  const cols: { key: string; label: DTKey; numeric: boolean; integer?: boolean }[] = [
    { key: "floor_area_m2", label: "metre_floor" as DTKey, numeric: true },
    { key: "perimeter_m", label: "metre_perim" as DTKey, numeric: true },
    { key: "wall_area_gross_m2", label: "metre_walls_gross" as DTKey, numeric: true },
    { key: "openings_area_m2", label: "metre_openings" as DTKey, numeric: true },
    { key: "wall_area_net_m2", label: "metre_walls_net" as DTKey, numeric: true },
    { key: "ceiling_area_m2", label: "metre_ceiling" as DTKey, numeric: true },
    { key: "plinth_length_m", label: "metre_plinth" as DTKey, numeric: true },
    { key: "doors_count", label: "metre_doors" as DTKey, numeric: true, integer: true },
    { key: "windows_count", label: "metre_windows" as DTKey, numeric: true, integer: true },
  ];

  // ── Cell value ────────────────────────────────────────────────────────────────
  function cellValue(row: RoomMetre, key: string, integer?: boolean): string {
    const v = (row as unknown as Record<string, number>)[key] ?? 0;
    return integer ? String(v) : fmt(v);
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
          <Ruler className="w-5 h-5 text-violet-400" />
          <span className="font-display font-semibold text-white text-sm">
            {d("metre_title" as DTKey)}
          </span>
          <span className="text-[10px] bg-violet-500/20 border border-violet-500/30 rounded px-1.5 py-0.5 font-semibold text-violet-400 uppercase tracking-wider">
            {d("metre_wip" as DTKey)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!expanded && (
            <span className="text-xs text-slate-500 mr-2">
              {metre.rooms.length} {metre.rooms.length > 1 ? "pièces" : "pièce"}
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
            key="metre-content"
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
                {d("metre_no_scale" as DTKey)}
              </div>
            )}

            {/* Ceiling height param */}
            <div className="px-5 mb-4 flex items-center gap-3">
              <label className="text-xs text-slate-500 flex items-center gap-2">
                {d("metre_ceiling_h" as DTKey)}
                <input
                  type="number"
                  value={ceilingHeight}
                  step={0.05}
                  min={2}
                  max={4}
                  onChange={(e) =>
                    setCeilingHeight(parseFloat(e.target.value) || 2.5)
                  }
                  className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-sm text-right focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
                <span className="text-slate-600">m</span>
              </label>
              <span className="text-xs text-slate-600">
                {d("metre_subtitle" as DTKey)}
              </span>
            </div>

            {/* ── Table ──────────────────────────────────────────────────────── */}
            <div className="mx-5 mb-4 overflow-x-auto rounded-lg border border-white/5">
              <table className="w-full text-xs whitespace-nowrap">
                <thead>
                  <tr className="bg-white/[0.03] text-slate-500 border-b border-white/5">
                    <th className="text-left px-3 py-2 font-medium sticky left-0 bg-ink/80 backdrop-blur z-10">
                      {d("metre_room" as DTKey)}
                    </th>
                    {cols.map((col) => (
                      <th
                        key={col.key}
                        className="text-right px-2 py-2 font-medium"
                      >
                        {d(col.label)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metre.rooms.map((row, idx) => (
                    <tr
                      key={idx}
                      className="border-b border-white/[0.03] hover:bg-white/[0.02]"
                    >
                      <td className="px-3 py-2 sticky left-0 bg-ink/80 backdrop-blur z-10">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: typeColor(row.room_type),
                            }}
                          />
                          <span className="text-white font-medium">
                            {row.room_label}
                          </span>
                        </div>
                      </td>
                      {cols.map((col) => (
                        <td
                          key={col.key}
                          className="text-right px-2 py-2 font-mono text-slate-400"
                        >
                          {cellValue(row, col.key, col.integer)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {/* Totals */}
                <tfoot>
                  <tr className="bg-white/[0.04] border-t border-white/10">
                    <td className="px-3 py-2 font-bold text-violet-400 sticky left-0 bg-ink/80 backdrop-blur z-10">
                      {d("metre_total" as DTKey)}
                    </td>
                    {cols.map((col) => (
                      <td
                        key={col.key}
                        className="text-right px-2 py-2 font-mono font-bold text-white"
                      >
                        {cellValue(metre.totals, col.key, col.integer)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* ── Export buttons ──────────────────────────────────────────────── */}
            <div className="flex gap-2 px-5 py-4 border-t border-white/5">
              <button
                type="button"
                onClick={exportPdf}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                {d("metre_export_pdf" as DTKey)}
              </button>
              <button
                type="button"
                onClick={exportCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg text-xs font-semibold border border-white/10 transition-colors"
              >
                <Table2 className="w-3.5 h-3.5" />
                {d("metre_export_csv" as DTKey)}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
