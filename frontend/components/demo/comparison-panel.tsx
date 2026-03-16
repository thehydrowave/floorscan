"use client";

import { useState } from "react";
import { ComparisonResult, PipelineResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Eye, EyeOff, BarChart3, Layers, AlertTriangle, Clock } from "lucide-react";

interface ComparisonPanelProps {
  result: ComparisonResult;
  basePlanB64: string;
  ppm: number | null;
}

const PIPELINE_ORDER = ["A", "B", "C", "D", "E"];

export default function ComparisonPanel({ result, basePlanB64, ppm }: ComparisonPanelProps) {
  const [activeTab, setActiveTab] = useState<"table" | "visual">("table");
  const [selectedPipeline, setSelectedPipeline] = useState<string>("A");
  const [showDoors, setShowDoors] = useState(true);
  const [showWindows, setShowWindows] = useState(true);
  const [showWalls, setShowWalls] = useState(true);
  const [showFootprint, setShowFootprint] = useState(false);
  const [showRooms, setShowRooms] = useState(false);

  const pipeline = result.pipelines[selectedPipeline] as PipelineResult | undefined;
  const table = result.comparison_table;

  // Find best values per column for highlighting
  const bestDoors = Math.max(...table.map(r => r.doors));
  const bestWindows = Math.max(...table.map(r => r.windows));
  const bestRooms = Math.max(...table.map(r => r.rooms));

  return (
    <div className="glass rounded-xl border border-white/10 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-600 text-white">Comparaison multi-modèles</h3>
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
            <BarChart3 className="w-3 h-3 inline mr-1" /> Tableau
          </button>
          <button
            onClick={() => setActiveTab("visual")}
            className={cn(
              "px-3 py-1 rounded-md text-xs font-500 transition-all",
              activeTab === "visual" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"
            )}
          >
            <Layers className="w-3 h-3 inline mr-1" /> Visuel
          </button>
        </div>
      </div>

      {/* ── TABLE VIEW ── */}
      {activeTab === "table" && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-2 px-3 text-slate-500 font-500">Pipeline</th>
                <th className="text-center py-2 px-3 text-slate-500 font-500">Portes</th>
                <th className="text-center py-2 px-3 text-slate-500 font-500">Fenêtres</th>
                <th className="text-center py-2 px-3 text-slate-500 font-500">Emprise (m²)</th>
                <th className="text-center py-2 px-3 text-slate-500 font-500">Pièces</th>
                <th className="text-center py-2 px-3 text-slate-500 font-500">
                  <Clock className="w-3 h-3 inline" /> Temps
                </th>
                <th className="text-center py-2 px-3 text-slate-500 font-500">Statut</th>
              </tr>
            </thead>
            <tbody>
              {table.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer",
                    selectedPipeline === row.id && "bg-white/5"
                  )}
                  onClick={() => { setSelectedPipeline(row.id); setActiveTab("visual"); }}
                >
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: row.color }} />
                      <span className="text-white font-500">{row.name}</span>
                    </div>
                  </td>
                  <td className="text-center py-2.5 px-3">
                    <span className={cn(
                      "font-mono font-600",
                      row.doors === bestDoors && row.doors > 0 ? "text-emerald-400" : "text-slate-300"
                    )}>
                      {row.doors}
                    </span>
                  </td>
                  <td className="text-center py-2.5 px-3">
                    <span className={cn(
                      "font-mono font-600",
                      row.windows === bestWindows && row.windows > 0 ? "text-emerald-400" : "text-slate-300"
                    )}>
                      {row.windows}
                    </span>
                  </td>
                  <td className="text-center py-2.5 px-3">
                    <span className="font-mono font-600 text-slate-300">
                      {row.footprint_m2 != null ? row.footprint_m2.toFixed(1) : "—"}
                    </span>
                  </td>
                  <td className="text-center py-2.5 px-3">
                    <span className={cn(
                      "font-mono font-600",
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
                        <AlertTriangle className="w-3 h-3" /> Erreur
                      </span>
                    ) : (
                      <span className="text-emerald-400">✓</span>
                    )}
                  </td>
                </tr>
              ))}
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
                </button>
              );
            })}
          </div>

          {pipeline && (
            <>
              {/* Pipeline info + mini stats */}
              <div className="flex items-center gap-4 mb-3 text-xs">
                <span className="text-white font-500">{pipeline.name}</span>
                <span className="text-slate-500">{pipeline.description}</span>
                {pipeline.error && (
                  <span className="text-red-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {pipeline.error}
                  </span>
                )}
              </div>

              {/* Mini KPI cards */}
              <div className="grid grid-cols-5 gap-2 mb-4">
                {[
                  { label: "Portes", value: pipeline.doors_count, color: "#D946EF" },
                  { label: "Fenêtres", value: pipeline.windows_count, color: "#22D3EE" },
                  { label: "Emprise", value: pipeline.footprint_area_m2 != null ? `${pipeline.footprint_area_m2.toFixed(1)} m²` : "—", color: "#FBBF24" },
                  { label: "Pièces", value: pipeline.rooms_count, color: "#34D399" },
                  { label: "Temps", value: `${pipeline.timing_seconds}s`, color: "#94a3b8" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-slate-800/50 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-slate-500 mb-0.5">{label}</p>
                    <p className="text-sm font-mono font-600" style={{ color }}>{value}</p>
                  </div>
                ))}
              </div>

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
                    {showDoors ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} Portes
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
                    {showWindows ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} Fenêtres
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
                    {showWalls ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} Murs
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
                    {showFootprint ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} Emprise
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
                    {showRooms ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} Pièces
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
                {showRooms && pipeline.mask_rooms_b64 && (
                  <img
                    src={`data:image/png;base64,${pipeline.mask_rooms_b64}`}
                    alt=""
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ zIndex: 1 }}
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
