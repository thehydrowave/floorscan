"use client";

/**
 * FacadeIsolationPanel — ITE (Isolation Thermique par l'Extérieur) + Retours de tableau.
 *
 * Affiche EN PRIORITÉ les linéaires (ml) :
 *   • Tableau (côtés) = H × 2
 *   • Linteau (haut)  = W
 *   • Appui (bas)     = W
 * Puis les surfaces (m²) selon les épaisseurs saisies.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Layers3, ChevronDown, ChevronUp, AlertTriangle,
  AppWindow, DoorOpen, LayoutPanelTop, Ruler,
} from "lucide-react";
import { FacadeAnalysisResult, FacadeElement } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { cn } from "@/lib/utils";

interface FacadeIsolationPanelProps {
  result: FacadeAnalysisResult;
  /** Elements locaux (édités dans le masque editor) */
  localElements?: FacadeElement[];
  /** Surface façade depuis polygones manuels — remplace result.facade_area_m2 */
  facadeAreaOverride?: number | null;
  /** Image natural dimensions (pixels) — needed to compute w_m/h_m from bbox_norm */
  imgSize?: { w: number; h: number };
}

const fmtM2  = (v: number) => `${v.toFixed(2)} m²`;
const fmtDim = (v: number | null | undefined) => v != null ? `${v.toFixed(2)} m` : "—";

interface RetourLine {
  el: FacadeElement;
  w_m: number | null;
  h_m: number | null;
  lon_linteau: number | null;
  lon_appui:   number | null;
  lon_tableau: number | null;
  surf_linteau: number | null;
  surf_appui:   number | null;
  surf_tableau: number | null;
  total_m2:     number | null;
}

function TypeIcon({ type }: { type: string }) {
  if (type === "window")  return <AppWindow      className="w-3.5 h-3.5 text-blue-400" />;
  if (type === "door")    return <DoorOpen       className="w-3.5 h-3.5 text-pink-400" />;
  if (type === "balcony") return <LayoutPanelTop className="w-3.5 h-3.5 text-emerald-400" />;
  return <AppWindow className="w-3.5 h-3.5 text-amber-400" />;
}

