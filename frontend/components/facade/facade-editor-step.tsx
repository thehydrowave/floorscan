"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  ZoomIn, ZoomOut, MousePointer2, Plus, Trash2, Download,
  ArrowLeft, RotateCcw, AlertTriangle, Eye, EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FacadeAnalysisResult, FacadeElement, FacadeElementType } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

/* ── Colors ── */
const TYPE_COLORS: Record<string, string> = {
  window:     "#60a5fa",
  door:       "#f472b6",
  balcony:    "#34d399",
  floor_line: "#fb923c",
  roof:       "#a78bfa",
  column:     "#94a3b8",
  other:      "#fbbf24",
};

const TYPE_I18N: Record<string, DTKey> = {
  window: "fa_window", door: "fa_door", balcony: "fa_balcony",
  floor_line: "fa_floor_line", roof: "fa_roof", column: "fa_column", other: "fa_other",
};

const ALL_TYPES: FacadeElementType[] = ["window", "door", "balcony", "floor_line", "roof", "column", "other"];

type EditorTool = "select" | "add_rect" | "erase";

interface FacadeEditorStepProps {
  result: FacadeAnalysisResult;
  onGoResults: (updated: FacadeAnalysisResult) => void;
  onRestart: () => void;
}

export default function FacadeEditorStep({ result, onGoResults, onRestart }: FacadeEditorStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  // Editable elements (local copy)
  const [elements, setElements] = useState<FacadeElement[]>(() => [...result.elements]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tool, setTool] = useState<EditorTool>("select");
  const [addType, setAddType] = useState<FacadeElementType>("window");

  // Zoom/pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Image
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgNat, setImgNat] = useState({ w: 800, h: 600 });
  const [imgDisplay, setImgDisplay] = useState({ w: 800, h: 600 });

  // Drawing new rect
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState({ x: 0, y: 0 });
  const [drawCurrent, setDrawCurrent] = useState({ x: 0, y: 0 });

  // Visibility toggles
  const [showWindows, setShowWindows] = useState(true);
  const [showDoors, setShowDoors] = useState(true);
  const [showBalconies, setShowBalconies] = useState(true);
  const [showFloorLines, setShowFloorLines] = useState(true);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setImgNat({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = `data:image/png;base64,${result.plan_b64}`;
  }, [result.plan_b64]);

  // Measure displayed image size
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        const el = entry.target.querySelector("img");
        if (el) setImgDisplay({ w: el.clientWidth, h: el.clientHeight });
      }
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Zoom controls
  const handleZoomIn = () => setZoom(z => Math.min(z * 1.3, 5));
  const handleZoomOut = () => setZoom(z => Math.max(z / 1.3, 0.5));

  useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) return;
      e.preventDefault();
      setZoom(z => {
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        return Math.min(Math.max(z * factor, 0.5), 5);
      });
    };
    window.addEventListener("wheel", handler, { passive: false });
    return () => window.removeEventListener("wheel", handler);
  }, []);

  // Convert mouse event to normalized coords
  const toNorm = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const imgEl = containerRef.current?.querySelector("img");
    if (!imgEl) return { x: 0, y: 0 };
    const rect = imgEl.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }, []);

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Pan
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      return;
    }

    if (tool === "add_rect") {
      const p = toNorm(e);
      setDrawing(true);
      setDrawStart(p);
      setDrawCurrent(p);
      return;
    }

    if (tool === "select") {
      const p = toNorm(e);
      // Find element under click
      const clicked = elements.find(el => {
        if (el.type === "window" && !showWindows) return false;
        if (el.type === "door" && !showDoors) return false;
        if (el.type === "balcony" && !showBalconies) return false;
        if (el.type === "floor_line" && !showFloorLines) return false;
        return (
          p.x >= el.bbox_norm.x && p.x <= el.bbox_norm.x + el.bbox_norm.w &&
          p.y >= el.bbox_norm.y && p.y <= el.bbox_norm.y + el.bbox_norm.h
        );
      });
      setSelectedId(clicked?.id ?? null);
    }

    if (tool === "erase") {
      const p = toNorm(e);
      setElements(prev => prev.filter(el => !(
        p.x >= el.bbox_norm.x && p.x <= el.bbox_norm.x + el.bbox_norm.w &&
        p.y >= el.bbox_norm.y && p.y <= el.bbox_norm.y + el.bbox_norm.h
      )));
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: panStart.current.panX + (e.clientX - panStart.current.x),
        y: panStart.current.panY + (e.clientY - panStart.current.y),
      });
      return;
    }
    if (drawing) {
      setDrawCurrent(toNorm(e));
    }
  };

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }
    if (drawing) {
      setDrawing(false);
      const x = Math.min(drawStart.x, drawCurrent.x);
      const y = Math.min(drawStart.y, drawCurrent.y);
      const w = Math.abs(drawCurrent.x - drawStart.x);
      const h = Math.abs(drawCurrent.y - drawStart.y);
      if (w > 0.01 && h > 0.01) {
        const newId = Math.max(0, ...elements.map(e => e.id)) + 1;
        const ppm = result.pixels_per_meter;
        setElements(prev => [...prev, {
          id: newId,
          type: addType,
          label_fr: d(TYPE_I18N[addType] ?? "fa_other"),
          bbox_norm: { x, y, w, h },
          area_m2: ppm ? (w * h) / (ppm * ppm) * imgNat.w * imgNat.h : null,
          floor_level: 0,
          confidence: 1.0,
        }]);
        toast({
          title: d("fa_add_element"),
          description: d(TYPE_I18N[addType] ?? "fa_other"),
          variant: "success",
        });
      }
    }
  };

  // Update selected element
  const updateSelected = (patch: Partial<FacadeElement>) => {
    if (selectedId == null) return;
    setElements(prev => prev.map(e => e.id === selectedId ? { ...e, ...patch } : e));
  };

  const deleteSelected = () => {
    if (selectedId == null) return;
    setElements(prev => prev.filter(e => e.id !== selectedId));
    setSelectedId(null);
  };

  const selectedEl = elements.find(e => e.id === selectedId);

  // Build updated result and go back to results
  const goResults = () => {
    const windows = elements.filter(e => e.type === "window");
    const doors = elements.filter(e => e.type === "door");
    const balconies = elements.filter(e => e.type === "balcony");
    const floorLines = elements.filter(e => e.type === "floor_line");

    const openingElements = elements.filter(e => ["window", "door", "balcony"].includes(e.type));
    const openings_area_m2 = result.pixels_per_meter
      ? openingElements.reduce((s, e) => s + (e.area_m2 ?? 0), 0)
      : null;

    const updated: FacadeAnalysisResult = {
      ...result,
      elements,
      windows_count: windows.length,
      doors_count: doors.length,
      balconies_count: balconies.length,
      floors_count: Math.max(1, new Set(elements.map(e => e.floor_level ?? 0)).size),
      openings_area_m2,
      ratio_openings: result.facade_area_m2 && openings_area_m2
        ? openings_area_m2 / result.facade_area_m2
        : null,
    };
    onGoResults(updated);
  };

  // CSV export
  const exportCSV = () => {
    const BOM = "\uFEFF";
    const header = `ID;${d("fa_type")};${d("fa_floor_level")};X;Y;W;H;Area (m²)`;
    const rows = elements.map(e =>
      `${e.id};${d(TYPE_I18N[e.type] ?? "fa_other")};${e.floor_level ?? 0};${e.bbox_norm.x.toFixed(3)};${e.bbox_norm.y.toFixed(3)};${e.bbox_norm.w.toFixed(3)};${e.bbox_norm.h.toFixed(3)};${e.area_m2?.toFixed(2) ?? "-"}`
    );
    const csv = BOM + [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "facade_elements.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: d("fa_export_csv"), variant: "success" });
  };

  // Visible elements filter
  const visibleElements = elements.filter(e => {
    if (e.type === "window" && !showWindows) return false;
    if (e.type === "door" && !showDoors) return false;
    if (e.type === "balcony" && !showBalconies) return false;
    if (e.type === "floor_line" && !showFloorLines) return false;
    return true;
  });

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl mx-auto">
      {/* Mock warning */}
      {result.is_mock && (
        <div className="mb-4 glass rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300/80">{d("fa_mock_warn")}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        {/* ── Canvas ── */}
        <div className="glass rounded-2xl border border-white/10 p-2 overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-2 mb-2 px-2 flex-wrap">
            {/* Tools */}
            <div className="flex items-center gap-1 glass border border-white/10 rounded-lg p-1">
              <button
                onClick={() => setTool("select")}
                className={cn("p-1.5 rounded-md text-xs", tool === "select" ? "bg-accent text-white" : "text-slate-400 hover:text-white")}
                title={d("fa_select")}
              >
                <MousePointer2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setTool("add_rect")}
                className={cn("p-1.5 rounded-md text-xs", tool === "add_rect" ? "bg-amber-600 text-white" : "text-slate-400 hover:text-white")}
                title={d("fa_add_element")}
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={() => setTool("erase")}
                className={cn("p-1.5 rounded-md text-xs", tool === "erase" ? "bg-red-600 text-white" : "text-slate-400 hover:text-white")}
                title={d("fa_delete")}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Add type selector */}
            {tool === "add_rect" && (
              <select
                value={addType}
                onChange={e => setAddType(e.target.value as FacadeElementType)}
                className="bg-slate-800 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
              >
                {ALL_TYPES.map(t => (
                  <option key={t} value={t}>{d(TYPE_I18N[t] ?? "fa_other")}</option>
                ))}
              </select>
            )}

            <div className="flex-1" />

            {/* Zoom */}
            <button onClick={handleZoomOut} className="p-1.5 text-slate-400 hover:text-white"><ZoomOut className="w-4 h-4" /></button>
            <span className="text-xs text-slate-500 font-mono w-12 text-center">{(zoom * 100).toFixed(0)}%</span>
            <button onClick={handleZoomIn} className="p-1.5 text-slate-400 hover:text-white"><ZoomIn className="w-4 h-4" /></button>
          </div>

          {/* Image area */}
          <div
            ref={containerRef}
            className="relative overflow-hidden rounded-xl bg-slate-900 cursor-crosshair"
            style={{ minHeight: 400 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { setIsPanning(false); }}
          >
            <div
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center center",
                transition: isPanning || drawing ? "none" : "transform 0.2s ease",
              }}
            >
              <img
                src={`data:image/png;base64,${result.plan_b64}`}
                alt="Facade"
                className="w-full select-none"
                draggable={false}
                onLoad={e => {
                  const img = e.currentTarget;
                  setImgNat({ w: img.naturalWidth, h: img.naturalHeight });
                  setImgDisplay({ w: img.clientWidth, h: img.clientHeight });
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
                  const color = TYPE_COLORS[el.type] ?? "#94a3b8";
                  const isSelected = el.id === selectedId;

                  if (el.type === "floor_line") {
                    return (
                      <line key={el.id}
                        x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2}
                        stroke={color} strokeWidth={isSelected ? 3 : 2}
                        strokeDasharray="8 4" opacity={isSelected ? 1 : 0.7}
                      />
                    );
                  }

                  return (
                    <g key={el.id}>
                      <rect
                        x={x} y={y} width={w} height={h}
                        fill={isSelected ? `${color}40` : `${color}18`}
                        stroke={color}
                        strokeWidth={isSelected ? 2.5 : 1.5}
                        rx="2"
                      />
                      {isSelected && (
                        <>
                          {/* Selection handles */}
                          {[
                            [x, y], [x + w, y], [x, y + h], [x + w, y + h],
                          ].map(([hx, hy], i) => (
                            <circle key={i} cx={hx} cy={hy} r="4" className="svg-handle" fill="white" stroke={color} strokeWidth="2" />
                          ))}
                        </>
                      )}
                    </g>
                  );
                })}

                {/* Drawing preview */}
                {drawing && (
                  <rect
                    x={Math.min(drawStart.x, drawCurrent.x) * imgNat.w}
                    y={Math.min(drawStart.y, drawCurrent.y) * imgNat.h}
                    width={Math.abs(drawCurrent.x - drawStart.x) * imgNat.w}
                    height={Math.abs(drawCurrent.y - drawStart.y) * imgNat.h}
                    fill={`${TYPE_COLORS[addType]}30`}
                    stroke={TYPE_COLORS[addType]}
                    strokeWidth="2"
                    strokeDasharray="6 3"
                    rx="2"
                  />
                )}
              </svg>
            </div>
          </div>
        </div>

        {/* ── Side panel ── */}
        <div className="flex flex-col gap-4">
          {/* Visibility toggles */}
          <div className="glass rounded-xl border border-white/10 p-4">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Layers</h4>
            {[
              { key: "fa_toggle_windows" as DTKey, on: showWindows, set: setShowWindows, color: "#60a5fa" },
              { key: "fa_toggle_doors" as DTKey, on: showDoors, set: setShowDoors, color: "#f472b6" },
              { key: "fa_toggle_balconies" as DTKey, on: showBalconies, set: setShowBalconies, color: "#34d399" },
              { key: "fa_toggle_floors" as DTKey, on: showFloorLines, set: setShowFloorLines, color: "#fb923c" },
            ].map(({ key, on, set, color }) => (
              <button
                key={key}
                onClick={() => set(!on)}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs hover:bg-white/5 transition-colors"
              >
                {on ? <Eye className="w-3.5 h-3.5 text-white" /> : <EyeOff className="w-3.5 h-3.5 text-slate-600" />}
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: on ? color : "#475569" }} />
                <span className={on ? "text-white" : "text-slate-600"}>{d(key)}</span>
              </button>
            ))}
          </div>

          {/* Selected element panel */}
          {selectedEl && (
            <div className="glass rounded-xl border border-white/10 p-4">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">{d("fa_element")}</h4>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{d("fa_type")}</label>
                  <select
                    value={selectedEl.type}
                    onChange={e => updateSelected({ type: e.target.value as FacadeElementType })}
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white"
                  >
                    {ALL_TYPES.map(t => (
                      <option key={t} value={t}>{d(TYPE_I18N[t] ?? "fa_other")}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">{d("fa_floor_level")}</label>
                  <select
                    value={selectedEl.floor_level ?? 0}
                    onChange={e => updateSelected({ floor_level: Number(e.target.value) })}
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white"
                  >
                    {[0, 1, 2, 3, 4, 5].map(f => (
                      <option key={f} value={f}>{f === 0 ? d("fa_rdc") : `${d("fa_floor_level")} ${f}`}</option>
                    ))}
                  </select>
                </div>
                {selectedEl.area_m2 != null && (
                  <div className="text-xs text-slate-400">
                    {d("fa_facade_area")}: <span className="text-white font-mono">{selectedEl.area_m2.toFixed(2)} m²</span>
                  </div>
                )}
                <Button variant="outline" size="sm" onClick={deleteSelected} className="text-red-400 border-red-500/20 hover:bg-red-500/10">
                  <Trash2 className="w-3.5 h-3.5" /> {d("fa_delete")}
                </Button>
              </div>
            </div>
          )}

          {/* Element count summary */}
          <div className="glass rounded-xl border border-white/10 p-4">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">{d("fa_element")}s</h4>
            <div className="flex flex-col gap-1.5">
              {[
                { type: "window", color: "#60a5fa" },
                { type: "door", color: "#f472b6" },
                { type: "balcony", color: "#34d399" },
                { type: "floor_line", color: "#fb923c" },
                { type: "roof", color: "#a78bfa" },
                { type: "column", color: "#94a3b8" },
              ].map(({ type, color }) => {
                const count = elements.filter(e => e.type === type).length;
                if (count === 0) return null;
                return (
                  <div key={type} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-slate-300">{d(TYPE_I18N[type] ?? "fa_other")}</span>
                    </div>
                    <span className="font-mono text-white">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="w-3.5 h-3.5" /> {d("fa_export_csv")}
            </Button>
            <Button size="sm" onClick={goResults} className="bg-amber-600 hover:bg-amber-700">
              <ArrowLeft className="w-3.5 h-3.5" /> {d("fa_go_results")}
            </Button>
            <Button variant="outline" size="sm" onClick={onRestart} className="text-slate-400">
              <RotateCcw className="w-3.5 h-3.5" /> {d("re_restart")}
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
