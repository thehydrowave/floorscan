"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Download, Edit3, RotateCcw, Loader2, Table2, Printer, Search, Ruler, FileDown, ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalysisResult, CustomDetection } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { useAuth } from "@/lib/use-auth";
import MaterialsPanel from "@/components/demo/materials-panel";
import MetrePanel from "@/components/demo/metre-panel";
import DpgfPanel from "@/components/demo/dpgf-panel";
import CctpPanel from "@/components/demo/cctp-panel";
import GanttPanel from "@/components/demo/gantt-panel";
import CompliancePanel from "@/components/demo/compliance-panel";
import DebugPanel from "@/components/demo/debug-panel";
import View3dPanel from "@/components/demo/view-3d-panel";
import ChatPanel from "@/components/demo/chat-panel";
import ScenarioPanel from "@/components/demo/scenario-panel";
import PatternPanel from "@/components/demo/pattern-panel";
import ToolkitPanel from "@/components/demo/toolkit-panel";
import LotsPanel from "@/components/demo/lots-panel";
import DashboardPanel from "@/components/demo/dashboard-panel";
import MeasureTool from "@/components/demo/measure-tool";
import RapportDialog from "@/components/demo/rapport-dialog";
import OcrPanel from "@/components/demo/ocr-panel";
import HousingPanel from "@/components/demo/housing-panel";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

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

const ROOM_COLORS: Record<string, string> = {
  "bedroom": "#818cf8", "living room": "#34d399", "living": "#34d399",
  "kitchen": "#fb923c", "bathroom": "#22d3ee", "hallway": "#94a3b8",
  "corridor": "#94a3b8", "office": "#a78bfa", "study": "#a78bfa",
  "wc": "#fbbf24", "toilet": "#fbbf24", "dining room": "#f472b6",
  "storage": "#78716c", "closet": "#78716c", "garage": "#6b7280",
  "balcony": "#86efac", "laundry": "#67e8f9",
};
function getRoomColor(type: string) { return ROOM_COLORS[type?.toLowerCase()] ?? "#94a3b8"; }

