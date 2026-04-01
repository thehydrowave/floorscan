"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight, RotateCcw, Download, Eye, EyeOff,
  AlertTriangle, Building2, AppWindow, DoorOpen, Layers,
  LayoutPanelTop, Columns2, Frame, Box, HelpCircle, Trash2,
  Pencil, PlusCircle, RefreshCw, Crop, MousePointer2, Pentagon, Square,
  ZoomIn, ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FacadeAnalysisResult, FacadeElement } from "@/lib/types";
import { pointInPolygon, polygonAreaPx } from "@/lib/measure-types";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import Facade3dPanel from "./facade-3d-panel";
import FacadeMaterialsPanel from "./facade-materials-panel";
import FacadeDpgfPanel from "./facade-dpgf-panel";
import FacadeCompliancePanel from "./facade-compliance-panel";
import FacadeDashboardPanel from "./facade-dashboard-panel";
import FacadeChatPanel from "./facade-chat-panel";
import FacadeCctpPanel from "./facade-cctp-panel";
import FacadeGanttPanel from "./facade-gantt-panel";
import FacadeLotsPanel from "./facade-lots-panel";
import FacadeMetrePanel from "./facade-metre-panel";
import FacadeToolkitPanel from "./facade-toolkit-panel";
import FacadeScenarioPanel from "./facade-scenario-panel";
import FacadeDebugPanel from "./facade-debug-panel";
import FacadeIsolationPanel from "./facade-isolation-panel";
import FacadeRapportDialog from "./facade-rapport-dialog";
import FacadeDevisDialog from "./facade-devis-dialog";
import FacadeTutorialOverlay, { resetFacadeTutorial } from "./facade-tutorial-overlay";
import { FileText, Receipt } from "lucide-react";

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
function getColor(t: string) { return TYPE_COLORS[t] ?? "#94a3b8"; }

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
function getIcon(t: string): IconComp { return TYPE_ICONS[t] ?? Box; }

/* ── i18n key per element type ── */
const TYPE_I18N: Record<string, DTKey> = {
  window:     "fa_window",
  door:       "fa_door",
  balcony:    "fa_balcony",
  floor_line: "fa_floor_line",
  roof:       "fa_roof",
  column:     "fa_column",
  other:      "fa_other",
};

/* ── KPI icons + Tailwind colors ── */
const KPI_ICONS: Record<string, { Icon: IconComp; color: string }> = {
  windows:  { Icon: AppWindow,      color: "text-blue-400" },
  doors:    { Icon: DoorOpen,       color: "text-pink-400" },
  balconies:{ Icon: LayoutPanelTop, color: "text-emerald-400" },
  floors:   { Icon: Layers,         color: "text-orange-400" },
};

/* ── Mask layer definitions (Masques tab) ── */
interface MaskLayerDef { id: string; label: string; icon: IconComp; color: string; isSurface?: true; }
const MASK_LAYERS: MaskLayerDef[] = [
  { id: "surface_murale", label: "Mur opaque",              icon: Building2,      color: "#64748b", isSurface: true },
  { id: "window",         label: "Fenêtres",                icon: AppWindow,      color: "#60a5fa" },
  { id: "door",           label: "Portes",                  icon: DoorOpen,       color: "#f472b6" },
  { id: "balcony",        label: "Balcons",                 icon: LayoutPanelTop, color: "#34d399" },
  { id: "column",         label: "Colonnes / Poteaux",      icon: Columns2,       color: "#94a3b8" },
  { id: "roof",           label: "Toiture",                 icon: Frame,          color: "#a78bfa" },
  { id: "floor_line",     label: "Séparations d'étage",     icon: Layers,         color: "#fb923c" },
  { id: "other",          label: "Fenêtres",                icon: AppWindow,      color: "#fbbf24" },
];

interface FacadeResultsStepProps {
  result: FacadeAnalysisResult;
  onGoEditor: () => void;
  onRestart: () => void;
  initialFacadeZones?: Array<{ id: number; pts: Array<{ x: number; y: number }> }>;
}

/* ── Mask editor drag/draw state types ── */
interface DragState {
  mode: "move" | "tl" | "tr" | "bl" | "br";
  id: number;
  startNorm: { x: number; y: number };
  origBbox: { x: number; y: number; w: number; h: number };
}
interface DrawState {
  type: string;
  startNorm: { x: number; y: number };
  cur: { x: number; y: number };
}

/* ── Facade polygon zone (4 points) ── */
interface FacadeZone {
  id: number;
  pts: Array<{ x: number; y: number }>; // normalized 0-1, 4 points
  label?: string;
}

type Pt = { x: number; y: number };

