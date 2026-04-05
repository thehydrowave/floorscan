"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight, RotateCcw, Download, Eye, EyeOff,
  AlertTriangle, Building2, AppWindow, DoorOpen, Layers,
  LayoutPanelTop, Columns2, Frame, Crop,
  ZoomIn, ZoomOut, PenSquare, ChevronLeft, ChevronDown, ChevronUp, Wrench,
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
import FacadeMaterialsPanel from "./facade-materials-panel";
import FacadeToolkitPanel from "./facade-toolkit-panel";
import FacadeDpgfPanel from "./facade-dpgf-panel";
import FacadeLotsPanel from "./facade-lots-panel";
import FacadeScenarioPanel from "./facade-scenario-panel";
import FacadeCctpPanel from "./facade-cctp-panel";
import FacadeGanttPanel from "./facade-gantt-panel";
import FacadeCompliancePanel from "./facade-compliance-panel";
import FacadeIsolationPanel from "./facade-isolation-panel";
import FacadeChatPanel from "./facade-chat-panel";
import FacadeDebugPanel from "./facade-debug-panel";
import FacadeRapportDialog from "./facade-rapport-dialog";
import FacadeDevisDialog from "./facade-devis-dialog";
import FacadeTutorialOverlay, { resetFacadeTutorial } from "./facade-tutorial-overlay";
import { FileText, Receipt } from "lucide-react";

/* ── Component type alias ── */
type IconComp = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

/* ── i18n key per element type ── */
const TYPE_I18N: Record<string, DTKey> = {
  window:          "fa_window",
  door:            "fa_door",
  balcony:         "fa_balcony",
  floor_line:      "fa_floor_line",
  roof:            "fa_roof",
  column:          "fa_column",
  other:           "fa_other",
  surface_murale:  "fr_opaque_wall",
};

