"use client";

import { useState, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Box, ChevronDown, ChevronUp, RotateCcw, Grid3x3, Loader2, AlertTriangle, Plus, Minus } from "lucide-react";
import dynamic from "next/dynamic";
import type { AnalysisResult } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

// Dynamic import — Three.js requires window/document (no SSR)
const FloorScene = dynamic(() => import("./floor-scene"), { ssr: false });

interface View3dPanelProps {
  result: AnalysisResult;
  imgW: number;
  imgH: number;
}

export default function View3dPanel({ result, imgW, imgH }: View3dPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [expanded, setExpanded] = useState(false);
  const [ceilingHeight, setCeilingHeight] = useState(2.5);
  const [numFloors, setNumFloors] = useState(1);
  const [showRoof, setShowRoof] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);

  const rooms = result.rooms ?? [];
  const ppm = result.pixels_per_meter;
  const hasRooms = rooms.length > 0;
  const hasScale = ppm != null && ppm > 0;
  const canRender = hasRooms && hasScale && imgW > 1 && imgH > 1;

  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden mt-4">
      {/* ── Header toggle ─────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Box className="w-5 h-5 text-sky-400" />
          <span className="font-display font-semibold text-white text-sm">
            {d("v3d_title" as DTKey)}
          </span>
          <span className="text-[10px] bg-sky-500/20 border border-sky-500/30 rounded px-1.5 py-0.5 font-semibold text-sky-400 uppercase tracking-wider">
            3D
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!expanded && hasRooms && (
            <span className="text-xs text-slate-500 mr-2">
              {d("v3d_rooms_count" as DTKey).replace("{n}", String(rooms.length))}
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-400" />
          )}
        </div>
      </button>

      {/* ── Expandable content ─────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="v3d-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {/* Guards */}
            {!hasRooms && (
              <div className="px-5 py-8 flex flex-col items-center gap-2 text-slate-500 text-sm">
                <AlertTriangle className="w-5 h-5 text-amber-500/70" />
                {d("v3d_no_rooms" as DTKey)}
              </div>
            )}

            {hasRooms && !hasScale && (
              <div className="px-5 py-8 flex flex-col items-center gap-2 text-slate-500 text-sm">
                <AlertTriangle className="w-5 h-5 text-amber-500/70" />
                {d("v3d_no_scale" as DTKey)}
              </div>
            )}

            {/* Render when we have data */}
            {canRender && (
              <>
                {/* Toolbar */}
                <div className="px-5 py-3 flex flex-wrap items-center gap-3 border-t border-white/5">
                  {/* Ceiling height */}
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    <span>{d("v3d_height" as DTKey)}</span>
                    <input
                      type="range"
                      min="2"
                      max="4"
                      step="0.1"
                      value={ceilingHeight}
                      onChange={(e) => setCeilingHeight(parseFloat(e.target.value))}
                      className="w-20 accent-sky-500"
                    />
                    <span className="font-mono text-sky-400 w-10">{ceilingHeight.toFixed(1)}m</span>
                  </label>

                  {/* Nombre d'étages */}
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <span>Étages</span>
                    <button
                      type="button"
                      onClick={() => setNumFloors(n => Math.max(1, n - 1))}
                      disabled={numFloors <= 1}
                      className="w-6 h-6 flex items-center justify-center rounded bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 transition-colors"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="font-mono text-sky-400 w-5 text-center">{numFloors}</span>
                    <button
                      type="button"
                      onClick={() => setNumFloors(n => Math.min(12, n + 1))}
                      disabled={numFloors >= 12}
                      className="w-6 h-6 flex items-center justify-center rounded bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Toit toggle */}
                  <button
                    type="button"
                    onClick={() => setShowRoof((v) => !v)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      showRoof
                        ? "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                        : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                    }`}
                  >
                    🏠 Toit
                  </button>

                  {/* Wireframe toggle */}
                  <button
                    type="button"
                    onClick={() => setWireframe((v) => !v)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      wireframe
                        ? "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                        : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                    }`}
                  >
                    <Grid3x3 className="w-3.5 h-3.5" />
                    {d("v3d_wireframe" as DTKey)}
                  </button>

                  {/* Reset camera */}
                  <button
                    type="button"
                    onClick={() => setResetSignal((v) => v + 1)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {d("v3d_reset_cam" as DTKey)}
                  </button>
                </div>

                {/* 3D Canvas */}
                <div className="relative w-full h-[500px] bg-gradient-to-b from-slate-900/80 to-slate-950/90 rounded-b-xl overflow-hidden">
                  <Suspense
                    fallback={
                      <div className="absolute inset-0 flex items-center justify-center gap-2 text-slate-500 text-sm">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        {d("v3d_loading" as DTKey)}
                      </div>
                    }
                  >
                    <FloorScene
                      rooms={rooms}
                      openings={result.openings ?? []}
                      ppm={ppm!}
                      imgW={imgW}
                      imgH={imgH}
                      ceilingHeight={ceilingHeight}
                      numFloors={numFloors}
                      showRoof={showRoof}
                      wireframe={wireframe}
                      resetSignal={resetSignal}
                    />
                  </Suspense>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
