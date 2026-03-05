"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ScanLine, ArrowLeft } from "lucide-react";
import Stepper from "@/components/demo/stepper";
import ConnectStep from "@/components/demo/connect-step";
import UploadStep from "@/components/demo/upload-step";
import CropStep from "@/components/demo/crop-step";
import ScaleStep from "@/components/demo/scale-step";
import AnalyzeStep from "@/components/demo/analyze-step";
import ResultsStep from "@/components/demo/results-step";
import EditorStep from "@/components/demo/editor-step";
import { RoboflowConfig, AnalysisResult } from "@/lib/types";

const STEP_TITLES = [
  "Connexion",
  "Upload PDF",
  "Recadrer",
  "Échelle",
  "Analyse IA",
  "Résultats",
  "Éditeur",
];

export default function DemoClient() {
  const [step, setStep] = useState(1);

  // Step 1
  const [config, setConfig] = useState<RoboflowConfig | null>(null);
  // Step 2
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [uploadedImageB64, setUploadedImageB64] = useState<string | null>(null);
  // Step 4 - échelle
  const [ppm, setPpm] = useState<number | null>(null);
  // Step 5
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  const handleConnected = (cfg: RoboflowConfig) => {
    setConfig(cfg);
    setStep(2);
  };

  const handleUploaded = (sid: string, imgB64: string) => {
    setSessionId(sid);
    setUploadedImageB64(imgB64);
    setStep(3);
  };

  const handleCropped = () => {
    setStep(4);
  };

  const handleScaled = (value: number | null) => {
    setPpm(value);
    setStep(5);
  };

  const handleAnalyzed = (result: AnalysisResult) => {
    setAnalysisResult(result);
    setStep(6);
  };

  const handleGoEditor = () => setStep(7);

  const handleRestart = () => {
    setStep(2);
    setSessionId(null);
    setUploadedImageB64(null);
    setPpm(null);
    setAnalysisResult(null);
  };

  const handleFullReset = () => {
    setStep(1);
    setConfig(null);
    setSessionId(null);
    setUploadedImageB64(null);
    setPpm(null);
    setAnalysisResult(null);
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

          <div className="flex items-center gap-4">
            {sessionId && (
              <div className="hidden sm:flex items-center gap-1.5 text-xs font-mono text-slate-500 glass border border-white/5 rounded-lg px-2.5 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
                Session active
              </div>
            )}
            <div className="text-xs text-slate-500 hidden sm:block">
              Étape {step}/{STEP_TITLES.length} — {STEP_TITLES[step - 1]}
            </div>
          </div>

          <button onClick={handleFullReset} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors">
            {step === 1 ? (
              <Link href="/" className="flex items-center gap-1.5">
                <ArrowLeft className="w-4 h-4" /> Retour
              </Link>
            ) : (
              <><ArrowLeft className="w-4 h-4" /> Recommencer</>
            )}
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="mb-10">
          <Stepper currentStep={step} totalSteps={STEP_TITLES.length} />
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.25 }}
          >
            {step === 1 && <ConnectStep onConnected={handleConnected} />}
            {step === 2 && <UploadStep onUploaded={handleUploaded} />}
            {step === 3 && sessionId && (
              <CropStep
                sessionId={sessionId}
                imageB64={uploadedImageB64!}
                onCropped={handleCropped}
                onSkip={handleCropped}
              />
            )}
            {step === 4 && (
              <ScaleStep
                imageB64={uploadedImageB64!}
                onScaled={handleScaled}
              />
            )}
            {step === 5 && sessionId && config && (
              <AnalyzeStep
                sessionId={sessionId}
                config={config}
                ppm={ppm}
                onAnalyzed={handleAnalyzed}
              />
            )}
            {step === 6 && analysisResult && (
              <ResultsStep
                result={analysisResult}
                onGoEditor={handleGoEditor}
                onRestart={handleRestart}
              />
            )}
            {step === 7 && analysisResult && sessionId && (
              <EditorStep
                sessionId={sessionId}
                initialResult={analysisResult}
                onRestart={handleRestart}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="fixed inset-0 pointer-events-none -z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-64 bg-gradient-to-b from-brand-900/10 to-transparent" />
        <div className="absolute inset-0 bg-grid-pattern bg-grid-size opacity-30" />
      </div>
    </div>
  );
}
