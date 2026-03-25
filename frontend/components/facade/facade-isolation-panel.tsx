"use client";

/**
 * FacadeIsolationPanel — ITE (Isolation Thermique par l'Extérieur) + Retours de tableau.
 *
 * Calcule :
 *  • Surface mur nette (opaque) à isoler
 *  • Retours fenêtres par ouverture : linteau (W), appui (W), tableau G+D (H×2)
 *  • 3 inputs d'épaisseur configurables (linteau / appui / tableau) en cm
 *  • Totaux en m² et ml par type
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Layers3, ChevronDown, ChevronUp, AlertTriangle, Info,
  AppWindow, DoorOpen, LayoutPanelTop,
} from "lucide-react";
import { FacadeAnalysisResult, FacadeElement } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";

interface FacadeIsolationPanelProps {
  result: FacadeAnalysisResult;
}

/* ── Helpers ── */
const fmt1 = (v: number) => v.toFixed(2);
const fmtM = (v: number | null | undefined) => v != null ? `${v.toFixed(2)} m` : "—";
const fmtM2 = (v: number | null | undefined) => v != null ? `${v.toFixed(2)} m²` : "—";

/* ── Retour line for one opening ── */
interface RetourLine {
  el: FacadeElement;
  w_m: number | null;
  h_m: number | null;
  linteau_m2: number | null;
  appui_m2: number | null;
  tableau_m2: number | null;
  total_m2: number | null;
}

