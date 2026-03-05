"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ScanLine, ArrowLeft, BrainCircuit, PenLine } from "lucide-react";
import Stepper from "@/components/demo/stepper";
import ConnectStep from "@/components/demo/connect-step";
import UploadStep from "@/components/demo/upload-step";
import CropStep from "@/components/demo/crop-step";
import ScaleStep from "@/components/demo/scale-step";
import AnalyzeStep from "@/components/demo/analyze-step";
import ResultsStep from "@/components/demo/results-step";
import EditorStep from "@/components/demo/editor-step";
import MeasureClient from "@/app/measure/measure-client";
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
  const [demoMode, setDemoMode] = useState<null | "ia" | "measure">(null);

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

          {/* Mode switcher — only shown once a mode is chosen */}
          {demoMode !== null && (
            <div className="flex items-center gap-1 glass border border-white/10 rounded-xl p-1">
              <button
                onClick={() => setDemoMode("ia")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  demoMode === "ia" ? "bg-accent text-white shadow-sm" : "text-slate-400 hover:text-white"
                }`}
              >
                <BrainCircuit className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Analyse IA</span>
              </button>
              <button
                onClick={() => setDemoMode("measure")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  demoMode === "measure" ? "bg-accent text-white shadow-sm" : "text-slate-400 hover:text-white"
                }`}
              >
                <PenLine className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Métré</span>
              </button>
            </div>
          )}

          {demoMode === null ? (
            <Link href="/" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors">
              <ArrowLeft className="w-4 h-4" /> Retour
            </Link>
          ) : (
            <button
              onClick={() => { setDemoMode(null); handleFullReset(); }}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Changer
            </button>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-10">
        <AnimatePresence mode="wait">

          {/* ── App selection screen ── */}
          {demoMode === null && (
            <motion.div
              key="select"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
            >
              <div className="text-center mb-12">
                <h1 className="font-display text-4xl font-700 text-white mb-3">
                  Choisissez votre outil
                </h1>
                <p className="text-slate-400 text-lg max-w-lg mx-auto">
                  Analysez automatiquement un plan avec l'IA, ou mesurez manuellement vos surfaces au métré.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
                {/* Card — Analyse IA */}
                <button
                  onClick={() => setDemoMode("ia")}
                  className="group relative text-left glass border border-white/10 rounded-3xl p-8 hover:border-accent/40 hover:bg-accent/5 transition-all duration-300 overflow-hidden"
                >
                  {/* Glow */}
                  <div className="absolute inset-0 bg-gradient-to-br from-accent/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-3xl" />

                  <div className="relative">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent to-brand-600 flex items-center justify-center mb-6 shadow-glow-sm group-hover:shadow-glow transition-shadow">
                      <BrainCircuit className="w-7 h-7 text-white" />
                    </div>

                    <h2 className="font-display text-2xl font-700 text-white mb-3">Analyse IA</h2>
                    <p className="text-slate-400 text-sm leading-relaxed mb-6">
                      Importez un plan PDF, recadrez et laissez l'IA détecter automatiquement les pièces, surfaces et dimensions. Exportez les résultats annotés.
                    </p>

                    <div className="flex flex-wrap gap-2 mb-6">
                      {["PDF → Image", "Recadrage", "Échelle auto", "Détection IA", "Éditeur"].map(tag => (
                        <span key={tag} className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-400">
                          {tag}
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 text-accent text-sm font-medium group-hover:gap-3 transition-all">
                      Démarrer <ArrowLeft className="w-4 h-4 rotate-180" />
                    </div>
                  </div>
                </button>

                {/* Card — Métré manuel */}
                <button
                  onClick={() => setDemoMode("measure")}
                  className="group relative text-left glass border border-white/10 rounded-3xl p-8 hover:border-brand-400/40 hover:bg-brand-400/5 transition-all duration-300 overflow-hidden"
                >
                  {/* Glow */}
                  <div className="absolute inset-0 bg-gradient-to-br from-brand-400/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-3xl" />

                  <div className="relative">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center mb-6 shadow-glow-sm group-hover:shadow-glow transition-shadow">
                      <PenLine className="w-7 h-7 text-white" />
                    </div>

                    <h2 className="font-display text-2xl font-700 text-white mb-3">Métré manuel</h2>
                    <p className="text-slate-400 text-sm leading-relaxed mb-6">
                      Importez n'importe quel plan (PDF, JPG, PNG), définissez l'échelle en 2 clics, puis dessinez vos zones par type de surface. Exportez le récapitulatif CSV.
                    </p>

                    <div className="flex flex-wrap gap-2 mb-6">
                      {["PDF, JPG, PNG", "Échelle 2 pts", "Polygone & Rect", "Types surfaces", "Export CSV"].map(tag => (
                        <span key={tag} className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-400">
                          {tag}
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 text-brand-400 text-sm font-medium group-hover:gap-3 transition-all">
                      Démarrer <ArrowLeft className="w-4 h-4 rotate-180" />
                    </div>
                  </div>
                </button>
              </div>
            </motion.div>
          )}

          {/* ── Métré flow ── */}
          {demoMode === "measure" && (
            <motion.div
              key="measure"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <MeasureClient embedded />
            </motion.div>
          )}

          {/* ── Analyse IA flow ── */}
          {demoMode === "ia" && (
            <motion.div
              key="ia"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
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
                    <ScaleStep imageB64={uploadedImageB64!} onScaled={handleScaled} />
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
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      <div className="fixed inset-0 pointer-events-none -z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-64 bg-gradient-to-b from-brand-900/10 to-transparent" />
        <div className="absolute inset-0 bg-grid-pattern bg-grid-size opacity-30" />
      </div>
    </div>
  );
}
