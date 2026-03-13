"use client";

import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, ChevronDown, ChevronUp, Download, RefreshCw,
  Merge, Scissors, ArrowRight, Eye, EyeOff,
} from "lucide-react";
import { AnalysisResult, Room } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { toast } from "@/components/ui/use-toast";
import {
  detectLots, CoproResult, CoproLot,
  toggleCommonArea, mergeLots,
} from "@/lib/lot-detection";

// ── Props ──────────────────────────────────────────────────────────────────────

interface LotsPanelProps {
  result: AnalysisResult;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmtN = (v: number, digits = 1) => v.toLocaleString("fr-FR", { maximumFractionDigits: digits });

// ── Component ──────────────────────────────────────────────────────────────────

export default function LotsPanel({ result }: LotsPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [expanded, setExpanded] = useState(false);
  const [threshold, setThreshold] = useState(0.02);
  const [showOverlay, setShowOverlay] = useState(true);
  const [selectedLotId, setSelectedLotId] = useState<number | null>(null);
  const [mergeTarget, setMergeTarget] = useState<number | null>(null);

  const rooms = result.rooms ?? [];

  // Auto-detect lots
  const [coproResult, setCoproResult] = useState<CoproResult>(() =>
    detectLots(rooms, threshold)
  );

  // Re-detect when threshold changes
  const handleRedetect = useCallback(() => {
    setCoproResult(detectLots(rooms, threshold));
    setSelectedLotId(null);
    setMergeTarget(null);
  }, [rooms, threshold]);

  // Toggle room between common/private
  const handleToggleCommon = useCallback((roomId: number) => {
    setCoproResult(prev => toggleCommonArea(prev, roomId));
  }, []);

  // Merge two lots
  const handleMerge = useCallback(() => {
    if (selectedLotId !== null && mergeTarget !== null) {
      setCoproResult(prev => mergeLots(prev, selectedLotId, mergeTarget));
      setSelectedLotId(null);
      setMergeTarget(null);
    }
  }, [selectedLotId, mergeTarget]);

  // Export CSV
  const handleExportCSV = useCallback(() => {
    const lines = [
      "FloorScan — État descriptif de division",
      `Date;${new Date().toLocaleDateString("fr-FR")}`,
      "",
      "=== LOTS PRIVATIFS ===",
      "Lot;Pièces;Surface (m²);Tantièmes (/1000)",
      ...coproResult.lots.map(l =>
        `${l.label};${l.rooms.map(r => r.label_fr).join(", ")};${fmtN(l.area_m2)};${l.tantiemes}`
      ),
      "",
      `Total privatif;;${fmtN(coproResult.total_private_m2)};1000`,
      "",
      "=== PARTIES COMMUNES ===",
      "Pièce;Type;Surface (m²)",
      ...coproResult.common_areas.map(r =>
        `${r.label_fr};${r.type};${fmtN(r.area_m2 ?? 0)}`
      ),
      "",
      `Total commun;;${fmtN(coproResult.total_common_m2)}`,
    ];

    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `floorscan_lots_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "CSV exporté ✓", variant: "success" });
  }, [coproResult]);

  // Natural image dimensions for SVG overlay
  const [imgNatural, setImgNatural] = useState({ w: 1, h: 1 });
  const overlayB64 = result.plan_b64 || result.overlay_openings_b64;

  if (rooms.length === 0) return null;

  return (
    <div className="mt-8">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-gradient-to-r from-indigo-600/20 to-purple-500/20 border border-indigo-500/20 hover:border-indigo-500/40 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-indigo-300">
          <Building2 className="w-4 h-4" /> {d("lt_title")}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/40 hidden sm:inline">
            {coproResult.lots.length} lot{coproResult.lots.length > 1 ? "s" : ""} · {fmtN(coproResult.total_private_m2)} m²
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
                  <span className="text-xs text-white/50 whitespace-nowrap">{d("lt_sensitivity")}</span>
                  <input
                    type="range" min={0.005} max={0.08} step={0.005}
                    value={threshold}
                    onChange={e => setThreshold(parseFloat(e.target.value))}
                    className="flex-1 accent-indigo-400 h-1"
                  />
                  <span className="text-xs text-white/40 font-mono w-10">{(threshold * 100).toFixed(1)}%</span>
                </div>
                <button onClick={handleRedetect}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 transition-colors">
                  <RefreshCw className="w-3 h-3" /> {d("lt_redetect")}
                </button>
                <button onClick={() => setShowOverlay(!showOverlay)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-white/5 text-white/50 hover:bg-white/10 transition-colors">
                  {showOverlay ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {d("lt_overlay")}
                </button>
                <button onClick={handleExportCSV}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-white/5 text-white/50 hover:bg-white/10 transition-colors">
                  <Download className="w-3 h-3" /> CSV
                </button>
              </div>

              {/* ── Plan with lot overlay ── */}
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
                      {/* Lot room overlays */}
                      {coproResult.lots.map(lot =>
                        lot.rooms.map(room => (
                          <g key={`lot-${lot.id}-room-${room.id}`}>
                            <rect
                              x={room.bbox_norm.x * imgNatural.w}
                              y={room.bbox_norm.y * imgNatural.h}
                              width={room.bbox_norm.w * imgNatural.w}
                              height={room.bbox_norm.h * imgNatural.h}
                              fill={lot.color}
                              fillOpacity={selectedLotId === lot.id ? 0.4 : 0.2}
                              stroke={lot.color}
                              strokeWidth={selectedLotId === lot.id ? 2.5 : 1.5}
                              rx={2}
                            />
                            {/* Lot label at centroid */}
                            <text
                              x={(room.bbox_norm.x + room.bbox_norm.w / 2) * imgNatural.w}
                              y={(room.bbox_norm.y + room.bbox_norm.h / 2) * imgNatural.h}
                              textAnchor="middle" dominantBaseline="central"
                              fill="white" fontSize={Math.max(10, imgNatural.w * 0.012)}
                              fontWeight="bold" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}
                            >
                              L{lot.id}
                            </text>
                          </g>
                        ))
                      )}
                      {/* Common areas overlays */}
                      {coproResult.common_areas.map(room => (
                        <g key={`common-${room.id}`}>
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
                          <text
                            x={(room.bbox_norm.x + room.bbox_norm.w / 2) * imgNatural.w}
                            y={(room.bbox_norm.y + room.bbox_norm.h / 2) * imgNatural.h}
                            textAnchor="middle" dominantBaseline="central"
                            fill="#94a3b8" fontSize={Math.max(8, imgNatural.w * 0.01)}
                            style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}
                          >
                            PC
                          </text>
                        </g>
                      ))}
                    </svg>
                  )}
                </div>
              )}

              {/* ── Summary KPIs ── */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg bg-indigo-500/10 border border-indigo-500/20 p-3 text-center">
                  <p className="text-2xl font-bold text-indigo-300">{coproResult.lots.length}</p>
                  <p className="text-[10px] text-white/50 uppercase">Lots</p>
                </div>
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-300">{fmtN(coproResult.total_private_m2)} m²</p>
                  <p className="text-[10px] text-white/50 uppercase">{d("lt_private")}</p>
                </div>
                <div className="rounded-lg bg-slate-500/10 border border-slate-500/20 p-3 text-center">
                  <p className="text-2xl font-bold text-slate-300">{fmtN(coproResult.total_common_m2)} m²</p>
                  <p className="text-[10px] text-white/50 uppercase">{d("lt_common")}</p>
                </div>
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-center">
                  <p className="text-2xl font-bold text-amber-300">1000</p>
                  <p className="text-[10px] text-white/50 uppercase">{d("lt_tantiemes")}</p>
                </div>
              </div>

              {/* ── Lots table ── */}
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-white/50 uppercase">{d("lt_private")} — {coproResult.lots.length} lot{coproResult.lots.length > 1 ? "s" : ""}</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-white/50 border-b border-white/10">
                        <th className="text-left py-2 px-2">{d("lt_lot")}</th>
                        <th className="text-left py-2 px-2">{d("lt_composition")}</th>
                        <th className="text-center py-2 px-2">{d("lt_area")}</th>
                        <th className="text-center py-2 px-2">{d("lt_tantiemes")}</th>
                        <th className="text-center py-2 px-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {coproResult.lots.map(lot => (
                        <tr
                          key={lot.id}
                          className={`border-b border-white/5 transition-colors cursor-pointer ${
                            selectedLotId === lot.id ? "bg-indigo-500/10" : "hover:bg-white/5"
                          }`}
                          onClick={() => setSelectedLotId(selectedLotId === lot.id ? null : lot.id)}
                        >
                          <td className="py-2 px-2">
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded" style={{ backgroundColor: lot.color }} />
                              <span className="text-white font-medium">{lot.label}</span>
                            </div>
                          </td>
                          <td className="py-2 px-2 text-white/70">
                            <div className="flex flex-wrap gap-1">
                              {lot.rooms.map(r => (
                                <span key={r.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5 text-[10px]">
                                  {r.label_fr}
                                  <button
                                    onClick={e => { e.stopPropagation(); handleToggleCommon(r.id); }}
                                    className="text-slate-400 hover:text-amber-400 ml-0.5"
                                    title={d("lt_to_common")}
                                  >
                                    <ArrowRight className="w-2.5 h-2.5" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="text-center py-2 px-2 text-white/80 font-mono">{fmtN(lot.area_m2)} m²</td>
                          <td className="text-center py-2 px-2">
                            <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono font-semibold text-xs">
                              {lot.tantiemes}‰
                            </span>
                          </td>
                          <td className="text-center py-2 px-2">
                            {selectedLotId === lot.id && coproResult.lots.length > 1 && (
                              <div className="flex items-center justify-center gap-1">
                                {mergeTarget === null ? (
                                  <button onClick={e => { e.stopPropagation(); setMergeTarget(lot.id); }}
                                    className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5"
                                    title={d("lt_merge")}>
                                    <Merge className="w-3 h-3" /> {d("lt_merge")}
                                  </button>
                                ) : mergeTarget !== lot.id ? (
                                  <button onClick={e => { e.stopPropagation(); handleMerge(); }}
                                    className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5">
                                    <Merge className="w-3 h-3" /> Fusionner ici
                                  </button>
                                ) : (
                                  <span className="text-[10px] text-amber-400">Cliquez un autre lot...</span>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                      {/* Totals row */}
                      <tr className="text-indigo-300 font-semibold">
                        <td className="py-2 px-2">{d("lt_total")}</td>
                        <td className="py-2 px-2 text-white/50">
                          {coproResult.lots.reduce((s, l) => s + l.rooms.length, 0)} {d("lt_rooms")}
                        </td>
                        <td className="text-center py-2 px-2 font-mono">{fmtN(coproResult.total_private_m2)} m²</td>
                        <td className="text-center py-2 px-2 font-mono">1000‰</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Common areas ── */}
              {coproResult.common_areas.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-white/50 uppercase">{d("lt_common")}</h4>
                  <div className="flex flex-wrap gap-2">
                    {coproResult.common_areas.map(room => (
                      <div key={room.id}
                        className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-500/10 border border-slate-500/20 text-xs text-white/60">
                        <span>{room.label_fr}</span>
                        <span className="text-white/30">{fmtN(room.area_m2 ?? 0)} m²</span>
                        <button
                          onClick={() => handleToggleCommon(room.id)}
                          className="text-emerald-400/60 hover:text-emerald-400 ml-1"
                          title={d("lt_to_private")}
                        >
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Tantièmes bar chart ── */}
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-white/50 uppercase">{d("lt_tantiemes")} — répartition visuelle</h4>
                <div className="flex gap-px rounded overflow-hidden h-8">
                  {coproResult.lots.map(lot => (
                    <div
                      key={lot.id}
                      className="h-full flex items-center justify-center text-[10px] font-bold transition-all cursor-pointer hover:opacity-80"
                      style={{
                        width: `${lot.tantiemes / 10}%`,
                        backgroundColor: lot.color,
                        color: "white",
                        textShadow: "0 1px 2px rgba(0,0,0,0.5)",
                      }}
                      onClick={() => setSelectedLotId(selectedLotId === lot.id ? null : lot.id)}
                      title={`${lot.label}: ${lot.tantiemes}‰ (${fmtN(lot.area_m2)} m²)`}
                    >
                      {lot.tantiemes >= 50 && `L${lot.id}`}
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-3">
                  {coproResult.lots.map(lot => (
                    <div key={lot.id} className="flex items-center gap-1 text-[10px] text-white/50">
                      <div className="w-2 h-2 rounded" style={{ backgroundColor: lot.color }} />
                      {lot.label}: {lot.tantiemes}‰
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
