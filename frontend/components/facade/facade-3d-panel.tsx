"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Box, ChevronDown, ChevronUp, RotateCcw, Grid3x3,
  Loader2, Plus, Minus,
} from "lucide-react";
import dynamic from "next/dynamic";
import { FacadeAnalysisResult, FacadeElement } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

// Dynamic import — Three.js requires window/document (no SSR)
const FacadeScene = dynamic(() => import("./facade-scene"), { ssr: false });

interface Facade3dPanelProps {
  result: FacadeAnalysisResult;
}

export default function Facade3dPanel({ result }: Facade3dPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [expanded, setExpanded] = useState(false);
  const [floorHeight, setFloorHeight] = useState(2.8);
  const [numFloors, setNumFloors] = useState(result.floors_count || 3);
  const [wireframe, setWireframe] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);

  const hasData = result.elements.length > 0;
  const hasScale = result.pixels_per_meter != null && result.pixels_per_meter > 0;

  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden">
      {/* ── Header toggle ── */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Box className="w-5 h-5 text-amber-400" />
          <span className="font-display font-semibold text-white text-sm">
            {d("fa3d_title" as DTKey)}
          </span>
          <span className="text-[10px] bg-amber-500/20 border border-amber-500/30 rounded px-1.5 py-0.5 font-semibold text-amber-400 uppercase tracking-wider">
            3D
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!expanded && hasData && (
            <span className="text-xs text-slate-500 mr-2">
              {result.elements.length} éléments · {result.floors_count} niveaux
            </span>
          )}
          {expanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="fa3d-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {!hasData && (
              <div className="px-5 py-8 flex flex-col items-center gap-2 text-slate-500 text-sm">
                {d("fa3d_no_data" as DTKey)}
              </div>
            )}

            {hasData && (
              <>
                {/* Toolbar */}
                <div className="px-5 py-3 flex flex-wrap items-center gap-3 border-t border-white/5">
                  {/* Floor height */}
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    <span>{d("fa3d_floor_h" as DTKey)}</span>
                    <input
                      type="range" min="2.2" max="4.5" step="0.1"
                      value={floorHeight}
                      onChange={e => setFloorHeight(parseFloat(e.target.value))}
                      className="w-20 accent-amber-500"
                    />
                    <span className="font-mono text-amber-400 w-10">{floorHeight.toFixed(1)}m</span>
                  </label>

                  {/* Floors count */}
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <span>{d("fa3d_floors" as DTKey)}</span>
                    <button type="button"
                      onClick={() => setNumFloors(n => Math.max(1, n - 1))}
                      disabled={numFloors <= 1}
                      className="w-6 h-6 flex items-center justify-center rounded bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 transition-colors">
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="font-mono text-amber-400 w-5 text-center">{numFloors}</span>
                    <button type="button"
                      onClick={() => setNumFloors(n => Math.min(20, n + 1))}
                      disabled={numFloors >= 20}
                      className="w-6 h-6 flex items-center justify-center rounded bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 transition-colors">
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Wireframe */}
                  <button type="button"
                    onClick={() => setWireframe(v => !v)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      wireframe
                        ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                        : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                    }`}>
                    <Grid3x3 className="w-3.5 h-3.5" />
                    {d("fa3d_wireframe" as DTKey)}
                  </button>

                  {/* Reset camera */}
                  <button type="button"
                    onClick={() => setResetSignal(v => v + 1)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10 transition-colors">
                    <RotateCcw className="w-3.5 h-3.5" />
                    {d("fa3d_reset" as DTKey)}
                  </button>
                </div>

                {/* 3D Canvas */}
                <div className="relative w-full h-[480px] bg-gradient-to-b from-slate-900/80 to-slate-950/90 rounded-b-xl overflow-hidden">
                  <Suspense fallback={
                    <div className="absolute inset-0 flex items-center justify-center gap-2 text-slate-500 text-sm">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {d("fa3d_loading" as DTKey)}
                    </div>
                  }>
                    <FacadeScene
                      elements={result.elements}
                      facadeAreaM2={result.facade_area_m2}
                      floorsCount={numFloors}
                      floorHeight={floorHeight}
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