function bboxFromPoly(pts: Pt[]) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/* ── Shoelace polygon area (normalized coords → fraction of image) ── */
function polygonAreaNorm(pts: Array<{ x: number; y: number }>): number {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

type ElementType = "window" | "door" | "balcony" | "floor_line" | "roof" | "column" | "other";

export default function FacadeResultsStep({ result, onGoEditor, onRestart, initialFacadeZones }: FacadeResultsStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  /* ── Dialog modals ── */
  const [showRapport, setShowRapport] = useState(false);
  const [showDevis, setShowDevis] = useState(false);

  /* ── View tab ── */
  const [viewTab, setViewTab] = useState<"ia" | "svg" | "masks">(() =>
    result.is_mock ? "svg" : "ia"
  );

  /* ── Mask editor: mutable local copy of elements (declared early for use in presentTypes) ── */
  const [localElements, setLocalElements] = useState<FacadeElement[]>(result.elements);

  /* ── SVG tab: per-type visibility toggles ── */
  const presentTypes = [...new Set(localElements.map(e => e.type))];
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const toggleType = (t: string) =>
    setHiddenTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });

  /* ── Image natural dimensions + SVG hover tooltip (svg tab) ── */
  const [imgNat, setImgNat] = useState({ w: 800, h: 600 });
  const imgContainerRef = useRef<HTMLDivElement>(null);
  const [hoveredEl, setHoveredEl] = useState<FacadeElement | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  /* ── Masques tab: layer + element state ── */
  const [hiddenLayers,   setHiddenLayers]   = useState<Set<string>>(new Set());
  const [hiddenElements, setHiddenElements] = useState<Set<number>>(new Set());
  const [selectedEl,     setSelectedEl]     = useState<number | null>(null);
  type MaskTool = "select" | "add_polygon" | "add_rect" | "erase";
  const [maskTool,       setMaskTool]       = useState<MaskTool>("select");
  const [maskAddType,    setMaskAddType]    = useState<string>("other");
  const [maskDrawingPoly, setMaskDrawingPoly] = useState<Pt[]>([]);
  const [maskHoverPt,    setMaskHoverPt]    = useState<Pt | null>(null);
  /* derived helpers */
  const editMode  = maskTool !== "select";
  const addingType = (maskTool === "add_rect" || maskTool === "add_polygon") ? maskAddType : null;
  const [showTuto,       setShowTuto]       = useState(false);

  /* ── Mask filter: Tous | Murs | Ouvertures ── */
  type MaskFilterMode = "all" | "walls" | "openings";
  const [maskFilter, setMaskFilter] = useState<MaskFilterMode>("all");
  const WALL_LAYER_IDS = useMemo(() => new Set(["surface_murale", "column", "floor_line", "roof"]), []);
  const OPENING_LAYER_IDS = useMemo(() => new Set(["window", "door", "balcony", "other"]), []);
  const filteredMaskLayers = useMemo(() => {
    return MASK_LAYERS.filter(l => {
      if (maskFilter === "all") return true;
      if (maskFilter === "walls") return WALL_LAYER_IDS.has(l.id);
      if (maskFilter === "openings") return OPENING_LAYER_IDS.has(l.id);
      return true;
    });
  }, [maskFilter, WALL_LAYER_IDS, OPENING_LAYER_IDS]);
  /* Use refs for drag/draw state to avoid stale-closure bugs */
  const dragStateRef = useRef<DragState | null>(null);
  const drawStateRef = useRef<DrawState | null>(null);
  const [isDragging,  setIsDragging]  = useState(false); // triggers re-render only when needed
  const [isDrawing,   setIsDrawing]   = useState(false);
  const maskSvgRef   = useRef<SVGSVGElement>(null);

  /* ── Facade polygon zones ── */
  const [facadeZones,    setFacadeZones]    = useState<FacadeZone[]>(
    () => (initialFacadeZones ?? []).map(z => ({ id: z.id, pts: z.pts }))
  );
  const [drawingZone,    setDrawingZone]    = useState(false);   // "Nouvelle façade" mode
  const [pendingPts,     setPendingPts]     = useState<Array<{x:number;y:number}>>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);
  const draggingPtRef    = useRef<{zoneId:number;ptIdx:number} | null>(null);

  /* ── Masques: zoom / pan ── */
  const [maskZoom,     setMaskZoom]     = useState(1);
  const [maskPan,      setMaskPan]      = useState({ x: 0, y: 0 });
  const maskPanRef     = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const [isMaskPanning, setIsMaskPanning] = useState(false);
  const maskContainerRef = useRef<HTMLDivElement>(null);

  /* ── Facade zone area (m²) from polygon + PPM ── */
  const facadeZoneAreaM2 = useCallback((pts: Array<{x:number;y:number}>) => {
    const ppm = result.pixels_per_meter;
    if (!ppm || ppm <= 0 || imgNat.w === 0) return 0;
    const areaNorm = polygonAreaNorm(pts);
    return areaNorm * imgNat.w * imgNat.h / (ppm * ppm);
  }, [result.pixels_per_meter, imgNat.w, imgNat.h]);

  const totalFacadeZonesM2 = useMemo(
    () => facadeZones.reduce((s, z) => s + facadeZoneAreaM2(z.pts), 0),
    [facadeZones, facadeZoneAreaM2],
  );

  /* ── Surface murale SVG path (facade polygon − opening holes, evenodd) ── */
  const wallSvgPath = useMemo(() => {
    const W = imgNat.w, H = imgNat.h;
    let p = '';
    // Outer shape: user facade zones if defined, else building_roi rectangle
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
    // Holes: opening elements (use polygon_norm if available)
    localElements
      .filter(e => ["window", "door", "balcony", "other"].includes(e.type) && !hiddenElements.has(e.id))
      .forEach(e => {
        if (e.polygon_norm && e.polygon_norm.length >= 3) {
          p += ' ' + e.polygon_norm.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x * W} ${pt.y * H}`).join(' ') + ' Z';
        } else {
          const x = e.bbox_norm.x * W, y = e.bbox_norm.y * H;
          const w = e.bbox_norm.w * W, h = e.bbox_norm.h * H;
          p += ` M${x} ${y} h${w} v${h} h${-w} Z`;
        }
      });
    return p;
  }, [result.building_roi, facadeZones, localElements, hiddenElements, imgNat]);

  /* ── Surface murale area (live, excludes hidden elements) ── */
  const wallAreaM2 = useMemo(() => {
    if (!result.facade_area_m2) return null;
    const openingsArea = localElements
      .filter(e => ["window", "door", "balcony"].includes(e.type) && !hiddenElements.has(e.id))
      .reduce((s, e) => s + (e.area_m2 ?? 0), 0);
    return Math.max(0, result.facade_area_m2 - openingsArea);
  }, [result.facade_area_m2, localElements, hiddenElements]);

  /* ── Surface fenêtres (type "other") ── */
  const fenetresAreaM2 = useMemo(() => {
    const ppm = result.pixels_per_meter;
    return localElements
      .filter(e => e.type === "other" && !hiddenElements.has(e.id))
      .reduce((s, e) => {
        if (e.area_m2 != null) return s + e.area_m2;
        if (!ppm || ppm <= 0 || imgNat.w === 0) return s;
        return s + (e.bbox_norm.w * imgNat.w * e.bbox_norm.h * imgNat.h) / (ppm * ppm);
      }, 0);
  }, [localElements, hiddenElements, result.pixels_per_meter, imgNat]);

  /* ── Surface façade nette = délimitée − fenêtres ── */
  const facadeNetteM2 = useMemo(() => {
    if (totalFacadeZonesM2 <= 0) return null;
    return Math.max(0, totalFacadeZonesM2 - fenetresAreaM2);
  }, [totalFacadeZonesM2, fenetresAreaM2]);

  /* ── Per-zone stats (one entry per facade zone) ── */
  const perZoneStats = useMemo(() => {
    if (facadeZones.length === 0) return null;
    const ppm = result.pixels_per_meter;
    return facadeZones.map((zone, zi) => {
      const zoneEls = localElements.filter(e => {
        const cx = e.bbox_norm.x + e.bbox_norm.w / 2;
        const cy = e.bbox_norm.y + e.bbox_norm.h / 2;
        return pointInPolygon({ x: cx, y: cy }, zone.pts);
      });
      const fenetres = zoneEls.filter(e => e.type === "other" && !hiddenElements.has(e.id));
      const fenetresArea = fenetres.reduce((s, e) => {
        if (e.area_m2 != null) return s + e.area_m2;
        if (!ppm || ppm <= 0 || imgNat.w === 0) return s;
        return s + (e.bbox_norm.w * imgNat.w * e.bbox_norm.h * imgNat.h) / (ppm * ppm);
      }, 0);
      const zoneArea = facadeZoneAreaM2(zone.pts);
      return {
        zone, idx: zi,
        fenetresCount: fenetres.length,
        fenetresArea,
        zoneArea,
        nette: zoneArea > 0 ? Math.max(0, zoneArea - fenetresArea) : null,
      };
    });
  }, [facadeZones, localElements, hiddenElements, facadeZoneAreaM2, result.pixels_per_meter, imgNat]);

  /* ── Seed imgNat from plan_b64 ── */
  useEffect(() => {
    if (!result.plan_b64) return;
    const img = new Image();
    img.onload = () => setImgNat({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = `data:image/png;base64,${result.plan_b64}`;
  }, [result.plan_b64]);

  /* ── Sync localElements when result changes ── */
  useEffect(() => {
    setLocalElements(result.elements);
    setHiddenElements(new Set());
    setSelectedEl(null);
    setMaskTool("select");
    setMaskDrawingPoly([]);
    setMaskHoverPt(null);
  }, [result]);

  /* ── Keyboard: Delete/Backspace removes selected element, Escape cancels drawing ── */
  useEffect(() => {
    if (viewTab !== "masks") return;
    const handle = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedEl !== null) {
        setLocalElements(prev => prev.filter(el => el.id !== selectedEl));
        setSelectedEl(null);
      } else if (e.key === "Escape") {
        if (maskDrawingPoly.length > 0) {
          setMaskDrawingPoly([]);
          setMaskHoverPt(null);
        } else {
          setSelectedEl(null);
        }
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [viewTab, selectedEl, maskDrawingPoly.length]);

  /* ── Mask editor: SVG coordinate helper ── */
  const screenToNorm = useCallback((clientX: number, clientY: number) => {
    const svg = maskSvgRef.current;
    if (!svg || imgNat.w === 0) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const inv = svg.getScreenCTM()?.inverse();
    if (!inv) return { x: 0, y: 0 };
    const sp = pt.matrixTransform(inv);
    return { x: sp.x / imgNat.w, y: sp.y / imgNat.h };
  }, [imgNat.w, imgNat.h]);

  /* ── Mask: close polygon helper ── */
  const closeMaskPolygon = useCallback((pts: Pt[]) => {
    if (pts.length < 3) { setMaskDrawingPoly([]); setMaskHoverPt(null); return; }
    const bbox = bboxFromPoly(pts);
    const ppm = result.pixels_per_meter;
    const areaPx = polygonAreaPx(pts, imgNat.w, imgNat.h);
    const area_m2 = ppm ? areaPx / (ppm * ppm) : null;
    setLocalElements(prev => {
      const newId = prev.length > 0 ? Math.max(...prev.map(e => e.id)) + 1 : 1;
      const newEl: FacadeElement = {
        id: newId, type: maskAddType as FacadeElement["type"],
        label_fr: maskAddType, bbox_norm: bbox, polygon_norm: pts,
        area_m2, floor_level: 0,
      };
      setTimeout(() => setSelectedEl(newId), 0);
      return [...prev, newEl];
    });
    setMaskDrawingPoly([]);
    setMaskHoverPt(null);
  }, [maskAddType, imgNat, result.pixels_per_meter]);

  /* ── Mask editor: mouse handlers (ref-based, no stale closures) ── */
  const handleSvgMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    // Facade zone drawing mode: click to add points, 4th point closes polygon
    if (drawingZone) {
      e.stopPropagation();
      const norm = screenToNorm(e.clientX, e.clientY);
      setPendingPts(prev => {
        const next = [...prev, norm];
        if (next.length >= 4) {
          setFacadeZones(z => [...z, { id: Date.now(), pts: next.slice(0, 4) }]);
          setDrawingZone(false);
          return [];
        }
        return next;
      });
      return;
    }
    const norm = screenToNorm(e.clientX, e.clientY);
    if (maskTool === "add_rect") {
      e.stopPropagation();
      drawStateRef.current = { type: maskAddType, startNorm: norm, cur: norm };
      setIsDrawing(true);
      return;
    }
    if (maskTool === "add_polygon") {
      e.stopPropagation();
      // Click on first point (>=3 pts) closes polygon
      if (maskDrawingPoly.length >= 3) {
        const first = maskDrawingPoly[0];
        const dx = (first.x - norm.x) * imgNat.w;
        const dy = (first.y - norm.y) * imgNat.h;
        if (Math.sqrt(dx*dx+dy*dy) < 15) {
          closeMaskPolygon(maskDrawingPoly);
          return;
        }
      }
      setMaskDrawingPoly(prev => [...prev, norm]);
      return;
    }
    if (maskTool === "select") {
      setSelectedEl(null);
    }
  }, [maskTool, maskAddType, maskDrawingPoly, screenToNorm, drawingZone, closeMaskPolygon, imgNat]);

  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const norm = screenToNorm(e.clientX, e.clientY);

    // Update polygon hover preview
    if (maskTool === "add_polygon" && maskDrawingPoly.length > 0) {
      setMaskHoverPt(norm);
    }

    // Drag facade zone corner point
    const dp = draggingPtRef.current;
    if (dp) {
      setFacadeZones(prev => prev.map(z =>
        z.id === dp.zoneId
          ? { ...z, pts: z.pts.map((p, i) => i === dp.ptIdx ? norm : p) }
          : z
      ));
      return;
    }

    // Draw new element preview
    if (drawStateRef.current) {
      drawStateRef.current = { ...drawStateRef.current, cur: norm };
      setIsDrawing(v => !v); // toggle to force re-render
      return;
    }

    // Drag existing element
    const ds = dragStateRef.current;
    if (!ds) return;
    const dx = norm.x - ds.startNorm.x;
    const dy = norm.y - ds.startNorm.y;
    const ob = ds.origBbox;
    let nx = ob.x, ny = ob.y, nw = ob.w, nh = ob.h;
    if (ds.mode === "move") {
      nx = Math.max(0, Math.min(1 - ob.w, ob.x + dx));
      ny = Math.max(0, Math.min(1 - ob.h, ob.y + dy));
    } else if (ds.mode === "tl") {
      const nnx = Math.min(ob.x + ob.w - 0.01, ob.x + dx);
      const nny = Math.min(ob.y + ob.h - 0.01, ob.y + dy);
      nw = ob.w + (ob.x - nnx); nh = ob.h + (ob.y - nny);
      nx = nnx; ny = nny;
    } else if (ds.mode === "tr") {
      const nny = Math.min(ob.y + ob.h - 0.01, ob.y + dy);
      nh = ob.h + (ob.y - nny); ny = nny;
      nw = Math.max(0.01, ob.w + dx);
    } else if (ds.mode === "bl") {
      const nnx = Math.min(ob.x + ob.w - 0.01, ob.x + dx);
      nw = ob.w + (ob.x - nnx); nx = nnx;
      nh = Math.max(0.01, ob.h + dy);
    } else if (ds.mode === "br") {
      nw = Math.max(0.01, ob.w + dx);
      nh = Math.max(0.01, ob.h + dy);
    }
    setLocalElements(prev => prev.map(el =>
      el.id === ds.id ? { ...el, bbox_norm: { x: nx, y: ny, w: nw, h: nh } } : el
    ));
  }, [screenToNorm]);

  const handleSvgMouseUp = useCallback(() => {
    draggingPtRef.current = null;
    const ds = drawStateRef.current;
    if (ds) {
      const { startNorm, cur, type } = ds;
      const x = Math.min(startNorm.x, cur.x);
      const y = Math.min(startNorm.y, cur.y);
      const w = Math.abs(cur.x - startNorm.x);
      const h = Math.abs(cur.y - startNorm.y);
      if (w > 0.005 && h > 0.005) {
        setLocalElements(prev => {
          const newId = prev.length > 0 ? Math.max(...prev.map(e => e.id)) + 1 : 1;
          const newEl: FacadeElement = {
            id: newId, type: type as FacadeElement["type"],
            label_fr: type, bbox_norm: { x, y, w, h },
            area_m2: null, floor_level: 0,
          };
          setTimeout(() => setSelectedEl(newId), 0);
          return [...prev, newEl];
        });
      }
      drawStateRef.current = null;
      setIsDrawing(false);
    }
    dragStateRef.current = null;
    setIsDragging(false);
  }, []);

  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (drawingZone || maskTool === "add_rect" || maskTool === "add_polygon") return;
    const norm = screenToNorm(e.clientX, e.clientY);
    const clicked = [...localElements].reverse().find(el => {
      if (hiddenElements.has(el.id)) return false;
      const cx = el.bbox_norm.x + el.bbox_norm.w / 2;
      const cy = el.bbox_norm.y + el.bbox_norm.h / 2;
      if (el.polygon_norm && el.polygon_norm.length >= 3) {
        return pointInPolygon(norm, el.polygon_norm);
      }
      return norm.x >= el.bbox_norm.x && norm.x <= el.bbox_norm.x + el.bbox_norm.w &&
             norm.y >= el.bbox_norm.y && norm.y <= el.bbox_norm.y + el.bbox_norm.h;
    });
    if (maskTool === "erase") {
      if (clicked) setLocalElements(prev => prev.filter(el => el.id !== clicked.id));
    } else {
      setSelectedEl(clicked ? clicked.id : null);
    }
  }, [maskTool, localElements, hiddenElements, screenToNorm, drawingZone]);

  const handleSvgDoubleClick = useCallback((_e: React.MouseEvent<SVGSVGElement>) => {
    if (maskTool === "add_polygon" && maskDrawingPoly.length >= 2) {
      closeMaskPolygon(maskDrawingPoly);
    }
  }, [maskTool, maskDrawingPoly, closeMaskPolygon]);

  /* ── Masques: wheel zoom ── */
  useEffect(() => {
    if (viewTab !== "masks") return;
    const el = maskContainerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setMaskZoom(z => {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const newZ = Math.min(Math.max(z * factor, 0.5), 8);
        setMaskPan(p => ({
          x: mx - (mx - p.x) * (newZ / z),
          y: my - (my - p.y) * (newZ / z),
        }));
        return newZ;
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [viewTab]);

  const handleMaskContainerMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      maskPanRef.current = { startX: e.clientX, startY: e.clientY, panX: maskPan.x, panY: maskPan.y };
      setIsMaskPanning(true);
    }
  }, [maskPan]);

  const handleMaskContainerMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const ref = maskPanRef.current;
    if (!ref) return;
    setMaskPan({ x: ref.panX + (e.clientX - ref.startX), y: ref.panY + (e.clientY - ref.startY) });
  }, []);

  const handleMaskContainerMouseUp = useCallback(() => {
    maskPanRef.current = null;
    setIsMaskPanning(false);
  }, []);

  /* ── Derived: per-floor breakdown ── */
  const floorLevels = [...new Set(localElements.map(e => e.floor_level ?? 0))].sort((a, b) => b - a);
  const floorData = floorLevels.map(level => {
    const els = localElements.filter(e => (e.floor_level ?? 0) === level);
    return {
      level,
      label:     level === 0 ? d("fa_rdc") : `${d("fa_floor_level")} ${level}`,
      windows:   els.filter(e => e.type === "window").length,
      doors:     els.filter(e => e.type === "door").length,
      balconies: els.filter(e => e.type === "balcony").length,
    };
  });

  const visibleElements = localElements.filter(e => !hiddenTypes.has(e.type));

  /* ── CSV export ── */
  const exportCSV = () => {
    const BOM = "\uFEFF";
    const header = `${d("fa_element")};${d("fa_type")};${d("fa_floor_level")};X;Y;W;H;${d("fa_facade_area")} (m²)`;
    const rows = localElements.map(e =>
      `${e.id};${d(TYPE_I18N[e.type] ?? "fa_other")};${e.floor_level ?? 0};` +
      `${e.bbox_norm.x.toFixed(3)};${e.bbox_norm.y.toFixed(3)};` +
      `${e.bbox_norm.w.toFixed(3)};${e.bbox_norm.h.toFixed(3)};${e.area_m2?.toFixed(2) ?? "-"}`
    );
    const csv = BOM + [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "facade_analysis.csv"; a.click();
    URL.revokeObjectURL(url);
    toast({ title: d("fa_export_csv"), variant: "success" });
  };

  /* ═══════════════════════════════════════════════ render ══ */
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-5xl mx-auto">

      {/* Mock banner */}
      {result.is_mock && (
        <div className="mb-6 glass rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300/80">{d("fa_mock_warn")}</p>
        </div>
      )}

      {/* KPI cards — per-zone breakdown if zones exist, else global */}
      {perZoneStats && perZoneStats.length > 0 ? (
        <div className="flex flex-col gap-3 mb-8">
          {perZoneStats.map((zs) => (
            <div key={zs.zone.id} className="glass rounded-xl border border-white/10 p-4">
              <div className="text-xs font-semibold text-amber-400 uppercase tracking-wide mb-3">
                Façade {zs.idx + 1}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <AppWindow className="w-5 h-5 mx-auto text-amber-400 mb-1" />
                  <div className="text-xl font-mono font-bold text-amber-400">{zs.fenetresCount}</div>
                  <div className="text-xs text-slate-500">Fenêtres</div>
                  {zs.fenetresArea > 0 && (
                    <div className="text-xs text-amber-400/70 font-mono mt-0.5">{zs.fenetresArea.toFixed(1)} m²</div>
                  )}
                </div>
                <div className="text-center">
                  <Crop className="w-5 h-5 mx-auto text-slate-400 mb-1" />
                  <div className="text-xl font-mono font-bold text-slate-200">{zs.zoneArea.toFixed(0)} m²</div>
                  <div className="text-xs text-slate-500">Délimitée</div>
                </div>
                <div className="text-center">
                  <Building2 className="w-5 h-5 mx-auto text-blue-400 mb-1" />
                  <div className="text-xl font-mono font-bold text-blue-400">
                    {zs.nette != null ? `${zs.nette.toFixed(0)} m²` : "—"}
                  </div>
                  <div className="text-xs text-slate-500">Surface nette</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {/* Fenêtres count */}
          <div className="glass rounded-xl border border-white/10 p-4 text-center">
            <AppWindow className="w-6 h-6 mx-auto text-amber-400" />
            <div className="text-2xl font-mono font-bold mt-1 text-amber-400">
              {localElements.filter(e => e.type === "other").length}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Fenêtres</div>
            {fenetresAreaM2 > 0 && (
              <div className="text-xs text-amber-400/70 font-mono mt-0.5">{fenetresAreaM2.toFixed(1)} m²</div>
            )}
          </div>
          {/* Façade délimitée */}
          <div className="glass rounded-xl border border-white/10 p-4 text-center">
            <Crop className="w-6 h-6 mx-auto text-slate-400" />
            <div className="text-2xl font-mono font-bold mt-1 text-slate-200">
              {totalFacadeZonesM2 > 0 ? `${totalFacadeZonesM2.toFixed(0)} m²` : "—"}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Façade délimitée</div>
          </div>
          {/* Surface nette */}
          <div className="glass rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 text-center">
            <Building2 className="w-6 h-6 mx-auto text-blue-400" />
            <div className="text-2xl font-mono font-bold mt-1 text-blue-400">
              {facadeNetteM2 != null ? `${facadeNetteM2.toFixed(0)} m²` : "—"}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Surface façade nette</div>
          </div>
        </div>
      )}

      {/* ── Tab bar + SVG toggles ── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {/* Tabs: Vue IA | Vue SVG | Masques */}
        <div className="flex gap-1 glass rounded-lg border border-white/10 p-0.5 mr-2">
          {(["ia", "svg", "masks"] as const)
            .filter(tab => !(tab === "ia" && result.is_mock))
            .map(tab => (
              <button key={tab}
                onClick={() => { setViewTab(tab); setHoveredEl(null); setSelectedEl(null); }}
                className={cn("px-3 py-1 rounded-md text-xs font-medium transition-all",
                  viewTab === tab ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300")}>
                {tab === "ia" ? "Vue IA" : tab === "svg" ? "Vue SVG" : "Masques"}
              </button>
            ))}
        </div>

        {/* Mask filter: Tous | Murs | Ouvertures */}
        {viewTab === "masks" && (
          <div className="flex gap-1 glass rounded-lg border border-white/10 p-0.5">
            {([
              { id: "all" as MaskFilterMode, label: "Tous" },
              { id: "walls" as MaskFilterMode, label: "Murs" },
              { id: "openings" as MaskFilterMode, label: "Ouvertures" },
            ]).map(f => (
              <button key={f.id}
                onClick={() => setMaskFilter(f.id)}
                className={cn("px-3 py-1 rounded-md text-xs font-medium transition-all",
                  maskFilter === f.id ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300")}>
                {f.label}
              </button>
            ))}
            <button onClick={() => { resetFacadeTutorial(); setShowTuto(v => !v); }} title="Tutoriel"
              className="px-2 py-1 rounded-md text-xs font-medium text-slate-500 hover:text-white hover:bg-white/10 transition-all">
              ?
            </button>
          </div>
        )}

        {/* Per-type toggles: SVG mode only */}
        {viewTab === "svg" && presentTypes.map(type => {
          const hidden = hiddenTypes.has(type);
          const color  = getColor(type);
          const Icon   = getIcon(type);
          return (
            <button key={type} onClick={() => toggleType(type)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                hidden ? "border-white/5 text-slate-600" : "border-white/20 bg-white/5 text-white"
              )}>
              <Icon className="w-3 h-3" style={{ color: hidden ? "#475569" : color }} />
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hidden ? "#475569" : color }} />
              {d(TYPE_I18N[type] ?? "fa_other")}
              {hidden
                ? <EyeOff className="w-3 h-3 text-slate-600" />
                : <Eye className="w-3 h-3" style={{ color }} />}
            </button>
          );
        })}
      </div>

      {/* ── Image panel ── */}
      <div className="glass rounded-2xl border border-white/10 p-2 mb-8 overflow-hidden">

        {/* ────────── Vue IA ────────── */}
        {viewTab === "ia" && (
          <img
            src={`data:image/png;base64,${result.overlay_b64}`}
            alt="Facade IA overlay"
            className="w-full rounded-xl"
          />
        )}

        {/* ────────── Vue SVG ────────── */}
        {viewTab === "svg" && (
          <div className="relative" ref={imgContainerRef} onMouseLeave={() => setHoveredEl(null)}>
            {result.is_mock && (
              <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-md
                bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-medium pointer-events-none">
                <AlertTriangle className="w-3 h-3" /> {d("fa_demo_badge" as DTKey)}
              </div>
            )}
            <img
              src={`data:image/png;base64,${result.plan_b64}`}
              alt="Facade plan" className="w-full rounded-xl"
              onLoad={e => {
                const i = e.currentTarget;
                setImgNat({ w: i.naturalWidth, h: i.naturalHeight });
              }}
            />
            <svg className="absolute inset-0 w-full h-full"
              viewBox={`0 0 ${imgNat.w} ${imgNat.h}`} preserveAspectRatio="xMidYMid meet">
              {visibleElements.map(el => {
                const x = el.bbox_norm.x * imgNat.w, y = el.bbox_norm.y * imgNat.h;
                const w = el.bbox_norm.w * imgNat.w, h = el.bbox_norm.h * imgNat.h;
                const color = getColor(el.type);
                const onEnter = (e: React.MouseEvent<SVGGElement>) => {
                  const c = imgContainerRef.current; if (!c) return;
                  const r = c.getBoundingClientRect();
                  setHoveredEl(el); setTooltipPos({ x: e.clientX - r.left, y: e.clientY - r.top });
                };
                const onMove = (e: React.MouseEvent<SVGGElement>) => {
                  const c = imgContainerRef.current; if (!c) return;
                  const r = c.getBoundingClientRect();
                  setTooltipPos({ x: e.clientX - r.left, y: e.clientY - r.top });
                };
                if (el.type === "floor_line") {
                  return (
                    <g key={el.id} className="cursor-pointer"
                      onMouseEnter={onEnter} onMouseMove={onMove} onMouseLeave={() => setHoveredEl(null)}>
                      <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2}
                        stroke={color} strokeWidth="2" strokeDasharray="8 4" opacity="0.8" />
                    </g>
                  );
                }
                return (
                  <g key={el.id} className="cursor-pointer"
                    onMouseEnter={onEnter} onMouseMove={onMove} onMouseLeave={() => setHoveredEl(null)}>
                    <rect x={x} y={y} width={w} height={h}
                      fill={`${color}20`} stroke={color} strokeWidth="1.5" rx="2" />
                    <text x={x + w / 2} y={y - 4} textAnchor="middle" fill={color}
                      fontSize={Math.max(8, Math.min(12, imgNat.w * 0.012))}
                      fontFamily="monospace" fontWeight="bold">
                      {d(TYPE_I18N[el.type] ?? "fa_other")}
                    </text>
                  </g>
                );
              })}
            </svg>
            {/* Hover tooltip */}
            {hoveredEl && (() => {
              const TIcon  = getIcon(hoveredEl.type);
              const tColor = getColor(hoveredEl.type);
              const cw   = imgContainerRef.current?.offsetWidth ?? 9999;
              const flip = tooltipPos.x > cw / 2;
              return (
                <div className="absolute z-50 pointer-events-none glass rounded-xl border border-white/20 p-3 min-w-[148px] shadow-xl"
                  style={{ left: flip ? tooltipPos.x - 14 : tooltipPos.x + 14, top: tooltipPos.y - 10,
                    transform: flip ? "translateX(-100%)" : "none" }}>
                  <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-white/10">
                    <TIcon className="w-3.5 h-3.5 shrink-0" style={{ color: tColor }} />
                    <span className="text-xs font-semibold" style={{ color: tColor }}>
                      {d(TYPE_I18N[hoveredEl.type] ?? "fa_other")}
                    </span>
                  </div>
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

        {/* ────────── Masques ────────── */}
        {viewTab === "masks" && (
          <>
            <FacadeTutorialOverlay forceShow={showTuto} />
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">

            {/* Left: canvas panel with toolbar */}
            <div className="glass rounded-2xl border border-white/10 p-2 overflow-hidden">
              {/* Toolbar */}
              <div className="flex items-center gap-2 mb-2 px-2 flex-wrap">
                <div className="flex items-center gap-1 glass border border-white/10 rounded-lg p-1">
                  <button onClick={() => { setMaskTool("select"); setMaskDrawingPoly([]); setMaskHoverPt(null); setDrawingZone(false); setPendingPts([]); }}
                    className={cn("p-1.5 rounded-md", maskTool === "select" ? "bg-accent text-white" : "text-slate-400 hover:text-white")} title="Sélection">
                    <MousePointer2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => { setMaskTool("add_polygon"); setSelectedEl(null); setDrawingZone(false); setPendingPts([]); }}
                    className={cn("p-1.5 rounded-md", maskTool === "add_polygon" ? "bg-amber-600 text-white" : "text-slate-400 hover:text-white")} title="Polygone">
                    <Pentagon className="w-4 h-4" />
                  </button>
                  <button onClick={() => { setMaskTool("add_rect"); setSelectedEl(null); setMaskDrawingPoly([]); setMaskHoverPt(null); setDrawingZone(false); setPendingPts([]); }}
                    className={cn("p-1.5 rounded-md", maskTool === "add_rect" ? "bg-amber-600 text-white" : "text-slate-400 hover:text-white")} title="Rectangle">
                    <Square className="w-4 h-4" />
                  </button>
                  <button onClick={() => { setMaskTool("erase"); setMaskDrawingPoly([]); setMaskHoverPt(null); setDrawingZone(false); setPendingPts([]); }}
                    className={cn("p-1.5 rounded-md", maskTool === "erase" ? "bg-red-600 text-white" : "text-slate-400 hover:text-white")} title="Supprimer">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {(maskTool === "add_polygon" || maskTool === "add_rect") && (
                  <select value={maskAddType} onChange={e => setMaskAddType(e.target.value)}
                    className="bg-slate-800 border border-white/10 rounded-lg px-2 py-1 text-xs text-white">
                    {filteredMaskLayers.filter(l => !l.isSurface && l.id !== "floor_line").map(l => (
                      <option key={l.id} value={l.id}>{l.label}</option>
                    ))}
                  </select>
                )}
                {maskTool === "add_polygon" && (
                  <span className="text-xs text-amber-300/70 animate-pulse">
                    {maskDrawingPoly.length === 0 ? "Cliquez pour poser des points..."
                      : maskDrawingPoly.length < 3 ? `${maskDrawingPoly.length} points...`
                      : "Double-clic ou clic sur le 1er point pour fermer"}
                  </span>
                )}
                {maskTool === "add_rect" && <span className="text-xs text-amber-300/70 animate-pulse">Cliquez et glissez pour dessiner</span>}
                {drawingZone && <span className="text-xs text-amber-300/70 animate-pulse">Façade: {pendingPts.length}/4 points</span>}
                <div className="flex-1" />
                <button onClick={() => setMaskZoom(z => Math.max(z / 1.3, 0.5))} className="p-1.5 text-slate-400 hover:text-white"><ZoomOut className="w-4 h-4" /></button>
                <span className="text-xs text-slate-500 font-mono w-12 text-center">{(maskZoom * 100).toFixed(0)}%</span>
                <button onClick={() => setMaskZoom(z => Math.min(z * 1.3, 8))} className="p-1.5 text-slate-400 hover:text-white"><ZoomIn className="w-4 h-4" /></button>
              </div>

              {/* Image + zoom container */}
              <div
              ref={maskContainerRef}
              className="relative overflow-hidden rounded-xl select-none bg-slate-900"
              style={{ minHeight: 200, cursor: drawingZone ? "crosshair" : isMaskPanning ? "grabbing" : maskTool === "add_rect" || maskTool === "add_polygon" ? "crosshair" : maskTool === "erase" ? "cell" : "default" }}
              onMouseDown={handleMaskContainerMouseDown}
              onMouseMove={handleMaskContainerMouseMove}
              onMouseUp={handleMaskContainerMouseUp}
              onMouseLeave={handleMaskContainerMouseUp}
            >
            <div style={{
              transform: `translate(${maskPan.x}px, ${maskPan.y}px) scale(${maskZoom})`,
              transformOrigin: "0 0",
              willChange: "transform",
            }}>
            <div className="relative">
              <img
                src={`data:image/png;base64,${result.plan_b64}`}
                alt="Facade plan"
                className="w-full rounded-xl block"
                style={{ display: "block" }}
                onLoad={e => {
                  const i = e.currentTarget;
                  setImgNat({ w: i.naturalWidth, h: i.naturalHeight });
                }}
              />

              {/* Surface murale layer: static, evenodd path = ROI − opening holes */}
              {!hiddenLayers.has("surface_murale") && imgNat.w > 0 && (maskFilter === "all" || maskFilter === "walls") && (                <svg className="absolute top-0 left-0 w-full h-full pointer-events-none"
                  viewBox={`0 0 ${imgNat.w} ${imgNat.h}`} preserveAspectRatio="xMinYMin meet">
                  <path d={wallSvgPath} fillRule="evenodd" fill="#3b82f6" fillOpacity={0.3} />
                </svg>
              )}

              {/* Per-type mask layers: interactive + editable */}
              {imgNat.w > 0 && (
                <svg
                  ref={maskSvgRef}
                  className="absolute top-0 left-0 w-full h-full"
                  viewBox={`0 0 ${imgNat.w} ${imgNat.h}`}
                  preserveAspectRatio="xMinYMin meet"
                  onMouseDown={handleSvgMouseDown}
                  onMouseMove={handleSvgMouseMove}
                  onMouseUp={handleSvgMouseUp}
                  onMouseLeave={handleSvgMouseUp}
                  onClick={handleSvgClick}
                  onDoubleClick={handleSvgDoubleClick}
                >

                  {filteredMaskLayers.filter(l => !l.isSurface && !hiddenLayers.has(l.id)).map(layer => {
                    const layerEls = localElements.filter(e => e.type === layer.id && !hiddenElements.has(e.id));
                    return (
                      <g key={layer.id}>
                        {layerEls.map(el => {
                          const sel = selectedEl === el.id;
                          if (el.type === "floor_line") {
                            const x = el.bbox_norm.x * imgNat.w, y = el.bbox_norm.y * imgNat.h;
                            const w = el.bbox_norm.w * imgNat.w, h = el.bbox_norm.h * imgNat.h;
                            return (
                              <line key={el.id}
                                x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2}
                                stroke={layer.color} strokeWidth={sel ? 5 : 3}
                                strokeOpacity={sel ? 1 : 0.75}
                                style={{ cursor: "pointer", pointerEvents: "all" }}
                                onClick={(ee: React.MouseEvent) => { ee.stopPropagation(); setSelectedEl(sel ? null : el.id); }}
                              />
                            );
                          }
                          // Render as polygon if polygon_norm available
                          if (el.polygon_norm && el.polygon_norm.length >= 3) {
                            const pts = el.polygon_norm.map(p => `${p.x * imgNat.w},${p.y * imgNat.h}`).join(" ");
                            return (
                              <polygon key={el.id} points={pts}
                                fill={layer.color} fillOpacity={sel ? 0.65 : 0.42}
                                stroke={layer.color} strokeWidth={sel ? 2.5 : 1.5}
                                style={{ cursor: maskTool === "select" ? "move" : "pointer", pointerEvents: "all" }}
                                onClick={ee => { if (!dragStateRef.current) { ee.stopPropagation(); setSelectedEl(sel ? null : el.id); } }}
                                onMouseDown={ee => {
                                  if (maskTool !== "select") return;
                                  ee.stopPropagation();
                                  const norm = screenToNorm(ee.clientX, ee.clientY);
                                  setSelectedEl(el.id);
                                  dragStateRef.current = { mode: "move", id: el.id, startNorm: norm, origBbox: el.bbox_norm };
                                  setIsDragging(true);
                                }}
                              />
                            );
                          }
                          const x = el.bbox_norm.x * imgNat.w, y = el.bbox_norm.y * imgNat.h;
                          const w = el.bbox_norm.w * imgNat.w, h = el.bbox_norm.h * imgNat.h;
                          return (
                            <rect key={el.id}
                              x={x} y={y} width={w} height={h}
                              fill={layer.color} fillOpacity={sel ? 0.65 : 0.42}
                              stroke={layer.color} strokeWidth={sel ? 2.5 : 1.5}
                              rx="2"
                              style={{ cursor: maskTool === "select" ? "move" : "pointer", pointerEvents: "all" }}
                              onClick={ee => { if (!dragStateRef.current) { ee.stopPropagation(); setSelectedEl(sel ? null : el.id); } }}
                              onMouseDown={ee => {
                                if (maskTool !== "select") return;
                                ee.stopPropagation();
                                const norm = screenToNorm(ee.clientX, ee.clientY);
                                setSelectedEl(el.id);
                                dragStateRef.current = { mode: "move", id: el.id, startNorm: norm, origBbox: el.bbox_norm };
                                setIsDragging(true);
                              }}
                            />
                          );
                        })}
                      </g>
                    );
                  })}

                  {/* White dashed outline on selected element */}
                  {selectedEl !== null && (() => {
                    const el = localElements.find(e => e.id === selectedEl);
                    if (!el) return null;
                    if (el.polygon_norm && el.polygon_norm.length >= 3) {
                      const pts = el.polygon_norm.map(p => `${p.x * imgNat.w},${p.y * imgNat.h}`).join(" ");
                      return <polygon points={pts} fill="none" stroke="white" strokeWidth={2} strokeDasharray="5 3" opacity={0.9} style={{ pointerEvents: "none" }} />;
                    }
                    const x = el.bbox_norm.x * imgNat.w - 5, y = el.bbox_norm.y * imgNat.h - 5;
                    const w = el.bbox_norm.w * imgNat.w + 10, h = el.bbox_norm.h * imgNat.h + 10;
                    return (
                      <rect x={x} y={y} width={w} height={h}
                        fill="none" stroke="white" strokeWidth={2}
                        strokeDasharray="5 3" opacity={0.9} rx="4"
                        style={{ pointerEvents: "none" }} />
                    );
                  })()}

                  {/* Polygon drawing preview */}
                  {maskTool === "add_polygon" && maskDrawingPoly.length > 0 && (() => {
                    const color = getColor(maskAddType) ?? "#fbbf24";
                    const previewPts = maskHoverPt ? [...maskDrawingPoly, maskHoverPt] : maskDrawingPoly;
                    return (
                      <g>
                        {previewPts.length >= 3 && (
                          <polygon points={previewPts.map(p => `${p.x * imgNat.w},${p.y * imgNat.h}`).join(" ")}
                            fill={`${color}20`} stroke={color} strokeWidth={2} strokeDasharray="6 3" style={{ pointerEvents: "none" }} />
                        )}
                        {previewPts.length < 3 && previewPts.length >= 2 && (
                          <polyline points={previewPts.map(p => `${p.x * imgNat.w},${p.y * imgNat.h}`).join(" ")}
                            fill="none" stroke={color} strokeWidth={2} strokeDasharray="6 3" style={{ pointerEvents: "none" }} />
                        )}
                        {maskDrawingPoly.map((p, i) => (
                          <circle key={i} cx={p.x * imgNat.w} cy={p.y * imgNat.h}
                            r={i === 0 && maskDrawingPoly.length >= 3 ? 9 : 5}
                            fill={i === 0 && maskDrawingPoly.length >= 3 ? color : "white"}
                            stroke={color} strokeWidth={2} style={{ pointerEvents: "none" }} />
                        ))}
                        {maskHoverPt && (
                          <circle cx={maskHoverPt.x * imgNat.w} cy={maskHoverPt.y * imgNat.h}
                            r={4} fill={`${color}60`} stroke={color} strokeWidth={1.5} style={{ pointerEvents: "none" }} />
                        )}
                      </g>
                    );
                  })()}

                  {/* Resize handles (select mode + selected) */}
                  {maskTool === "select" && selectedEl !== null && (() => {
                    const el = localElements.find(e => e.id === selectedEl);
                    if (!el || el.type === "floor_line") return null;
                    const x = el.bbox_norm.x * imgNat.w, y = el.bbox_norm.y * imgNat.h;
                    const w = el.bbox_norm.w * imgNat.w, h = el.bbox_norm.h * imgNat.h;
                    const HS = Math.max(5, Math.min(10, imgNat.w * 0.008));
                    const handles: Array<{ mode: DragState["mode"]; cx: number; cy: number }> = [
                      { mode: "tl", cx: x,     cy: y     },
                      { mode: "tr", cx: x + w, cy: y     },
                      { mode: "bl", cx: x,     cy: y + h },
                      { mode: "br", cx: x + w, cy: y + h },
                    ];
                    return handles.map(hh => (
                      <rect key={hh.mode}
                        x={hh.cx - HS} y={hh.cy - HS} width={HS * 2} height={HS * 2}
                        fill="white" stroke="#0ea5e9" strokeWidth={1.5} rx={2}
                        style={{ cursor: "nwse-resize" }}
                        onMouseDown={ee => {
                          ee.stopPropagation();
                          const norm = screenToNorm(ee.clientX, ee.clientY);
                          dragStateRef.current = { mode: hh.mode, id: selectedEl!, startNorm: norm, origBbox: el.bbox_norm };
                          setIsDragging(true);
                        }}
                      />
                    ));
                  })()}

                  {/* Draw preview (while adding new element) */}
                  {isDrawing && drawStateRef.current && (() => {
                    const ds = drawStateRef.current!;
                    const x = Math.min(ds.startNorm.x, ds.cur.x) * imgNat.w;
                    const y = Math.min(ds.startNorm.y, ds.cur.y) * imgNat.h;
                    const w = Math.abs(ds.cur.x - ds.startNorm.x) * imgNat.w;
                    const h = Math.abs(ds.cur.y - ds.startNorm.y) * imgNat.h;
                    const color = getColor(ds.type);
                    return (
                      <rect x={x} y={y} width={w} height={h}
                        fill={color} fillOpacity={0.3}
                        stroke={color} strokeWidth={2} strokeDasharray="4 2" rx={2}
                        style={{ pointerEvents: "none" }} />
                    );
                  })()}

                  {/* Facade polygon zones */}
                  {facadeZones.map(zone => {
                    const ptStr = zone.pts.map(p => `${p.x * imgNat.w},${p.y * imgNat.h}`).join(" ");
                    const sel = selectedZoneId === zone.id;
                    const R = Math.max(5, imgNat.w * 0.007);
                    return (
                      <g key={zone.id}>
                        <polygon points={ptStr}
                          fill="#64748b" fillOpacity={sel ? 0.35 : 0.18}
                          stroke={sel ? "#f59e0b" : "#94a3b8"}
                          strokeWidth={sel ? 2 : 1.5}
                          strokeDasharray={sel ? undefined : "7 3"}
                          className="cursor-pointer"
                          onClick={ee => { ee.stopPropagation(); setSelectedZoneId(zone.id === selectedZoneId ? null : zone.id); }}
                        />
                        {/* Draggable corner handles */}
                        {zone.pts.map((pt, ptIdx) => (
                          <circle key={ptIdx}
                            cx={pt.x * imgNat.w} cy={pt.y * imgNat.h} r={R}
                            fill="white" stroke="#f59e0b" strokeWidth={1.5}
                            style={{ cursor: "move" }}
                            onMouseDown={ee => {
                              ee.stopPropagation();
                              draggingPtRef.current = { zoneId: zone.id, ptIdx };
                            }}
                          />
                        ))}
                        {/* Area label */}
                        {(() => {
                          const a = facadeZoneAreaM2(zone.pts);
                          const cx = zone.pts.reduce((s, p) => s + p.x, 0) / 4 * imgNat.w;
                          const cy = zone.pts.reduce((s, p) => s + p.y, 0) / 4 * imgNat.h;
                          return a > 0 ? (
                            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                              fill="#f59e0b" fontSize={Math.max(10, imgNat.w * 0.013)}
                              fontFamily="monospace" fontWeight="bold"
                              style={{ pointerEvents: "none" }}>
                              {a.toFixed(1)} m²
                            </text>
                          ) : null;
                        })()}
                      </g>
                    );
                  })}

                  {/* Pending polygon preview (drawingZone mode) */}
                  {drawingZone && pendingPts.length > 0 && (
                    <g>
                      <polyline
                        points={pendingPts.map(p => `${p.x * imgNat.w},${p.y * imgNat.h}`).join(" ")}
                        fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 2"
                        style={{ pointerEvents: "none" }}
                      />
                      {pendingPts.map((pt, i) => (
                        <circle key={i} cx={pt.x * imgNat.w} cy={pt.y * imgNat.h}
                          r={5} fill="#f59e0b" fillOpacity={0.9}
                          style={{ pointerEvents: "none" }}
                        />
                      ))}
                      <text
                        x={pendingPts[pendingPts.length - 1].x * imgNat.w + 8}
                        y={pendingPts[pendingPts.length - 1].y * imgNat.h - 6}
                        fill="#f59e0b" fontSize={Math.max(9, imgNat.w * 0.011)}
                        fontFamily="monospace" style={{ pointerEvents: "none" }}>
                        {pendingPts.length}/4
                      </text>
                    </g>
                  )}
                </svg>
              )}

            </div>{/* /relative inner */}
            </div>{/* /transform */}

              {/* Demo badge */}
              {result.is_mock && (
                <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-md
                  bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-medium pointer-events-none">
                  <AlertTriangle className="w-3 h-3" /> Démo
                </div>
              )}
              {/* Drawing zone badge */}
              {drawingZone && (
                <div className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-md
                  bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-medium pointer-events-none">
                  <Crop className="w-3 h-3" /> Façade {pendingPts.length}/4
                </div>
              )}
            </div>{/* /overflow zoom container */}
            </div>{/* /canvas panel glass */}

            {/* ── Right panel ── */}
            <div className="flex flex-col gap-4">

              {/* CALQUES */}
              <div className="glass rounded-xl border border-white/10 p-4">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Calques</h4>
                {filteredMaskLayers.map(layer => {
                  const layerHidden = hiddenLayers.has(layer.id);
                  const count = layer.isSurface ? undefined : localElements.filter(e => e.type === layer.id && !hiddenElements.has(e.id)).length;
                  if (!layer.isSurface && localElements.filter(e => e.type === layer.id).length === 0) return null;
                  return (
                    <button key={layer.id}
                      onClick={() => setHiddenLayers(prev => { const n = new Set(prev); n.has(layer.id) ? n.delete(layer.id) : n.add(layer.id); return n; })}
                      className={cn("flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs hover:bg-white/5 transition-colors", layerHidden ? "opacity-40" : "opacity-100")}>
                      {layerHidden ? <EyeOff className="w-3.5 h-3.5 text-slate-600" /> : <Eye className="w-3.5 h-3.5 text-white" />}
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: layerHidden ? "#475569" : layer.color }} />
                      <span className={cn("flex-1 text-left", layerHidden ? "text-slate-600" : "text-white")}>{layer.label}</span>
                      {count != null && <span className="font-mono text-slate-500">{count}</span>}
                    </button>
                  );
                })}
              </div>

              {/* ÉLÉMENT SÉLECTIONNÉ */}
              {selectedEl !== null && (() => {
                const el = localElements.find(e => e.id === selectedEl);
                if (!el) return null;
                return (
                  <div className="glass rounded-xl border border-white/10 p-4">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Élément</h4>
                    <div className="flex flex-col gap-3">
                      <div>
                        <label className="text-xs text-slate-500 mb-1 block">Type</label>
                        <select value={el.type}
                          onChange={e2 => { const t = e2.target.value as FacadeElement["type"]; setLocalElements(prev => prev.map(x => x.id === el.id ? { ...x, type: t, label_fr: t } : x)); }}
                          className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white">
                          {filteredMaskLayers.filter(l => !l.isSurface).map(l => (
                            <option key={l.id} value={l.id} style={{ background: "#1e293b" }}>{l.label}</option>
                          ))}
                        </select>
                      </div>
                      {el.area_m2 != null && (
                        <div className="text-xs text-slate-400">Surface: <span className="text-white font-mono">{el.area_m2.toFixed(2)} m²</span></div>
                      )}
                      <Button variant="outline" size="sm" onClick={() => { setLocalElements(prev => prev.filter(x => x.id !== el.id)); setSelectedEl(null); }}
                        className="text-red-400 border-red-500/20 hover:bg-red-500/10">
                        <Trash2 className="w-3.5 h-3.5 mr-1" /> Supprimer
                      </Button>
                    </div>
                  </div>
                );
              })()}

              {/* ÉLÉMENTS count */}
              <div className="glass rounded-xl border border-white/10 p-4">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Éléments</h4>
                <div className="flex flex-col gap-1.5">
                  {filteredMaskLayers.filter(l => !l.isSurface).map(l => {
                    const count = localElements.filter(e => e.type === l.id && !hiddenElements.has(e.id)).length;
                    if (count === 0) return null;
                    return (
                      <div key={l.id} className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-white/3">
                        <span className="flex items-center gap-2 text-xs text-slate-300">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.color }} />
                          {l.label}
                        </span>
                        <span className="font-mono text-sm font-bold" style={{ color: l.color }}>{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* SURFACES */}
              {(fenetresAreaM2 > 0 || facadeNetteM2 != null) && (
                <div className="glass rounded-xl border border-white/10 p-4 space-y-3">
                  {fenetresAreaM2 > 0 && (
                    <div>
                      <div className="text-xs text-amber-500/80 uppercase tracking-wider mb-0.5">Surface fenêtres</div>
                      <div className="text-base font-mono font-semibold text-amber-300">{fenetresAreaM2.toFixed(1)} m²</div>
                    </div>
                  )}
                  {facadeNetteM2 != null && (
                    <div>
                      <div className="text-xs text-blue-400/80 uppercase tracking-wider mb-0.5">Surface façade nette</div>
                      <div className="text-xl font-mono font-bold text-blue-400">{facadeNetteM2.toFixed(1)} m²</div>
                      {totalFacadeZonesM2 > 0 && fenetresAreaM2 > 0 && (
                        <div className="text-xs text-slate-500 mt-0.5">{((fenetresAreaM2 / totalFacadeZonesM2) * 100).toFixed(0)}% ouvertures</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* DÉLIMITER FAÇADE */}
              <div data-tuto-fa="delim" className="glass rounded-xl border border-white/10 p-4 space-y-2">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center justify-between">
                  <span className="flex items-center gap-2"><Crop className="w-3.5 h-3.5 text-amber-400" /> Délimiter façade</span>
                  {totalFacadeZonesM2 > 0 && <span className="font-mono text-amber-400">{totalFacadeZonesM2.toFixed(1)} m²</span>}
                </div>
                <button onClick={() => { setDrawingZone(v => !v); setPendingPts([]); setMaskTool("select"); setMaskDrawingPoly([]); }}
                  className={cn("w-full flex items-center justify-center gap-2 text-sm px-3 py-2.5 rounded-xl border transition-all font-medium",
                    drawingZone ? "bg-amber-500/20 border-amber-500/40 text-amber-300" : "border-white/10 text-slate-400 hover:text-white hover:border-white/20")}>
                  <PlusCircle className="w-4 h-4" />
                  {drawingZone ? `Placer points (${4 - pendingPts.length} restants)` : "Dessiner une zone"}
                </button>
                {facadeZones.length > 0 && (
                  <div className="space-y-1">
                    {facadeZones.map((zone, zi) => (
                      <div key={zone.id}
                        className={cn("flex items-center gap-2 px-2 py-1 rounded-lg text-xs cursor-pointer transition-all",
                          selectedZoneId === zone.id ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5")}
                        onClick={() => setSelectedZoneId(zone.id === selectedZoneId ? null : zone.id)}>
                        <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: "#94a3b8", opacity: 0.75 }} />
                        <span className="flex-1">Façade {zi + 1}</span>
                        <span className="font-mono text-[10px] text-slate-500">{facadeZoneAreaM2(zone.pts).toFixed(1)} m²</span>
                        <button title="Supprimer" onClick={e2 => { e2.stopPropagation(); setFacadeZones(prev => prev.filter(z => z.id !== zone.id)); if (selectedZoneId === zone.id) setSelectedZoneId(null); }}
                          className="text-slate-600 hover:text-red-400 transition-colors">×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* RESET */}
              <div className="mt-auto flex flex-col gap-2">
                {hiddenElements.size > 0 && (
                  <button onClick={() => { setHiddenElements(new Set()); setSelectedEl(null); }}
                    className="flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-slate-300 transition-colors py-2.5 rounded-xl border border-white/5 hover:border-white/10">
                    <RotateCcw className="w-4 h-4" /> Restaurer ({hiddenElements.size})
                  </button>
                )}
                {localElements.length !== result.elements.length && (
                  <button onClick={() => { setLocalElements(result.elements); setHiddenElements(new Set()); setSelectedEl(null); setMaskTool("select"); setMaskDrawingPoly([]); }}
                    className="flex items-center justify-center gap-2 text-sm text-slate-600 hover:text-slate-400 transition-colors py-2.5 rounded-xl border border-white/5 hover:border-white/10">
                    <RefreshCw className="w-4 h-4" /> Réinitialiser IA
                  </button>
                )}
              </div>
            </div>{/* /right panel */}
          </div>{/* /grid */}
          </>
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

      {/* ── ITE & Retours de tableau ── */}
      <div className="mb-4">
        <FacadeIsolationPanel
          result={result}
          localElements={localElements}
          facadeAreaOverride={totalFacadeZonesM2 > 0 ? totalFacadeZonesM2 : null}
          imgSize={imgNat}
        />
      </div>

      {/* ── Dashboard Overview ── */}
      <div className="mb-4">
        <FacadeDashboardPanel result={result} />
      </div>

      {/* ── Métré (surfaces) ── */}
      <div className="mb-4">
        <FacadeMetrePanel result={result} />
      </div>

      {/* ── 3D Facade View ── */}
      <div className="mb-4">
        <Facade3dPanel result={result} />
      </div>

      {/* ── Materials Estimation ── */}
      <div className="mb-4">
        <FacadeMaterialsPanel result={result} />
      </div>

      {/* ── Toolkit (estimations) ── */}
      <div className="mb-4">
        <FacadeToolkitPanel result={result} />
      </div>

      {/* ── DPGF Ravalement ── */}
      <div className="mb-4">
        <FacadeDpgfPanel result={result} />
      </div>

      {/* ── Lots ── */}
      <div className="mb-4">
        <FacadeLotsPanel result={result} />
      </div>

      {/* ── Scenarios ── */}
      <div className="mb-4">
        <FacadeScenarioPanel result={result} />
      </div>

      {/* ── CCTP ── */}
      <div className="mb-4">
        <FacadeCctpPanel result={result} />
      </div>

      {/* ── Gantt ── */}
      <div className="mb-4">
        <FacadeGanttPanel result={result} />
      </div>

      {/* ── Compliance ── */}
      <div className="mb-4">
        <FacadeCompliancePanel result={result} />
      </div>

      {/* ── Chat IA ── */}
      <div className="mb-4">
        <FacadeChatPanel result={result} />
      </div>

      {/* ── Debug ── */}
      <div className="mb-8">
        <FacadeDebugPanel result={result} />
      </div>

      {/* Dialog modals */}
      {showRapport && <FacadeRapportDialog result={result} onClose={() => setShowRapport(false)} />}
      {showDevis && <FacadeDevisDialog result={result} onClose={() => setShowDevis(false)} />}

      {/* Actions */}
      <div className="flex flex-wrap gap-3 justify-center">
        <Button variant="outline" onClick={() => setShowRapport(true)}>
          <FileText className="w-4 h-4" /> {d("fa_report" as DTKey)}
        </Button>
        <Button variant="outline" onClick={() => setShowDevis(true)}>
          <Receipt className="w-4 h-4" /> {d("fa_quote" as DTKey)}
        </Button>
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
