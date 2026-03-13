"use client";

import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GitCompareArrows,
  ChevronDown,
  ChevronUp,
  Download,
  Table2,
  AlertTriangle,
  Leaf,
  Home,
  Star,
  Crown,
  Check,
  Hammer,
  Layers,
  DoorOpen,
  LayoutGrid,
  Grid3X3,
  Paintbrush,
  Zap,
  Droplets,
  Minus,
} from "lucide-react";
import type { AnalysisResult, CustomDetection, DpgfLot } from "@/lib/types";
import {
  SCENARIO_PRESETS,
  buildScenario,
  compareScenarios,
  type ScenarioPreset,
  type ScenarioResult,
} from "@/lib/dpgf-scenarios";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

// ── Props ───────────────────────────────────────────────────────────────────

interface ScenarioPanelProps {
  result: AnalysisResult;
  customDetections?: CustomDetection[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const fmtEur = (v: number) =>
  v.toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }) + " \u20AC";

const fmtPct = (v: number) => {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(0)}%`;
};

const PRESET_ICONS: Record<string, React.ComponentType<any>> = {
  Leaf,
  Home,
  Star,
  Crown,
};

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

// ── Component ───────────────────────────────────────────────────────────────

export default function ScenarioPanel({
  result,
  customDetections = [],
}: ScenarioPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  // ── State
  const [expanded, setExpanded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([
    "eco",
    "standard",
    "premium",
  ]);
  const [referenceId, setReferenceId] = useState("standard");
  const [ceilingHeight, setCeilingHeight] = useState(2.5);
  const [expandedLots, setExpandedLots] = useState<Set<number>>(new Set());
  const [showDetail, setShowDetail] = useState(true);

  // ── Guard: need scale + some data
  const hasPpm = !!result.pixels_per_meter;
  const hasArea = (result.surfaces?.area_hab_m2 ?? 0) > 0;
  const canCompare = hasPpm && hasArea;

  // ── Build scenarios
  const scenarios = useMemo<ScenarioResult[]>(() => {
    if (!canCompare) return [];
    return SCENARIO_PRESETS.filter((p) => selectedIds.includes(p.id)).map((p) =>
      buildScenario(result, customDetections, p, ceilingHeight)
    );
  }, [result, customDetections, selectedIds, ceilingHeight, canCompare]);

  const comparison = useMemo(() => {
    if (scenarios.length < 2) return null;
    return compareScenarios(scenarios);
  }, [scenarios]);

  const refIndex = scenarios.findIndex((s) => s.preset.id === referenceId);
  const refTotal = refIndex >= 0 ? scenarios[refIndex].dpgf.total_ht : 0;

  // ── Toggle scenario selection
  const toggleScenario = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        if (prev.includes(id)) {
          if (prev.length <= 2) return prev; // min 2
          const next = prev.filter((x) => x !== id);
          if (id === referenceId)
            setReferenceId(next[0] ?? "standard");
          return next;
        }
        return [...prev, id];
      });
    },
    [referenceId]
  );

  function toggleLot(lotNumber: number) {
    setExpandedLots((prev) => {
      const next = new Set(prev);
      if (next.has(lotNumber)) next.delete(lotNumber);
      else next.add(lotNumber);
      return next;
    });
  }

  // ── Delta % relative to reference
  function delta(val: number, ref: number): number {
    if (ref === 0) return 0;
    return ((val - ref) / ref) * 100;
  }

  // ── CSV export
  function exportCsv() {
    if (!comparison) return;
    const BOM = "\uFEFF";
    const scNames = scenarios.map((s) => d(s.preset.label_key as DTKey));
    const header = `Lot;Désignation;${scNames.join(";")}\n`;
    const rows: string[] = [];

    // Get lot list from first scenario
    for (const lot of scenarios[0].dpgf.lots) {
      rows.push(`${d(lot.title_key as DTKey)};;;;`);
      for (let i = 0; i < lot.items.length; i++) {
        const item = lot.items[i];
        const vals = scenarios
          .map((sc) => {
            const scLot = sc.dpgf.lots.find(
              (l) => l.lot_number === lot.lot_number
            );
            const scItem = scLot?.items[i];
            return scItem ? scItem.total_ht.toFixed(2) : "0.00";
          })
          .join(";");
        rows.push(`${lot.lot_number};${d(item.description_key as DTKey)};${vals}`);
      }
      const subtotals = scenarios
        .map((sc) => {
          const scLot = sc.dpgf.lots.find(
            (l) => l.lot_number === lot.lot_number
          );
          return (scLot?.subtotal_ht ?? 0).toFixed(2);
        })
        .join(";");
      rows.push(`;Sous-total;${subtotals}`);
    }

    rows.push("");
    rows.push(`;Total HT;${comparison.totals.map((t) => t.toFixed(2)).join(";")}`);
    rows.push(
      `;TVA;${scenarios.map((s) => s.dpgf.tva_amount.toFixed(2)).join(";")}`
    );
    rows.push(
      `;Total TTC;${comparison.totalsTtc.map((t) => t.toFixed(2)).join(";")}`
    );

    const csvContent = BOM + header + rows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `comparaison-scenarios-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mt-6">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-4 rounded-xl bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 border border-violet-500/20 hover:border-violet-500/40 transition-colors"
      >
        <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
          <GitCompareArrows className="w-5 h-5 text-violet-400" />
        </div>
        <div className="flex-1 text-left">
          <h3 className="text-sm font-semibold text-white">{d("scn_title")}</h3>
          <p className="text-xs text-slate-400">{d("scn_subtitle")}</p>
        </div>
        <span className="px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-semibold tracking-wide uppercase">
          Comparateur
        </span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-4 p-4 rounded-xl bg-slate-800/40 border border-slate-700/50">
              {/* Guard */}
              {!canCompare && (
                <div className="flex items-center gap-2 text-amber-400 text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  {d("scn_no_data")}
                </div>
              )}

              {canCompare && (
                <>
                  {/* ── Scenario selectors ──────────────────────────────── */}
                  <div className="flex flex-wrap gap-2">
                    {SCENARIO_PRESETS.map((preset) => {
                      const selected = selectedIds.includes(preset.id);
                      const isRef = preset.id === referenceId;
                      const Icon = PRESET_ICONS[preset.icon];
                      return (
                        <button
                          key={preset.id}
                          onClick={() => toggleScenario(preset.id)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            if (selected) setReferenceId(preset.id);
                          }}
                          className={`
                            relative flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all
                            ${
                              selected
                                ? "border-current bg-current/10 text-white"
                                : "border-slate-600/50 text-slate-500 hover:text-slate-300"
                            }
                          `}
                          style={selected ? { borderColor: preset.color, color: preset.color } : undefined}
                        >
                          {Icon && <Icon className="w-4 h-4" />}
                          <span className="font-medium">
                            {d(preset.label_key as DTKey)}
                          </span>
                          {selected && (
                            <Check className="w-3 h-3" />
                          )}
                          {isRef && selected && (
                            <span className="absolute -top-2 -right-2 px-1 py-0 rounded text-[9px] font-bold bg-white/90 text-slate-900">
                              {d("scn_ref")}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Hint */}
                  <p className="text-[11px] text-slate-500 -mt-1">
                    {d("scn_select_min")} — clic droit = {d("scn_set_ref")}
                  </p>

                  {/* ── Ceiling height slider ──────────────────────────── */}
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span>Hauteur plafond :</span>
                    <input
                      type="range"
                      min={2}
                      max={4}
                      step={0.1}
                      value={ceilingHeight}
                      onChange={(e) =>
                        setCeilingHeight(parseFloat(e.target.value))
                      }
                      className="flex-1 accent-violet-500"
                    />
                    <span className="font-mono text-white w-12 text-right">
                      {ceilingHeight.toFixed(1)}m
                    </span>
                  </div>

                  {scenarios.length >= 2 && comparison && (
                    <>
                      {/* ── Synthesis bars ────────────────────────────── */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                          {d("scn_synthesis")}
                        </h4>
                        {scenarios.map((sc, i) => {
                          const pct =
                            comparison.totalRange.max > 0
                              ? (sc.dpgf.total_ttc / comparison.totalRange.max) * 100
                              : 0;
                          const isRef = sc.preset.id === referenceId;
                          const dPct = isRef
                            ? null
                            : delta(sc.dpgf.total_ht, refTotal);
                          return (
                            <div key={sc.preset.id} className="space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span
                                  className="font-medium"
                                  style={{ color: sc.preset.color }}
                                >
                                  {d(sc.preset.label_key as DTKey)}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-white">
                                    {fmtEur(sc.dpgf.total_ttc)}
                                  </span>
                                  {isRef ? (
                                    <span className="text-slate-500 text-[10px]">
                                      ({d("scn_ref")})
                                    </span>
                                  ) : dPct !== null ? (
                                    <span
                                      className={`text-[10px] font-semibold ${
                                        dPct < 0
                                          ? "text-emerald-400"
                                          : "text-rose-400"
                                      }`}
                                    >
                                      {fmtPct(dPct)}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <div className="h-3 rounded-full bg-slate-700/50 overflow-hidden">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${Math.max(pct, 3)}%` }}
                                  transition={{ duration: 0.6, delay: i * 0.1 }}
                                  className="h-full rounded-full"
                                  style={{ backgroundColor: sc.preset.color }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* ── Detail toggle ─────────────────────────────── */}
                      <button
                        onClick={() => setShowDetail(!showDetail)}
                        className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                      >
                        {showDetail ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                        {d("scn_detail_lot")}
                      </button>

                      <AnimatePresence initial={false}>
                        {showDetail && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden space-y-2"
                          >
                            {/* ── Lot-by-lot comparison ─────────────── */}
                            <div className="overflow-x-auto -mx-4 px-4">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-slate-700/50">
                                    <th className="text-left py-2 text-slate-400 font-medium w-1/3">
                                      Lot / Désignation
                                    </th>
                                    {scenarios.map((sc) => (
                                      <th
                                        key={sc.preset.id}
                                        className="text-right py-2 px-2 font-medium"
                                        style={{ color: sc.preset.color }}
                                      >
                                        {d(sc.preset.label_key as DTKey)}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {scenarios[0].dpgf.lots.map((lot) => {
                                    const lotNum = lot.lot_number;
                                    const isLotOpen = expandedLots.has(lotNum);
                                    const LotIcon = LOT_ICONS[lot.icon];

                                    // Subtotals for this lot across scenarios
                                    const lotSubtotals = scenarios.map((sc) => {
                                      const sl = sc.dpgf.lots.find(
                                        (l) => l.lot_number === lotNum
                                      );
                                      return sl?.subtotal_ht ?? 0;
                                    });
                                    const refLotSub =
                                      refIndex >= 0
                                        ? lotSubtotals[refIndex]
                                        : 0;

                                    return (
                                      <React.Fragment key={lotNum}>
                                        {/* Lot header row */}
                                        <tr
                                          className="border-b border-slate-700/30 cursor-pointer hover:bg-slate-700/20"
                                          onClick={() => toggleLot(lotNum)}
                                        >
                                          <td className="py-2 flex items-center gap-2 text-slate-200 font-medium">
                                            {LotIcon && (
                                              <LotIcon
                                                className="w-3.5 h-3.5"
                                                style={{ color: lot.color }}
                                              />
                                            )}
                                            <span>
                                              {d(lot.title_key as DTKey)}
                                            </span>
                                            {isLotOpen ? (
                                              <ChevronUp className="w-3 h-3 text-slate-500" />
                                            ) : (
                                              <ChevronDown className="w-3 h-3 text-slate-500" />
                                            )}
                                          </td>
                                          {lotSubtotals.map((sub, i) => {
                                            const isRefCol =
                                              scenarios[i].preset.id ===
                                              referenceId;
                                            const d2 = isRefCol
                                              ? null
                                              : delta(sub, refLotSub);
                                            return (
                                              <td
                                                key={scenarios[i].preset.id}
                                                className="text-right py-2 px-2"
                                              >
                                                <span className="font-mono text-white">
                                                  {fmtEur(sub)}
                                                </span>
                                                {d2 !== null && (
                                                  <span
                                                    className={`block text-[10px] ${
                                                      d2 < 0
                                                        ? "text-emerald-400"
                                                        : d2 > 0
                                                          ? "text-rose-400"
                                                          : "text-slate-500"
                                                    }`}
                                                  >
                                                    {fmtPct(d2)}
                                                  </span>
                                                )}
                                              </td>
                                            );
                                          })}
                                        </tr>

                                        {/* Item rows (expanded) */}
                                        {isLotOpen &&
                                          lot.items.map((item, itemIdx) => {
                                            const refItem =
                                              refIndex >= 0
                                                ? scenarios[refIndex]?.dpgf.lots
                                                    .find(
                                                      (l) =>
                                                        l.lot_number ===
                                                        lotNum
                                                    )
                                                    ?.items[itemIdx]
                                                : undefined;
                                            const refItemTotal =
                                              refItem?.total_ht ?? 0;

                                            return (
                                              <tr
                                                key={item.id}
                                                className="border-b border-slate-800/30"
                                              >
                                                <td className="py-1.5 pl-8 text-slate-400">
                                                  {d(
                                                    item.description_key as DTKey
                                                  )}
                                                  <span className="text-slate-600 ml-1">
                                                    ({item.quantity}{" "}
                                                    {item.unit})
                                                  </span>
                                                </td>
                                                {scenarios.map((sc, i) => {
                                                  const scLot =
                                                    sc.dpgf.lots.find(
                                                      (l) =>
                                                        l.lot_number ===
                                                        lotNum
                                                    );
                                                  const scItem =
                                                    scLot?.items[itemIdx];
                                                  const val =
                                                    scItem?.total_ht ?? 0;
                                                  const isRefCol =
                                                    sc.preset.id ===
                                                    referenceId;
                                                  const d2 = isRefCol
                                                    ? null
                                                    : delta(val, refItemTotal);
                                                  const matLabel =
                                                    sc.preset.materialLabels[
                                                      item.description_key
                                                    ];

                                                  return (
                                                    <td
                                                      key={sc.preset.id}
                                                      className="text-right py-1.5 px-2"
                                                    >
                                                      <span className="font-mono text-slate-300 text-[11px]">
                                                        {fmtEur(val)}
                                                      </span>
                                                      {scItem && (
                                                        <span className="block text-[10px] text-slate-600">
                                                          {scItem.unit_price.toFixed(
                                                            2
                                                          )}
                                                          €/{scItem.unit}
                                                        </span>
                                                      )}
                                                      {matLabel && (
                                                        <span className="block text-[9px] italic text-slate-500">
                                                          {matLabel}
                                                        </span>
                                                      )}
                                                      {d2 !== null &&
                                                        Math.abs(d2) > 0.5 && (
                                                          <span
                                                            className={`text-[9px] ${
                                                              d2 < 0
                                                                ? "text-emerald-400"
                                                                : "text-rose-400"
                                                            }`}
                                                          >
                                                            {fmtPct(d2)}
                                                          </span>
                                                        )}
                                                    </td>
                                                  );
                                                })}
                                              </tr>
                                            );
                                          })}
                                      </React.Fragment>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>

                            {/* ── Totals ──────────────────────────────── */}
                            <div className="border-t border-slate-700/50 pt-3 space-y-1">
                              {/* Total HT */}
                              <div className="flex items-center text-xs">
                                <span className="w-1/3 text-slate-400 font-medium">
                                  {d("scn_ht")}
                                </span>
                                {scenarios.map((sc) => (
                                  <span
                                    key={sc.preset.id}
                                    className="flex-1 text-right font-mono text-white px-2"
                                  >
                                    {fmtEur(sc.dpgf.total_ht)}
                                  </span>
                                ))}
                              </div>
                              {/* TVA */}
                              <div className="flex items-center text-xs">
                                <span className="w-1/3 text-slate-400">
                                  {d("scn_tva")} ({scenarios[0]?.dpgf.tva_rate}%)
                                </span>
                                {scenarios.map((sc) => (
                                  <span
                                    key={sc.preset.id}
                                    className="flex-1 text-right font-mono text-slate-400 px-2"
                                  >
                                    {fmtEur(sc.dpgf.tva_amount)}
                                  </span>
                                ))}
                              </div>
                              {/* Total TTC */}
                              <div className="flex items-center text-xs font-bold">
                                <span className="w-1/3 text-white">
                                  {d("scn_ttc")}
                                </span>
                                {scenarios.map((sc, i) => {
                                  const isRef =
                                    sc.preset.id === referenceId;
                                  const dPct = isRef
                                    ? null
                                    : delta(sc.dpgf.total_ht, refTotal);
                                  return (
                                    <span
                                      key={sc.preset.id}
                                      className="flex-1 text-right px-2"
                                    >
                                      <span
                                        className="font-mono"
                                        style={{ color: sc.preset.color }}
                                      >
                                        {fmtEur(sc.dpgf.total_ttc)}
                                      </span>
                                      {dPct !== null && (
                                        <span
                                          className={`ml-1 text-[10px] ${
                                            dPct < 0
                                              ? "text-emerald-400"
                                              : "text-rose-400"
                                          }`}
                                        >
                                          {fmtPct(dPct)}
                                        </span>
                                      )}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* ── Export buttons ─────────────────────────────── */}
                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={exportCsv}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                        >
                          <Table2 className="w-3.5 h-3.5" />
                          {d("scn_export_csv")}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// React import is needed for React.Fragment
import React from "react";
