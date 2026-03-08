"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Download, Edit3, RotateCcw, Loader2, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalysisResult } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface ResultsStepProps {
  result: AnalysisResult;
  onGoEditor: () => void;
  onRestart: () => void;
}

type OverlayType = "openings" | "interior" | "mask_doors" | "mask_windows" | "mask_walls";

function fmt(v: number | undefined, nd = 1, suffix = "") {
  if (v === undefined || v === null) return "—";
  return v.toFixed(nd) + suffix;
}

export default function ResultsStep({ result, onGoEditor, onRestart }: ResultsStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const OVERLAY_TABS: { key: OverlayType; label: string }[] = [
    { key: "openings",     label: d("re_tab_openings") },
    { key: "interior",     label: d("re_tab_interior") },
    { key: "mask_doors",   label: d("re_mask_doors")   },
    { key: "mask_windows", label: d("re_mask_windows") },
    { key: "mask_walls",   label: d("re_mask_walls")   },
  ];

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
      toast({ title: d("re_pdf_ok"), variant: "success" });
    } catch (e: any) {
      toast({ title: d("re_pdf_err"), description: e.message, variant: "error" });
    } finally {
      setExportingPdf(false);
    }
  };

  /** Export CSV des résultats IA */
  const handleExportCSV = () => {
    const sf = result.surfaces ?? {};
    const sep = ";";

    const lines = [
      "FloorScan — Résultats d'analyse IA",
      `Date;${new Date().toLocaleDateString("fr-FR")}`,
      `Session;${result.session_id ?? "—"}`,
      "",
      "=== ÉLÉMENTS DÉTECTÉS ===",
      `Portes;${result.doors_count}`,
      `Fenêtres;${result.windows_count}`,
      "",
      "=== SURFACES ===",
      `Emprise bâtiment (m²);${sf.area_building_m2?.toFixed(2) ?? "—"}`,
      `Périmètre bâtiment (m);${sf.perim_building_m?.toFixed(2) ?? "—"}`,
      `Surface habitable (m²);${sf.area_hab_m2?.toFixed(2) ?? "—"}`,
      `Périmètre intérieur (m);${sf.perim_interior_m?.toFixed(2) ?? "—"}`,
      `Surface murs (m²);${sf.area_walls_m2?.toFixed(2) ?? "—"}`,
      `Pixels/mètre;${result.pixels_per_meter?.toFixed(2) ?? "—"}`,
      "",
      "=== OUVERTURES DÉTAILLÉES ===",
      "Type;Longueur (m)",
      ...(result.openings?.map(o => `${o.class === "door" ? "Porte" : "Fenêtre"};${o.length_m?.toFixed(2) ?? "—"}`) ?? []),
    ];

    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `floorscan_analyse_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "CSV exporté ✓", variant: "success" });
  };

  const sf = result.surfaces ?? {};

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-xs font-mono text-accent uppercase tracking-widest mb-1">{d("re_step")}</p>
          <h2 className="font-display text-2xl font-700 text-white">{d("re_title")}</h2>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={handleExportCSV} variant="outline" title="Exporter CSV">
            <Table2 className="w-4 h-4" /> CSV
          </Button>
          <Button onClick={handleExportPdf} disabled={exportingPdf} variant="outline">
            {exportingPdf ? <><Loader2 className="w-4 h-4 animate-spin" /> {d("re_exporting")}</> : <><Download className="w-4 h-4" /> {d("re_pdf")}</>}
          </Button>
          <Button onClick={onGoEditor}>
            <Edit3 className="w-4 h-4" /> {d("re_editor")}
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: `🚪 ${d("re_doors")}`, value: result.doors_count, color: "#D946EF" },
          { label: `🪟 ${d("re_windows")}`, value: result.windows_count, color: "#22D3EE" },
          { label: `🏠 ${d("re_living")}`, value: fmt(sf.area_hab_m2, 1, " m²"), color: "#34D399" },
          { label: `⬜ ${d("re_walls_area")}`, value: fmt(sf.area_walls_m2, 1, " m²"), color: "#60A5FA" },
        ].map(({ label, value, color }) => (
          <div key={label} className="glass rounded-xl border border-white/10 p-4">
            <p className="text-xs text-slate-500 mb-2">{label}</p>
            <p className="text-2xl font-display font-700" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Surfaces détaillées */}
      <div className="glass rounded-xl border border-white/10 p-5 mb-6">
        <p className="text-xs font-mono text-accent uppercase tracking-widest mb-4">{d("re_detail_title")}</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          {[
            { label: d("re_footprint"),  value: fmt(sf.area_building_m2, 2, " m²"), color: "#60A5FA" },
            { label: d("re_perim_bld"),  value: fmt(sf.perim_building_m, 2, " m"),  color: "#60A5FA" },
            { label: d("re_walls_area"), value: fmt(sf.area_walls_m2, 2, " m²"),    color: "#D946EF" },
            { label: d("re_living"),     value: fmt(sf.area_hab_m2, 2, " m²"),      color: "#34D399" },
            { label: d("re_perim_int"),  value: fmt(sf.perim_interior_m, 2, " m"),  color: "#34D399" },
            { label: d("re_scale"),      value: result.pixels_per_meter ? result.pixels_per_meter.toFixed(2) : "—", color: "#94a3b8" },
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
          <div className="text-center py-10 text-slate-600 text-sm">{d("re_no_img")}</div>
        )}
      </div>

      <div className="flex justify-center mt-6">
        <Button variant="ghost" onClick={onRestart}>
          <RotateCcw className="w-4 h-4" /> {d("re_restart")}
        </Button>
      </div>
    </motion.div>
  );
}
