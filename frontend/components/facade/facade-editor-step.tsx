"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ZoomIn, ZoomOut, MousePointer2, Plus, Trash2, Download,
  ArrowLeft, RotateCcw, AlertTriangle, Eye, EyeOff, Pentagon, Square,
  AppWindow, Building2, X, Hash, Type, Search, Loader2, Save, Ruler, Copy, Eraser,
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
  window:      "#ff00ff",
  door:        "#f472b6",
  balcony:     "#34d399",
  floor_line:  "#fb923c",
  roof:        "#a78bfa",
  column:      "#94a3b8",
  other:       "#ff00ff",
  wall_opaque: "#22c55e",
};

const TYPE_I18N: Record<string, DTKey> = {
  window: "fa_window", door: "fa_door", balcony: "fa_balcony",
  floor_line: "fa_floor_line", roof: "fa_roof", column: "fa_column", other: "fa_other",
  wall_opaque: "fr_net_surface",
};

const ALL_TYPES: FacadeElementType[] = ["window", "door", "balcony", "floor_line", "roof", "column", "other"];

/* ── Only windows and walls editable in facade editor ── */
const EDITOR_TYPES: FacadeElementType[] = ["window", "wall_opaque"];
const EDITOR_LABELS: Record<string, string> = {
  window: "Fenêtres", door: "Portes", balcony: "Balcons",
  floor_line: "Lignes étage", roof: "Toiture", column: "Colonnes", other: "Autres",
};

type EditorTool = "select" | "add_rect" | "erase_rect" | "add_polygon" | "erase_polygon" | "linear" | "count" | "text" | "rescale" | "visual_search" | "translation" | "eraser";

/* ── Translation tool phases ── */
type TranslationPhase = "choose_shape" | "place_anchors" | "draw_shape" | "validate" | "choose_type";

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

/* ── Visibility layer types ── */
const VISIBILITY_TYPES = ["window", "wall_opaque"] as const;

interface FacadeEditorStepProps {
  result: FacadeAnalysisResult;
  onGoResults: (updated: FacadeAnalysisResult) => void;
  onRestart: () => void;
  initialFacadeZones?: Array<{ id: number; pts: Array<{ x: number; y: number }> }>;
}