/* ── Mask layer definitions (Masques tab) ── */
interface MaskLayerDef { id: string; label: string; icon: IconComp; color: string; isSurface?: true; }
const MASK_LAYERS: MaskLayerDef[] = [
  { id: "surface_murale", label: "Surface nette",            icon: Building2,      color: "#22c55e", isSurface: true },
  { id: "window",         label: "Fenêtres",                icon: AppWindow,      color: "#ff00ff" },
  { id: "door",           label: "Portes",                  icon: DoorOpen,       color: "#f472b6" },
  { id: "balcony",        label: "Balcons",                 icon: LayoutPanelTop, color: "#34d399" },
  { id: "column",         label: "Colonnes / Poteaux",      icon: Columns2,       color: "#94a3b8" },
  { id: "roof",           label: "Toiture",                 icon: Frame,          color: "#a78bfa" },
  { id: "floor_line",     label: "Séparations d'étage",     icon: Layers,         color: "#fb923c" },
  { id: "other",          label: "Fenêtres",                icon: AppWindow,      color: "#ff00ff" },
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
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);

  /* ── Mask editor: mutable local copy of elements — syncs when result changes (e.g. returning from editor) ── */
  const [localElements, setLocalElements] = useState<FacadeElement[]>(result.elements);
  useEffect(() => { setLocalElements(result.elements); }, [result.elements]);

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

  /* ── Sidebar stats (simplified) ── */
  // Count "other" as "window" since the model often misclassifies windows as "other"
  const windowCount = useMemo(() => (result.elements ?? []).filter(e => e.type === "window" || e.type === "other").length, [result]);
  const windowsAreaM2 = useMemo(() => (result.elements ?? []).filter(e => e.type === "window" || e.type === "other").reduce((s, e) => s + (e.area_m2 ?? 0), 0), [result]);
  const windowsPerimeterM = useMemo(() => (result.elements ?? []).filter(e => e.type === "window" || e.type === "other").reduce((s, e) => s + (e.perimeter_m ?? 0), 0), [result]);
  // Use delimited zones area if available, otherwise fall back to backend facade_area
  const facadeAreaM2 = totalFacadeZonesM2 > 0 ? totalFacadeZonesM2 : (result.facade_area_m2 ?? 0);
  const wallNetArea = Math.max(0, facadeAreaM2 - windowsAreaM2);

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

  const panRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);

  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 2 || e.altKey) {
      e.preventDefault();
      panRef.current = { startX: e.clientX, startY: e.clientY, startPanX: maskPan.x, startPanY: maskPan.y };
      setIsMaskPanning(true);
    }
  }, [maskPan]);

  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (!panRef.current) return;
    setMaskPan({
      x: panRef.current.startPanX + (e.clientX - panRef.current.startX),
      y: panRef.current.startPanY + (e.clientY - panRef.current.startY),
    });
  }, []);

  const handlePanEnd = useCallback(() => {
    panRef.current = null;
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
                {d("fr_facade" as DTKey)} {zs.idx + 1}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <AppWindow className="w-5 h-5 mx-auto text-amber-400 mb-1" />
                  <div className="text-xl font-mono font-bold text-amber-400">{zs.fenetresCount}</div>
                  <div className="text-xs text-slate-500">{d("fa_windows" as DTKey)}</div>
                  {zs.fenetresArea > 0 && (
                    <div className="text-xs text-amber-400/70 font-mono mt-0.5">{zs.fenetresArea.toFixed(1)} m²</div>
                  )}
                </div>
                <div className="text-center">
                  <Crop className="w-5 h-5 mx-auto text-slate-400 mb-1" />
                  <div className="text-xl font-mono font-bold text-slate-200">{zs.zoneArea.toFixed(0)} m²</div>
                  <div className="text-xs text-slate-500">{d("fr_delimited" as DTKey)}</div>
                </div>
                <div className="text-center">
                  <Building2 className="w-5 h-5 mx-auto text-blue-400 mb-1" />
                  <div className="text-xl font-mono font-bold text-blue-400">
                    {zs.nette != null ? `${zs.nette.toFixed(0)} m²` : "—"}
                  </div>
                  <div className="text-xs text-slate-500">{d("fr_net_surface" as DTKey)}</div>
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
            <div className="text-xs text-slate-500 mt-0.5">{d("fa_windows" as DTKey)}</div>
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
            <div className="text-xs text-slate-500 mt-0.5">{d("fr_delimited" as DTKey)}</div>
          </div>
          {/* Surface nette */}
          <div className="glass rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 text-center">
            <Building2 className="w-6 h-6 mx-auto text-blue-400" />
            <div className="text-2xl font-mono font-bold mt-1 text-blue-400">
              {facadeNetteM2 != null ? `${facadeNetteM2.toFixed(0)} m²` : "—"}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{d("fr_net_area" as DTKey)}</div>
          </div>
        </div>
      )}

      {/* ── Toolbar: back + edit masks + zoom ── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {onBack && (
          <button onClick={onBack}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all">
            <ChevronLeft className="w-4 h-4" /> {d("fr_back" as DTKey)}
          </button>
        )}
        {/* Mask filter: Tous | Murs | Ouvertures */}
        <div className="flex gap-1 glass rounded-lg border border-white/10 p-0.5">
          {([
            { id: "all" as MaskFilterMode, label: d("fr_filter_all" as DTKey) },
            { id: "walls" as MaskFilterMode, label: d("fr_filter_walls" as DTKey) },
            { id: "openings" as MaskFilterMode, label: d("fr_filter_openings" as DTKey) },
          ]).map(f => (
            <button key={f.id}
              onClick={() => setMaskFilter(f.id)}
              className={cn("px-3 py-1 rounded-md text-xs font-medium transition-all",
                maskFilter === f.id ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300")}>
              {f.label}
            </button>
          ))}
          <button onClick={() => { resetFacadeTutorial(); setShowTuto(v => !v); }} title={d("common_tutorial" as DTKey)}
            className="px-2 py-1 rounded-md text-xs font-medium text-slate-500 hover:text-white hover:bg-white/10 transition-all">
            ?
          </button>
        </div>
      </div>

      {/* ── Image panel (Masques view) ── */}
      <div className="glass rounded-2xl border border-white/10 p-2 mb-8 overflow-hidden">
        <FacadeTutorialOverlay forceShow={showTuto} />
        <div className="flex flex-col gap-4">

            {/* Summary bar — ABOVE image */}
            <div className="flex items-center gap-6 px-4 py-3 glass rounded-xl border border-white/10">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide shrink-0">Résumé façade</h4>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm" style={{ background: "#ff00ff" }} />
                <span className="text-xs text-slate-300">Fenêtres</span>
                <span className="text-sm text-white font-mono font-semibold">{windowCount}</span>
                {windowsAreaM2 > 0 && <span className="text-[10px] text-slate-500 font-mono">{windowsAreaM2.toFixed(1)} m²</span>}
                {windowsPerimeterM > 0 && <span className="text-[10px] text-slate-500 font-mono">P:{windowsPerimeterM.toFixed(1)}m</span>}
              </div>
              <div className="w-px h-5 bg-white/10" />
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm" style={{ background: "#22c55e" }} />
                <span className="text-xs text-slate-300">Surface nette</span>
                <span className="text-sm text-white font-mono font-semibold">{wallNetArea.toFixed(1)} m²</span>
              </div>
              <div className="w-px h-5 bg-white/10" />
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Surface totale</span>
                <span className="text-sm text-accent font-mono font-semibold">{facadeAreaM2.toFixed(1)} m²</span>
              </div>
              <div className="flex-1" />
              <button onClick={() => onGoEditor?.()}
                className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent/80 text-white rounded-lg text-xs font-semibold transition-colors">
                <PenSquare className="w-3.5 h-3.5" /> Éditer les masques
              </button>
            </div>

            {/* Canvas panel — FULL WIDTH */}
            <div
              ref={maskContainerRef}
              className="flex-1 rounded-xl border border-white/10 relative overflow-hidden"
              style={{
                background: "#0d1117",
                backgroundImage: "radial-gradient(circle, rgba(148,163,184,0.13) 1px, transparent 1px)",
                backgroundSize: "24px 24px",
                minHeight: "calc(100vh - 340px)",
                cursor: isMaskPanning ? "grabbing" : "default",
              }}
              onMouseDown={handlePanStart}
              onMouseMove={handlePanMove}
              onMouseUp={handlePanEnd}
              onMouseLeave={handlePanEnd}
              onContextMenu={e => e.preventDefault()}
            >
              {/* Centered + transformed image container */}
              <div style={{
                position: "absolute",
                top: "50%", left: "50%",
                transform: `translate(calc(-50% + ${maskPan.x}px), calc(-50% + ${maskPan.y}px)) scale(${maskZoom})`,
                transformOrigin: "center center",
              }}>
                <div className="relative">
                  <img
                    src={`data:image/png;base64,${result.plan_b64}`}
                    alt="Facade"
                    className="select-none"
                    style={{ display: "block", maxWidth: "calc(100vw - 300px)", maxHeight: "calc(100vh - 360px)" }}
                    draggable={false}
                    onLoad={e => {
                      const i = e.currentTarget;
                      setImgNat({ w: i.naturalWidth, h: i.naturalHeight });
                    }}
                  />

                  {/* Surface murale layer: static, evenodd path = ROI - opening holes */}
                  {!hiddenLayers.has("surface_murale") && imgNat.w > 0 && (maskFilter === "all" || maskFilter === "walls") && (
                    <svg className="absolute top-0 left-0 w-full h-full pointer-events-none"
                      viewBox={`0 0 ${imgNat.w} ${imgNat.h}`} preserveAspectRatio="xMinYMin meet">
                      {facadeZones.length > 0 && (
                        <defs><clipPath id="fz-clip-wall">
                          {facadeZones.map(z => (
                            <polygon key={z.id} points={z.pts.map(p => `${p.x * imgNat.w},${p.y * imgNat.h}`).join(" ")} />
                          ))}
                        </clipPath></defs>
                      )}
                      <g clipPath={facadeZones.length > 0 ? "url(#fz-clip-wall)" : undefined}>
                        <path d={wallSvgPath} fillRule="evenodd" fill="#22c55e" fillOpacity={0.55} />
                      </g>
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
                      {facadeZones.length > 0 && (
                        <defs><clipPath id="fz-clip-masks">
                          {facadeZones.map(z => (
                            <polygon key={z.id} points={z.pts.map(p => `${p.x * imgNat.w},${p.y * imgNat.h}`).join(" ")} />
                          ))}
                        </clipPath></defs>
                      )}
                      <g>
                      {filteredMaskLayers.filter(l => !l.isSurface && !hiddenLayers.has(l.id)).map(layer => {
                        const layerEls = localElements.filter(e => e.type === layer.id && !hiddenElements.has(e.id));
                        const isWindowLayer = layer.id === "window" || layer.id === "other";
                        const layerFillOpacity = isWindowLayer ? 0.55 : 0.42;
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
                                    fill={layer.color} fillOpacity={layerFillOpacity}
                                    stroke={layer.color} strokeWidth={1.5}
                                  />
                                );
                              }
                              const x = el.bbox_norm.x * imgNat.w, y = el.bbox_norm.y * imgNat.h;
                              const w = el.bbox_norm.w * imgNat.w, h = el.bbox_norm.h * imgNat.h;
                              return (
                                <rect key={el.id}
                                  x={x} y={y} width={w} height={h}
                                  fill={layer.color} fillOpacity={layerFillOpacity}
                                  stroke={layer.color} strokeWidth={1.5} rx="2"
                                />
                              );
                            })}
                          </g>
                        );
                      })}
                      </g>{/* end facade zone clip */}

                      {/* Facade polygon zones (read-only) */}
                      {facadeZones.map(zone => {
                        const ptStr = zone.pts.map(p => `${p.x * imgNat.w},${p.y * imgNat.h}`).join(" ");
                        return (
                          <g key={zone.id}>
                            <polygon points={ptStr}
                              fill="#22c55e" fillOpacity={0.2}
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
              </div>{/* /centered transform */}

              {/* Floating zoom controls */}
              <div className="absolute top-3 right-3 z-20 flex items-center gap-1 glass border border-white/10 rounded-lg p-1">
                <button onClick={() => setMaskZoom(z => Math.min(12, z * 1.3))}
                  className="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors" title="Zoom +">
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setMaskZoom(z => Math.max(0.3, z / 1.3))}
                  className="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors" title="Zoom −">
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-5 bg-white/10" />
                <button onClick={() => { setMaskZoom(1); setMaskPan({x:0,y:0}); }}
                  className="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors" title="Réinitialiser">
                  <RotateCcw className="w-3 h-3" />
                </button>
                {Math.abs(maskZoom - 1) > 0.05 && <span className="text-[9px] text-slate-500 font-mono pl-0.5">{maskZoom.toFixed(1)}x</span>}
              </div>

              {/* Demo badge */}
              {result.is_mock && (
                <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-md
                  bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-medium pointer-events-none">
                  <AlertTriangle className="w-3 h-3" /> {d("fr_demo" as DTKey)}
                </div>
              )}
            </div>{/* /canvas panel */}

          </div>{/* /flex col */}
      </div>

      {/* ── ITE & Retours de tableau ── */}
      <div className="mb-4">
        <FacadeIsolationPanel
          result={result}
          localElements={localElements}
          facadeAreaOverride={totalFacadeZonesM2 > 0 ? totalFacadeZonesM2 : null}
          imgSize={imgNat}
        />
        <div className="mt-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="font-medium">Rappel : Attention à la gestion des ponts thermiques</span>
        </div>
      </div>

      {/* ── Dashboard Overview ── */}
      <div className="mb-4">
        <FacadeDashboardPanel result={result} />
      </div>

      {/* ── Materials Estimation ── */}
      <div className="mb-4">
        <FacadeMaterialsPanel result={result} />
      </div>

      {/* ── Lots ── */}
      <div className="mb-4">
        <FacadeLotsPanel result={result} />
      </div>

      {/* ── Scenarios ── */}
      <div className="mb-4">
        <FacadeScenarioPanel result={result} />
      </div>

      {/* ── Compliance ── */}
      <div className="mb-4">
        <FacadeCompliancePanel result={result} />
      </div>

      {/* ══ Advanced Tools (collapsible) ══ */}
      <div className="glass rounded-2xl border border-white/10 overflow-hidden mb-4">
        <button
          type="button"
          onClick={() => setShowAdvancedTools(v => !v)}
          className="w-full px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Wrench className="w-5 h-5 text-sky-400" />
            <div className="text-left">
              <span className="font-display font-semibold text-white text-sm">Advanced Tools</span>
              <span className="block text-xs text-slate-400">Toolkit, DPGF, CCTP, Gantt, Per-floor</span>
            </div>
          </div>
          {showAdvancedTools
            ? <ChevronUp className="w-5 h-5 text-slate-400" />
            : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </button>
        {showAdvancedTools && (
          <div className="px-5 pb-5 pt-2 space-y-4">
            {/* Per-floor table */}
            {(() => {
              const floorMap = new Map<number, { windows: number; doors: number; balconies: number }>();
              for (const el of localElements) {
                const lvl = el.floor_level ?? 0;
                const f = floorMap.get(lvl) ?? { windows: 0, doors: 0, balconies: 0 };
                if (el.type === "window" || el.type === "other") f.windows++;
                else if (el.type === "door") f.doors++;
                else if (el.type === "balcony") f.balconies++;
                floorMap.set(lvl, f);
              }
              const floors = [...floorMap.entries()].sort((a, b) => a[0] - b[0]).map(([level, data]) => ({
                level, label: level === 0 ? "RDC" : `Étage ${level}`, ...data,
              }));
              if (floors.length <= 1) return null;
              return (
                <div className="glass rounded-xl border border-white/10 p-4">
                  <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                    <Building2 className="w-4 h-4" /> {d("fa_per_floor" as DTKey)}
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-500 text-xs border-b border-white/5">
                          <th className="text-left py-2 px-3 font-medium">{d("fa_floor_level" as DTKey)}</th>
                          <th className="text-center py-2 px-3 font-medium"><AppWindow className="w-3.5 h-3.5 text-amber-400 inline" /></th>
                          <th className="text-center py-2 px-3 font-medium"><DoorOpen className="w-3.5 h-3.5 text-pink-400 inline" /></th>
                          <th className="text-center py-2 px-3 font-medium"><LayoutPanelTop className="w-3.5 h-3.5 text-emerald-400 inline" /></th>
                        </tr>
                      </thead>
                      <tbody>
                        {floors.map(f => (
                          <tr key={f.level} className="border-b border-white/5 hover:bg-white/[0.02]">
                            <td className="py-2 px-3 text-white font-medium">{f.label}</td>
                            <td className="py-2 px-3 text-center text-amber-400 font-mono">{f.windows}</td>
                            <td className="py-2 px-3 text-center text-pink-400 font-mono">{f.doors}</td>
                            <td className="py-2 px-3 text-center text-emerald-400 font-mono">{f.balconies}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* Toolkit */}
            <FacadeToolkitPanel result={result} />

            {/* DPGF */}
            <FacadeDpgfPanel result={result} />

            {/* CCTP */}
            <FacadeCctpPanel result={result} />

            {/* Gantt */}
            <FacadeGanttPanel result={result} />
          </div>
        )}
      </div>

      {/* ── 3D Facade View ── */}
      <div className="mb-4">
        <Facade3dPanel result={result} facadeZones={facadeZones} />
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
