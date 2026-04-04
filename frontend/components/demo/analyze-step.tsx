"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, ArrowRight, AlertTriangle, Zap,
  ScanLine, Layers, Grid3X3, Home, FileCheck,
  CheckCircle2, Clock, ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RoboflowConfig, AnalysisResult } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { BACKEND } from "@/lib/backend";

/* ── Pipeline stage definitions ─────────────────────────────────────────── */
interface Stage {
  icon: typeof Brain;
  labelKey: DTKey;
  color: string;
}

const STAGES: Stage[] = [
  { icon: ScanLine,   labelKey: "an_step_prep",   color: "#818cf8" },  // Indigo
  { icon: Brain,      labelKey: "an_step_detect",  color: "#22d3ee" },  // Cyan
  { icon: Grid3X3,    labelKey: "an_step_walls",   color: "#60a5fa" },  // Blue
  { icon: Home,       labelKey: "an_step_rooms",   color: "#34d399" },  // Emerald
  { icon: FileCheck,  labelKey: "an_step_report",  color: "#f59e0b" },  // Amber
];

// Timing schedule: when each stage starts (seconds)
const STAGE_TIMINGS = [0, 3, 8, 16, 24];

interface AnalyzeStepProps {
  sessionId: string;
  config: RoboflowConfig;
  ppm?: number | null;
  onAnalyzed: (result: AnalysisResult) => void;
  onSessionExpired?: () => void;
  onBack?: () => void;
  detectionRoi?: { x: number; y: number; w: number; h: number } | null;
}

export default function AnalyzeStep({ sessionId, config, ppm, onAnalyzed, onSessionExpired, onBack, detectionRoi }: AnalyzeStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

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

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    startTimer();

    try {
      const r = await fetch(`${BACKEND}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          roboflow_api_key: config.apiKey,
          model_id: config.modelName,
          pixels_per_meter: ppm ?? null,
          conf_min_door: 0.05,
          conf_min_win: 0.15,
          wall_thickness_m: 0.20,
          detection_roi: detectionRoi ?? null,
        }),
      });

      stopTimer();

      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail ?? `Erreur ${r.status}`);
      }

      const data = await r.json();
      data.session_id = sessionId;

      // Set all stages to complete
      setActiveStage(STAGES.length);

      toast({
        title: dt("an_done_title", lang),
        description: `${data.doors_count} ${dt("re_doors", lang).toLowerCase()} · ${data.windows_count} ${dt("re_windows", lang).toLowerCase()}${data.surfaces?.area_hab_m2 ? ` · ${data.surfaces.area_hab_m2.toFixed(1)} m²` : ""}`,
        variant: "success",
      });

      // Small delay so user sees the completed state
      setTimeout(() => onAnalyzed(data as AnalysisResult), 600);
    } catch (e: any) {
      stopTimer();
      if (e.message?.includes("Session introuvable")) {
        toast({ title: d("err_session_expired"), description: d("err_server_restarted"), variant: "error" });
        onSessionExpired?.();
      } else {
        setError(e.message);
        toast({ title: dt("an_fail", lang), description: e.message, variant: "error" });
      }
    } finally {
      setLoading(false);
    }
  };

  // Progress bar percentage (estimated from stage timing)
  const maxTime = 30; // estimated max
  const progressPct = loading
    ? Math.min(95, (elapsed / maxTime) * 100)
    : activeStage >= STAGES.length
    ? 100
    : 0;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-400 to-accent flex items-center justify-center mx-auto mb-4 shadow-glow">
          <Brain className="w-8 h-8 text-white" />
        </div>
        <h2 className="font-display text-2xl font-700 text-white mb-2">{d("an_title")}</h2>
        <p className="text-slate-400 text-sm max-w-md mx-auto">
          {loading ? d("an_noclose") : d("an_ready_go")}
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
              {/* Ready card */}
              <div className="w-full bg-gradient-to-br from-accent/5 to-brand-500/5 rounded-xl border border-accent/20 p-6 text-center">
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-3">
                  <Zap className="w-6 h-6 text-accent" />
                </div>
                <p className="text-white font-600 text-base mb-1">{d("an_ready_go")}</p>
                <p className="text-slate-400 text-sm">{d("an_ready_desc")}</p>
              </div>

              {/* Summary pills */}
              <div className="flex flex-wrap gap-2 justify-center">
                <span className="text-xs px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-slate-300 flex items-center gap-1.5">
                  <Brain className="w-3 h-3 text-accent" />
                  {d("an_step_detect")} + {d("an_step_walls")} + {d("an_step_rooms")}
                </span>
                {ppm && (
                  <span className="text-xs px-3 py-1.5 rounded-full bg-accent-green/10 border border-accent-green/20 text-accent-green flex items-center gap-1.5">
                    <CheckCircle2 className="w-3 h-3" />
                    {d("st_scale")}  ✓
                  </span>
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
                <Button onClick={runAnalysis} className="flex-1" size="lg">
                  <Zap className="w-4 h-4" />
                  {error ? d("an_relance") : d("an_launch")}
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>

              <p className="text-slate-400 text-sm text-center">{d("an_tip")}</p>
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
                      : dt(STAGES[activeStage].labelKey, lang)}
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
                        {dt(stage.labelKey, lang)}
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
