"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, ArrowRight, AlertTriangle, Zap, Crop, X, Scan,
  ScanLine, AppWindow, Building2, FileCheck,
  CheckCircle2, Clock, ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FacadeAnalysisResult, FacadeElement, FacadeElementType } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { BACKEND } from "@/lib/backend";

/* ── Pipeline stage definitions (facade) ───────────────────────────────── */
interface Stage {
  icon: typeof Brain;
  labelKey?: DTKey;
  labelFr: string;
  color: string;
}

const STAGES: Stage[] = [
  { icon: ScanLine,   labelKey: "fa_stage_prep",      labelFr: "Préparation",    color: "#818cf8" },  // Indigo
  { icon: Brain,      labelKey: "fa_stage_detect",     labelFr: "Détection IA",   color: "#22d3ee" },  // Cyan
  { icon: AppWindow,  labelKey: "fa_stage_windows",    labelFr: "Fenêtres",       color: "#60a5fa" },  // Blue
  { icon: Building2,  labelKey: "fa_stage_walls",      labelFr: "Murs",           color: "#34d399" },  // Emerald
  { icon: FileCheck,  labelKey: "fa_stage_report",     labelFr: "Rapport final",  color: "#f59e0b" },  // Amber
];

// Timing schedule: when each stage starts (seconds)
const STAGE_TIMINGS = [0, 3, 8, 16, 24];

