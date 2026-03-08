"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ScanLine, ArrowLeft, BrainCircuit, PenLine, History, X } from "lucide-react";
import Stepper from "@/components/demo/stepper";
import ConnectStep from "@/components/demo/connect-step";
import UploadStep from "@/components/demo/upload-step";
import CropStep from "@/components/demo/crop-step";
import ScaleStep from "@/components/demo/scale-step";
import AnalyzeStep from "@/components/demo/analyze-step";
import ResultsStep from "@/components/demo/results-step";
import EditorStep from "@/components/demo/editor-step";
import MeasureClient from "@/app/measure/measure-client";
import LangSwitcher from "@/components/ui/lang-switcher";
import { RoboflowConfig, AnalysisResult } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

const SESSION_STORAGE_KEY = "floorscan_ia_session_v1";

interface SavedSession {
  step: number;
  demoMode: "ia" | "measure";
  config: RoboflowConfig | null;
  sessionId: string | null;
  uploadedImageB64: string | null;
  ppm: number | null;
  analysisResult: AnalysisResult | null;
  savedAt: number;
}

function saveSession(data: Omit<SavedSession, "savedAt">) {
  try {
    // On ne sauvegarde pas les images base64 (trop lourdes) — juste les métadonnées
    const toSave: SavedSession = {
      ...data,
      uploadedImageB64: null, // trop lourd pour localStorage
      savedAt: Date.now(),
    };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(toSave));
  } catch {}
}

function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: SavedSession = JSON.parse(raw);
    // Session valide 2h max
    if (Date.now() - parsed.savedAt > 2 * 60 * 60 * 1000) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    // On ne restaure que si on a un résultat d'analyse (au moins jusqu'à l'étape résultats)
    if (!parsed.analysisResult) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch {}
}

