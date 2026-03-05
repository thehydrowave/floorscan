"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Download, RotateCcw, Loader2, AlertTriangle, PenLine, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalysisResult } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import MeasureCanvas from "@/components/measure/measure-canvas";
import SurfacePanel from "@/components/measure/surface-panel";
import { SurfaceType, MeasureZone, DEFAULT_SURFACE_TYPES } from "@/lib/measure-types";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
type Layer = "door" | "window" | "interior";
type EditorTool = "add_rect" | "erase_rect" | "add_poly" | "erase_poly" | "sam";
type Mode = "editor" | "measure";

interface EditorStepProps {
  sessionId: string;
  initialResult: AnalysisResult;
  onRestart: () => void;
}

export default function EditorStep({ sessionId, initialResult, onRestart }: EditorStepProps) {
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
      setError(e.message);
      toast({ title: "Error", description: e.message, variant: "error" });
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
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
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
            {ppm && (
              <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
                <span className="glass border border-white/5 rounded-lg px-2.5 py-1 font-mono text-accent">
                  {ppm.toFixed(1)} px/m — {d("ed_scale_ia")}
                </span>
              </div>
            )}
            {!ppm && (
              <div className="mb-3 text-xs text-orange-400/80 glass border border-orange-500/20 rounded-lg px-3 py-2">
                ⚠️ {d("ed_no_scale_warn")}
              </div>
            )}
            <MeasureCanvas
              imageB64={currentOverlay}
              imageMime="image/png"
              zones={zones}
              activeTypeId={activeTypeId}
              surfaceTypes={surfaceTypes}
              ppm={ppm}
              onZonesChange={setZones}
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
