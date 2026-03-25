"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight, RotateCcw, Download, Eye, EyeOff,
  AlertTriangle, Building2, AppWindow, DoorOpen, Layers,
  LayoutPanelTop, Columns2, Frame, Box, HelpCircle, Trash2,
  SquareDashedBottom,
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

/* ── Small number input ── */
function NumInput({
  value, onChange, min = 0, step = 0.5,
}: { value: number; onChange: (v: number) => void; min?: number; step?: number }) {
  return (
    <input
      type="number" min={min} step={step} value={value}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="w-16 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-center text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-400/50"
    />
  );
}

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
  { id: "surface_murale", label: "Surface murale", icon: Building2,      color: "#64748b", isSurface: true },
  { id: "window",         label: "Fenêtres",        icon: AppWindow,      color: "#60a5fa" },
  { id: "door",           label: "Portes",           icon: DoorOpen,       color: "#f472b6" },
  { id: "balcony",        label: "Balcons",          icon: LayoutPanelTop, color: "#34d399" },
  { id: "column",         label: "Colonnes",         icon: Columns2,       color: "#94a3b8" },
  { id: "roof",           label: "Toit",             icon: Frame,          color: "#a78bfa" },
  { id: "floor_line",     label: "Lignes d'étage",   icon: Layers,         color: "#fb923c" },
  { id: "other",          label: "Autres",           icon: HelpCircle,     color: "#fbbf24" },
];

interface FacadeResultsStepProps {
  result: FacadeAnalysisResult;
  onGoEditor: () => void;
  onRestart: () => void;
}

