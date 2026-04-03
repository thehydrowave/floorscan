"use client";

/**
 * FacadeDashboardPanel — Vue d'ensemble des indicateurs facade.
 * Affiche: total elements, ratio ouvertures (SVG arc), surface breakdown,
 * distribution par type (horizontal bars), distribution par etage, stats confiance.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LayoutDashboard, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { FacadeAnalysisResult, FacadeElementType } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/* ── Circular arc SVG for ratio ── */
function RatioArc({ pct, size = 72 }: { pct: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(pct, 100) / 100);
  const color = pct >= 15 && pct <= 25 ? "#34d399" : pct > 40 ? "#f87171" : "#fbbf24";

  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={5} />
      <circle
        cx={c} cy={c} r={r} fill="none"
        stroke={color} strokeWidth={5}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${c} ${c})`}
      />
      <text x={c} y={c} textAnchor="middle" dominantBaseline="central"
        fill={color} fontSize={size * 0.26} fontWeight="700">
        {pct.toFixed(1)}%
      </text>
    </svg>
  );
}

/* ── Simple KPI card ── */
function KpiCard({ label, value, color, icon }: { label: string; value: string; color: string; icon: string }) {
  return (
    <div className="glass rounded-xl border border-white/10 p-4">
      <p className="text-xs text-slate-500 mb-1">{icon} {label}</p>
      <p className="text-xl font-display font-700" style={{ color }}>{value}</p>
    </div>
  );
}

/* ── Horizontal bar ── */
function HBar({ label, value, maxValue, color }: { label: string; value: number; maxValue: number; color: string }) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-400 w-20 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-4 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-mono text-slate-300 w-8 text-right">{value}</span>
    </div>
  );
}

/* ── Colors per element type ── */
const TYPE_COLORS: Record<FacadeElementType, string> = {
  window: "#fbbf24",
  door: "#f472b6",
  balcony: "#34d399",
  floor_line: "#fbbf24",
  roof: "#a78bfa",
  column: "#fb923c",
  other: "#94a3b8",
  wall_opaque: "#64748b",
};

const TYPE_LABELS_FR: Record<FacadeElementType, string> = {
  window: "Fenetre",
  door: "Porte",
  balcony: "Balcon",
  floor_line: "Plancher",
  roof: "Toiture",
  column: "Colonne",
  other: "Autre",
  wall_opaque: "Mur opaque",
};

const TYPE_LABELS_EN: Record<FacadeElementType, string> = {
  window: "Window",
  door: "Door",
  balcony: "Balcony",
  floor_line: "Floor line",
  roof: "Roof",
  column: "Column",
  other: "Other",
  wall_opaque: "Opaque wall",
};

/* ── Props ── */
interface FacadeDashboardPanelProps {
  result: FacadeAnalysisResult;
}

export default function FacadeDashboardPanel({ result }: FacadeDashboardPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const isFr = lang === "fr";

  const [expanded, setExpanded] = useState(true);

  const hasArea = result.facade_area_m2 != null && result.facade_area_m2 > 0;

  /* ── Remap "other" → "window" for metrics (model often misclassifies) ── */
  const remappedElements = useMemo(() =>
    result.elements.map(el => el.type === "other" ? { ...el, type: "window" as FacadeElementType } : el),
    [result.elements]);
  const windowsCount = useMemo(() => remappedElements.filter(e => e.type === "window").length, [remappedElements]);
  const windowsArea = useMemo(() => remappedElements.filter(e => e.type === "window").reduce((s, e) => s + (e.area_m2 ?? 0), 0), [remappedElements]);

  /* ── Derived metrics ── */
  const totalElements = remappedElements.length;
  const facadeArea = result.facade_area_m2 ?? 0;
  const openingsArea = windowsArea > 0 ? windowsArea : (result.openings_area_m2 ?? 0);
  const wallArea = Math.max(0, facadeArea - openingsArea);
  const ratioPct = facadeArea > 0 ? (openingsArea / facadeArea) * 100 : 0;

  /* ── Element distribution by type ── */
  const typeDistribution = useMemo(() => {
    const map = new Map<FacadeElementType, number>();
    for (const el of remappedElements) {
      map.set(el.type, (map.get(el.type) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({
        type,
        count,
        label: isFr ? TYPE_LABELS_FR[type] : TYPE_LABELS_EN[type],
        color: TYPE_COLORS[type],
      }));
  }, [result.elements, isFr]);

  const maxTypeCount = Math.max(...typeDistribution.map(t => t.count), 1);

  /* ── Element distribution by floor level ── */
  const floorDistribution = useMemo(() => {
    const map = new Map<number, number>();
    for (const el of result.elements) {
      const lvl = el.floor_level ?? 0;
      map.set(lvl, (map.get(lvl) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([floor, count]) => ({
        floor,
        count,
        label: floor === 0
          ? (isFr ? "RDC" : "Ground")
          : `${isFr ? "Etage" : "Floor"} ${floor}`,
      }));
  }, [result.elements, isFr]);

  const maxFloorCount = Math.max(...floorDistribution.map(f => f.count), 1);

  /* ── Confidence stats ── */
  const confidenceStats = useMemo(() => {
    const confs = result.elements
      .map(e => e.confidence)
      .filter((c): c is number => c != null);
    if (confs.length === 0) return null;
    const avg = confs.reduce((s, c) => s + c, 0) / confs.length;
    const min = Math.min(...confs);
    const max = Math.max(...confs);
    return { avg, min, max, count: confs.length };
  }, [result.elements]);

  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
        style={{
          background: expanded
            ? "linear-gradient(135deg, rgba(14,165,233,0.10) 0%, rgba(6,182,212,0.07) 100%)"
            : undefined,
        }}
      >
        <div className="flex items-center gap-3">
          <LayoutDashboard className="w-5 h-5 text-sky-400" />
          <div className="text-left">
            <span className="font-display font-semibold text-white text-sm">
              {isFr ? "Tableau de bord facade" : "Facade Dashboard"}
            </span>
            <span className="block text-xs text-slate-400">
              {isFr ? "Vue d'ensemble des indicateurs" : "Key metrics overview"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!expanded && totalElements > 0 && (
            <span className="text-xs text-sky-400 font-mono mr-1">
              {totalElements} {isFr ? "elements" : "elements"}
            </span>
          )}
          {expanded
            ? <ChevronUp className="w-5 h-5 text-slate-400" />
            : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </div>
      </button>

      {/* Content */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="fadash-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-2 space-y-4">
              {/* Row 1 : Core KPI cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard
                  label={isFr ? "Fenêtres" : "Windows"}
                  value={windowsCount.toString()}
                  color="#fbbf24"
                  icon="🪟"
                />
                <KpiCard
                  label={isFr ? "Surface fenêtres" : "Windows area"}
                  value={openingsArea > 0 ? `${openingsArea.toFixed(1)} m²` : "—"}
                  color="#22d3ee"
                  icon="📐"
                />
                <KpiCard
                  label={isFr ? "Mur net" : "Net wall"}
                  value={wallArea > 0 ? `${wallArea.toFixed(1)} m²` : "—"}
                  color="#94a3b8"
                  icon="🧱"
                />
                <KpiCard
                  label={isFr ? "Surface totale" : "Total area"}
                  value={facadeArea > 0 ? `${facadeArea.toFixed(1)} m²` : "—"}
                  color="#a78bfa"
                  icon="🏢"
                />
              </div>

              {/* Row 2 : Ratio openings arc + area breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Ratio openings */}
                <div className="glass rounded-xl border border-white/10 p-4 flex items-center gap-4">
                  <RatioArc pct={ratioPct} />
                  <div>
                    <p className="text-xs text-slate-500 mb-1">
                      {isFr ? "Ratio ouvertures" : "Openings ratio"}
                    </p>
                    <p className="text-sm text-slate-300">
                      {ratioPct >= 15 && ratioPct <= 25
                        ? (isFr ? "Conforme RE2020" : "RE2020 compliant")
                        : ratioPct > 40
                        ? (isFr ? "Hors norme" : "Out of range")
                        : (isFr ? "A verifier" : "To check")}
                    </p>
                    <p className="text-[10px] text-slate-600 mt-0.5">
                      {isFr ? "Recommande 15-25%" : "Recommended 15-25%"}
                    </p>
                  </div>
                </div>

                {/* Facade area breakdown */}
                <div className="glass rounded-xl border border-white/10 p-4 md:col-span-2">
                  <p className="text-xs text-slate-500 mb-3">
                    {isFr ? "Repartition des surfaces" : "Area breakdown"}
                  </p>
                  {hasArea ? (
                    <>
                      {/* Stacked bar */}
                      <div className="flex rounded-lg overflow-hidden h-6 mb-3">
                        <div
                          className="h-full transition-all"
                          style={{
                            width: `${facadeArea > 0 ? (wallArea / facadeArea) * 100 : 50}%`,
                            backgroundColor: "#64748b",
                            minWidth: "2px",
                          }}
                          title={`${isFr ? "Surface murale" : "Wall area"}: ${wallArea.toFixed(1)} m²`}
                        />
                        <div
                          className="h-full transition-all"
                          style={{
                            width: `${facadeArea > 0 ? (openingsArea / facadeArea) * 100 : 50}%`,
                            backgroundColor: "#fbbf24",
                            minWidth: "2px",
                          }}
                          title={`${isFr ? "Ouvertures" : "Openings"}: ${openingsArea.toFixed(1)} m²`}
                        />
                      </div>
                      {/* Legend */}
                      <div className="flex flex-wrap gap-4">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="w-2.5 h-2.5 rounded-full bg-slate-500 shrink-0" />
                          <span className="text-slate-400">{isFr ? "Mur" : "Wall"}</span>
                          <span className="text-slate-600 font-mono">{wallArea.toFixed(1)} m²</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: "#fbbf24" }} />
                          <span className="text-slate-400">{isFr ? "Ouvertures" : "Openings"}</span>
                          <span className="text-slate-600 font-mono">{openingsArea.toFixed(1)} m²</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-slate-500">{isFr ? "Total facade" : "Total facade"}:</span>
                          <span className="text-white font-mono font-semibold">{facadeArea.toFixed(1)} m²</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-amber-500">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="text-sm">{isFr ? "Surface non disponible" : "Area not available"}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Row 3 : Element distribution by type */}
              {typeDistribution.length > 0 && (
                <div className="glass rounded-xl border border-white/10 p-4">
                  <p className="text-xs text-slate-500 mb-3">
                    {isFr ? "Distribution par type" : "Distribution by type"}
                  </p>
                  <div className="space-y-2">
                    {typeDistribution.map(({ type, count, label, color }) => (
                      <HBar
                        key={type}
                        label={label}
                        value={count}
                        maxValue={maxTypeCount}
                        color={color}
                      />
                    ))}
                  </div>
                </div>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
