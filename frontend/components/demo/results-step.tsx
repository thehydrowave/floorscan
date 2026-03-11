"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Download, Edit3, RotateCcw, Loader2, Table2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalysisResult, CustomDetection } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface ResultsStepProps {
  result: AnalysisResult;
  customDetections?: CustomDetection[];
  onGoEditor: () => void;
  onRestart: () => void;
}

type OverlayType = "openings" | "interior" | "mask_doors" | "mask_windows" | "mask_walls";

function fmt(v: number | undefined, nd = 1, suffix = "") {
  if (v === undefined || v === null) return "—";
  return v.toFixed(nd) + suffix;
}

const ROOM_COLORS: Record<string, string> = {
  "bedroom": "#818cf8", "living room": "#34d399", "living": "#34d399",
  "kitchen": "#fb923c", "bathroom": "#22d3ee", "hallway": "#94a3b8",
  "corridor": "#94a3b8", "office": "#a78bfa", "study": "#a78bfa",
  "wc": "#fbbf24", "toilet": "#fbbf24", "dining room": "#f472b6",
  "storage": "#78716c", "closet": "#78716c", "garage": "#6b7280",
  "balcony": "#86efac", "laundry": "#67e8f9",
};
function getRoomColor(type: string) { return ROOM_COLORS[type?.toLowerCase()] ?? "#94a3b8"; }

