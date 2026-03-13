"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LayoutDashboard, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import type { AnalysisResult, CustomDetection } from "@/lib/types";
import { runComplianceChecks } from "@/lib/compliance-checker";
import { buildDefaultDpgf } from "@/lib/dpgf-defaults";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

/* ── Room type colour palette (same as results-step) ── */
const ROOM_COLORS: Record<string, string> = {
  bedroom: "#818cf8", "living room": "#34d399", living: "#34d399",
  kitchen: "#fb923c", bathroom: "#22d3ee", hallway: "#94a3b8",
  corridor: "#94a3b8", office: "#a78bfa", study: "#a78bfa",
  wc: "#fbbf24", toilet: "#fbbf24", "dining room": "#f472b6",
  storage: "#78716c", closet: "#78716c", garage: "#6b7280",
  balcony: "#86efac", laundry: "#67e8f9",
};
function roomColor(type: string) { return ROOM_COLORS[type?.toLowerCase()] ?? "#94a3b8"; }

/* ── Circular arc SVG for score ── */
function ScoreArc({ pct, size = 64 }: { pct: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(pct, 100) / 100);
  const color = pct >= 80 ? "#34d399" : pct >= 50 ? "#fbbf24" : "#f87171";

  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={5} />
      <circle
        cx={c} cy={c} r={r} fill="none"
        stroke={color} strokeWidth={5}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${c} ${c})`}
      />
      <text x={c} y={c} textAnchor="middle" dominantBaseline="central"
        fill={color} fontSize={size * 0.28} fontWeight="700">
        {Math.round(pct)}%
      </text>
    </svg>
  );
}

interface DashboardPanelProps {
  result: AnalysisResult;
  customDetections?: CustomDetection[];
}

export default function DashboardPanel({ result, customDetections = [] }: DashboardPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [expanded, setExpanded] = useState(true); // starts expanded

  const sf = result.surfaces ?? {};
  const rooms = result.rooms ?? [];
  const ppm = result.pixels_per_meter;

  /* ── Derived metrics (memoised) ── */
  const compliance = useMemo(
    () => runComplianceChecks(result, { ceilingHeight: 2.5 }),
    [result],
  );

  const dpgf = useMemo(
    () => buildDefaultDpgf(result, customDetections, { ceilingHeight: 2.5 }),
    [result, customDetections],
  );

  /* ── Room breakdown by type ── */
  const roomBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rooms) {
      const t = r.type || "other";
      map.set(t, (map.get(t) ?? 0) + (r.area_m2 ?? 0));
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, area]) => ({ type, area, color: roomColor(type) }));
  }, [rooms]);

  const totalArea = roomBreakdown.reduce((s, r) => s + r.area, 0);

  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden mt-4">
      {/* ── Header ── */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
        style={{
          background: expanded
            ? "linear-gradient(135deg, rgba(14,165,233,0.10) 0%, rgba(6,182,212,0.07) 100%)"
            : undefined,
        }}
      >
        <div className="flex items-center gap-3">
          <LayoutDashboard className="w-5 h-5 text-sky-400" />
          <span className="font-display font-semibold text-white text-sm">
            {d("dash_title" as DTKey)}
          </span>
        </div>
        {expanded
          ? <ChevronUp className="w-5 h-5 text-slate-400" />
          : <ChevronDown className="w-5 h-5 text-slate-400" />}
      </button>

      {/* ── Content ── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="dash-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-2 space-y-4">
              {/* ── Row 1 : core metrics ── */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard
                  label={d("dash_area" as DTKey)}
                  value={sf.area_hab_m2 != null ? `${sf.area_hab_m2.toFixed(1)} m²` : "—"}
                  color="#34d399" icon="🏠"
                />
                <KpiCard
                  label={d("dash_rooms" as DTKey)}
                  value={rooms.length.toString()}
                  color="#818cf8" icon="🚪"
                />
                <KpiCard
                  label={d("dash_openings" as DTKey)}
                  value={((result.doors_count ?? 0) + (result.windows_count ?? 0)).toString()}
                  color="#22d3ee" icon="🪟"
                />
                <KpiCard
                  label={d("dash_walls" as DTKey)}
                  value={sf.area_walls_m2 != null ? `${sf.area_walls_m2.toFixed(1)} m²` : "—"}
                  color="#60a5fa" icon="🧱"
                />
              </div>

              {/* ── Row 2 : derived metrics ── */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Compliance score */}
                <div className="glass rounded-xl border border-white/10 p-4 flex items-center gap-4">
                  <ScoreArc pct={compliance.score_pct} />
                  <div>
                    <p className="text-xs text-slate-500 mb-1">{d("dash_compliance" as DTKey)}</p>
                    <p className="text-sm text-slate-300">
                      <span className="text-emerald-400">{compliance.pass_count}</span>
                      {" / "}
                      <span className="text-red-400">{compliance.fail_count}</span>
                      {" / "}
                      <span className="text-amber-400">{compliance.warn_count}</span>
                    </p>
                    <p className="text-[10px] text-slate-600 mt-0.5">pass / fail / warn</p>
                  </div>
                </div>

                {/* Estimated cost */}
                <div className="glass rounded-xl border border-white/10 p-4">
                  <p className="text-xs text-slate-500 mb-1">{d("dash_cost" as DTKey)}</p>
                  <p className="text-xl font-display font-700 text-amber-400">
                    {dpgf.total_ttc != null
                      ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(dpgf.total_ttc)
                      : "—"}
                  </p>
                  <p className="text-[10px] text-slate-600 mt-0.5">TTC estimé</p>
                </div>

                {/* Scale calibration */}
                <div className="glass rounded-xl border border-white/10 p-4">
                  <p className="text-xs text-slate-500 mb-1">{d("dash_scale" as DTKey)}</p>
                  {ppm != null && ppm > 0 ? (
                    <>
                      <p className="text-xl font-display font-700 text-sky-400">
                        {ppm.toFixed(1)} <span className="text-sm text-slate-400">px/m</span>
                      </p>
                      <p className="text-[10px] text-slate-600 mt-0.5">1 px = {(1 / ppm * 100).toFixed(2)} cm</p>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-amber-500">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="text-sm">{d("dash_no_scale" as DTKey)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Row 3 : room breakdown bar ── */}
              {roomBreakdown.length > 0 && (
                <div className="glass rounded-xl border border-white/10 p-4">
                  <p className="text-xs text-slate-500 mb-3">{d("dash_room_breakdown" as DTKey)}</p>
                  {/* Stacked bar */}
                  <div className="flex rounded-lg overflow-hidden h-6">
                    {roomBreakdown.map(({ type, area, color }) => (
                      <div
                        key={type}
                        style={{
                          width: `${totalArea > 0 ? (area / totalArea) * 100 : 0}%`,
                          backgroundColor: color,
                          minWidth: area > 0 ? "2px" : 0,
                        }}
                        className="relative group transition-all"
                        title={`${type}: ${area.toFixed(1)} m²`}
                      />
                    ))}
                  </div>
                  {/* Legend */}
                  <div className="flex flex-wrap gap-3 mt-3">
                    {roomBreakdown.map(({ type, area, color }) => (
                      <div key={type} className="flex items-center gap-1.5 text-xs">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                        <span className="text-slate-400 capitalize">{type}</span>
                        <span className="text-slate-600 font-mono">{area.toFixed(1)} m²</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Simple KPI card sub-component ── */
function KpiCard({ label, value, color, icon }: { label: string; value: string; color: string; icon: string }) {
  return (
    <div className="glass rounded-xl border border-white/10 p-4">
      <p className="text-xs text-slate-500 mb-1">{icon} {label}</p>
      <p className="text-xl font-display font-700" style={{ color }}>{value}</p>
    </div>
  );
}