export default function FacadeEditorStep({ result, onGoResults, onRestart, initialFacadeZones }: FacadeEditorStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  // Editable elements (local copy)
  const [elements, setElements] = useState<FacadeElement[]>(() =>
    (result.elements ?? []).map(el => el.type === "other" ? { ...el, type: "window" as FacadeElementType } : el)
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tool, setTool] = useState<EditorTool>("select");
  const [addType, setAddType] = useState<FacadeElementType>("window");

  // Masks from backend (editable via add/erase tools)
  const [masks, setMasks] = useState<Record<string, string>>(() => ({
    mask_window: result.mask_window_b64 ?? "",
    mask_door: result.mask_door_b64 ?? "",
    mask_balcony: result.mask_balcony_b64 ?? "",
    mask_roof: result.mask_roof_b64 ?? "",
    mask_column: result.mask_column_b64 ?? "",
    mask_wall_opaque: result.mask_wall_opaque_b64 ?? "",
  }));

  // Visibility toggles per type
  const [visibility, setVisibility] = useState<Record<string, boolean>>({
    window: true, door: true, balcony: true, floor_line: true,
    roof: true, column: true, other: true, wall_opaque: false,
  });

  // Active mask layer for editing
  const [activeLayer, setActiveLayer] = useState<string>("window");

  // Sidebar tab
  const [sidebarTab, setSidebarTab] = useState<"results" | "elements" | "visibility">("results");

  // Rect drawing for add_rect / erase_rect
  const [rectStart, setRectStart] = useState<Pt | null>(null);

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

  // Measurement tools
  const linearPtsRef = useRef<{x:number;y:number}[]>([]);
  const [linearMeasures, setLinearMeasures] = useState<Array<{id: string; p1: {x:number;y:number}; p2: {x:number;y:number}; distPx: number}>>([]);
  const [countPoints, setCountPoints] = useState<Array<{id: string; groupId: string; x: number; y: number}>>([]);
  const [countGroups] = useState([{id: "default", name: "Points", color: "#38bdf8"}]);
  const [activeCountGroupId] = useState("default");
  const [textAnnotations, setTextAnnotations] = useState<Array<{id: string; x: number; y: number; text: string; color: string}>>([]);
  const [textInputPos, setTextInputPos] = useState<{x:number;y:number} | null>(null);
  const [textInputValue, setTextInputValue] = useState("");

  // Visual search
  const [vsMatches, setVsMatches] = useState<Array<{x_norm:number;y_norm:number;w_norm:number;h_norm:number;score:number}>>([]);
  const [vsSearching, setVsSearching] = useState(false);
  const [vsCrop, setVsCrop] = useState<{x:number;y:number;w:number;h:number} | null>(null);
  const vsDrawing = useRef(false);
  const vsStart = useRef({x:0,y:0});
  const [vsEditMode, setVsEditMode] = useState<"search"|"add"|"remove">("search");
  const [vsSaveOpen, setVsSaveOpen] = useState(false);
  const [vsSaveLabel, setVsSaveLabel] = useState("");

  // Eraser tool state — draw a rect to subtract from an element's polygon
  const [eraserStart, setEraserStart] = useState<Pt | null>(null);
  const [eraserPreview, setEraserPreview] = useState<{ start: Pt; end: Pt } | null>(null);

  // Translation tool state
  const [transPhase, setTransPhase] = useState<TranslationPhase>("choose_shape");
  const [transShapeMode, setTransShapeMode] = useState<"rect" | "polygon">("rect");
  const [transAnchors, setTransAnchors] = useState<Pt[]>([]);
  const [transShape, setTransShape] = useState<Pt[]>([]); // the drawn shape (relative to anchor)
  const [transDrawing, setTransDrawing] = useState<Pt[]>([]); // points being drawn
  const [transRectStart, setTransRectStart] = useState<Pt | null>(null); // for rect mode

  // ── Blue wall overlay path (facade boundary minus window holes) ──
  // Facade delimitation zones (user-drawn polygons BEFORE crop)
  const facadeZones = useMemo(() => (initialFacadeZones ?? []), [initialFacadeZones]);

  // CSS clip-path to restrict masks to facade zones only
  const facadeClipStyle = useMemo(() => {
    if (facadeZones.length === 0) return undefined;
    // For single zone, use CSS polygon(). For multiple zones, we use SVG clipPath ref.
    if (facadeZones.length === 1) {
      const pts = facadeZones[0].pts.map(p => `${(p.x * 100).toFixed(2)}% ${(p.y * 100).toFixed(2)}%`).join(", ");
      return { clipPath: `polygon(${pts})` };
    }
    return { clipPath: "url(#fz-clip-editor)" };
  }, [facadeZones]);

  const wallSvgPath = useMemo(() => {
    const W = imgNat.w, H = imgNat.h;
    if (W === 0 || H === 0) return "";
    let p = "";
    // Outer boundary: facade zones (user-defined) > building_roi > full image
    if (facadeZones.length > 0) {
      facadeZones.forEach(zone => {
        if (zone.pts.length < 3) return;
        p += zone.pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x * W} ${pt.y * H}`).join(' ') + ' Z ';
      });
    } else {
      const roi = result.building_roi ?? { x: 0, y: 0, w: 1, h: 1 };
      const rx = roi.x * W, ry = roi.y * H, rw = roi.w * W, rh = roi.h * H;
      p = `M${rx} ${ry} h${rw} v${rh} h${-rw} Z`;
    }
    // Holes: all window elements (net surface = facade contour minus windows)
    elements.filter(e => e.type === "window" || e.type === "other").forEach(e => {
      if (e.polygon_norm && e.polygon_norm.length >= 3) {
        p += ' ' + e.polygon_norm.map((pt: {x:number;y:number}, i: number) => `${i === 0 ? 'M' : 'L'}${pt.x * W} ${pt.y * H}`).join(' ') + ' Z';
      } else {
        const x = e.bbox_norm.x * W, y = e.bbox_norm.y * H;
        const w = e.bbox_norm.w * W, h = e.bbox_norm.h * H;
        p += ` M${x} ${y} h${w} v${h} h${-w} Z`;
      }
    });
    return p;
  }, [imgNat, result.building_roi, elements, facadeZones]);

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

  /** Close the polygon being drawn -> create a new element */
  const closePolygon = useCallback((pts: Pt[]) => {
    if (pts.length < 3) { setDrawingPoly([]); return; }

    // Wall_opaque mode: delete window elements whose centroid is inside the drawn polygon
    if (addType === "wall_opaque") {
      const deleted = elements.filter(el => {
        if (el.type !== "window") return false;
        const poly = getPolyPoints(el);
        const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
        const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
        return pointInPolygon({ x: cx, y: cy }, pts);
      });
      if (deleted.length > 0) {
        setElements(prev => prev.filter(el => !deleted.some(del => del.id === el.id)));
        toast({ title: `${deleted.length} fenêtre(s) supprimée(s)`, description: "Zone restaurée comme mur", variant: "default" });
      }
      setDrawingPoly([]);
      setHoverPoint(null);
      return; // Don't create a wall element
    }

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
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      return;
    }

    if (tool === "visual_search" && e.button === 0) {
      const normPt = toNorm(e);
      if (vsEditMode === "remove" && vsMatches.length > 0) {
        const hitIdx = vsMatches.findIndex(m => normPt.x >= m.x_norm && normPt.x <= m.x_norm + m.w_norm && normPt.y >= m.y_norm && normPt.y <= m.y_norm + m.h_norm);
        if (hitIdx >= 0) { setVsMatches(prev => prev.filter((_, i) => i !== hitIdx)); }
        return;
      }
      vsDrawing.current = true;
      const pctX = normPt.x * 100, pctY = normPt.y * 100;
      vsStart.current = { x: pctX, y: pctY };
      setVsCrop({ x: pctX, y: pctY, w: 0, h: 0 });
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

    if (tool === "translation" && transPhase === "draw_shape" && transShapeMode === "rect") {
      const p = toNorm(e);
      setTransRectStart(p);
      return;
    }

    if (tool === "eraser") {
      const p = toNorm(e);
      setEraserStart(p);
      setEraserPreview({ start: p, end: p });
      return;
    }

    if (tool === "add_rect") {
      const p = toNorm(e);
      rectDragRef.current = p;
      setRectPreview({ start: p, end: p });
      return;
    }

    if (tool === "erase_rect" || tool === "erase_polygon") {
      const p = toNorm(e);
      setElements(prev => prev.filter(el => {
        const poly = getPolyPoints(el);
        return !pointInPolygon(p, poly);
      }));
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (isPanning) return;
    const normPt = toNorm(e);

    // Linear: 2 clicks = measure distance
    if (tool === "linear") {
      if (!linearPtsRef.current) linearPtsRef.current = [];
      linearPtsRef.current.push(normPt);
      if (linearPtsRef.current.length >= 2) {
        const p1 = linearPtsRef.current[0], p2 = linearPtsRef.current[1];
        const dx = (p2.x - p1.x) * imgNat.w, dy = (p2.y - p1.y) * imgNat.h;
        const distPx = Math.sqrt(dx*dx + dy*dy);
        setLinearMeasures(prev => [...prev, { id: crypto.randomUUID(), p1, p2, distPx }]);
        linearPtsRef.current = [];
      }
      return;
    }

    // Count: click = add point
    if (tool === "count") {
      setCountPoints(prev => [...prev, { id: crypto.randomUUID(), groupId: activeCountGroupId, x: normPt.x, y: normPt.y }]);
      return;
    }

    // Text: click = open input
    if (tool === "text") {
      setTextInputPos(normPt);
      setTextInputValue("");
      return;
    }

    // Rescale: 2 clicks, then prompt for meters
    if (tool === "rescale") {
      if (!linearPtsRef.current) linearPtsRef.current = [];
      linearPtsRef.current.push(normPt);
      if (linearPtsRef.current.length >= 2) {
        const p1 = linearPtsRef.current[0], p2 = linearPtsRef.current[1];
        const dx = (p2.x - p1.x) * imgNat.w, dy = (p2.y - p1.y) * imgNat.h;
        const distPx = Math.sqrt(dx*dx + dy*dy);
        const input = prompt("Distance réelle (mètres) :");
        if (input) {
          const meters = parseFloat(input);
          if (meters > 0) {
            toast({ title: `Échelle: ${(distPx/meters).toFixed(1)} px/m`, variant: "success" });
          }
        }
        linearPtsRef.current = [];
      }
      return;
    }

    // Translation tool
    if (tool === "translation") {
      if (transPhase === "place_anchors") {
        setTransAnchors(prev => [...prev, normPt]);
        return;
      }
      if (transPhase === "draw_shape" && transShapeMode === "polygon") {
        // If clicking near first point -> close shape
        if (transDrawing.length >= 3) {
          const first = transDrawing[0];
          const threshold = 12 / (imgNat.w * zoom);
          if (dist(normPt, first) < threshold) {
            // Shape = offsets from first anchor (or first point of shape)
            const anchor = transDrawing[0];
            const shape = transDrawing.map(p => ({ x: p.x - anchor.x, y: p.y - anchor.y }));
            setTransShape(shape);
            setTransDrawing([]);
            setTransPhase("validate");
            return;
          }
        }
        setTransDrawing(prev => [...prev, normPt]);
        return;
      }
      return;
    }

    // Only continue for add_polygon tool
    if (tool !== "add_polygon") return;
    const p = normPt;

    // If clicking near first point -> close polygon
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

    // Visual search crop drawing
    if (vsDrawing.current && vsCrop) {
      setVsCrop({ x: Math.min(vsStart.current.x, p.x * 100), y: Math.min(vsStart.current.y, p.y * 100), w: Math.abs(p.x * 100 - vsStart.current.x), h: Math.abs(p.y * 100 - vsStart.current.y) });
    }

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

    // Eraser preview
    if (tool === "eraser" && eraserStart) {
      setEraserPreview({ start: eraserStart, end: p });
    }

    // Translation rect drawing
    if (tool === "translation" && transPhase === "draw_shape" && transShapeMode === "rect" && transRectStart) {
      setTransDrawing([transRectStart, p]);
    }

    // Translation polygon hover
    if (tool === "translation" && transPhase === "draw_shape" && transShapeMode === "polygon" && transDrawing.length > 0) {
      setHoverPoint(p);
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

    // Visual search: finish crop drawing
    if (vsDrawing.current && tool === "visual_search") {
      vsDrawing.current = false;
      if (vsCrop && vsCrop.w > 0.5 && vsCrop.h > 0.5) {
        const cropNorm = { x: vsCrop.x / 100, y: vsCrop.y / 100, w: vsCrop.w / 100, h: vsCrop.h / 100 };
        if (vsEditMode === "add") {
          // Manually add a match rectangle
          setVsMatches(prev => [...prev, { x_norm: cropNorm.x, y_norm: cropNorm.y, w_norm: cropNorm.w, h_norm: cropNorm.h, score: 1.0 }]);
        } else {
          // Search mode: find all elements that look similar (same type, similar size)
          const refEl = elements.find(el => {
            const cx = el.bbox_norm.x + el.bbox_norm.w / 2;
            const cy = el.bbox_norm.y + el.bbox_norm.h / 2;
            return cx >= cropNorm.x && cx <= cropNorm.x + cropNorm.w && cy >= cropNorm.y && cy <= cropNorm.y + cropNorm.h;
          });
          if (refEl) {
            // Find all elements of same type with similar aspect ratio
            const refAR = refEl.bbox_norm.w / (refEl.bbox_norm.h || 0.001);
            const refArea = refEl.bbox_norm.w * refEl.bbox_norm.h;
            const similar = elements.filter(el => {
              if (el.id === refEl.id) return false;
              if (el.type !== refEl.type) return false;
              const ar = el.bbox_norm.w / (el.bbox_norm.h || 0.001);
              const area = el.bbox_norm.w * el.bbox_norm.h;
              return Math.abs(ar - refAR) / refAR < 0.5 && Math.abs(area - refArea) / refArea < 0.8;
            });
            const matches = similar.map(el => ({
              x_norm: el.bbox_norm.x, y_norm: el.bbox_norm.y,
              w_norm: el.bbox_norm.w, h_norm: el.bbox_norm.h, score: 0.9,
            }));
            setVsMatches(matches);
            toast({ title: `${matches.length} élément(s) similaire(s) trouvé(s)`, variant: matches.length > 0 ? "success" : "default" });
          } else {
            toast({ title: "Aucun élément dans la zone sélectionnée", variant: "default" });
          }
        }
        setVsCrop(null);
      } else { setVsCrop(null); }
    }

    // Eraser: subtract eraser rect from overlapping elements + split if needed
    // Behavior depends on active edit layer:
    //   addType === "window" → erase from windows (gommée zone becomes wall)
    //   addType === "wall_opaque" → erase from wall, create window in erased zone
    if (tool === "eraser" && eraserStart && eraserPreview) {
      const { start, end } = eraserPreview;
      const ex1 = Math.min(start.x, end.x), ey1 = Math.min(start.y, end.y);
      const ex2 = Math.max(start.x, end.x), ey2 = Math.max(start.y, end.y);
      if (ex2 - ex1 > 0.003 && ey2 - ey1 > 0.003) {
        const ppm = result.pixels_per_meter;

        // If editing "Surface nette" → erased zone becomes a window
        if (addType === "wall_opaque") {
          const newId = Math.max(0, ...elements.map(e => e.id)) + 1;
          const newPts: Pt[] = [
            { x: ex1, y: ey1 }, { x: ex2, y: ey1 },
            { x: ex2, y: ey2 }, { x: ex1, y: ey2 },
          ];
          const areaPx = polygonAreaPx(newPts, imgNat.w, imgNat.h);
          setElements(prev => [...prev, {
            id: newId,
            type: "window" as FacadeElementType,
            label_fr: "Fenêtre",
            bbox_norm: { x: ex1, y: ey1, w: ex2 - ex1, h: ey2 - ey1 },
            polygon_norm: newPts,
            area_m2: ppm ? areaPx / (ppm * ppm) : null,
            floor_level: 0,
            confidence: 1.0,
          }]);
          toast({ title: "Fenêtre créée", description: "Zone gommée du mur → fenêtre", variant: "success" });
        } else {
          // Editing "Fenêtres" → erase from windows, possibly splitting them
          const targetTypes = ["window", "other"];
          let nextId = Math.max(0, ...elements.map(e => e.id)) + 1;
          const newElements: FacadeElement[] = [];

          setElements(prev => {
            const kept: FacadeElement[] = [];
            for (const el of prev) {
              if (!targetTypes.includes(el.type)) { kept.push(el); continue; }
              const bx = el.bbox_norm;
              const bx2 = bx.x + bx.w, by2 = bx.y + bx.h;
              // Check overlap
              const overlapX = Math.max(0, Math.min(bx2, ex2) - Math.max(bx.x, ex1));
              const overlapY = Math.max(0, Math.min(by2, ey2) - Math.max(bx.y, ey1));
              if (overlapX <= 0 || overlapY <= 0) { kept.push(el); continue; }

              // Eraser fully contains element → delete
              if (ex1 <= bx.x && ex2 >= bx2 && ey1 <= bx.y && ey2 >= by2) continue;

              // Generate up to 4 sub-rectangles (left, right, top, bottom of eraser hole)
              const rects: Array<{ x: number; y: number; w: number; h: number }> = [];

              // Left piece
              if (ex1 > bx.x) {
                rects.push({ x: bx.x, y: bx.y, w: ex1 - bx.x, h: bx.h });
              }
              // Right piece
              if (ex2 < bx2) {
                rects.push({ x: ex2, y: bx.y, w: bx2 - ex2, h: bx.h });
              }
              // Top piece (between left and right)
              const midX1 = Math.max(bx.x, ex1), midX2 = Math.min(bx2, ex2);
              if (ey1 > bx.y && midX2 > midX1) {
                rects.push({ x: midX1, y: bx.y, w: midX2 - midX1, h: ey1 - bx.y });
              }
              // Bottom piece (between left and right)
              if (ey2 < by2 && midX2 > midX1) {
                rects.push({ x: midX1, y: ey2, w: midX2 - midX1, h: by2 - ey2 });
              }

              // Filter valid rects and create elements
              for (const r of rects) {
                if (r.w < 0.003 || r.h < 0.003) continue;
                const pts: Pt[] = [
                  { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
                  { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h },
                ];
                const areaPx = polygonAreaPx(pts, imgNat.w, imgNat.h);
                kept.push({
                  ...el,
                  id: nextId++,
                  bbox_norm: r,
                  polygon_norm: pts,
                  area_m2: ppm ? areaPx / (ppm * ppm) : el.area_m2,
                });
              }
            }
            return kept;
          });
          toast({ title: "Zone gommée", description: "Fenêtre(s) ajustée(s) / séparée(s)", variant: "default" });
        }
      }
      setEraserStart(null);
      setEraserPreview(null);
      return;
    }

    // Translation rect: finish drawing rectangle shape
    if (tool === "translation" && transPhase === "draw_shape" && transShapeMode === "rect" && transRectStart && transDrawing.length === 2) {
      const s = transDrawing[0], e = transDrawing[1];
      const dx = Math.abs(e.x - s.x), dy = Math.abs(e.y - s.y);
      if (dx > 0.005 || dy > 0.005) {
        const shape: Pt[] = [
          { x: 0, y: 0 },
          { x: dx, y: 0 },
          { x: dx, y: dy },
          { x: 0, y: dy },
        ];
        setTransShape(shape);
        setTransPhase("validate");
      }
      setTransRectStart(null);
      setTransDrawing([]);
      return;
    }

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

  // Translation: apply shape to all anchors, creating elements
  const applyTranslation = (type: FacadeElementType) => {
    if (transAnchors.length === 0 || transShape.length < 3) return;
    const ppm = result.pixels_per_meter;
    let nextId = Math.max(0, ...elements.map(e => e.id)) + 1;
    const newElements: FacadeElement[] = [];
    for (const anchor of transAnchors) {
      const pts = transShape.map(s => ({
        x: Math.max(0, Math.min(1, anchor.x + s.x)),
        y: Math.max(0, Math.min(1, anchor.y + s.y)),
      }));
      const bbox = bboxFromPoly(pts);
      const areaPx = polygonAreaPx(pts, imgNat.w, imgNat.h);
      newElements.push({
        id: nextId++,
        type,
        label_fr: type === "window" ? "Fenêtre" : "Mur",
        bbox_norm: bbox,
        polygon_norm: pts,
        area_m2: ppm ? areaPx / (ppm * ppm) : null,
        floor_level: 0,
        confidence: 1.0,
      });
    }
    setElements(prev => [...prev, ...newElements]);
    // Reset translation tool
    setTransAnchors([]);
    setTransShape([]);
    setTransDrawing([]);
    setTransPhase("choose_shape");
    setTool("select");
    toast({ title: `${newElements.length} ${type === "window" ? "fenêtre(s)" : "zone(s) mur"} créée(s)`, variant: "success" });
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
    const openingElements = elements.filter(e => ["window", "door", "balcony", "other"].includes(e.type));
    const openings_area_m2 = result.pixels_per_meter
      ? openingElements.reduce((s, e) => s + (e.area_m2 ?? 0), 0)
      : null;

    const wallArea = result.facade_area_m2
      ? result.facade_area_m2 - (openings_area_m2 ?? 0)
      : null;

    const updated: FacadeAnalysisResult = {
      ...result,
      elements,
      windows_count: elements.filter(e => e.type === "window" || e.type === "other").length,
      doors_count: elements.filter(e => e.type === "door").length,
      balconies_count: elements.filter(e => e.type === "balcony").length,
      floors_count: Math.max(1, new Set(elements.map(e => e.floor_level ?? 0)).size),
      openings_area_m2,
      surface_mur_net: wallArea,
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

  // Visible elements filter — respects visibility toggles
  const visibleElements = elements.filter(e => {
    if (e.type === "window" && !visibility.window) return false;
    if (e.type === "other" && !visibility.window) return false; // "other" = remapped window
    if (e.type === "column" && !showColumns) return false;
    return true;
  });

  const isDrawing = tool === "add_polygon" && drawingPoly.length > 0;

  // ── Computed stats for sidebar ──
  const windowElements = elements.filter(e => e.type === "window");
  const windowsCount = windowElements.length;
  const windowsArea = windowElements.reduce((s, e) => s + (e.area_m2 ?? 0), 0);
  const facadeArea = result.facade_area_m2 ?? null;
  const netFacadeArea = facadeArea != null ? facadeArea - windowsArea : null;

  // Element counts by type
  const elementCountsByType = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const el of elements) {
      counts[el.type] = (counts[el.type] ?? 0) + 1;
    }
    return counts;
  }, [elements]);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      {/* Mock warning */}
      {result.is_mock && (
        <div className="mb-4 glass rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300/80">{d("fa_mock_warn")}</p>
        </div>
      )}

      <div className="flex gap-2">
        {/* ── Left: Canvas + toolbars ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">

          {/* ══ HEADER ══ */}
          <div className="flex items-center gap-2 h-11 mb-1.5">
            <div className="flex-1" />
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={exportCSV}>
                <Download className="w-3.5 h-3.5" /> CSV
              </Button>
              <Button size="sm" onClick={goResults} className="bg-amber-600 hover:bg-amber-700">
                <ArrowLeft className="w-3.5 h-3.5" /> Résultats
              </Button>
              <Button size="sm" variant="ghost" onClick={onRestart}><RotateCcw className="w-3.5 h-3.5" /></Button>
            </div>
          </div>

          {/* ══ BAR 1 : VISIBILITY ══ */}
          <div className="flex items-center gap-1 px-2 py-1 glass rounded-xl border border-white/10 shrink-0">
            <span className="text-[8px] text-slate-600 uppercase tracking-wider font-mono mr-0.5 shrink-0">VISIBILITY</span>
            {/* Window toggle */}
            <button onClick={() => setVisibility(v => ({...v, window: !v.window}))}
              className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-all",
                visibility.window ? "border-pink-500/30 bg-pink-500/10 text-pink-400" : "border-white/5 hover:border-white/10 hover:bg-white/5")}>
              <AppWindow size={10} className="text-pink-400" />
              {visibility.window ? <Eye className="w-2.5 h-2.5 text-pink-400" /> : <EyeOff className="w-2.5 h-2.5 text-slate-600" />}
            </button>
            {/* Wall toggle */}
            <button onClick={() => setVisibility(v => ({...v, wall_opaque: !v.wall_opaque}))}
              className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-all",
                visibility.wall_opaque ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-white/5 hover:border-white/10 hover:bg-white/5")}>
              <Building2 size={10} className="text-green-400" />
              {visibility.wall_opaque ? <Eye className="w-2.5 h-2.5 text-green-400" /> : <EyeOff className="w-2.5 h-2.5 text-slate-600" />}
            </button>
          </div>

          {/* ══ BAR 2 : EDIT LAYER ══ */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 glass rounded-xl border border-white/10 shrink-0 flex-wrap">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mr-1 shrink-0">EDIT</span>

            {/* Layer buttons: Window + Surface nette */}
            <button onClick={() => { setAddType("window"); setActiveLayer("window"); setVisibility(v => ({ ...v, window: true })); if (tool === "select") setTool("add_rect"); }}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                addType === "window" ? "border-pink-500/40 bg-pink-500/10 text-pink-400" : "border-white/5 hover:border-white/10 hover:bg-white/5")}>
              <AppWindow className={cn("w-4 h-4 shrink-0", "text-pink-400")} />
              <span className={addType === "window" ? "" : "text-slate-400"}>Fenêtres</span>
            </button>
            <button onClick={() => { setAddType("wall_opaque"); setActiveLayer("wall_opaque"); setVisibility(v => ({ ...v, wall_opaque: true })); if (tool === "select") setTool("add_rect"); }}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                addType === "wall_opaque" ? "border-green-500/40 bg-green-500/10 text-green-400" : "border-white/5 hover:border-white/10 hover:bg-white/5")}>
              <Building2 className={cn("w-4 h-4 shrink-0", "text-green-400")} />
              <span className={addType === "wall_opaque" ? "" : "text-slate-400"}>Surface nette</span>
            </button>

            <div className="w-px h-4 bg-white/10 shrink-0 mx-0.5" />

            {/* Tools */}
            <button onClick={() => { setTool("select"); setDrawingPoly([]); }} title="Sélection"
              className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                tool === "select" ? "border-teal-500/40 bg-teal-500/10 text-teal-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
              <MousePointer2 className="w-3 h-3" /> Sélection
            </button>
            <button onClick={() => { setTool("add_rect"); setSelectedId(null); }} title="Dessiner rectangle"
              className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                tool === "add_rect" ? "border-accent/40 bg-accent/10 text-accent" : "border-white/5 text-slate-500 hover:text-slate-300")}>
              <Square className="w-3 h-3" /> Dessiner
            </button>
            <button onClick={() => { setTool("add_polygon"); setSelectedId(null); }} title="Forme libre"
              className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                tool === "add_polygon" ? "border-accent/40 bg-accent/10 text-accent" : "border-white/5 text-slate-500 hover:text-slate-300")}>
              <Pentagon className="w-3 h-3" /> Forme libre
            </button>
            <button onClick={() => { setTool("erase_rect"); setDrawingPoly([]); }} title="Supprimer élément"
              className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                tool === "erase_rect" ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
              <Trash2 className="w-3 h-3" /> Supprimer
            </button>
            <button onClick={() => { setTool("eraser"); setSelectedId(null); }} title="Gomme — affiner les zones"
              className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                tool === "eraser" ? "border-orange-500/40 bg-orange-500/10 text-orange-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
              <Eraser className="w-3 h-3" /> Gomme
            </button>

            <div className="w-px h-4 bg-white/10 shrink-0 mx-0.5" />

            {/* Measurement tools */}
            <button onClick={() => setTool("linear")} title="Mesure de distance"
              className={cn("flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] border transition-all",
                tool === "linear" ? "border-sky-500/40 bg-sky-500/10 text-sky-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
              <Ruler className="w-2.5 h-2.5" /> Linéaire
            </button>
            <button onClick={() => setTool("count")} title="Annotation points"
              className={cn("flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] border transition-all",
                tool === "count" ? "border-sky-500/40 bg-sky-500/10 text-sky-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
              <Hash className="w-2.5 h-2.5" /> Comptage
            </button>
            <button onClick={() => setTool("text")} title="Annotation texte"
              className={cn("flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] border transition-all",
                tool === "text" ? "border-sky-500/40 bg-sky-500/10 text-sky-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
              <Type className="w-2.5 h-2.5" /> Texte
            </button>
            <button onClick={() => setTool("rescale")} title="Recalibrer l'échelle"
              className={cn("flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] border transition-all",
                tool === "rescale" ? "border-amber-500/40 bg-amber-500/10 text-amber-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
              <Ruler className="w-2.5 h-2.5" /> Échelle
            </button>

            <button onClick={() => {
              setTool("translation");
              setTransPhase("choose_shape");
              setTransAnchors([]);
              setTransShape([]);
              setTransDrawing([]);
              setSelectedId(null);
            }} title="Translation — dupliquer une forme sur plusieurs points"
              className={cn("flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold border-2 transition-all",
                tool === "translation"
                  ? "border-orange-500 bg-orange-500/20 text-orange-300 shadow-lg shadow-orange-500/20"
                  : "border-orange-500/50 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20")}>
              <Copy className="w-3.5 h-3.5" /> Translation
            </button>

            <div className="w-px h-4 bg-white/10 shrink-0 mx-0.5" />

            {/* Visual Search */}
            <button onClick={() => { setTool("visual_search"); setVsEditMode("search"); }}
              title="Détecter similaires"
              className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                tool === "visual_search" ? "border-amber-500/40 bg-amber-500/10 text-amber-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
              <Search className="w-3 h-3" /> Détecter
            </button>

            {/* VS sub-toolbar */}
            {tool === "visual_search" && (
              <div className="flex items-center gap-1.5">
                {vsSearching && <span className="text-[10px] text-amber-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Recherche...</span>}
                {!vsSearching && vsMatches.length === 0 && <span className="text-[10px] text-slate-500 italic">Dessinez un rectangle autour d&apos;un élément</span>}
                {vsMatches.length > 0 && (<>
                  {(["search","add","remove"] as const).map(m => (
                    <button key={m} onClick={() => setVsEditMode(m)}
                      className={cn("px-1.5 py-0.5 rounded text-[10px] border transition-all",
                        vsEditMode === m ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                      {m === "search" ? "Chercher" : m === "add" ? "Ajouter" : "Retirer"}
                    </button>
                  ))}
                  <span className="text-[10px] font-semibold text-amber-400">{vsMatches.length} trouvé(s)</span>
                  <button onClick={() => { setVsMatches([]); setVsCrop(null); }} className="text-slate-500 hover:text-white"><X className="w-3 h-3" /></button>
                </>)}
              </div>
            )}

            {/* Deselect X */}
            {tool !== "select" && (
              <button onClick={() => { setTool("select"); setDrawingPoly([]); }}
                className="ml-0.5 p-0.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                <X className="w-3 h-3" />
              </button>
            )}

            {/* Drawing hints */}
            {isDrawing && (
              <span className="text-xs text-amber-300/70 animate-pulse ml-2">
                {drawingPoly.length < 3 ? "Cliquez pour poser des points..." : "Double-clic ou clic sur le 1er point pour fermer"}
              </span>
            )}
            {tool === "add_rect" && !isDrawing && (
              <span className="text-xs text-amber-300/70 animate-pulse ml-2">
                {rectPreview ? "Relâchez pour créer le rectangle" : "Cliquez et glissez pour dessiner un rectangle"}
              </span>
            )}
          </div>

          {/* ══ TRANSLATION TOOL PANEL ══ */}
          {tool === "translation" && (
            <div className="flex items-center gap-2 px-3 py-2 glass rounded-xl border border-violet-500/30 bg-violet-500/5 mb-1">
              <Copy className="w-4 h-4 text-violet-400 shrink-0" />
              <span className="text-xs font-semibold text-violet-400">Translation</span>
              <div className="w-px h-4 bg-white/10" />

              {transPhase === "choose_shape" && (
                <>
                  <span className="text-[10px] text-slate-400">Forme :</span>
                  <button onClick={() => { setTransShapeMode("rect"); setTransPhase("place_anchors"); }}
                    className="px-2 py-1 rounded text-[10px] border border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20">
                    <Square className="w-3 h-3 inline mr-1" />Rectangle
                  </button>
                  <button onClick={() => { setTransShapeMode("polygon"); setTransPhase("place_anchors"); }}
                    className="px-2 py-1 rounded text-[10px] border border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20">
                    <Pentagon className="w-3 h-3 inline mr-1" />Polygone
                  </button>
                </>
              )}

              {transPhase === "place_anchors" && (
                <>
                  <span className="text-[10px] text-slate-400">
                    Cliquez pour placer les points d&apos;ancrage ({transAnchors.length} placé{transAnchors.length > 1 ? "s" : ""})
                  </span>
                  <button onClick={() => { if (transAnchors.length > 0) setTransPhase("draw_shape"); }}
                    disabled={transAnchors.length === 0}
                    className={cn("px-2 py-1 rounded text-[10px] border font-medium",
                      transAnchors.length > 0
                        ? "border-green-500/40 bg-green-500/10 text-green-400 hover:bg-green-500/20"
                        : "border-white/10 text-slate-600 cursor-not-allowed")}>
                    Valider les points ✓
                  </button>
                  {transAnchors.length > 0 && (
                    <button onClick={() => setTransAnchors(prev => prev.slice(0, -1))}
                      className="px-1.5 py-1 rounded text-[10px] border border-red-500/30 text-red-400 hover:bg-red-500/10">
                      Annuler dernier
                    </button>
                  )}
                </>
              )}

              {transPhase === "draw_shape" && (
                <span className="text-[10px] text-slate-400">
                  {transShapeMode === "rect"
                    ? "Dessinez un rectangle (cliquez-glissez)"
                    : `Dessinez un polygone (${transDrawing.length} pts — cliquez sur le 1er pour fermer)`}
                </span>
              )}

              {transPhase === "validate" && (
                <>
                  <span className="text-[10px] text-green-400 font-medium">Forme dessinée sur {transAnchors.length} point(s)</span>
                  <button onClick={() => setTransPhase("choose_type")}
                    className="px-2 py-1 rounded text-[10px] border border-green-500/40 bg-green-500/10 text-green-400 hover:bg-green-500/20 font-medium">
                    Valider ✓
                  </button>
                  <button onClick={() => { setTransShape([]); setTransDrawing([]); setTransPhase("draw_shape"); }}
                    className="px-2 py-1 rounded text-[10px] border border-amber-500/30 text-amber-400 hover:bg-amber-500/10">
                    Recommencer forme
                  </button>
                  <button onClick={() => { setTransPhase("place_anchors"); }}
                    className="px-2 py-1 rounded text-[10px] border border-sky-500/30 text-sky-400 hover:bg-sky-500/10">
                    + Ajouter ancrages
                  </button>
                </>
              )}

              {transPhase === "choose_type" && (
                <>
                  <span className="text-[10px] text-slate-400">Type de zone :</span>
                  <button onClick={() => applyTranslation("window")}
                    className="px-2 py-1 rounded text-[10px] border border-pink-500/40 bg-pink-500/10 text-pink-400 hover:bg-pink-500/20 font-medium">
                    <AppWindow className="w-3 h-3 inline mr-1" />Fenêtre
                  </button>
                  <button onClick={() => applyTranslation("wall_opaque" as FacadeElementType)}
                    className="px-2 py-1 rounded text-[10px] border border-green-500/40 bg-green-500/10 text-green-400 hover:bg-green-500/20 font-medium">
                    <Building2 className="w-3 h-3 inline mr-1" />Surface mur
                  </button>
                </>
              )}

              <div className="flex-1" />
              <button onClick={() => { setTool("select"); setTransAnchors([]); setTransShape([]); setTransDrawing([]); setTransPhase("choose_shape"); }}
                className="px-1.5 py-1 rounded text-[10px] text-slate-500 hover:text-red-400">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* ══ CANVAS ══ */}
          <div
            ref={containerRef}
            className="flex-1 rounded-xl border border-white/10 relative overflow-hidden"
            style={{
              cursor: isPanning ? "grabbing" : tool === "select" ? "default" : "crosshair",
              background: "#0d1117",
              backgroundImage: "radial-gradient(circle, rgba(148,163,184,0.13) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
              minHeight: "calc(100vh - 280px)",
            }}
            onContextMenu={e => e.preventDefault()}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onMouseLeave={() => { setIsPanning(false); setHoverPoint(null); }}
          >
            {/* Floating zoom controls — top-right glass pill */}
            <div className="absolute top-3 right-3 z-20 flex items-center gap-1 glass border border-white/10 rounded-lg p-1">
              <button onClick={handleZoomIn} className="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors" title="Zoom +">
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button onClick={handleZoomOut} className="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors" title="Zoom −">
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <div className="w-px h-5 bg-white/10" />
              <button onClick={() => { setZoom(1); setPan({x:0,y:0}); }} className="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors" title="Réinitialiser">
                <RotateCcw className="w-3 h-3" />
              </button>
              {Math.abs(zoom - 1) > 0.05 && <span className="text-[9px] text-slate-500 font-mono pl-0.5">{zoom.toFixed(1)}x</span>}
            </div>

            {/* Transform wrapper — center pattern */}
            <div style={{
              position: "absolute",
              top: "50%", left: "50%",
              transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
              transformOrigin: "center center",
            }}>
              <div className="relative">
                <img
                  src={`data:image/png;base64,${result.plan_b64}`}
                  alt="Facade"
                  style={{ display: "block", maxWidth: "calc(100vw - 300px)", maxHeight: "calc(100vh - 300px)" }}
                  className="select-none"
                  draggable={false}
                  onLoad={e => {
                    const img = e.currentTarget;
                    setImgNat({ w: img.naturalWidth, h: img.naturalHeight });
                    setImgDisplay({ w: img.clientWidth, h: img.clientHeight });
                  }}
                />

                {/* ── Facade zone clip (SVG def for clipping masks to delimited zones) ── */}
                {facadeZones.length > 0 && (
                  <svg className="absolute" width="0" height="0" style={{ position: "absolute" }}>
                    <defs>
                      <clipPath id="fz-clip-editor" clipPathUnits="objectBoundingBox">
                        {facadeZones.map(z => (
                          <polygon key={z.id} points={z.pts.map(p => `${p.x},${p.y}`).join(" ")} />
                        ))}
                      </clipPath>
                    </defs>
                  </svg>
                )}

                {/* ── Mask layers (from backend, editable) ── */}
                {visibility.window && masks.mask_window && (
                  <div className="absolute inset-0 pointer-events-none" style={{
                    backgroundColor: TYPE_COLORS.window,
                    opacity: 1.0,
                    WebkitMaskImage: `url(data:image/png;base64,${masks.mask_window})`,
                    maskImage: `url(data:image/png;base64,${masks.mask_window})`,
                    WebkitMaskSize: "100% 100%", maskSize: "100% 100%",
                    maskMode: "luminance", zIndex: 1,
                    ...facadeClipStyle,
                  }} />
                )}
                {visibility.door && masks.mask_door && (
                  <div className="absolute inset-0 pointer-events-none" style={{
                    backgroundColor: TYPE_COLORS.door,
                    opacity: 0.45,
                    WebkitMaskImage: `url(data:image/png;base64,${masks.mask_door})`,
                    maskImage: `url(data:image/png;base64,${masks.mask_door})`,
                    WebkitMaskSize: "100% 100%", maskSize: "100% 100%",
                    maskMode: "luminance", zIndex: 1,
                    ...facadeClipStyle,
                  }} />
                )}
                {visibility.balcony && masks.mask_balcony && (
                  <div className="absolute inset-0 pointer-events-none" style={{
                    backgroundColor: TYPE_COLORS.balcony,
                    opacity: 0.45,
                    WebkitMaskImage: `url(data:image/png;base64,${masks.mask_balcony})`,
                    maskImage: `url(data:image/png;base64,${masks.mask_balcony})`,
                    WebkitMaskSize: "100% 100%", maskSize: "100% 100%",
                    maskMode: "luminance", zIndex: 1,
                    ...facadeClipStyle,
                  }} />
                )}
                {visibility.roof && masks.mask_roof && (
                  <div className="absolute inset-0 pointer-events-none" style={{
                    backgroundColor: TYPE_COLORS.roof,
                    opacity: 0.35,
                    WebkitMaskImage: `url(data:image/png;base64,${masks.mask_roof})`,
                    maskImage: `url(data:image/png;base64,${masks.mask_roof})`,
                    WebkitMaskSize: "100% 100%", maskSize: "100% 100%",
                    maskMode: "luminance", zIndex: 1,
                    ...facadeClipStyle,
                  }} />
                )}
                {visibility.column && masks.mask_column && (
                  <div className="absolute inset-0 pointer-events-none" style={{
                    backgroundColor: TYPE_COLORS.column,
                    opacity: 0.35,
                    WebkitMaskImage: `url(data:image/png;base64,${masks.mask_column})`,
                    maskImage: `url(data:image/png;base64,${masks.mask_column})`,
                    WebkitMaskSize: "100% 100%", maskSize: "100% 100%",
                    maskMode: "luminance", zIndex: 1,
                    ...facadeClipStyle,
                  }} />
                )}

                {/* ── Wall net surface: SVG (building ROI minus all window holes) ── */}
                {visibility.wall_opaque && wallSvgPath && imgNat.w > 0 && (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox={`0 0 ${imgNat.w} ${imgNat.h}`} preserveAspectRatio="xMidYMid meet" style={{ zIndex: 0, ...facadeClipStyle }}>
                    <path d={wallSvgPath} fillRule="evenodd" fill="#22c55e" fillOpacity={0.55} />
                  </svg>
                )}

                {/* ── SVG overlay ── */}
                <svg
                  className="absolute inset-0 w-full h-full"
                  viewBox={`0 0 ${imgNat.w} ${imgNat.h}`}
                  preserveAspectRatio="xMidYMid meet"
                  style={{ pointerEvents: "none", ...facadeClipStyle }}
                >
                  {/* ── Existing elements ── */}
                  {visibleElements.map(el => {
                    const color = TYPE_COLORS[el.type] ?? "#94a3b8";
                    const isSelected = el.id === selectedId;

                    // Floor line -> special rendering
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
                          const label = d(TYPE_I18N[el.type] ?? "fa_window");
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

                  {/* ── Linear measurements ── */}
                  {linearMeasures.map(lm => {
                    const x1 = lm.p1.x * imgNat.w, y1 = lm.p1.y * imgNat.h;
                    const x2 = lm.p2.x * imgNat.w, y2 = lm.p2.y * imgNat.h;
                    const mx = (x1+x2)/2, my = (y1+y2)/2;
                    const ppm = result.pixels_per_meter;
                    const distM = ppm ? lm.distPx / ppm : null;
                    const label = distM ? `${distM.toFixed(2)} m` : `${Math.round(lm.distPx)} px`;
                    return (
                      <g key={lm.id} style={{pointerEvents:"all",cursor:"pointer"}} onClick={() => setLinearMeasures(p => p.filter(m => m.id !== lm.id))}>
                        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#38bdf8" strokeWidth={2} strokeDasharray="4 2" />
                        <circle cx={x1} cy={y1} r={4} fill="#38bdf8" />
                        <circle cx={x2} cy={y2} r={4} fill="#38bdf8" />
                        <rect x={mx-30} y={my-9} width={60} height={18} rx={4} fill="rgba(10,16,32,0.92)" stroke="#38bdf8" strokeWidth={1} />
                        <text x={mx} y={my+4} textAnchor="middle" fill="#38bdf8" fontSize={10} fontWeight="600" fontFamily="monospace">{label}</text>
                      </g>
                    );
                  })}

                  {/* ── Count points ── */}
                  {countPoints.map((cp, idx) => {
                    const grp = countGroups.find(g => g.id === cp.groupId);
                    const color = grp?.color ?? "#38bdf8";
                    const px = cp.x * imgNat.w, py = cp.y * imgNat.h;
                    return (
                      <g key={cp.id} style={{pointerEvents:"all",cursor:"pointer"}} onClick={() => setCountPoints(p => p.filter(pt => pt.id !== cp.id))}>
                        <circle cx={px} cy={py} r={14} fill={color} fillOpacity={0.4} stroke={color} strokeWidth={2.5} />
                        <text x={px} y={py+4.5} textAnchor="middle" fill="white" fontSize={10} fontWeight="800" fontFamily="monospace">{idx+1}</text>
                      </g>
                    );
                  })}

                  {/* ── Text annotations ── */}
                  {textAnnotations.map(ta => {
                    const px = ta.x * imgNat.w, py = ta.y * imgNat.h;
                    const w = ta.text.length * 7 + 16;
                    return (
                      <g key={ta.id} style={{pointerEvents:"all",cursor:"pointer"}} onClick={() => setTextAnnotations(p => p.filter(t => t.id !== ta.id))}>
                        <rect x={px-4} y={py-12} width={w} height={20} rx={4} fill="rgba(0,0,0,0.75)" stroke={ta.color} strokeWidth={1} />
                        <text x={px+4} y={py+2} fill={ta.color} fontSize={11} fontFamily="system-ui">{ta.text}</text>
                      </g>
                    );
                  })}

                  {/* ── VS matches ── */}
                  {vsMatches.map((m, i) => (
                    <rect key={`vs-${i}`} x={m.x_norm * imgNat.w} y={m.y_norm * imgNat.h} width={m.w_norm * imgNat.w} height={m.h_norm * imgNat.h}
                      fill="rgba(251,191,36,0.15)" stroke="#fbbf24" strokeWidth={2} strokeDasharray="4 2" rx={3}
                      style={{pointerEvents: vsEditMode === "remove" ? "all" : "none", cursor: vsEditMode === "remove" ? "pointer" : "default"}}
                      onClick={() => { if (vsEditMode === "remove") setVsMatches(prev => prev.filter((_, j) => j !== i)); }}
                    />
                  ))}

                  {/* ── VS crop rectangle ── */}
                  {vsCrop && vsCrop.w > 0 && vsCrop.h > 0 && (
                    <rect x={vsCrop.x/100 * imgNat.w} y={vsCrop.y/100 * imgNat.h} width={vsCrop.w/100 * imgNat.w} height={vsCrop.h/100 * imgNat.h}
                      fill="rgba(251,191,36,0.1)" stroke="#fbbf24" strokeWidth={2} strokeDasharray="6 3" />
                  )}

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

                  {/* ── Eraser preview ── */}
                  {tool === "eraser" && eraserPreview && (() => {
                    const { start, end } = eraserPreview;
                    const rx = Math.min(start.x, end.x) * imgNat.w;
                    const ry = Math.min(start.y, end.y) * imgNat.h;
                    const rw = Math.abs(end.x - start.x) * imgNat.w;
                    const rh = Math.abs(end.y - start.y) * imgNat.h;
                    // Color depends on edit mode: pink if erasing wall→window, red if erasing window→wall
                    const isWallMode = addType === "wall_opaque";
                    const color = isWallMode ? "#ff00ff" : "#ef4444";
                    const fillColor = isWallMode ? "rgba(255,0,255,0.2)" : "rgba(239,68,68,0.2)";
                    return (
                      <g>
                        <rect x={rx} y={ry} width={rw} height={rh}
                          fill={fillColor} stroke={color} strokeWidth={2} strokeDasharray="6 3" />
                        <text x={rx + rw / 2} y={ry + rh / 2}
                          textAnchor="middle" dominantBaseline="middle"
                          fill={color} fontSize={10} fontFamily="system-ui" fontWeight={700}>
                          {isWallMode ? "→ Fenêtre" : "→ Mur"}
                        </text>
                      </g>
                    );
                  })()}

                  {/* ── Translation tool overlays ── */}
                  {tool === "translation" && (
                    <g>
                      {/* Anchor points */}
                      {transAnchors.map((a, i) => (
                        <g key={`ta-${i}`}>
                          <circle cx={a.x * imgNat.w} cy={a.y * imgNat.h} r={8}
                            fill="#8b5cf6" stroke="#fff" strokeWidth={2} opacity={0.9} />
                          <text x={a.x * imgNat.w} y={a.y * imgNat.h + 1}
                            textAnchor="middle" dominantBaseline="middle"
                            fill="#fff" fontSize={9} fontWeight={700} fontFamily="system-ui">{i + 1}</text>
                        </g>
                      ))}

                      {/* Shape preview on all anchors (during draw or after validate) */}
                      {transShape.length >= 3 && transAnchors.map((a, ai) => {
                        const pts = transShape.map(s => `${(a.x + s.x) * imgNat.w},${(a.y + s.y) * imgNat.h}`).join(" ");
                        return (
                          <polygon key={`ts-${ai}`} points={pts}
                            fill="rgba(139,92,246,0.2)" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="5 3" />
                        );
                      })}

                      {/* Drawing preview — polygon mode */}
                      {transPhase === "draw_shape" && transShapeMode === "polygon" && transDrawing.length > 0 && (() => {
                        const previewPts = hoverPoint ? [...transDrawing, hoverPoint] : transDrawing;
                        // Show on all anchors
                        return transAnchors.map((a, ai) => {
                          const offset = { x: a.x - transDrawing[0].x, y: a.y - transDrawing[0].y };
                          const pts = previewPts.map(p => `${(p.x + offset.x) * imgNat.w},${(p.y + offset.y) * imgNat.h}`).join(" ");
                          return (
                            <g key={`tdp-${ai}`}>
                              {previewPts.length >= 3 ? (
                                <polygon points={pts} fill="rgba(139,92,246,0.15)" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="4 2" />
                              ) : (
                                <polyline points={pts} fill="none" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="4 2" />
                              )}
                            </g>
                          );
                        });
                      })()}

                      {/* Drawing preview — rect mode */}
                      {transPhase === "draw_shape" && transShapeMode === "rect" && transDrawing.length === 2 && (() => {
                        const [s, e] = transDrawing;
                        const rw = Math.abs(e.x - s.x), rh = Math.abs(e.y - s.y);
                        return transAnchors.map((a, ai) => (
                          <rect key={`tdr-${ai}`}
                            x={a.x * imgNat.w} y={a.y * imgNat.h}
                            width={rw * imgNat.w} height={rh * imgNat.h}
                            fill="rgba(139,92,246,0.15)" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="4 2" />
                        ));
                      })()}

                      {/* Drawing polygon: vertex dots */}
                      {transPhase === "draw_shape" && transShapeMode === "polygon" && transDrawing.map((p, i) => (
                        <circle key={`tdv-${i}`} cx={p.x * imgNat.w} cy={p.y * imgNat.h}
                          r={i === 0 && transDrawing.length >= 3 ? 9 : 5}
                          fill={i === 0 && transDrawing.length >= 3 ? "#8b5cf6" : "#fff"}
                          stroke="#8b5cf6" strokeWidth={2} />
                      ))}
                      {/* Close hint ring */}
                      {transPhase === "draw_shape" && transShapeMode === "polygon" && transDrawing.length >= 3 && (
                        <circle cx={transDrawing[0].x * imgNat.w} cy={transDrawing[0].y * imgNat.h}
                          r={14} fill="none" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="4 2" opacity={0.5} />
                      )}
                    </g>
                  )}
                </svg>

              </div>
            </div>
          </div>
          {/* Text input overlay — OUTSIDE transform wrapper, uses screen coords */}
          {textInputPos && (() => {
            const imgEl = containerRef.current?.querySelector("img");
            if (!imgEl) return null;
            const containerRect = containerRef.current!.getBoundingClientRect();
            const imgRect = imgEl.getBoundingClientRect();
            const px = imgRect.left - containerRect.left + textInputPos.x * imgRect.width;
            const py = imgRect.top - containerRect.top + textInputPos.y * imgRect.height;
            return (
              <div className="absolute z-50 pointer-events-auto" style={{ left: px, top: py }}>
                <input autoFocus value={textInputValue} onChange={e => setTextInputValue(e.target.value)}
                  onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === "Enter" && textInputValue.trim()) {
                      setTextAnnotations(prev => [...prev, { id: crypto.randomUUID(), x: textInputPos.x, y: textInputPos.y, text: textInputValue.trim(), color: "#38BDF8" }]);
                      setTextInputPos(null); setTextInputValue("");
                    }
                    if (e.key === "Escape") { setTextInputPos(null); setTextInputValue(""); }
                  }}
                  onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                  placeholder="Texte…"
                  className="bg-black/90 border border-sky-500/60 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-sky-400 min-w-44 shadow-xl" />
              </div>
            );
          })()}
        </div>

        {/* ── Right: 3-tab Sidebar ── */}
        <div className="w-[280px] shrink-0 flex flex-col gap-1.5 overflow-hidden">
          {/* Tab bar */}
          <div className="flex glass border border-white/10 rounded-lg p-0.5 gap-0.5 shrink-0">
            {(["results", "elements", "visibility"] as const).map(tab => (
              <button key={tab} onClick={() => setSidebarTab(tab)}
                className={cn("flex-1 px-2 py-1.5 rounded-md text-[10px] font-semibold transition-colors text-center truncate",
                  sidebarTab === tab ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300")}>
                {tab === "results" ? "Résultats" : tab === "elements" ? "Éléments" : "Visibilité"}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-0.5">
            {/* ── Tab 1: Résultats ── */}
            {sidebarTab === "results" && (
              <div className="glass rounded-xl border border-white/10 p-4">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Résumé façade</h4>
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: TYPE_COLORS.window }} />
                      <span className="text-slate-300">{d("fa_window")}</span>
                    </div>
                    <span className="font-mono text-white">{windowsCount}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Surface fenêtres</span>
                    <span className="font-mono text-white">{windowsArea.toFixed(2)} m²</span>
                  </div>
                  {facadeArea != null && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Surface façade</span>
                      <span className="font-mono text-white">{facadeArea.toFixed(2)} m²</span>
                    </div>
                  )}
                  {netFacadeArea != null && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Surface nette</span>
                      <span className="font-mono text-emerald-400">{netFacadeArea.toFixed(2)} m²</span>
                    </div>
                  )}
                  {result.ratio_openings != null && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Ratio ouvertures</span>
                      <span className="font-mono text-amber-400">{(result.ratio_openings * 100).toFixed(1)}%</span>
                    </div>
                  )}
                  {result.floors_count != null && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Étages détectés</span>
                      <span className="font-mono text-white">{result.floors_count}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Tab 2: Éléments ── */}
            {sidebarTab === "elements" && (
              <>
                {/* Element counts by type */}
                <div className="glass rounded-xl border border-white/10 p-4">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">{d("fa_element")}s</h4>
                  <div className="flex flex-col gap-1.5">
                    {ALL_TYPES.map(type => {
                      const count = elementCountsByType[type] ?? 0;
                      if (count === 0) return null;
                      const color = TYPE_COLORS[type] ?? "#94a3b8";
                      return (
                        <div key={type} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                            <span className="text-slate-300">{TYPE_I18N[type] ? d(TYPE_I18N[type]) : type}</span>
                          </div>
                          <span className="font-mono text-white">{count}</span>
                        </div>
                      );
                    })}
                    {elements.length === 0 && (
                      <p className="text-xs text-slate-600 italic">Aucun élément</p>
                    )}
                  </div>
                </div>

                {/* Selected element details */}
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
                            <option key={t} value={t}>{TYPE_I18N[t] ? d(TYPE_I18N[t]) : t}</option>
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
                      <div className="text-[10px] text-slate-600">
                        {getPolyPoints(selectedEl).length} vertices &middot; Clic droit sur un vertex pour le supprimer
                      </div>
                      <Button variant="outline" size="sm" onClick={deleteSelected} className="text-red-400 border-red-500/20 hover:bg-red-500/10">
                        <Trash2 className="w-3.5 h-3.5" /> {d("fa_delete")}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Tab 3: Visibilité ── */}
            {sidebarTab === "visibility" && (
              <div className="glass rounded-xl border border-white/10 p-4">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">LAYERS</h4>
                <div className="flex flex-col gap-1">
                  {VISIBILITY_TYPES.map(type => {
                    const count = elementCountsByType[type] ?? 0;
                    const color = TYPE_COLORS[type] ?? "#94a3b8";
                    return (
                      <button
                        key={type}
                        onClick={() => setVisibility(v => ({ ...v, [type]: !v[type] }))}
                        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs hover:bg-white/5 transition-colors"
                      >
                        {visibility[type] ? <Eye className="w-3.5 h-3.5 text-white" /> : <EyeOff className="w-3.5 h-3.5 text-slate-600" />}
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: visibility[type] ? color : "#475569" }} />
                        <span className={visibility[type] ? "text-white" : "text-slate-600"}>
                          {TYPE_I18N[type] ? d(TYPE_I18N[type]) : type}
                        </span>
                        {count > 0 && (
                          <span className="ml-auto font-mono text-slate-500 text-[10px]">{count}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