export default function ResultsStep({ result, customDetections = [], onGoEditor, onRestart }: ResultsStepProps) {
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

    if (result.rooms && result.rooms.length > 0) {
      lines.push("");
      lines.push("=== PIÈCES DÉTECTÉES ===");
      lines.push("Type;Pièce;Surface (m²);Périmètre (m)");
      result.rooms.forEach(r => {
        lines.push(`${r.type};${r.label_fr};${r.area_m2?.toFixed(2) ?? "—"};${r.perimeter_m?.toFixed(2) ?? "—"}`);
      });
    }

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

  /** Export CSV des pièces uniquement */
  const handleExportRoomsCSV = () => {
    if (!result.rooms || result.rooms.length === 0) return;
    const lines = [
      "FloorScan — Récapitulatif des pièces",
      `Date;${new Date().toLocaleDateString("fr-FR")}`,
      "",
      "Type;Pièce;Surface (m²);Périmètre (m)",
      ...result.rooms.map(r =>
        `${r.type};${r.label_fr};${r.area_m2?.toFixed(2) ?? "—"};${r.perimeter_m?.toFixed(2) ?? "—"}`
      ),
      "",
      `Total;;${result.rooms.reduce((s, r) => s + (r.area_m2 ?? 0), 0).toFixed(2)};${result.rooms.reduce((s, r) => s + (r.perimeter_m ?? 0), 0).toFixed(2)}`,
    ];
    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `floorscan_pieces_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "CSV exporté ✓", variant: "success" });
  };

  const sf = result.surfaces ?? {};

  // Group rooms by type for recap table
  const roomsByType = (result.rooms ?? []).reduce<Record<string, typeof result.rooms>>((acc, room) => {
    const key = room.type || "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key]!.push(room);
    return acc;
  }, {});
  const totalRooms = (result.rooms ?? []).length;
  const totalArea = (result.rooms ?? []).reduce((s, r) => s + (r.area_m2 ?? 0), 0).toFixed(2);
  const totalPerim = (result.rooms ?? []).reduce((s, r) => s + (r.perimeter_m ?? 0), 0).toFixed(2);

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
          <Button onClick={() => window.print()} variant="outline" title={d("btn_print")}>
            <Printer className="w-4 h-4" /> {d("btn_print")}
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

      {/* Custom detections KPIs (visual search) */}
      {customDetections.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {customDetections.map((det) => (
            <div key={det.id} className="glass rounded-xl border border-white/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: det.color }} />
                <p className="text-xs text-slate-500">{det.label}</p>
              </div>
              <p className="text-2xl font-display font-700" style={{ color: det.color }}>×{det.count}</p>
              {det.total_area_m2 !== null && (
                <p className="text-xs text-slate-500 mt-1">{det.total_area_m2.toFixed(2)} m²</p>
              )}
            </div>
          ))}
        </div>
      )}

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
            className="w-full h-auto rounded-xl border border-white/10 max-h-[calc(100vh-200px)] object-contain"
          />
        ) : (
          <div className="text-center py-10 text-slate-600 text-sm">{d("re_no_img")}</div>
        )}
      </div>

      {/* Recap Table: Rooms + Custom Detections (after overlays) */}
      {((result.rooms && result.rooms.length > 0) || customDetections.length > 0) && (
        <div className="glass rounded-xl border border-white/10 p-5 mt-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-mono text-accent uppercase tracking-widest">{d("recap_title")}</p>
            {result.rooms && result.rooms.length > 0 && (
              <button onClick={handleExportRoomsCSV} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
                <Table2 className="w-3.5 h-3.5" /> {d("recap_csv")}
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs text-slate-500 font-600 pb-2 pr-4">{d("recap_type")}</th>
                  <th className="text-right text-xs text-slate-500 font-600 pb-2 px-2">{d("recap_count")}</th>
                  <th className="text-right text-xs text-slate-500 font-600 pb-2 px-2">{d("recap_area")}</th>
                  <th className="text-right text-xs text-slate-500 font-600 pb-2 pl-2">{d("recap_perim")}</th>
                </tr>
              </thead>
              <tbody>
                {/* Rooms by type */}
                {Object.entries(roomsByType).map(([type, rooms]) => {
                  const groupArea = rooms!.reduce((s, r) => s + (r.area_m2 ?? 0), 0);
                  const groupPerim = rooms!.reduce((s, r) => s + (r.perimeter_m ?? 0), 0);
                  const color = getRoomColor(type);
                  return (
                    <tr key={type} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                          <span className="text-slate-300 capitalize">{type}</span>
                        </div>
                        {rooms!.length > 1 && (
                          <div className="ml-5 mt-1 space-y-0.5">
                            {rooms!.map((r, i) => (
                              <div key={r.id ?? i} className="text-xs text-slate-500 flex justify-between">
                                <span>{r.label_fr}</span>
                                <span className="font-mono">{r.area_m2?.toFixed(1) ?? "—"} m²</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="text-right py-2 px-2 text-slate-300 align-top">{rooms!.length}</td>
                      <td className="text-right py-2 px-2 font-mono align-top" style={{ color }}>{groupArea.toFixed(2)} m²</td>
                      <td className="text-right py-2 pl-2 font-mono text-slate-400 align-top">{groupPerim.toFixed(2)} m</td>
                    </tr>
                  );
                })}
                {/* Custom detections (visual search) */}
                {customDetections.length > 0 && Object.keys(roomsByType).length > 0 && (
                  <tr><td colSpan={4} className="pt-3 pb-1"><div className="border-t border-white/10" /></td></tr>
                )}
                {customDetections.map((det) => (
                  <tr key={det.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: det.color }} />
                        <span className="text-slate-300">{det.label}</span>
                        <span className="text-[10px] text-slate-600 px-1.5 py-0.5 rounded bg-white/5 border border-white/5">🔍</span>
                      </div>
                    </td>
                    <td className="text-right py-2 px-2 text-slate-300 align-top">{det.count}</td>
                    <td className="text-right py-2 px-2 font-mono align-top" style={{ color: det.color }}>{det.total_area_m2 !== null ? `${det.total_area_m2.toFixed(2)} m²` : "—"}</td>
                    <td className="text-right py-2 pl-2 font-mono text-slate-400 align-top">—</td>
                  </tr>
                ))}
                {/* Total row */}
                <tr className="border-t border-white/10 font-600">
                  <td className="pt-3 text-white">{d("recap_total")}</td>
                  <td className="text-right pt-3 text-white">{totalRooms + customDetections.reduce((s, d) => s + d.count, 0)}</td>
                  <td className="text-right pt-3 font-mono text-accent">
                    {(parseFloat(totalArea) + customDetections.reduce((s, d) => s + (d.total_area_m2 ?? 0), 0)).toFixed(2)} m²
                  </td>
                  <td className="text-right pt-3 font-mono text-slate-300">{totalPerim} m</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex justify-center mt-6">
        <Button variant="ghost" onClick={onRestart}>
          <RotateCcw className="w-4 h-4" /> {d("re_restart")}
        </Button>
      </div>
    </motion.div>
  );
}