interface FacadeAnalyzeStepProps {
  sessionId: string;
  imageB64: string;
  apiKey: string;
  ppm?: number | null;
  onAnalyzed: (result: FacadeAnalysisResult) => void;
  onBack?: () => void;
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
  wall_opaque: "Mur opaque",
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
  sessionId, imageB64, apiKey, ppm, onAnalyzed, onBack,
}: FacadeAnalyzeStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  /* Helper to resolve stage label (i18n key if available, else hardcoded French) */
  const stageLabel = (stage: Stage) =>
    stage.labelKey ? dt(stage.labelKey, lang) : stage.labelFr;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Update active stage based on elapsed time
  useEffect(() => {
    if (!loading) return;
    for (let i = STAGE_TIMINGS.length - 1; i >= 0; i--) {
      if (elapsed >= STAGE_TIMINGS[i]) {
        setActiveStage(i);
        break;
      }
    }
  }, [elapsed, loading]);

  const startTimer = () => {
    elapsedRef.current = 0;
    setElapsed(0);
    setActiveStage(0);
    timerRef.current = setInterval(() => {
      elapsedRef.current += 0.1;
      setElapsed(elapsedRef.current);
    }, 100);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // Progress bar percentage (estimated from stage timing)
  const maxTime = 30;
  const progressPct = loading
    ? Math.min(95, (elapsed / maxTime) * 100)
    : activeStage >= STAGES.length
    ? 100
    : 0;

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
    startTimer();

    try {
      const r = await fetch(`${BACKEND}/analyze-facade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          roboflow_api_key: apiKey,
          pixels_per_meter: ppm ?? null,
          confidence: 0.15,
          building_roi: (roiEnabled && roi) ? roi : null,
        }),
      });

      stopTimer();

      if (r.ok) {
        const data = await r.json();
        data.session_id = sessionId;

        // Set all stages to complete
        setActiveStage(STAGES.length);

        toast({
          title: d("fa_title"),
          description: `${data.windows_count} ${d("fa_windows").toLowerCase()} · ${data.doors_count} ${d("fa_doors").toLowerCase()} · ${data.floors_count} ${d("fa_floors").toLowerCase()}`,
          variant: "success",
        });

        // Small delay so user sees the completed state
        setTimeout(() => {
          setLoading(false);
          onAnalyzed(data as FacadeAnalysisResult);
        }, 600);
        return;
      }
      throw new Error("no-backend");
    } catch {
      stopTimer();
    }

    // ── Generate mock results ──
    await new Promise(res => setTimeout(res, 800));

    // Set all stages to complete for mock too
    setActiveStage(STAGES.length);

    const mockResult = generateMockFacadeResult(
      sessionId, imageB64, ppm ?? null,
      (roiEnabled && roi) ? roi : null,
    );

    toast({
      title: d("fa_title"),
      description: d("fa_no_model"),
      variant: "default",
    });

    setTimeout(() => {
      setLoading(false);
      onAnalyzed(mockResult);
    }, 600);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mx-auto mb-4 shadow-glow">
          <Brain className="w-8 h-8 text-white" />
        </div>
        <h2 className="font-display text-2xl font-700 text-white mb-2">{d("fa_title")}</h2>
        <p className="text-slate-400 text-sm max-w-md mx-auto">
          {loading ? d("an_noclose") : d("fa_subtitle")}
        </p>
      </div>

      <div className="glass rounded-2xl border border-white/10 p-6 sm:p-8">
        <AnimatePresence mode="wait">
          {/* ── Pre-launch state ── */}
          {!loading && activeStage < STAGES.length && (
            <motion.div
              key="ready"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-6"
            >
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
                    <div className="text-xs font-medium">{d("fa_roi_title" as DTKey)}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {d("fa_roi_help" as DTKey)}
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
                        {d("fa_roi_draw" as DTKey)}
                      </span>
                      {roi && (
                        <button
                          onClick={() => setRoi(null)}
                          className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-400 transition-colors"
                        >
                          <X className="w-3 h-3" /> {d("fa_roi_clear" as DTKey)}
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
                      <div className="text-[11px] text-slate-600 text-center italic">{d("fa_no_roi" as DTKey)}</div>
                    )}
                  </div>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="w-full glass rounded-xl border border-red-500/25 p-4 flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-600 text-red-400 mb-1">{d("an_err_label")}</p>
                    <p className="text-xs text-red-300/80 leading-relaxed">{error}</p>
                  </div>
                </div>
              )}

              {/* Launch button */}
              <div className="flex gap-3 w-full">
                {onBack && (
                  <Button variant="ghost" size="lg" onClick={onBack}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                )}
                <Button onClick={runAnalysis} className="flex-1 bg-amber-600 hover:bg-amber-700" size="lg">
                  <Zap className="w-4 h-4" />
                  {error ? d("an_relance") : d("an_launch")}
                  {roiEnabled && roi && <Crop className="w-3.5 h-3.5 opacity-70" />}
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>

              <p className="text-slate-600 text-xs text-center">{d("an_tip")}</p>
            </motion.div>
          )}

          {/* ── Loading / Pipeline progress ── */}
          {(loading || activeStage >= STAGES.length) && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-5"
            >
              {/* Global progress bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium">
                    {activeStage >= STAGES.length
                      ? d("an_done_title")
                      : stageLabel(STAGES[activeStage])}
                  </span>
                  <span className="text-slate-500 font-mono flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {elapsed.toFixed(1)}s
                  </span>
                </div>
                <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      background: activeStage >= STAGES.length
                        ? "linear-gradient(90deg, #34d399, #22d3ee)"
                        : `linear-gradient(90deg, ${STAGES[Math.min(activeStage, STAGES.length - 1)].color}, ${STAGES[Math.min(activeStage + 1, STAGES.length - 1)].color})`,
                    }}
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPct}%` }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                  />
                </div>
              </div>

              {/* Stage list */}
              <div className="space-y-1">
                {STAGES.map((stage, idx) => {
                  const isComplete = idx < activeStage || activeStage >= STAGES.length;
                  const isCurrent = idx === activeStage && loading;
                  const isPending = idx > activeStage && activeStage < STAGES.length;
                  const Icon = stage.icon;

                  return (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className={cn(
                        "flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300",
                        isCurrent && "bg-white/5 border border-white/10",
                        isComplete && "opacity-90",
                        isPending && "opacity-40",
                      )}
                    >
                      {/* Status icon */}
                      <div
                        className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300",
                          isComplete && "bg-accent-green/15",
                          isCurrent && "bg-white/10",
                          isPending && "bg-white/5",
                        )}
                        style={isCurrent ? { backgroundColor: `${stage.color}15` } : undefined}
                      >
                        {isComplete ? (
                          <CheckCircle2 className="w-4 h-4 text-accent-green" />
                        ) : isCurrent ? (
                          <Icon className="w-4 h-4 animate-pulse" style={{ color: stage.color }} />
                        ) : (
                          <Icon className="w-4 h-4 text-slate-600" />
                        )}
                      </div>

                      {/* Label */}
                      <span
                        className={cn(
                          "text-sm font-medium transition-colors duration-300",
                          isComplete && "text-accent-green",
                          isCurrent && "text-white",
                          isPending && "text-slate-600",
                        )}
                      >
                        {stageLabel(stage)}
                      </span>

                      {/* Active indicator */}
                      {isCurrent && (
                        <div className="ml-auto flex items-center gap-2">
                          <div className="flex gap-0.5">
                            <span className="w-1 h-1 rounded-full animate-bounce" style={{ backgroundColor: stage.color, animationDelay: "0ms" }} />
                            <span className="w-1 h-1 rounded-full animate-bounce" style={{ backgroundColor: stage.color, animationDelay: "150ms" }} />
                            <span className="w-1 h-1 rounded-full animate-bounce" style={{ backgroundColor: stage.color, animationDelay: "300ms" }} />
                          </div>
                        </div>
                      )}
                      {isComplete && (
                        <span className="ml-auto text-[10px] text-accent-green/60 font-mono">OK</span>
                      )}
                    </motion.div>
                  );
                })}
              </div>

              {/* Bottom message */}
              <div className="text-center pt-2">
                {activeStage >= STAGES.length ? (
                  <motion.p
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-accent-green font-600 text-sm flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {d("an_done_title")} — {elapsed.toFixed(1)}s
                  </motion.p>
                ) : (
                  <p className="text-slate-600 text-xs">{d("an_noclose")}</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
