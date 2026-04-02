"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight, RotateCcw, Download, Eye, EyeOff,
  AlertTriangle, Building2, AppWindow, DoorOpen, Layers,
  LayoutPanelTop, Columns2, Frame, Crop,
  ZoomIn, ZoomOut, PenSquare, ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FacadeAnalysisResult, FacadeElement } from "@/lib/types";
import { pointInPolygon } from "@/lib/measure-types";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import Facade3dPanel from "./facade-3d-panel";
import FacadeDashboardPanel from "./facade-dashboard-panel";
import FacadeChatPanel from "./facade-chat-panel";
import FacadeMetrePanel from "./facade-metre-panel";
import FacadeDebugPanel from "./facade-debug-panel";
import FacadeIsolationPanel from "./facade-isolation-panel";
import FacadeRapportDialog from "./facade-rapport-dialog";
import FacadeDevisDialog from "./facade-devis-dialog";
import FacadeTutorialOverlay, { resetFacadeTutorial } from "./facade-tutorial-overlay";
import { FileText, Receipt } from "lucide-react";

/* ── Component type alias ── */
type IconComp = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

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
  onBack?: () => void;
  initialFacadeZones?: Array<{ id: number; pts: Array<{ x: number; y: number }> }>;
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

export default function FacadeResultsStep({ result, onGoEditor, onRestart, onBack, initialFacadeZones }: FacadeResultsStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  /* ── Dialog modals ── */
  const [showRapport, setShowRapport] = useState(false);
  const [showDevis, setShowDevis] = useState(false);

  /* ── Mask editor: mutable local copy of elements ── */
  const [localElements, setLocalElements] = useState<FacadeElement[]>(result.elements);

  /* ── Image natural dimensions ── */
  const [imgNat, setImgNat] = useState({ w: 800, h: 600 });

  /* ── Masques tab: layer + element state ── */
  const [hiddenLayers,   setHiddenLayers]   = useState<Set<string>>(new Set());
  const [hiddenElements, setHiddenElements] = useState<Set<number>>(new Set());
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
  const maskSvgRef   = useRef<SVGSVGElement>(null);

  /* ── Facade polygon zones ── */
  const [facadeZones] = useState<FacadeZone[]>(
    () => (initialFacadeZones ?? []).map(z => ({ id: z.id, pts: z.pts }))
  );

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
  }, [result]);

  /* ── Masques: wheel zoom ── */
  useEffect(() => {
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
  }, []);

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

      {/* ── Toolbar: back + edit masks + zoom ── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {onBack && (
          <button onClick={onBack}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all">
            <ChevronLeft className="w-4 h-4" /> Retour
          </button>
        )}
        <button onClick={() => onGoEditor?.()}
          className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent/80 text-white rounded-xl text-sm font-medium transition-colors">
          <PenSquare className="w-4 h-4" /> {d("fa_go_editor")}
        </button>

        {/* Mask filter: Tous | Murs | Ouvertures */}
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

        <div className="flex-1" />
        <button onClick={() => setMaskZoom(z => Math.max(z / 1.3, 0.5))} className="p-1.5 text-slate-400 hover:text-white"><ZoomOut className="w-4 h-4" /></button>
        <span className="text-xs text-slate-500 font-mono w-12 text-center">{(maskZoom * 100).toFixed(0)}%</span>
        <button onClick={() => setMaskZoom(z => Math.min(z * 1.3, 8))} className="p-1.5 text-slate-400 hover:text-white"><ZoomIn className="w-4 h-4" /></button>
      </div>

      {/* ── Image panel (Masques view) ── */}
      <div className="glass rounded-2xl border border-white/10 p-2 mb-8 overflow-hidden">
        <FacadeTutorialOverlay forceShow={showTuto} />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">

            {/* Left: canvas panel */}
            <div className="glass rounded-2xl border border-white/10 p-2 overflow-hidden">

              {/* Image + zoom container */}
              <div
              ref={maskContainerRef}
              className="relative overflow-hidden rounded-xl select-none bg-slate-900"
              style={{ minHeight: 200, cursor: isMaskPanning ? "grabbing" : "default" }}
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

              {/* Per-type mask layers: read-only overlays */}
              {imgNat.w > 0 && (
                <svg
                  ref={maskSvgRef}
                  className="absolute top-0 left-0 w-full h-full pointer-events-none"
                  viewBox={`0 0 ${imgNat.w} ${imgNat.h}`}
                  preserveAspectRatio="xMinYMin meet"
                >

                  {filteredMaskLayers.filter(l => !l.isSurface && !hiddenLayers.has(l.id)).map(layer => {
                    const layerEls = localElements.filter(e => e.type === layer.id && !hiddenElements.has(e.id));
                    return (
                      <g key={layer.id}>
                        {layerEls.map(el => {
                          if (el.type === "floor_line") {
                            const x = el.bbox_norm.x * imgNat.w, y = el.bbox_norm.y * imgNat.h;
                            const w = el.bbox_norm.w * imgNat.w, h = el.bbox_norm.h * imgNat.h;
                            return (
                              <line key={el.id}
                                x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2}
                                stroke={layer.color} strokeWidth={3} strokeOpacity={0.75}
                              />
                            );
                          }
                          if (el.polygon_norm && el.polygon_norm.length >= 3) {
                            const pts = el.polygon_norm.map(p => `${p.x * imgNat.w},${p.y * imgNat.h}`).join(" ");
                            return (
                              <polygon key={el.id} points={pts}
                                fill={layer.color} fillOpacity={0.42}
                                stroke={layer.color} strokeWidth={1.5}
                              />
                            );
                          }
                          const x = el.bbox_norm.x * imgNat.w, y = el.bbox_norm.y * imgNat.h;
                          const w = el.bbox_norm.w * imgNat.w, h = el.bbox_norm.h * imgNat.h;
                          return (
                            <rect key={el.id}
                              x={x} y={y} width={w} height={h}
                              fill={layer.color} fillOpacity={0.42}
                              stroke={layer.color} strokeWidth={1.5} rx="2"
                            />
                          );
                        })}
                      </g>
                    );
                  })}

                  {/* Facade polygon zones (read-only) */}
                  {facadeZones.map(zone => {
                    const ptStr = zone.pts.map(p => `${p.x * imgNat.w},${p.y * imgNat.h}`).join(" ");
                    return (
                      <g key={zone.id}>
                        <polygon points={ptStr}
                          fill="#64748b" fillOpacity={0.18}
                          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="7 3"
                        />
                        {(() => {
                          const a = facadeZoneAreaM2(zone.pts);
                          const cx = zone.pts.reduce((s, p) => s + p.x, 0) / 4 * imgNat.w;
                          const cy = zone.pts.reduce((s, p) => s + p.y, 0) / 4 * imgNat.h;
                          return a > 0 ? (
                            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                              fill="#f59e0b" fontSize={Math.max(10, imgNat.w * 0.013)}
                              fontFamily="monospace" fontWeight="bold">
                              {a.toFixed(1)} m²
                            </text>
                          ) : null;
                        })()}
                      </g>
                    );
                  })}
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
            </div>{/* /overflow zoom container */}
            </div>{/* /canvas panel glass */}

            {/* ── Right panel ── */}
            <div className="flex flex-col gap-4">

              {/* CALQUES — limited to fenêtres (window) and murs (surface_murale) */}
              <div className="glass rounded-xl border border-white/10 p-4">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Calques</h4>
                {MASK_LAYERS.filter(l => l.id === "surface_murale" || l.id === "window").map(layer => {
                  const layerHidden = hiddenLayers.has(layer.id);
                  const count = layer.isSurface ? undefined : localElements.filter(e => e.type === layer.id && !hiddenElements.has(e.id)).length;
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

              {/* ÉLÉMENTS count — limited to fenêtres (window) and murs (surface_murale) */}
              <div className="glass rounded-xl border border-white/10 p-4">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Éléments</h4>
                <div className="flex flex-col gap-1.5">
                  {MASK_LAYERS.filter(l => (l.id === "window") && !l.isSurface).map(l => {
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

            </div>{/* /right panel */}
          </div>{/* /grid */}
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