export default function FacadeResultsStep({ result, onGoEditor, onRestart }: FacadeResultsStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  /* ── Dialog modals ── */
  const [showRapport, setShowRapport] = useState(false);
  const [showDevis, setShowDevis] = useState(false);

  /* ── View tab ── */
  const [viewTab, setViewTab] = useState<"ia" | "svg" | "masks">(() =>
    result.is_mock ? "svg" : "ia"
  );

  /* ── SVG tab: per-type visibility toggles ── */
  const presentTypes = [...new Set(result.elements.map(e => e.type))];
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

  /* ── Surface murale SVG path (ROI rect − opening holes, evenodd) ── */
  const wallSvgPath = useMemo(() => {
    const roi = result.building_roi ?? { x: 0, y: 0, w: 1, h: 1 };
    const W = imgNat.w, H = imgNat.h;
    const rx = roi.x * W, ry = roi.y * H, rw = roi.w * W, rh = roi.h * H;
    // Outer rectangle (clockwise winding)
    let p = `M${rx} ${ry} h${rw} v${rh} h${-rw} Z`;
    // Overlap with opening rects → evenodd cancels those pixels (= holes)
    result.elements
      .filter(e => ["window", "door", "balcony"].includes(e.type) && !hiddenElements.has(e.id))
      .forEach(e => {
        const x = e.bbox_norm.x * W, y = e.bbox_norm.y * H;
        const w = e.bbox_norm.w * W, h = e.bbox_norm.h * H;
        p += ` M${x} ${y} h${w} v${h} h${-w} Z`;
      });
    return p;
  }, [result, hiddenElements, imgNat]);

  /* ── Surface murale area (live, excludes hidden elements) ── */
  const wallAreaM2 = useMemo(() => {
    if (!result.facade_area_m2) return null;
    const openings = result.elements
      .filter(e => ["window", "door", "balcony"].includes(e.type) && !hiddenElements.has(e.id))
      .reduce((s, e) => s + (e.area_m2 ?? 0), 0);
    return Math.max(0, result.facade_area_m2 - openings);
  }, [result, hiddenElements]);

  /* ── Seed imgNat from plan_b64 ── */
  useEffect(() => {
    if (!result.plan_b64) return;
    const img = new Image();
    img.onload = () => setImgNat({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = `data:image/png;base64,${result.plan_b64}`;
  }, [result.plan_b64]);

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

  /* ── Isolation façade ── */
  const [isoFacadeEpaisseur, setIsoFacadeEpaisseur] = useState(12); // cm

  /* ── Isolation retours de fenêtres: largeurs + épaisseurs (cm) ── */
  const [largTableau, setLargTableau] = useState(8);
  const [largLinteau, setLargLinteau] = useState(5);
  const [largAppui,   setLargAppui]   = useState(2);
  const [epTableau,   setEpTableau]   = useState(3);
  const [epLinteau,   setEpLinteau]   = useState(3);
  const [epAppui,     setEpAppui]     = useState(3);

  /* ── Derived: per-floor breakdown ── */
  const floorLevels = [...new Set(result.elements.map(e => e.floor_level ?? 0))].sort((a, b) => b - a);
  const floorData = floorLevels.map(level => {
    const els = result.elements.filter(e => (e.floor_level ?? 0) === level);
    return {
      level,
      label:     level === 0 ? d("fa_rdc") : `${d("fa_floor_level")} ${level}`,
      windows:   els.filter(e => e.type === "window").length,
      doors:     els.filter(e => e.type === "door").length,
      balconies: els.filter(e => e.type === "balcony").length,
    };
  });

  const visibleElements = result.elements.filter(e => !hiddenTypes.has(e.type));

  /* ── CSV export ── */
  const exportCSV = () => {
    const BOM = "\uFEFF";
    const header = `${d("fa_element")};${d("fa_type")};${d("fa_floor_level")};X;Y;W;H;${d("fa_facade_area")} (m²)`;
    const rows = result.elements.map(e =>
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

  /* ── Isolation: computed ── */
  const ppm = result.pixels_per_meter;
  const hasPpm = ppm != null && ppm > 0;

  const openings = result.elements.filter(e => e.type === "window" || e.type === "door");

  const retourRows = useMemo(() => {
    if (!hasPpm) return [];
    return openings.map((el, idx) => {
      const W_m = el.bbox_norm.w * imgNat.w / ppm!;
      const H_m = el.bbox_norm.h * imgNat.h / ppm!;
      const lonLinteau = W_m;
      const lonAppui   = W_m;
      const lonTableau = H_m * 2;
      const surfLinteau = lonLinteau * (largLinteau / 100);
      const surfAppui   = lonAppui   * (largAppui   / 100);
      const surfTableau = lonTableau * (largTableau  / 100);
      return {
        idx: idx + 1, el, W_m, H_m,
        lonLinteau, lonAppui, lonTableau,
        surfLinteau, surfAppui, surfTableau,
        totalSurf: surfLinteau + surfAppui + surfTableau,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openings.length, imgNat.w, imgNat.h, ppm, largLinteau, largAppui, largTableau]);

  const totalLonLinteau  = retourRows.reduce((s, r) => s + r.lonLinteau,  0);
  const totalLonAppui    = retourRows.reduce((s, r) => s + r.lonAppui,    0);
  const totalLonTableau  = retourRows.reduce((s, r) => s + r.lonTableau,  0);
  const totalSurfLinteau = retourRows.reduce((s, r) => s + r.surfLinteau, 0);
  const totalSurfAppui   = retourRows.reduce((s, r) => s + r.surfAppui,   0);
  const totalSurfTableau = retourRows.reduce((s, r) => s + r.surfTableau, 0);
  const totalSurfRetours = totalSurfLinteau + totalSurfAppui + totalSurfTableau;

  const surfFacade     = result.facade_area_m2;
  const surfOuvertures = result.openings_area_m2;
  const surfMurNet     = surfFacade != null && surfOuvertures != null ? surfFacade - surfOuvertures : null;
  const volumeIsoFacade = surfMurNet != null ? surfMurNet * (isoFacadeEpaisseur / 100) : null;

  /* ── CSV retours de fenêtres ── */
  const exportCSVRetours = () => {
    if (!hasPpm || retourRows.length === 0) return;
    const BOM = "\uFEFF";
    const cols = [
      d("fa_ret_opening_id"), d("fa_type"), d("fa_floor_level"),
      d("fa_ret_w"), d("fa_ret_h"),
      `${d("fa_ret_longueur")} Linteau`, `${d("fa_ret_surface")} Linteau`,
      `${d("fa_ret_longueur")} Appui`,   `${d("fa_ret_surface")} Appui`,
      `${d("fa_ret_longueur")} Tableau`, `${d("fa_ret_surface")} Tableau`,
      `${d("fa_ret_surface")} Total`,
    ];
    const rows = retourRows.map(r => [
      r.idx, d(TYPE_I18N[r.el.type] ?? "fa_other"), r.el.floor_level ?? 0,
      r.W_m.toFixed(2), r.H_m.toFixed(2),
      r.lonLinteau.toFixed(2), r.surfLinteau.toFixed(3),
      r.lonAppui.toFixed(2),   r.surfAppui.toFixed(3),
      r.lonTableau.toFixed(2), r.surfTableau.toFixed(3),
      r.totalSurf.toFixed(3),
    ].join(";"));
    const recap = [
      ";;;;;;;;;;;",
      `${d("fa_ret_recap")};;;;;;;;;;`,
      `Linteau;;;${totalLonLinteau.toFixed(2)};;;${totalSurfLinteau.toFixed(3)}`,
      `Appui;;;${totalLonAppui.toFixed(2)};;;${totalSurfAppui.toFixed(3)}`,
      `Tableau;;;${totalLonTableau.toFixed(2)};;;${totalSurfTableau.toFixed(3)}`,
      `${d("fa_ret_total")};;;;;;;;;;;${totalSurfRetours.toFixed(3)}`,
    ];
    const csv = BOM + [cols.join(";"), ...rows, ...recap].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "isolation_retours_fenetres.csv"; a.click();
    URL.revokeObjectURL(url);
    toast({ title: d("fa_ret_export"), variant: "success" });
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
                <AlertTriangle className="w-3 h-3" /> Démo — positions simulées
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
          <div className="flex flex-col lg:flex-row gap-3">

            {/* Left: base image + SVG mask overlays */}
            <div className="relative flex-1 min-w-0">
              <img
                src={`data:image/png;base64,${result.plan_b64}`}
                alt="Facade plan" className="w-full rounded-xl"
                onLoad={e => {
                  const i = e.currentTarget;
                  setImgNat({ w: i.naturalWidth, h: i.naturalHeight });
                }}
              />

              {/* Surface murale layer: static, evenodd path = ROI − opening holes */}
              {!hiddenLayers.has("surface_murale") && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none"
                  viewBox={`0 0 ${imgNat.w} ${imgNat.h}`} preserveAspectRatio="xMidYMid meet">
                  <path d={wallSvgPath} fillRule="evenodd" fill="#64748b" fillOpacity={0.35} />
                </svg>
              )}

              {/* Per-type mask layers: interactive (click to select) */}
              <svg className="absolute inset-0 w-full h-full"
                viewBox={`0 0 ${imgNat.w} ${imgNat.h}`} preserveAspectRatio="xMidYMid meet">

                {MASK_LAYERS.filter(l => !l.isSurface && !hiddenLayers.has(l.id)).map(layer => {
                  const layerEls = result.elements.filter(
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
                              onClick={() => setSelectedEl(sel ? null : el.id)}
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
                            className="cursor-pointer"
                            onClick={() => setSelectedEl(sel ? null : el.id)}
                          />
                        );
                      })}
                    </g>
                  );
                })}

                {/* White dashed outline on selected element */}
                {selectedEl !== null && (() => {
                  const el = result.elements.find(e => e.id === selectedEl);
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
              </svg>

              {/* Action bar for selected element */}
              {selectedEl !== null && (() => {
                const el = result.elements.find(e => e.id === selectedEl);
                if (!el) return null;
                const Icon  = getIcon(el.type);
                const color = getColor(el.type);
                return (
                  <div className="absolute bottom-2 left-2 right-2 z-20 flex items-center justify-between
                    bg-black/80 backdrop-blur-sm rounded-lg px-3 py-2 text-xs border border-white/10">
                    {/* Info */}
                    <span className="flex items-center gap-1.5 text-slate-300 min-w-0">
                      <Icon className="w-3 h-3 shrink-0" style={{ color }} />
                      <span className="truncate" style={{ color }}>{d(TYPE_I18N[el.type] ?? "fa_other")}</span>
                      {el.confidence != null && (
                        <span className="text-slate-500 shrink-0">{(el.confidence * 100).toFixed(0)}%</span>
                      )}
                      {el.area_m2 != null && (
                        <span className="text-slate-500 shrink-0 hidden sm:inline">· {el.area_m2.toFixed(2)} m²</span>
                      )}
                    </span>
                    {/* Actions */}
                    <div className="flex items-center gap-2 ml-2 shrink-0">
                      <span className="text-slate-600 hidden sm:inline">⌫</span>
                      <button
                        onClick={() => {
                          setHiddenElements(prev => new Set([...prev, selectedEl!]));
                          setSelectedEl(null);
                        }}
                        className="flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors
                          px-2 py-0.5 rounded border border-red-500/30 hover:border-red-400/50">
                        <Trash2 className="w-3 h-3" /> Retirer
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
                  <AlertTriangle className="w-3 h-3" /> Démo — positions simulées
                </div>
              )}
            </div>

            {/* Right: layer panel */}
            <div className="lg:w-56 shrink-0 glass rounded-xl border border-white/10 p-3 flex flex-col gap-3">

              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Couches</div>

              <div className="space-y-0.5">
                {MASK_LAYERS.map(layer => {
                  const hasAny = layer.isSurface || result.elements.some(e => e.type === layer.id);
                  if (!hasAny) return null;

                  const totalCount   = layer.isSurface ? undefined : result.elements.filter(e => e.type === layer.id).length;
                  const activeCount  = layer.isSurface ? undefined : result.elements.filter(e => e.type === layer.id && !hiddenElements.has(e.id)).length;
                  const removedCount = (totalCount ?? 0) - (activeCount ?? 0);
                  const layerHidden  = hiddenLayers.has(layer.id);
                  const Icon = layer.icon;

                  return (
                    <button key={layer.id}
                      onClick={() => {
                        setHiddenLayers(prev => {
                          const n = new Set(prev);
                          if (!n.has(layer.id)) {
                            n.add(layer.id);
                            // Deselect if selected element belongs to this layer
                            if (selectedEl !== null) {
                              const sel = result.elements.find(e => e.id === selectedEl);
                              if (sel?.type === layer.id) setSelectedEl(null);
                            }
                          } else { n.delete(layer.id); }
                          return n;
                        });
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all hover:bg-white/5",
                        layerHidden ? "opacity-40" : "opacity-100"
                      )}>
                      <div className="w-3 h-3 rounded-sm shrink-0"
                        style={{ background: layer.color, opacity: 0.75 }} />
                      <Icon className="w-3 h-3 shrink-0" style={{ color: layer.color }} />
                      <span className="flex-1 text-left text-slate-300 truncate">{layer.label}</span>
                      {activeCount != null && (
                        <span className="font-mono text-slate-500 shrink-0 text-[10px]">
                          {removedCount > 0 ? `${activeCount}/${totalCount}` : activeCount}
                        </span>
                      )}
                      {layerHidden
                        ? <EyeOff className="w-3 h-3 shrink-0 text-slate-600" />
                        : <Eye    className="w-3 h-3 shrink-0 text-slate-400" />}
                    </button>
                  );
                })}
              </div>

              {/* Surface murale stats */}
              {!hiddenLayers.has("surface_murale") && (
                <div className="border-t border-white/5 pt-3 space-y-1">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Surface murale</div>
                  <div className="text-sm font-mono font-semibold text-slate-200">
                    {wallAreaM2 != null ? `${wallAreaM2.toFixed(1)} m²` : "—"}
                  </div>
                  {result.facade_area_m2 && wallAreaM2 != null && (
                    <div className="text-xs text-slate-500">
                      {((wallAreaM2 / result.facade_area_m2) * 100).toFixed(0)}% de la façade
                    </div>
                  )}
                </div>
              )}

              {/* Restore removed elements */}
              {hiddenElements.size > 0 && (
                <button
                  onClick={() => { setHiddenElements(new Set()); setSelectedEl(null); }}
                  className="mt-auto flex items-center justify-center gap-1.5 text-xs text-slate-500
                    hover:text-slate-300 transition-colors py-1.5 rounded-lg border border-white/5
                    hover:border-white/10">
                  <RotateCcw className="w-3 h-3" /> Restaurer ({hiddenElements.size})
                </button>
              )}
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
        <FacadeIsolationPanel result={result} />
      </div>

      {/* ── Dashboard Overview ── */}
      <div className="mb-4">
        <FacadeDashboardPanel result={result} />
      </div>

      {/* ── Métré (surfaces) ── */}
      <div className="mb-4">
        <FacadeMetrePanel result={result} />
      </div>

      {/* ── Isolation façade ── */}
      <div className="glass rounded-2xl border border-amber-500/20 p-6 mb-4">
        <h3 className="font-display text-lg font-700 text-white mb-5 flex items-center gap-2">
          <Layers className="w-5 h-5 text-amber-400" />
          {d("fa_iso_facade_title")}
        </h3>
        {surfMurNet == null ? (
          <p className="text-sm text-slate-500">{d("fa_iso_no_area")}</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
              <div className="glass rounded-xl border border-white/5 p-4 text-center">
                <div className="text-xs text-slate-500 mb-1">{d("fa_facade_area")}</div>
                <div className="text-xl font-display font-700 text-white">{surfFacade!.toFixed(1)} m²</div>
              </div>
              <div className="glass rounded-xl border border-white/5 p-4 text-center">
                <div className="text-xs text-slate-500 mb-1">{d("fa_openings_area")}</div>
                <div className="text-xl font-display font-700 text-blue-400">
                  {surfOuvertures!.toFixed(1)} m²
                  {result.ratio_openings != null && (
                    <span className="text-sm text-slate-500 ml-1">({(result.ratio_openings * 100).toFixed(0)}%)</span>
                  )}
                </div>
              </div>
              <div className="glass rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-center">
                <div className="text-xs text-amber-400/70 mb-1">{d("fa_iso_facade_net")}</div>
                <div className="text-xl font-display font-700 text-amber-300">{surfMurNet.toFixed(1)} m²</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400">{d("fa_iso_facade_epaisseur")}</span>
                <NumInput value={isoFacadeEpaisseur} onChange={setIsoFacadeEpaisseur} min={1} step={1} />
              </div>
              {volumeIsoFacade != null && (
                <div className="glass rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-2 flex items-center gap-2">
                  <span className="text-xs text-slate-500">{d("fa_iso_facade_volume")}</span>
                  <span className="text-base font-display font-700 text-amber-300">{volumeIsoFacade.toFixed(2)} m³</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Isolation retours de fenêtres ── */}
      <div className="glass rounded-2xl border border-blue-500/20 p-6 mb-4">
        <h3 className="font-display text-lg font-700 text-white mb-5 flex items-center gap-2">
          <SquareDashedBottom className="w-5 h-5 text-blue-400" />
          {d("fa_ret_title")}
        </h3>
        {!hasPpm ? (
          <div className="flex items-center gap-2 text-sm text-amber-400/80">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {d("fa_ret_no_ppm")}
          </div>
        ) : (
          <>
            {/* 6 inputs: 2 rows × 3 cols */}
            <div className="overflow-x-auto mb-6">
              <table className="text-sm">
                <thead>
                  <tr className="text-slate-400 text-xs">
                    <th className="text-left pr-6 py-1 font-medium w-48"></th>
                    <th className="text-center px-3 py-1 font-medium text-blue-300">{d("fa_ret_tableau")}</th>
                    <th className="text-center px-3 py-1 font-medium text-pink-300">{d("fa_ret_linteau")}</th>
                    <th className="text-center px-3 py-1 font-medium text-emerald-300">{d("fa_ret_appui")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="pr-6 py-2 text-slate-400 text-xs">{d("fa_ret_largeur")}</td>
                    <td className="px-3 py-2 text-center"><NumInput value={largTableau} onChange={setLargTableau} /></td>
                    <td className="px-3 py-2 text-center"><NumInput value={largLinteau} onChange={setLargLinteau} /></td>
                    <td className="px-3 py-2 text-center"><NumInput value={largAppui}   onChange={setLargAppui}   /></td>
                  </tr>
                  <tr>
                    <td className="pr-6 py-2 text-slate-400 text-xs">{d("fa_ret_epaisseur")}</td>
                    <td className="px-3 py-2 text-center"><NumInput value={epTableau}   onChange={setEpTableau}   /></td>
                    <td className="px-3 py-2 text-center"><NumInput value={epLinteau}   onChange={setEpLinteau}   /></td>
                    <td className="px-3 py-2 text-center"><NumInput value={epAppui}     onChange={setEpAppui}     /></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {openings.length === 0 ? (
              <p className="text-sm text-slate-500 mb-4">Aucune ouverture détectée.</p>
            ) : (
              <>
                {/* Per-opening detail */}
                <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
                  {d("fa_ret_per_opening")}
                </h4>
                <div className="overflow-x-auto mb-6 rounded-xl border border-white/5">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="bg-white/3 text-slate-500 border-b border-white/5">
                        <th className="text-center py-2 px-2">{d("fa_ret_opening_id")}</th>
                        <th className="text-left   py-2 px-2">{d("fa_type")}</th>
                        <th className="text-center py-2 px-2">{d("fa_floor_level")}</th>
                        <th className="text-center py-2 px-2">{d("fa_ret_w")}</th>
                        <th className="text-center py-2 px-2">{d("fa_ret_h")}</th>
                        <th className="text-center py-2 px-2 text-pink-400/60">L.Lin (m)</th>
                        <th className="text-center py-2 px-2 text-pink-400/60">S.Lin (m²)</th>
                        <th className="text-center py-2 px-2 text-emerald-400/60">L.App (m)</th>
                        <th className="text-center py-2 px-2 text-emerald-400/60">S.App (m²)</th>
                        <th className="text-center py-2 px-2 text-blue-400/60">L.Tab (m)</th>
                        <th className="text-center py-2 px-2 text-blue-400/60">S.Tab (m²)</th>
                        <th className="text-center py-2 px-2 text-amber-400/80">Total (m²)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {retourRows.map(r => (
                        <tr key={r.el.id} className="border-b border-white/5 hover:bg-white/2">
                          <td className="text-center py-1.5 px-2 text-slate-400">{r.idx}</td>
                          <td className="text-left   py-1.5 px-2" style={{ color: getColor(r.el.type) }}>
                            {d(TYPE_I18N[r.el.type] ?? "fa_other")}
                          </td>
                          <td className="text-center py-1.5 px-2 text-slate-400">
                            {r.el.floor_level === 0 ? d("fa_rdc") : r.el.floor_level}
                          </td>
                          <td className="text-center py-1.5 px-2 text-white">{r.W_m.toFixed(2)}</td>
                          <td className="text-center py-1.5 px-2 text-white">{r.H_m.toFixed(2)}</td>
                          <td className="text-center py-1.5 px-2 text-pink-300">{r.lonLinteau.toFixed(2)}</td>
                          <td className="text-center py-1.5 px-2 text-pink-300">{r.surfLinteau.toFixed(3)}</td>
                          <td className="text-center py-1.5 px-2 text-emerald-300">{r.lonAppui.toFixed(2)}</td>
                          <td className="text-center py-1.5 px-2 text-emerald-300">{r.surfAppui.toFixed(3)}</td>
                          <td className="text-center py-1.5 px-2 text-blue-300">{r.lonTableau.toFixed(2)}</td>
                          <td className="text-center py-1.5 px-2 text-blue-300">{r.surfTableau.toFixed(3)}</td>
                          <td className="text-center py-1.5 px-2 text-amber-300 font-semibold">{r.totalSurf.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Global recap */}
                <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">
                  {d("fa_ret_recap")}
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  {[
                    { label: d("fa_ret_linteau"), lon: totalLonLinteau, surf: totalSurfLinteau, color: "text-pink-300",    border: "border-pink-400/20" },
                    { label: d("fa_ret_appui"),   lon: totalLonAppui,   surf: totalSurfAppui,   color: "text-emerald-300", border: "border-emerald-400/20" },
                    { label: d("fa_ret_tableau"), lon: totalLonTableau, surf: totalSurfTableau, color: "text-blue-300",   border: "border-blue-400/20" },
                  ].map(({ label, lon, surf, color, border }) => (
                    <div key={label} className={cn("glass rounded-xl border p-3 text-center", border)}>
                      <div className="text-xs text-slate-500 mb-1">{label}</div>
                      <div className={cn("text-sm font-display font-700", color)}>{lon.toFixed(2)} ml</div>
                      <div className="text-xs text-slate-400 mt-0.5">{surf.toFixed(3)} m²</div>
                    </div>
                  ))}
                  <div className="glass rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-center">
                    <div className="text-xs text-amber-400/70 mb-1">{d("fa_ret_total")}</div>
                    <div className="text-lg font-display font-700 text-amber-300">{totalSurfRetours.toFixed(2)} m²</div>
                  </div>
                </div>

                <Button variant="outline" size="sm" onClick={exportCSVRetours} className="text-xs">
                  <Download className="w-3 h-3" /> {d("fa_ret_export")}
                </Button>
              </>
            )}
          </>
        )}
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
          <FileText className="w-4 h-4" /> Rapport
        </Button>
        <Button variant="outline" onClick={() => setShowDevis(true)}>
          <Receipt className="w-4 h-4" /> Devis
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
