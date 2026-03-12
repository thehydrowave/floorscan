"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Columns2, Layers, Palette, Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DiffResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

/* ── Props ───────────────────────────────────────────────────────────────────── */

interface DiffViewStepProps {
  result: DiffResult;
  v1ImageB64: string;
  v2ImageB64: string;
  onRestart: () => void;
}

/* ── Component ───────────────────────────────────────────────────────────────── */

export default function DiffViewStep({
  result,
  v1ImageB64,
  v2ImageB64,
  onRestart,
}: DiffViewStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [viewMode, setViewMode] = useState<"side" | "overlay" | "diff">("side");
  const [overlayOpacity, setOverlayOpacity] = useState(50);

  /* ── Export helper ─────────────────────────────────────────────────────────── */

  function exportDiffPng() {
    const a = document.createElement("a");
    a.href = `data:image/png;base64,${result.diff_overlay_b64}`;
    a.download = "plan_diff.png";
    a.click();
  }

  /* ── Stats shorthand ───────────────────────────────────────────────────────── */

  const stats = result.diff_stats;

  /* ── View mode buttons config ──────────────────────────────────────────────── */

  const viewModes: { key: "side" | "overlay" | "diff"; label: DTKey; Icon: typeof Columns2 }[] = [
    { key: "side",    label: "di_side",    Icon: Columns2 },
    { key: "overlay", label: "di_overlay", Icon: Layers },
    { key: "diff",    label: "di_diff",    Icon: Palette },
  ];

  /* ── Render ────────────────────────────────────────────────────────────────── */

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="mx-auto w-full max-w-5xl space-y-6"
    >
      {/* ── Title + subtitle ───────────────────────────────────────────────────── */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-white">{d("di_st_compare")}</h2>
        <p className="text-sm text-slate-400">
          {stats.changed_pixels_pct.toFixed(1)}% {d("di_changed").toLowerCase()}
          {" / "}
          {stats.added_area_pct.toFixed(1)}% {d("di_added").toLowerCase()}
          {" / "}
          {stats.removed_area_pct.toFixed(1)}% {d("di_removed").toLowerCase()}
        </p>
      </div>

      {/* ── KPI bar ────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        {/* Changed */}
        <div className="glass rounded-xl border border-white/10 p-4 text-center">
          <p className="text-2xl font-bold text-white">
            {stats.changed_pixels_pct.toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-slate-400">{d("di_changed")}</p>
        </div>

        {/* Added */}
        <div className="glass rounded-xl border border-white/10 p-4 text-center">
          <p className="text-2xl font-bold text-emerald-400">
            {stats.added_area_pct.toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-slate-400">{d("di_added")}</p>
        </div>

        {/* Removed */}
        <div className="glass rounded-xl border border-white/10 p-4 text-center">
          <p className="text-2xl font-bold text-red-400">
            {stats.removed_area_pct.toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-slate-400">{d("di_removed")}</p>
        </div>
      </div>

      {/* ── View mode toggle ───────────────────────────────────────────────────── */}
      <div className="flex justify-center">
        <div className="glass border border-white/10 rounded-xl p-1 inline-flex gap-1">
          {viewModes.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setViewMode(key)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                viewMode === key
                  ? "bg-accent text-white"
                  : "text-slate-400 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4" />
              {d(label)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Visualization area ─────────────────────────────────────────────────── */}
      <div className="glass rounded-2xl border border-white/10 p-4 overflow-hidden">
        {/* Side by side */}
        {viewMode === "side" && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500 mb-2">V1 (avant)</p>
              <img
                src={`data:image/png;base64,${result.aligned_v1_b64}`}
                alt="V1"
                className="w-full rounded-lg"
              />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-2">V2 (après)</p>
              <img
                src={`data:image/png;base64,${result.aligned_v2_b64}`}
                alt="V2"
                className="w-full rounded-lg"
              />
            </div>
          </div>
        )}

        {/* Overlay */}
        {viewMode === "overlay" && (
          <div className="space-y-4">
            <div className="relative">
              <img
                src={`data:image/png;base64,${result.aligned_v1_b64}`}
                alt="V1"
                className="w-full rounded-lg"
              />
              <img
                src={`data:image/png;base64,${result.aligned_v2_b64}`}
                alt="V2"
                className="absolute inset-0 w-full rounded-lg"
                style={{ opacity: overlayOpacity / 100 }}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">
                {d("di_opacity")}: {overlayOpacity}%
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={overlayOpacity}
                onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                className="w-full accent-teal-400"
              />
            </div>
          </div>
        )}

        {/* Diff coloré */}
        {viewMode === "diff" && (
          <div className="space-y-3">
            <img
              src={`data:image/png;base64,${result.diff_overlay_b64}`}
              alt="Diff"
              className="w-full rounded-lg"
            />

            {/* Legend */}
            <div className="flex items-center justify-center gap-6 text-xs text-slate-300">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-emerald-500" />
                {d("di_added")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-red-500" />
                {d("di_removed")}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Action buttons ─────────────────────────────────────────────────────── */}
      <div className="flex justify-center gap-3">
        <Button
          variant="outline"
          className="border-teal-500/30 text-teal-300 hover:bg-teal-500/10"
          onClick={exportDiffPng}
        >
          <Download className="mr-2 h-4 w-4" />
          {d("di_export_png")}
        </Button>

        <Button
          variant="outline"
          className="border-white/10 text-slate-300 hover:bg-white/5"
          onClick={onRestart}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          {d("bar_restart")}
        </Button>
      </div>
    </motion.div>
  );
}
