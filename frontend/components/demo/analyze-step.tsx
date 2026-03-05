"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Brain, Loader2, ArrowRight, AlertTriangle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RoboflowConfig, AnalysisResult } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface AnalyzeStepProps {
  sessionId: string;
  config: RoboflowConfig;
  ppm?: number | null;
  onAnalyzed: (result: AnalysisResult) => void;
}

export default function AnalyzeStep({ sessionId, config, ppm, onAnalyzed }: AnalyzeStepProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);

    const steps = [
      "Passe 1 : inférence tuiles 2048px...",
      "Passe 2 : inférence tuiles 1024px...",
      "Fusion des masques...",
      "Calcul des surfaces...",
      "Génération des overlays...",
    ];
    let i = 0;
    setProgress(steps[0]);
    const interval = setInterval(() => {
      i = Math.min(i + 1, steps.length - 1);
      setProgress(steps[i]);
    }, 8000);

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
        }),
      });

      clearInterval(interval);

      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail ?? `Erreur ${r.status}`);
      }

      const data = await r.json();
      // Ajouter le session_id au résultat
      data.session_id = sessionId;

      toast({
        title: "Analyse terminée !",
        description: `${data.doors_count} portes · ${data.windows_count} fenêtres${data.surfaces?.area_hab_m2 ? ` · ${data.surfaces.area_hab_m2.toFixed(1)} m²` : ""}`,
        variant: "success",
      });

      onAnalyzed(data as AnalysisResult);
    } catch (e: any) {
      clearInterval(interval);
      setError(e.message);
      toast({ title: "Analyse échouée", description: e.message, variant: "error" });
    } finally {
      setLoading(false);
      setProgress("");
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-xl mx-auto">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-400 to-accent flex items-center justify-center mx-auto mb-4">
          <Brain className="w-8 h-8 text-white" />
        </div>
        <h2 className="font-display text-2xl font-700 text-white mb-2">Analyse IA Multi-scale</h2>
        <p className="text-slate-400 text-sm">
          Le backend lance 2 passes Roboflow (tuiles 2048px + 1024px) puis calcule les surfaces et périmètres.
          Durée estimée : 30s–3min selon la taille du plan.
        </p>
      </div>

      <div className="glass rounded-2xl border border-white/10 p-8 flex flex-col items-center gap-6">
        {/* Infos config */}
        <div className="w-full glass rounded-xl border border-white/5 p-4 text-xs font-mono text-slate-500 flex flex-col gap-2">
          <div className="flex justify-between">
            <span>Modèle</span>
            <span className="text-slate-300">{config.modelName}</span>
          </div>
          <div className="flex justify-between">
            <span>Session</span>
            <span className="text-slate-400">{sessionId.slice(0, 8)}...</span>
          </div>
          <div className="flex justify-between">
            <span>Passes</span>
            <span className="text-accent">2048px + 1024px (multi-scale)</span>
          </div>
          <div className="flex justify-between">
            <span>Échelle</span>
            <span className={ppm ? "text-accent-green" : "text-slate-500"}>
              {ppm ? `${ppm.toFixed(1)} px/m` : "auto-détection"}
            </span>
          </div>
        </div>

        {/* Loader */}
        {loading && (
          <div className="flex flex-col items-center gap-4 w-full">
            <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center">
              <Brain className="w-7 h-7 text-accent animate-pulse" />
            </div>
            <p className="text-slate-300 text-sm font-medium text-center">{progress}</p>
            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-brand-500 to-accent rounded-full animate-pulse w-3/4" />
            </div>
            <p className="text-slate-600 text-xs">Ne fermez pas cette fenêtre...</p>
          </div>
        )}

        {/* Erreur */}
        {error && (
          <div className="w-full glass rounded-xl border border-red-500/25 p-4 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-600 text-red-400 mb-1">Erreur d'analyse</p>
              <p className="text-xs text-red-300/80 leading-relaxed">{error}</p>
            </div>
          </div>
        )}

        {/* Bouton */}
        {!loading && (
          <Button onClick={runAnalysis} className="w-full" size="lg">
            <Zap className="w-4 h-4" />
            {error ? "Relancer l'analyse" : "Lancer l'analyse"}
            <ArrowRight className="w-4 h-4" />
          </Button>
        )}
      </div>
    </motion.div>
  );
}
