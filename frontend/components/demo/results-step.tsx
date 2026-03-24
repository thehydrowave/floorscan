"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Download, Edit3, RotateCcw, Loader2, Table2, Printer, Search, Ruler, FileDown, ChevronDown, ChevronRight, Eye, EyeOff, Layers, DoorOpen, AppWindow, Home, ArrowLeftRight, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalysisResult, CustomDetection, ComparisonResult } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { useAuth } from "@/lib/use-auth";
import MaterialsPanel from "@/components/demo/materials-panel";
import DpgfPanel from "@/components/demo/dpgf-panel";
import CctpPanel from "@/components/demo/cctp-panel";
import GanttPanel from "@/components/demo/gantt-panel";
import CompliancePanel from "@/components/demo/compliance-panel";
import DebugPanel from "@/components/demo/debug-panel";
import ComparisonPanel from "@/components/demo/comparison-panel";
import View3dPanel from "@/components/demo/view-3d-panel";
import ScenarioPanel from "@/components/demo/scenario-panel";
import PatternPanel from "@/components/demo/pattern-panel";
import ToolkitPanel from "@/components/demo/toolkit-panel";
import LotsPanel from "@/components/demo/lots-panel";
import DashboardPanel from "@/components/demo/dashboard-panel";
import MeasureTool from "@/components/demo/measure-tool";
import RapportDialog from "@/components/demo/rapport-dialog";
import OcrPanel from "@/components/demo/ocr-panel";
import HousingPanel from "@/components/demo/housing-panel";

import { BACKEND } from "@/lib/backend";
import { getRoomColor } from "@/lib/room-colors";

interface ResultsStepProps {
  result: AnalysisResult;
  customDetections?: CustomDetection[];
  onDetectionsChange?: (dets: CustomDetection[]) => void;
  onGoEditor: () => void;
  onRestart: () => void;
  // Multi-page support
  pageCount?: number;
  currentPage?: number;
  onSwitchPage?: (page: number) => void;
  analyzedPages?: number[];
  onAddPage?: () => void;
}

function fmt(v: number | undefined, nd = 1, suffix = "") {
  if (v === undefined || v === null) return "—";
  return v.toFixed(nd) + suffix;
}

// ROOM_COLORS & getRoomColor imported from @/lib/room-colors

