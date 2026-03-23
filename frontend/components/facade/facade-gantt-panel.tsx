"use client";

/**
 * FacadeGanttPanel — Construction timeline (Gantt chart) for facade renovation.
 * Simple SVG horizontal bar chart with color-coded phases relative to a start date.
 * Total duration: ~8 weeks.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarDays, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { FacadeAnalysisResult } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

/* ── Types ── */
interface GanttPhase {
  id: string;
  label: string;
  startDay: number;
  durationDays: number;
  color: string;
}

interface FacadeGanttPanelProps {
  result: FacadeAnalysisResult;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function fmtDate(date: Date, lang: string): string {
  return date.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric",
    month: "short",
  });
}

export default function FacadeGanttPanel({ result }: FacadeGanttPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const isFr = lang === "fr";

  const [expanded, setExpanded] = useState(false);
  const [startDate] = useState(() => {
    // Default start: next Monday
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 7 : 8 - dayOfWeek;
    return addDays(now, daysUntilMonday);
  });

  const hasArea = result.facade_area_m2 != null && result.facade_area_m2 > 0;

  const phases = useMemo<GanttPhase[]>(() => {
    if (!hasArea) return [];

    return [
      {
        id: "diagnostic",
        label: isFr ? "Diagnostic / Preparation" : "Diagnostic / Preparation",
        startDay: 0,
        durationDays: 5,
        color: "#94a3b8",
      },
      {
        id: "scaffolding",
        label: isFr ? "Installation echafaudage" : "Scaffolding installation",
        startDay: 5,
        durationDays: 5,
        color: "#fb923c",
      },
      {
        id: "ravalement",
        label: isFr ? "Ravalement / Enduit / Peinture" : "Rendering / Plaster / Painting",
        startDay: 10,
        durationDays: 15,
        color: "#34d399",
      },
      {
        id: "menuiseries",
        label: isFr ? "Menuiseries exterieures" : "External joinery",
        startDay: 15,
        durationDays: 10,
        color: "#60a5fa",
      },
      {
        id: "finitions",
        label: isFr ? "Finitions / ITE" : "Finishing / Insulation",
        startDay: 30,
        durationDays: 5,
        color: "#a78bfa",
      },
      {
        id: "nettoyage",
        label: isFr ? "Nettoyage / Repli chantier" : "Cleanup / Site clearance",
        startDay: 35,
        durationDays: 3,
        color: "#f472b6",
      },
    ];
  }, [hasArea, isFr]);

  const totalDays = useMemo(() => {
    if (phases.length === 0) return 0;
    return Math.max(...phases.map(p => p.startDay + p.durationDays));
  }, [phases]);

  const endDate = addDays(startDate, totalDays);
  const totalWeeks = Math.ceil(totalDays / 7);

  /* ── SVG dimensions ── */
  const labelWidth = 200;
  const chartPadding = 16;
  const svgWidth = 600;
  const barAreaWidth = svgWidth - labelWidth - chartPadding;
  const rowHeight = 36;
  const headerHeight = 28;
  const svgHeight = headerHeight + phases.length * rowHeight + 8;

  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex items-center justify-between w-full p-5 cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <CalendarDays className="w-5 h-5 text-sky-400" />
          <div className="text-left">
            <span className="text-white font-semibold">{d("fagantt_title" as DTKey)}</span>
            <span className="block text-xs text-slate-400">{d("fagantt_subtitle" as DTKey)}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!expanded && hasArea && (
            <span className="text-xs text-slate-400">~{totalWeeks} {isFr ? "semaines" : "weeks"}</span>
          )}
          {expanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="fagantt-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {!hasArea ? (
              <div className="flex items-center gap-3 px-5 py-6 text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="text-sm">{d("fagantt_no_data" as DTKey)}</span>
              </div>
            ) : (
              <div className="pb-5 space-y-4">
                {/* Date summary */}
                <div className="px-5 flex flex-wrap gap-4 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">{isFr ? "Debut :" : "Start:"}</span>
                    <span className="text-white font-mono">{fmtDate(startDate, lang)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">{isFr ? "Fin :" : "End:"}</span>
                    <span className="text-white font-mono">{fmtDate(endDate, lang)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">{isFr ? "Duree :" : "Duration:"}</span>
                    <span className="text-sky-400 font-mono font-semibold">
                      {totalWeeks} {isFr ? "semaines" : "weeks"} ({totalDays}j)
                    </span>
                  </div>
                </div>

                {/* SVG Gantt chart */}
                <div className="px-5 overflow-x-auto">
                  <svg
                    viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                    className="w-full min-w-[500px]"
                    style={{ maxHeight: svgHeight + 20 }}
                  >
                    {/* Week grid lines */}
                    {Array.from({ length: totalWeeks + 1 }, (_, i) => {
                      const x = labelWidth + (i * 7 / totalDays) * barAreaWidth;
                      return (
                        <g key={`week-${i}`}>
                          <line
                            x1={x} y1={0} x2={x} y2={svgHeight}
                            stroke="rgba(255,255,255,0.06)"
                            strokeWidth={1}
                          />
                          <text
                            x={x + 2} y={12}
                            fill="rgba(148,163,184,0.6)"
                            fontSize={9}
                            fontFamily="monospace"
                          >
                            S{i + 1}
                          </text>
                        </g>
                      );
                    })}

                    {/* Phase bars */}
                    {phases.map((phase, i) => {
                      const y = headerHeight + i * rowHeight;
                      const barX = labelWidth + (phase.startDay / totalDays) * barAreaWidth;
                      const barW = Math.max(8, (phase.durationDays / totalDays) * barAreaWidth);
                      const barH = 20;
                      const barY = y + (rowHeight - barH) / 2;

                      return (
                        <g key={phase.id}>
                          {/* Row separator */}
                          <line
                            x1={0} y1={y} x2={svgWidth} y2={y}
                            stroke="rgba(255,255,255,0.04)"
                            strokeWidth={1}
                          />
                          {/* Label */}
                          <text
                            x={8} y={y + rowHeight / 2 + 4}
                            fill="rgba(203,213,225,0.9)"
                            fontSize={10}
                            fontFamily="system-ui, sans-serif"
                          >
                            {phase.label.length > 28 ? phase.label.slice(0, 26) + "..." : phase.label}
                          </text>
                          {/* Bar */}
                          <rect
                            x={barX}
                            y={barY}
                            width={barW}
                            height={barH}
                            rx={4}
                            fill={phase.color}
                            opacity={0.8}
                          />
                          {/* Duration label on bar */}
                          {barW > 30 && (
                            <text
                              x={barX + barW / 2}
                              y={barY + barH / 2 + 4}
                              fill="white"
                              fontSize={9}
                              fontWeight="600"
                              fontFamily="monospace"
                              textAnchor="middle"
                            >
                              {phase.durationDays}j
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </div>

                {/* Legend */}
                <div className="px-5 flex flex-wrap gap-3">
                  {phases.map(phase => (
                    <div key={phase.id} className="flex items-center gap-1.5 text-xs text-slate-400">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-sm"
                        style={{ backgroundColor: phase.color }}
                      />
                      {phase.label}
                    </div>
                  ))}
                </div>

                {/* Disclaimer */}
                <div className="mx-5 p-3 rounded-lg bg-white/3 border border-white/5 text-xs text-slate-500 leading-relaxed">
                  {isFr
                    ? "Planning indicatif genere automatiquement. Les durees reelles dependent du metrage, des conditions meteo et de la disponibilite des entreprises."
                    : "Indicative schedule generated automatically. Actual durations depend on quantities, weather conditions and contractor availability."}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
