"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  BarChart3, ArrowRight, RotateCcw, Download, Eye, EyeOff,
  AlertTriangle, Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FacadeAnalysisResult, FacadeElement } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

/* ── Colors per element type ── */
const TYPE_COLORS: Record<string, string> = {
  window:     "#60a5fa",
  door:       "#f472b6",
  balcony:    "#34d399",
  floor_line: "#fb923c",
  roof:       "#a78bfa",
  column:     "#94a3b8",
  other:      "#fbbf24",
};

function getColor(type: string) {
  return TYPE_COLORS[type] ?? "#94a3b8";
}

/* ── i18n key for element type ── */
const TYPE_I18N: Record<string, DTKey> = {
  window:     "fa_window",
  door:       "fa_door",
  balcony:    "fa_balcony",
  floor_line: "fa_floor_line",
  roof:       "fa_roof",
  column:     "fa_column",
  other:      "fa_other",
};

interface FacadeResultsStepProps {
  result: FacadeAnalysisResult;
  onGoEditor: () => void;
  onRestart: () => void;
}

export default function FacadeResultsStep({ result, onGoEditor, onRestart }: FacadeResultsStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  // Overlay toggles
  const [showWindows, setShowWindows] = useState(true);
  const [showDoors, setShowDoors] = useState(true);
  const [showBalconies, setShowBalconies] = useState(true);
  const [showFloorLines, setShowFloorLines] = useState(true);

  // Image natural dimensions
  const [imgNat, setImgNat] = useState({ w: 800, h: 600 });
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!result.plan_b64) return;
    const img = new Image();
    img.onload = () => setImgNat({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = `data:image/png;base64,${result.plan_b64}`;
  }, [result.plan_b64]);

  // Group elements by floor level
  const floorLevels = [...new Set(result.elements.map(e => e.floor_level ?? 0))].sort((a, b) => b - a);

  const floorData = floorLevels.map(level => {
    const els = result.elements.filter(e => (e.floor_level ?? 0) === level);
    return {
      level,
      label: level === 0 ? d("fa_rdc") : `${d("fa_floor_level")} ${level}`,
      windows: els.filter(e => e.type === "window").length,
      doors: els.filter(e => e.type === "door").length,
      balconies: els.filter(e => e.type === "balcony").length,
    };
  });

  // Filter visible elements
  const visibleElements = result.elements.filter(e => {
    if (e.type === "window" && !showWindows) return false;
    if (e.type === "door" && !showDoors) return false;
    if (e.type === "balcony" && !showBalconies) return false;
    if (e.type === "floor_line" && !showFloorLines) return false;
    return true;
  });

  // CSV export
  const exportCSV = () => {
    const BOM = "\uFEFF";
    const header = `${d("fa_element")};${d("fa_type")};${d("fa_floor_level")};X;Y;W;H;${d("fa_facade_area")} (m²)`;
    const rows = result.elements.map(e =>
      `${e.id};${d(TYPE_I18N[e.type] ?? "fa_other")};${e.floor_level ?? 0};${e.bbox_norm.x.toFixed(3)};${e.bbox_norm.y.toFixed(3)};${e.bbox_norm.w.toFixed(3)};${e.bbox_norm.h.toFixed(3)};${e.area_m2?.toFixed(2) ?? "-"}`
    );
    const csv = BOM + [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "facade_analysis.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: d("fa_export_csv"), variant: "success" });
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-5xl mx-auto">
      {/* Mock warning */}
      {result.is_mock && (
        <div className="mb-6 glass rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300/80">{d("fa_mock_warn")}</p>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { icon: "🪟", value: result.windows_count, label: d("fa_windows"), color: "text-blue-400" },
          { icon: "🚪", value: result.doors_count, label: d("fa_doors"), color: "text-pink-400" },
          { icon: "🏗️", value: result.balconies_count, label: d("fa_balconies"), color: "text-emerald-400" },
          { icon: "📐", value: result.floors_count, label: d("fa_floors"), color: "text-orange-400" },
        ].map(({ icon, value, label, color }) => (
          <div key={label} className="glass rounded-xl border border-white/10 p-4 text-center">
            <span className="text-2xl">{icon}</span>
            <div className={cn("text-2xl font-display font-700 mt-1", color)}>{value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Toggle buttons */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { key: "fa_toggle_windows" as DTKey, on: showWindows, set: setShowWindows, color: "#60a5fa" },
          { key: "fa_toggle_doors" as DTKey, on: showDoors, set: setShowDoors, color: "#f472b6" },
          { key: "fa_toggle_balconies" as DTKey, on: showBalconies, set: setShowBalconies, color: "#34d399" },
          { key: "fa_toggle_floors" as DTKey, on: showFloorLines, set: setShowFloorLines, color: "#fb923c" },
        ].map(({ key, on, set, color }) => (
          <button
            key={key}
            onClick={() => set(!on)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
              on
                ? "border-white/20 bg-white/5 text-white"
                : "border-white/5 bg-transparent text-slate-600"
            )}
          >
            {on ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: on ? color : "#475569" }} />
            {d(key)}
          </button>
        ))}
      </div>

      {/* Image + SVG overlay */}
      <div className="glass rounded-2xl border border-white/10 p-2 mb-8 relative overflow-hidden">
        <div className="relative">
          <img
            ref={imgRef}
            src={`data:image/png;base64,${result.plan_b64}`}
            alt="Facade plan"
            className="w-full rounded-xl"
            onLoad={(e) => {
              const img = e.currentTarget;
              setImgNat({ w: img.naturalWidth, h: img.naturalHeight });
            }}
          />
          {/* SVG overlay */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${imgNat.w} ${imgNat.h}`}
            preserveAspectRatio="xMidYMid meet"
          >
            {visibleElements.map(el => {
              const x = el.bbox_norm.x * imgNat.w;
              const y = el.bbox_norm.y * imgNat.h;
              const w = el.bbox_norm.w * imgNat.w;
              const h = el.bbox_norm.h * imgNat.h;
              const color = getColor(el.type);

              if (el.type === "floor_line") {
                return (
                  <g key={el.id}>
                    <line
                      x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2}
                      stroke={color} strokeWidth="2" strokeDasharray="8 4"
                      opacity="0.8"
                    />
                  </g>
                );
              }

              return (
                <g key={el.id}>
                  <rect
                    x={x} y={y} width={w} height={h}
                    fill={`${color}20`} stroke={color} strokeWidth="1.5"
                    rx="2"
                  />
                  <text
                    x={x + w / 2} y={y - 4}
                    textAnchor="middle" fill={color}
                    fontSize={Math.max(8, Math.min(12, imgNat.w * 0.012))}
                    fontFamily="monospace" fontWeight="bold"
                  >
                    {d(TYPE_I18N[el.type] ?? "fa_other")}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Per-floor table */}
      <div className="glass rounded-2xl border border-white/10 p-6 mb-8">
        <h3 className="font-display text-lg font-700 text-white mb-4 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-amber-400" />
          {d("fa_per_floor")}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-white/5">
                <th className="text-left py-2 px-3 font-medium">{d("fa_floor_level")}</th>
                <th className="text-center py-2 px-3 font-medium">{d("fa_windows")}</th>
                <th className="text-center py-2 px-3 font-medium">{d("fa_doors")}</th>
                <th className="text-center py-2 px-3 font-medium">{d("fa_balconies")}</th>
              </tr>
            </thead>
            <tbody>
              {floorData.map(f => (
                <tr key={f.level} className="border-b border-white/5 hover:bg-white/2">
                  <td className="py-2.5 px-3 text-white font-medium">{f.label}</td>
                  <td className="py-2.5 px-3 text-center text-blue-400 font-mono">{f.windows}</td>
                  <td className="py-2.5 px-3 text-center text-pink-400 font-mono">{f.doors}</td>
                  <td className="py-2.5 px-3 text-center text-emerald-400 font-mono">{f.balconies}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Surfaces */}
      <div className="glass rounded-2xl border border-white/10 p-6 mb-8">
        <h3 className="font-display text-lg font-700 text-white mb-4">Surfaces</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="glass rounded-xl border border-white/5 p-4 text-center">
            <div className="text-xs text-slate-500 mb-1">{d("fa_facade_area")}</div>
            <div className="text-xl font-display font-700 text-white">
              {result.facade_area_m2 != null ? `${result.facade_area_m2.toFixed(1)} m²` : "—"}
            </div>
          </div>
          <div className="glass rounded-xl border border-white/5 p-4 text-center">
            <div className="text-xs text-slate-500 mb-1">{d("fa_openings_area")}</div>
            <div className="text-xl font-display font-700 text-blue-400">
              {result.openings_area_m2 != null ? `${result.openings_area_m2.toFixed(1)} m²` : "—"}
              {result.ratio_openings != null && (
                <span className="text-sm text-slate-500 ml-1">({(result.ratio_openings * 100).toFixed(0)}%)</span>
              )}
            </div>
          </div>
          <div className="glass rounded-xl border border-white/5 p-4 text-center">
            <div className="text-xs text-slate-500 mb-1">{d("fa_solid_area")}</div>
            <div className="text-xl font-display font-700 text-emerald-400">
              {result.facade_area_m2 != null && result.openings_area_m2 != null
                ? `${(result.facade_area_m2 - result.openings_area_m2).toFixed(1)} m²`
                : "—"}
              {result.ratio_openings != null && (
                <span className="text-sm text-slate-500 ml-1">({((1 - result.ratio_openings) * 100).toFixed(0)}%)</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 justify-center">
        <Button variant="outline" onClick={exportCSV}>
          <Download className="w-4 h-4" /> {d("fa_export_csv")}
        </Button>
        <Button onClick={onGoEditor} className="bg-amber-600 hover:bg-amber-700">
          {d("fa_go_editor")} <ArrowRight className="w-4 h-4" />
        </Button>
        <Button variant="outline" onClick={onRestart} className="text-slate-400">
          <RotateCcw className="w-4 h-4" /> {d("re_restart")}
        </Button>
      </div>
    </motion.div>
  );
}
