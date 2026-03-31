"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight, RotateCcw, Download, Eye, EyeOff,
  AlertTriangle, Building2, AppWindow, DoorOpen, Layers,
  LayoutPanelTop, Columns2, Frame, Box, HelpCircle, Trash2,
  Pencil, PlusCircle, RefreshCw, Crop,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FacadeAnalysisResult, FacadeElement } from "@/lib/types";
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
  { id: "other",          label: "Ouvertures détectées",    icon: HelpCircle,     color: "#fbbf24" },
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
  const [editMode,       setEditMode]       = useState(false);
  const [addingType,     setAddingType]     = useState<string | null>(null);
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
    // Holes: opening elements
    localElements
      .filter(e => ["window", "door", "balcony"].includes(e.type) && !hiddenElements.has(e.id))
      .forEach(e => {
        const x = e.bbox_norm.x * W, y = e.bbox_norm.y * H;
        const w = e.bbox_norm.w * W, h = e.bbox_norm.h * H;
        p += ` M${x} ${y} h${w} v${h} h${-w} Z`;
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
    setEditMode(false);
    setAddingType(null);
  }, [result]);

  /* ── Keyboard: Delete/Backspace removes selected element from mask ── */
  useEffect(() => {
    if (viewTab !== "masks") return;
    const handle = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedEl !== null) {
        setHiddenElements(prev => new Set([...prev, selectedEl]));
        setSelectedEl(null);
      } else if (e.key === "Escape") {
        setSelectedEl(null);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [viewTab, selectedEl]);

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
    if (!editMode) return;
    const norm = screenToNorm(e.clientX, e.clientY);
    if (addingType) {
      e.stopPropagation();
      drawStateRef.current = { type: addingType, startNorm: norm, cur: norm };
      setIsDrawing(true);
      return;
    }
    setSelectedEl(null);
  }, [editMode, addingType, screenToNorm, drawingZone]);

  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const norm = screenToNorm(e.clientX, e.clientY);

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
          <div className="flex flex-col lg:flex-row gap-3 items-start">
            {/* Tutorial overlay — shown once per session */}
            <FacadeTutorialOverlay forceShow={showTuto} />

            {/* Left: base image + SVG mask overlays — self-start prevents height-stretch in flex-row */}
            <div className="relative flex-1 min-w-0 self-start">
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
                  <path d={wallSvgPath} fillRule="evenodd" fill="#64748b" fillOpacity={0.35} />
                </svg>
              )}

              {/* Per-type mask layers: interactive + editable */}
              {imgNat.w > 0 && (
                <svg
                  ref={maskSvgRef}
                  className="absolute top-0 left-0 w-full h-full"
                  viewBox={`0 0 ${imgNat.w} ${imgNat.h}`}
                  preserveAspectRatio="xMinYMin meet"
                  style={{ cursor: drawingZone ? "crosshair" : addingType ? "crosshair" : editMode ? "default" : undefined }}
                  onMouseDown={handleSvgMouseDown}
                  onMouseMove={handleSvgMouseMove}
                  onMouseUp={handleSvgMouseUp}
                  onMouseLeave={handleSvgMouseUp}
                >

                  {filteredMaskLayers.filter(l => !l.isSurface && !hiddenLayers.has(l.id)).map(layer => {                    const layerEls = localElements.filter(
                      e => e.type === layer.id && !hiddenElements.has(e.id)
                    );
                    return (
                      <g key={layer.id}>
                        {layerEls.map(el => {
                          const x = el.bbox_norm.x * imgNat.w, y = el.bbox_norm.y * imgNat.h;
                          const w = el.bbox_norm.w * imgNat.w, h = el.bbox_norm.h * imgNat.h;
                          const sel = selectedEl === el.id;
                          if (el.type === "floor_line") {
                            return (
                              <line key={el.id}
                                x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2}
                                stroke={layer.color} strokeWidth={sel ? 5 : 3}
                                strokeOpacity={sel ? 1 : 0.75}
                                className="cursor-pointer"
                                onClick={(ee: React.MouseEvent) => { ee.stopPropagation(); setSelectedEl(sel ? null : el.id); }}
                              />
                            );
                          }
                          return (
                            <rect key={el.id}
                              x={x} y={y} width={w} height={h}
                              fill={layer.color} fillOpacity={sel ? 0.65 : 0.42}
                              stroke={layer.color} strokeWidth={sel ? 2.5 : 1.5}
                              strokeOpacity={sel ? 1 : 0.85}
                              rx="2"
                              className="cursor-move"
                              onClick={ee => { if (!dragStateRef.current) { ee.stopPropagation(); setSelectedEl(sel ? null : el.id); } }}
                              onMouseDown={ee => {
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
                    const x = el.bbox_norm.x * imgNat.w - 5, y = el.bbox_norm.y * imgNat.h - 5;
                    const w = el.bbox_norm.w * imgNat.w + 10, h = el.bbox_norm.h * imgNat.h + 10;
                    return (
                      <rect x={x} y={y} width={w} height={h}
                        fill="none" stroke="white" strokeWidth={2}
                        strokeDasharray="5 3" opacity={0.9} rx="4"
                        style={{ pointerEvents: "none" }} />
                    );
                  })()}

                  {/* Resize handles (edit mode + selected) */}
                  {editMode && selectedEl !== null && (() => {
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

              {/* Action bar for selected element */}
              {selectedEl !== null && (() => {
                const el = localElements.find(e => e.id === selectedEl);
                if (!el) return null;
                const Icon  = getIcon(el.type);
                const color = getColor(el.type);
                return (
                  <div className="absolute bottom-2 left-2 right-2 z-20 flex flex-wrap items-center gap-2
                    bg-black/85 backdrop-blur-sm rounded-lg px-3 py-2 text-xs border border-white/10">
                    {/* Type badge */}
                    <span className="flex items-center gap-1 text-slate-300 shrink-0">
                      <Icon className="w-3 h-3" style={{ color }} />
                      <span style={{ color }}>{d(TYPE_I18N[el.type] ?? "fa_other")}</span>
                      {el.confidence != null && (
                        <span className="text-slate-600">{(el.confidence * 100).toFixed(0)}%</span>
                      )}
                    </span>
                    {/* Reclassify selector */}
                    <select
                      value={el.type}
                      onChange={e2 => {
                        const newType = e2.target.value as FacadeElement["type"];
                        setLocalElements(prev => prev.map(x =>
                          x.id === el.id ? { ...x, type: newType, label_fr: newType } : x
                        ));
                      }}
                      className="flex-1 min-w-[100px] bg-white/10 border border-white/20 rounded px-1.5 py-0.5 text-white text-xs focus:outline-none focus:ring-1 focus:ring-amber-400/50"
                    >
                      {(["window","door","balcony","floor_line","roof","column","other"] as ElementType[]).map(t => (
                        <option key={t} value={t} style={{ background: "#1e293b" }}>
                          {d(TYPE_I18N[t] ?? "fa_other")}
                        </option>
                      ))}
                    </select>
                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                      <button
                        onClick={() => {
                          setLocalElements(prev => prev.filter(e => e.id !== selectedEl));
                          setSelectedEl(null);
                        }}
                        className="flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors
                          px-2 py-0.5 rounded border border-red-500/30 hover:border-red-400/50">
                        <Trash2 className="w-3 h-3" /> {d("fa_remove" as DTKey)}
                      </button>
                      <button onClick={() => setSelectedEl(null)}
                        className="text-slate-500 hover:text-slate-300 px-1">✕</button>
                    </div>
                  </div>
                );
              })()}

              {/* Demo badge */}
              {result.is_mock && (
                <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-md
                  bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-medium pointer-events-none">
                  <AlertTriangle className="w-3 h-3" /> {d("fa_demo_badge" as DTKey)}
                </div>
              )}

              {/* Edit / Drawing mode badge */}
              {(editMode || drawingZone) && (
                <div className={cn(
                  "absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium pointer-events-none",
                  drawingZone
                    ? "bg-amber-500/20 border border-amber-500/30 text-amber-300"
                    : "bg-blue-500/20 border border-blue-500/30 text-blue-300"
                )}>
                  {drawingZone ? (
                    <><Crop className="w-3 h-3" /> Délimiter façade ({pendingPts.length}/4)</>
                  ) : (
                    <><Pencil className="w-3 h-3" /> {addingType ? `Dessiner ${addingType}` : "Mode édition"}</>
                  )}
                </div>
              )}
            </div>

            {/* Right: layer panel */}
            <div className="lg:w-80 shrink-0 glass rounded-xl border border-white/10 p-5 flex flex-col gap-5">

              {/* ── AFFICHAGE DES CALQUES ── */}
              <div data-tuto-fa="layers">
                <div className="text-base font-semibold text-slate-200 mb-2 flex items-center gap-2.5">
                  <Eye className="w-6 h-6 text-slate-400" /> {d("fa_layer_display" as DTKey)}
                </div>
                <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
                  {d("fa_layer_desc" as DTKey)}
                </p>

                <div className="space-y-1">
                  {filteredMaskLayers.map(layer => {
                    const hasAny = layer.isSurface || localElements.some(e => e.type === layer.id);
                    if (!hasAny) return null;

                    const totalCount   = layer.isSurface ? undefined : localElements.filter(e => e.type === layer.id).length;
                    const activeCount  = layer.isSurface ? undefined : localElements.filter(e => e.type === layer.id && !hiddenElements.has(e.id)).length;
                    const removedCount = (totalCount ?? 0) - (activeCount ?? 0);
                    const layerHidden  = hiddenLayers.has(layer.id);
                    const Icon = layer.icon;

                    return (
                      <button key={layer.id}
                        title={layerHidden
                          ? `${d("fa_tt_show_layer" as DTKey)} — ${layer.label}`
                          : `${d("fa_tt_hide_layer" as DTKey)} — ${layer.label}`}                        onClick={() => {
                          setHiddenLayers(prev => {
                            const n = new Set(prev);
                            if (!n.has(layer.id)) {
                              n.add(layer.id);
                              if (selectedEl !== null) {
                                const sel = result.elements.find(e => e.id === selectedEl);
                                if (sel?.type === layer.id) setSelectedEl(null);
                              }
                            } else { n.delete(layer.id); }
                            return n;
                          });
                        }}
                        className={cn(
                          "w-full flex items-center gap-3.5 px-3.5 py-3 rounded-xl text-sm transition-all hover:bg-white/5",
                          layerHidden ? "opacity-40" : "opacity-100"
                        )}>
                        <div className="w-6 h-6 rounded shrink-0"
                          style={{ background: layer.color, opacity: 0.8 }} />
                        <Icon className="w-6 h-6 shrink-0" style={{ color: layer.color }} />
                        <span className="flex-1 text-left text-slate-300 truncate text-sm">{layer.label}</span>
                        {activeCount != null && (
                          <span className="font-mono text-slate-500 shrink-0 text-xs">                            {removedCount > 0 ? `${activeCount}/${totalCount}` : activeCount}
                          </span>
                        )}
                        {layerHidden
                          ? <EyeOff className="w-6 h-6 shrink-0 text-slate-600" />
                          : <Eye    className="w-6 h-6 shrink-0 text-slate-400" />}
                      </button>
                    );
                  })}
                </div>              </div>

              {/* ── SURFACE MUR OPAQUE ── */}
              {!hiddenLayers.has("surface_murale") && (
                <div className="border-t border-white/5 pt-3 space-y-1"
                  title={d("fa_tt_wall_area" as DTKey)}>
                  <div className="text-xs text-slate-500 uppercase tracking-wider">{d("fa_wall_area" as DTKey)}</div>
                  <div className="text-base font-mono font-semibold text-slate-200">
                    {wallAreaM2 != null ? `${wallAreaM2.toFixed(1)} m²` : "—"}
                  </div>
                  {result.facade_area_m2 && wallAreaM2 != null && (
                    <div className="text-xs text-slate-500">
                      {((wallAreaM2 / result.facade_area_m2) * 100).toFixed(0)}% de la façade
                    </div>
                  )}
                </div>
              )}

              {/* ── MODIFICATION DES ZONES ── */}
              <div data-tuto-fa="edit" className="border-t border-white/5 pt-3">
                <div className="text-base font-semibold text-slate-200 mb-2 flex items-center gap-2.5">
                  <Pencil className="w-6 h-6 text-blue-400" /> {d("fa_edit_zones" as DTKey)}
                </div>
                <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
                  {d("fa_edit_desc" as DTKey)}
                </p>
                <button
                  title={d("fa_tt_edit_mode" as DTKey)}
                  onClick={() => {
                    setEditMode(v => !v);
                    setAddingType(null);
                    dragStateRef.current = null; setIsDragging(false);
                    drawStateRef.current = null; setIsDrawing(false);
                    setDrawingZone(false); setPendingPts([]);
                  }}
                  className={cn(
                    "w-full flex items-center justify-center gap-3 text-base px-5 py-3.5 rounded-xl border transition-all font-medium",
                    editMode
                      ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
                      : "border-white/10 text-slate-400 hover:text-white hover:border-white/20"
                  )}>
                  <Pencil className="w-6 h-6" />
                  {editMode ? d("fa_edit_active" as DTKey) : d("fa_edit_enable" as DTKey)}
                </button>
                {editMode && (
                  <p className="text-[11px] text-blue-300/70 mt-2 px-1 leading-relaxed">
                    {d("fa_edit_hint" as DTKey)}
                  </p>
                )}
              </div>

              {/* ── AJOUT MANUEL DE ZONES ── */}
              {editMode && (
                <div className="space-y-2">
                  <div className="text-base font-semibold text-slate-200 flex items-center gap-2.5">
                    <PlusCircle className="w-6 h-6 text-emerald-400" /> {d("fa_add_manual" as DTKey)}
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    {d("fa_add_desc" as DTKey)}
                  </p>
                  {MASK_LAYERS.filter(l => !l.isSurface && l.id !== "floor_line").map(layer => {
                    const Icon = layer.icon;
                    const active = addingType === layer.id;
                    return (
                      <button key={layer.id}
                        title={`${d("fa_tt_draw_el" as DTKey)} — ${layer.label}`}
                        onClick={() => setAddingType(active ? null : layer.id)}
                        className={cn(
                          "w-full flex items-center gap-3.5 px-3.5 py-3 rounded-xl text-sm transition-all border",
                          active
                            ? "bg-white/10 border-white/25 text-white"
                            : "border-transparent text-slate-400 hover:bg-white/5 hover:text-white"
                        )}>
                        <div className="w-6 h-6 rounded shrink-0" style={{ background: layer.color, opacity: 0.8 }} />
                        <Icon className="w-6 h-6 shrink-0" style={{ color: layer.color }} />
                        <span className="flex-1 text-left truncate">{layer.label}</span>
                        {active && <span className="text-xs text-sky-400 shrink-0 animate-pulse">{d("fa_draw" as DTKey)}</span>}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* ── DÉLIMITER LA FAÇADE : polygone 4 points ── */}
              <div data-tuto-fa="delim" className="border-t border-white/5 pt-3 space-y-2">
                <div className="text-base font-semibold text-slate-200 flex items-center justify-between">
                  <span className="flex items-center gap-2.5"><Crop className="w-6 h-6 text-amber-400" /> {d("fa_delim_facade" as DTKey)}</span>
                  {totalFacadeZonesM2 > 0 && (
                    <span className="font-mono text-amber-400 text-sm">{totalFacadeZonesM2.toFixed(1)} m²</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  {d("fa_delim_desc" as DTKey)}
                </p>
                <button
                  title={d("fa_tt_delim" as DTKey)}
                  onClick={() => {
                    setDrawingZone(v => !v);
                    setPendingPts([]);
                    setEditMode(false);
                    setAddingType(null);
                  }}
                  className={cn(
                    "w-full flex items-center justify-center gap-3 text-base px-5 py-3.5 rounded-xl border transition-all font-medium",
                    drawingZone
                      ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                      : "border-white/10 text-slate-400 hover:text-white hover:border-white/20"
                  )}>
                  <PlusCircle className="w-6 h-6" />
                  {drawingZone ? `${d("fa_place_pts" as DTKey)} ${4 - pendingPts.length} ${d("fa_pts_suffix" as DTKey)}` : d("fa_draw_zone" as DTKey)}
                </button>
                {facadeZones.length > 0 && (
                  <div className="space-y-1">
                    {facadeZones.map((zone, zi) => (
                      <div key={zone.id}
                        className={cn(
                          "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer",
                          selectedZoneId === zone.id ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5"
                        )}
                        onClick={() => setSelectedZoneId(zone.id === selectedZoneId ? null : zone.id)}>
                        <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: "#94a3b8", opacity: 0.75 }} />
                        <span className="flex-1">Façade {zi + 1}</span>
                        <span className="font-mono text-[10px] text-slate-500">
                          {facadeZoneAreaM2(zone.pts).toFixed(1)} m²
                        </span>
                        <button
                          title="Supprimer cette zone"
                          onClick={e2 => { e2.stopPropagation(); setFacadeZones(prev => prev.filter(z => z.id !== zone.id)); if (selectedZoneId === zone.id) setSelectedZoneId(null); }}
                          className="text-slate-600 hover:text-red-400 transition-colors px-0.5">×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── ANNULER / RÉINITIALISER ── */}
              <div className="mt-auto flex flex-col gap-2">
                {hiddenElements.size > 0 && (
                  <button
                    title={d("fa_tt_restore" as DTKey)}
                    onClick={() => { setHiddenElements(new Set()); setSelectedEl(null); }}
                    className="flex items-center justify-center gap-3 text-sm text-slate-500
                      hover:text-slate-300 transition-colors py-3 rounded-xl border border-white/5
                      hover:border-white/10">
                    <RotateCcw className="w-6 h-6" /> {d("fa_restore" as DTKey)} ({hiddenElements.size})
                  </button>
                )}
                {localElements.length !== result.elements.length && (
                  <button
                    title={d("fa_tt_reset" as DTKey)}
                    onClick={() => {
                      setLocalElements(result.elements);
                      setHiddenElements(new Set());
                      setSelectedEl(null);
                      setEditMode(false);
                      setAddingType(null);
                    }}
                    className="flex items-center justify-center gap-3 text-sm text-slate-600
                      hover:text-slate-400 transition-colors py-3 rounded-xl border border-white/5
                      hover:border-white/10">
                    <RefreshCw className="w-6 h-6" /> {d("fa_reset_ia" as DTKey)}
                  </button>
                )}
              </div>
            </div>
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
                <span className="text-sm text-slate-500 ml-1">
                  ({((1 - result.ratio_openings) * 100).toFixed(0)}%)
                </span>
              )}
            </div>
          </div>
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
