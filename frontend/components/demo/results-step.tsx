"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { Download, Edit3, RotateCcw, Table2, Printer, Search, Ruler, FileDown, ChevronDown, ChevronRight, Eye, EyeOff, Layers, DoorOpen, AppWindow, Home, ArrowLeftRight, Wrench, PaintBucket, ClipboardList, ZoomIn, ZoomOut, Hash, Type, Circle } from "lucide-react";
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
import { polygonAreaNorm, polygonPerimeterM } from "@/lib/measure-types";
import type { MeasureZone, SurfaceType } from "@/lib/measure-types";
import { BACKEND } from "@/lib/backend";
import { getRoomColor } from "@/lib/room-colors";

interface ResultsStepProps {
  result: AnalysisResult;
  customDetections?: CustomDetection[];
  onDetectionsChange?: (dets: CustomDetection[]) => void;
  onGoEditor: () => void;
  onGoChantier?: () => void;
  onRestart: () => void;
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

export default function ResultsStep({ result, customDetections = [], onDetectionsChange, onGoEditor, onGoChantier, onRestart, pageCount, currentPage, onSwitchPage, analyzedPages, onAddPage }: ResultsStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const { isAdmin } = useAuth();

  // ── Mask overlays ──
  const [showDoors, setShowDoors] = useState(true);
  const [showWindows, setShowWindows] = useState(true);
  const [showFrenchDoors, setShowFrenchDoors] = useState(true);
  const [showWalls, setShowWalls] = useState(false);
  const [showCloisons, setShowCloisons] = useState(false);
  const [showInterior, setShowInterior] = useState(false);
  // ── SVG data overlays ──
  const [showRoomsOverlay, setShowRoomsOverlay] = useState(false);
  const [showDetectionsOverlay, setShowDetectionsOverlay] = useState(false);
  // ── Surfaces overlay (from editor _measurements) ──
  const [showSurfacesOverlay, setShowSurfacesOverlay] = useState(true);
  // ── Measurement overlays ──
  const [showLinears, setShowLinears] = useState(true);
  const [showCounts, setShowCounts] = useState(true);
  const [showTexts, setShowTexts] = useState(true);
  const [showCircles, setShowCircles] = useState(true);
  // ── Multi-model comparison ──
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [comparingModels, setComparingModels] = useState(false);
  const [imgNatural, setImgNatural] = useState({ w: 1, h: 1 });

  // Sync imgNatural from DOM in case image is cached (onLoad may not re-fire)
  useEffect(() => {
    const trySync = () => {
      const img = document.querySelector('[data-results-image]') as HTMLImageElement;
      if (img && img.naturalWidth > 10) {
        setImgNatural({ w: img.naturalWidth, h: img.naturalHeight });
      }
    };
    trySync();
    // Also try after a short delay (image may still be loading)
    const t = setTimeout(trySync, 500);
    return () => clearTimeout(t);
  }, [result]);

  const [measureActive, setMeasureActive] = useState(false);
  const [rapportOpen, setRapportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [recapOpen, setRecapOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // ── Zoom / pan for image ──
  const [imgZoom, setImgZoom] = useState(1);
  const [imgPan, setImgPan] = useState({ x: 0, y: 0 });
  const imgPanRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);

  const handleImgWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const container = imgContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setImgZoom(prevZ => {
      const newZ = Math.max(0.5, Math.min(12, prevZ * factor));
      const ratio = newZ / prevZ;
      setImgPan(t => ({ x: cx * (1 - ratio) + t.x * ratio, y: cy * (1 - ratio) + t.y * ratio }));
      return newZ;
    });
  }, []);

