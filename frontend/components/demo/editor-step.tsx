"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Download, RotateCcw, Loader2, AlertTriangle, PenLine, Layers, Undo2, Redo2, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalysisResult } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import MeasureCanvas from "@/components/measure/measure-canvas";
import SurfacePanel from "@/components/measure/surface-panel";
import { SurfaceType, MeasureZone, DEFAULT_SURFACE_TYPES, aggregateByType, aggregatePerimeterByType } from "@/lib/measure-types";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
type Layer = "door" | "window" | "interior";
type EditorTool = "add_rect" | "erase_rect" | "add_poly" | "erase_poly" | "sam";
type Mode = "editor" | "measure";

interface EditorStepProps {
  sessionId: string;
  initialResult: AnalysisResult;
  onRestart: () => void;
  onSessionExpired?: () => void;
}

export default function EditorStep({ sessionId, initialResult, onRestart, onSessionExpired }: EditorStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [result, setResult] = useState(initialResult);
  const [mode, setMode] = useState<Mode>("editor");
  const [layer, setLayer] = useState<Layer>("door");
  const [tool, setTool] = useState<EditorTool>("add_rect");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  // Measure state
  const [zones, setZones] = useState<MeasureZone[]>([]);
  const [surfaceTypes, setSurfaceTypes] = useState<SurfaceType[]>(DEFAULT_SURFACE_TYPES);
  const [activeTypeId, setActiveTypeId] = useState(DEFAULT_SURFACE_TYPES[0].id);
  const [imageNatural, setImageNatural] = useState({ w: 0, h: 0 });
  const [exportingMeasurePdf, setExportingMeasurePdf] = useState(false);

  // Undo / Redo (measure mode)
  const historyRef   = useRef<MeasureZone[][]>([]);
  const futureRef    = useRef<MeasureZone[][]>([]);
  const zonesSnapRef = useRef<MeasureZone[]>(zones);
  const [historyLen, setHistoryLen] = useState(0);
  const [futureLen,  setFutureLen]  = useState(0);
  useEffect(() => { zonesSnapRef.current = zones; }, [zones]);

  const pushHistory = useCallback((snapshot: MeasureZone[]) => {
    historyRef.current = [...historyRef.current.slice(-49), snapshot];
    futureRef.current  = [];
    setHistoryLen(historyRef.current.length);
    setFutureLen(0);
  }, []);

  const undoHistory = useCallback(() => {
    if (!historyRef.current.length) return;
    const prev = historyRef.current[historyRef.current.length - 1];
    futureRef.current  = [zonesSnapRef.current, ...futureRef.current.slice(0, 49)];
    historyRef.current = historyRef.current.slice(0, -1);
    setHistoryLen(historyRef.current.length);
    setFutureLen(futureRef.current.length);
    setZones(prev);
  }, []);

  const redoHistory = useCallback(() => {
    if (!futureRef.current.length) return;
    const next = futureRef.current[0];
    historyRef.current = [...historyRef.current.slice(-49), zonesSnapRef.current];
    futureRef.current  = futureRef.current.slice(1);
    setHistoryLen(historyRef.current.length);
    setFutureLen(futureRef.current.length);
    setZones(next);
  }, []);

  // Canvas (editor mode)
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const pts = useRef<[number, number][]>([]);
  const startPt = useRef({ x: 0, y: 0 });

  const currentOverlay = layer === "interior" && result.overlay_interior_b64
    ? result.overlay_interior_b64
    : result.overlay_openings_b64;

  // Track natural image size for measure tool
  useEffect(() => {
    const img = new Image();
    img.onload = () => setImageNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = `data:image/png;base64,${currentOverlay}`;
  }, [currentOverlay]);

  useEffect(() => {
    const img = imgRef.current;
    const cv = canvasRef.current;
    if (!img || !cv) return;
    const sync = () => { cv.width = img.offsetWidth; cv.height = img.offsetHeight; };
    if (img.complete) sync();
    else img.onload = sync;
  }, [currentOverlay]);

  function scaleX(px: number) {
    const img = imgRef.current!;
    return px * img.naturalWidth / img.offsetWidth;
  }
  function scaleY(py: number) {
    const img = imgRef.current!;
    return py * img.naturalHeight / img.offsetHeight;
  }

  const drawCanvas = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const isErase = tool.startsWith("erase");
    const color = isErase ? "#F87171" : (layer === "interior" ? "#34D399" : layer === "door" ? "#D946EF" : "#22D3EE");
    if (pts.current.length > 0 && (tool === "add_poly" || tool === "erase_poly")) {
      const img = imgRef.current!;
      ctx.beginPath();
      pts.current.forEach(([px, py], i) => {
        const sx = px * img.offsetWidth / img.naturalWidth;
        const sy = py * img.offsetHeight / img.naturalHeight;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
      pts.current.forEach(([px, py]) => {
        const sx = px * img.offsetWidth / img.naturalWidth;
        const sy = py * img.offsetHeight / img.naturalHeight;
        ctx.beginPath(); ctx.arc(sx, sy, 4, 0, 2 * Math.PI);
        ctx.fillStyle = "white"; ctx.fill();
      });
    }
  }, [tool, layer]);

  const sendEdit = async (params: any) => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${BACKEND}/edit-mask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, layer, ...params }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? "Erreur édition");
      const data = await r.json();
      setResult(prev => ({
        ...prev,
        overlay_openings_b64: data.overlay_openings_b64 ?? prev.overlay_openings_b64,
        overlay_interior_b64: data.overlay_interior_b64 ?? prev.overlay_interior_b64,
        mask_doors_b64: data.mask_doors_b64 ?? prev.mask_doors_b64,
        mask_windows_b64: data.mask_windows_b64 ?? prev.mask_windows_b64,
        mask_walls_b64: data.mask_walls_b64 ?? prev.mask_walls_b64,
        doors_count: data.doors_count ?? prev.doors_count,
        windows_count: data.windows_count ?? prev.windows_count,
        surfaces: data.surfaces ?? prev.surfaces,
      }));
      toast({ title: dt("ed_mask_updated", lang), variant: "success" });
    } catch (e: any) {
      if (e.message?.includes("Session introuvable")) {
        toast({ title: "Session expirée", description: "Le serveur a redémarré. Veuillez recommencer l'upload.", variant: "error" });
        onSessionExpired?.();
      } else {
        setError(e.message);
        toast({ title: "Error", description: e.message, variant: "error" });
      }
    } finally { setLoading(false); }
  };

  const sendSam = async (x: number, y: number) => {
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND}/sam-segment`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, x, y, mode: "interior", action: "add", apply_to: layer }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? "Erreur SAM");
      const data = await r.json();
      setResult(prev => ({ ...prev, ...data }));
      toast({ title: "Région segmentée ✓", variant: "success" });
    } catch (e: any) {
      if (e.message?.includes("Session introuvable")) {
        toast({ title: "Session expirée", description: "Le serveur a redémarré. Veuillez recommencer l'upload.", variant: "error" });
        onSessionExpired?.();
      } else { setError(e.message); }
    } finally { setLoading(false); }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const rx = scaleX(e.clientX - rect.left);
    const ry = scaleY(e.clientY - rect.top);
    if (tool === "sam") { sendSam(Math.round(rx), Math.round(ry)); return; }
    if (tool === "add_poly" || tool === "erase_poly") { pts.current.push([rx, ry]); drawCanvas(); return; }
    drawing.current = true;
    startPt.current = { x: rx, y: ry };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const isErase = tool.startsWith("erase");
    const color = isErase ? "#F87171" : (layer === "interior" ? "#34D399" : layer === "door" ? "#D946EF" : "#22D3EE");
    const img = imgRef.current!;
    const x0 = startPt.current.x * img.offsetWidth / img.naturalWidth;
    const y0 = startPt.current.y * img.offsetHeight / img.naturalHeight;
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([4, 2]);
    ctx.fillStyle = color + "22";
    ctx.fillRect(x0, y0, e.clientX - rect.left - x0, e.clientY - rect.top - y0);
    ctx.strokeRect(x0, y0, e.clientX - rect.left - x0, e.clientY - rect.top - y0);
    ctx.setLineDash([]);
  };

  const handleMouseUp = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const x1 = scaleX(e.clientX - rect.left);
    const y1 = scaleY(e.clientY - rect.top);
    cv.getContext("2d")!.clearRect(0, 0, cv.width, cv.height);
    if (Math.abs(x1 - startPt.current.x) > 5 || Math.abs(y1 - startPt.current.y) > 5) {
      await sendEdit({ action: tool, x0: startPt.current.x, y0: startPt.current.y, x1, y1 });
    }
  };

  const finishPoly = async () => {
    if (pts.current.length < 3) { toast({ title: "Minimum 3 points", variant: "error" }); return; }
    await sendEdit({ action: tool, points: pts.current });
    pts.current = [];
    canvasRef.current?.getContext("2d")?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      const r = await fetch(`${BACKEND}/export-pdf`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? "Erreur");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "floorscan_rapport.pdf"; a.click();
      URL.revokeObjectURL(url);
      toast({ title: dt("ed_pdf_ok", lang), variant: "success" });
    } catch (e: any) {
      toast({ title: dt("ed_pdf_err", lang), description: e.message, variant: "error" });
    } finally { setExportingPdf(false); }
  };

  // ── Export PDF Devis (mode mesure, client-side jsPDF) ──────────────────────
  const exportMeasurePdf = async () => {
    setExportingMeasurePdf(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W = 210, M = 15;
      let y = M;

      const hex2rgb = (hex: string): [number, number, number] => [
        parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16),
      ];

      // En-tête
      doc.setFillColor(15,23,42); doc.rect(0,0,W,28,"F");
      doc.setTextColor(255,255,255);
      doc.setFontSize(18); doc.setFont("helvetica","bold"); doc.text("FloorScan", M, 12);
      doc.setFontSize(9); doc.setFont("helvetica","normal");
      doc.setTextColor(148,163,184);
      doc.text("Métré & Devis de surfaces — Analyse IA", M, 18);
      doc.text(new Date().toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"}), W-M, 18, {align:"right"});
      y = 36;

      // Récap IA
      const sfData = result.surfaces ?? {};
      if (Object.values(sfData).some(v => v != null)) {
        doc.setTextColor(30,41,59); doc.setFontSize(9); doc.setFont("helvetica","bold");
        doc.text("Résultats IA", M, y); y += 5;
        doc.setFont("helvetica","normal");
        if (sfData.area_hab_m2)      { doc.text(`Surface habitable : ${sfData.area_hab_m2.toFixed(1)} m²`, M, y); y += 4; }
        if (sfData.area_building_m2) { doc.text(`Emprise bâtiment : ${sfData.area_building_m2.toFixed(1)} m²`, M, y); y += 4; }
        if (sfData.area_walls_m2)    { doc.text(`Surfaces murs : ${sfData.area_walls_m2.toFixed(1)} m²`, M, y); y += 4; }
        doc.text(`Portes : ${result.doors_count}   Fenêtres : ${result.windows_count}`, M, y); y += 8;
        doc.setDrawColor(226,232,240); doc.line(M, y, W-M, y); y += 6;
      }

      // Table zones métré
      if (zones.length > 0 && imageNatural.w > 0) {
        const totals = aggregateByType(zones, imageNatural.w, imageNatural.h, ppm);
        const ppmVal = result.pixels_per_meter ?? null;
        const perims = ppmVal ? aggregatePerimeterByType(zones, imageNatural.w, imageNatural.h, ppmVal) : {};
        const activeSurfaces = surfaceTypes.filter(t => (totals[t.id] ?? 0) > 0);
        const hasPrices = activeSurfaces.some(t => (t.pricePerM2 ?? 0) > 0);

        if (activeSurfaces.length > 0) {
          doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(30,41,59);
          doc.text("Zones de métré", M, y); y += 6;

          const cols = hasPrices && ppmVal ? [M, 70, 100, 120, 145, 170] : [M, 90, 130, 160];
          const headers = hasPrices && ppmVal
            ? ["Type","Surface","Périm.","Chute","Qté cmd","Montant HT"]
            : ["Type","Surface","Périm.","—"];

          doc.setFillColor(248,250,252); doc.rect(M, y-4, W-2*M, 8, "F");
          doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(100,116,139);
          headers.forEach((h,i) => doc.text(h, cols[i], y));
          y += 5; doc.setDrawColor(226,232,240); doc.line(M, y, W-M, y); y += 4;

          let totalHT = 0;
          doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(30,41,59);
          for (const type of activeSurfaces) {
            const area  = totals[type.id] ?? 0;
            const perim = perims[type.id] ?? 0;
            const waste = type.wastePercent ?? 10;
            const cmd   = area * (1 + waste/100);
            const lineHT = area * (type.pricePerM2 ?? 0);
            totalHT += lineHT;
            const [r,g,b] = hex2rgb(type.color);
            doc.setFillColor(r,g,b); doc.circle(cols[0]+1.5, y-1.5, 1.5, "F");
            doc.text(type.name, cols[0]+5, y);
            doc.text(ppmVal ? `${area.toFixed(2)} m²` : "—", cols[1], y);
            if (hasPrices && ppmVal) {
              doc.text(perim > 0 ? `${perim.toFixed(1)} ml` : "—", cols[2], y);
              doc.text(`+${waste}%`, cols[3], y);
              doc.text(`${cmd.toFixed(2)} m²`, cols[4], y);
              doc.text(lineHT > 0 ? `${lineHT.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} €` : "—", cols[5], y);
            } else if (ppmVal) {
              doc.text(perim > 0 ? `${perim.toFixed(1)} ml` : "—", cols[2], y);
            }
            y += 5;
            if (y > 265) { doc.addPage(); y = M; }
          }

          if (hasPrices && totalHT > 0) {
            doc.setDrawColor(226,232,240); doc.line(M, y, W-M, y); y += 4;
            doc.setFont("helvetica","bold"); doc.setFontSize(9);
            doc.text("Total HT", W-M-50, y);
            doc.text(`${totalHT.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} €`, W-M, y, {align:"right"});
          }
        }
      }

      // Pied de page
      doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(148,163,184);
      doc.text("Généré par FloorScan · floorscan.app", W/2, 292, {align:"center"});

      doc.save(`floorscan_metre_${new Date().toISOString().slice(0,10)}.pdf`);
      toast({ title: "Devis PDF exporté ✓", variant: "success" });
    } catch (e: any) {
      toast({ title: "Erreur export PDF", description: e.message, variant: "error" });
    } finally {
      setExportingMeasurePdf(false);
    }
  };

  const sf = result.surfaces ?? {};
  const ppm = result.pixels_per_meter ?? null;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-xs font-mono text-accent uppercase tracking-widest mb-1">{d("ed_step_label")}</p>
          <h2 className="font-display text-2xl font-700 text-white">
            {mode === "editor" ? d("re_editor") : d("sel_met_title")}
          </h2>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Mode toggle */}
          <div className="flex glass border border-white/10 rounded-xl p-1 gap-1">
            <button
              onClick={() => setMode("editor")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${mode === "editor" ? "bg-accent text-white" : "text-slate-400 hover:text-white"}`}
            >
              <Layers className="w-3.5 h-3.5" /> {d("ed_ia_editor")}
            </button>
            <button
              onClick={() => setMode("measure")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${mode === "measure" ? "bg-accent text-white" : "text-slate-400 hover:text-white"}`}
            >
              <PenLine className="w-3.5 h-3.5" /> {d("me_step_survey")}
            </button>
          </div>

          <Button onClick={handleExportPdf} disabled={exportingPdf} variant="outline">
            {exportingPdf ? <><Loader2 className="w-4 h-4 animate-spin" /> {d("re_exporting")}</> : <><Download className="w-4 h-4" /> {d("re_pdf")}</>}
          </Button>
          <Button variant="ghost" onClick={onRestart}><RotateCcw className="w-4 h-4" /> {d("ed_restart")}</Button>
        </div>
      </div>

      {/* ── MODE ÉDITEUR ── */}
      {mode === "editor" && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          <div className="lg:col-span-3 flex flex-col gap-3">
            <div className="glass rounded-xl border border-white/10 p-3 flex gap-2 flex-wrap">
              <span className="text-xs text-slate-500 self-center font-mono mr-1">{d("ed_layer_lbl")}:</span>
              {(["door", "window", "interior"] as Layer[]).map(l => (
                <button key={l} onClick={() => setLayer(l)}
                  className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all",
                    layer === l ? "border-accent/40 bg-accent/10 text-accent" : "border-white/10 text-slate-500 hover:text-slate-300")}>
                  {l === "door" ? `🚪 ${d("ed_doors")}` : l === "window" ? `🪟 ${d("ed_windows")}` : `🏠 ${d("ed_living_s")}`}
                </button>
              ))}
              <div className="w-px bg-white/10 mx-1 self-stretch" />
              <span className="text-xs text-slate-500 self-center font-mono mr-1">{d("ed_tool_lbl")}:</span>
              {([
                { id: "add_rect", label: "+ Rectangle" },
                { id: "erase_rect", label: "− Rectangle", erase: true },
                { id: "add_poly", label: "+ Polygone" },
                { id: "erase_poly", label: "− Polygone", erase: true },
                { id: "sam", label: "🪄 SAM auto", special: true },
              ] as any[]).map(({ id, label, erase, special }) => (
                <button key={id} onClick={() => { setTool(id as EditorTool); pts.current = []; }}
                  className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all",
                    tool === id
                      ? erase ? "border-red-500/40 bg-red-500/10 text-red-400" : special ? "border-orange-500/40 bg-orange-500/10 text-orange-400" : "border-accent/40 bg-accent/10 text-accent"
                      : erase ? "border-red-500/20 text-red-500/60 hover:text-red-400" : special ? "border-orange-500/20 text-orange-500/60 hover:text-orange-400" : "border-white/10 text-slate-500 hover:text-slate-300")}>
                  {label}
                </button>
              ))}
              {(tool === "add_poly" || tool === "erase_poly") && (
                <button onClick={finishPoly} className="px-3 py-1.5 rounded-lg text-xs font-600 border border-accent-green/40 bg-accent-green/10 text-accent-green">
                  {d("ed_finish_poly")}
                </button>
              )}
            </div>

            <div className="relative glass rounded-xl border border-white/10 overflow-hidden bg-white">
              {loading && (
                <div className="absolute inset-0 bg-ink/70 flex items-center justify-center z-10">
                  <Loader2 className="w-8 h-8 text-accent animate-spin" />
                </div>
              )}
              <img ref={imgRef} src={`data:image/png;base64,${currentOverlay}`} alt="Plan"
                className="w-full h-auto block max-h-[550px] object-contain" />
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ cursor: "crosshair" }}
                onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} />
            </div>
            <p className="text-xs text-slate-600">{d("ed_canvas_hint")}</p>
          </div>

          {/* Panel résultats */}
          <div className="flex flex-col gap-4">
            {error && (
              <div className="glass rounded-xl border border-red-500/25 p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{error}</p>
              </div>
            )}
            <div className="glass rounded-xl border border-white/10 p-4">
              <p className="text-xs font-mono text-accent uppercase tracking-widest mb-3">{d("ed_ia_results")}</p>
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">🚪 {d("ed_doors")}</span>
                  <span className="font-700 text-purple-400">{result.doors_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">🪟 {d("ed_windows")}</span>
                  <span className="font-700 text-cyan-400">{result.windows_count}</span>
                </div>
                <div className="border-t border-white/5 my-1" />
                <div className="flex justify-between">
                  <span className="text-slate-500">{d("ed_living_s")}</span>
                  <span className="font-700 text-emerald-400">{sf.area_hab_m2 ? sf.area_hab_m2.toFixed(1) + " m²" : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">{d("ed_footprint")}</span>
                  <span className="font-700 text-blue-400">{sf.area_building_m2 ? sf.area_building_m2.toFixed(1) + " m²" : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">{d("ed_walls_s")}</span>
                  <span className="font-700 text-slate-300">{sf.area_walls_m2 ? sf.area_walls_m2.toFixed(1) + " m²" : "—"}</span>
                </div>
              </div>
            </div>
            <div className="glass rounded-xl border border-white/10 p-4 text-xs text-slate-600">
              <p className="font-600 text-slate-500 mb-2">{d("ed_openings_det")}</p>
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                {result.openings?.map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className={cn("w-2 h-2 rounded-full shrink-0", o.class === "door" ? "bg-purple-400" : "bg-cyan-400")} />
                    <span>{o.class === "door" ? d("door_lbl") : d("win_lbl")} #{i + 1}</span>
                    {o.length_m && <span className="ml-auto">{o.length_m.toFixed(2)}m</span>}
                  </div>
                ))}
                {(!result.openings || result.openings.length === 0) && <p>{d("ed_no_elem")}</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODE MÉTRÉ ── */}
      {mode === "measure" && (
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 min-w-0">
            {/* Toolbar mesure */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              {ppm ? (
                <span className="glass border border-white/5 rounded-lg px-2.5 py-1 font-mono text-xs text-accent">
                  {ppm.toFixed(1)} px/m — {d("ed_scale_ia")}
                </span>
              ) : (
                <span className="text-xs text-orange-400/80 glass border border-orange-500/20 rounded-lg px-3 py-1.5">
                  ⚠️ {d("ed_no_scale_warn")}
                </span>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                <button onClick={undoHistory} disabled={historyLen === 0}
                  className="glass border border-white/10 rounded-lg p-1.5 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                  title="Annuler (Ctrl+Z)">
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={redoHistory} disabled={futureLen === 0}
                  className="glass border border-white/10 rounded-lg p-1.5 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                  title="Rétablir (Ctrl+Y)">
                  <Redo2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={exportMeasurePdf} disabled={exportingMeasurePdf || zones.length === 0}
                  className="flex items-center gap-1.5 glass border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-40 transition-colors"
                  title="Exporter devis PDF">
                  {exportingMeasurePdf
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <FileDown className="w-3.5 h-3.5" />}
                  {exportingMeasurePdf ? "Génération…" : "Devis PDF"}
                </button>
              </div>
            </div>
            <MeasureCanvas
              imageB64={currentOverlay}
              imageMime="image/png"
              zones={zones}
              activeTypeId={activeTypeId}
              surfaceTypes={surfaceTypes}
              ppm={ppm}
              onZonesChange={setZones}
              onHistoryPush={pushHistory}
              onHistoryUndo={undoHistory}
              onHistoryRedo={redoHistory}
              canUndo={historyLen > 0}
              canRedo={futureLen > 0}
            />
          </div>

          <div className="lg:w-64 shrink-0">
            <SurfacePanel
              types={surfaceTypes}
              zones={zones}
              activeTypeId={activeTypeId}
              imageW={imageNatural.w}
              imageH={imageNatural.h}
              ppm={ppm}
              onTypesChange={setSurfaceTypes}
              onActiveTypeChange={setActiveTypeId}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}
