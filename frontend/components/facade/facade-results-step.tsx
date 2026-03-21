"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  BarChart3, ArrowRight, RotateCcw, Download, Eye, EyeOff,
  AlertTriangle, Building2, AppWindow, DoorOpen, Layers,
  LayoutPanelTop, Columns2, Frame, Box, HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FacadeAnalysisResult, FacadeElement } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

/* ── Colors per element type ── */
const TYPE_COLORS: Record<string, string> = {
  window:     "#60a5fa",   // blue-400
  door:       "#f472b6",   // pink-400
  balcony:    "#34d399",   // emerald-400
  floor_line: "#fb923c",   // orange-400
  roof:       "#a78bfa",   // violet-400
  column:     "#94a3b8",   // slate-400
  other:      "#fbbf24",   // amber-400
};

function getColor(type: string) {
  return TYPE_COLORS[type] ?? "#94a3b8";
}

/* ── Lucide icon per element type ── */
type IconComp = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
const TYPE_ICONS: Record<string, IconComp> = {
  window:     AppWindow,
  door:       DoorOpen,
  balcony:    LayoutPanelTop,
  floor_line: Layers,
  roof:       Frame,
  column:     Columns2,
  other:      HelpCircle,
};

function getIcon(type: string): IconComp {
  return TYPE_ICONS[type] ?? Box;
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

/* ── KPI icons + colors ── */
const KPI_ICONS: Record<string, { Icon: IconComp; color: string }> = {
  windows:  { Icon: AppWindow,      color: "text-blue-400" },
  doors:    { Icon: DoorOpen,       color: "text-pink-400" },
  balconies:{ Icon: LayoutPanelTop, color: "text-emerald-400" },
  floors:   { Icon: Layers,         color: "text-orange-400" },
};

interface FacadeResultsStepProps {
  result: FacadeAnalysisResult;
  onGoEditor: () => void;
  onRestart: () => void;
}

export default function FacadeResultsStep({ result, onGoEditor, onRestart }: FacadeResultsStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  // Image view tab: "svg" = SVG overlay, "ia" = backend-annotated image
  const [viewTab, setViewTab] = useState<"svg" | "ia">("ia");

  // Dynamic toggles per element type present in the result
  const presentTypes = [...new Set(result.elements.map(e => e.type))];
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const toggleType = (type: string) =>
    setHiddenTypes(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });

  // Image natural dimensions (for SVG overlay)
  const [imgNat, setImgNat] = useState({ w: 800, h: 600 });

  // SVG hover tooltip
  const imgContainerRef = useRef<HTMLDivElement>(null);
  const [hoveredEl, setHoveredEl] = useState<FacadeElement | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

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
      windows:  els.filter(e => e.type === "window").length,
      doors:    els.filter(e => e.type === "door").length,
      balconies:els.filter(e => e.type === "balcony").length,
    };
  });

  // Filter visible elements for SVG overlay
  const visibleElements = result.elements.filter(e => !hiddenTypes.has(e.type));

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
          { k: "windows",   value: result.windows_count,   label: d("fa_windows") },
          { k: "doors",     value: result.doors_count,     label: d("fa_doors") },
          { k: "balconies", value: result.balconies_count, label: d("fa_balconies") },
          { k: "floors",    value: result.floors_count,    label: d("fa_floors") },
        ].map(({ k, value, label }) => {
          const { Icon, color } = KPI_ICONS[k];
          return (
            <div key={k} className="glass rounded-xl border border-white/10 p-4 text-center">
              <Icon className={cn("w-6 h-6 mx-auto", color)} />
              <div className={cn("text-2xl font-display font-700 mt-1", color)}>{value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{label}</div>
            </div>
          );
        })}
      </div>

      {/* View tab + dynamic toggles */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {/* Tab switcher */}
        <div className="flex gap-1 glass rounded-lg border border-white/10 p-0.5 mr-2">
          {(["ia", "svg"] as const).map(tab => (
            <button key={tab} onClick={() => { setViewTab(tab); setHoveredEl(null); }}
              className={cn("px-3 py-1 rounded-md text-xs font-medium transition-all",
                viewTab === tab ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300")}>
              {tab === "ia" ? "Vue IA" : "SVG"}
            </button>
          ))}
        </div>

        {/* Dynamic type toggles (only visible in SVG mode) */}
        {viewTab === "svg" && presentTypes.map(type => {
          const hidden = hiddenTypes.has(type);
          const color = getColor(type);
          const Icon = getIcon(type);
          return (
            <button key={type} onClick={() => toggleType(type)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                hidden
                  ? "border-white/5 bg-transparent text-slate-600"
                  : "border-white/20 bg-white/5 text-white"
              )}>
              <Icon className="w-3 h-3" style={{ color: hidden ? "#475569" : color }} />
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hidden ? "#475569" : color }} />
              {d(TYPE_I18N[type] ?? "fa_other")}
              {hidden ? <EyeOff className="w-3 h-3 text-slate-600" /> : <Eye className="w-3 h-3" style={{ color }} />}
            </button>
          );
        })}
      </div>

      {/* Image view */}
      <div className="glass rounded-2xl border border-white/10 p-2 mb-8 relative overflow-hidden">
        {viewTab === "ia" ? (
          /* Backend-annotated overlay image */
          <img
            src={`data:image/png;base64,${result.overlay_b64}`}
            alt="Facade IA overlay"
            className="w-full rounded-xl"
          />
        ) : (
          /* SVG overlay on plan */
          <div className="relative" ref={imgContainerRef} onMouseLeave={() => setHoveredEl(null)}>
            <img
              src={`data:image/png;base64,${result.plan_b64}`}
              alt="Facade plan"
              className="w-full rounded-xl"
              onLoad={(e) => {
                const img = e.currentTarget;
                setImgNat({ w: img.naturalWidth, h: img.naturalHeight });
              }}
            />
            <svg
              className="absolute inset-0 w-full h-full"
              viewBox={`0 0 ${imgNat.w} ${imgNat.h}`}
              preserveAspectRatio="xMidYMid meet"
            >
              {visibleElements.map(el => {
                const x = el.bbox_norm.x * imgNat.w;
                const y = el.bbox_norm.y * imgNat.h;
                const w = el.bbox_norm.w * imgNat.w;
                const h = el.bbox_norm.h * imgNat.h;
                const color = getColor(el.type);

                const handleEnter = (e: React.MouseEvent<SVGGElement>) => {
                  const c = imgContainerRef.current;
                  if (!c) return;
                  const r = c.getBoundingClientRect();
                  setHoveredEl(el);
                  setTooltipPos({ x: e.clientX - r.left, y: e.clientY - r.top });
                };
                const handleMove = (e: React.MouseEvent<SVGGElement>) => {
                  const c = imgContainerRef.current;
                  if (!c) return;
                  const r = c.getBoundingClientRect();
                  setTooltipPos({ x: e.clientX - r.left, y: e.clientY - r.top });
                };

                if (el.type === "floor_line") {
                  return (
                    <g key={el.id} className="cursor-pointer"
                      onMouseEnter={handleEnter} onMouseMove={handleMove}
                      onMouseLeave={() => setHoveredEl(null)}>
                      <line
                        x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2}
                        stroke={color} strokeWidth="2" strokeDasharray="8 4"
                        opacity="0.8"
                      />
                    </g>
                  );
                }

                return (
                  <g key={el.id} className="cursor-pointer"
                    onMouseEnter={handleEnter} onMouseMove={handleMove}
                    onMouseLeave={() => setHoveredEl(null)}>
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

            {/* Hover tooltip */}
            {hoveredEl && (() => {
              const TIcon = getIcon(hoveredEl.type);
              const tColor = getColor(hoveredEl.type);
              const containerW = imgContainerRef.current?.offsetWidth ?? 9999;
              const flipX = tooltipPos.x > containerW / 2;
              return (
                <div
                  className="absolute z-50 pointer-events-none glass rounded-xl border border-white/20 p-3 min-w-[148px] shadow-xl"
                  style={{
                    left:  flipX ? tooltipPos.x - 14 : tooltipPos.x + 14,
                    top:   tooltipPos.y - 10,
                    transform: flipX ? "translateX(-100%)" : "none",
                  }}
                >
                  {/* Type header */}
                  <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-white/10">
                    <TIcon className="w-3.5 h-3.5 shrink-0" style={{ color: tColor }} />
                    <span className="text-xs font-semibold" style={{ color: tColor }}>
                      {d(TYPE_I18N[hoveredEl.type] ?? "fa_other")}
                    </span>
                  </div>
                  {/* Details */}
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between gap-4">
                      <span className="text-slate-500">{d("fa_floor_level")}</span>
                      <span className="text-white font-mono">{hoveredEl.floor_level ?? 0}</span>
                    </div>
                    {hoveredEl.confidence != null && (
                      <div className="flex justify-between gap-4">
                        <span className="text-slate-500">Conf.</span>
                        <span className="text-white font-mono">{(hoveredEl.confidence * 100).toFixed(0)}%</span>
                      </div>
                    )}
                    {hoveredEl.area_m2 != null && (
                      <div className="flex justify-between gap-4">
                        <span className="text-slate-500">Surface</span>
                        <span className="font-mono" style={{ color: tColor }}>{hoveredEl.area_m2.toFixed(2)} m²</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
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
                <th className="text-center py-2 px-3 font-medium">
                  <AppWindow className="w-3.5 h-3.5 text-blue-400 inline" />
                </th>
                <th className="text-center py-2 px-3 font-medium">
                  <DoorOpen className="w-3.5 h-3.5 text-pink-400 inline" />
                </th>
                <th className="text-center py-2 px-3 font-medium">
                  <LayoutPanelTop className="w-3.5 h-3.5 text-emerald-400 inline" />
                </th>
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
