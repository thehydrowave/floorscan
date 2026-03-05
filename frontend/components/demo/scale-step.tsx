"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Ruler, ArrowRight, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";

const PDF_DPI = 72 * 3; // zoom=3.0 utilisé lors du rendu PDF
const PRESETS = [20, 50, 100, 200, 500];

interface ScaleStepProps {
  imageB64: string;
  onScaled: (ppm: number | null) => void;
}

export default function ScaleStep({ imageB64, onScaled }: ScaleStepProps) {
  const [mode, setMode] = useState<"ratio" | "ppm">("ratio");
  const [ratioN, setRatioN] = useState(100);
  const [ppmDirect, setPpmDirect] = useState(85);

  const computedPpm =
    mode === "ratio" ? PDF_DPI / (0.0254 * ratioN) : ppmDirect;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto">
      <div className="text-center mb-6">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-400 to-accent flex items-center justify-center mx-auto mb-4">
          <Ruler className="w-8 h-8 text-white" />
        </div>
        <h2 className="font-display text-2xl font-700 text-white mb-2">Échelle du plan</h2>
        <p className="text-slate-400 text-sm">
          Entrez l'échelle du plan pour calculer les surfaces en m². Vous pouvez ignorer cette étape.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 justify-center mb-6">
        {(["ratio", "ppm"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === m
                ? "bg-accent text-white"
                : "glass text-slate-400 border border-white/10 hover:text-white"
            }`}
          >
            {m === "ratio" ? "Ratio 1:N" : "px/m direct"}
          </button>
        ))}
      </div>

      <div className="glass rounded-2xl border border-white/10 p-6 mb-6">
        {mode === "ratio" ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="text-slate-300 text-sm font-medium">1 :</span>
              <input
                type="number"
                value={ratioN}
                min={1}
                onChange={(e) => setRatioN(parseInt(e.target.value) || 100)}
                className="w-32 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-accent"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((n) => (
                <button
                  key={n}
                  onClick={() => setRatioN(n)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors ${
                    ratioN === n
                      ? "bg-accent/20 text-accent border border-accent/40"
                      : "glass border border-white/10 text-slate-400 hover:text-white"
                  }`}
                >
                  1:{n}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={ppmDirect}
              step={0.1}
              min={0.01}
              onChange={(e) => setPpmDirect(parseFloat(e.target.value) || 85)}
              className="w-40 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-accent"
            />
            <span className="text-slate-400 text-sm">px/m</span>
          </div>
        )}

        {/* Preview calculé */}
        <div className="mt-4 pt-4 border-t border-white/5 font-mono text-sm">
          <div className="flex justify-between text-slate-400 mb-1">
            <span>{mode === "ratio" ? `Échelle 1:${ratioN}` : "Valeur directe"}</span>
            <span className="text-accent">{computedPpm.toFixed(2)} px/m</span>
          </div>
          <div className="flex justify-between text-slate-500 text-xs">
            <span>px² / m²</span>
            <span>{Math.round(computedPpm ** 2).toLocaleString()} px²/m²</span>
          </div>
        </div>
      </div>

      {/* Aperçu image */}
      {imageB64 && (
        <div className="rounded-xl overflow-hidden border border-white/10 mb-6 max-h-60 flex items-center justify-center bg-white/5">
          <img
            src={`data:image/png;base64,${imageB64}`}
            alt="Plan"
            className="max-h-60 w-full object-contain"
          />
        </div>
      )}

      <div className="flex gap-3 justify-center">
        <Button variant="outline" onClick={() => onScaled(null)}>
          <SkipForward className="w-4 h-4" />
          Ignorer
        </Button>
        <Button onClick={() => onScaled(computedPpm)}>
          Valider l'échelle
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </motion.div>
  );
}
