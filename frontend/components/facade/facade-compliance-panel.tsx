"use client";

/**
 * FacadeCompliancePanel — Vérification réglementaire façade.
 * Checks: ratio vitrage (RE2020), accessibilité PMR (porte ≥ 0.9m), isolation thermique,
 * nombre d'ouvertures par étage.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { FacadeAnalysisResult } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/* ── Types ── */
type ComplianceStatus = "pass" | "fail" | "warn" | "na";

interface ComplianceCheck {
  id: string;
  label: string;
  detail: string;
  status: ComplianceStatus;
  value?: string;
  threshold?: string;
}

interface FacadeCompliancePanelProps {
  result: FacadeAnalysisResult;
}

/* ── Status icon + color ── */
function StatusIcon({ status }: { status: ComplianceStatus }) {
  if (status === "pass") return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
  if (status === "fail") return <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
  return <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />;
}

function statusBg(s: ComplianceStatus) {
  if (s === "pass") return "bg-emerald-500/10 border-emerald-500/20";
  if (s === "fail") return "bg-red-500/10 border-red-500/20";
  return "bg-amber-500/10 border-amber-500/20";
}

function statusText(s: ComplianceStatus) {
  if (s === "pass") return "text-emerald-300";
  if (s === "fail") return "text-red-300";
  return "text-amber-300";
}

