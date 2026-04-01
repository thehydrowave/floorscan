"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ZoomIn, ZoomOut, MousePointer2, Plus, Trash2, Download,
  ArrowLeft, RotateCcw, AlertTriangle, Eye, EyeOff, Pentagon, Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FacadeAnalysisResult, FacadeElement, FacadeElementType } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { pointInPolygon, polygonAreaPx } from "@/lib/measure-types";

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

/* ── Only 2 editable types in editor ── */
const EDITOR_TYPES: FacadeElementType[] = ["other", "column"];
const EDITOR_LABELS: Record<string, string> = { other: "Fenetres", column: "Emprise mur" };

type EditorTool = "select" | "add_polygon" | "add_rect" | "erase";

/* ── Helpers ── */
type Pt = { x: number; y: number };

/** Get polygon points for an element (use polygon_norm if available, else create from bbox) */
function getPolyPoints(el: FacadeElement): Pt[] {
  if (el.polygon_norm && el.polygon_norm.length >= 3) return el.polygon_norm;
  const { x, y, w, h } = el.bbox_norm;
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

/** Compute centroid of a polygon */
function centroid(pts: Pt[]): Pt {
  if (pts.length === 0) return { x: 0.5, y: 0.5 };
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return { x: cx, y: cy };
}

/** Compute bounding box from polygon points */
function bboxFromPoly(pts: Pt[]): { x: number; y: number; w: number; h: number } {
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Convert points to SVG polygon points string */
function toSvgPoints(pts: Pt[], w: number, h: number): string {
  return pts.map(p => `${p.x * w},${p.y * h}`).join(" ");
}

/** Distance between two points */
function dist(a: Pt, b: Pt): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

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
  const [addType, setAddType] = useState<FacadeElementType>("other");

  // Zoom/pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Image
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgNat, setImgNat] = useState({ w: 800, h: 600 });
  const [imgDisplay, setImgDisplay] = useState({ w: 800, h: 600 });

  // Drawing polygon — array of normalized points being placed
  const [drawingPoly, setDrawingPoly] = useState<Pt[]>([]);
  const [hoverPoint, setHoverPoint] = useState<Pt | null>(null);

  // Vertex dragging
  const [dragVertex, setDragVertex] = useState<{ elId: number; idx: number } | null>(null);
  const dragVertexRef = useRef<{ elId: number; idx: number } | null>(null);

  // Visibility toggles (only the 2 editable types)
  const [showOther, setShowOther] = useState(true);
  const [showColumns, setShowColumns] = useState(true);

  // Whole-element drag
  const dragElRef = useRef<{ elId: number; startNorm: Pt; origPts: Pt[] } | null>(null);
  const [isDraggingEl, setIsDraggingEl] = useState(false);

  // Rectangle drawing state
  const rectDragRef = useRef<Pt | null>(null);
  const [rectPreview, setRectPreview] = useState<{ start: Pt; end: Pt } | null>(null);

  // ── Blue wall overlay path (facade boundary minus window holes) ──
  const wallSvgPath = useMemo(() => {
    const W = imgNat.w, H = imgNat.h;
    if (W === 0 || H === 0) return "";
    // Outer boundary: use building_roi if available, else full image
    let p = "";
    const roi = result.building_roi ?? { x: 0, y: 0, w: 1, h: 1 };
    const rx = roi.x * W, ry = roi.y * H, rw = roi.w * W, rh = roi.h * H;
    p = `M${rx} ${ry} h${rw} v${rh} h${-rw} Z`;
    // Holes: visible "other" elements (Fenêtres)
    if (showOther) {
      elements.filter(e => e.type === "other").forEach(e => {
        if (e.polygon_norm && e.polygon_norm.length >= 3) {
          p += ' ' + e.polygon_norm.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x * W} ${pt.y * H}`).join(' ') + ' Z';
        } else {
          const x = e.bbox_norm.x * W, y = e.bbox_norm.y * H;
          const w = e.bbox_norm.w * W, h = e.bbox_norm.h * H;
          p += ` M${x} ${y} h${w} v${h} h${-w} Z`;
        }
      });
    }
    return p;
  }, [imgNat, result.building_roi, elements, showOther]);

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

  // Escape key to cancel drawing
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drawingPoly.length > 0) {
        setDrawingPoly([]);
        setHoverPoint(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [drawingPoly.length]);

  // Convert mouse event to normalized coords
  const toNorm = useCallback((e: React.MouseEvent): Pt => {
    const imgEl = containerRef.current?.querySelector("img");
    if (!imgEl) return { x: 0, y: 0 };
    const rect = imgEl.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }, []);

  /** Close the polygon being drawn → create a new element */
  const closePolygon = useCallback((pts: Pt[]) => {
    if (pts.length < 3) { setDrawingPoly([]); return; }
    const newId = Math.max(0, ...elements.map(e => e.id)) + 1;
    const ppm = result.pixels_per_meter;
    const bbox = bboxFromPoly(pts);
    const areaPx = polygonAreaPx(pts, imgNat.w, imgNat.h);
    const area_m2 = ppm ? areaPx / (ppm * ppm) : null;

    setElements(prev => [...prev, {
      id: newId,
      type: addType,
      label_fr: d(TYPE_I18N[addType] ?? "fa_other"),
      bbox_norm: bbox,
      polygon_norm: pts,
      area_m2,
      floor_level: 0,
      confidence: 1.0,
    }]);
    setDrawingPoly([]);
    setHoverPoint(null);
    toast({ title: d("fa_add_element"), description: d(TYPE_I18N[addType] ?? "fa_other"), variant: "success" });
  }, [elements, addType, imgNat, result.pixels_per_meter, d]);

  // ── Mouse handlers ──

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      return;
    }

    if (tool === "select") {
      const p = toNorm(e);
      // Find element under click using point-in-polygon
      const clicked = [...elements].reverse().find(el => {
        if (el.type === "other" && !showOther) return false;
        if (el.type === "column" && !showColumns) return false;
        const poly = getPolyPoints(el);
        return pointInPolygon(p, poly);
      });
      setSelectedId(clicked?.id ?? null);
      // Start whole-element drag if element found
      if (clicked) {
        dragElRef.current = { elId: clicked.id, startNorm: p, origPts: getPolyPoints(clicked) };
        setIsDraggingEl(true);
      }
    }

    if (tool === "add_rect") {
      const p = toNorm(e);
      rectDragRef.current = p;
      setRectPreview({ start: p, end: p });
      return;
    }

    if (tool === "erase") {
      const p = toNorm(e);
      setElements(prev => prev.filter(el => {
        const poly = getPolyPoints(el);
        return !pointInPolygon(p, poly);
      }));
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (tool !== "add_polygon" || isPanning) return;
    const p = toNorm(e);

    // If clicking near first point → close polygon
    if (drawingPoly.length >= 3) {
      const first = drawingPoly[0];
      const threshold = 12 / (imgNat.w * zoom); // ~12px threshold
      if (dist(p, first) < threshold) {
        closePolygon(drawingPoly);
        return;
      }
    }

    setDrawingPoly(prev => [...prev, p]);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (tool !== "add_polygon") return;
    e.preventDefault();
    if (drawingPoly.length >= 3) {
      closePolygon(drawingPoly);
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

    const p = toNorm(e);

    // Hover preview for polygon drawing
    if (tool === "add_polygon" && drawingPoly.length > 0) {
      setHoverPoint(p);
    }

    // Vertex dragging (takes priority)
    if (dragVertexRef.current) {
      const { elId, idx } = dragVertexRef.current;
      setElements(prev => prev.map(el => {
        if (el.id !== elId) return el;
        const poly = getPolyPoints(el);
        const newPoly = [...poly];
        newPoly[idx] = p;
        return {
          ...el,
          polygon_norm: newPoly,
          bbox_norm: bboxFromPoly(newPoly),
          area_m2: result.pixels_per_meter
            ? polygonAreaPx(newPoly, imgNat.w, imgNat.h) / (result.pixels_per_meter ** 2)
            : el.area_m2,
        };
      }));
      return;
    }

    // Rect drawing preview
    if (tool === "add_rect" && rectDragRef.current) {
      setRectPreview({ start: rectDragRef.current, end: p });
    }

    // Whole-element drag (move all vertices by delta from start)
    if (dragElRef.current) {
      const { elId, startNorm, origPts } = dragElRef.current;
      const dx = p.x - startNorm.x;
      const dy = p.y - startNorm.y;
      setElements(prev => prev.map(el => {
        if (el.id !== elId) return el;
        const newPts = origPts.map(pt => ({
          x: Math.max(0, Math.min(1, pt.x + dx)),
          y: Math.max(0, Math.min(1, pt.y + dy)),
        }));
        return {
          ...el,
          polygon_norm: newPts,
          bbox_norm: bboxFromPoly(newPts),
        };
      }));
    }
  };

  const handleMouseUp = () => {
    if (isPanning) { setIsPanning(false); return; }

    // Rectangle: create 4-point polygon on mouseup
    if (tool === "add_rect" && rectDragRef.current && rectPreview) {
      const { start, end } = rectPreview;
      const dx = Math.abs(end.x - start.x);
      const dy = Math.abs(end.y - start.y);
      if (dx > 0.005 || dy > 0.005) {
        const pts: Pt[] = [
          { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) },
          { x: Math.max(start.x, end.x), y: Math.min(start.y, end.y) },
          { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) },
          { x: Math.min(start.x, end.x), y: Math.max(start.y, end.y) },
        ];
        closePolygon(pts);
      }
      rectDragRef.current = null;
      setRectPreview(null);
      return;
    }

    if (dragVertexRef.current) {
      dragVertexRef.current = null;
      setDragVertex(null);
    }
    if (dragElRef.current) {
      dragElRef.current = null;
      setIsDraggingEl(false);
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
    const openingElements = elements.filter(e => ["window", "door", "balcony"].includes(e.type));
    const openings_area_m2 = result.pixels_per_meter
      ? openingElements.reduce((s, e) => s + (e.area_m2 ?? 0), 0)
      : null;

    const updated: FacadeAnalysisResult = {
      ...result,
      elements,
      windows_count: elements.filter(e => e.type === "window").length,
      doors_count: elements.filter(e => e.type === "door").length,
      balconies_count: elements.filter(e => e.type === "balcony").length,
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
    const header = `ID;${d("fa_type")};${d("fa_floor_level")};X;Y;W;H;Area (m\u00B2)`;
    const rows = elements.map(e =>
      `${e.id};${d(TYPE_I18N[e.type] ?? "fa_other")};${e.floor_level ?? 0};${e.bbox_norm.x.toFixed(3)};${e.bbox_norm.y.toFixed(3)};${e.bbox_norm.w.toFixed(3)};${e.bbox_norm.h.toFixed(3)};${e.area_m2?.toFixed(2) ?? "-"}`
    );
    const csv = BOM + [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "facade_elements.csv"; a.click();
    URL.revokeObjectURL(url);
    toast({ title: d("fa_export_csv"), variant: "success" });
  };

  // Visible elements filter (non-editable AI types always visible)
  const visibleElements = elements.filter(e => {
    if (e.type === "other" && !showOther) return false;
    if (e.type === "column" && !showColumns) return false;
    return true;
  });

  const isDrawing = tool === "add_polygon" && drawingPoly.length > 0;

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
            <div className="flex items-center gap-1 glass border border-white/10 rounded-lg p-1">
              <button
                onClick={() => { setTool("select"); setDrawingPoly([]); setHoverPoint(null); setRectPreview(null); rectDragRef.current = null; }}
                className={cn("p-1.5 rounded-md text-xs", tool === "select" ? "bg-accent text-white" : "text-slate-400 hover:text-white")}
                title={d("fa_select")}
              >
                <MousePointer2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => { setTool("add_polygon"); setSelectedId(null); setRectPreview(null); rectDragRef.current = null; }}
                className={cn("p-1.5 rounded-md text-xs", tool === "add_polygon" ? "bg-amber-600 text-white" : "text-slate-400 hover:text-white")}
                title="Polygone"
              >
                <Pentagon className="w-4 h-4" />
              </button>
              <button
                onClick={() => { setTool("add_rect"); setSelectedId(null); setDrawingPoly([]); setHoverPoint(null); }}
                className={cn("p-1.5 rounded-md text-xs", tool === "add_rect" ? "bg-amber-600 text-white" : "text-slate-400 hover:text-white")}
                title="Rectangle"
              >
                <Square className="w-4 h-4" />
              </button>
              <button
                onClick={() => { setTool("erase"); setDrawingPoly([]); setHoverPoint(null); setRectPreview(null); rectDragRef.current = null; }}
                className={cn("p-1.5 rounded-md text-xs", tool === "erase" ? "bg-red-600 text-white" : "text-slate-400 hover:text-white")}
                title={d("fa_delete")}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Add type selector */}
            {(tool === "add_polygon" || tool === "add_rect") && (
              <select
                value={addType}
                onChange={e => setAddType(e.target.value as FacadeElementType)}
                className="bg-slate-800 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
              >
                {EDITOR_TYPES.map(t => (
                  <option key={t} value={t}>{EDITOR_LABELS[t] ?? t}</option>
                ))}
              </select>
            )}

            {/* Drawing hint */}
            {isDrawing && (
              <span className="text-xs text-amber-300/70 animate-pulse">
                {drawingPoly.length < 3 ? "Cliquez pour poser des points..." : "Double-clic ou clic sur le 1er point pour fermer"}
              </span>
            )}
            {tool === "add_rect" && (
              <span className="text-xs text-amber-300/70 animate-pulse">
                {rectPreview ? "Relâchez pour créer le rectangle" : "Cliquez et glissez pour dessiner un rectangle"}
              </span>
            )}

            <div className="flex-1" />
            <button onClick={handleZoomOut} className="p-1.5 text-slate-400 hover:text-white"><ZoomOut className="w-4 h-4" /></button>
            <span className="text-xs text-slate-500 font-mono w-12 text-center">{(zoom * 100).toFixed(0)}%</span>
            <button onClick={handleZoomIn} className="p-1.5 text-slate-400 hover:text-white"><ZoomIn className="w-4 h-4" /></button>
          </div>

          {/* Image area */}
          <div
            ref={containerRef}
            className={cn("relative overflow-hidden rounded-xl bg-slate-900",
              tool === "add_polygon" || tool === "add_rect" ? "cursor-crosshair"
              : tool === "erase" ? "cursor-cell"
              : isDraggingEl ? "cursor-grabbing"
              : "cursor-default"
            )}
            style={{ minHeight: 400 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onMouseLeave={() => { setIsPanning(false); setHoverPoint(null); }}
          >
            <div
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center center",
                transition: isPanning || dragVertex ? "none" : "transform 0.2s ease",
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

              {/* ── Wall blue mask layer (evenodd: outer boundary minus window holes) ── */}
              {wallSvgPath && imgNat.w > 0 && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none"
                  viewBox={`0 0 ${imgNat.w} ${imgNat.h}`} preserveAspectRatio="xMidYMid meet">
                  <path d={wallSvgPath} fillRule="evenodd" fill="#3b82f6" fillOpacity={0.25} />
                </svg>
              )}

              {/* ── SVG overlay ── */}
              <svg
                className="absolute inset-0 w-full h-full"
                viewBox={`0 0 ${imgNat.w} ${imgNat.h}`}
                preserveAspectRatio="xMidYMid meet"
                style={{ pointerEvents: "none" }}
              >
                {/* ── Existing elements ── */}
                {visibleElements.map(el => {
                  const color = TYPE_COLORS[el.type] ?? "#94a3b8";
                  const isSelected = el.id === selectedId;

                  // Floor line → special rendering
                  if (el.type === "floor_line") {
                    const x = el.bbox_norm.x * imgNat.w;
                    const y = (el.bbox_norm.y + el.bbox_norm.h / 2) * imgNat.h;
                    const x2 = (el.bbox_norm.x + el.bbox_norm.w) * imgNat.w;
                    return (
                      <line key={el.id}
                        x1={x} y1={y} x2={x2} y2={y}
                        stroke={color} strokeWidth={isSelected ? 3 : 2}
                        strokeDasharray="8 4" opacity={isSelected ? 1 : 0.7}
                        style={{ pointerEvents: "none" }}
                      />
                    );
                  }

                  const poly = getPolyPoints(el);
                  const pts = toSvgPoints(poly, imgNat.w, imgNat.h);
                  const c = centroid(poly);

                  return (
                    <g key={el.id}>
                      {/* Filled polygon */}
                      <polygon
                        points={pts}
                        fill={isSelected ? `${color}40` : `${color}28`}
                        stroke={color}
                        strokeWidth={isSelected ? 2.5 : 1.5}
                        strokeLinejoin="round"
                        opacity={0.85}
                        style={{ pointerEvents: "none" }}
                      />

                      {/* Selection dashed border */}
                      {isSelected && (
                        <polygon
                          points={pts}
                          fill="none"
                          stroke={color}
                          strokeWidth={3}
                          strokeDasharray="6 3"
                          strokeLinejoin="round"
                          style={{ pointerEvents: "none" }}
                        />
                      )}

                      {/* Centroid label (name + area) */}
                      {(() => {
                        const cx = c.x * imgNat.w;
                        const cy = c.y * imgNat.h;
                        const label = el.label_fr || d(TYPE_I18N[el.type] ?? "fa_other");
                        const areaStr = el.area_m2 != null ? `${el.area_m2.toFixed(2)} m\u00B2` : "";
                        const fs = Math.max(10, Math.min(16, imgNat.w * 0.008));
                        const pw = Math.max(50, Math.max(label.length, areaStr.length) * (fs * 0.6)) + 12;
                        const ph = areaStr ? fs * 2.4 : fs * 1.5;

                        return (
                          <g>
                            <rect
                              x={cx - pw / 2} y={cy - ph / 2}
                              width={pw} height={ph} rx={4}
                              fill="rgba(10,16,32,0.92)"
                              stroke={color} strokeWidth={1.5}
                            />
                            <text
                              x={cx} y={areaStr ? cy - ph / 2 + fs + 2 : cy + fs * 0.35}
                              textAnchor="middle" fill={color}
                              fontSize={fs} fontWeight="700"
                              fontFamily="system-ui,sans-serif"
                            >
                              {label}
                            </text>
                            {areaStr && (
                              <text
                                x={cx} y={cy - ph / 2 + fs * 2 + 4}
                                textAnchor="middle" fill="#94a3b8"
                                fontSize={fs * 0.75} fontWeight="500"
                                fontFamily="monospace"
                              >
                                {areaStr}
                              </text>
                            )}
                          </g>
                        );
                      })()}

                      {/* ── Vertex handles (selected only) ── */}
                      {isSelected && poly.map((p, idx) => {
                        const vx = p.x * imgNat.w;
                        const vy = p.y * imgNat.h;
                        const isDragging = dragVertex?.elId === el.id && dragVertex?.idx === idx;
                        return (
                          <g key={`v-${idx}`} className="group/vtx">
                            {/* Invisible hit area */}
                            <circle
                              cx={vx} cy={vy} r={14}
                              fill="transparent"
                              style={{ cursor: dragVertex ? "grabbing" : "grab", pointerEvents: "all" }}
                              onMouseDown={(ev) => {
                                ev.stopPropagation();
                                ev.preventDefault();
                                dragVertexRef.current = { elId: el.id, idx };
                                setDragVertex({ elId: el.id, idx });
                              }}
                              onContextMenu={(ev) => {
                                ev.stopPropagation();
                                ev.preventDefault();
                                const polyPts = getPolyPoints(el);
                                if (polyPts.length <= 3) return;
                                const newPoly = polyPts.filter((_, i) => i !== idx);
                                const newBbox = bboxFromPoly(newPoly);
                                const ppm = result.pixels_per_meter;
                                setElements(prev => prev.map(e => e.id !== el.id ? e : {
                                  ...e,
                                  polygon_norm: newPoly,
                                  bbox_norm: newBbox,
                                  area_m2: ppm ? polygonAreaPx(newPoly, imgNat.w, imgNat.h) / (ppm ** 2) : e.area_m2,
                                }));
                              }}
                            />
                            {/* Visible vertex circle */}
                            <circle
                              cx={vx} cy={vy}
                              r={isDragging ? 9 : 7}
                              fill={isDragging ? color : "white"}
                              stroke={color} strokeWidth={isDragging ? 3 : 2}
                              style={{ pointerEvents: "none", transition: "r 0.1s, fill 0.1s" }}
                            />
                            {/* Hover glow */}
                            <circle
                              cx={vx} cy={vy} r={11}
                              fill="none" stroke={color} strokeWidth={1}
                              opacity={0}
                              style={{ pointerEvents: "none", transition: "opacity 0.15s" }}
                              className="group-hover/vtx:opacity-40"
                            />
                          </g>
                        );
                      })}

                      {/* ── Edge midpoint handles (click to insert vertex) ── */}
                      {isSelected && !dragVertex && poly.map((p, idx) => {
                        const next = poly[(idx + 1) % poly.length];
                        const mx = (p.x + next.x) / 2;
                        const my = (p.y + next.y) / 2;
                        return (
                          <g key={`mid-${idx}`} className="group/mid opacity-40 hover:opacity-100 transition-opacity">
                            <circle
                              cx={mx * imgNat.w} cy={my * imgNat.h} r={12}
                              fill="transparent"
                              style={{ cursor: "copy", pointerEvents: "all" }}
                              onMouseDown={(ev) => {
                                ev.stopPropagation();
                                ev.preventDefault();
                                const polyPts = getPolyPoints(el);
                                const newPoly = [...polyPts];
                                newPoly.splice(idx + 1, 0, { x: mx, y: my });
                                const ppm = result.pixels_per_meter;
                                setElements(prev => prev.map(e => e.id !== el.id ? e : {
                                  ...e,
                                  polygon_norm: newPoly,
                                  bbox_norm: bboxFromPoly(newPoly),
                                  area_m2: ppm ? polygonAreaPx(newPoly, imgNat.w, imgNat.h) / (ppm ** 2) : e.area_m2,
                                }));
                                // Start dragging the new vertex immediately
                                dragVertexRef.current = { elId: el.id, idx: idx + 1 };
                                setDragVertex({ elId: el.id, idx: idx + 1 });
                              }}
                            />
                            <circle
                              cx={mx * imgNat.w} cy={my * imgNat.h} r={6}
                              fill="white" stroke={color} strokeWidth={1.5}
                              style={{ pointerEvents: "none" }}
                            />
                            <text
                              x={mx * imgNat.w} y={my * imgNat.h + 0.5}
                              textAnchor="middle" dominantBaseline="central"
                              fontSize={9} fill={color} fontWeight="bold"
                              style={{ pointerEvents: "none" }}
                            >
                              +
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  );
                })}

                {/* ── Rectangle drawing preview ── */}
                {tool === "add_rect" && rectPreview && (() => {
                  const { start, end } = rectPreview;
                  const rx = Math.min(start.x, end.x) * imgNat.w;
                  const ry = Math.min(start.y, end.y) * imgNat.h;
                  const rw = Math.abs(end.x - start.x) * imgNat.w;
                  const rh = Math.abs(end.y - start.y) * imgNat.h;
                  const color = TYPE_COLORS[addType] ?? "#fbbf24";
                  return (
                    <rect
                      x={rx} y={ry} width={rw} height={rh}
                      fill={`${color}20`}
                      stroke={color}
                      strokeWidth={2}
                      strokeDasharray="6 3"
                    />
                  );
                })()}

                {/* ── Drawing preview polygon (live fill) ── */}
                {isDrawing && (() => {
                  const previewPts = hoverPoint ? [...drawingPoly, hoverPoint] : drawingPoly;
                  const color = TYPE_COLORS[addType] ?? "#fbbf24";

                  return (
                    <g>
                      {/* Filled polygon preview */}
                      {previewPts.length >= 3 && (
                        <polygon
                          points={toSvgPoints(previewPts, imgNat.w, imgNat.h)}
                          fill={`${color}20`}
                          stroke={color}
                          strokeWidth={2}
                          strokeDasharray="6 3"
                          strokeLinejoin="round"
                        />
                      )}

                      {/* Lines connecting points (when < 3 points) */}
                      {previewPts.length >= 2 && previewPts.length < 3 && (
                        <polyline
                          points={toSvgPoints(previewPts, imgNat.w, imgNat.h)}
                          fill="none"
                          stroke={color}
                          strokeWidth={2}
                          strokeDasharray="6 3"
                        />
                      )}

                      {/* Placed vertices */}
                      {drawingPoly.map((p, i) => (
                        <circle
                          key={`dp-${i}`}
                          cx={p.x * imgNat.w} cy={p.y * imgNat.h}
                          r={i === 0 && drawingPoly.length >= 3 ? 9 : 6}
                          fill={i === 0 && drawingPoly.length >= 3 ? color : "white"}
                          stroke={color}
                          strokeWidth={2}
                          style={{ pointerEvents: "none" }}
                        />
                      ))}

                      {/* Close hint ring on first point */}
                      {drawingPoly.length >= 3 && (
                        <circle
                          cx={drawingPoly[0].x * imgNat.w} cy={drawingPoly[0].y * imgNat.h}
                          r={14}
                          fill="none" stroke={color} strokeWidth={1.5}
                          strokeDasharray="4 2" opacity={0.5}
                        />
                      )}

                      {/* Hover point preview */}
                      {hoverPoint && (
                        <circle
                          cx={hoverPoint.x * imgNat.w} cy={hoverPoint.y * imgNat.h}
                          r={5} fill={`${color}60`} stroke={color} strokeWidth={1.5}
                        />
                      )}
                    </g>
                  );
                })()}
              </svg>
            </div>
          </div>
        </div>

        {/* ── Side panel ── */}
        <div className="flex flex-col gap-4">
          {/* Visibility toggles */}
          <div className="glass rounded-xl border border-white/10 p-4">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">LAYERS</h4>
            {[
              { label: "Fenetres", on: showOther, set: setShowOther, color: "#fbbf24" },
              { label: "Emprise mur", on: showColumns, set: setShowColumns, color: "#94a3b8" },
            ].map(({ label, on, set, color }) => (
              <button
                key={label}
                onClick={() => set(!on)}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs hover:bg-white/5 transition-colors"
              >
                {on ? <Eye className="w-3.5 h-3.5 text-white" /> : <EyeOff className="w-3.5 h-3.5 text-slate-600" />}
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: on ? color : "#475569" }} />
                <span className={on ? "text-white" : "text-slate-600"}>{label}</span>
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
                    {EDITOR_TYPES.map(t => (
                      <option key={t} value={t}>{EDITOR_LABELS[t] ?? t}</option>
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
                    {d("fa_facade_area")}: <span className="text-white font-mono">{selectedEl.area_m2.toFixed(2)} m\u00B2</span>
                  </div>
                )}
                <div className="text-[10px] text-slate-600">
                  {getPolyPoints(selectedEl).length} vertices &middot; Clic droit sur un vertex pour le supprimer
                </div>
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
                { type: "other", color: "#fbbf24" },
                { type: "column", color: "#94a3b8" },
              ].map(({ type, color }) => {
                const count = elements.filter(e => e.type === type).length;
                if (count === 0) return null;
                return (
                  <div key={type} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-slate-300">{EDITOR_LABELS[type] ?? type}</span>
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
