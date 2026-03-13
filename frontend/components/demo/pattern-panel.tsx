"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ScanSearch,
  Save,
  Trash2,
  X,
  Loader2,
  Crosshair,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import type { AnalysisResult, CustomDetection, VisualSearchMatch } from "@/lib/types";
import {
  matchTemplate,
  imageB64ToImageData,
  cropImageData,
  type MatchResult,
} from "@/lib/pattern-match";

// ── Constants ───────────────────────────────────────────────────────────────

const DETECTION_COLORS = [
  "#F97316", "#8B5CF6", "#EC4899", "#14B8A6",
  "#EAB308", "#6366F1", "#F43F5E", "#06B6D4",
];

const LABEL_PRESETS: DTKey[] = [
  "pat_preset_tile",
  "pat_preset_parquet",
  "pat_preset_carpet",
  "pat_preset_stone",
  "pat_preset_concrete",
  "pat_preset_other",
];

/** Downscale limit for matching (perf) */
const MAX_MATCH_DIM = 1200;

// ── Props ───────────────────────────────────────────────────────────────────

interface PatternPanelProps {
  result: AnalysisResult;
  overlayB64: string;
  customDetections: CustomDetection[];
  onDetectionsChange: (dets: CustomDetection[]) => void;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function PatternPanel({
  result,
  overlayB64,
  customDetections,
  onDetectionsChange,
}: PatternPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  // ── Panel toggle ──
  const [open, setOpen] = useState(false);

  // ── Drawing state ──
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawEnd, setDrawEnd] = useState<{ x: number; y: number } | null>(null);

  // ── Crop (normalized 0-1) ──
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // ── Matches ──
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // ── Threshold slider ──
  const [threshold, setThreshold] = useState(0.70);

  // ── Save label ──
  const [saveLabel, setSaveLabel] = useState("");

  // ── Image container refs ──
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // ── Natural image dimensions ──
  const [imgNatural, setImgNatural] = useState({ w: 1, h: 1 });

  // ── Cached full-image data (to avoid re-decoding) ──
  const cachedImageRef = useRef<{ imageData: ImageData; scale: number } | null>(null);

  // Pre-load the image data when panel is opened
  useEffect(() => {
    if (!open || cachedImageRef.current) return;
    imageB64ToImageData(overlayB64, MAX_MATCH_DIM).then((data) => {
      cachedImageRef.current = data;
    });
  }, [open, overlayB64]);

  // ── Mouse handlers ──