  useEffect(() => {
    const el = imgContainerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleImgWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleImgWheel);
  }, [handleImgWheel]);

  // ── Extract surfaces from editor _measurements ──
  const measurements = (result as any)._measurements as {
    zones?: MeasureZone[];
    surfaceTypes?: SurfaceType[];
    linearMeasures?: Array<{id: string; p1: {x:number;y:number}; p2: {x:number;y:number}; distPx: number}>;
    angleMeasures?: Array<{id: string; p1: {x:number;y:number}; vertex: {x:number;y:number}; p3: {x:number;y:number}; angleDeg: number}>;
    countPoints?: Array<{id: string; groupId: string; x: number; y: number}>;
    countGroups?: Array<{id: string; name: string; color: string}>;
    textAnnotations?: Array<{id: string; x: number; y: number; text: string; color: string; fontSize?: number}>;
    circleMeasures?: Array<{id: string; center: {x:number;y:number}; edgePoint: {x:number;y:number}}>;
  } | undefined;
  const countCategories = useMemo(() => {
    const groups = measurements?.countGroups ?? [];
    const points = measurements?.countPoints ?? [];
    return groups.map(g => ({ ...g, count: points.filter(p => p.groupId === g.id).length })).filter(c => c.count > 0);
  }, [measurements]);
  const linearMeasures = measurements?.linearMeasures ?? [];
  const angleMeasures = measurements?.angleMeasures ?? [];
  const textAnnotations = measurements?.textAnnotations ?? [];
  const circleMeasures = measurements?.circleMeasures ?? [];
  const countPoints = measurements?.countPoints ?? [];
  const editorZones = useMemo(() => (measurements?.zones ?? []).filter((z: MeasureZone) => z.typeId !== "__count__" && z.points?.length >= 3), [measurements]);
  const editorSurfaceTypes = useMemo(() => measurements?.surfaceTypes ?? [], [measurements]);
  const hasSurfaces = editorZones.length > 0;

  const basePlanB64 = (result.plan_b64 || result.overlay_openings_b64) as string;
  const baseImageB64 = showInterior && result.overlay_interior_b64
    ? result.overlay_interior_b64
    : basePlanB64;
  const hasBaseImage = !!baseImageB64;

  const hasRooms = (result.rooms ?? []).length > 0;
  const hasDetections = customDetections.length > 0;

  const handleExportXLSX = () => {
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const sf = result.surfaces ?? {};

    // Sheet 1: Résultats
    const data1: (string | number)[][] = [
      ["FloorScan — Résultats d'analyse IA"],
      ["Date", new Date().toLocaleDateString("fr-FR")],
      [],
      ["ÉLÉMENTS DÉTECTÉS"],
      ["Portes", result.doors_count],
      ["Fenêtres", result.windows_count],
      ...(result.french_doors_count ? [["Portes-fenêtres", result.french_doors_count]] : []),
      [],
      ["SURFACES"],
      ["Emprise bâtiment (m²)", sf.area_building_m2 != null ? +sf.area_building_m2.toFixed(2) : "—"],
      ["Périmètre bâtiment (m)", sf.perim_building_m != null ? +sf.perim_building_m.toFixed(2) : "—"],
      ["Surface habitable (m²)", sf.area_hab_m2 != null ? +sf.area_hab_m2.toFixed(2) : "—"],
      ["Périmètre intérieur (m)", sf.perim_interior_m != null ? +sf.perim_interior_m.toFixed(2) : "—"],
      ["Surface murs (m²)", sf.area_walls_m2 != null ? +sf.area_walls_m2.toFixed(2) : "—"],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(data1);
    ws1["!cols"] = [{ wch: 25 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws1, "Résultats");

    // Sheet 2: Ouvertures
    if (result.openings && result.openings.length > 0) {
      const data2: (string | number)[][] = [["Type", "Longueur (m)"]];
      result.openings.forEach(o => data2.push([o.class === "door" ? "Porte" : "Fenêtre", o.length_m != null ? +o.length_m.toFixed(2) : 0]));
      const ws2 = XLSX.utils.aoa_to_sheet(data2);
      ws2["!cols"] = [{ wch: 15 }, { wch: 15 }];
      XLSX.utils.book_append_sheet(wb, ws2, "Ouvertures");
    }

    // Sheet 3: Pièces
    if (result.rooms && result.rooms.length > 0) {
      const ppmR = result.pixels_per_meter;
      // Get image dimensions — try imgNatural, then DOM, then fallback
      const imgEl = document.querySelector('[data-results-image]') as HTMLImageElement;
      const iw = imgNatural.w > 10 ? imgNatural.w : (imgEl?.naturalWidth || 2000);
      const ih = imgNatural.h > 10 ? imgNatural.h : (imgEl?.naturalHeight || 2000);
      const data3: (string | number)[][] = [["Pièce", "Surface (m²)", "Périmètre (m)", "Type de sol"]];
      result.rooms.forEach(r => {
        // Always calculate perimeter from polygon_norm
        let perim = 0;
        if (r.polygon_norm && r.polygon_norm.length >= 3 && ppmR && ppmR > 0) {
          perim = polygonPerimeterM(r.polygon_norm, iw, ih, ppmR);
        } else if (r.perimeter_m && r.perimeter_m > 0) {
          perim = r.perimeter_m;
        }
        // Get surface type NAME instead of ID
        const stName = r.surfaceTypeId ? (editorSurfaceTypes.find(st => st.id === r.surfaceTypeId)?.name ?? r.surfaceTypeId) : "—";
        data3.push([r.label_fr, r.area_m2 != null ? +r.area_m2.toFixed(2) : 0, +perim.toFixed(2), stName]);
      });
      const totalArea = result.rooms.reduce((s, r) => s + (r.area_m2 ?? 0), 0);
      const totalPerim = result.rooms.reduce((s, r) => {
        let p = 0;
        if (r.polygon_norm && r.polygon_norm.length >= 3 && ppmR && ppmR > 0) p = polygonPerimeterM(r.polygon_norm, iw, ih, ppmR);
        else if (r.perimeter_m && r.perimeter_m > 0) p = r.perimeter_m;
        return s + p;
      }, 0);
      data3.push(["TOTAL", +totalArea.toFixed(2), +totalPerim.toFixed(2), ""]);
      const ws3 = XLSX.utils.aoa_to_sheet(data3);
      ws3["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws3, "Pièces");
    }

    // Sheet 4: Comptage (if available from editor)
    if (countCategories.length > 0) {
      const data4: (string | number)[][] = [["Catégorie", "Nombre"]];
      countCategories.forEach(c => data4.push([c.name, c.count]));
      data4.push(["TOTAL", countCategories.reduce((s, c) => s + c.count, 0)]);
      const ws4 = XLSX.utils.aoa_to_sheet(data4);
      ws4["!cols"] = [{ wch: 20 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, ws4, "Comptage");
    }

    // Sheet: Linéaires
    if (linearMeasures.length > 0) {
      const ppm = result.pixels_per_meter;
      const dataL: (string | number)[][] = [["#", "Distance (m)", "Distance (px)"]];
      linearMeasures.forEach((lm, i) => {
        const distM = ppm ? +(lm.distPx / ppm).toFixed(3) : 0;
        dataL.push([i + 1, distM, Math.round(lm.distPx)]);
      });
      dataL.push(["TOTAL", ppm ? +linearMeasures.reduce((s, lm) => s + lm.distPx / ppm!, 0).toFixed(3) : 0, Math.round(linearMeasures.reduce((s, lm) => s + lm.distPx, 0))]);
      const wsL = XLSX.utils.aoa_to_sheet(dataL);
      wsL["!cols"] = [{ wch: 5 }, { wch: 14 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, wsL, "Linéaires");
    }

    // Sheet: Angles
    if (angleMeasures.length > 0) {
      const dataA: (string | number)[][] = [["#", "Angle (°)"]];
      angleMeasures.forEach((am, i) => dataA.push([i + 1, +am.angleDeg.toFixed(1)]));
      const wsA = XLSX.utils.aoa_to_sheet(dataA);
      wsA["!cols"] = [{ wch: 5 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, wsA, "Angles");
    }

    // Sheet: Textes
    if (textAnnotations.length > 0) {
      const dataT: (string | number)[][] = [["Texte", "Couleur", "Taille"]];
      textAnnotations.forEach(ta => dataT.push([ta.text, ta.color, ta.fontSize ?? 12]));
      const wsT = XLSX.utils.aoa_to_sheet(dataT);
      wsT["!cols"] = [{ wch: 30 }, { wch: 10 }, { wch: 8 }];
      XLSX.utils.book_append_sheet(wb, wsT, "Textes");
    }

    // Sheet: Cercles
    if (circleMeasures.length > 0) {
      const ppm = result.pixels_per_meter;
      const dataC: (string | number)[][] = [["#", "Rayon (m)", "Diamètre (m)", "Périmètre (m)", "Surface (m²)"]];
      circleMeasures.forEach((cm, i) => {
        const rPx = Math.hypot((cm.edgePoint.x - cm.center.x) * imgNatural.w, (cm.edgePoint.y - cm.center.y) * imgNatural.h);
        const rM = ppm ? rPx / ppm : 0;
        dataC.push([i + 1, +rM.toFixed(3), +(rM * 2).toFixed(3), +(2 * Math.PI * rM).toFixed(3), +(Math.PI * rM * rM).toFixed(3)]);
      });
      const wsC = XLSX.utils.aoa_to_sheet(dataC);
      wsC["!cols"] = [{ wch: 5 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, wsC, "Cercles");
    }

    // Sheet: Surfaces (from editor zones)
    if (hasSurfaces) {
      const ppm = result.pixels_per_meter;
      const dataS: (string | number)[][] = [["Type", "Surface (m²)", "Nb zones", "Prix/m²", "Chute %", "Total HT"]];
      editorSurfaceTypes.forEach(st => {
        const stZones = editorZones.filter(z => z.typeId === st.id);
        if (stZones.length === 0) return;
        const totalArea = ppm ? stZones.reduce((s, z) => {
          let a = 0; const pts = z.points;
          for (let j = 0; j < pts.length; j++) { const k = (j+1)%pts.length; a += pts[j].x * imgNatural.w * pts[k].y * imgNatural.h - pts[k].x * imgNatural.w * pts[j].y * imgNatural.h; }
          return s + Math.abs(a) / 2 / (ppm * ppm);
        }, 0) : 0;
        const waste = st.wastePercent ?? 10;
        const price = st.pricePerM2 ?? 0;
        const ht = totalArea * price * (1 + waste / 100);
        dataS.push([st.name, +totalArea.toFixed(2), stZones.length, price, waste, +ht.toFixed(2)]);
      });
      const wsS = XLSX.utils.aoa_to_sheet(dataS);
      wsS["!cols"] = [{ wch: 15 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, wsS, "Surfaces");
    }

    XLSX.writeFile(wb, `floorscan_analyse_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast({ title: "Export XLSX ✓", variant: "success" });
  };

  const handleExportRoomsXLSX = () => {
    if (!result.rooms || result.rooms.length === 0) return;
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const ppmRx = result.pixels_per_meter;
    const imgElRx = document.querySelector('[data-results-image]') as HTMLImageElement;
    const iwx = imgNatural.w > 10 ? imgNatural.w : (imgElRx?.naturalWidth || 2000);
    const ihx = imgNatural.h > 10 ? imgNatural.h : (imgElRx?.naturalHeight || 2000);
    const data: (string | number)[][] = [
      ["FloorScan — Récapitulatif des pièces"],
      ["Date", new Date().toLocaleDateString("fr-FR")],
      [],
      ["Pièce", "Surface (m²)", "Périmètre (m)", "Type de sol"],
    ];
    result.rooms.forEach(r => {
      let perim = 0;
      if (r.polygon_norm && r.polygon_norm.length >= 3 && ppmRx && ppmRx > 0) {
        perim = polygonPerimeterM(r.polygon_norm, iwx, ihx, ppmRx);
      }
      const stName = r.surfaceTypeId ? (editorSurfaceTypes.find(st => st.id === r.surfaceTypeId)?.name ?? r.surfaceTypeId) : "—";
      data.push([r.label_fr, r.area_m2 != null ? +r.area_m2.toFixed(2) : 0, +perim.toFixed(2), stName]);
    });
    const totalArea = result.rooms.reduce((s, r) => s + (r.area_m2 ?? 0), 0);
    const totalPerim = result.rooms.reduce((s, r) => {
      let p = 0;
      if (r.polygon_norm && r.polygon_norm.length >= 3 && ppmRx && ppmRx > 0) p = polygonPerimeterM(r.polygon_norm, iwx, ihx, ppmRx);
      else if (r.perimeter_m && r.perimeter_m > 0) p = r.perimeter_m;
      return s + p;
    }, 0);
    data.push([]);
    data.push(["TOTAL", +totalArea.toFixed(2), +totalPerim.toFixed(2), ""]);
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, "Pièces");
    XLSX.writeFile(wb, `floorscan_pieces_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast({ title: "Export XLSX ✓", variant: "success" });
  };

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
          <div className="relative">
            <Button onClick={() => setExportOpen(v => !v)} variant="outline">
              <Download className="w-4 h-4" /> Export <ChevronDown className="w-3 h-3 ml-1" />
            </Button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-40 bg-slate-900 border border-white/10 rounded-lg shadow-xl py-1 min-w-[180px]">
                  <button onClick={() => {
                    if (!measurements) {
                      if (!confirm("⚠️ Attention : vous n'êtes pas passé par la phase de validation (Mask Editor). Les données exportées sont les résultats bruts de l'IA.\n\nExporter quand même ?")) return;
                    }
                    handleExportXLSX(); setExportOpen(false);
                  }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors">
                    <Table2 className="w-4 h-4" /> XLSX
                  </button>
                  <button onClick={() => { window.print(); setExportOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors">
                    <Printer className="w-4 h-4" /> {d("btn_print")}
                  </button>
                  <button onClick={() => { setRapportOpen(true); setExportOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors">
                    <FileDown className="w-4 h-4" /> {d("rap_btn" as DTKey)}
                  </button>
                </div>
              </>
            )}
          </div>
          <Button onClick={onGoEditor}>
            <Edit3 className="w-4 h-4" /> {d("re_editor")}
          </Button>
          {onGoChantier && (
            <Button onClick={onGoChantier} variant="outline" className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10">
              <ClipboardList className="w-4 h-4" /> Chantier
            </Button>
          )}
        </div>
      </div>

      {/* Multi-page tab bar */}
      {pageCount != null && pageCount > 1 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {Array.from({ length: pageCount }, (_, i) => {
            const isAnalyzed = analyzedPages?.includes(i);
            const isCurrent = currentPage === i;
            return (
              <button key={i} onClick={() => isAnalyzed && onSwitchPage?.(i)} disabled={!isAnalyzed}
                className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                  isCurrent ? "bg-sky-500/20 text-sky-400 border-sky-500/40"
                  : isAnalyzed ? "bg-white/5 text-slate-300 border-white/10 hover:bg-white/10 cursor-pointer"
                  : "bg-white/[0.02] text-slate-600 border-white/5 cursor-not-allowed")}>
                {d("mp_page" as DTKey)} {i + 1}
                {isAnalyzed && !isCurrent && <span className="text-emerald-400 text-[10px]">✓</span>}
              </button>
            );
          })}
          {onAddPage && (
            <button onClick={onAddPage} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-sky-400 border border-sky-500/20 hover:bg-sky-500/10 transition-colors">
              {d("mp_add_page" as DTKey)}
            </button>
          )}
        </div>
      )}

      {/* KPIs */}
      {(() => {
        const kpis = [
          { Icon: DoorOpen,      label: d("re_doors" as DTKey),      value: result.doors_count,                color: "#a78bfa" },
          { Icon: AppWindow,     label: d("re_windows" as DTKey),    value: result.windows_count,              color: "#38bdf8" },
          ...(result.french_doors_count ? [{ Icon: ArrowLeftRight, label: "Portes-fenêtres", value: result.french_doors_count, color: "#fb923c" }] : []),
          { Icon: Home,          label: d("re_living" as DTKey),     value: fmt(sf.area_hab_m2, 1, " m²"),    color: "#34d399" },
          { Icon: Ruler,         label: d("re_walls_area" as DTKey), value: fmt(sf.area_walls_m2, 1, " m²"),  color: "#60a5fa" },
        ];
        return (
          <div className={`grid grid-cols-2 ${result.french_doors_count ? "sm:grid-cols-3 md:grid-cols-5" : "sm:grid-cols-2 md:grid-cols-4"} gap-3 mb-6`}>
            {kpis.map(({ Icon, label, value, color }) => (
              <div key={label} className="relative glass rounded-2xl border border-white/[0.07] p-4 overflow-hidden">
                <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full blur-2xl pointer-events-none opacity-20" style={{ background: color }} />
                <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-3" style={{ background: `${color}22` }}>
                  <Icon className="w-4 h-4" style={{ color }} />
                </div>
                <div className="text-3xl font-bold text-white leading-none mb-1.5" style={{ fontFamily: "ui-monospace, 'SF Mono', monospace", fontVariantNumeric: "tabular-nums" }}>
                  {value}
                </div>
                <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">{label}</div>
                <div className="absolute bottom-0 left-0 h-[2px] w-2/5 rounded-full" style={{ background: `linear-gradient(to right, ${color}99, transparent)` }} />
              </div>
            ))}
          </div>
        );
      })()}

      {/* Custom detections KPIs */}
      {hasDetections && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {customDetections.map((det) => (
            <div key={det.id} className="glass rounded-xl border border-white/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: det.color }} />
                <p className="text-xs text-slate-500">{det.label}</p>
              </div>
              <p className="text-3xl font-bold" style={{ color: det.color, fontFamily: "ui-monospace, 'SF Mono', monospace", fontVariantNumeric: "tabular-nums" }}>
                ×{det.count}
              </p>
              {det.total_area_m2 !== null && (<p className="text-xs text-slate-500 mt-1">{det.total_area_m2.toFixed(2)} m²</p>)}
            </div>
          ))}
        </div>
      )}

      {/* Comptage (from editor) */}
      {countCategories.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {countCategories.map((cat, i) => (
            <div key={i} className="glass rounded-xl border border-white/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                <p className="text-xs text-slate-500">{cat.name}</p>
              </div>
              <p className="text-3xl font-bold" style={{ color: cat.color, fontFamily: "ui-monospace, 'SF Mono', monospace", fontVariantNumeric: "tabular-nums" }}>
                ×{cat.count}
              </p>
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
                      : "bg-red-500/20 text-red-400")}>
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
        {/* Toggle buttons */}
        <div className="flex gap-2 flex-wrap mb-4 items-center">
          {result.mask_doors_b64 && (
            <button onClick={() => setShowDoors(v => !v)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showDoors ? "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30" : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10")}>
              {showDoors ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("re_doors")}
            </button>
          )}
          {result.mask_windows_b64 && (
            <button onClick={() => setShowWindows(v => !v)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showWindows ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10")}>
              {showWindows ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("re_windows")}
            </button>
          )}
          {result.mask_french_doors_b64 && (
            <button onClick={() => setShowFrenchDoors(v => !v)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showFrenchDoors ? "bg-orange-500/15 text-orange-400 border-orange-500/30" : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10")}>
              {showFrenchDoors ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} Portes-fenêtres
            </button>
          )}
          {result.mask_walls_ai_b64 && (
            <button onClick={() => setShowWalls(v => !v)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showWalls ? "bg-amber-500/15 text-amber-400 border-amber-500/30" : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10")}>
              {showWalls ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("re_walls_area")}
            </button>
          )}
          {result.mask_cloisons_b64 && (
            <button onClick={() => setShowCloisons(v => !v)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showCloisons ? "bg-blue-500/15 text-blue-400 border-blue-500/30" : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10")}>
              {showCloisons ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("re_cloisons")}
            </button>
          )}
          {result.overlay_interior_b64 && (
            <button onClick={() => setShowInterior(v => !v)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showInterior ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10")}>
              {showInterior ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("re_tab_interior")}
            </button>
          )}

          {(hasRooms || hasDetections || hasSurfaces) && (
            <div className="w-px h-6 bg-white/10 mx-1" />
          )}

          {hasRooms && (
            <button onClick={() => setShowRoomsOverlay(v => !v)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showRoomsOverlay ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10")}>
              {showRoomsOverlay ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} {d("re_overlay_rooms")}
            </button>
          )}
          {hasDetections && (
            <button onClick={() => setShowDetectionsOverlay(v => !v)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showDetectionsOverlay ? "bg-amber-500/15 text-amber-400 border-amber-500/30" : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10")}>
              <Search className="w-3 h-3" /> {d("re_overlay_vs")}
            </button>
          )}

          {hasSurfaces && (
            <button onClick={() => setShowSurfacesOverlay(v => !v)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showSurfacesOverlay ? "bg-violet-500/15 text-violet-400 border-violet-500/30" : "text-slate-500 hover:text-slate-300 border-transparent hover:border-white/10")}>
              {showSurfacesOverlay ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              <PaintBucket className="w-3 h-3" /> Surfaces
              <span className="text-[10px] opacity-60 font-mono">{editorZones.length}</span>
            </button>
          )}

          <button onClick={() => setMeasureActive(v => !v)}
            className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
              measureActive ? "border-sky-500/40 bg-sky-500/10 text-sky-400" : "border-white/10 text-slate-500 hover:text-slate-300")}>
            <Ruler className="w-3.5 h-3.5" /> {d("meas_btn" as DTKey)}
          </button>

          {linearMeasures.length > 0 && (
            <button onClick={() => setShowLinears(v => !v)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showLinears ? "border-sky-500/40 bg-sky-500/10 text-sky-400" : "border-white/10 text-slate-500 hover:text-slate-300")}>
              <Ruler className="w-3.5 h-3.5" /> Lin&#233;aires ({linearMeasures.length})
            </button>
          )}
          {countCategories.length > 0 && (
            <button onClick={() => setShowCounts(v => !v)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showCounts ? "border-amber-500/40 bg-amber-500/10 text-amber-400" : "border-white/10 text-slate-500 hover:text-slate-300")}>
              <Hash className="w-3.5 h-3.5" /> Comptage ({countPoints.length})
            </button>
          )}
          {textAnnotations.length > 0 && (
            <button onClick={() => setShowTexts(v => !v)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showTexts ? "border-sky-500/40 bg-sky-500/10 text-sky-400" : "border-white/10 text-slate-500 hover:text-slate-300")}>
              <Type className="w-3.5 h-3.5" /> Textes ({textAnnotations.length})
            </button>
          )}
          {circleMeasures.length > 0 && (
            <button onClick={() => setShowCircles(v => !v)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                showCircles ? "border-teal-500/40 bg-teal-500/10 text-teal-400" : "border-white/10 text-slate-500 hover:text-slate-300")}>
              <Circle className="w-3.5 h-3.5" /> Cercles ({circleMeasures.length})
            </button>
          )}

          <button onClick={async () => {
            const container = imgContainerRef.current;
            if (!container) return;
            try {
              const html2canvas = (await import("html2canvas")).default;
              const canvas = await html2canvas(container, { backgroundColor: "#0d1117", scale: 2, useCORS: true });
              const a = document.createElement("a");
              a.href = canvas.toDataURL("image/png");
              a.download = `floorscan_plan_${new Date().toISOString().slice(0, 10)}.png`;
              a.click();
              toast({ title: "Image téléchargée avec les masques visibles", variant: "success" });
            } catch {
              // Fallback: download raw image
              const img = document.querySelector("[data-results-image]") as HTMLImageElement;
              if (img) { const a = document.createElement("a"); a.href = img.src; a.download = `floorscan_plan_${new Date().toISOString().slice(0, 10)}.png`; a.click(); }
            }
          }} title="Télécharger l'image avec les masques affichés"
            className="px-3 py-1.5 rounded-lg text-xs font-600 border border-white/10 text-slate-500 hover:text-white transition-all flex items-center gap-1.5 ml-auto">
            <Download className="w-3.5 h-3.5" /> Image
          </button>
        </div>

        {measureActive && (
          <div className="flex items-center justify-between gap-2 mb-3 bg-sky-500/5 border border-sky-500/20 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <Ruler className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="text-xs text-sky-400/80">Cliquez deux points sur l&apos;image pour mesurer une distance. Clic droit pour d&#233;placer.</span>
            </div>
            <button onClick={() => {
              setMeasureActive(false);
              setTimeout(() => setMeasureActive(true), 50);
            }}
              className="text-xs text-red-400 hover:text-red-300 px-2 py-0.5 border border-red-500/20 rounded transition-colors shrink-0">
              Clear
            </button>
            <button onClick={() => setMeasureActive(false)}
              className="text-xs text-slate-500 hover:text-red-400 px-2 py-0.5 border border-white/10 rounded transition-colors shrink-0">
              Fermer
            </button>
          </div>
        )}

        {/* Image + overlays */}
        <div
          ref={imgContainerRef}
          className="relative rounded-xl overflow-hidden border border-white/10"
          style={{
            background: "#0d1117",
            backgroundImage: "radial-gradient(circle, rgba(148,163,184,0.13) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            minHeight: "calc(100vh - 400px)",
          }}
          onContextMenu={e => e.preventDefault()}
          onMouseDown={e => {
            if (e.button === 1 || e.button === 2 || e.altKey) {
              e.preventDefault();
              imgPanRef.current = { startX: e.clientX, startY: e.clientY, startPanX: imgPan.x, startPanY: imgPan.y };
            }
          }}
          onMouseMove={e => {
            if (!imgPanRef.current) return;
            setImgPan({ x: imgPanRef.current.startPanX + (e.clientX - imgPanRef.current.startX), y: imgPanRef.current.startPanY + (e.clientY - imgPanRef.current.startY) });
          }}
          onMouseUp={() => { imgPanRef.current = null; }}
          onMouseLeave={() => { imgPanRef.current = null; }}
        >
          {hasBaseImage ? (
            <div style={{
              position: "absolute",
              top: "50%", left: "50%",
              transform: `translate(calc(-50% + ${imgPan.x}px), calc(-50% + ${imgPan.y}px)) scale(${imgZoom})`,
              transformOrigin: "center center",
            }}>
              <div className="relative">
                <img
                  data-results-image
                  src={`data:image/png;base64,${baseImageB64}`}
                  alt="Plan"
                  className="select-none"
                  draggable={false}
                  style={{ display: "block", maxWidth: "calc(100vw - 80px)", maxHeight: "calc(100vh - 420px)", filter: "brightness(0.72) contrast(1.15) saturate(0.85)" }}
                  onLoad={(e) => setImgNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                />
                {showDoors && result.mask_doors_b64 && (
                  <div className="absolute inset-0 pointer-events-none" style={{
                    backgroundColor: "#FF00CC", opacity: 0.55,
                    WebkitMaskImage: `url(data:image/png;base64,${result.mask_doors_b64})`,
                    maskImage: `url(data:image/png;base64,${result.mask_doors_b64})`,
                    WebkitMaskSize: "100% 100%", maskSize: "100% 100%",
                    ...({ WebkitMaskMode: "luminance", maskMode: "luminance" } as any), zIndex: 1,
                  }} />
                )}
                {showWindows && result.mask_windows_b64 && (
                  <div className="absolute inset-0 pointer-events-none" style={{
                    backgroundColor: "#00CCFF", opacity: 0.55,
                    WebkitMaskImage: `url(data:image/png;base64,${result.mask_windows_b64})`,
                    maskImage: `url(data:image/png;base64,${result.mask_windows_b64})`,
                    WebkitMaskSize: "100% 100%", maskSize: "100% 100%",
                    ...({ WebkitMaskMode: "luminance", maskMode: "luminance" } as any), zIndex: 1,
                  }} />
                )}
                {showFrenchDoors && result.mask_french_doors_b64 && (
                  <img src={`data:image/png;base64,${result.mask_french_doors_b64}`} alt="" className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }} />
                )}
                {showWalls && result.mask_walls_ai_b64 && (
                  <img src={`data:image/png;base64,${result.mask_walls_ai_b64}`} alt="" className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }} />
                )}
                {showCloisons && result.mask_cloisons_b64 && (
                  <img src={`data:image/png;base64,${result.mask_cloisons_b64}`} alt="" className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 3 }} />
                )}

                {(showRoomsOverlay || showDetectionsOverlay || (showSurfacesOverlay && hasSurfaces)) && (
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox={`0 0 ${imgNatural.w} ${imgNatural.h}`}
                    preserveAspectRatio="xMidYMid meet"
                    style={{ zIndex: 2 }}
                  >
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
                          <polygon points={poly.map(p => `${p.x * imgNatural.w},${p.y * imgNatural.h}`).join(" ")}
                            fill={color + "28"} stroke={color} strokeWidth={Math.max(1.5, imgNatural.w * 0.001)} strokeLinejoin="round" opacity={0.85} />
                          <rect x={rcx - pw / 2} y={rcy - ph / 2} width={pw} height={ph} rx={4} fill="rgba(10,16,32,0.92)" stroke={color} strokeWidth={1.5} />
                          <text x={rcx} y={areaStr ? rcy - ph / 2 + fs + 2 : rcy + fs * 0.35} fontSize={fs} fill={color} textAnchor="middle" fontWeight="700" fontFamily="system-ui,sans-serif">
                            {room.label_fr}
                          </text>
                          {areaStr && (
                            <text x={rcx} y={rcy - ph / 2 + fs + measFontSize + 5} fontSize={measFontSize} fill="#94a3b8" textAnchor="middle" fontWeight="500" fontFamily="monospace">
                              {areaStr}
                            </text>
                          )}
                        </g>
                      );
                    })}

                    {showDetectionsOverlay && customDetections.map(det =>
                      det.matches.map((m, i) => (
                        <rect key={`${det.id}-${i}`}
                          x={m.x_norm * imgNatural.w} y={m.y_norm * imgNatural.h}
                          width={m.w_norm * imgNatural.w} height={m.h_norm * imgNatural.h}
                          fill={det.color + "25"} stroke={det.color}
                          strokeWidth={Math.max(1.5, imgNatural.w * 0.001)} rx={2} />
                      ))
                    )}

                    {showSurfacesOverlay && editorZones.map(zone => {
                      const st = editorSurfaceTypes.find((t: SurfaceType) => t.id === zone.typeId);
                      if (!st) return null;
                      const ptsSvg = zone.points.map(p => `${p.x * imgNatural.w},${p.y * imgNatural.h}`).join(" ");
                      const cx = zone.points.reduce((s, p) => s + p.x, 0) / zone.points.length * imgNatural.w;
                      const cy = zone.points.reduce((s, p) => s + p.y, 0) / zone.points.length * imgNatural.h;
                      const areaPx = polygonAreaNorm(zone.points, imgNatural.w, imgNatural.h);
                      const ppm = result.pixels_per_meter;
                      const areaM2 = ppm ? areaPx / (ppm * ppm) : null;
                      const areaStr = areaM2 != null ? `${areaM2.toFixed(2)} m²` : "";
                      const fs = 9;
                      return (
                        <g key={zone.id}>
                          <polygon points={ptsSvg} fill={st.color + "35"} stroke={st.color} strokeWidth={1.5} strokeLinejoin="round" opacity={0.9} />
                          <rect x={cx - 35} y={cy - 10} width={70} height={areaStr ? 22 : 14} rx={3} fill="rgba(10,16,32,0.92)" stroke={st.color} strokeWidth={1} />
                          <text x={cx} y={areaStr ? cy - 1 : cy + 3} textAnchor="middle" fill={st.color} fontSize={fs} fontWeight="700" fontFamily="system-ui,sans-serif">
                            {st.name}
                          </text>
                          {areaStr && (
                            <text x={cx} y={cy + 9} textAnchor="middle" fill="#94a3b8" fontSize={7} fontWeight="500" fontFamily="monospace">
                              {areaStr}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                )}

                {/* ── Measurement overlays ── */}
                {(showLinears || showCounts || showTexts || showCircles) && imgNatural.w > 0 && (
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox={`0 0 ${imgNatural.w} ${imgNatural.h}`}
                    preserveAspectRatio="xMidYMid meet"
                    style={{ zIndex: 3 }}
                  >
                    {/* Linear measurements */}
                    {showLinears && linearMeasures.map(lm => {
                      const x1 = lm.p1.x * imgNatural.w, y1 = lm.p1.y * imgNatural.h;
                      const x2 = lm.p2.x * imgNatural.w, y2 = lm.p2.y * imgNatural.h;
                      const mx = (x1+x2)/2, my = (y1+y2)/2;
                      const ppm = result.pixels_per_meter;
                      const distM = ppm ? lm.distPx / ppm : null;
                      const label = distM ? `${distM.toFixed(2)} m` : `${Math.round(lm.distPx)} px`;
                      return (
                        <g key={lm.id}>
                          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#38bdf8" strokeWidth={2} strokeDasharray="4 2" />
                          <circle cx={x1} cy={y1} r={4} fill="#38bdf8" />
                          <circle cx={x2} cy={y2} r={4} fill="#38bdf8" />
                          <rect x={mx-30} y={my-9} width={60} height={18} rx={4} fill="rgba(10,16,32,0.92)" stroke="#38bdf8" strokeWidth={1} />
                          <text x={mx} y={my+4} textAnchor="middle" fill="#38bdf8" fontSize={10} fontWeight="600" fontFamily="monospace">{label}</text>
                        </g>
                      );
                    })}

                    {/* Angle measurements */}
                    {showLinears && angleMeasures.map(am => {
                      const vx = am.vertex.x * imgNatural.w, vy = am.vertex.y * imgNatural.h;
                      const ax = am.p1.x * imgNatural.w, ay = am.p1.y * imgNatural.h;
                      const acx = am.p3.x * imgNatural.w, acy = am.p3.y * imgNatural.h;
                      return (
                        <g key={am.id}>
                          <line x1={ax} y1={ay} x2={vx} y2={vy} stroke="#f59e0b" strokeWidth={1.5} />
                          <line x1={vx} y1={vy} x2={acx} y2={acy} stroke="#f59e0b" strokeWidth={1.5} />
                          <circle cx={vx} cy={vy} r={5} fill="#f59e0b" />
                          <text x={vx+12} y={vy-8} fill="#f59e0b" fontSize={10} fontWeight="700" fontFamily="monospace">{am.angleDeg.toFixed(1)}&deg;</text>
                        </g>
                      );
                    })}

                    {/* Count points */}
                    {showCounts && countPoints.map((cp, idx) => {
                      const grp = (measurements?.countGroups ?? []).find(g => g.id === cp.groupId);
                      const color = grp?.color ?? "#fbbf24";
                      const px = cp.x * imgNatural.w, py = cp.y * imgNatural.h;
                      return (
                        <g key={cp.id}>
                          <circle cx={px} cy={py} r={12} fill={color} fillOpacity={0.4} stroke={color} strokeWidth={2} />
                          <text x={px} y={py+4} textAnchor="middle" fill="white" fontSize={9} fontWeight="800" fontFamily="monospace">{idx+1}</text>
                        </g>
                      );
                    })}

                    {/* Text annotations */}
                    {showTexts && textAnnotations.map(ta => {
                      const tpx = ta.x * imgNatural.w, tpy = ta.y * imgNatural.h;
                      const fs = ta.fontSize ?? 12;
                      const tw = ta.text.length * fs * 0.6 + 16;
                      return (
                        <g key={ta.id}>
                          <rect x={tpx-4} y={tpy-fs-2} width={tw} height={fs+10} rx={4} fill="rgba(0,0,0,0.8)" stroke={ta.color} strokeWidth={1} />
                          <text x={tpx+4} y={tpy} fill={ta.color} fontSize={fs} fontFamily="system-ui">{ta.text}</text>
                        </g>
                      );
                    })}

                    {/* Circle measurements */}
                    {showCircles && circleMeasures.map(cm => {
                      const ccx = cm.center.x * imgNatural.w, ccy = cm.center.y * imgNatural.h;
                      const ex = cm.edgePoint.x * imgNatural.w, ey = cm.edgePoint.y * imgNatural.h;
                      const r = Math.hypot(ex-ccx, ey-ccy);
                      const ppm = result.pixels_per_meter;
                      const rM = ppm ? r / ppm : null;
                      const label = rM ? `r=${rM.toFixed(2)}m` : `r=${Math.round(r)}px`;
                      return (
                        <g key={cm.id}>
                          <circle cx={ccx} cy={ccy} r={r} fill="rgba(20,184,166,0.08)" stroke="#14B8A6" strokeWidth={2} />
                          <line x1={ccx} y1={ccy} x2={ex} y2={ey} stroke="#14B8A6" strokeWidth={1} strokeDasharray="4 2" />
                          <circle cx={ccx} cy={ccy} r={3} fill="#14B8A6" />
                          <text x={ccx} y={ccy-r-8} textAnchor="middle" fill="#14B8A6" fontSize={9} fontWeight="600" fontFamily="monospace">{label}</text>
                        </g>
                      );
                    })}
                  </svg>
                )}

                <MeasureTool ppm={result.pixels_per_meter ?? null} active={measureActive} imgW={imgNatural.w} imgH={imgNatural.h} />
              </div>
            </div>
          ) : (
            <div className="text-center py-16 text-slate-600 text-sm">{d("re_no_overlay")}</div>
          )}

          {/* Floating zoom controls */}
          <div className="absolute top-3 right-3 z-20 flex items-center gap-1 glass border border-white/10 rounded-lg p-1">
            <button onClick={() => setImgZoom(z => Math.min(12, z * 1.3))} className="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors" title="Zoom +">
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setImgZoom(z => Math.max(0.5, z / 1.3))} className="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors" title="Zoom -">
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-5 bg-white/10" />
            <button onClick={() => { setImgZoom(1); setImgPan({x:0,y:0}); }} className="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors" title="Reset">
              <RotateCcw className="w-3 h-3" />
            </button>
            {Math.abs(imgZoom - 1) > 0.05 && <span className="text-[9px] text-slate-500 font-mono pl-0.5">{imgZoom.toFixed(1)}x</span>}
          </div>
        </div>
      </div>

      {/* Recap Table */}
      {(hasRooms || hasDetections) && (
        <div className="mt-6 glass rounded-xl border border-white/10">
          <button onClick={() => setRecapOpen(v => !v)}
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.02] transition-colors">
            <p className="text-xs font-mono text-accent uppercase tracking-widest">{d("recap_title")}</p>
            <div className="flex items-center gap-3">
              {!recapOpen && hasRooms && <span className="text-xs text-slate-500 font-mono">{totalRooms} pièces · {totalArea} m²</span>}
              {recapOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
            </div>
          </button>
          {recapOpen && (
            <div className="px-5 pb-5">
              {hasRooms && (
                <div className="flex justify-end mb-3">
                  <button onClick={handleExportRoomsXLSX} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
                    <Table2 className="w-3.5 h-3.5" /> XLSX Pièces
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

      {/* 3D Floor Plan View */}
      <View3dPanel result={result} imgW={imgNatural.w} imgH={imgNatural.h} />

      {/* Advanced Tools accordion */}
      <div className="mt-8 glass rounded-xl border border-white/10 overflow-hidden">
        <button onClick={() => setAdvancedOpen(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
              <Wrench className="w-3.5 h-3.5 text-accent" />
            </div>
            <div className="text-left">
              <p className="text-sm font-600 text-white">Advanced Tools</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Material estimate · DPGF · CCTP · Scenario · Schedule · Compliance · Housing · Unit/Lot · BTP Toolkit</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <span className="text-[10px] text-slate-600 border border-white/10 rounded px-1.5 py-0.5 font-mono">9 outils</span>
            {advancedOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
          </div>
        </button>
        {advancedOpen && (
          <div className="border-t border-white/5 px-1 pb-1 flex flex-col gap-0">
            <div className="pt-1"><MaterialsPanel result={result} customDetections={customDetections} /></div>
            <DpgfPanel result={result} customDetections={customDetections} />
            <CctpPanel result={result} customDetections={customDetections} />
            <ScenarioPanel result={result} customDetections={customDetections} />
            <GanttPanel result={result} customDetections={customDetections} />
            <CompliancePanel result={result} />
            <HousingPanel result={result} />
            <LotsPanel result={result} />
            <ToolkitPanel result={result} />
            <OcrPanel result={result} />
          </div>
        )}
      </div>

      {/* Multi-model comparison (admin only) */}
      {isAdmin && (
        <div className="mt-6">
          {!comparisonResult ? (
            <button onClick={async () => {
              setComparingModels(true);
              try {
                const resp = await fetch(`${BACKEND}/compare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: result.session_id }) });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                setComparisonResult(await resp.json());
              } catch (e: any) {
                toast({ title: d("cmp_error_toast"), description: e.message, variant: "error" });
              } finally { setComparingModels(false); }
            }} disabled={comparingModels}
              className={cn("w-full px-4 py-3 rounded-xl text-sm font-500 border transition-all flex items-center justify-center gap-2",
                comparingModels ? "border-amber-500/20 text-amber-400/50 cursor-wait" : "border-amber-500/30 text-amber-400 hover:bg-amber-500/10")}>
              {comparingModels ? <><Layers className="w-4 h-4" /> Comparaison en cours...</> : <><Layers className="w-4 h-4" /> {d("cmp_btn_compare")}</>}
            </button>
          ) : (
            <ComparisonPanel result={comparisonResult} basePlanB64={basePlanB64} ppm={result.pixels_per_meter} />
          )}
        </div>
      )}

      {isAdmin && <DebugPanel result={result} customDetections={customDetections} />}

      <div className="flex justify-center mt-6">
        <Button variant="ghost" onClick={onRestart}>
          <RotateCcw className="w-4 h-4" /> {d("re_restart")}
        </Button>
      </div>

      {rapportOpen && (
        <RapportDialog result={result} customDetections={customDetections} onClose={() => setRapportOpen(false)} />
      )}
    </motion.div>
  );
}
