"use client";

import { useState } from "react";
import { ComparisonResult, PipelineResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Eye, EyeOff, BarChart3, Layers, AlertTriangle, Clock, Sparkles, Shield, ShieldAlert, Star } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

interface ComparisonPanelProps {
  result: ComparisonResult;
  basePlanB64: string;
  ppm: number | null;
}

const PIPELINE_ORDER = ["H", "G", "F", "A", "B", "C", "D", "E"];

export default function ComparisonPanel({ result, basePlanB64, ppm }: ComparisonPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const [activeTab, setActiveTab] = useState<"table" | "visual">("table");
  const [selectedPipeline, setSelectedPipeline] = useState<string>("G");
  const [showDoors, setShowDoors] = useState(true);
  const [showWindows, setShowWindows] = useState(true);
  const [showWalls, setShowWalls] = useState(true);
  const [showFootprint, setShowFootprint] = useState(false);
  const [showHab, setShowHab] = useState(false);
  const [showRooms, setShowRooms] = useState(false);
  const [showFrenchDoors, setShowFrenchDoors] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(false);

  const pipeline = result.pipelines[selectedPipeline] as PipelineResult | undefined;
  const table = result.comparison_table;

  // Find best values per column for highlighting (exclude F and G from "best" competition)
  const nonConsensusRows = table.filter(r => r.id !== "F" && r.id !== "G");
  const bestDoors = Math.max(...nonConsensusRows.map(r => r.doors));
  const bestWindows = Math.max(...nonConsensusRows.map(r => r.windows));
  const bestRooms = Math.max(...nonConsensusRows.map(r => r.rooms));

  return (
    <div className="glass rounded-xl border border-white/10 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-600 text-white">{d("cmp_title")}</h3>
          <span className="text-[10px] text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
            {result.total_time_seconds}s total
          </span>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 bg-slate-800/50 rounded-lg p-0.5">
          <button
            onClick={() => setActiveTab("table")}
            className={cn(
              "px-3 py-1 rounded-md text-xs font-500 transition-all",
              activeTab === "table" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"
            )}
          >
            <BarChart3 className="w-3 h-3 inline mr-1" /> {d("cmp_table")}
          </button>
          <button
            onClick={() => setActiveTab("visual")}
            className={cn(
              "px-3 py-1 rounded-md text-xs font-500 transition-all",
              activeTab === "visual" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"
            )}
          >
            <Layers className="w-3 h-3 inline mr-1" /> {d("cmp_visual")}
          </button>
        </div>
      </div>

      {/* ── TABLE VIEW ── */}
      {activeTab === "table" && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-2 px-3 text-slate-500 font-500">{d("cmp_pipeline")}</th>
                <th className="text-center py-2 px-3 text-slate-500 font-500">{d("cmp_doors")}</th>
                <th className="text-center py-2 px-3 text-slate-500 font-500">{d("cmp_windows")}</th>
                <th className="text-center py-2 px-3 text-slate-500 font-500">{d("cmp_french_doors_short")}</th>
                <th className="text-center py-2 px-3 text-slate-500 font-500">{d("cmp_footprint")}</th>
                <th className="text-center py-2 px-3 text-slate-500 font-500">{d("cmp_hab")}</th>
                <th className="text-center py-2 px-3 text-slate-500 font-500">{d("cmp_walls_area")}</th>
                <th className="text-center py-2 px-3 text-slate-500 font-500">{d("cmp_rooms")}</th>
                <th className="text-center py-2 px-3 text-slate-500 font-500">
                  <Clock className="w-3 h-3 inline" /> {d("cmp_time")}
                </th>
                <th className="text-center py-2 px-3 text-slate-500 font-500">{d("cmp_status")}</th>
              </tr>
            </thead>
            <tbody>
              {table.map((row) => {
                const isConsensus = row.id === "F";
                const isBestof = row.id === "G";
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer",
                      selectedPipeline === row.id && "bg-white/5",
                      isBestof && "bg-pink-500/5",
                      isConsensus && "bg-teal-500/5"
                    )}
                    onClick={() => { setSelectedPipeline(row.id); setActiveTab("visual"); }}
                  >
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: row.color }} />
                        <span className="text-white font-500">{row.name}</span>
                        {isBestof && (
                          <span className="text-[9px] font-600 text-pink-400 bg-pink-500/15 border border-pink-500/30 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                            <Star className="w-2.5 h-2.5" /> {d("cmp_recommended")}
                          </span>
                        )}
                        {isConsensus && (
                          <span className="text-[9px] font-600 text-teal-400 bg-teal-500/15 border border-teal-500/30 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                            <Sparkles className="w-2.5 h-2.5" /> {d("cmp_consensus")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-center py-2.5 px-3">
                      <span className={cn(
                        "font-mono font-600",
                        isBestof ? "text-pink-400" :
                        isConsensus ? "text-teal-400" :
                        row.doors === bestDoors && row.doors > 0 ? "text-emerald-400" : "text-slate-300"
                      )}>
                        {row.doors}
                      </span>
                    </td>
                    <td className="text-center py-2.5 px-3">
                      <span className={cn(
                        "font-mono font-600",
                        isBestof ? "text-pink-400" :
                        isConsensus ? "text-teal-400" :
                        row.windows === bestWindows && row.windows > 0 ? "text-emerald-400" : "text-slate-300"
                      )}>
                        {row.windows}
                      </span>
                    </td>
                    <td className="text-center py-2.5 px-3">
                      <span className={cn(
                        "font-mono font-600",
                        isBestof && row.french_doors > 0 ? "text-orange-400" : "text-slate-500"
                      )}>
                        {row.french_doors > 0 ? row.french_doors : "\u2014"}
                      </span>
                    </td>
                    <td className="text-center py-2.5 px-3">
                      <span className={cn(
                        "font-mono font-600",
                        isBestof ? "text-pink-400" :
                        isConsensus ? "text-teal-400" : "text-slate-300"
                      )}>
                        {row.footprint_m2 != null ? row.footprint_m2.toFixed(1) : "\u2014"}
                      </span>
                    </td>
                    <td className="text-center py-2.5 px-3">
                      <span className={cn(
                        "font-mono font-600",
                        isBestof ? "text-pink-400" :
                        isConsensus ? "text-teal-400" : "text-slate-300"
                      )}>
                        {row.hab_m2 != null ? row.hab_m2.toFixed(1) : "\u2014"}
                      </span>
                    </td>
                    <td className="text-center py-2.5 px-3">
                      <span className={cn(
                        "font-mono font-600",
                        isBestof ? "text-pink-400" :
                        isConsensus ? "text-teal-400" : "text-slate-300"
                      )}>
                        {row.walls_m2 != null ? row.walls_m2.toFixed(1) : "\u2014"}
                      </span>
                    </td>
                    <td className="text-center py-2.5 px-3">
                      <span className={cn(
                        "font-mono font-600",
                        isBestof ? "text-pink-400" :
                        isConsensus ? "text-teal-400" :
                        row.rooms === bestRooms && row.rooms > 0 ? "text-emerald-400" : "text-slate-300"
                      )}>
                        {row.rooms}
                      </span>
                    </td>
                    <td className="text-center py-2.5 px-3">
                      <span className="font-mono text-slate-500">{row.time_s}s</span>
                    </td>
                    <td className="text-center py-2.5 px-3">
                      {row.error ? (
                        <span className="text-red-400 flex items-center justify-center gap-1" title={row.error}>
                          <AlertTriangle className="w-3 h-3" /> {d("cmp_error")}
                        </span>
                      ) : (
                        <span className="text-emerald-400">{"\u2713"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── VISUAL VIEW ── */}
      {activeTab === "visual" && (
        <div>
          {/* Pipeline selector tabs */}
          <div className="flex gap-1 mb-4 flex-wrap">
            {PIPELINE_ORDER.map((pid) => {
              const p = result.pipelines[pid];
              if (!p) return null;
              const isConsensus = pid === "F";
              const isBestof = pid === "G";
              return (
                <button
                  key={pid}
                  onClick={() => setSelectedPipeline(pid)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-500 border transition-all",
                    selectedPipeline === pid
                      ? "border-white/20 text-white"
                      : "border-transparent text-slate-500 hover:text-slate-300 hover:border-white/10"
                  )}
                  style={selectedPipeline === pid ? { backgroundColor: p.color + "20" } : {}}
                >
                  <span className="w-2 h-2 rounded-full inline-block mr-1.5" style={{ backgroundColor: p.color }} />
                  {pid}
                  {isBestof && selectedPipeline !== pid && (
                    <Star className="w-2.5 h-2.5 inline ml-1 text-pink-400" />
                  )}
                  {isConsensus && selectedPipeline !== pid && (
                    <Sparkles className="w-2.5 h-2.5 inline ml-1 text-teal-400" />
                  )}
                </button>
              );
            })}
          </div>

          {pipeline && (
            <>
              {/* Pipeline info + mini stats */}
              <div className="flex items-center gap-4 mb-3 text-xs">
                <span className="text-white font-500">{pipeline.name}</span>
                {pipeline.is_bestof && (
                  <span className="text-[9px] font-600 text-pink-400 bg-pink-500/15 border border-pink-500/30 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                    <Star className="w-2.5 h-2.5" /> {d("cmp_recommended")}
                  </span>
                )}
                {pipeline.is_consensus && (
                  <span className="text-[9px] font-600 text-teal-400 bg-teal-500/15 border border-teal-500/30 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                    <Sparkles className="w-2.5 h-2.5" /> {d("cmp_consensus")}
                  </span>
                )}
                <span className="text-slate-500">{pipeline.description}</span>
                {pipeline.error && (
                  <span className="text-red-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {pipeline.error}
                  </span>
                )}
              </div>

              {/* Mini KPI cards */}
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mb-4">
                {[
                  { label: d("cmp_doors"), value: pipeline.doors_count, color: "#D946EF" },
                  { label: d("cmp_windows"), value: pipeline.windows_count, color: "#22D3EE" },
                  ...(pipeline.french_doors_count != null && pipeline.french_doors_count > 0
                    ? [{ label: d("cmp_french_doors_short"), value: pipeline.french_doors_count, color: "#F97316" }]
                    : []),
                  { label: d("cmp_footprint_short"), value: pipeline.footprint_area_m2 != null ? `${pipeline.footprint_area_m2.toFixed(1)} m\u00b2` : "\u2014", color: "#FBBF24" },
                  { label: d("cmp_hab_short"), value: pipeline.hab_area_m2 != null ? `${pipeline.hab_area_m2.toFixed(1)} m\u00b2` : "\u2014", color: "#4ADE80" },
                  { label: d("cmp_walls"), value: pipeline.walls_area_m2 != null ? `${pipeline.walls_area_m2.toFixed(1)} m\u00b2` : "\u2014", color: "#60A5FA" },
                  { label: d("cmp_rooms"), value: pipeline.rooms_count, color: "#34D399" },
                  { label: d("cmp_time"), value: `${pipeline.timing_seconds}s`, color: "#94a3b8" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-slate-800/50 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-slate-500 mb-0.5">{label}</p>
                    <p className="text-sm font-mono font-600" style={{ color }}>{value}</p>
                  </div>
                ))}
              </div>

              {/* ── Best-of source models panel ── */}
              {pipeline.is_bestof && pipeline.source_models && !pipeline.error && (
                <div className="bg-pink-500/5 border border-pink-500/20 rounded-lg p-3 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Star className="w-3.5 h-3.5 text-pink-400" />
                    <span className="text-xs font-600 text-pink-400">{d("cmp_bestof_desc")}</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">{d("cmp_walls")} :</span>
                      <span className="font-mono font-600 text-blue-400">{pipeline.source_models.walls}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">{d("cmp_doors")} :</span>
                      <span className="font-mono font-600 text-fuchsia-400">{pipeline.source_models.doors}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">{d("cmp_windows")} :</span>
                      <span className="font-mono font-600 text-cyan-400">{pipeline.source_models.windows}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Consensus details panel ── */}
              {pipeline.is_consensus && !pipeline.error && (
                <div className="bg-teal-500/5 border border-teal-500/20 rounded-lg p-3 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="w-3.5 h-3.5 text-teal-400" />
                    <span className="text-xs font-600 text-teal-400">{d("cmp_details")}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    {/* Confirmed doors */}
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                      <span className="text-slate-400">{d("cmp_doors")}</span>
                      <span className="font-mono font-600 text-emerald-400">{pipeline.doors_count}</span>
                      <span className="text-slate-600">{d("cmp_confirmed").toLowerCase()}</span>
                    </div>
                    {/* Uncertain doors */}
                    {(pipeline.uncertain_doors_count ?? 0) > 0 && (
                      <div className="flex items-center gap-1.5">
                        <ShieldAlert className="w-3 h-3 text-amber-400 flex-shrink-0" />
                        <span className="text-slate-400">{d("cmp_doors")}</span>
                        <span className="font-mono font-600 text-amber-400">{pipeline.uncertain_doors_count}</span>
                        <span className="text-slate-600">{d("cmp_uncertain").toLowerCase()}</span>
                      </div>
                    )}
                    {/* Confirmed windows */}
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                      <span className="text-slate-400">{d("cmp_windows")}</span>
                      <span className="font-mono font-600 text-emerald-400">{pipeline.windows_count}</span>
                      <span className="text-slate-600">{d("cmp_confirmed").toLowerCase()}</span>
                    </div>
                    {/* Uncertain windows */}
                    {(pipeline.uncertain_windows_count ?? 0) > 0 && (
                      <div className="flex items-center gap-1.5">
                        <ShieldAlert className="w-3 h-3 text-amber-400 flex-shrink-0" />
                        <span className="text-slate-400">{d("cmp_windows")}</span>
                        <span className="font-mono font-600 text-amber-400">{pipeline.uncertain_windows_count}</span>
                        <span className="text-slate-600">{d("cmp_uncertain").toLowerCase()}</span>
                      </div>
                    )}
                  </div>

                  {/* Walls fusion info */}
                  {pipeline.models_fused_walls != null && pipeline.models_fused_walls > 0 && (
                    <div className="flex items-center gap-1.5 mt-2 text-xs">
                      <Layers className="w-3 h-3 text-blue-400 flex-shrink-0" />
                      <span className="text-slate-400">{d("cmp_walls")}</span>
                      <span className="font-mono font-600 text-blue-400">{pipeline.models_fused_walls}</span>
                      <span className="text-slate-600">{d("cmp_models_fused")}</span>
                    </div>
                  )}

                  {/* Per-detection agreement badges */}
                  {pipeline.door_details && pipeline.door_details.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {pipeline.door_details.map((det, i) => (
                        <span
                          key={`d${i}`}
                          className={cn(
                            "text-[9px] font-mono px-1.5 py-0.5 rounded-full border",
                            det.confirmed
                              ? det.agreement_count >= 3
                                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                                : "text-yellow-400 bg-yellow-500/10 border-yellow-500/30"
                              : "text-red-400 bg-red-500/10 border-red-500/30"
                          )}
                        >
                          D{i + 1}: {det.agreement_count}/4
                        </span>
                      ))}
                      {pipeline.window_details && pipeline.window_details.map((det, i) => (
                        <span
                          key={`w${i}`}
                          className={cn(
                            "text-[9px] font-mono px-1.5 py-0.5 rounded-full border",
                            det.confirmed
                              ? det.agreement_count >= 3
                                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                                : "text-yellow-400 bg-yellow-500/10 border-yellow-500/30"
                              : "text-red-400 bg-red-500/10 border-red-500/30"
                          )}
                        >
                          W{i + 1}: {det.agreement_count}/4
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Toggle buttons */}
              <div className="flex gap-2 mb-3 flex-wrap">
                {pipeline.mask_doors_b64 && (
                  <button
                    onClick={() => setShowDoors(v => !v)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-500 border transition-all flex items-center gap-1",
                      showDoors ? "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30" : "text-slate-500 border-transparent hover:border-white/10"
                    )}
                  >
                    {showDoors ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("cmp_doors")}
                  </button>
                )}
                {pipeline.mask_windows_b64 && (
                  <button
                    onClick={() => setShowWindows(v => !v)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-500 border transition-all flex items-center gap-1",
                      showWindows ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" : "text-slate-500 border-transparent hover:border-white/10"
                    )}
                  >
                    {showWindows ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("cmp_windows")}
                  </button>
                )}
                {pipeline.mask_french_doors_b64 && (
                  <button
                    onClick={() => setShowFrenchDoors(v => !v)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-500 border transition-all flex items-center gap-1",
                      showFrenchDoors ? "bg-orange-500/15 text-orange-400 border-orange-500/30" : "text-slate-500 border-transparent hover:border-white/10"
                    )}
                  >
                    {showFrenchDoors ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("cmp_french_doors_short")}
                  </button>
                )}
                {pipeline.mask_walls_b64 && (
                  <button
                    onClick={() => setShowWalls(v => !v)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-500 border transition-all flex items-center gap-1",
                      showWalls ? "bg-blue-500/15 text-blue-400 border-blue-500/30" : "text-slate-500 border-transparent hover:border-white/10"
                    )}
                  >
                    {showWalls ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("cmp_walls")}
                  </button>
                )}
                {pipeline.mask_footprint_b64 && (
                  <button
                    onClick={() => setShowFootprint(v => !v)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-500 border transition-all flex items-center gap-1",
                      showFootprint ? "bg-amber-500/15 text-amber-400 border-amber-500/30" : "text-slate-500 border-transparent hover:border-white/10"
                    )}
                  >
                    {showFootprint ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("cmp_footprint_short")}
                  </button>
                )}
                {pipeline.mask_hab_b64 && (
                  <button
                    onClick={() => setShowHab(v => !v)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-500 border transition-all flex items-center gap-1",
                      showHab ? "bg-green-500/15 text-green-400 border-green-500/30" : "text-slate-500 border-transparent hover:border-white/10"
                    )}
                  >
                    {showHab ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("cmp_hab_short")}
                  </button>
                )}
                {pipeline.mask_rooms_b64 && (
                  <button
                    onClick={() => setShowRooms(v => !v)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-500 border transition-all flex items-center gap-1",
                      showRooms ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "text-slate-500 border-transparent hover:border-white/10"
                    )}
                  >
                    {showRooms ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("cmp_rooms")}
                  </button>
                )}
                {/* Agreement heatmap toggle (consensus only) */}
                {pipeline.is_consensus && pipeline.agreement_heatmap_b64 && (
                  <button
                    onClick={() => setShowHeatmap(v => !v)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-500 border transition-all flex items-center gap-1",
                      showHeatmap ? "bg-teal-500/15 text-teal-400 border-teal-500/30" : "text-slate-500 border-transparent hover:border-white/10"
                    )}
                  >
                    {showHeatmap ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("cmp_heatmap")}
                  </button>
                )}
              </div>

              {/* Plan image with mask overlays */}
              <div className="relative rounded-lg overflow-hidden border border-white/10">
                <img
                  src={`data:image/png;base64,${basePlanB64}`}
                  alt="Plan"
                  className="w-full h-auto block"
                  style={{ filter: "brightness(0.72) contrast(1.15) saturate(0.85)" }}
                />
                {showDoors && pipeline.mask_doors_b64 && (
                  <img
                    src={`data:image/png;base64,${pipeline.mask_doors_b64}`}
                    alt=""
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ zIndex: 1 }}
                  />
                )}
                {showWindows && pipeline.mask_windows_b64 && (
                  <img
                    src={`data:image/png;base64,${pipeline.mask_windows_b64}`}
                    alt=""
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ zIndex: 1 }}
                  />
                )}
                {showFrenchDoors && pipeline.mask_french_doors_b64 && (
                  <img
                    src={`data:image/png;base64,${pipeline.mask_french_doors_b64}`}
                    alt=""
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ zIndex: 1 }}
                  />
                )}
                {showWalls && pipeline.mask_walls_b64 && (
                  <img
                    src={`data:image/png;base64,${pipeline.mask_walls_b64}`}
                    alt=""
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ zIndex: 1 }}
                  />
                )}
                {showFootprint && pipeline.mask_footprint_b64 && (
                  <img
                    src={`data:image/png;base64,${pipeline.mask_footprint_b64}`}
                    alt=""
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ zIndex: 1 }}
                  />
                )}
                {showHab && pipeline.mask_hab_b64 && (
                  <img
                    src={`data:image/png;base64,${pipeline.mask_hab_b64}`}
                    alt=""
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ zIndex: 1 }}
                  />
                )}
                {showRooms && pipeline.mask_rooms_b64 && (
                  <img
                    src={`data:image/png;base64,${pipeline.mask_rooms_b64}`}
                    alt=""
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ zIndex: 1 }}
                  />
                )}
                {/* Agreement heatmap overlay (consensus only) */}
                {showHeatmap && pipeline.is_consensus && pipeline.agreement_heatmap_b64 && (
                  <img
                    src={`data:image/png;base64,${pipeline.agreement_heatmap_b64}`}
                    alt=""
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ zIndex: 2 }}
                  />
                )}
              </div>

              {/* Heatmap legend (when visible) */}
              {showHeatmap && pipeline.is_consensus && pipeline.agreement_heatmap_b64 && (
                <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-500">
                  <div className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                    <span>3-4/4</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-yellow-400" />
                    <span>2/4</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-red-500" />
                    <span>1/4 ({d("cmp_uncertain").toLowerCase()})</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