export default function ResultsStep({ result, customDetections = [], onDetectionsChange, onGoEditor, onRestart, pageCount, currentPage, onSwitchPage, analyzedPages, onAddPage }: ResultsStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const { isAdmin } = useAuth();

  // ── Mask overlays (stackable, like editor) ──
  const [showDoors, setShowDoors] = useState(true);
  const [showWindows, setShowWindows] = useState(true);
  const [showWalls, setShowWalls] = useState(false);
  const [showWallsAI, setShowWallsAI] = useState(false);
  const [showInterior, setShowInterior] = useState(false);
  // ── SVG data overlays (independent toggles) ──
  const [showRoomsOverlay, setShowRoomsOverlay] = useState(false);
  const [showDetectionsOverlay, setShowDetectionsOverlay] = useState(false);
  // ── Image natural dimensions for SVG viewBox ──
  const [imgNatural, setImgNatural] = useState({ w: 1, h: 1 });

  const [exportingPdf, setExportingPdf] = useState(false);
  const [measureActive, setMeasureActive] = useState(false);
  const [rapportOpen, setRapportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [roofTakeOffOpen, setRoofTakeOffOpen] = useState(false);

  // Base plan image (clean plan or fallback to openings overlay)
  const basePlanB64 = result.plan_b64 || result.overlay_openings_b64;
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
    toast({ title: "CSV exporté ✓", variant: "success" });
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
    toast({ title: "CSV exporté ✓", variant: "success" });
  };

  const sf = result.surfaces ?? {};

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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: `🚪 ${d("re_doors")}`, value: result.doors_count, color: "#D946EF" },
          { label: `🪟 ${d("re_windows")}`, value: result.windows_count, color: "#22D3EE" },
          { label: `🏠 ${d("re_living")}`, value: fmt(sf.area_hab_m2, 1, " m²"), color: "#34D399" },
          { label: `⬜ ${d("re_walls_area")}`, value: fmt(sf.area_walls_m2, 1, " m²"), color: "#60A5FA" },
        ].map(({ label, value, color }) => (
          <div key={label} className="glass rounded-xl border border-white/10 p-4">
            <p className="text-xs text-slate-500 mb-2">{label}</p>
            <p className="text-2xl font-display font-700" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Custom detections KPIs (visual search) — only when detections exist */}
      {hasDetections && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {customDetections.map((det) => (
            <div key={det.id} className="glass rounded-xl border border-white/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: det.color }} />
                <p className="text-xs text-slate-500">{det.label}</p>
              </div>
              <p className="text-2xl font-display font-700" style={{ color: det.color }}>×{det.count}</p>
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

          {/* Walls toggle */}
          {result.mask_walls_b64 && (
            <button
              onClick={() => setShowWalls(v => !v)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showWalls
                  ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                  : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10"
              )}
            >
              {showWalls ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("re_walls_area")}
            </button>
          )}

          {/* Walls AI toggle (debug: direct Roboflow wall predictions) */}
          {result.mask_walls_ai_b64 && (
            <button
              onClick={() => setShowWallsAI(v => !v)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showWallsAI
                  ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                  : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10"
              )}
            >
              {showWallsAI ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} Murs (IA)
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
                onLoad={(e) => setImgNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              />

              {/* Stacked CSS mask overlays (like editor) */}
              {showDoors && result.mask_doors_b64 && (
                <div className="absolute inset-0 pointer-events-none" style={{
                  backgroundColor: "#D946EF",
                  opacity: 0.25,
                  WebkitMaskImage: `url(data:image/png;base64,${result.mask_doors_b64})`,
                  maskImage: `url(data:image/png;base64,${result.mask_doors_b64})`,
                  WebkitMaskSize: "100% 100%",
                  maskSize: "100% 100%",
                  zIndex: 1,
                }} />
              )}
              {showWindows && result.mask_windows_b64 && (
                <div className="absolute inset-0 pointer-events-none" style={{
                  backgroundColor: "#22D3EE",
                  opacity: 0.25,
                  WebkitMaskImage: `url(data:image/png;base64,${result.mask_windows_b64})`,
                  maskImage: `url(data:image/png;base64,${result.mask_windows_b64})`,
                  WebkitMaskSize: "100% 100%",
                  maskSize: "100% 100%",
                  zIndex: 1,
                }} />
              )}
              {showWalls && result.mask_walls_b64 && (
                <div className="absolute inset-0 pointer-events-none" style={{
                  backgroundColor: "#60A5FA",
                  opacity: 0.25,
                  WebkitMaskImage: `url(data:image/png;base64,${result.mask_walls_b64})`,
                  maskImage: `url(data:image/png;base64,${result.mask_walls_b64})`,
                  WebkitMaskSize: "100% 100%",
                  maskSize: "100% 100%",
                  zIndex: 1,
                }} />
              )}
              {showWallsAI && result.mask_walls_ai_b64 && (
                <div className="absolute inset-0 pointer-events-none" style={{
                  backgroundColor: "#F59E0B",
                  opacity: 0.3,
                  WebkitMaskImage: `url(data:image/png;base64,${result.mask_walls_ai_b64})`,
                  maskImage: `url(data:image/png;base64,${result.mask_walls_ai_b64})`,
                  WebkitMaskSize: "100% 100%",
                  maskSize: "100% 100%",
                  zIndex: 1,
                }} />
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
                const fs = Math.max(10, Math.min(18, imgNatural.w * 0.008));
                return (
                  <g key={room.id}>
                    <polygon
                      points={poly.map(p => `${p.x * imgNatural.w},${p.y * imgNatural.h}`).join(" ")}
                      fill={color + "30"}
                      stroke={color}
                      strokeWidth={Math.max(1.5, imgNatural.w * 0.001)}
                    />
                    {/* Background for label */}
                    <rect
                      x={room.centroid_norm.x * imgNatural.w - fs * 2.5}
                      y={room.centroid_norm.y * imgNatural.h - fs * 0.8}
                      width={fs * 5}
                      height={room.area_m2 ? fs * 2.2 : fs * 1.4}
                      rx={3}
                      fill="rgba(0,0,0,0.7)"
                    />
                    <text
                      x={room.centroid_norm.x * imgNatural.w}
                      y={room.centroid_norm.y * imgNatural.h + fs * 0.15}
                      fontSize={fs}
                      fill="white"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontWeight="600"
                    >
                      {room.label_fr}
                    </text>
                    {room.area_m2 != null && (
                      <text
                        x={room.centroid_norm.x * imgNatural.w}
                        y={room.centroid_norm.y * imgNatural.h + fs * 1.1}
                        fontSize={fs * 0.75}
                        fill={color}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontWeight="500"
                      >
                        {room.area_m2.toFixed(1)} m²
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

      {/* Recap Table: Rooms + Custom Detections (after overlays) — only when data exists */}
      {(hasRooms || hasDetections) && (
        <div className="glass rounded-xl border border-white/10 p-5 mt-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-mono text-accent uppercase tracking-widest">{d("recap_title")}</p>
            {hasRooms && (
              <button onClick={handleExportRoomsCSV} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
                <Table2 className="w-3.5 h-3.5" /> {d("recap_csv")}
              </button>
            )}
          </div>

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
                {/* Rooms by type */}
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
                {/* Custom detections (visual search) */}
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
                {/* Total row */}
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

      {/* ── Dashboard KPIs ── */}
      <DashboardPanel result={result} customDetections={customDetections} />

      {/* ── 3D Floor Plan View ── */}
      <View3dPanel result={result} imgW={imgNatural.w} imgH={imgNatural.h} />

      {/* ── Materials estimation panel ── */}
      <div className="mt-8">
        <MaterialsPanel result={result} customDetections={customDetections} />
      </div>

      {/* ── Pattern detection panel ── */}
      {onDetectionsChange && result.overlay_openings_b64 && (
        <PatternPanel
          result={result}
          overlayB64={result.plan_b64 || result.overlay_openings_b64}
          customDetections={customDetections}
          onDetectionsChange={onDetectionsChange}
        />
      )}

      {/* ── Métré détaillé par pièce (collapsible, collapsed by default) ── */}
      <div className="mt-8 glass rounded-xl border border-white/10">
        <button
          onClick={() => setRoofTakeOffOpen(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.02] transition-colors"
        >
          <p className="text-xs font-mono text-accent uppercase tracking-widest">{d("metre_title" as DTKey)}</p>
          {roofTakeOffOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        </button>
        {roofTakeOffOpen && (
          <div className="px-0 pb-0">
            <MetrePanel result={result} />
          </div>
        )}
      </div>

      {/* ── DPGF estimatif panel ── */}
      <DpgfPanel result={result} customDetections={customDetections} />

      {/* ── Scenario Comparator ── */}
      <ScenarioPanel result={result} customDetections={customDetections} />

      {/* ── CCTP panel ── */}
      <CctpPanel result={result} customDetections={customDetections} />

      {/* ── Gantt planning panel ── */}
      <GanttPanel result={result} customDetections={customDetections} />

      {/* ── Compliance check panel ── */}
      <CompliancePanel result={result} />

      {/* ── Housing Detection panel ── */}
      <HousingPanel result={result} />

      {/* ── Lots / Copropriété panel ── */}
      <LotsPanel result={result} />

      {/* ── BTP Toolkit panel ── */}
      <ToolkitPanel result={result} />

      {/* ── OCR text detection panel (Beta) ── */}
      <OcrPanel result={result} />

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

      {/* ── AI Chat floating panel ── */}
      <ChatPanel result={result} />
    </motion.div>
  );
}
