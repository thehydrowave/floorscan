"use client";

/**
 * FacadeCctpPanel — CCTP (Cahier des Clauses Techniques Particulieres)
 * for facade renovation. 5 lots with bulleted spec lists.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { FacadeAnalysisResult } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/* ── Types ── */
interface CctpSpec {
  text: string;
}

interface CctpLot {
  number: number;
  title: string;
  icon: string;
  color: string;
  description: string;
  specs: CctpSpec[];
}

interface FacadeCctpPanelProps {
  result: FacadeAnalysisResult;
}

export default function FacadeCctpPanel({ result }: FacadeCctpPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const isFr = lang === "fr";

  const [expanded, setExpanded] = useState(false);
  const [openLots, setOpenLots] = useState<Set<number>>(new Set([1]));

  const toggleLot = (n: number) =>
    setOpenLots(prev => { const s = new Set(prev); s.has(n) ? s.delete(n) : s.add(n); return s; });

  const hasArea = result.facade_area_m2 != null && result.facade_area_m2 > 0;

  const lots = useMemo<CctpLot[]>(() => {
    if (!hasArea) return [];

    const facadeArea   = result.facade_area_m2!;
    const openingsArea = result.openings_area_m2 ?? 0;
    const wallArea     = Math.max(0, facadeArea - openingsArea);
    const winCount     = result.windows_count;
    const doorCount    = result.doors_count;
    const balcCount    = result.balconies_count;

    return [
      {
        number: 1,
        title: isFr ? "Echafaudage / Protection" : "Scaffolding / Protection",
        icon: "🏗",
        color: "#fb923c",
        description: isFr
          ? `Installation d'echafaudages conformes a la norme NF EN 12811 sur l'ensemble de la facade (${facadeArea.toFixed(1)} m2). Filets de protection et baches.`
          : `Scaffolding installation compliant with NF EN 12811 across the full facade (${facadeArea.toFixed(1)} m2). Safety nets and protective sheeting.`,
        specs: [
          { text: isFr ? `Echafaudage tubulaire multidirectionnel sur ${facadeArea.toFixed(1)} m2 de facade` : `Multidirectional tubular scaffolding across ${facadeArea.toFixed(1)} m2 facade` },
          { text: isFr ? "Filets de protection anti-chute et baches pare-gravats" : "Fall-protection nets and debris-catching sheeting" },
          { text: isFr ? "Signalisation de chantier et balisage peripherique" : "Construction site signage and perimeter marking" },
          { text: isFr ? "Protection des menuiseries, balcons et abords existants" : "Protection of existing joinery, balconies and surroundings" },
          { text: isFr ? "Plan d'installation et note de calcul echafaudage" : "Scaffolding installation plan and load calculations" },
        ],
      },
      {
        number: 2,
        title: isFr ? "Nettoyage / Decapage facade" : "Cleaning / Facade stripping",
        icon: "🧹",
        color: "#38bdf8",
        description: isFr
          ? `Nettoyage haute pression et decapage de la facade existante (${facadeArea.toFixed(1)} m2). Traitement anti-mousse et fongicide.`
          : `High-pressure cleaning and stripping of existing facade (${facadeArea.toFixed(1)} m2). Anti-moss and fungicide treatment.`,
        specs: [
          { text: isFr ? `Nettoyage haute pression sur ${facadeArea.toFixed(1)} m2 (pression adaptee au support)` : `High-pressure cleaning on ${facadeArea.toFixed(1)} m2 (pressure adapted to substrate)` },
          { text: isFr ? "Decapage des peintures et revetements non-adherents" : "Stripping of non-adherent paints and coatings" },
          { text: isFr ? "Traitement anti-mousse et fongicide (application + temps de pose)" : "Anti-moss and fungicide treatment (application + curing time)" },
          { text: isFr ? "Brossage et depoussierage des surfaces apres sechage" : "Brushing and dusting of surfaces after drying" },
          { text: isFr ? "Evacuation des dechets de decapage (benne dediee)" : "Disposal of stripping waste (dedicated skip)" },
        ],
      },
      {
        number: 3,
        title: isFr ? "Ravalement / Enduit / Peinture" : "Rendering / Plaster / Painting",
        icon: "🎨",
        color: "#34d399",
        description: isFr
          ? `Ravalement complet sur ${wallArea.toFixed(1)} m2 de surface murale (facade ${facadeArea.toFixed(1)} m2 - ouvertures ${openingsArea.toFixed(1)} m2). Enduit et peinture.`
          : `Full rendering on ${wallArea.toFixed(1)} m2 wall surface (facade ${facadeArea.toFixed(1)} m2 - openings ${openingsArea.toFixed(1)} m2). Render and painting.`,
        specs: [
          { text: isFr ? `Rebouchage des fissures et micro-fissures sur ${wallArea.toFixed(1)} m2` : `Crack and micro-crack filling on ${wallArea.toFixed(1)} m2` },
          { text: isFr ? "Application gobetis d'accrochage sur support prepare" : "Application of bonding spatter-dash on prepared substrate" },
          { text: isFr ? `Enduit monocouche ou multicouche (corps d'enduit + finition) sur ${wallArea.toFixed(1)} m2` : `Single or multi-layer render (body coat + finish) on ${wallArea.toFixed(1)} m2` },
          { text: isFr ? "Peinture facade 2 couches minimum (primaire + finition siloxane)" : "Facade paint minimum 2 coats (primer + siloxane finish)" },
          { text: isFr ? "Traitement des points singuliers : angles, soubassements, bandeaux" : "Treatment of special points: corners, plinths, string courses" },
          { text: isFr ? `Peinture des encadrements pour ${winCount} fenetre(s) et ${doorCount} porte(s)` : `Surround painting for ${winCount} window(s) and ${doorCount} door(s)` },
        ],
      },
      {
        number: 4,
        title: isFr ? "Menuiseries exterieures" : "External joinery",
        icon: "🪟",
        color: "#60a5fa",
        description: isFr
          ? `Remplacement ou renovation de ${winCount} fenetre(s) et ${doorCount} porte(s)${balcCount > 0 ? ` + ${balcCount} garde-corps balcon` : ""}. Surface d'ouvertures : ${openingsArea.toFixed(1)} m2.`
          : `Replacement or renovation of ${winCount} window(s) and ${doorCount} door(s)${balcCount > 0 ? ` + ${balcCount} balcony railings` : ""}. Opening area: ${openingsArea.toFixed(1)} m2.`,
        specs: [
          ...(winCount > 0 ? [
            { text: isFr ? `Depose et fourniture-pose de ${winCount} fenetre(s) PVC/ALU double vitrage 4/16/4 argon` : `Removal and supply-install of ${winCount} PVC/ALU double-glazed window(s) 4/16/4 argon` },
            { text: isFr ? "Quincaillerie oscillo-battante, joints EPDM, Uw <= 1.3 W/m2.K" : "Tilt-and-turn hardware, EPDM seals, Uw <= 1.3 W/m2.K" },
          ] : []),
          ...(doorCount > 0 ? [
            { text: isFr ? `Depose et fourniture-pose de ${doorCount} porte(s) d'entree (seuil PMR >= 0.90m)` : `Removal and supply-install of ${doorCount} entrance door(s) (PMR threshold >= 0.90m)` },
            { text: isFr ? "Serrure multipoints, vitrage securit si applicable" : "Multi-point lock, safety glazing if applicable" },
          ] : []),
          ...(balcCount > 0 ? [
            { text: isFr ? `Renovation de ${balcCount} garde-corps de balcon (metallerie + thermolaquage)` : `Renovation of ${balcCount} balcony railings (metalwork + powder coating)` },
          ] : []),
          { text: isFr ? "Calfeutrement et etancheite peripherique (mastic polyurethane)" : "Peripheral sealing and caulking (polyurethane mastic)" },
          { text: isFr ? "Essais d'etancheite a l'air et a l'eau apres pose" : "Air and water tightness tests after installation" },
        ],
      },
      {
        number: 5,
        title: isFr ? "Etancheite / ITE" : "Waterproofing / External insulation",
        icon: "🧱",
        color: "#a78bfa",
        description: isFr
          ? `Isolation thermique par l'exterieur sur ${wallArea.toFixed(1)} m2 de surface murale opaque. Objectif R >= 3.7 m2.K/W (RE2020).`
          : `External thermal insulation on ${wallArea.toFixed(1)} m2 opaque wall surface. Target R >= 3.7 m2.K/W (RE2020).`,
        specs: [
          { text: isFr ? `Fourniture et pose de panneaux isolants PSE/laine de roche ep. 14cm sur ${wallArea.toFixed(1)} m2` : `Supply and install EPS/mineral wool insulation panels 14cm thick on ${wallArea.toFixed(1)} m2` },
          { text: isFr ? "Fixation mecanique par chevilles a frapper (6 pts/m2 minimum)" : "Mechanical fixing with impact anchors (min. 6 pts/m2)" },
          { text: isFr ? "Pose treillis d'armature fibre de verre + sous-enduit colle" : "Fibreglass reinforcement mesh + adhesive base coat" },
          { text: isFr ? "Enduit de finition mineral ou silicone (teinte au choix)" : "Mineral or silicone finish coat (colour to choice)" },
          { text: isFr ? "Traitement des points singuliers : appuis de fenetre, seuils, acroteres" : "Treatment of special points: window sills, thresholds, parapets" },
          { text: isFr ? "Etancheite des joints de dilatation et raccords ITE/menuiseries" : "Sealing of expansion joints and ITE/joinery connections" },
          { text: isFr ? "Attestation de conformite thermique RE2020 en fin de chantier" : "RE2020 thermal compliance certificate at project completion" },
        ],
      },
    ];
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
          <FileText className="w-5 h-5 text-violet-400" />
          <div className="text-left">
            <span className="text-white font-semibold">{d("facctp_title" as DTKey)}</span>
            <span className="block text-xs text-slate-400">{d("facctp_subtitle" as DTKey)}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!expanded && hasArea && (
            <span className="text-xs text-slate-400">{lots.length} lots</span>
          )}
          {expanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="facctp-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {!hasArea ? (
              <div className="flex items-center gap-3 px-5 py-6 text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="text-sm">{d("facctp_no_data" as DTKey)}</span>
              </div>
            ) : (
              <div className="pb-5">
                {/* Lots */}
                {lots.map(lot => (
                  <div key={lot.number} className="border-t border-white/5">
                    <button
                      type="button"
                      onClick={() => toggleLot(lot.number)}
                      className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">{lot.icon}</span>
                        <span className="text-sm font-semibold text-slate-200">
                          Lot {lot.number} — {lot.title}
                        </span>
                      </div>
                      {openLots.has(lot.number)
                        ? <ChevronUp className="w-4 h-4 text-slate-500" />
                        : <ChevronDown className="w-4 h-4 text-slate-500" />}
                    </button>

                    <AnimatePresence initial={false}>
                      {openLots.has(lot.number) && (
                        <motion.div
                          key={`cctp-lot-${lot.number}`}
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="px-5 pb-4">
                            {/* Lot description */}
                            <p className="text-xs text-slate-400 leading-relaxed mb-3 pl-7">
                              {lot.description}
                            </p>

                            {/* Spec list */}
                            <ul className="space-y-1.5 pl-7">
                              {lot.specs.map((spec, i) => (
                                <li key={i} className="flex items-start gap-2 text-xs text-slate-300 leading-relaxed">
                                  <span
                                    className="inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                                    style={{ backgroundColor: lot.color }}
                                  />
                                  {spec.text}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}

                {/* Disclaimer */}
                <div className="mx-5 mt-4 p-3 rounded-lg bg-white/3 border border-white/5 text-xs text-slate-500 leading-relaxed">
                  {isFr
                    ? "Ce CCTP est genere automatiquement a partir des donnees d'analyse. Il doit etre adapte et valide par un maitre d'oeuvre avant utilisation contractuelle."
                    : "This CCTP is automatically generated from analysis data. It must be adapted and validated by a project manager before contractual use."}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
