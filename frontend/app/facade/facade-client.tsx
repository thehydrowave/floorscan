"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ScanLine, ArrowLeft, KeyRound, Upload, Crop, Ruler, Brain,
  BarChart3, PenSquare, AlertTriangle, Check,
} from "lucide-react";
import ConnectStep from "@/components/demo/connect-step";
import UploadStep from "@/components/demo/upload-step";
import CropStep from "@/components/demo/crop-step";
import ScaleStep from "@/components/demo/scale-step";
import FacadeAnalyzeStep from "@/components/facade/facade-analyze-step";
import FacadeResultsStep from "@/components/facade/facade-results-step";
import FacadeEditorStep from "@/components/facade/facade-editor-step";
import LangSwitcher from "@/components/ui/lang-switcher";
import { RoboflowConfig, FacadeAnalysisResult } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/* ── Stepper inline (réutilise le pattern du demo stepper) ── */
const STEP_ICONS = [KeyRound, Upload, Crop, Ruler, Brain, BarChart3, PenSquare];
const STEP_KEYS: DTKey[] = [
  "fa_st_connect", "fa_st_upload", "fa_st_crop",
  "fa_st_scale", "fa_st_analyze", "fa_st_results", "fa_st_editor",
];

function FacadeStepper({ currentStep }: { currentStep: number }) {
  const { lang } = useLang();
  return (
    <div className="flex items-center w-full max-w-3xl mx-auto">
      {STEP_ICONS.map((Icon, index) => {
        const stepNum = index + 1;
        const isActive = stepNum === currentStep;
        const isDone = stepNum < currentStep;
        const isLast = index === STEP_ICONS.length - 1;
        return (
          <div key={index} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-600 font-display transition-all duration-300",
                  isActive && "step-active text-white",
                  isDone && "step-done text-accent-green",
                  !isActive && !isDone && "step-inactive text-slate-500"
                )}
              >
                {isDone ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <span
                className={cn(
                  "text-xs font-medium transition-colors hidden sm:block",
                  isActive && "text-white",
                  isDone && "text-accent-green",
                  !isActive && !isDone && "text-slate-600"
                )}
              >
                {dt(STEP_KEYS[index], lang)}
              </span>
            </div>
            {!isLast && (
              <div
                className={cn(
                  "flex-1 h-px mx-2 transition-colors duration-300 -mt-5 sm:-mt-5",
                  isDone ? "bg-accent-green/40" : "bg-white/5"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Main facade client ── */
export default function FacadeClient() {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [step, setStep] = useState(1);
  // Step 1
  const [config, setConfig] = useState<RoboflowConfig | null>(null);
  // Step 2
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [uploadedImageB64, setUploadedImageB64] = useState<string | null>(null);
  // Step 4
  const [ppm, setPpm] = useState<number | null>(null);
  // Step 5-7
  const [facadeResult, setFacadeResult] = useState<FacadeAnalysisResult | null>(null);

  // Warn before leaving
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (sessionId || facadeResult) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [sessionId, facadeResult]);

  const handleConnected = (cfg: RoboflowConfig) => { setConfig(cfg); setStep(2); };

  const handleUploaded = (sid: string, imgB64: string) => {
    setSessionId(sid);
    setUploadedImageB64(imgB64);
    setStep(3);
  };

  const handleCropped = () => setStep(4);

  const handleScaled = (value: number | null) => { setPpm(value); setStep(5); };

  const handleAnalyzed = (result: FacadeAnalysisResult) => {
    setFacadeResult(result);
    setStep(6);
  };

  const handleGoEditor = () => setStep(7);

  const handleGoResults = (updatedResult: FacadeAnalysisResult) => {
    setFacadeResult(updatedResult);
    setStep(6);
  };

  const handleRestart = () => {
    setStep(2);
    setSessionId(null);
    setUploadedImageB64(null);
    setPpm(null);
    setFacadeResult(null);
  };

  const handleFullReset = () => {
    setStep(1);
    setConfig(null);
    setSessionId(null);
    setUploadedImageB64(null);
    setPpm(null);
    setFacadeResult(null);
  };

  return (
    <div className="min-h-screen bg-ink">
      {/* Top bar */}
      <div className="border-b border-white/5 glass sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-400 to-accent flex items-center justify-center">
              <ScanLine className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-display font-700 text-base text-white">
              Floor<span className="text-gradient">Scan</span>
            </span>
          </Link>

          {/* WIP badge */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-amber-500/15 border border-amber-500/30 rounded-full px-3 py-1 text-xs font-semibold text-amber-400">
              <AlertTriangle className="w-3 h-3" />
              {d("fa_wip")}
            </div>
            <LangSwitcher />
          </div>

          <Link
            href="/demo"
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> {d("bar_back")}
          </Link>
        </div>
      </div>

      {/* WIP Banner */}
      <div className="bg-amber-500/10 border-b border-amber-500/20">
        <div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center gap-2.5 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-amber-300/90">{d("fa_mock_warn")}</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Title */}
        <div className="text-center mb-6">
          <h1 className="font-display text-3xl font-700 text-white mb-1">{d("fa_title")}</h1>
          <p className="text-slate-400 text-sm">{d("fa_subtitle")}</p>
        </div>

        {/* Stepper */}
        <div className="mb-10">
          <FacadeStepper currentStep={step} />
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.25 }}
          >
            {step === 1 && <ConnectStep onConnected={handleConnected} />}
            {step === 2 && (
              <UploadStep onUploaded={handleUploaded} />
            )}
            {step === 3 && sessionId && (
              <CropStep
                sessionId={sessionId}
                imageB64={uploadedImageB64!}
                onCropped={handleCropped}
                onSkip={handleCropped}
                onSessionExpired={handleRestart}
              />
            )}
            {step === 4 && (
              <ScaleStep imageB64={uploadedImageB64!} onScaled={handleScaled} />
            )}
            {step === 5 && sessionId && uploadedImageB64 && config && (
              <FacadeAnalyzeStep
                sessionId={sessionId}
                imageB64={uploadedImageB64}
                apiKey={config.apiKey}
                ppm={ppm}
                onAnalyzed={handleAnalyzed}
              />
            )}
            {step === 6 && facadeResult && (
              <FacadeResultsStep
                result={facadeResult}
                onGoEditor={handleGoEditor}
                onRestart={handleRestart}
              />
            )}
            {step === 7 && facadeResult && (
              <FacadeEditorStep
                result={facadeResult}
                onGoResults={handleGoResults}
                onRestart={handleRestart}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none -z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-64 bg-gradient-to-b from-amber-900/10 to-transparent" />
        <div className="absolute inset-0 bg-grid-pattern bg-grid-size opacity-30" />
      </div>
    </div>
  );
}