export default function FacadeIsolationPanel({
  result,
  localElements,
  facadeAreaOverride,
  imgSize,
}: FacadeIsolationPanelProps) {
  const { lang } = useLang();
  const fr = lang === "fr";

  const [expanded,   setExpanded]   = useState(true);
  const [showDetail, setShowDetail] = useState(false);

  const [retTableau, setRetTableau] = useState(14);
  const [retLinteau, setRetLinteau] = useState(14);
  const [retAppui,   setRetAppui]   = useState(14);

  const ppm = result.pixels_per_meter;
  const hasPpm = ppm != null && ppm > 0;
  const elements = localElements ?? result.elements;

  // Include ALL element types that represent openings (including "other" since the model
  // often classifies windows/doors as "other"). Exclude structural: floor_line, roof, column.
  const openings = useMemo(
    () => elements.filter(e => !["floor_line", "roof", "column"].includes(e.type)),
    [elements],
  );

  const lines = useMemo<RetourLine[]>(() => {
    if (!hasPpm || !ppm) return [];
    const epL = retLinteau / 100;
    const epA = retAppui   / 100;
    const epT = retTableau / 100;

    const iW = imgSize?.w ?? 0;
    const iH = imgSize?.h ?? 0;

    return openings.map(el => {
      // Use el.w_m/h_m if backend provided them, else compute from bbox + ppm + imgSize
      const w = el.w_m ?? (iW > 0 ? (el.bbox_norm.w * iW / ppm) : null);
      const h = el.h_m ?? (iH > 0 ? (el.bbox_norm.h * iH / ppm) : null);

      const lon_linteau = w;
      const lon_appui   = w;
      const lon_tableau = h != null ? h * 2 : null;

      const surf_linteau = lon_linteau != null ? lon_linteau * epL : null;
      const surf_appui   = lon_appui   != null ? lon_appui   * epA : null;
      const surf_tableau = lon_tableau != null ? lon_tableau * epT : null;

      const total_m2 =
        surf_linteau != null && surf_appui != null && surf_tableau != null
          ? surf_linteau + surf_appui + surf_tableau : null;

      return { el, w_m: w, h_m: h, lon_linteau, lon_appui, lon_tableau, surf_linteau, surf_appui, surf_tableau, total_m2 };
    });
  }, [openings, hasPpm, retLinteau, retAppui, retTableau]);

  const totLonTableau  = lines.reduce((s, l) => s + (l.lon_tableau  ?? 0), 0);
  const totLonLinteau  = lines.reduce((s, l) => s + (l.lon_linteau  ?? 0), 0);
  const totLonAppui    = lines.reduce((s, l) => s + (l.lon_appui    ?? 0), 0);
  const totLonTotal    = totLonTableau + totLonLinteau + totLonAppui;

  const totSurfTableau = lines.reduce((s, l) => s + (l.surf_tableau ?? 0), 0);
  const totSurfLinteau = lines.reduce((s, l) => s + (l.surf_linteau ?? 0), 0);
  const totSurfAppui   = lines.reduce((s, l) => s + (l.surf_appui   ?? 0), 0);
  const totSurfRetours = totSurfTableau + totSurfLinteau + totSurfAppui;

  const facadeArea = facadeAreaOverride ?? result.facade_area_m2;

  // Compute openings area from localElements (reflects reclassifications + edits)
  const openingsAreaLocal = useMemo(() => {
    if (!hasPpm || !ppm) return null;
    const iW = imgSize?.w ?? 0;
    const iH = imgSize?.h ?? 0;
    if (iW === 0 || iH === 0) return result.openings_area_m2 ?? null;
    return openings.reduce((s, el) => {
      const area = el.area_m2 ?? (el.bbox_norm.w * iW * el.bbox_norm.h * iH / (ppm * ppm));
      return s + area;
    }, 0);
  }, [openings, hasPpm, ppm, imgSize, result.openings_area_m2]);

  const wallNet = useMemo<number | null>(() => {
    if (facadeArea == null) return null;
    const oa = openingsAreaLocal ?? result.openings_area_m2 ?? 0;
    return Math.max(0, facadeArea - oa);
  }, [facadeArea, openingsAreaLocal, result.openings_area_m2]);

  const iteTotal = wallNet != null ? wallNet + totSurfRetours : null;

  const typeLabel = (t: string) =>
    t === "window" ? (fr ? "Fenêtre" : "Window")
    : t === "door" ? (fr ? "Porte" : "Door")
    : t === "balcony" ? (fr ? "Balcon" : "Balcony")
    : t === "other" ? (fr ? "Ouverture" : "Opening")
    : t;

  const NumInput = ({ value, onChange, color }: { value: number; onChange: (v: number) => void; color: string }) => (
    <input
      type="number" min={1} max={40} step={1} value={value}
      onChange={e => onChange(Math.max(1, parseInt(e.target.value) || 1))}
      className={cn(
        "w-16 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-center text-sm font-mono font-bold focus:outline-none focus:ring-1 focus:ring-violet-400/50",
        color
      )}
    />
  );

  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden">

      {/* Header */}
      <button type="button" onClick={() => setExpanded(v => !v)}
        className="flex items-center justify-between w-full p-5 cursor-pointer hover:bg-white/5 transition-colors">
        <div className="flex items-center gap-3">
          <Layers3 className="w-5 h-5 text-violet-400" />
          <div className="text-left">
            <span className="text-white font-semibold">
              {fr ? "ITE & Retours de tableau" : "External Insulation & Window Returns"}
            </span>
            <span className="block text-xs text-slate-400">
              {fr ? "Linéaires (ml) + surface isolant (m²)" : "Linear returns (ml) + insulation area (m²)"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!expanded && hasPpm && totLonTotal > 0 && (
            <span className="text-sm text-violet-300 font-mono font-bold">{totLonTotal.toFixed(1)} ml</span>
          )}
          {expanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div key="iso-content"
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}
            className="overflow-hidden">
            <div className="px-5 pb-6 space-y-6">

              {/* Warning: no scale */}
              {!hasPpm && (
                <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-300">
                    {fr
                      ? "L'échelle (px/m) est requise pour les linéaires. Définissez l'échelle à l'étape précédente."
                      : "A scale (px/m) is required for linear meters. Set the scale in the previous step."}
                  </p>
                </div>
              )}

              {/* ══ 1. LINÉAIRES (ml) — PRIORITÉ ══ */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Ruler className="w-4 h-4 text-violet-400" />
                  <span className="text-sm font-semibold text-white">
                    {fr ? "Linéaires de retours" : "Linear returns"}
                  </span>
                  {!hasPpm && <span className="text-xs text-slate-500">{fr ? "(échelle requise)" : "(scale required)"}</span>}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: fr ? "Tableaux (H×2)"  : "Reveals (H×2)", value: totLonTableau, color: "text-amber-300",   border: "border-amber-400/20"   },
                    { label: fr ? "Linteaux (W)"     : "Lintels (W)",   value: totLonLinteau, color: "text-sky-300",     border: "border-sky-400/20"     },
                    { label: fr ? "Appuis (W)"       : "Sills (W)",     value: totLonAppui,   color: "text-emerald-300", border: "border-emerald-400/20" },
                    { label: "TOTAL",                                    value: totLonTotal,   color: "text-violet-300",  border: "border-violet-400/30 bg-violet-400/5" },
                  ].map(({ label, value, color, border }) => (
                    <div key={label} className={cn("glass rounded-xl border p-4 text-center", border)}>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</div>
                      <div className={cn("text-2xl font-display font-700", color)}>
                        {hasPpm && value > 0 ? value.toFixed(1) : "—"}
                      </div>
                      {hasPpm && value > 0 && <div className="text-xs text-slate-500 mt-0.5">ml</div>}
                    </div>
                  ))}
                </div>

                {hasPpm && openings.length === 0 && (
                  <p className="text-xs text-slate-500 mt-2">
                    {fr
                      ? "Aucune fenêtre/porte détectée. Utilisez l'éditeur de masques pour reclasser les éléments."
                      : "No window/door detected. Use the mask editor to reclassify elements."}
                  </p>
                )}
              </div>

              {/* ══ 2. ÉPAISSEURS ITE ══ */}
              <div className="glass rounded-xl border border-white/5 p-4">
                <div className="text-xs font-semibold text-slate-300 mb-4">
                  {fr ? "Largeur retour par type (cm)" : "Return width per type (cm)"}
                </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  {[
                    { label: fr ? "Tableau"  : "Reveal",  value: retTableau, onChange: setRetTableau, color: "text-amber-300"   },
                    { label: fr ? "Linteau"  : "Lintel",  value: retLinteau, onChange: setRetLinteau, color: "text-sky-300"     },
                    { label: fr ? "Appui"    : "Sill",    value: retAppui,   onChange: setRetAppui,   color: "text-emerald-300" },
                  ].map(({ label, value, onChange, color }) => (
                    <div key={label}>
                      <div className={cn("text-xs mb-2", color)}>{label}</div>
                      <NumInput value={value} onChange={onChange} color={color} />
                      <div className="text-[10px] text-slate-600 mt-1">cm</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ══ 3. SURFACES m² ══ */}
              {hasPpm && totSurfRetours > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-300 mb-3 uppercase tracking-wider">
                    {fr ? "Surfaces isolant" : "Insulation surfaces"}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: fr ? "Tableaux" : "Reveals", value: totSurfTableau, color: "text-amber-300",   border: "border-amber-400/20"  },
                      { label: fr ? "Linteaux" : "Lintels", value: totSurfLinteau, color: "text-sky-300",     border: "border-sky-400/20"    },
                      { label: fr ? "Appuis"   : "Sills",   value: totSurfAppui,   color: "text-emerald-300", border: "border-emerald-400/20"},
                      { label: "TOTAL",                      value: totSurfRetours, color: "text-violet-300",  border: "border-violet-400/30" },
                    ].map(({ label, value, color, border }) => (
                      <div key={label} className={cn("glass rounded-xl border p-3 text-center", border)}>
                        <div className="text-[10px] text-slate-500 mb-1">{label}</div>
                        <div className={cn("text-base font-display font-700", color)}>{fmtM2(value)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ══ 4. SURFACE MUR NET ══ */}
              {(wallNet != null || iteTotal != null) && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="glass rounded-xl border border-white/5 p-4 text-center">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                      {fr ? "Façade totale" : "Total facade"}
                    </div>
                    <div className="text-xl font-display font-700 text-white">
                      {facadeArea != null ? `${facadeArea.toFixed(1)} m²` : "—"}
                    </div>
                  </div>
                  <div className="glass rounded-xl border border-white/5 p-4 text-center">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                      {fr ? "Mur opaque net" : "Net opaque wall"}
                    </div>
                    <div className="text-xl font-display font-700 text-violet-300">
                      {wallNet != null ? `${wallNet.toFixed(1)} m²` : "—"}
                    </div>
                  </div>
                  <div className="glass rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 text-center">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                      {fr ? "ITE surface totale" : "Total ITE area"}
                    </div>
                    <div className="text-xl font-display font-700 text-violet-400">
                      {iteTotal != null ? `${iteTotal.toFixed(1)} m²` : "—"}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{fr ? "mur + retours" : "wall + returns"}</div>
                  </div>
                </div>
              )}

              {/* ══ 5. DÉTAIL PAR OUVERTURE ══ */}
              {hasPpm && lines.length > 0 && (
                <div>
                  <button type="button" onClick={() => setShowDetail(v => !v)}
                    className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors mb-2">
                    {showDetail ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    {fr ? `Détail par ouverture (${lines.length})` : `Per opening (${lines.length})`}
                  </button>
                  <AnimatePresence initial={false}>
                    {showDetail && (
                      <motion.div key="det" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                        <div className="glass rounded-xl border border-white/5 overflow-x-auto">
                          <table className="w-full text-xs font-mono">
                            <thead>
                              <tr className="border-b border-white/5 text-slate-500">
                                <th className="text-left py-2 px-2">#</th>
                                <th className="text-left py-2 px-2">Type</th>
                                <th className="text-right py-2 px-2">W</th>
                                <th className="text-right py-2 px-2">H</th>
                                <th className="text-right py-2 px-2 text-amber-400/80">Tab ml</th>
                                <th className="text-right py-2 px-2 text-sky-400/80">Lin ml</th>
                                <th className="text-right py-2 px-2 text-emerald-400/80">App ml</th>
                                <th className="text-right py-2 px-2 text-amber-400/80">Tab m²</th>
                                <th className="text-right py-2 px-2 text-sky-400/80">Lin m²</th>
                                <th className="text-right py-2 px-2 text-emerald-400/80">App m²</th>
                                <th className="text-right py-2 px-2 text-violet-300">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lines.map((l, idx) => (
                                <tr key={l.el.id} className="border-b border-white/5 hover:bg-white/3">
                                  <td className="py-1.5 px-2 text-slate-500">{idx + 1}</td>
                                  <td className="py-1.5 px-2">
                                    <div className="flex items-center gap-1"><TypeIcon type={l.el.type} /><span className="text-slate-300">{typeLabel(l.el.type)}</span></div>
                                  </td>
                                  <td className="py-1.5 px-2 text-right text-slate-400">{fmtDim(l.w_m)}</td>
                                  <td className="py-1.5 px-2 text-right text-slate-400">{fmtDim(l.h_m)}</td>
                                  <td className="py-1.5 px-2 text-right text-amber-300">{l.lon_tableau?.toFixed(2) ?? "—"}</td>
                                  <td className="py-1.5 px-2 text-right text-sky-300">{l.lon_linteau?.toFixed(2) ?? "—"}</td>
                                  <td className="py-1.5 px-2 text-right text-emerald-300">{l.lon_appui?.toFixed(2) ?? "—"}</td>
                                  <td className="py-1.5 px-2 text-right text-amber-300">{l.surf_tableau?.toFixed(3) ?? "—"}</td>
                                  <td className="py-1.5 px-2 text-right text-sky-300">{l.surf_linteau?.toFixed(3) ?? "—"}</td>
                                  <td className="py-1.5 px-2 text-right text-emerald-300">{l.surf_appui?.toFixed(3) ?? "—"}</td>
                                  <td className="py-1.5 px-2 text-right text-violet-300 font-semibold">{l.total_m2 != null ? fmtM2(l.total_m2) : "—"}</td>
                                </tr>
                              ))}
                              <tr className="border-t border-violet-500/20 bg-violet-500/5 font-semibold">
                                <td colSpan={4} className="py-2 px-2 text-slate-300">Total</td>
                                <td className="py-2 px-2 text-right text-amber-300">{totLonTableau.toFixed(2)}</td>
                                <td className="py-2 px-2 text-right text-sky-300">{totLonLinteau.toFixed(2)}</td>
                                <td className="py-2 px-2 text-right text-emerald-300">{totLonAppui.toFixed(2)}</td>
                                <td className="py-2 px-2 text-right text-amber-300">{totSurfTableau.toFixed(3)}</td>
                                <td className="py-2 px-2 text-right text-sky-300">{totSurfLinteau.toFixed(3)}</td>
                                <td className="py-2 px-2 text-right text-emerald-300">{totSurfAppui.toFixed(3)}</td>
                                <td className="py-2 px-2 text-right text-violet-300">{fmtM2(totSurfRetours)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              <p className="text-[10px] text-slate-600">
                {fr
                  ? "⚠ Tableau = H×2. Linteau = W. Appui = W. Surface retour = longueur × largeur retour. À valider avec un bureau d'études."
                  : "⚠ Reveal = H×2. Lintel = W. Sill = W. Return area = length × return width. To be validated with a thermal engineer."}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