  const getRelativePos = useCallback(
    (e: React.MouseEvent): { x: number; y: number } | null => {
      const img = imgRef.current;
      if (!img) return null;
      const rect = img.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
      };
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const pos = getRelativePos(e);
      if (!pos) return;
      setDrawing(true);
      setDrawStart(pos);
      setDrawEnd(pos);
      setMatches([]);
      setCrop(null);
    },
    [getRelativePos],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!drawing) return;
      const pos = getRelativePos(e);
      if (pos) setDrawEnd(pos);
    },
    [drawing, getRelativePos],
  );

  const handleMouseUp = useCallback(async () => {
    if (!drawing || !drawStart || !drawEnd) return;
    setDrawing(false);

    // Compute normalized crop
    const x = Math.min(drawStart.x, drawEnd.x);
    const y = Math.min(drawStart.y, drawEnd.y);
    const w = Math.abs(drawEnd.x - drawStart.x);
    const h = Math.abs(drawEnd.y - drawStart.y);

    // Minimum size guard (at least 1% of image)
    if (w < 0.01 || h < 0.01) {
      setDrawStart(null);
      setDrawEnd(null);
      return;
    }

    const cropRect = { x, y, w, h };
    setCrop(cropRect);

    // Launch search
    setSearching(true);
    try {
      // Get cached or load image data
      if (!cachedImageRef.current) {
        cachedImageRef.current = await imageB64ToImageData(overlayB64, MAX_MATCH_DIM);
      }
      const { imageData, scale } = cachedImageRef.current;

      // Extract template region in pixel coordinates (at downscaled size)
      const tplX = Math.round(x * imageData.width);
      const tplY = Math.round(y * imageData.height);
      const tplW = Math.max(4, Math.round(w * imageData.width));
      const tplH = Math.max(4, Math.round(h * imageData.height));

      const templateData = cropImageData(imageData, tplX, tplY, tplW, tplH);

      // Run matching (with adaptive stride based on template size)
      const stride = Math.max(1, Math.min(4, Math.round(Math.min(tplW, tplH) / 6)));

      // Use requestAnimationFrame to avoid freezing UI
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          const results = matchTemplate(imageData, templateData, {
            threshold,
            stride,
            maxResults: 50,
            nmsIou: 0.3,
          });
          setMatches(results);
          resolve();
        });
      });
    } catch (err) {
      console.error("Pattern matching error:", err);
    } finally {
      setSearching(false);
    }
  }, [drawing, drawStart, drawEnd, overlayB64, threshold]);

  // ── Re-search when threshold changes (if crop exists) ──
  const thresholdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reSearch = useCallback(async (newThreshold: number) => {
    if (!crop || !cachedImageRef.current) return;
    setSearching(true);
    try {
      const { imageData } = cachedImageRef.current;
      const tplX = Math.round(crop.x * imageData.width);
      const tplY = Math.round(crop.y * imageData.height);
      const tplW = Math.max(4, Math.round(crop.w * imageData.width));
      const tplH = Math.max(4, Math.round(crop.h * imageData.height));
      const templateData = cropImageData(imageData, tplX, tplY, tplW, tplH);
      const stride = Math.max(1, Math.min(4, Math.round(Math.min(tplW, tplH) / 6)));

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          const results = matchTemplate(imageData, templateData, {
            threshold: newThreshold,
            stride,
            maxResults: 50,
            nmsIou: 0.3,
          });
          setMatches(results);
          resolve();
        });
      });
    } finally {
      setSearching(false);
    }
  }, [crop]);

  const handleThresholdChange = useCallback(
    (val: number) => {
      setThreshold(val);
      if (thresholdTimerRef.current) clearTimeout(thresholdTimerRef.current);
      thresholdTimerRef.current = setTimeout(() => reSearch(val), 400);
    },
    [reSearch],
  );

  // ── Save as CustomDetection ──
  const handleSave = useCallback(() => {
    if (matches.length === 0) return;
    const label = saveLabel.trim() || "Pattern";
    const color = DETECTION_COLORS[customDetections.length % DETECTION_COLORS.length];

    const vsMatches: VisualSearchMatch[] = matches.map((m) => ({
      x_norm: m.x_norm,
      y_norm: m.y_norm,
      w_norm: m.w_norm,
      h_norm: m.h_norm,
      score: m.score,
    }));

    // Compute total area
    const ppm = result.pixels_per_meter;
    let totalAreaM2: number | null = null;
    let totalAreaPx2 = 0;

    if (imgNatural.w > 1 && imgNatural.h > 1) {
      totalAreaPx2 = vsMatches.reduce(
        (s, m) => s + m.w_norm * imgNatural.w * m.h_norm * imgNatural.h,
        0,
      );
      if (ppm && ppm > 0) {
        totalAreaM2 = totalAreaPx2 / (ppm * ppm);
      }
    }

    const detection: CustomDetection = {
      id: `pat_${Date.now()}`,
      label,
      color,
      matches: vsMatches,
      count: vsMatches.length,
      total_area_m2: totalAreaM2,
      total_area_px2: totalAreaPx2,
    };

    onDetectionsChange([...customDetections, detection]);
    // Reset
    setMatches([]);
    setCrop(null);
    setDrawStart(null);
    setDrawEnd(null);
    setSaveLabel("");
  }, [matches, saveLabel, customDetections, onDetectionsChange, result.pixels_per_meter, imgNatural]);

  // ── Delete a saved detection ──
  const handleDeleteDetection = useCallback(
    (id: string) => {
      onDetectionsChange(customDetections.filter((d) => d.id !== id));
    },
    [customDetections, onDetectionsChange],
  );

  // ── Clear current search ──
  const handleClear = useCallback(() => {
    setMatches([]);
    setCrop(null);
    setDrawStart(null);
    setDrawEnd(null);
  }, []);

  // ── Drawing rect (for rendering) ──
  const drawRect = useMemo(() => {
    if (!drawStart || !drawEnd) return null;
    return {
      x: Math.min(drawStart.x, drawEnd.x),
      y: Math.min(drawStart.y, drawEnd.y),
      w: Math.abs(drawEnd.x - drawStart.x),
      h: Math.abs(drawEnd.y - drawStart.y),
    };
  }, [drawStart, drawEnd]);

  // ── Compute total matched area ──
  const matchedArea = useMemo(() => {
    if (matches.length === 0 || imgNatural.w <= 1) return null;
    const ppm = result.pixels_per_meter;
    if (!ppm || ppm <= 0) return null;
    const totalPx2 = matches.reduce(
      (s, m) => s + m.w_norm * imgNatural.w * m.h_norm * imgNatural.h,
      0,
    );
    return (totalPx2 / (ppm * ppm)).toFixed(1);
  }, [matches, imgNatural, result.pixels_per_meter]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mt-8">
      {/* Header (always visible) */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 rounded-xl glass border border-white/10 hover:border-white/20 transition-all group"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500 to-pink-600 flex items-center justify-center shadow-lg">
            <ScanSearch className="w-4.5 h-4.5 text-white" />
          </div>
          <div className="text-left">
            <p className="font-display font-700 text-white text-sm">
              {d("pat_title")}
            </p>
            <p className="text-xs text-slate-500">{d("pat_subtitle")}</p>
          </div>
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-slate-500 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Body */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="glass border border-t-0 border-white/10 rounded-b-xl p-5 space-y-5">
              {/* ── Hint ── */}
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Crosshair className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                {d("pat_hint")}
              </div>

              {/* ── Plan image with drawing overlay ── */}
              <div
                ref={containerRef}
                className="relative rounded-xl overflow-hidden border border-white/10 cursor-crosshair select-none"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => { if (drawing) handleMouseUp(); }}
              >
                <img
                  ref={imgRef}
                  src={`data:image/png;base64,${overlayB64}`}
                  alt="Plan"
                  className="w-full h-auto block max-h-[500px] object-contain"
                  draggable={false}
                  onLoad={(e) =>
                    setImgNatural({
                      w: e.currentTarget.naturalWidth,
                      h: e.currentTarget.naturalHeight,
                    })
                  }
                />

                {/* SVG overlay for drawing rect + matches */}
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  viewBox={`0 0 ${imgNatural.w} ${imgNatural.h}`}
                  preserveAspectRatio="xMidYMid meet"
                >
                  {/* Drawing rect (while drawing or after crop) */}
                  {drawRect && (
                    <rect
                      x={drawRect.x * imgNatural.w}
                      y={drawRect.y * imgNatural.h}
                      width={drawRect.w * imgNatural.w}
                      height={drawRect.h * imgNatural.h}
                      fill="rgba(249, 115, 22, 0.15)"
                      stroke="#F97316"
                      strokeWidth={Math.max(1.5, imgNatural.w * 0.0015)}
                      strokeDasharray={drawing ? "6 3" : "none"}
                      rx={2}
                    />
                  )}

                  {/* Match rectangles */}
                  {matches.map((m, i) => (
                    <rect
                      key={i}
                      x={m.x_norm * imgNatural.w}
                      y={m.y_norm * imgNatural.h}
                      width={m.w_norm * imgNatural.w}
                      height={m.h_norm * imgNatural.h}
                      fill="rgba(249, 115, 22, 0.2)"
                      stroke="#F97316"
                      strokeWidth={Math.max(1.5, imgNatural.w * 0.001)}
                      rx={2}
                    />
                  ))}

                  {/* Saved detection rectangles */}
                  {customDetections.map((det) =>
                    det.matches.map((m, i) => (
                      <rect
                        key={`${det.id}-${i}`}
                        x={m.x_norm * imgNatural.w}
                        y={m.y_norm * imgNatural.h}
                        width={m.w_norm * imgNatural.w}
                        height={m.h_norm * imgNatural.h}
                        fill={det.color + "20"}
                        stroke={det.color}
                        strokeWidth={Math.max(1.5, imgNatural.w * 0.001)}
                        rx={2}
                      />
                    )),
                  )}
                </svg>

                {/* Searching overlay */}
                {searching && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-sm">
                    <div className="flex items-center gap-2 text-white text-sm font-600">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {d("pat_searching")}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Controls row ── */}
              <div className="flex flex-wrap items-center gap-4">
                {/* Threshold slider */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{d("pat_threshold")}:</span>
                  <input
                    type="range"
                    min={0.5}
                    max={0.95}
                    step={0.01}
                    value={threshold}
                    onChange={(e) => handleThresholdChange(parseFloat(e.target.value))}
                    className="w-28 h-1 accent-orange-500 cursor-pointer"
                  />
                  <span className="text-xs font-mono text-orange-400 w-10 text-right">
                    {Math.round(threshold * 100)}%
                  </span>
                </div>

                {/* Search status */}
                <div className="flex-1 text-xs text-slate-400">
                  {matches.length > 0 && (
                    <span>
                      {d("pat_found").replace("{n}", String(matches.length))}
                      {matchedArea && (
                        <span className="text-orange-400 ml-1">
                          · {matchedArea} m²
                        </span>
                      )}
                    </span>
                  )}
                  {crop && matches.length === 0 && !searching && (
                    <span className="text-slate-600">{d("pat_no_match")}</span>
                  )}
                </div>

                {/* Clear button */}
                {(matches.length > 0 || crop) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClear}
                    className="text-slate-400 hover:text-white"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> {d("pat_clear")}
                  </Button>
                )}
              </div>

              {/* ── Save row (visible when matches found) ── */}
              {matches.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/5">
                  {/* Label input */}
                  <div className="flex items-center gap-2 flex-1 min-w-[140px]">
                    <span className="text-xs text-slate-500">{d("pat_label")}:</span>
                    <input
                      type="text"
                      value={saveLabel}
                      onChange={(e) => setSaveLabel(e.target.value)}
                      placeholder="Carrelage"
                      className="flex-1 bg-transparent border border-white/10 rounded-md px-2 py-1 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-orange-500/50"
                    />
                  </div>

                  {/* Quick label presets */}
                  <div className="flex flex-wrap gap-1.5">
                    {LABEL_PRESETS.map((key) => (
                      <button
                        key={key}
                        onClick={() => setSaveLabel(d(key))}
                        className="px-2 py-0.5 rounded text-[10px] font-600 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 border border-white/5 hover:border-white/15 transition-colors"
                      >
                        {d(key)}
                      </button>
                    ))}
                  </div>

                  {/* Save button */}
                  <Button
                    size="sm"
                    onClick={handleSave}
                    className="bg-orange-600 hover:bg-orange-500 text-white"
                  >
                    <Save className="w-3.5 h-3.5" /> {d("pat_save")}
                  </Button>
                </div>
              )}

              {/* ── Saved detections list ── */}
              {customDetections.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">
                    {d("pat_detections")}
                  </p>
                  {customDetections.map((det) => (
                    <div
                      key={det.id}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: det.color }}
                        />
                        <span className="text-sm text-white font-600">{det.label}</span>
                        <span className="text-xs text-slate-500">
                          {det.count} zone{det.count > 1 ? "s" : ""}
                        </span>
                        {det.total_area_m2 !== null && (
                          <span className="text-xs font-mono" style={{ color: det.color }}>
                            {det.total_area_m2.toFixed(1)} m²
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleDeleteDetection(det.id)}
                        className="text-slate-600 hover:text-red-400 transition-colors p-1"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