export default function FacadeIsolationPanel({ result }: FacadeIsolationPanelProps) {
  const { lang } = useLang();
  const isFr = lang === "fr";

  const [expanded, setExpanded] = useState(false);
  /* épaisseur en cm — 3 types indépendants */
  const [epLinteau, setEpLinteau] = useState(14);
  const [epAppui,   setEpAppui]   = useState(14);
  const [epTableau, setEpTableau] = useState(14);

  const hasPpm    = result.pixels_per_meter != null && result.pixels_per_meter > 0;
  const hasArea   = result.facade_area_m2 != null && result.facade_area_m2 > 0;

  /* ── Surface mur net ── */
  const wallNet = useMemo<number | null>(() => {
    if (result.surface_mur_net != null) return result.surface_mur_net;
    if (result.facade_area_m2 == null) return null;
    return Math.max(0, result.facade_area_m2 - (result.openings_area_m2 ?? 0));
  }, [result]);

  /* ── Opening elements (window + door only — balconies excluded) ── */
  const openings = useMemo(
    () => result.elements.filter(e => ["window", "door"].includes(e.type)),
    [result.elements],
  );

  /* ── Retours lines ── */
  const lines = useMemo<RetourLine[]>(() => {
    if (!hasPpm) return [];
    const epL = epLinteau / 100;
    const epA = epAppui   / 100;
    const epT = epTableau / 100;

    return openings.map(el => {
      const w = el.w_m ?? null;
      const h = el.h_m ?? null;
      const linteau  = w != null ? w * epL : null;
      const appui    = w != null ? w * epA : null;
      const tableau  = h != null ? h * epT * 2 : null;
      const total    =
        linteau != null && appui != null && tableau != null
          ? linteau + appui + tableau
          : null;
      return { el, w_m: w, h_m: h, linteau_m2: linteau, appui_m2: appui, tableau_m2: tableau, total_m2: total };
    });
  }, [openings, hasPpm, epLinteau, epAppui, epTableau]);

  /* ── Totals ── */
  const totLinteau = lines.reduce((s, l) => s + (l.linteau_m2 ?? 0), 0);
  const totAppui   = lines.reduce((s, l) => s + (l.appui_m2   ?? 0), 0);
  const totTableau = lines.reduce((s, l) => s + (l.tableau_m2 ?? 0), 0);
  const totRetours = totLinteau + totAppui + totTableau;

  /* ── Surface ITE totale ── */
  const iteTotal = wallNet != null ? wallNet + totRetours : null;

  /* ── Header summary ── */
  const summaryText = wallNet != null
    ? `${wallNet.toFixed(1)} m² mur + ${totRetours.toFixed(1)} m² retours`
    : isFr ? "Surface non disponible" : "Area unavailable";

  const typeLabel = (type: string) => {
    if (type === "window") return isFr ? "Fenêtre" : "Window";
    if (type === "door")   return isFr ? "Porte"   : "Door";
    return type;
  };

  const TypeIcon = ({ type }: { type: string }) => {
    if (type === "window")  return <AppWindow    className="w-3.5 h-3.5 text-blue-400" />;
    if (type === "door")    return <DoorOpen     className="w-3.5 h-3.5 text-pink-400" />;
    if (type === "balcony") return <LayoutPanelTop className="w-3.5 h-3.5 text-emerald-400" />;
    return null;
  };

  /* ── Slider row ── */
  const SliderRow = ({
    label, value, onChange, color,
  }: { label: string; value: number; onChange: (v: number) => void; color: string }) => (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-400 w-40 shrink-0">{label}</span>
      <input
        type="range" min={4} max={24} step={1} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 accent-violet-500 cursor-pointer"
      />
      <span className={cn("text-xs font-mono font-semibold w-10 text-right", color)}>
        {value} cm
      </span>
    </div>
  );

  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden">
      {/* ── Header ── */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex items-center justify-between w-full p-5 cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Layers3 className="w-5 h-5 text-violet-400" />
          <div className="text-left">
            <span className="text-white font-semibold">
              {isFr ? "ITE & Retours de tableau" : "External Insulation & Window Returns"}
            </span>
            <span className="block text-xs text-slate-400">
              {isFr
                ? "Surface isolante + retours linteau/appui/tableau"
                : "Insulation area + lintel/sill/reveal returns"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!expanded && hasArea && (
            <span className="text-xs text-slate-400 font-mono">{summaryText}</span>
          )}
          {expanded
            ? <ChevronUp   className="w-5 h-5 text-slate-400" />
            : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="isolation-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-6 space-y-5">

              {/* ── Avertissement si pas de scale ── */}
              {!hasPpm && (
                <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-300">
                    {isFr
                      ? "L'échelle (px/m) est requise pour calculer les dimensions réelles. Définissez l'échelle à l'étape précédente."
                      : "A scale (px/m) is required to compute real dimensions. Set the scale in the previous step."}
                  </p>
                </div>
              )}

              {/* ── Surface mur net banner ── */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="glass rounded-xl border border-white/5 p-4 text-center">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                    {isFr ? "Façade totale" : "Total facade"}
                  </div>
                  <div className="text-xl font-display font-700 text-white">
                    {result.facade_area_m2 != null ? `${result.facade_area_m2.toFixed(1)} m²` : "—"}
                  </div>
                </div>
                <div className="glass rounded-xl border border-white/5 p-4 text-center">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                    {isFr ? "Mur opaque net" : "Net opaque wall"}
                  </div>
                  <div className="text-xl font-display font-700 text-violet-300">
                    {wallNet != null ? `${wallNet.toFixed(1)} m²` : "—"}
                  </div>
                </div>
                <div className="glass rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 text-center">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                    {isFr ? "ITE surface totale" : "Total ITE surface"}
                  </div>
                  <div className="text-xl font-display font-700 text-violet-400">
                    {iteTotal != null ? `${iteTotal.toFixed(1)} m²` : "—"}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {isFr ? "mur + retours" : "wall + returns"}
                  </div>
                </div>
              </div>

              {/* ── Sliders épaisseur ITE ── */}
              <div className="glass rounded-xl border border-white/5 p-4 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <Info className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-xs font-semibold text-slate-300">
                    {isFr ? "Épaisseur ITE par type de retour" : "ITE thickness per return type"}
                  </span>
                </div>
                <SliderRow
                  label={isFr ? "Linteau (au-dessus)" : "Lintel (above)"}
                  value={epLinteau} onChange={setEpLinteau} color="text-sky-300"
                />
                <SliderRow
                  label={isFr ? "Appui (en-dessous)" : "Sill (below)"}
                  value={epAppui} onChange={setEpAppui} color="text-emerald-300"
                />
                <SliderRow
                  label={isFr ? "Tableau (côtés ×2)" : "Reveal (sides ×2)"}
                  value={epTableau} onChange={setEpTableau} color="text-amber-300"
                />
              </div>

              {/* ── Totaux retours ── */}
              {hasPpm && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: isFr ? "Linteau" : "Lintel",     value: totLinteau, color: "text-sky-300" },
                    { label: isFr ? "Appui"   : "Sill",       value: totAppui,   color: "text-emerald-300" },
                    { label: isFr ? "Tableau" : "Reveal",     value: totTableau, color: "text-amber-300" },
                    { label: isFr ? "Total retours" : "Total returns", value: totRetours, color: "text-violet-300" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="glass rounded-xl border border-white/5 p-3 text-center">
                      <div className="text-[10px] text-slate-500 mb-1">{label}</div>
                      <div className={cn("text-base font-display font-700", color)}>
                        {value > 0 ? `${value.toFixed(2)} m²` : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Table par ouverture ── */}
              {hasPpm && lines.length > 0 && (
                <div className="glass rounded-xl border border-white/5 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-white/5 bg-white/2">
                    <span className="text-xs font-semibold text-slate-300">
                      {isFr
                        ? `Détail par ouverture (${lines.length} éléments)`
                        : `Detail per opening (${lines.length} elements)`}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/5 text-slate-500">
                          <th className="text-left py-2 px-3 font-medium">#</th>
                          <th className="text-left py-2 px-3 font-medium">
                            {isFr ? "Type" : "Type"}
                          </th>
                          <th className="text-right py-2 px-3 font-medium">
                            {isFr ? "Larg." : "Width"}
                          </th>
                          <th className="text-right py-2 px-3 font-medium">
                            {isFr ? "Haut." : "Height"}
                          </th>
                          <th className="text-right py-2 px-3 font-medium text-sky-400">
                            {isFr ? "Linteau" : "Lintel"}
                          </th>
                          <th className="text-right py-2 px-3 font-medium text-emerald-400">
                            {isFr ? "Appui" : "Sill"}
                          </th>
                          <th className="text-right py-2 px-3 font-medium text-amber-400">
                            {isFr ? "Tableau" : "Reveal"}
                          </th>
                          <th className="text-right py-2 px-3 font-medium text-violet-300">
                            {isFr ? "Total" : "Total"}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line, idx) => (
                          <tr
                            key={line.el.id}
                            className={cn(
                              "border-b border-white/5 transition-colors hover:bg-white/3",
                              idx % 2 === 0 ? "bg-white/0" : "bg-white/[0.015]"
                            )}
                          >
                            <td className="py-2 px-3 text-slate-500 font-mono">{idx + 1}</td>
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-1.5">
                                <TypeIcon type={line.el.type} />
                                <span className="text-slate-300">{typeLabel(line.el.type)}</span>
                                {line.el.floor_level != null && (
                                  <span className="text-[10px] text-slate-600">
                                    {isFr ? `N${line.el.floor_level}` : `L${line.el.floor_level}`}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-400">
                              {fmtM(line.w_m)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-400">
                              {fmtM(line.h_m)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-sky-300">
                              {line.linteau_m2 != null ? `${fmt1(line.linteau_m2)} m²` : "—"}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-emerald-300">
                              {line.appui_m2 != null ? `${fmt1(line.appui_m2)} m²` : "—"}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-amber-300">
                              {line.tableau_m2 != null ? `${fmt1(line.tableau_m2)} m²` : "—"}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-violet-300 font-semibold">
                              {line.total_m2 != null ? `${fmt1(line.total_m2)} m²` : "—"}
                            </td>
                          </tr>
                        ))}
                        {/* Total row */}
                        <tr className="border-t border-violet-500/20 bg-violet-500/5">
                          <td colSpan={4} className="py-2 px-3 text-xs font-semibold text-slate-300">
                            {isFr ? "Total retours" : "Total returns"}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-sky-300 font-semibold">
                            {totLinteau > 0 ? `${totLinteau.toFixed(2)} m²` : "—"}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-emerald-300 font-semibold">
                            {totAppui > 0 ? `${totAppui.toFixed(2)} m²` : "—"}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-amber-300 font-semibold">
                            {totTableau > 0 ? `${totTableau.toFixed(2)} m²` : "—"}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-violet-300 font-bold">
                            {totRetours > 0 ? `${totRetours.toFixed(2)} m²` : "—"}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Cas sans échelle : afficher ouvertures sans calcul */}
              {!hasPpm && openings.length > 0 && (
                <div className="glass rounded-xl border border-white/5 p-4">
                  <p className="text-xs text-slate-400 mb-2">
                    {isFr
                      ? `${openings.length} ouverture(s) détectée(s) — échelle requise pour les dimensions`
                      : `${openings.length} opening(s) detected — scale required for dimensions`}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {openings.map(el => (
                      <div
                        key={el.id}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/10 bg-white/3 text-xs text-slate-300"
                      >
                        <TypeIcon type={el.type} />
                        {typeLabel(el.type)}
                        {el.floor_level != null && (
                          <span className="text-slate-600">
                            {isFr ? `N${el.floor_level}` : `L${el.floor_level}`}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Disclaimer */}
              <p className="text-[10px] text-slate-600 leading-relaxed">
                {isFr
                  ? "⚠ Calculs indicatifs basés sur les détections IA. Surface linteau et appui = largeur ouverture × épaisseur ITE. Tableau = hauteur ouverture × épaisseur ITE × 2 côtés. À valider avec un bureau d'études thermique."
                  : "⚠ Indicative calculations based on AI detections. Lintel/sill area = opening width × ITE thickness. Reveal = opening height × ITE thickness × 2 sides. To be validated with a thermal engineering office."}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