export default function DemoClient() {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const [step, setStep] = useState(1);
  const [demoMode, setDemoMode] = useState<null | "ia" | "measure">(null);

  const STEP_TITLES = [
    d("st_connect"), d("st_upload"), d("st_crop"),
    d("st_scale"), d("st_analyze"), d("st_results"), d("st_editor"),
  ];

  // Step 1
  const [config, setConfig] = useState<RoboflowConfig | null>(null);
  // Step 2
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [uploadedImageB64, setUploadedImageB64] = useState<string | null>(null);
  // Step 4 - échelle
  const [ppm, setPpm] = useState<number | null>(null);
  // Step 5
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  // Restored session banner
  const [restoredSession, setRestoredSession] = useState<SavedSession | null>(null);
  const [showRestoreBanner, setShowRestoreBanner] = useState(false);

  // Check for saved session on mount
  useEffect(() => {
    const saved = loadSession();
    if (saved) {
      setRestoredSession(saved);
      setShowRestoreBanner(true);
    }
  }, []);

  // Auto-save session whenever key state changes
  useEffect(() => {
    if (demoMode === "ia" && (analysisResult || step > 5)) {
      saveSession({ step, demoMode, config, sessionId, uploadedImageB64, ppm, analysisResult });
    }
  }, [step, demoMode, config, sessionId, ppm, analysisResult]);

  const handleRestoreSession = () => {
    if (!restoredSession) return;
    setConfig(restoredSession.config);
    setSessionId(restoredSession.sessionId);
    setPpm(restoredSession.ppm);
    setAnalysisResult(restoredSession.analysisResult);
    // Restore to results step (6) since we don't have the image anymore
    setStep(restoredSession.analysisResult ? 6 : Math.min(restoredSession.step, 5));
    setDemoMode("ia");
    setShowRestoreBanner(false);
    setRestoredSession(null);
  };

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
    clearSession();
  };

  const handleFullReset = () => {
    setStep(1);
    setConfig(null);
    setSessionId(null);
    setUploadedImageB64(null);
    setPpm(null);
    setAnalysisResult(null);
    clearSession();
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

          <LangSwitcher />

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
                <span className="hidden sm:inline">{d("sel_ia_title")}</span>
              </button>
              <button
                onClick={() => setDemoMode("measure")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  demoMode === "measure" ? "bg-accent text-white shadow-sm" : "text-slate-400 hover:text-white"
                }`}
              >
                <PenLine className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{d("sel_met_title")}</span>
              </button>
            </div>
          )}

          {demoMode === null ? (
            <Link href="/" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors">
              <ArrowLeft className="w-4 h-4" /> {d("bar_back")}
            </Link>
          ) : (
            <button
              onClick={() => { setDemoMode(null); handleFullReset(); }}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> {d("sel_change")}
            </button>
          )}
        </div>
      </div>

      {/* Restore session banner */}
      <AnimatePresence>
        {showRestoreBanner && restoredSession && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-accent/10 border-b border-accent/20"
          >
            <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5 text-sm">
                <History className="w-4 h-4 text-accent shrink-0" />
                <span className="text-slate-300">
                  Session précédente trouvée{" "}
                  <span className="text-slate-500 text-xs">
                    ({new Date(restoredSession.savedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })})
                  </span>
                  {restoredSession.analysisResult && (
                    <span className="ml-1 text-slate-400">
                      · {restoredSession.analysisResult.doors_count} portes, {restoredSession.analysisResult.windows_count} fenêtres
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleRestoreSession}
                  className="px-3 py-1.5 bg-accent hover:bg-accent/80 text-white rounded-lg text-xs font-600 transition-colors"
                >
                  Reprendre
                </button>
                <button
                  onClick={() => { setShowRestoreBanner(false); clearSession(); }}
                  className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
                  {d("sel_title")}
                </h1>
                <p className="text-slate-400 text-lg max-w-lg mx-auto">
                  {d("sel_sub")}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
                {/* Card — Analyse IA */}
                <button
                  onClick={() => setDemoMode("ia")}
                  className="group relative text-left glass border border-white/10 rounded-3xl p-8 hover:border-accent/40 hover:bg-accent/5 transition-all duration-300 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-accent/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-3xl" />
                  <div className="relative">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent to-brand-600 flex items-center justify-center mb-6 shadow-glow-sm group-hover:shadow-glow transition-shadow">
                      <BrainCircuit className="w-7 h-7 text-white" />
                    </div>
                    <h2 className="font-display text-2xl font-700 text-white mb-3">{d("sel_ia_title")}</h2>
                    <p className="text-slate-400 text-sm leading-relaxed mb-6">{d("sel_ia_desc")}</p>
                    <div className="flex flex-wrap gap-2 mb-6">
                      {["PDF → Image", d("st_crop"), "Auto scale", "AI detection", d("st_editor")].map(tag => (
                        <span key={tag} className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-400">{tag}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 text-accent text-sm font-medium group-hover:gap-3 transition-all">
                      {d("sel_start")} <ArrowLeft className="w-4 h-4 rotate-180" />
                    </div>
                  </div>
                </button>

                {/* Card — Métré manuel */}
                <button
                  onClick={() => setDemoMode("measure")}
                  className="group relative text-left glass border border-white/10 rounded-3xl p-8 hover:border-brand-400/40 hover:bg-brand-400/5 transition-all duration-300 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-brand-400/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-3xl" />
                  <div className="relative">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center mb-6 shadow-glow-sm group-hover:shadow-glow transition-shadow">
                      <PenLine className="w-7 h-7 text-white" />
                    </div>
                    <h2 className="font-display text-2xl font-700 text-white mb-3">{d("sel_met_title")}</h2>
                    <p className="text-slate-400 text-sm leading-relaxed mb-6">{d("sel_met_desc")}</p>
                    <div className="flex flex-wrap gap-2 mb-6">
                      {[d("me_feat1"), d("me_feat2"), "Polygon & Rect", "Surface types", "Export CSV"].map(tag => (
                        <span key={tag} className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-400">{tag}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 text-brand-400 text-sm font-medium group-hover:gap-3 transition-all">
                      {d("sel_start")} <ArrowLeft className="w-4 h-4 rotate-180" />
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
                      onSessionExpired={handleRestart}
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
                      onSessionExpired={handleRestart}
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
                      onSessionExpired={handleRestart}
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
