"use client";

/**
 * FacadeLotsPanel — Lot-based analysis for facade renovation.
 * 5 lots with descriptions, estimated surfaces and cost range estimates.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Layers, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { FacadeAnalysisResult } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/* ── Types ── */
interface LotInfo {
  number: number;
  title: string;
  icon: string;
  color: string;
  description: string;
  surface: number;
  surfaceUnit: string;
  details: string[];
  costMin: number;
  costMax: number;
}

interface FacadeLotsPanelProps {
  result: FacadeAnalysisResult;
}

function fmtEur(n: number) {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

export default function FacadeLotsPanel({ result }: FacadeLotsPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const isFr = lang === "fr";

  const [expanded, setExpanded] = useState(false);
  const [openLots, setOpenLots] = useState<Set<number>>(new Set([1, 2]));

  const toggleLot = (n: number) =>
    setOpenLots(prev => { const s = new Set(prev); s.has(n) ? s.delete(n) : s.add(n); return s; });

  const hasArea = result.facade_area_m2 != null && result.facade_area_m2 > 0;

  const { lots, totalMin, totalMax } = useMemo(() => {
    if (!hasArea) return { lots: [] as LotInfo[], totalMin: 0, totalMax: 0 };

    const facadeArea   = result.facade_area_m2!;
    const openingsArea = result.openings_area_m2 ?? 0;
    const wallArea     = Math.max(0, facadeArea - openingsArea);
    const winCount     = result.windows_count;
    const doorCount    = result.doors_count;
    const balcCount    = result.balconies_count;

    const allLots: LotInfo[] = [
      {
        number: 1,
        title: isFr ? "Preparation" : "Preparation",
        icon: "🔧",
        color: "#fb923c",
        description: isFr
          ? "Installation echafaudage, protection des abords, nettoyage et decapage de la facade existante."
          : "Scaffolding installation, surrounding protection, cleaning and stripping of existing facade.",
        surface: facadeArea,
        surfaceUnit: "m2",
        details: [
          isFr ? `Surface facade totale : ${facadeArea.toFixed(1)} m2` : `Total facade area: ${facadeArea.toFixed(1)} m2`,
          isFr ? "Echafaudage tubulaire + filets de protection" : "Tubular scaffolding + safety nets",
          isFr ? "Nettoyage HP + traitement anti-mousse" : "HP cleaning + anti-moss treatment",
        ],
        costMin: Math.round(facadeArea * 15),
        costMax: Math.round(facadeArea * 30),
      },
      {
        number: 2,
        title: isFr ? "Ravalement" : "Rendering",
        icon: "🏗",
        color: "#f59e0b",
        description: isFr
          ? "Ravalement de la surface murale opaque : rebouchage fissures, enduit et peinture facade 2 couches."
          : "Rendering of opaque wall surface: crack filling, render and 2-coat facade paint.",
        surface: wallArea,
        surfaceUnit: "m2",
        details: [
          isFr ? `Surface murale nette : ${wallArea.toFixed(1)} m2 (facade - ouvertures)` : `Net wall area: ${wallArea.toFixed(1)} m2 (facade - openings)`,
          isFr ? "Enduit monocouche ou multicouche" : "Single or multi-layer render",
          isFr ? "Peinture facade 2 couches (primaire + finition)" : "2-coat facade paint (primer + finish)",
        ],
        costMin: Math.round(wallArea * 40),
        costMax: Math.round(wallArea * 80),
      },
      {
        number: 3,
        title: isFr ? "Menuiseries" : "Joinery",
        icon: "🪟",
        color: "#60a5fa",
        description: isFr
          ? `Remplacement ou renovation des menuiseries exterieures : ${winCount} fenetre(s), ${doorCount} porte(s).`
          : `Replacement or renovation of external joinery: ${winCount} window(s), ${doorCount} door(s).`,
        surface: openingsArea,
        surfaceUnit: "m2",
        details: [
          isFr ? `${winCount} fenetre(s) — surface vitree totale incluse` : `${winCount} window(s) — total glazed area included`,
          isFr ? `${doorCount} porte(s) exterieure(s)` : `${doorCount} exterior door(s)`,
          ...(balcCount > 0 ? [isFr ? `${balcCount} garde-corps balcon a renover` : `${balcCount} balcony railings to renovate`] : []),
          isFr ? `Surface totale d'ouvertures : ${openingsArea.toFixed(1)} m2` : `Total opening area: ${openingsArea.toFixed(1)} m2`,
        ],
        costMin: Math.round(winCount * 500 + doorCount * 900),
        costMax: Math.round(winCount * 900 + doorCount * 1800 + balcCount * 600),
      },
      {
        number: 4,
        title: isFr ? "Etancheite ITE" : "Insulation ITE",
        icon: "🧱",
        color: "#a78bfa",
        description: isFr
          ? "Isolation thermique par l'exterieur (ITE) : panneaux isolants, sous-enduit arme et enduit de finition."
          : "External thermal insulation (ITE): insulation panels, reinforced base coat and finish coat.",
        surface: facadeArea,
        surfaceUnit: "m2",
        details: [
          isFr ? `Surface a isoler : ${facadeArea.toFixed(1)} m2 de facade` : `Area to insulate: ${facadeArea.toFixed(1)} m2 facade`,
          isFr ? "Panneaux PSE ou laine de roche ep. 14cm (R >= 3.7)" : "EPS or mineral wool panels 14cm (R >= 3.7)",
          isFr ? "Treillis armature + enduit de finition mineral" : "Reinforcement mesh + mineral finish coat",
        ],
        costMin: Math.round(facadeArea * 80),
        costMax: Math.round(facadeArea * 150),
      },
      {
        number: 5,
        title: isFr ? "Finitions" : "Finishing",
        icon: "✨",
        color: "#34d399",
        description: isFr
          ? "Travaux de finition : joints, raccords, nettoyage final et repli de chantier."
          : "Finishing works: joints, connections, final cleaning and site clearance.",
        surface: facadeArea,
        surfaceUnit: "m2",
        details: [
          isFr ? `Traitement des points singuliers sur ${facadeArea.toFixed(1)} m2` : `Special point treatment on ${facadeArea.toFixed(1)} m2`,
          isFr ? "Joints de dilatation, calfeutrement peripherique" : "Expansion joints, peripheral caulking",
          isFr ? "Nettoyage final et depose echafaudage" : "Final cleanup and scaffolding removal",
        ],
        costMin: Math.round(facadeArea * 8),
        costMax: Math.round(facadeArea * 20),
      },
    ];

    const totalMin = allLots.reduce((s, l) => s + l.costMin, 0);
    const totalMax = allLots.reduce((s, l) => s + l.costMax, 0);

    return { lots: allLots, totalMin, totalMax };
  }, [result, hasArea, isFr]);

  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex items-center justify-between w-full p-5 cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Layers className="w-5 h-5 text-amber-400" />
          <div className="text-left">
            <span className="text-white font-semibold">{d("falots_title" as DTKey)}</span>
            <span className="block text-xs text-slate-400">{d("falots_subtitle" as DTKey)}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!expanded && hasArea && totalMax > 0 && (
            <span className="text-xs font-mono text-amber-400 mr-1">
              {fmtEur(totalMin)} — {fmtEur(totalMax)}
            </span>
          )}
          {expanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="falots-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {!hasArea ? (
              <div className="flex items-center gap-3 px-5 py-6 text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="text-sm">{d("falots_no_data" as DTKey)}</span>
              </div>
            ) : (
              <div className="pb-5">
                {/* Lots */}
                {lots.map(lot => {
                  const pct = totalMax > 0 ? ((lot.costMin + lot.costMax) / 2) / ((totalMin + totalMax) / 2) * 100 : 0;
                  return (
                    <div key={lot.number} className="border-t border-white/5">
                      <button
                        type="button"
                        onClick={() => toggleLot(lot.number)}
                        className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/5 transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="text-base">{lot.icon}</span>
                          <div className="text-left">
                            <span className="text-sm font-semibold text-slate-200">
                              Lot {lot.number} — {lot.title}
                            </span>
                            <span className="block text-xs text-slate-500">
                              {lot.surface.toFixed(1)} {lot.surfaceUnit}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <span className="text-xs font-mono" style={{ color: lot.color }}>
                              {fmtEur(lot.costMin)} — {fmtEur(lot.costMax)}
                            </span>
                            <span className="block text-xs text-slate-600">{pct.toFixed(0)}%</span>
                          </div>
                          {openLots.has(lot.number)
                            ? <ChevronUp className="w-4 h-4 text-slate-500" />
                            : <ChevronDown className="w-4 h-4 text-slate-500" />}
                        </div>
                      </button>

                      <AnimatePresence initial={false}>
                        {openLots.has(lot.number) && (
                          <motion.div
                            key={`lot-detail-${lot.number}`}
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="px-5 pb-4">
                              <p className="text-xs text-slate-400 leading-relaxed mb-3 pl-7">
                                {lot.description}
                              </p>

                              {/* Cost bar */}
                              <div className="pl-7 mb-3">
                                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{
                                      width: `${Math.min(100, pct)}%`,
                                      backgroundColor: lot.color,
                                      opacity: 0.7,
                                    }}
                                  />
                                </div>
                              </div>

                              {/* Details */}
                              <ul className="space-y-1.5 pl-7">
                                {lot.details.map((detail, i) => (
                                  <li key={i} className="flex items-start gap-2 text-xs text-slate-300 leading-relaxed">
                                    <span
                                      className="inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                                      style={{ backgroundColor: lot.color }}
                                    />
                                    {detail}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}

                {/* Summary total */}
                <div className="mx-5 mt-5 border border-white/10 rounded-xl overflow-hidden">
                  <div className="flex justify-between px-4 py-2.5 text-sm border-b border-white/5">
                    <span className="text-slate-400">{isFr ? "Estimation basse" : "Low estimate"}</span>
                    <span className="font-mono font-semibold text-white">{fmtEur(totalMin)}</span>
                  </div>
                  <div className="flex justify-between px-4 py-2.5 text-sm border-b border-white/5">
                    <span className="text-slate-400">{isFr ? "Estimation haute" : "High estimate"}</span>
                    <span className="font-mono font-semibold text-white">{fmtEur(totalMax)}</span>
                  </div>
                  <div className="flex justify-between px-4 py-3 bg-amber-500/10">
                    <span className="font-semibold text-amber-300">{isFr ? "Fourchette totale HT" : "Total range excl. tax"}</span>
                    <span className="font-display font-700 text-lg text-amber-400">
                      {fmtEur(totalMin)} — {fmtEur(totalMax)}
                    </span>
                  </div>
                </div>

                {/* Disclaimer */}
                <div className="mx-5 mt-4 p-3 rounded-lg bg-white/3 border border-white/5 text-xs text-slate-500 leading-relaxed">
                  {isFr
                    ? "Estimations indicatives basees sur les prix moyens du marche francais (BTP 2024). Les couts reels dependent des prestations retenues et des conditions locales."
                    : "Indicative estimates based on average French market prices (construction 2024). Actual costs depend on selected services and local conditions."}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
