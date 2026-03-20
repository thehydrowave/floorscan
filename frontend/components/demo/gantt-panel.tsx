"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarRange,
  ChevronDown,
  ChevronUp,
  Download,
  AlertTriangle,
  Users,
  Plus,
  Trash2,
  RefreshCw,
} from "lucide-react";
import type { AnalysisResult, CustomDetection } from "@/lib/types";
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

const LABEL_WIDTH = 188;
const ROW_HEIGHT = 36;
const BAR_HEIGHT = 22;
const HEADER_HEIGHT = 32;
const DAY_WIDTH = 18;
const MIN_CHART_WIDTH = 400;

// Palette for user-added tasks
const DEFAULT_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#6366f1", "#a855f7", "#ec4899",
];

// ── Input style ─────────────────────────────────────────────────────────────────

const inputCls =
  "w-full bg-transparent border border-transparent hover:border-white/10 " +
  "focus:border-rose-500/50 rounded px-1.5 py-0.5 text-white text-xs " +
  "focus:outline-none focus:bg-white/5 transition-colors";

// ── Component ───────────────────────────────────────────────────────────────────

export default function GanttPanel({
  result,
  customDetections = [],
}: GanttPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const svgRef = useRef<SVGSVGElement>(null);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState(false);
  const [teamSize, setTeamSize] = useState(1);
  const [startDate, setStartDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );

  // ── Editable tasks state ───────────────────────────────────────────────────
  const [tasks, setTasks] = useState<GanttTask[]>(() => {
    const dpgf = buildDefaultDpgf(result, customDetections, {
      ceilingHeight: 2.5,
    });
    return buildGanttTasks(dpgf, { teamSize: 1 });
  });

  // Re-init on new analysis result
  useEffect(() => {
    const dpgf = buildDefaultDpgf(result, customDetections, {
      ceilingHeight: 2.5,
    });
    setTasks(buildGanttTasks(dpgf, { teamSize: 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const total = useMemo(() => totalDuration(tasks), [tasks]);
  const chartWidth = Math.max(MIN_CHART_WIDTH, total * DAY_WIDTH);
  const svgWidth = LABEL_WIDTH + chartWidth + 20;
  const svgHeight = HEADER_HEIGHT + tasks.length * ROW_HEIGHT + 10;

  const weekLines = useMemo(() => {
    const lines: number[] = [];
    for (let day = 7; day <= total; day += 7) lines.push(day);
    return lines;
  }, [total]);

  // ── Task handlers ──────────────────────────────────────────────────────────

  function updateTask(
    lotNumber: number,
    changes: Partial<Pick<GanttTask, "title_key" | "start_day" | "duration_days">>
  ) {
    setTasks((prev) =>
      prev.map((t) => (t.lot_number === lotNumber ? { ...t, ...changes } : t))
    );
  }

  function addTask() {
    const id = Date.now();
    const colorIdx = tasks.length % DEFAULT_COLORS.length;
    setTasks((prev) => [
      ...prev,
      {
        lot_number: id,
        title_key: "Nouvelle tâche",
        color: DEFAULT_COLORS[colorIdx],
        icon: "🔧",
        start_day: total > 0 ? total : 0,
        duration_days: 1,
        depends_on: [],
      },
    ]);
  }

  function deleteTask(lotNumber: number) {
    setTasks((prev) => prev.filter((t) => t.lot_number !== lotNumber));
  }

  // Re-build from DPGF productivity rates
  function autoFill() {
    const dpgf = buildDefaultDpgf(result, customDetections, {
      ceilingHeight: 2.5,
    });
    setTasks(buildGanttTasks(dpgf, { teamSize }));
  }

  // ── Export PNG ─────────────────────────────────────────────────────────────
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
      const scale = 2;
      canvas.width = svgWidth * scale;
      canvas.height = svgHeight * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
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
    img.onerror = () => {
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [svgWidth, svgHeight]);

  // ── Date helper ────────────────────────────────────────────────────────────
  function addDays(dateStr: string, days: number): string {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return date.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
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

            {/* ── Controls row ─────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-4 px-5 mb-4">
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

              {/* Team size — used only for auto-fill */}
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

              {/* Auto-fill button */}
              <button
                type="button"
                onClick={autoFill}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white rounded-lg text-xs font-semibold transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Recalculer depuis DPGF
              </button>

              {/* Total duration */}
              <span className="text-xs text-rose-400 font-semibold ml-auto">
                {(d("gantt_total_days" as DTKey) as string).replace(
                  "{n}",
                  String(total)
                )}
              </span>
            </div>

            {/* ── Editable tasks table ──────────────────────────────────────── */}
            <div className="mx-5 mb-4 rounded-lg border border-white/10 overflow-hidden">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-white/5 text-slate-400 text-left">
                    <th className="px-3 py-2 w-6 font-semibold" />
                    <th className="px-3 py-2 font-semibold">Nom de la tâche</th>
                    <th className="px-3 py-2 w-24 font-semibold text-right">
                      Début&nbsp;(j)
                    </th>
                    <th className="px-3 py-2 w-24 font-semibold text-right">
                      Durée&nbsp;(j)
                    </th>
                    <th className="px-3 py-2 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => {
                    // Display name: try i18n lookup, fallback to raw key (custom tasks)
                    const displayName = dt(task.title_key as DTKey, lang);

                    return (
                      <tr
                        key={task.lot_number}
                        className="group border-t border-white/5 hover:bg-white/[0.02] transition-colors"
                      >
                        {/* Color dot */}
                        <td className="px-3 py-1.5">
                          <span
                            className="block w-2.5 h-2.5 rounded-full"
                            style={{ background: task.color }}
                          />
                        </td>

                        {/* Task name */}
                        <td className="px-3 py-1.5">
                          <input
                            type="text"
                            value={displayName}
                            onChange={(e) =>
                              updateTask(task.lot_number, {
                                title_key: e.target.value,
                              })
                            }
                            className={inputCls}
                          />
                        </td>

                        {/* Start day */}
                        <td className="px-3 py-1.5">
                          <input
                            type="number"
                            value={task.start_day}
                            min={0}
                            onChange={(e) =>
                              updateTask(task.lot_number, {
                                start_day: Math.max(
                                  0,
                                  parseInt(e.target.value) || 0
                                ),
                              })
                            }
                            className={`${inputCls} text-right`}
                          />
                        </td>

                        {/* Duration */}
                        <td className="px-3 py-1.5">
                          <input
                            type="number"
                            value={task.duration_days}
                            min={1}
                            onChange={(e) =>
                              updateTask(task.lot_number, {
                                duration_days: Math.max(
                                  1,
                                  parseInt(e.target.value) || 1
                                ),
                              })
                            }
                            className={`${inputCls} text-right`}
                          />
                        </td>

                        {/* Delete */}
                        <td className="px-3 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => deleteTask(task.lot_number)}
                            title="Supprimer"
                            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Add task button */}
              <button
                type="button"
                onClick={addTask}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs text-slate-500 hover:text-slate-300 hover:bg-white/5 border-t border-white/5 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Ajouter une tâche
              </button>
            </div>

            {/* ── SVG Gantt chart ───────────────────────────────────────────── */}
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

                {/* Week vertical lines + labels */}
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
                {Array.from(
                  { length: Math.ceil(total / 5) },
                  (_, i) => (i + 1) * 5
                )
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
                      {d("gantt_day_short" as DTKey)}
                      {day}
                    </text>
                  ))}

                {/* Task rows */}
                {tasks.map((task, idx) => {
                  const rowY = HEADER_HEIGHT + idx * ROW_HEIGHT;
                  const barX = LABEL_WIDTH + task.start_day * DAY_WIDTH;
                  const barW = Math.max(
                    DAY_WIDTH,
                    task.duration_days * DAY_WIDTH
                  );
                  const barY = rowY + (ROW_HEIGHT - BAR_HEIGHT) / 2;
                  const labelText = dt(task.title_key as DTKey, lang);
                  const durationLabel = `${task.duration_days}${d(
                    "gantt_day_short" as DTKey
                  )}`;

                  return (
                    <g key={task.lot_number}>
                      {/* Alternating row bg */}
                      {idx % 2 === 0 && (
                        <rect
                          x={0}
                          y={rowY}
                          width={svgWidth}
                          height={ROW_HEIGHT}
                          fill="rgba(255,255,255,0.015)"
                        />
                      )}

                      {/* Color indicator */}
                      <rect
                        x={10}
                        y={rowY + (ROW_HEIGHT - 8) / 2}
                        width={8}
                        height={8}
                        rx={2}
                        fill={task.color}
                      />

                      {/* Label */}
                      <text
                        x={24}
                        y={rowY + ROW_HEIGHT / 2 + 4}
                        fill="rgba(255,255,255,0.7)"
                        fontSize={10}
                      >
                        {labelText.length > 17
                          ? labelText.slice(0, 17) + "…"
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

                      {/* Date range after bar */}
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
