"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Brain, Loader2, ArrowRight, AlertTriangle, Zap, Crop, X, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FacadeAnalysisResult, FacadeElement, FacadeElementType } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { BACKEND } from "@/lib/backend";

interface FacadeAnalyzeStepProps {
  sessionId: string;
  imageB64: string;
  apiKey: string;
  ppm?: number | null;
  onAnalyzed: (result: FacadeAnalysisResult) => void;
}

/* ── Labels français par type ── */
const LABELS_FR: Record<FacadeElementType, string> = {
  window: "Fenêtre",
  door: "Porte",
  balcony: "Balcon",
  floor_line: "Ligne d'étage",
  roof: "Toiture",
  column: "Colonne",
  other: "Autre",
};

/* ── Mock facade result generator ── */
function generateMockFacadeResult(
  sessionId: string,
  imageB64: string,
  ppm: number | null,
  roi?: { x: number; y: number; w: number; h: number } | null,
): FacadeAnalysisResult {
  const elements: FacadeElement[] = [];
  let id = 0;

  // Use ROI bounds if set, else full image
  const facadeX = roi ? roi.x + 0.02 : 0.08;
  const facadeY = roi ? roi.y + 0.02 : 0.06;
  const facadeW = roi ? roi.w - 0.04 : 0.84;
  const facadeH = roi ? roi.h - 0.04 : 0.88;

  const floorsCount = 3;
  const floorH = facadeH / floorsCount;

  for (let floor = 0; floor < floorsCount; floor++) {
    const floorY = facadeY + floor * floorH;
    const floorLevel = floorsCount - 1 - floor;

    if (floor > 0) {
      elements.push({
        id: id++,
        type: "floor_line",
        label_fr: "Ligne d'étage",
        bbox_norm: { x: facadeX, y: floorY - 0.005, w: facadeW, h: 0.01 },
        area_m2: null,
        floor_level: floorLevel + 1,
      });
    }

    const winCount = floor === 0 ? 3 : 4;
    const winW = 0.08;
    const winH = floorH * 0.45;
    const spacing = facadeW / (winCount + 1);

    for (let w = 0; w < winCount; w++) {
      const wx = facadeX + spacing * (w + 1) - winW / 2;
      const wy = floorY + floorH * 0.2;
      const areaPx2 = winW * winH;
      elements.push({
        id: id++,
        type: "window",
        label_fr: "Fenêtre",
        bbox_norm: { x: wx, y: wy, w: winW, h: winH },
        area_m2: ppm ? (areaPx2 * (1 / (ppm * ppm))) * 1e6 : null,
        floor_level: floorLevel,
        confidence: 0.85 + Math.random() * 0.12,
      });
    }

    if (floorLevel > 0 && floorLevel < floorsCount - 1) {
      const balW = 0.25;
      const balH = floorH * 0.12;
      const bx = facadeX + facadeW / 2 - balW / 2;
      const by = floorY + floorH * 0.72;
      elements.push({
        id: id++,
        type: "balcony",
        label_fr: "Balcon",
        bbox_norm: { x: bx, y: by, w: balW, h: balH },
        area_m2: ppm ? (balW * balH) / (ppm * ppm) * 1e6 : null,
        floor_level: floorLevel,
        confidence: 0.78 + Math.random() * 0.15,
      });
    }

    if (floorLevel === 0) {
      const doorW = 0.06;
      const doorH = floorH * 0.65;
      const dx = facadeX + facadeW / 2 - doorW / 2;
      const dy = floorY + floorH - doorH - 0.02;
      elements.push({
        id: id++,
        type: "door",
        label_fr: "Porte",
        bbox_norm: { x: dx, y: dy, w: doorW, h: doorH },
        area_m2: ppm ? (doorW * doorH) / (ppm * ppm) * 1e6 : null,
        floor_level: 0,
        confidence: 0.91,
      });
    }
  }

  const windows = elements.filter(e => e.type === "window");
  const doors = elements.filter(e => e.type === "door");
  const balconies = elements.filter(e => e.type === "balcony");

  const openingElements = elements.filter(e => ["window", "door", "balcony"].includes(e.type));
  const openings_area_m2 = ppm
    ? openingElements.reduce((s, e) => s + (e.area_m2 ?? 0), 0)
    : null;

  const facade_area_m2 = ppm ? (facadeW * facadeH) / (ppm * ppm) * 1e6 : null;
  const ratio_openings = facade_area_m2 && openings_area_m2
    ? openings_area_m2 / facade_area_m2
    : null;

  return {
    session_id: sessionId,
    windows_count: windows.length,
    doors_count: doors.length,
    balconies_count: balconies.length,
    floors_count: floorsCount,
    elements,
    facade_area_m2,
    openings_area_m2,
    ratio_openings,
    pixels_per_meter: ppm,
    building_roi: roi ?? { x: 0, y: 0, w: 1, h: 1 },
    overlay_b64: imageB64,
    plan_b64: imageB64,
    is_mock: true,
  };
}

