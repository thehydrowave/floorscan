"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarRange,
  ChevronDown,
  ChevronUp,
  Download,
  AlertTriangle,
  Users,
} from "lucide-react";
import type { AnalysisResult, CustomDetection, DpgfState } from "@/lib/types";
import { buildDefaultDpgf } from "@/lib/dpgf-defaults";
import { buildGanttTasks, totalDuration, GanttTask } from "@/lib/gantt-builder";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

// ── Props ───────────────────────────────────────────────────────────────────────

interface GanttPanelProps {
  result: AnalysisResult;
  customDetections?: CustomDetection[];
}

// ── Layout constants ────────────────────────────────────────────────────────────

const LABEL_WIDTH = 180;
const ROW_HEIGHT = 36;
const BAR_HEIGHT = 22;
const HEADER_HEIGHT = 32;
const DAY_WIDTH = 18;
const MIN_CHART_WIDTH = 400;

// ── Component ───────────────────────────────────────────────────────────────────

export default function GanttPanel({
  result,
  customDetections = [],
}: GanttPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const svgRef = useRef<SVGSVGElement>(null);

  // ── State ─────────────────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState(false);
  const [teamSize, setTeamSize] = useState(1);
  const [startDate, setStartDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );

  // ── Build DPGF + Gantt tasks ──────────────────────────────────────────────────
  const dpgf = useMemo<DpgfState>(
    () => buildDefaultDpgf(result, customDetections, { ceilingHeight: 2.5 }),
    [result, customDetections]
  );

  const tasks = useMemo<GanttTask[]>(
    () => buildGanttTasks(dpgf, { teamSize }),
    [dpgf, teamSize]
  );

  const total = useMemo(() => totalDuration(tasks), [tasks]);

  // ── SVG dimensions ────────────────────────────────────────────────────────────
  const chartWidth = Math.max(MIN_CHART_WIDTH, total * DAY_WIDTH);
  const svgWidth = LABEL_WIDTH + chartWidth + 20;
  const svgHeight = HEADER_HEIGHT + tasks.length * ROW_HEIGHT + 10;

  // ── Week markers ──────────────────────────────────────────────────────────────
  const weekLines = useMemo(() => {
    const lines: number[] = [];
    for (let day = 7; day <= total; day += 7) {
      lines.push(day);
    }
    return lines;
  }, [total]);

  // ── Export PNG ─────────────────────────────────────────────────────────────────
  const exportPng = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svg);
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = 2; // Retina
      canvas.width = svgWidth * scale;
      canvas.height = svgHeight * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(scale, scale);
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, svgWidth, svgHeight);
      ctx.drawImage(img, 0, 0, svgWidth, svgHeight);
      URL.revokeObjectURL(url);

      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(pngBlob);
        a.download = "floorscan_planning.png";
        a.click();
        URL.revokeObjectURL(a.href);
      }, "image/png");
    };
    img.src = url;
  }, [svgWidth, svgHeight]);

  // ── Format date helper ────────────────────────────────────────────────────────
  function addDays(dateStr: string, days: number): string {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return date.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden mt-4">
      {/* ── Header toggle ──────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <CalendarRange className="w-5 h-5 text-rose-400" />
          <span className="font-display font-semibold text-white text-sm">
            {d("gantt_title" as DTKey)}
          </span>
          <span className="text-[10px] bg-rose-500/20 border border-rose-500/30 rounded px-1.5 py-0.5 font-semibold text-rose-400 uppercase tracking-wider">
            {d("gantt_wip" as DTKey)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!expanded && total > 0 && (
            <span className="font-mono text-sm text-rose-400 mr-2">
              {total} {d("gantt_days" as DTKey)}
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-400" />
          )}
        </div>
      </button>

      {/* ── Expandable content ──────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="gantt-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {/* No scale warning */}
            {!result.pixels_per_meter && (
              <div className="mx-5 mb-4 flex items-center gap-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {d("gantt_no_data" as DTKey)}
              </div>
            )}

            {/* Parameters row */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 px-5 mb-4">
              {/* Team size slider */}
              <label className="text-xs text-slate-500 flex items-center gap-2">
                <Users className="w-4 h-4" />
                {d("gantt_team_size" as DTKey)}
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={1}
                  value={teamSize}
                  onChange={(e) => setTeamSize(parseInt(e.target.value))}
                  className="w-20 accent-rose-500"
                />
                <span className="font-mono text-white text-sm w-6 text-center">
                  {teamSize}
                </span>
                <span className="text-[10px] text-slate-600">
                  {teamSize === 1
                    ? d("gantt_person" as DTKey)
                    : d("gantt_persons" as DTKey)}
                </span>
              </label>

              {/* Start date */}
              <label className="text-xs text-slate-500 flex items-center gap-2">
                {d("gantt_start_date" as DTKey)}
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </label>

              {/* Total duration badge */}
              <div className="flex items-center">
                <span className="text-xs text-rose-400 font-semibold">
                  {(d("gantt_total_days" as DTKey) as string).replace(
                    "{n}",
                    String(total)
                  )}
                </span>
              </div>
            </div>

            {/* ── SVG Gantt Chart ──────────────────────────────────────────── */}
            <div className="mx-5 mb-4 overflow-x-auto rounded-lg border border-white/5 bg-white/[0.02]">
              <svg
                ref={svgRef}
                width={svgWidth}
                height={svgHeight}
                viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                xmlns="http://www.w3.org/2000/svg"
                className="font-mono"
              >
                {/* Background */}
                <rect
                  width={svgWidth}
                  height={svgHeight}
                  fill="transparent"
                />

                {/* ── Day/Week axis ── */}
                {/* Week vertical lines */}
                {weekLines.map((day) => (
                  <g key={`week-${day}`}>
                    <line
                      x1={LABEL_WIDTH + day * DAY_WIDTH}
                      y1={0}
                      x2={LABEL_WIDTH + day * DAY_WIDTH}
                      y2={svgHeight}
                      stroke="rgba(255,255,255,0.06)"
                      strokeWidth={1}
                    />
                    <text
                      x={LABEL_WIDTH + day * DAY_WIDTH}
                      y={12}
                      fill="rgba(255,255,255,0.25)"
                      fontSize={9}
                      textAnchor="middle"
                    >
                      S{Math.floor(day / 7)}
                    </text>
                  </g>
                ))}

                {/* Day ticks (every 5 days) */}
                {Array.from({ length: Math.ceil(total / 5) }, (_, i) => (i + 1) * 5)
                  .filter((day) => day % 7 !== 0 && day <= total)
                  .map((day) => (
                    <text
                      key={`day-${day}`}
                      x={LABEL_WIDTH + day * DAY_WIDTH}
                      y={24}
                      fill="rgba(255,255,255,0.15)"
                      fontSize={8}
                      textAnchor="middle"
                    >
                      {d("gantt_day_short" as DTKey)}{day}
                    </text>
                  ))}

                {/* ── Task rows ── */}
                {tasks.map((task, idx) => {
                  const rowY = HEADER_HEIGHT + idx * ROW_HEIGHT;
                  const barX = LABEL_WIDTH + task.start_day * DAY_WIDTH;
                  const barW = Math.max(
                    DAY_WIDTH,
                    task.duration_days * DAY_WIDTH
                  );
                  const barY = rowY + (ROW_HEIGHT - BAR_HEIGHT) / 2;
                  const labelText = d(task.title_key as DTKey);
                  const durationLabel = `${task.duration_days}${d("gantt_day_short" as DTKey)}`;

                  return (
                    <g key={task.lot_number}>
                      {/* Row background (alternating) */}
                      {idx % 2 === 0 && (
                        <rect
                          x={0}
                          y={rowY}
                          width={svgWidth}
                          height={ROW_HEIGHT}
                          fill="rgba(255,255,255,0.015)"
                        />
                      )}

                      {/* Label */}
                      <text
                        x={10}
                        y={rowY + ROW_HEIGHT / 2 + 4}
                        fill="rgba(255,255,255,0.7)"
                        fontSize={10}
                      >
                        <tspan fill="rgba(255,255,255,0.35)" fontSize={9}>
                          L{task.lot_number}{" "}
                        </tspan>
                        {labelText.length > 18
                          ? labelText.slice(0, 18) + "…"
                          : labelText}
                      </text>

                      {/* Bar */}
                      <rect
                        x={barX}
                        y={barY}
                        width={barW}
                        height={BAR_HEIGHT}
                        rx={4}
                        fill={task.color}
                        opacity={0.85}
                      />

                      {/* Duration text on bar */}
                      {barW > 30 && (
                        <text
                          x={barX + barW / 2}
                          y={barY + BAR_HEIGHT / 2 + 4}
                          fill="white"
                          fontSize={9}
                          fontWeight="bold"
                          textAnchor="middle"
                        >
                          {durationLabel}
                        </text>
                      )}

                      {/* Date label after bar */}
                      <text
                        x={barX + barW + 6}
                        y={barY + BAR_HEIGHT / 2 + 3}
                        fill="rgba(255,255,255,0.3)"
                        fontSize={8}
                      >
                        {addDays(startDate, task.start_day)} →{" "}
                        {addDays(
                          startDate,
                          task.start_day + task.duration_days
                        )}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* ── Export button ──────────────────────────────────────────────── */}
            <div className="flex gap-2 px-5 py-4 border-t border-white/5">
              <button
                type="button"
                onClick={exportPng}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                {d("gantt_export_png" as DTKey)}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