export default function FacadeCompliancePanel({ result }: FacadeCompliancePanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const isFr = lang === "fr";

  const [expanded, setExpanded] = useState(false);

  const hasArea = result.facade_area_m2 != null && result.facade_area_m2 > 0;

  const checks = useMemo<ComplianceCheck[]>(() => {
    if (!hasArea) return [];

    const facadeArea   = result.facade_area_m2!;
    const openingsArea = result.openings_area_m2 ?? 0;
    const ratio        = result.ratio_openings ?? (openingsArea / facadeArea);
    const wallArea     = Math.max(0, facadeArea - openingsArea);
    const winCount     = result.windows_count;
    const doorCount    = result.doors_count;
    const balcCount    = result.balconies_count;
    const floorCount   = result.floors_count;

    /* ── 1. Ratio vitrage (RE2020 recommends 15-25% for residential) ── */
    const ratioPct = ratio * 100;
    const glazingCheck: ComplianceCheck = {
      id: "glazing_ratio",
      label: isFr ? "Ratio vitrage (RE2020)" : "Glazing ratio (RE2020)",
      detail: ratioPct < 10
        ? isFr ? "Ratio trop faible — apport solaire et luminosité insuffisants" : "Too low — poor solar gain and daylight"
        : ratioPct > 40
        ? isFr ? "Ratio élevé — risque de surchauffe été (RE2020 §Bbio)" : "High ratio — summer overheating risk (RE2020 §Bbio)"
        : ratioPct > 25
        ? isFr ? "Légèrement au-dessus du seuil recommandé (15-25%)" : "Slightly above recommended range (15-25%)"
        : isFr ? "Conforme à la plage recommandée RE2020 (15-25%)" : "Within RE2020 recommended range (15-25%)",
      status: ratioPct < 10 ? "warn" : ratioPct > 40 ? "fail" : ratioPct > 30 ? "warn" : "pass",
      value: `${ratioPct.toFixed(1)}%`,
      threshold: "15–25%",
    };

    /* ── 2. Surface murale opaque (enduit) ── */
    const wallAreaCheck: ComplianceCheck = {
      id: "wall_area",
      label: isFr ? "Surface murale opaque" : "Opaque wall area",
      detail: wallArea > 0
        ? isFr ? `${wallArea.toFixed(1)} m² à ravaler / isoler` : `${wallArea.toFixed(1)} m² to render / insulate`
        : isFr ? "Surface murale non calculable" : "Wall area not calculable",
      status: wallArea > 0 ? "pass" : "warn",
      value: wallArea > 0 ? `${wallArea.toFixed(1)} m²` : "—",
    };

    /* ── 3. Accessibilité PMR — porte d'entrée ≥ 0.9m ── */
    const doors = result.elements.filter(e => e.type === "door");
    const ppmFactor = result.pixels_per_meter;
    let pmrStatus: ComplianceStatus = "warn";
    let pmrDetail = isFr ? "Largeur des portes non mesurable (échelle requise)" : "Door width unmeasurable (scale required)";
    let pmrValue = "—";

    if (ppmFactor && doors.length > 0) {
      // Estimate door width from bbox (assume image is fully loaded)
      // We don't have image dimensions here, but we can approximate from ppm + bbox_norm
      // For mock data, bbox_norm widths ~0.05-0.1 typical
      // Use ratio: door width = bbox_norm.w × facade_width_m
      // facade_width_m ≈ sqrt(facadeArea) × aspect_ratio assumption
      const approxFacadeWidth = Math.sqrt(facadeArea * 1.8); // rough aspect 1.8:1
      const doorWidths = doors.map(d => d.bbox_norm.w * approxFacadeWidth);
      const minDoorW = Math.min(...doorWidths);
      pmrValue = `~${minDoorW.toFixed(2)}m`;
      if (minDoorW >= 0.9) {
        pmrStatus = "pass";
        pmrDetail = isFr ? `Largeur min. porte ≈ ${minDoorW.toFixed(2)}m ≥ 0.9m (PMR)` : `Min door width ≈ ${minDoorW.toFixed(2)}m ≥ 0.9m (PMR)`;
      } else if (minDoorW >= 0.8) {
        pmrStatus = "warn";
        pmrDetail = isFr ? `Largeur min. porte ≈ ${minDoorW.toFixed(2)}m — à vérifier PMR (0.9m)` : `Min door width ≈ ${minDoorW.toFixed(2)}m — check PMR (0.9m)`;
      } else {
        pmrStatus = "fail";
        pmrDetail = isFr ? `Largeur min. porte ≈ ${minDoorW.toFixed(2)}m < 0.9m requis (PMR)` : `Min door width ≈ ${minDoorW.toFixed(2)}m < 0.9m required (PMR)`;
      }
    } else if (doors.length === 0) {
      pmrDetail = isFr ? "Aucune porte détectée" : "No doors detected";
      pmrStatus = "warn";
    }

    const pmrCheck: ComplianceCheck = {
      id: "pmr_doors",
      label: isFr ? "Accessibilité PMR (Loi Elan)" : "PMR Accessibility (Loi Elan)",
      detail: pmrDetail,
      status: pmrStatus,
      value: pmrValue,
      threshold: "≥ 0.9m",
    };

    /* ── 4. Répartition des ouvertures par étage (homogénéité) ── */
    let distStatus: ComplianceStatus = "pass";
    let distDetail = isFr ? "Répartition homogène des ouvertures" : "Evenly distributed openings";

    if (floorCount > 1) {
      const perFloor: Record<number, number> = {};
      result.elements
        .filter(e => ["window", "door", "balcony"].includes(e.type))
        .forEach(e => {
          const lvl = e.floor_level ?? 0;
          perFloor[lvl] = (perFloor[lvl] ?? 0) + 1;
        });
      const counts = Object.values(perFloor);
      if (counts.length > 0) {
        const avg = counts.reduce((s, c) => s + c, 0) / counts.length;
        const maxDev = Math.max(...counts.map(c => Math.abs(c - avg) / avg));
        if (maxDev > 0.5) {
          distStatus = "warn";
          distDetail = isFr
            ? `Variation >50% entre étages — vérifier la distribution`
            : `>50% variation between floors — check distribution`;
        }
      }
    }

    const distCheck: ComplianceCheck = {
      id: "opening_dist",
      label: isFr ? "Distribution des ouvertures" : "Opening distribution",
      detail: distDetail,
      status: distStatus,
      value: `${winCount + doorCount + balcCount} éléments / ${floorCount} niveaux`,
    };

    /* ── 5. ITE recommandée (RE2020 si bâtiment non récent) ── */
    const iteCheck: ComplianceCheck = {
      id: "ite_rec",
      label: isFr ? "Isolation thermique extérieure" : "External thermal insulation",
      detail: isFr
        ? "ITE recommandée pour conformité RE2020 en rénovation (R≥3.7 m².K/W pour murs)"
        : "ITE recommended for RE2020 renovation compliance (R≥3.7 m².K/W for walls)",
      status: "warn",
      value: "—",
      threshold: "R ≥ 3.7",
    };

    return [glazingCheck, wallAreaCheck, pmrCheck, distCheck, iteCheck];
  }, [result, hasArea, isFr]);

  /* ── Score computation ── */
  const passCount = checks.filter(c => c.status === "pass").length;
  const failCount = checks.filter(c => c.status === "fail").length;
  const warnCount = checks.filter(c => c.status === "warn").length;
  const score = checks.length > 0 ? Math.round((passCount / checks.length) * 100) : 0;

  const scoreColor = score >= 80 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-red-400";
  const scoreBg    = score >= 80 ? "from-emerald-500/20" : score >= 50 ? "from-amber-500/20" : "from-red-500/20";

  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex items-center justify-between w-full p-5 cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <div className="text-left">
            <span className="text-white font-semibold">{d("facomp_title" as DTKey)}</span>
            <span className="block text-xs text-slate-400">{d("facomp_subtitle" as DTKey)}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!expanded && hasArea && checks.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-emerald-400">{passCount} ✓</span>
              {warnCount > 0 && <span className="text-amber-400">{warnCount} !</span>}
              {failCount > 0 && <span className="text-red-400">{failCount} ✗</span>}
            </div>
          )}
          {expanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="facomp-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {!hasArea ? (
              <div className="flex items-center gap-3 px-5 py-6 text-amber-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="text-sm">{d("facomp_no_data" as DTKey)}</span>
              </div>
            ) : (
              <div className="pb-5 space-y-4">
                {/* Score banner */}
                <div className={cn("mx-5 mt-0 p-4 rounded-xl bg-gradient-to-r to-transparent", scoreBg, "border border-white/5")}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-slate-400 mb-0.5">{d("facomp_score" as DTKey)}</div>
                      <div className={cn("text-3xl font-display font-700", scoreColor)}>{score}%</div>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <div className="text-center">
                        <div className="font-bold text-emerald-400">{passCount}</div>
                        <div className="text-xs text-slate-500">{d("facomp_pass" as DTKey)}</div>
                      </div>
                      <div className="text-center">
                        <div className="font-bold text-amber-400">{warnCount}</div>
                        <div className="text-xs text-slate-500">{d("facomp_warn" as DTKey)}</div>
                      </div>
                      <div className="text-center">
                        <div className="font-bold text-red-400">{failCount}</div>
                        <div className="text-xs text-slate-500">{d("facomp_fail" as DTKey)}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Checks list */}
                <div className="px-5 space-y-2.5">
                  {checks.map(check => (
                    <div
                      key={check.id}
                      className={cn("rounded-xl border p-4", statusBg(check.status))}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <StatusIcon status={check.status} />
                          <div className="min-w-0">
                            <div className={cn("text-sm font-semibold", statusText(check.status))}>{check.label}</div>
                            <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">{check.detail}</div>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          {check.value && (
                            <div className={cn("text-sm font-mono font-bold", statusText(check.status))}>{check.value}</div>
                          )}
                          {check.threshold && (
                            <div className="text-xs text-slate-500">seuil {check.threshold}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Disclaimer */}
                <div className="mx-5 p-3 rounded-lg bg-white/3 border border-white/5 text-xs text-slate-500 leading-relaxed">
                  {isFr
                    ? "⚠ Ces vérifications sont indicatives et basées sur les données d'analyse. Consultez un bureau d'études pour une conformité réglementaire certifiée."
                    : "⚠ These checks are indicative and based on analysis data. Consult a design office for certified regulatory compliance."}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
