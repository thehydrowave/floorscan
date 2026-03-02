"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Download, Edit3, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalysisResult } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

const BACKEND = "http://localhost:8000";

interface ResultsStepProps {
  result: AnalysisResult;
  onGoEditor: () => void;
  onRestart: () => void;
}

type OverlayType = "openings" | "interior" | "mask_doors" | "mask_windows" | "mask_walls";

const OVERLAY_TABS: { key: OverlayType; label: string }[] = [
  { key: "openings", label: "Portes + Fenêtres" },
  { key: "interior", label: "Surface hab." },
  { key: "mask_doors", label: "Masque Portes" },
  { key: "mask_windows", label: "Masque Fenêtres" },
  { key: "mask_walls", label: "Masque Murs" },
];

function fmt(v: number | undefined, nd = 1, suffix = "") {
  if (v === undefined || v === null) return "—";
  return v.toFixed(nd) + suffix;
}

export default function ResultsStep({ result, onGoEditor, onRestart }: ResultsStepProps) {
  const [activeOverlay, setActiveOverlay] = useState<OverlayType>("openings");
  const [exportingPdf, setExportingPdf] = useState(false);

  const overlayB64: Record<OverlayType, string | null> = {
    openings: result.overlay_openings_b64,
    interior: result.overlay_interior_b64,
    mask_doors: result.mask_doors_b64,
    mask_windows: result.mask_windows_b64,
    mask_walls: result.mask_walls_b64,
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      const r = await fetch(`${BACKEND}/export-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: result.session_id }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? "Erreur export");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "floorscan_rapport.pdf";
      a.click(); URL.revokeObjectURL(url);
      toast({ title: "Rapport PDF téléchargé !", variant: "success" });
    } catch (e: any) {
      toast({ title: "Erreur export PDF", description: e.message, variant: "error" });
    } finally {
      setExportingPdf(false);
    }
  };

  const sf = result.surfaces ?? {};

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-xs font-mono text-accent uppercase tracking-widest mb-1">ÉTAPE 5 / 6</p>
          <h2 className="font-display text-2xl font-700 text-white">Résultats de l'analyse</h2>
        </div>
        <div className="flex gap-3">
          <Button onClick={handleExportPdf} disabled={exportingPdf} variant="outline">
            {exportingPdf ? <><Loader2 className="w-4 h-4 animate-spin" /> Export...</> : <><Download className="w-4 h-4" /> Rapport PDF</>}
          </Button>
          <Button onClick={onGoEditor}>
            <Edit3 className="w-4 h-4" /> Éditeur de masques
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "🚪 Portes", value: result.doors_count, color: "#D946EF" },
          { label: "🪟 Fenêtres", value: result.windows_count, color: "#22D3EE" },
          { label: "🏠 Surface hab.", value: fmt(sf.area_hab_m2, 1, " m²"), color: "#34D399" },
          { label: "⬜ Surface murs", value: fmt(sf.area_walls_m2, 1, " m²"), color: "#60A5FA" },
        ].map(({ label, value, color }) => (
          <div key={label} className="glass rounded-xl border border-white/10 p-4">
            <p className="text-xs text-slate-500 mb-2">{label}</p>
            <p className="text-2xl font-display font-700" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Surfaces détaillées */}
      <div className="glass rounded-xl border border-white/10 p-5 mb-6">
        <p className="text-xs font-mono text-accent uppercase tracking-widest mb-4">SURFACES & PÉRIMÈTRES</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          {[
            { label: "Emprise bâtiment", value: fmt(sf.area_building_m2, 2, " m²"), color: "#60A5FA" },
            { label: "Pourtour bâtiment", value: fmt(sf.perim_building_m, 2, " m"), color: "#60A5FA" },
            { label: "Surface murs", value: fmt(sf.area_walls_m2, 2, " m²"), color: "#D946EF" },
            { label: "Surface habitable", value: fmt(sf.area_hab_m2, 2, " m²"), color: "#34D399" },
            { label: "Pourtour habitable", value: fmt(sf.perim_interior_m, 2, " m"), color: "#34D399" },
            { label: "pixels/mètre", value: result.pixels_per_meter ? result.pixels_per_meter.toFixed(2) : "—", color: "#94a3b8" },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-slate-400">{label}</span>
              <span className="font-mono font-600" style={{ color }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Overlays */}
      <div className="glass rounded-xl border border-white/10 p-5">
        <div className="flex gap-1 flex-wrap mb-4">
          {OVERLAY_TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setActiveOverlay(key)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-600 transition-all",
                activeOverlay === key ? "bg-accent/20 text-accent border border-accent/30" : "text-slate-500 hover:text-slate-300 border border-transparent")}>
              {label}
            </button>
          ))}
        </div>

        {overlayB64[activeOverlay] ? (
          <img
            src={`data:image/png;base64,${overlayB64[activeOverlay]}`}
            alt={activeOverlay}
            className="w-full h-auto rounded-xl border border-white/10 max-h-[600px] object-contain"
          />
        ) : (
          <div className="text-center py-10 text-slate-600 text-sm">Image non disponible</div>
        )}
      </div>

      <div className="flex justify-center mt-6">
        <Button variant="ghost" onClick={onRestart}>
          <RotateCcw className="w-4 h-4" /> Analyser un autre plan
        </Button>
      </div>
    </motion.div>
  );
}