/* ── ROI drawing types ── */
interface RoiRect { x: number; y: number; w: number; h: number }
interface DragState { startX: number; startY: number }

export default function FacadeAnalyzeStep({
  sessionId, imageB64, apiKey, ppm, onAnalyzed,
}: FacadeAnalyzeStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

  // ROI state
  const [roiEnabled, setRoiEnabled] = useState(false);
  const [roi, setRoi] = useState<RoiRect | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [currentDrag, setCurrentDrag] = useState<RoiRect | null>(null);

  const imgContainerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  /* ── ROI mouse handlers ── */
  const getRelPos = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const container = imgContainerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!roiEnabled) return;
    e.preventDefault();
    const pos = getRelPos(e);
    setDragState({ startX: pos.x, startY: pos.y });
    setCurrentDrag({ x: pos.x, y: pos.y, w: 0, h: 0 });
    setRoi(null);
  }, [roiEnabled, getRelPos]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState) return;
    const pos = getRelPos(e);
    const x = Math.min(dragState.startX, pos.x);
    const y = Math.min(dragState.startY, pos.y);
    const w = Math.abs(pos.x - dragState.startX);
    const h = Math.abs(pos.y - dragState.startY);
    setCurrentDrag({ x, y, w, h });
  }, [dragState, getRelPos]);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    if (!dragState) return;
    const pos = getRelPos(e);
    const x = Math.min(dragState.startX, pos.x);
    const y = Math.min(dragState.startY, pos.y);
    const w = Math.abs(pos.x - dragState.startX);
    const h = Math.abs(pos.y - dragState.startY);
    if (w > 0.02 && h > 0.02) {
      setRoi({ x, y, w, h });
    }
    setDragState(null);
    setCurrentDrag(null);
  }, [dragState, getRelPos]);

  /* ── Displayed rectangle (during drag or after) ── */
  const displayRect = currentDrag ?? roi;

  /* ── Analysis ── */
  const runAnalysis = async () => {
    setLoading(true);
    setError(null);

    const steps = [
      d("an_p1"),
      d("fa_analyzing"),
      d("an_p4"),
      d("an_p5"),
      d("an_p6"),
    ];
    let i = 0;
    setProgress(steps[0]);
    const interval = setInterval(() => {
      i = Math.min(i + 1, steps.length - 1);
      setProgress(steps[i]);
    }, 1500);

    try {
      const r = await fetch(`${BACKEND}/analyze-facade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          roboflow_api_key: apiKey,
          pixels_per_meter: ppm ?? null,
          building_roi: (roiEnabled && roi) ? roi : null,
        }),
      });

      clearInterval(interval);

      if (r.ok) {
        const data = await r.json();
        data.session_id = sessionId;
        toast({
          title: d("fa_title"),
          description: `${data.windows_count} ${d("fa_windows").toLowerCase()} · ${data.doors_count} ${d("fa_doors").toLowerCase()} · ${data.floors_count} ${d("fa_floors").toLowerCase()}`,
          variant: "success",
        });
        setLoading(false);
        setProgress("");
        onAnalyzed(data as FacadeAnalysisResult);
        return;
      }
      throw new Error("no-backend");
    } catch {
      clearInterval(interval);
    }

    // ── Generate mock results ──
    setProgress(d("fa_no_model"));
    await new Promise(res => setTimeout(res, 800));

    const mockResult = generateMockFacadeResult(
      sessionId, imageB64, ppm ?? null,
      (roiEnabled && roi) ? roi : null,
    );

    toast({
      title: d("fa_title"),
      description: d("fa_no_model"),
      variant: "default",
    });

    setLoading(false);
    setProgress("");
    onAnalyzed(mockResult);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-xl mx-auto">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mx-auto mb-4">
          <Brain className="w-8 h-8 text-white" />
        </div>
        <h2 className="font-display text-2xl font-700 text-white mb-2">{d("fa_title")}</h2>
        <p className="text-slate-400 text-sm">{d("fa_subtitle")}</p>
      </div>

      <div className="glass rounded-2xl border border-white/10 p-8 flex flex-col items-center gap-6">
        {/* Config info */}
        <div className="w-full glass rounded-xl border border-white/5 p-4 text-xs font-mono text-slate-500 flex flex-col gap-2">
          <div className="flex justify-between">
            <span>Module</span>
            <span className="text-amber-400">{d("fa_title")}</span>
          </div>
          <div className="flex justify-between">
            <span>Session</span>
            <span className="text-slate-400">{sessionId.slice(0, 8)}...</span>
          </div>
          <div className="flex justify-between">
            <span>{d("fa_st_scale")}</span>
            <span className={ppm ? "text-accent-green" : "text-slate-500"}>
              {ppm ? `${ppm.toFixed(1)} px/m` : "Auto"}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Status</span>
            <span className="text-amber-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> {d("fa_wip")}
            </span>
          </div>
        </div>

        {/* Mock warning */}
        <div className="w-full glass rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300/80 leading-relaxed">{d("fa_mock_warn")}</p>
        </div>

        {/* ── ROI Section ── */}
        <div className="w-full flex flex-col gap-3">
          {/* Toggle ROI */}
          <button
            onClick={() => { setRoiEnabled(v => !v); if (roiEnabled) { setRoi(null); } }}
            className={cn(
              "w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
              roiEnabled
                ? "border-cyan-500/40 bg-cyan-500/5 text-cyan-300"
                : "border-white/10 bg-white/2 text-slate-400 hover:border-white/20 hover:text-slate-300"
            )}
          >
            <Crop className={cn("w-4 h-4 shrink-0", roiEnabled ? "text-cyan-400" : "text-slate-500")} />
            <div className="flex-1">
              <div className="text-xs font-medium">Délimiter le bâtiment (optionnel)</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Dessinez un rectangle sur l'image pour restreindre l'analyse à une zone
              </div>
            </div>
            <div className={cn(
              "w-8 h-4 rounded-full transition-all flex items-center shrink-0",
              roiEnabled ? "bg-cyan-500 justify-end pr-0.5" : "bg-white/10 justify-start pl-0.5"
            )}>
              <div className="w-3 h-3 rounded-full bg-white" />
            </div>
          </button>

          {/* ROI Drawing Canvas */}
          {roiEnabled && (
            <div className="w-full flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500 flex items-center gap-1">
                  <Scan className="w-3 h-3 text-cyan-400" />
                  Glissez sur l'image pour délimiter
                </span>
                {roi && (
                  <button
                    onClick={() => setRoi(null)}
                    className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-400 transition-colors"
                  >
                    <X className="w-3 h-3" /> Effacer
                  </button>
                )}
              </div>

              {/* Image with ROI overlay */}
              <div
                ref={imgContainerRef}
                className="relative w-full rounded-xl overflow-hidden select-none border border-white/10"
                style={{ cursor: roiEnabled ? "crosshair" : "default" }}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={() => {
                  if (dragState && currentDrag && currentDrag.w > 0.02 && currentDrag.h > 0.02) {
                    setRoi(currentDrag);
                  }
                  setDragState(null);
                  setCurrentDrag(null);
                }}
              >
                <img
                  ref={imgRef}
                  src={`data:image/jpeg;base64,${imageB64}`}
                  alt="Facade"
                  className="w-full block"
                  draggable={false}
                />
                {/* ROI rectangle overlay */}
                {displayRect && displayRect.w > 0.005 && (
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      left:   `${displayRect.x * 100}%`,
                      top:    `${displayRect.y * 100}%`,
                      width:  `${displayRect.w * 100}%`,
                      height: `${displayRect.h * 100}%`,
                      border: "2px solid #22d3ee",
                      backgroundColor: "rgba(34,211,238,0.08)",
                      borderRadius: "2px",
                      boxShadow: "0 0 0 1px rgba(34,211,238,0.3)",
                    }}
                  />
                )}
              </div>

              {/* ROI coords display */}
              {roi && (
                <div className="text-[10px] font-mono text-cyan-400/70 bg-cyan-500/5 border border-cyan-500/20 rounded-lg px-3 py-2 flex gap-4">
                  <span>X: {(roi.x * 100).toFixed(1)}%</span>
                  <span>Y: {(roi.y * 100).toFixed(1)}%</span>
                  <span>W: {(roi.w * 100).toFixed(1)}%</span>
                  <span>H: {(roi.h * 100).toFixed(1)}%</span>
                </div>
              )}
              {!roi && (
                <div className="text-[11px] text-slate-600 text-center italic">Aucune zone définie — analyse sur toute l'image</div>
              )}
            </div>
          )}
        </div>

        {/* Loader */}
        {loading && (
          <div className="flex flex-col items-center gap-4 w-full">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center">
              <Brain className="w-7 h-7 text-amber-400 animate-pulse" />
            </div>
            <p className="text-slate-300 text-sm font-medium text-center">{progress}</p>
            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full animate-pulse w-3/4" />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="w-full glass rounded-xl border border-red-500/25 p-4 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300/80">{error}</p>
          </div>
        )}

        {/* Launch button */}
        {!loading && (
          <Button onClick={runAnalysis} className="w-full bg-amber-600 hover:bg-amber-700" size="lg">
            <Zap className="w-4 h-4" />
            {d("an_launch")}
            {roiEnabled && roi && <Crop className="w-3.5 h-3.5 opacity-70" />}
            <ArrowRight className="w-4 h-4" />
          </Button>
        )}
      </div>
    </motion.div>
  );
}
