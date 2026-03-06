"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Ruler, ArrowRight, ZoomIn, ZoomOut, RotateCcw, Crosshair, Wand2, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

interface Point { x: number; y: number; }

interface ScaleStepProps {
  imageB64: string;
  onScaled: (ppm: number | null) => void;
}

export default function ScaleStep({ imageB64, onScaled }: ScaleStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const [mode, setMode] = useState<"manual" | null>(null);
  const [points, setPoints] = useState<(Point | null)[]>([null, null]);
  const [realDist, setRealDist] = useState("1");
  const [zoom, setZoom] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });
  const [cursor, setCursor] = useState<"crosshair" | "grab" | "grabbing">("crosshair");

  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const dragStartRef = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });
  const zoomRef = useRef(zoom);
  const translateRef = useRef(translate);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { translateRef.current = translate; }, [translate]);

  // Track container size for SVG overlay
  useEffect(() => {
    const update = () => {
      const c = containerRef.current;
      if (c) setSvgSize({ w: c.offsetWidth, h: c.offsetHeight });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Zoom centered on cursor
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoom(prevZ => {
      const newZ = Math.max(1, Math.min(8, prevZ * factor));
      const ratio = newZ / prevZ;
      setTranslate(t => ({
        x: cx * (1 - ratio) + t.x * ratio,
        y: cy * (1 - ratio) + t.y * ratio,
      }));
      return newZ;
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // Pan + click distinction
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    dragStartRef.current = { mx: e.clientX, my: e.clientY, tx: translateRef.current.x, ty: translateRef.current.y };
    setCursor("grabbing");
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - dragStartRef.current.mx;
      const dy = e.clientY - dragStartRef.current.my;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        hasDraggedRef.current = true;
        setTranslate({ x: dragStartRef.current.tx + dx, y: dragStartRef.current.ty + dy });
      }
    };
    const onUp = () => {
      isDraggingRef.current = false;
      setCursor("crosshair");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // Place points on click (not after drag)
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (hasDraggedRef.current) return;
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * img.naturalWidth;
    const y = (e.clientY - rect.top) / rect.height * img.naturalHeight;
    if (x < 0 || y < 0 || x > img.naturalWidth || y > img.naturalHeight) return;
    setPoints(prev => {
      if (!prev[0]) return [{ x, y }, null];
      if (!prev[1]) return [prev[0], { x, y }];
      return [{ x, y }, null]; // reset A, start over
    });
  }, []);

  // Convert natural image coords → SVG overlay coords (container-relative)
  const toSvg = useCallback((pt: Point) => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return { x: 0, y: 0 };
    const ir = img.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    return {
      x: ir.left - cr.left + (pt.x / img.naturalWidth) * ir.width,
      y: ir.top - cr.top + (pt.y / img.naturalHeight) * ir.height,
    };
  }, []);

  const p1Svg = points[0] ? toSvg(points[0]) : null;
  const p2Svg = points[1] ? toSvg(points[1]) : null;

  const pixelDist = points[0] && points[1]
    ? Math.sqrt((points[1].x - points[0].x) ** 2 + (points[1].y - points[0].y) ** 2)
    : null;
  const realDistM = parseFloat(realDist) || 1;
  const computedPpm = pixelDist ? pixelDist / realDistM : null;

  const hint = !points[0]
    ? d("sc_hint_a")
    : !points[1]
    ? d("sc_hint_b")
    : d("sc_hint_dist");

  const reset = () => { setZoom(1); setTranslate({ x: 0, y: 0 }); setPoints([null, null]); };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl mx-auto">
      <div className="text-center mb-6">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-400 to-accent flex items-center justify-center mx-auto mb-4">
          <Ruler className="w-8 h-8 text-white" />
        </div>
        <h2 className="font-display text-2xl font-700 text-white mb-2">{d("sc_title")}</h2>
        <p className="text-slate-400 text-sm">{d("sc_sub")}</p>
      </div>

      <AnimatePresence mode="wait">
        {/* ── Mode choice ── */}
        {!mode && (
          <motion.div key="choice" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => onScaled(null)}
              className="flex-1 max-w-xs glass border border-white/10 rounded-2xl p-6 text-left hover:border-accent/40 transition-all"
            >
              <Wand2 className="w-8 h-8 text-accent mb-3" />
              <div className="font-display font-700 text-white mb-1">{d("sc_auto")}</div>
              <div className="text-slate-400 text-sm">{d("sc_auto_desc")}</div>
            </button>
            <button
              onClick={() => setMode("manual")}
              className="flex-1 max-w-xs glass border border-white/10 rounded-2xl p-6 text-left hover:border-brand-400/40 transition-all"
            >
              <Crosshair className="w-8 h-8 text-brand-400 mb-3" />
              <div className="font-display font-700 text-white mb-1">{d("sc_manual")}</div>
              <div className="text-slate-400 text-sm">{d("sc_manual_desc")}</div>
            </button>
          </motion.div>
        )}

        {/* ── Manual mode ── */}
        {mode === "manual" && (
          <motion.div key="manual" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <button onClick={() => { setMode(null); reset(); }}
                  className="glass border border-white/10 rounded-lg p-1.5 text-slate-400 hover:text-white">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-medium text-accent">{hint}</span>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => setZoom(z => Math.min(8, z * 1.3))}
                  title="Zoom +"
                  className="glass border border-white/10 rounded-lg p-1.5 text-slate-400 hover:text-white">
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button onClick={() => setZoom(z => Math.max(1, z / 1.3))}
                  title="Zoom -"
                  className="glass border border-white/10 rounded-lg p-1.5 text-slate-400 hover:text-white">
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button onClick={reset} title="Reset vue"
                  className="glass border border-white/10 rounded-lg p-1.5 text-slate-400 hover:text-white">
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Zoomable image */}
            <div
              ref={containerRef}
              className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/20 select-none"
              style={{ height: 440, cursor }}
              onMouseDown={handleMouseDown}
              onClick={handleClick}
            >
              {/* Transformed image */}
              <div style={{
                position: "absolute",
                top: "50%", left: "50%",
                transform: `translate(calc(-50% + ${translate.x}px), calc(-50% + ${translate.y}px)) scale(${zoom})`,
                transformOrigin: "center center",
              }}>
                <img
                  ref={imgRef}
                  src={`data:image/png;base64,${imageB64}`}
                  alt="Plan"
                  style={{ display: "block", maxWidth: svgSize.w || 800, maxHeight: 400 }}
                  draggable={false}
                />
              </div>

              {/* SVG overlay: points + line */}
              <svg className="absolute inset-0 pointer-events-none" width={svgSize.w} height={svgSize.h}>
                {p1Svg && p2Svg && (
                  <line
                    x1={p1Svg.x} y1={p1Svg.y} x2={p2Svg.x} y2={p2Svg.y}
                    stroke="#22D3EE" strokeWidth={2} strokeDasharray="7 4"
                  />
                )}
                {p1Svg && (
                  <>
                    <circle cx={p1Svg.x} cy={p1Svg.y} r={5} fill="#22D3EE" fillOpacity={0.20} stroke="#22D3EE" strokeWidth={1.5} />
                    <circle cx={p1Svg.x} cy={p1Svg.y} r={2} fill="#22D3EE" />
                    <text x={p1Svg.x + 8} y={p1Svg.y + 4} fill="#22D3EE" fontSize={11} fontWeight="bold" fontFamily="monospace">A</text>
                  </>
                )}
                {p2Svg && (
                  <>
                    <circle cx={p2Svg.x} cy={p2Svg.y} r={5} fill="#60A5FA" fillOpacity={0.20} stroke="#60A5FA" strokeWidth={1.5} />
                    <circle cx={p2Svg.x} cy={p2Svg.y} r={2} fill="#60A5FA" />
                    <text x={p2Svg.x + 8} y={p2Svg.y + 4} fill="#60A5FA" fontSize={11} fontWeight="bold" fontFamily="monospace">B</text>
                  </>
                )}
              </svg>

              {/* Empty state hint */}
              {!points[0] && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none">
                  <div className="glass border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-400 whitespace-nowrap">
                    {d("sc_nav_hint")}
                  </div>
                </div>
              )}
            </div>

            {/* Distance input — only when both points placed */}
            {points[1] && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="mt-4 glass rounded-2xl border border-white/10 p-5">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm text-slate-400">{d("sc_dist_label")}</span>
                  <input
                    type="number"
                    value={realDist}
                    min={0.01}
                    step={0.1}
                    autoFocus
                    onChange={e => setRealDist(e.target.value)}
                    className="w-28 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-accent"
                  />
                  <span className="text-slate-400 text-sm">{d("sc_meters")}</span>
                  {computedPpm && (
                    <span className="ml-auto font-mono text-sm text-accent">
                      → {computedPpm.toFixed(2)} px/m
                    </span>
                  )}
                </div>
              </motion.div>
            )}

            <div className="flex gap-3 justify-center mt-5">
              <Button variant="outline" onClick={() => onScaled(null)}>
                {d("sc_skip")}
              </Button>
              <Button onClick={() => computedPpm && onScaled(computedPpm)} disabled={!computedPpm}>
                {d("sc_validate")} <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
