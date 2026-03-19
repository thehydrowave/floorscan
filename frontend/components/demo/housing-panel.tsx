"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home, ChevronDown, ChevronUp, Download, RefreshCw,
  Merge, Eye, EyeOff, ArrowRight, Check, AlertTriangle, X as XIcon,
  Bath, UtensilsCrossed, DoorOpen,
} from "lucide-react";
import { AnalysisResult, Room } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { toast } from "@/components/ui/use-toast";
import {
  detectHousings, HousingResult, Housing,
  toggleCirculation, mergeHousings,
} from "@/lib/housing-detection";

// ── Props ──────────────────────────────────────────────────────────────────────

interface HousingPanelProps {
  result: AnalysisResult;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmtN = (v: number, d = 1) => v.toLocaleString("fr-FR", { maximumFractionDigits: d });

/** Color by typology for badges */
const TYPO_COLORS: Record<string, string> = {
  studio: "#94a3b8",  // slate
  T1:     "#60a5fa",  // blue
  T1bis:  "#818cf8",  // indigo
  T2:     "#34d399",  // emerald
  T2bis:  "#10b981",  // green
  T3:     "#fbbf24",  // amber
  T3bis:  "#f59e0b",  // yellow
  T4:     "#f97316",  // orange
  T4bis:  "#fb923c",  // orange light
  "T5+":  "#ef4444",  // red
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function HousingPanel({ result }: HousingPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [expanded, setExpanded] = useState(false);
  const [threshold, setThreshold] = useState(0.02);
  const [showOverlay, setShowOverlay] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mergeTarget, setMergeTarget] = useState<number | null>(null);

  const rooms = result.rooms ?? [];

  // Auto-detect
  const [housingResult, setHousingResult] = useState<HousingResult>(() =>
    detectHousings(rooms, threshold)
  );

  // Re-detect
  const handleRedetect = useCallback(() => {
    setHousingResult(detectHousings(rooms, threshold));
    setSelectedId(null);
    setMergeTarget(null);
  }, [rooms, threshold]);

  // Toggle circulation
  const handleToggleCirc = useCallback((roomId: number) => {
    setHousingResult(prev => toggleCirculation(prev, roomId));
  }, []);

  // Merge
  const handleMerge = useCallback(() => {
    if (selectedId !== null && mergeTarget !== null) {
      setHousingResult(prev => mergeHousings(prev, selectedId, mergeTarget));
      setSelectedId(null);
      setMergeTarget(null);
    }
  }, [selectedId, mergeTarget]);

  // Export CSV
  const handleExportCSV = useCallback(() => {
    const lines = [
      "FloorScan — Détection de logements",
      `Date;${new Date().toLocaleDateString("fr-FR")}`,
      "",
      "=== LOGEMENTS ===",
      "Logement;Typologie;Pièces principales;Pièces de service;Surface hab. (m²);Habitable",
      ...housingResult.housings.map(h =>
        `${h.label};${h.typology};${h.main_rooms.map(r => r.label_fr).join(", ")};${h.service_rooms.map(r => r.label_fr).join(", ")};${fmtN(h.area_hab_m2)};${h.is_habitable ? "Oui" : "Non"}`
      ),
      "",
      `Total;;;${housingResult.total_housings} logements;${fmtN(housingResult.total_hab_m2)} m²;${housingResult.habitability_rate}% habitables`,
      "",
      "=== REPARTITION TYPOLOGIQUE ===",
      "Type;Nombre",
      ...Object.entries(housingResult.typology_distribution).map(([k, v]) => `${k};${v}`),
      "",
      "=== CIRCULATIONS COMMUNES ===",
      "Pièce;Type;Surface (m²)",
      ...housingResult.circulation.map(r =>
        `${r.label_fr};${r.type};${fmtN(r.area_m2 ?? 0)}`
      ),
    ];

    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `floorscan_logements_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: d("hsg_csv_exported" as DTKey), variant: "success" });
  }, [housingResult, d]);

  // Natural image dimensions for SVG overlay
  const [imgNatural, setImgNatural] = useState({ w: 1, h: 1 });
  const overlayB64 = result.plan_b64 || result.overlay_openings_b64;

  if (rooms.length === 0) return null;

  const hr = housingResult;

  return (
    <div className="mt-8">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-gradient-to-r from-blue-600/20 to-teal-500/20 border border-blue-500/20 hover:border-blue-500/40 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-blue-300">
          <Home className="w-4 h-4" /> {d("hsg_title" as DTKey)}
          <span className="text-[10px] bg-sky-500/20 border border-sky-500/30 rounded px-1.5 py-0.5 font-semibold text-sky-400 uppercase tracking-wider">
            {d("hsg_wip" as DTKey)}
          </span>
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/40 hidden sm:inline">
            {hr.total_housings} {d("hsg_unit" as DTKey)}{hr.total_housings > 1 ? "s" : ""} · {fmtN(hr.total_hab_m2)} m²
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="mt-2 rounded-xl bg-white/[0.03] border border-white/10 p-4 space-y-4">

              {/* ── Controls bar ── */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                  <span className="text-xs text-white/50 whitespace-nowrap">{d("hsg_sensitivity" as DTKey)}</span>
                  <input
                    type="range" min={0.005} max={0.08} step={0.005}
                    value={threshold}
                    onChange={e => setThreshold(parseFloat(e.target.value))}
                    className="flex-1 accent-blue-400 h-1"
                  />
                  <span className="text-xs text-white/40 font-mono w-10">{(threshold * 100).toFixed(1)}%</span>
                </div>
                <button onClick={handleRedetect}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors">
                  <RefreshCw className="w-3 h-3" /> {d("hsg_redetect" as DTKey)}
                </button>
                <button onClick={() => setShowOverlay(!showOverlay)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-white/5 text-white/50 hover:bg-white/10 transition-colors">
                  {showOverlay ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {d("hsg_overlay" as DTKey)}
                </button>
                <button onClick={handleExportCSV}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-white/5 text-white/50 hover:bg-white/10 transition-colors">
                  <Download className="w-3 h-3" /> CSV
                </button>
              </div>

              {/* ── Plan with housing overlay ── */}
              {overlayB64 && (
                <div className="relative rounded-lg overflow-hidden bg-black/20">
                  <img
                    src={overlayB64}
                    alt="plan"
                    className="w-full max-h-[400px] object-contain"
                    onLoad={e => {
                      const img = e.target as HTMLImageElement;
                      setImgNatural({ w: img.naturalWidth, h: img.naturalHeight });
                    }}
                  />
                  {showOverlay && (
                    <svg
                      className="absolute inset-0 w-full h-full pointer-events-none"
                      viewBox={`0 0 ${imgNatural.w} ${imgNatural.h}`}
                      preserveAspectRatio="xMidYMid meet"
                    >
                      {/* Housing overlays */}
                      {hr.housings.map(h =>
                        h.rooms.map(room => (
                          <g key={`hsg-${h.id}-room-${room.id}`}>
                            <rect
                              x={room.bbox_norm.x * imgNatural.w}
                              y={room.bbox_norm.y * imgNatural.h}
                              width={room.bbox_norm.w * imgNatural.w}
                              height={room.bbox_norm.h * imgNatural.h}
                              fill={h.color}
                              fillOpacity={selectedId === h.id ? 0.4 : 0.2}
                              stroke={h.color}
                              strokeWidth={selectedId === h.id ? 2.5 : 1.5}
                              rx={2}
                            />
                          </g>
                        ))
                      )}
                      {/* Housing labels at centroid of bounding box of all rooms */}
                      {hr.housings.map(h => {
                        const minX = Math.min(...h.rooms.map(r => r.bbox_norm.x));
                        const minY = Math.min(...h.rooms.map(r => r.bbox_norm.y));
                        const maxX = Math.max(...h.rooms.map(r => r.bbox_norm.x + r.bbox_norm.w));
                        const maxY = Math.max(...h.rooms.map(r => r.bbox_norm.y + r.bbox_norm.h));
                        const cx = ((minX + maxX) / 2) * imgNatural.w;
                        const cy = ((minY + maxY) / 2) * imgNatural.h;
                        return (
                          <g key={`hsg-label-${h.id}`}>
                            {/* Background pill */}
                            <rect
                              x={cx - imgNatural.w * 0.025}
                              y={cy - imgNatural.h * 0.015}
                              width={imgNatural.w * 0.05}
                              height={imgNatural.h * 0.03}
                              rx={imgNatural.w * 0.005}
                              fill="rgba(0,0,0,0.7)"
                            />
                            <text
                              x={cx} y={cy}
                              textAnchor="middle" dominantBaseline="central"
                              fill="white" fontSize={Math.max(10, imgNatural.w * 0.012)}
                              fontWeight="bold"
                            >
                              {h.typology}
                            </text>
                          </g>
                        );
                      })}
                      {/* Circulation overlays */}
                      {hr.circulation.map(room => (
                        <g key={`circ-${room.id}`}>
                          <rect
                            x={room.bbox_norm.x * imgNatural.w}
                            y={room.bbox_norm.y * imgNatural.h}
                            width={room.bbox_norm.w * imgNatural.w}
                            height={room.bbox_norm.h * imgNatural.h}
                            fill="#94a3b8"
                            fillOpacity={0.15}
                            stroke="#94a3b8"
                            strokeWidth={1}
                            strokeDasharray="4 2"
                            rx={2}
                          />
                        </g>
                      ))}
                    </svg>
                  )}
                </div>
              )}

              {/* ── Summary KPIs ── */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 text-center">
                  <p className="text-2xl font-bold text-blue-300">{hr.total_housings}</p>
                  <p className="text-[10px] text-white/50 uppercase">{d("hsg_unit" as DTKey)}s</p>
                </div>
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-300">{fmtN(hr.total_hab_m2)} m²</p>
                  <p className="text-[10px] text-white/50 uppercase">{d("hsg_hab_area" as DTKey)}</p>
                </div>
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-center">
                  <p className="text-2xl font-bold text-amber-300">{fmtN(hr.avg_area_m2)} m²</p>
                  <p className="text-[10px] text-white/50 uppercase">{d("hsg_avg_area" as DTKey)}</p>
                </div>
                <div className="rounded-lg bg-teal-500/10 border border-teal-500/20 p-3 text-center">
                  <p className="text-2xl font-bold text-teal-300">{hr.habitability_rate}%</p>
                  <p className="text-[10px] text-white/50 uppercase">{d("hsg_habitability" as DTKey)}</p>
                </div>
              </div>

              {/* ── Typology distribution bar ── */}
              {Object.keys(hr.typology_distribution).length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-white/50 uppercase">{d("hsg_distribution" as DTKey)}</h4>
                  <div className="flex gap-px rounded overflow-hidden h-10">
                    {Object.entries(hr.typology_distribution)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([typo, count]) => {
                        const pct = (count / hr.total_housings) * 100;
                        return (
                          <div
                            key={typo}
                            className="h-full flex items-center justify-center text-xs font-bold transition-all"
                            style={{
                              width: `${pct}%`,
                              minWidth: "40px",
                              backgroundColor: TYPO_COLORS[typo] ?? "#64748b",
                              color: "white",
                              textShadow: "0 1px 2px rgba(0,0,0,0.5)",
                            }}
                            title={`${typo}: ${count} logement(s) (${pct.toFixed(0)}%)`}
                          >
                            {typo} ({count})
                          </div>
                        );
                      })}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(hr.typology_distribution)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([typo, count]) => (
                        <div key={typo} className="flex items-center gap-1 text-[10px] text-white/50">
                          <div className="w-2.5 h-2.5 rounded" style={{ backgroundColor: TYPO_COLORS[typo] ?? "#64748b" }} />
                          {typo}: {count}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* ── Housing table ── */}
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-white/50 uppercase">
                  {d("hsg_details" as DTKey)} — {hr.total_housings} {d("hsg_unit" as DTKey)}{hr.total_housings > 1 ? "s" : ""}
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-white/50 border-b border-white/10">
                        <th className="text-left py-2 px-2">{d("hsg_unit" as DTKey)}</th>
                        <th className="text-center py-2 px-2">{d("hsg_typo" as DTKey)}</th>
                        <th className="text-left py-2 px-2">{d("hsg_composition" as DTKey)}</th>
                        <th className="text-center py-2 px-2">{d("hsg_area" as DTKey)}</th>
                        <th className="text-center py-2 px-2">{d("hsg_status" as DTKey)}</th>
                        <th className="text-center py-2 px-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hr.housings.map(h => (
                        <tr
                          key={h.id}
                          className={`border-b border-white/5 transition-colors cursor-pointer ${
                            selectedId === h.id ? "bg-blue-500/10" : "hover:bg-white/5"
                          }`}
                          onClick={() => setSelectedId(selectedId === h.id ? null : h.id)}
                        >
                          {/* Label + color */}
                          <td className="py-2 px-2">
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded" style={{ backgroundColor: h.color }} />
                              <span className="text-white font-medium">{h.label}</span>
                            </div>
                          </td>

                          {/* Typology badge */}
                          <td className="text-center py-2 px-2">
                            <span
                              className="px-2 py-0.5 rounded font-mono font-bold text-xs"
                              style={{
                                backgroundColor: (TYPO_COLORS[h.typology] ?? "#64748b") + "33",
                                color: TYPO_COLORS[h.typology] ?? "#94a3b8",
                              }}
                            >
                              {h.typology}
                            </span>
                          </td>

                          {/* Composition */}
                          <td className="py-2 px-2 text-white/70">
                            <div className="flex flex-wrap gap-1">
                              {h.rooms.map(r => {
                                const isMain = h.main_rooms.some(m => m.id === r.id);
                                return (
                                  <span
                                    key={r.id}
                                    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] ${
                                      isMain ? "bg-blue-500/10 text-blue-300" : "bg-white/5 text-white/50"
                                    }`}
                                    title={`${r.label_fr} — ${r.area_m2 ? r.area_m2.toFixed(1) + " m²" : "?"}`}
                                  >
                                    {r.label_fr}
                                    {r.area_m2 && <span className="text-white/30 ml-0.5">{r.area_m2.toFixed(0)}</span>}
                                  </span>
                                );
                              })}
                            </div>
                          </td>

                          {/* Area */}
                          <td className="text-center py-2 px-2 text-white/80 font-mono">
                            {fmtN(h.area_hab_m2)} m²
                          </td>

                          {/* Habitability status */}
                          <td className="text-center py-2 px-2">
                            <div className="flex items-center justify-center gap-1.5">
                              {h.is_habitable ? (
                                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-medium">
                                  <Check className="w-3 h-3" /> {d("hsg_ok" as DTKey)}
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-medium"
                                  title={h.habitability.filter(c => !c.passed).map(c => c.detail).join("\n")}
                                >
                                  <AlertTriangle className="w-3 h-3" /> {h.habitability.filter(c => !c.passed).length} {d("hsg_issues" as DTKey)}
                                </span>
                              )}
                              {/* Icons for bathroom & kitchen */}
                              <span className={`${h.has_bathroom ? "text-cyan-400" : "text-white/20"}`} title={h.has_bathroom ? "SdB/WC" : "Pas de SdB"}>
                                <Bath className="w-3 h-3" />
                              </span>
                              <span className={`${h.has_kitchen ? "text-amber-400" : "text-white/20"}`} title={h.has_kitchen ? "Cuisine" : "Pas de cuisine"}>
                                <UtensilsCrossed className="w-3 h-3" />
                              </span>
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="text-center py-2 px-2">
                            {selectedId === h.id && hr.housings.length > 1 && (
                              <div className="flex items-center justify-center gap-1">
                                {mergeTarget === null ? (
                                  <button onClick={e => { e.stopPropagation(); setMergeTarget(h.id); }}
                                    className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5"
                                    title={d("hsg_merge" as DTKey)}>
                                    <Merge className="w-3 h-3" /> {d("hsg_merge" as DTKey)}
                                  </button>
                                ) : mergeTarget !== h.id ? (
                                  <button onClick={e => { e.stopPropagation(); handleMerge(); }}
                                    className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5">
                                    <Merge className="w-3 h-3" /> {d("hsg_merge_here" as DTKey)}
                                  </button>
                                ) : (
                                  <span className="text-[10px] text-amber-400">{d("hsg_merge_pick" as DTKey)}</span>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Expanded habitability details for selected housing ── */}
              {selectedId && (() => {
                const sel = hr.housings.find(h => h.id === selectedId);
                if (!sel) return null;
                return (
                  <div className="rounded-lg bg-white/[0.02] border border-white/10 p-3 space-y-2">
                    <h4 className="text-xs font-semibold text-white/70 flex items-center gap-2">
                      <DoorOpen className="w-3.5 h-3.5 text-blue-400" />
                      {sel.label} — {d("hsg_habitability_detail" as DTKey)}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {sel.habitability.map((check, i) => (
                        <div
                          key={i}
                          className={`flex items-start gap-2 px-3 py-2 rounded text-xs ${
                            check.passed
                              ? "bg-emerald-500/10 border border-emerald-500/20"
                              : "bg-red-500/10 border border-red-500/20"
                          }`}
                        >
                          {check.passed ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                          ) : (
                            <XIcon className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                          )}
                          <span className={check.passed ? "text-emerald-300" : "text-red-300"}>
                            {check.detail}
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Room list with toggle buttons */}
                    <div className="flex flex-wrap gap-1 mt-2">
                      {sel.rooms.map(r => {
                        const isMain = sel.main_rooms.some(m => m.id === r.id);
                        return (
                          <span
                            key={r.id}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] ${
                              isMain ? "bg-blue-500/15 text-blue-300 border border-blue-500/20" : "bg-white/5 text-white/50 border border-white/5"
                            }`}
                          >
                            {r.label_fr}
                            {r.area_m2 && <span className="text-white/30">{r.area_m2.toFixed(1)} m²</span>}
                            <button
                              onClick={() => handleToggleCirc(r.id)}
                              className="text-slate-400 hover:text-amber-400 ml-0.5"
                              title={d("hsg_to_circ" as DTKey)}
                            >
                              <ArrowRight className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ── Circulation / Common areas ── */}
              {hr.circulation.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-white/50 uppercase">{d("hsg_circulation" as DTKey)}</h4>
                  <div className="flex flex-wrap gap-2">
                    {hr.circulation.map(room => (
                      <div key={room.id}
                        className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-500/10 border border-slate-500/20 text-xs text-white/60">
                        <span>{room.label_fr}</span>
                        <span className="text-white/30">{fmtN(room.area_m2 ?? 0)} m²</span>
                        <button
                          onClick={() => handleToggleCirc(room.id)}
                          className="text-emerald-400/60 hover:text-emerald-400 ml-1"
                          title={d("hsg_to_housing" as DTKey)}
                        >
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
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