export default function ResultsStep({ result, customDetections = [], onDetectionsChange, onGoEditor, onRestart, pageCount, currentPage, onSwitchPage, analyzedPages, onAddPage }: ResultsStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const { isAdmin } = useAuth();

  // ── Mask overlays (stackable, like editor) ──
  const [showDoors, setShowDoors] = useState(true);
  const [showWindows, setShowWindows] = useState(true);
  const [showFrenchDoors, setShowFrenchDoors] = useState(true);
  const [showWalls, setShowWalls] = useState(false);
  const [showCloisons, setShowCloisons] = useState(false);
  const [showInterior, setShowInterior] = useState(false);
  // ── SVG data overlays (independent toggles) ──
  const [showRoomsOverlay, setShowRoomsOverlay] = useState(false);
  const [showDetectionsOverlay, setShowDetectionsOverlay] = useState(false);
  // ── Multi-model comparison (admin only) ──
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [comparingModels, setComparingModels] = useState(false);
  // ── Image natural dimensions for SVG viewBox ──
  const [imgNatural, setImgNatural] = useState({ w: 1, h: 1 });

  const [exportingPdf, setExportingPdf] = useState(false);
  const [measureActive, setMeasureActive] = useState(false);
  const [rapportOpen, setRapportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [recapOpen, setRecapOpen] = useState(false);
  // ── Advanced tools accordion (closed by default) ──
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const basePlanB64 = (result.plan_b64 || result.overlay_openings_b64) as string;
  const baseImageB64 = showInterior && result.overlay_interior_b64
    ? result.overlay_interior_b64
    : basePlanB64;
  const hasBaseImage = !!baseImageB64;

  const hasRooms = (result.rooms ?? []).length > 0;
  const hasDetections = customDetections.length > 0;

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      const r = await fetch(`${BACKEND}/export-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: result.session_id }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? "Erreur export");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "floorscan_rapport.pdf";
      a.click(); URL.revokeObjectURL(url);
      toast({ title: d("re_pdf_ok"), variant: "success" });
    } catch (e: any) {
      toast({ title: d("re_pdf_err"), description: e.message, variant: "error" });
    } finally {
      setExportingPdf(false);
    }
  };

  /** Export CSV des résultats IA */
  const handleExportCSV = () => {
    const sf = result.surfaces ?? {};

    const lines = [
      "FloorScan — Résultats d'analyse IA",
      `Date;${new Date().toLocaleDateString("fr-FR")}`,
      `Session;${result.session_id ?? "—"}`,
      "",
      "=== ÉLÉMENTS DÉTECTÉS ===",
      `Portes;${result.doors_count}`,
      `Fenêtres;${result.windows_count}`,
      ...(result.french_doors_count ? [`Portes-fenêtres;${result.french_doors_count}`] : []),
      "",
      "=== SURFACES ===",
      `Emprise bâtiment (m²);${sf.area_building_m2?.toFixed(2) ?? "—"}`,
      `Périmètre bâtiment (m);${sf.perim_building_m?.toFixed(2) ?? "—"}`,
      `Surface habitable (m²);${sf.area_hab_m2?.toFixed(2) ?? "—"}`,
      `Périmètre intérieur (m);${sf.perim_interior_m?.toFixed(2) ?? "—"}`,
      `Surface murs (m²);${sf.area_walls_m2?.toFixed(2) ?? "—"}`,
      `Pixels/mètre;${result.pixels_per_meter?.toFixed(2) ?? "—"}`,
      "",
      "=== OUVERTURES DÉTAILLÉES ===",
      "Type;Longueur (m)",
      ...(result.openings?.map(o => `${o.class === "door" ? "Porte" : "Fenêtre"};${o.length_m?.toFixed(2) ?? "—"}`) ?? []),
    ];

    if (result.rooms && result.rooms.length > 0) {
      lines.push("");
      lines.push("=== PIÈCES DÉTECTÉES ===");
      lines.push("Type;Pièce;Surface (m²);Périmètre (m)");
      result.rooms.forEach(r => {
        lines.push(`${r.type};${r.label_fr};${r.area_m2?.toFixed(2) ?? "—"};${r.perimeter_m?.toFixed(2) ?? "—"}`);
      });
    }

    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `floorscan_analyse_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: d("re_csv_ok"), variant: "success" });
  };

  /** Export CSV des pièces uniquement */
  const handleExportRoomsCSV = () => {
    if (!result.rooms || result.rooms.length === 0) return;
    const lines = [
      "FloorScan — Récapitulatif des pièces",
      `Date;${new Date().toLocaleDateString("fr-FR")}`,
      "",
      "Type;Pièce;Surface (m²);Périmètre (m)",
      ...result.rooms.map(r =>
        `${r.type};${r.label_fr};${r.area_m2?.toFixed(2) ?? "—"};${r.perimeter_m?.toFixed(2) ?? "—"}`
      ),
      "",
      `Total;;${result.rooms.reduce((s, r) => s + (r.area_m2 ?? 0), 0).toFixed(2)};${result.rooms.reduce((s, r) => s + (r.perimeter_m ?? 0), 0).toFixed(2)}`,
    ];
    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `floorscan_pieces_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: d("re_csv_ok"), variant: "success" });
  };

  // Group rooms by type for recap table
  const roomsByType = (result.rooms ?? []).reduce<Record<string, typeof result.rooms>>((acc, room) => {
    const key = room.type || "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key]!.push(room);
    return acc;
  }, {});
  const totalRooms = (result.rooms ?? []).length;
  const totalArea = (result.rooms ?? []).reduce((s, r) => s + (r.area_m2 ?? 0), 0).toFixed(2);
  const totalPerim = (result.rooms ?? []).reduce((s, r) => s + (r.perimeter_m ?? 0), 0).toFixed(2);

  const sf = result.surfaces ?? {};

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-xs font-mono text-accent uppercase tracking-widest mb-1">{d("re_step")}</p>
          <h2 className="font-display text-2xl font-700 text-white">{d("re_title")}</h2>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Export dropdown */}
          <div className="relative">
            <Button onClick={() => setExportOpen(v => !v)} variant="outline">
              <Download className="w-4 h-4" /> Export <ChevronDown className="w-3 h-3 ml-1" />
            </Button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-40 bg-slate-900 border border-white/10 rounded-lg shadow-xl py-1 min-w-[180px]">
                  <button onClick={() => { handleExportCSV(); setExportOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors">
                    <Table2 className="w-4 h-4" /> CSV
                  </button>
                  <button onClick={() => { window.print(); setExportOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors">
                    <Printer className="w-4 h-4" /> {d("btn_print")}
                  </button>
                  <button onClick={() => { setRapportOpen(true); setExportOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors">
                    <FileDown className="w-4 h-4" /> {d("rap_btn" as DTKey)}
                  </button>
                  <button onClick={() => { handleExportPdf(); setExportOpen(false); }} disabled={exportingPdf} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors disabled:opacity-50">
                    {exportingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} {d("re_pdf")}
                  </button>
                </div>
              </>
            )}
          </div>
          <Button
            onClick={() => setMeasureActive(v => !v)}
            variant={measureActive ? "default" : "outline"}
            title={d("meas_btn" as DTKey)}
          >
            <Ruler className="w-4 h-4" /> {d("meas_btn" as DTKey)}
          </Button>
          <Button onClick={onGoEditor}>
            <Edit3 className="w-4 h-4" /> {d("re_editor")}
          </Button>
        </div>
      </div>

      {/* Multi-page tab bar */}
      {pageCount != null && pageCount > 1 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {Array.from({ length: pageCount }, (_, i) => {
            const isAnalyzed = analyzedPages?.includes(i);
            const isCurrent = currentPage === i;
            return (
              <button
                key={i}
                onClick={() => isAnalyzed && onSwitchPage?.(i)}
                disabled={!isAnalyzed}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                  isCurrent
                    ? "bg-sky-500/20 text-sky-400 border-sky-500/40"
                    : isAnalyzed
                    ? "bg-white/5 text-slate-300 border-white/10 hover:bg-white/10 cursor-pointer"
                    : "bg-white/[0.02] text-slate-600 border-white/5 cursor-not-allowed",
                )}
              >
                {d("mp_page" as DTKey)} {i + 1}
                {isAnalyzed && !isCurrent && <span className="text-emerald-400 text-[10px]">✓</span>}
              </button>
            );
          })}
          {onAddPage && (
            <button
              onClick={onAddPage}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-sky-400 border border-sky-500/20 hover:bg-sky-500/10 transition-colors"
            >
              {d("mp_add_page" as DTKey)}
            </button>
          )}
        </div>
      )}

      {/* KPIs */}
      {(() => {
        const kpis = [
          { Icon: DoorOpen,      label: d("re_doors" as DTKey),      value: result.doors_count,                        color: "#a78bfa" },
          { Icon: AppWindow,     label: d("re_windows" as DTKey),    value: result.windows_count,                      color: "#38bdf8" },
          ...(result.french_doors_count ? [{ Icon: ArrowLeftRight, label: "Portes-fenêtres",            value: result.french_doors_count,             color: "#fb923c" }] : []),
          { Icon: Home,          label: d("re_living" as DTKey),     value: fmt(sf.area_hab_m2, 1, " m²"),             color: "#34d399" },
          { Icon: Ruler,         label: d("re_walls_area" as DTKey), value: fmt(sf.area_walls_m2, 1, " m²"),           color: "#60a5fa" },
        ];
        return (
          <div className={`grid grid-cols-2 ${result.french_doors_count ? "sm:grid-cols-3 md:grid-cols-5" : "sm:grid-cols-2 md:grid-cols-4"} gap-3 mb-6`}>
            {kpis.map(({ Icon, label, value, color }) => (
              <div key={label} className="relative glass rounded-2xl border border-white/[0.07] p-4 overflow-hidden">
                {/* ambient glow */}
                <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full blur-2xl pointer-events-none opacity-20" style={{ background: color }} />
                {/* icon bubble */}
                <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-3" style={{ background: `${color}22` }}>
                  <Icon className="w-4 h-4" style={{ color }} />
                </div>
                {/* value — tabular-nums prevents digit shift */}
                <div
                  className="text-3xl font-bold text-white leading-none mb-1.5"
                  style={{ fontFamily: "ui-monospace, 'SF Mono', monospace", fontVariantNumeric: "tabular-nums" }}
                >
                  {value}
                </div>
                {/* label */}
                <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">{label}</div>
                {/* bottom accent */}
                <div className="absolute bottom-0 left-0 h-[2px] w-2/5 rounded-full" style={{ background: `linear-gradient(to right, ${color}99, transparent)` }} />
              </div>
            ))}
          </div>
        );
      })()}

      {/* Custom detections KPIs (visual search) — only when detections exist */}
      {hasDetections && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {customDetections.map((det) => (
            <div key={det.id} className="glass rounded-xl border border-white/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: det.color }} />
                <p className="text-xs text-slate-500">{det.label}</p>
              </div>
              <p
                className="text-3xl font-bold"
                style={{ color: det.color, fontFamily: "ui-monospace, 'SF Mono', monospace", fontVariantNumeric: "tabular-nums" }}
              >
                ×{det.count}
              </p>
              {det.total_area_m2 !== null && (
                <p className="text-xs text-slate-500 mt-1">{det.total_area_m2.toFixed(2)} m²</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Surfaces détaillées */}
      <div className="glass rounded-xl border border-white/10 p-5 mb-6">
        <p className="text-xs font-mono text-accent uppercase tracking-widest mb-4">{d("re_detail_title")}</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          {[
            { label: d("re_footprint"),  value: fmt(sf.area_building_m2, 2, " m²"), color: "#60A5FA" },
            { label: d("re_perim_bld"),  value: fmt(sf.perim_building_m, 2, " m"),  color: "#60A5FA" },
            { label: d("re_walls_area"), value: fmt(sf.area_walls_m2, 2, " m²"),    color: "#D946EF" },
            { label: d("re_living"),     value: fmt(sf.area_hab_m2, 2, " m²"),      color: "#34D399" },
            { label: d("re_perim_int"),  value: fmt(sf.perim_interior_m, 2, " m"),  color: "#34D399" },
            { label: d("re_scale"),      value: result.pixels_per_meter ? result.pixels_per_meter.toFixed(2) : "—", color: "#94a3b8",
              badge: result.scale_info ? { conf: result.scale_info.confidence, method: result.scale_info.method, agreement: result.scale_info.agreement } : undefined },
          ].map(({ label, value, color, badge }: any) => (
            <div key={label} className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-slate-400">{label}</span>
              <span className="flex items-center gap-2">
                <span className="font-mono font-600" style={{ color }}>{value}</span>
                {badge && (
                  <span title={`${badge.method}${badge.agreement ? " ✓" : ""}`}
                    className={cn("text-[9px] px-1.5 py-0.5 rounded font-semibold",
                      badge.conf >= 0.7 ? "bg-emerald-500/20 text-emerald-400"
                      : badge.conf >= 0.4 ? "bg-amber-500/20 text-amber-400"
                      : "bg-red-500/20 text-red-400"
                    )}>
                    {badge.agreement ? "✓ " : ""}{Math.round(badge.conf * 100)}%
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ══════════════════════ Overlays section ══════════════════════ */}
      <div className="glass rounded-xl border border-white/10 p-5">
        {/* ── Toggle buttons (stackable overlays like editor) ── */}
        <div className="flex gap-2 flex-wrap mb-4 items-center">
          {/* Doors toggle */}
          {result.mask_doors_b64 && (
            <button
              onClick={() => setShowDoors(v => !v)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showDoors
                  ? "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30"
                  : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10"
              )}
            >
              {showDoors ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("re_doors")}
            </button>
          )}

          {/* Windows toggle */}
          {result.mask_windows_b64 && (
            <button
              onClick={() => setShowWindows(v => !v)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showWindows
                  ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30"
                  : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10"
              )}
            >
              {showWindows ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("re_windows")}
            </button>
          )}

          {/* French Doors toggle */}
          {result.mask_french_doors_b64 && (
            <button
              onClick={() => setShowFrenchDoors(v => !v)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showFrenchDoors
                  ? "bg-orange-500/15 text-orange-400 border-orange-500/30"
                  : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10"
              )}
            >
              {showFrenchDoors ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} Portes-fenêtres
            </button>
          )}

          {/* Walls toggle (AI model detection only) */}
          {result.mask_walls_ai_b64 && (
            <button
              onClick={() => setShowWalls(v => !v)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showWalls
                  ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                  : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10"
              )}
            >
              {showWalls ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("re_walls_area")}
            </button>
          )}

          {/* Cloisons (IA − Pixel − périmètre) toggle */}
          {result.mask_cloisons_b64 && (
            <button
              onClick={() => setShowCloisons(v => !v)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showCloisons
                  ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                  : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10"
              )}
            >
              {showCloisons ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("re_cloisons")}
            </button>
          )}

          {/* Interior toggle */}
          {result.overlay_interior_b64 && (
            <button
              onClick={() => setShowInterior(v => !v)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showInterior
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                  : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10"
              )}
            >
              {showInterior ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("re_tab_interior")}
            </button>
          )}

          {/* Separator when data overlays exist */}
          {(hasRooms || hasDetections) && (
            <div className="w-px h-6 bg-white/10 mx-1" />
          )}

          {/* Rooms SVG toggle (only when rooms exist) */}
          {hasRooms && (
            <button
              onClick={() => setShowRoomsOverlay(v => !v)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showRoomsOverlay
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                  : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10"
              )}
            >
              {showRoomsOverlay ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("re_overlay_rooms")}
            </button>
          )}

          {/* VS detections SVG toggle (only when detections exist) */}
          {hasDetections && (
            <button
              onClick={() => setShowDetectionsOverlay(v => !v)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showDetectionsOverlay
                  ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                  : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10"
              )}
            >
              <Search className="w-3 h-3" /> {d("re_overlay_vs")}
            </button>
          )}
        </div>

        {/* ── Image display + stacked mask overlays ── */}
        <div className="relative rounded-xl overflow-hidden border border-white/10">
          {hasBaseImage ? (
            <>
              <img
                src={`data:image/png;base64,${baseImageB64}`}
                alt="Plan"
                className="w-full h-auto block"
                style={{ filter: "brightness(0.72) contrast(1.15) saturate(0.85)" }}
                onLoad={(e) => setImgNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              />

              {/* Doors overlay */}
              {showDoors && result.mask_doors_b64 && (
                <div className="absolute inset-0 pointer-events-none" style={{
                  backgroundColor: "#FF00CC",
                  opacity: 0.55,
                  WebkitMaskImage: `url(data:image/png;base64,${result.mask_doors_b64})`,
                  maskImage: `url(data:image/png;base64,${result.mask_doors_b64})`,
                  WebkitMaskSize: "100% 100%",
                  maskSize: "100% 100%",
                  ...({ WebkitMaskMode: "luminance", maskMode: "luminance" } as any),
                  zIndex: 1,
                }} />
              )}
              {/* Windows overlay */}
              {showWindows && result.mask_windows_b64 && (
                <div className="absolute inset-0 pointer-events-none" style={{
                  backgroundColor: "#00CCFF",
                  opacity: 0.55,
                  WebkitMaskImage: `url(data:image/png;base64,${result.mask_windows_b64})`,
                  maskImage: `url(data:image/png;base64,${result.mask_windows_b64})`,
                  WebkitMaskSize: "100% 100%",
                  maskSize: "100% 100%",
                  ...({ WebkitMaskMode: "luminance", maskMode: "luminance" } as any),
                  zIndex: 1,
                }} />
              )}
              {/* French Doors RGBA overlay */}
              {showFrenchDoors && result.mask_french_doors_b64 && (
                <img src={`data:image/png;base64,${result.mask_french_doors_b64}`} alt="" className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }} />
              )}
              {/* Walls RGBA overlay */}
              {showWalls && result.mask_walls_ai_b64 && (
                <img src={`data:image/png;base64,${result.mask_walls_ai_b64}`} alt="" className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }} />
              )}
              {/* Cloisons RGBA overlay */}
              {showCloisons && result.mask_cloisons_b64 && (
                <img src={`data:image/png;base64,${result.mask_cloisons_b64}`} alt="" className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 3 }} />
              )}
            </>
          ) : (
            <div className="text-center py-16 text-slate-600 text-sm">{d("re_no_overlay")}</div>
          )}

          {/* Measure tool overlay */}
          {hasBaseImage && (
            <MeasureTool
              ppm={result.pixels_per_meter ?? null}
              active={measureActive}
              imgW={imgNatural.w}
              imgH={imgNatural.h}
            />
          )}

          {/* SVG overlay layer for rooms & VS detections */}
          {(showRoomsOverlay || showDetectionsOverlay) && hasBaseImage && (
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox={`0 0 ${imgNatural.w} ${imgNatural.h}`}
              preserveAspectRatio="xMidYMid meet"
              style={{ zIndex: 2 }}
            >
              {/* Room polygons */}
              {showRoomsOverlay && result.rooms?.map(room => {
                const poly = room.polygon_norm;
                if (!poly || poly.length < 3) return null;
                const color = getRoomColor(room.type);
                const fs = Math.max(10, Math.min(16, imgNatural.w * 0.008));
                const rcx = room.centroid_norm.x * imgNatural.w;
                const rcy = room.centroid_norm.y * imgNatural.h;
                const areaStr = room.area_m2 != null ? `${room.area_m2.toFixed(1)} m\u00B2` : "";
                const measFontSize = Math.max(7, fs * 0.75);
                const nameW = Math.max(50, room.label_fr.length * (fs * 0.62));
                const measW = areaStr ? Math.max(40, areaStr.length * (measFontSize * 0.6)) : 0;
                const pw = Math.max(nameW, measW) + 12;
                const ph = areaStr ? fs + measFontSize + 8 : fs + 6;

                return (
                  <g key={room.id}>
                    <polygon
                      points={poly.map(p => `${p.x * imgNatural.w},${p.y * imgNatural.h}`).join(" ")}
                      fill={color + "28"}
                      stroke={color}
                      strokeWidth={Math.max(1.5, imgNatural.w * 0.001)}
                      strokeLinejoin="round"
                      opacity={0.85}
                    />
                    <rect
                      x={rcx - pw / 2} y={rcy - ph / 2}
                      width={pw} height={ph} rx={4}
                      fill="rgba(10,16,32,0.92)"
                      stroke={color} strokeWidth={1.5}
                    />
                    <text
                      x={rcx}
                      y={areaStr ? rcy - ph / 2 + fs + 2 : rcy + fs * 0.35}
                      fontSize={fs}
                      fill={color}
                      textAnchor="middle"
                      fontWeight="700"
                      fontFamily="system-ui,sans-serif"
                    >
                      {room.label_fr}
                    </text>
                    {areaStr && (
                      <text
                        x={rcx}
                        y={rcy - ph / 2 + fs + measFontSize + 5}
                        fontSize={measFontSize}
                        fill="#94a3b8"
                        textAnchor="middle"
                        fontWeight="500"
                        fontFamily="monospace"
                      >
                        {areaStr}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* VS detection rectangles */}
              {showDetectionsOverlay && customDetections.map(det =>
                det.matches.map((m, i) => (
                  <rect
                    key={`${det.id}-${i}`}
                    x={m.x_norm * imgNatural.w}
                    y={m.y_norm * imgNatural.h}
                    width={m.w_norm * imgNatural.w}
                    height={m.h_norm * imgNatural.h}
                    fill={det.color + "25"}
                    stroke={det.color}
                    strokeWidth={Math.max(1.5, imgNatural.w * 0.001)}
                    rx={2}
                  />
                ))
              )}
            </svg>
          )}
        </div>
      </div>

      {/* ── Recap Table : Rooms + Custom Detections (collapsible, replié par défaut) ── */}
      {(hasRooms || hasDetections) && (
        <div className="mt-6 glass rounded-xl border border-white/10">
          <button
            onClick={() => setRecapOpen(v => !v)}
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.02] transition-colors"
          >
            <p className="text-xs font-mono text-accent uppercase tracking-widest">{d("recap_title")}</p>
            <div className="flex items-center gap-3">
              {!recapOpen && hasRooms && (
                <span className="text-xs text-slate-500 font-mono">{totalRooms} pièces · {totalArea} m²</span>
              )}
              {recapOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
            </div>
          </button>
          {recapOpen && (
            <div className="px-5 pb-5">
              {hasRooms && (
                <div className="flex justify-end mb-3">
                  <button onClick={handleExportRoomsCSV} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
                    <Table2 className="w-3.5 h-3.5" /> {d("recap_csv")}
                  </button>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left text-xs text-slate-500 font-600 pb-2 pr-4">{d("recap_type")}</th>
                      <th className="text-right text-xs text-slate-500 font-600 pb-2 px-2">{d("recap_count")}</th>
                      <th className="text-right text-xs text-slate-500 font-600 pb-2 px-2">{d("recap_area")}</th>
                      <th className="text-right text-xs text-slate-500 font-600 pb-2 pl-2">{d("recap_perim")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(roomsByType).map(([type, rooms]) => {
                      const groupArea = rooms!.reduce((s, r) => s + (r.area_m2 ?? 0), 0);
                      const groupPerim = rooms!.reduce((s, r) => s + (r.perimeter_m ?? 0), 0);
                      const color = getRoomColor(type);
                      return (
                        <tr key={type} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                          <td className="py-2 pr-4">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                              <span className="text-slate-300 capitalize">{type}</span>
                            </div>
                            {rooms!.length > 1 && (
                              <div className="ml-5 mt-1 space-y-0.5">
                                {rooms!.map((r, i) => (
                                  <div key={r.id ?? i} className="text-xs text-slate-500 flex justify-between">
                                    <span>{r.label_fr}</span>
                                    <span className="font-mono">{r.area_m2?.toFixed(1) ?? "—"} m²</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="text-right py-2 px-2 text-slate-300 align-top">{rooms!.length}</td>
                          <td className="text-right py-2 px-2 font-mono align-top" style={{ color }}>{groupArea.toFixed(2)} m²</td>
                          <td className="text-right py-2 pl-2 font-mono text-slate-400 align-top">{groupPerim.toFixed(2)} m</td>
                        </tr>
                      );
                    })}
                    {hasDetections && Object.keys(roomsByType).length > 0 && (
                      <tr><td colSpan={4} className="pt-3 pb-1"><div className="border-t border-white/10" /></td></tr>
                    )}
                    {customDetections.map((det) => (
                      <tr key={det.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: det.color }} />
                            <span className="text-slate-300">{det.label}</span>
                            <span className="text-[10px] text-slate-600 px-1.5 py-0.5 rounded bg-white/5 border border-white/5">🔍</span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2 text-slate-300 align-top">{det.count}</td>
                        <td className="text-right py-2 px-2 font-mono align-top" style={{ color: det.color }}>{det.total_area_m2 !== null ? `${det.total_area_m2.toFixed(2)} m²` : "—"}</td>
                        <td className="text-right py-2 pl-2 font-mono text-slate-400 align-top">—</td>
                      </tr>
                    ))}
                    <tr className="border-t border-white/10 font-600">
                      <td className="pt-3 text-white">{d("recap_total")}</td>
                      <td className="text-right pt-3 text-white">{totalRooms + customDetections.reduce((s, d) => s + d.count, 0)}</td>
                      <td className="text-right pt-3 font-mono text-accent">
                        {(parseFloat(totalArea) + customDetections.reduce((s, d) => s + (d.total_area_m2 ?? 0), 0)).toFixed(2)} m²
                      </td>
                      <td className="text-right pt-3 font-mono text-slate-300">{totalPerim} m</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Dashboard KPIs ── */}
      <DashboardPanel result={result} customDetections={customDetections} />

      {/* ── 3D Floor Plan View ── */}
      <View3dPanel result={result} imgW={imgNatural.w} imgH={imgNatural.h} />

      {/* ── Pattern detection panel ── */}
      {onDetectionsChange && result.overlay_openings_b64 && (
        <PatternPanel
          result={result}
          overlayB64={result.plan_b64 || result.overlay_openings_b64}
          customDetections={customDetections}
          onDetectionsChange={onDetectionsChange}
        />
      )}

      {/* ══════════════════════ Advanced Tools accordion ══════════════════════ */}
      <div className="mt-8 glass rounded-xl border border-white/10 overflow-hidden">
        <button
          onClick={() => setAdvancedOpen(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
              <Wrench className="w-3.5 h-3.5 text-accent" />
            </div>
            <div className="text-left">
              <p className="text-sm font-600 text-white">Advanced Tools</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Material estimate · DPGF · CCTP · Scenario · Schedule · Compliance · Housing · Unit/Lot · BTP Toolkit
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <span className="text-[10px] text-slate-600 border border-white/10 rounded px-1.5 py-0.5 font-mono">9 outils</span>
            {advancedOpen
              ? <ChevronDown className="w-4 h-4 text-slate-400" />
              : <ChevronRight className="w-4 h-4 text-slate-400" />}
          </div>
        </button>

        {advancedOpen && (
          <div className="border-t border-white/5 px-1 pb-1 flex flex-col gap-0">
            {/* Materials estimation */}
            <div className="pt-1">
              <MaterialsPanel result={result} customDetections={customDetections} />
            </div>

            {/* DPGF */}
            <DpgfPanel result={result} customDetections={customDetections} />

            {/* CCTP */}
            <CctpPanel result={result} customDetections={customDetections} />

            {/* Scenario Comparator */}
            <ScenarioPanel result={result} customDetections={customDetections} />

            {/* Gantt / Estimated Schedule */}
            <GanttPanel result={result} customDetections={customDetections} />

            {/* Regulatory Compliance */}
            <CompliancePanel result={result} />

            {/* Housing Detection */}
            <HousingPanel result={result} />

            {/* Unit / Lot */}
            <LotsPanel result={result} />

            {/* BTP Toolkit */}
            <ToolkitPanel result={result} />

            {/* OCR (Beta) */}
            <OcrPanel result={result} />
          </div>
        )}
      </div>

      {/* ── Multi-model comparison (admin only) ── */}
      {isAdmin && (
        <div className="mt-6">
          {!comparisonResult ? (
            <button
              onClick={async () => {
                setComparingModels(true);
                try {
                  const resp = await fetch(`${BACKEND}/compare`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ session_id: result.session_id }),
                  });
                  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                  const data = await resp.json();
                  setComparisonResult(data);
                } catch (e: any) {
                  toast({ title: d("cmp_error_toast"), description: e.message, variant: "error" });
                } finally {
                  setComparingModels(false);
                }
              }}
              disabled={comparingModels}
              className={cn(
                "w-full px-4 py-3 rounded-xl text-sm font-500 border transition-all flex items-center justify-center gap-2",
                comparingModels
                  ? "border-amber-500/20 text-amber-400/50 cursor-wait"
                  : "border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
              )}
            >
              {comparingModels ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> {d("cmp_btn_comparing")}</>
              ) : (
                <><Layers className="w-4 h-4" /> {d("cmp_btn_compare")}</>
              )}
            </button>
          ) : (
            <ComparisonPanel
              result={comparisonResult}
              basePlanB64={basePlanB64}
              ppm={result.pixels_per_meter}
            />
          )}
        </div>
      )}

      {/* ── Debug technique panel (admin only) ── */}
      {isAdmin && <DebugPanel result={result} customDetections={customDetections} />}

      <div className="flex justify-center mt-6">
        <Button variant="ghost" onClick={onRestart}>
          <RotateCcw className="w-4 h-4" /> {d("re_restart")}
        </Button>
      </div>

      {/* ── Rapport Pro dialog ── */}
      {rapportOpen && (
        <RapportDialog
          result={result}
          customDetections={customDetections}
          onClose={() => setRapportOpen(false)}
        />
      )}

    </motion.div>
  );
}
