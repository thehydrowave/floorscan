"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bug,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  ChevronRight,
} from "lucide-react";
import type { AnalysisResult, CustomDetection } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

// ── Props ───────────────────────────────────────────────────────────────────────

interface DebugPanelProps {
  result: AnalysisResult;
  customDetections?: CustomDetection[];
}

// ── Stat line component ─────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  color = "text-slate-300",
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/[0.03]">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-xs font-mono ${color}`}>{String(value)}</span>
    </div>
  );
}

// ── Collapsible section ─────────────────────────────────────────────────────────

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-white/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-white/[0.02] transition-colors cursor-pointer text-left"
      >
        <ChevronRight
          className={`w-3.5 h-3.5 text-slate-600 transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
        <span className="text-xs text-slate-400 font-medium">{title}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────────────

export default function DebugPanel({
  result,
  customDetections = [],
}: DebugPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── Derived data ──────────────────────────────────────────────────────────────
  const rooms = result.rooms ?? [];
  const walls = result.walls ?? [];
  const openings = result.openings ?? [];
  const doors = openings.filter((o) => o.class === "door");
  const windows = openings.filter((o) => o.class === "window");

  const masks = useMemo(() => {
    const m: string[] = [];
    if (result.mask_doors_b64) m.push("doors");
    if (result.mask_windows_b64) m.push("windows");
    if (result.mask_walls_b64) m.push("walls");
    if (result.mask_rooms_b64) m.push("rooms");
    if (result.overlay_openings_b64) m.push("overlay_openings");
    if (result.overlay_interior_b64) m.push("overlay_interior");
    if (result.plan_b64) m.push("plan");
    return m;
  }, [result]);

  // ── Copy JSON ─────────────────────────────────────────────────────────────────
  async function handleCopy() {
    try {
      // Strip base64 images for smaller JSON
      const stripped = { ...result };
      const b64Keys = [
        "overlay_openings_b64",
        "overlay_interior_b64",
        "mask_doors_b64",
        "mask_windows_b64",
        "mask_walls_b64",
        "mask_rooms_b64",
        "plan_b64",
      ] as const;
      for (const k of b64Keys) {
        if ((stripped as Record<string, unknown>)[k]) {
          (stripped as Record<string, unknown>)[k] = `[base64 ${
            ((stripped as Record<string, unknown>)[k] as string).length
          } chars]`;
        }
      }
      await navigator.clipboard.writeText(JSON.stringify(stripped, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn("Clipboard copy failed:", e);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden mt-4 opacity-70 hover:opacity-100 transition-opacity">
      {/* ── Header toggle ──────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Bug className="w-4 h-4 text-slate-500" />
          <span className="font-display font-medium text-slate-400 text-xs">
            {d("debug_title" as DTKey)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!expanded && (
            <span className="text-[10px] text-slate-600 font-mono mr-2">
              {result.session_id?.slice(0, 8)}
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-slate-600" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-600" />
          )}
        </div>
      </button>

      {/* ── Expandable content ──────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="debug-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {/* ── Overview section ─────────────────────────────────────────── */}
            <Section title="Overview" defaultOpen={true}>
              <Stat label={d("debug_session" as DTKey)} value={result.session_id || "—"} />
              <Stat
                label={d("debug_scale" as DTKey)}
                value={
                  result.pixels_per_meter
                    ? `${result.pixels_per_meter.toFixed(2)} px/m`
                    : "❌ non calibré"
                }
                color={
                  result.pixels_per_meter ? "text-emerald-400" : "text-red-400"
                }
              />
              <Stat
                label={d("debug_rooms" as DTKey)}
                value={rooms.length}
                color={rooms.length > 0 ? "text-emerald-400" : "text-amber-400"}
              />
              <Stat label={d("debug_doors" as DTKey)} value={result.doors_count ?? 0} />
              <Stat label={d("debug_windows" as DTKey)} value={result.windows_count ?? 0} />
              <Stat label={d("debug_walls" as DTKey)} value={walls.length} />
            </Section>

            {/* ── Surfaces section ────────────────────────────────────────── */}
            <Section title={d("debug_surfaces" as DTKey)}>
              <Stat
                label={d("debug_hab" as DTKey)}
                value={
                  result.surfaces?.area_hab_m2
                    ? `${result.surfaces.area_hab_m2.toFixed(2)} m²`
                    : "—"
                }
              />
              <Stat
                label={d("debug_building" as DTKey)}
                value={
                  result.surfaces?.area_building_m2
                    ? `${result.surfaces.area_building_m2.toFixed(2)} m²`
                    : "—"
                }
              />
              <Stat
                label={d("debug_walls_area" as DTKey)}
                value={
                  result.surfaces?.area_walls_m2
                    ? `${result.surfaces.area_walls_m2.toFixed(2)} m²`
                    : "—"
                }
              />
            </Section>

            {/* ── Perimeters section ──────────────────────────────────────── */}
            <Section title={d("debug_perimeters" as DTKey)}>
              <Stat
                label={d("debug_interior" as DTKey)}
                value={
                  result.surfaces?.perim_interior_m
                    ? `${result.surfaces.perim_interior_m.toFixed(2)} m`
                    : "—"
                }
              />
              <Stat
                label={d("debug_building" as DTKey)}
                value={
                  result.surfaces?.perim_building_m
                    ? `${result.surfaces.perim_building_m.toFixed(2)} m`
                    : "—"
                }
              />
            </Section>

            {/* ── Rooms detail ────────────────────────────────────────────── */}
            {rooms.length > 0 && (
              <Section title={`${d("debug_rooms" as DTKey)} (${rooms.length})`}>
                <div className="space-y-1">
                  {rooms.map((room, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-[10px] py-1 border-b border-white/[0.02]"
                    >
                      <span className="text-slate-400">
                        #{room.id} {room.label_fr || room.type}
                      </span>
                      <span className="font-mono text-slate-500">
                        {room.area_m2 ? `${room.area_m2.toFixed(1)} m²` : "—"}
                        {room.perimeter_m
                          ? ` · ${room.perimeter_m.toFixed(1)} ml`
                          : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ── Openings detail ─────────────────────────────────────────── */}
            {openings.length > 0 && (
              <Section title={`${d("debug_openings" as DTKey)} (${openings.length})`}>
                <div className="space-y-1">
                  {openings.map((op, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-[10px] py-1 border-b border-white/[0.02]"
                    >
                      <span
                        className={
                          op.class === "door"
                            ? "text-purple-400"
                            : "text-cyan-400"
                        }
                      >
                        {op.class === "door" ? "🚪" : "🪟"} {op.class} #{i + 1}
                      </span>
                      <span className="font-mono text-slate-500">
                        {op.width_m ? `${op.width_m.toFixed(2)}m` : `${op.width_px}px`}
                        {" × "}
                        {op.height_m
                          ? `${op.height_m.toFixed(2)}m`
                          : `${op.height_px}px`}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ── Masks ──────────────────────────────────────────────────── */}
            <Section title={`${d("debug_masks" as DTKey)} (${masks.length})`}>
              <div className="flex flex-wrap gap-1.5">
                {masks.map((m) => (
                  <span
                    key={m}
                    className="text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-slate-400 font-mono"
                  >
                    {m}
                  </span>
                ))}
                {masks.length === 0 && (
                  <span className="text-[10px] text-slate-600">aucun</span>
                )}
              </div>
            </Section>

            {/* ── Custom detections ───────────────────────────────────────── */}
            {customDetections.length > 0 && (
              <Section title={`${d("debug_custom" as DTKey)} (${customDetections.length})`}>
                <div className="space-y-1">
                  {customDetections.map((cd) => (
                    <div
                      key={cd.id}
                      className="flex items-center justify-between text-[10px] py-1 border-b border-white/[0.02]"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: cd.color }}
                        />
                        <span className="text-slate-400">{cd.label}</span>
                      </div>
                      <span className="font-mono text-slate-500">
                        {cd.count} match
                        {cd.count > 1 ? "es" : ""}
                        {cd.total_area_m2
                          ? ` · ${cd.total_area_m2.toFixed(2)} m²`
                          : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ── Edit history ────────────────────────────────────────────── */}
            {(result.edit_history_len !== undefined ||
              result.edit_future_len !== undefined) && (
              <Section title="Edit history">
                <Stat
                  label="Undo stack"
                  value={result.edit_history_len ?? 0}
                />
                <Stat
                  label="Redo stack"
                  value={result.edit_future_len ?? 0}
                />
              </Section>
            )}

            {/* ── Stats (pass1 / pass2) ──────────────────────────────────── */}
            {result.stats && (
              <Section title="Pipeline stats">
                {result.stats.pass1 && (
                  <div className="text-[10px] text-slate-500 font-mono bg-white/[0.02] rounded p-2 mb-1 max-h-32 overflow-y-auto">
                    <span className="text-slate-400">pass1: </span>
                    {JSON.stringify(result.stats.pass1, null, 1)}
                  </div>
                )}
                {result.stats.pass2 && (
                  <div className="text-[10px] text-slate-500 font-mono bg-white/[0.02] rounded p-2 max-h-32 overflow-y-auto">
                    <span className="text-slate-400">pass2: </span>
                    {JSON.stringify(result.stats.pass2, null, 1)}
                  </div>
                )}
              </Section>
            )}

            {/* ── Copy JSON button ────────────────────────────────────────── */}
            <div className="flex gap-2 px-5 py-3 border-t border-white/5">
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-400 rounded-lg text-xs font-medium border border-white/10 transition-colors"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-green-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copied
                  ? d("debug_copied" as DTKey)
                  : d("debug_copy" as DTKey)}
              </button>
              <span className="text-[10px] text-slate-600 self-center">
                {d("debug_raw_json" as DTKey)}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
