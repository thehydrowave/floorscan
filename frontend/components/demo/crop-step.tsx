"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { RotateCcw, ArrowRight, Loader2, ChevronLeft, PlusCircle, Trash2, Building2, Crop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

import { BACKEND } from "@/lib/backend";

/* ── Facade polygon zone (4 normalized points 0-1) ── */
export interface FacadeZoneCrop {
  id: number;
  pts: Array<{ x: number; y: number }>;
}

export interface CropBox { x0: number; y0: number; x1: number; y1: number; imgW: number; imgH: number; }

interface CropStepProps {
  sessionId: string;
  imageB64: string;
  onCropped: (cropBox?: CropBox) => void;
  onSkip: () => void;
  onSessionExpired?: () => void;
  onBack?: () => void;
  /* Facade delimitation */
  showFacadeDelimitation?: boolean;
  initialFacadeZones?: FacadeZoneCrop[];
  onFacadeZonesChange?: (zones: FacadeZoneCrop[]) => void;
}

// x, y, w, h in % of the rendered image
interface CropRect { x: number; y: number; w: number; h: number; }

/* ── Shoelace polygon area (normalized coords → fraction of image) ── */
function polygonAreaNorm(pts: Array<{ x: number; y: number }>): number {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

export default function CropStep({
  sessionId, imageB64, onCropped, onSkip, onSessionExpired, onBack,
  showFacadeDelimitation, initialFacadeZones, onFacadeZonesChange,
}: CropStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const drawStartRef = useRef({ px: 0, py: 0 });

  /* ── Facade delimitation state ── */
  const [facadeZones, setFacadeZones] = useState<FacadeZoneCrop[]>(initialFacadeZones ?? []);
  const [drawingFacade, setDrawingFacade] = useState(false);
  const [pendingPts, setPendingPts] = useState<Array<{ x: number; y: number }>>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);
  const draggingPtRef = useRef<{ zoneId: number; ptIdx: number } | null>(null);
  const [isDraggingPt, setIsDraggingPt] = useState(false);
  // "crop" mode = draw crop rectangle, "facade" mode = click 4 points for facade zones
  const [activeMode, setActiveMode] = useState<"crop" | "facade">("crop");

  // Sync facade zones upstream
  useEffect(() => {
    onFacadeZonesChange?.(facadeZones);
  }, [facadeZones, onFacadeZonesChange]);

  // Compute actual rendered image bounds inside the element (handles object-contain letterboxing)
  const getRenderedImageBounds = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;
    const r = img.getBoundingClientRect();
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const elemRatio = r.width / r.height;
    let rw: number, rh: number, rx: number, ry: number;
    if (imgRatio > elemRatio) {
      rw = r.width; rh = r.width / imgRatio;
      rx = r.left; ry = r.top + (r.height - rh) / 2;
    } else {
      rh = r.height; rw = r.height * imgRatio;
      ry = r.top; rx = r.left + (r.width - rw) / 2;
    }
    return { left: rx, top: ry, width: rw, height: rh };
  }, []);

  // Track image position within container (handles object-contain letterboxing)
  const updateImgOffset = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const bounds = getRenderedImageBounds();
    if (!bounds) return;
    const cr = container.getBoundingClientRect();
    setImgOffset({ x: bounds.left - cr.left, y: bounds.top - cr.top, w: bounds.width, h: bounds.height });
  }, [getRenderedImageBounds]);

  useEffect(() => {
    window.addEventListener("resize", updateImgOffset);
    return () => window.removeEventListener("resize", updateImgOffset);
  }, [updateImgOffset]);

  // Convert clientX/Y to % of rendered image
  const toPct = useCallback((clientX: number, clientY: number) => {
    const bounds = getRenderedImageBounds();
    if (!bounds) return { px: 0, py: 0 };
    return {
      px: Math.max(0, Math.min(100, (clientX - bounds.left) / bounds.width * 100)),
      py: Math.max(0, Math.min(100, (clientY - bounds.top) / bounds.height * 100)),
    };
  }, [getRenderedImageBounds]);

  // Convert clientX/Y to normalized 0-1 of rendered image
  const toNorm = useCallback((clientX: number, clientY: number) => {
    const bounds = getRenderedImageBounds();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height)),
    };
  }, [getRenderedImageBounds]);

  /* ── Mouse handling ── */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;

    // If in facade mode → handle polygon point clicks
    if (activeMode === "facade" && showFacadeDelimitation) {
      e.preventDefault();
      const pt = toNorm(e.clientX, e.clientY);

      // Check if clicking near an existing zone corner (for dragging)
      const bounds = getRenderedImageBounds();
      if (bounds) {
        for (const zone of facadeZones) {
          for (let pi = 0; pi < zone.pts.length; pi++) {
            const cx = bounds.left + zone.pts[pi].x * bounds.width;
            const cy = bounds.top + zone.pts[pi].y * bounds.height;
            const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
            if (dist < 12) {
              draggingPtRef.current = { zoneId: zone.id, ptIdx: pi };
              setIsDraggingPt(true);
              setSelectedZoneId(zone.id);
              return;
            }
          }
        }
      }

      // Otherwise, add point to pending polygon
      if (drawingFacade) {
        const next = [...pendingPts, pt];
        if (next.length >= 4) {
          setFacadeZones(z => [...z, { id: Date.now(), pts: next.slice(0, 4) }]);
          setPendingPts([]);
          setDrawingFacade(false);
        } else {
          setPendingPts(next);
        }
      }
      return;
    }

    // Default: crop rectangle mode
    e.preventDefault();
    const { px, py } = toPct(e.clientX, e.clientY);
    drawStartRef.current = { px, py };
    setCrop({ x: px, y: py, w: 0, h: 0 });
    setIsDrawing(true);
  }, [activeMode, showFacadeDelimitation, toPct, toNorm, getRenderedImageBounds, facadeZones, drawingFacade, pendingPts]);

  // Crop rectangle drawing
  useEffect(() => {
    if (!isDrawing) return;
    const onMove = (e: MouseEvent) => {
      const { px, py } = toPct(e.clientX, e.clientY);
      const sx = drawStartRef.current.px;
      const sy = drawStartRef.current.py;
      setCrop({
        x: Math.min(sx, px),
        y: Math.min(sy, py),
        w: Math.abs(px - sx),
        h: Math.abs(py - sy),
      });
    };
    const onUp = () => setIsDrawing(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [isDrawing, toPct]);

  // Facade polygon corner dragging
  useEffect(() => {
    if (!isDraggingPt) return;
    const onMove = (e: MouseEvent) => {
      const ref = draggingPtRef.current;
      if (!ref) return;
      const pt = toNorm(e.clientX, e.clientY);
      setFacadeZones(prev => prev.map(z =>
        z.id === ref.zoneId
          ? { ...z, pts: z.pts.map((p, i) => i === ref.ptIdx ? pt : p) }
          : z
      ));
    };
    const onUp = () => {
      draggingPtRef.current = null;
      setIsDraggingPt(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [isDraggingPt, toNorm]);

  const hasCrop = !!crop && crop.w > 2 && crop.h > 2;

  const handleConfirm = async () => {
    if (!hasCrop || !crop) return;
    setConfirming(true);
    try {
      const img = imgRef.current!;
      const x0 = Math.round(crop.x / 100 * img.naturalWidth);
      const y0 = Math.round(crop.y / 100 * img.naturalHeight);
      const x1 = Math.round((crop.x + crop.w) / 100 * img.naturalWidth);
      const y1 = Math.round((crop.y + crop.h) / 100 * img.naturalHeight);
      const r = await fetch(`${BACKEND}/crop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, x0, y0, x1, y1 }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? "Crop error");
      const data = await r.json();
      toast({ title: d("cr_confirm"), description: `${data.width}×${data.height} px`, variant: "success" });
      onCropped({ x0, y0, x1, y1, imgW: img.naturalWidth, imgH: img.naturalHeight });
    } catch (e: any) {
      if (e.message?.includes("Session introuvable")) {
        toast({ title: d("err_session_expired"), description: d("err_server_restarted"), variant: "error" });
        onSessionExpired?.();
      } else {
        toast({ title: d("err_generic"), description: e.message, variant: "error" });
      }
    } finally {
      setConfirming(false);
    }
  };

  // SVG coordinates for crop rect (relative to container, accounting for letterboxing)
  const svgCrop = crop && imgOffset.w > 0 ? {
    x: imgOffset.x + crop.x / 100 * imgOffset.w,
    y: imgOffset.y + crop.y / 100 * imgOffset.h,
    w: crop.w / 100 * imgOffset.w,
    h: crop.h / 100 * imgOffset.h,
  } : null;

  // Convert normalized 0-1 point to SVG container pixel coords
  const normToSvg = useCallback((pt: { x: number; y: number }) => ({
    sx: imgOffset.x + pt.x * imgOffset.w,
    sy: imgOffset.y + pt.y * imgOffset.h,
  }), [imgOffset]);

  // Cursor style
  const cursor = activeMode === "facade" ? (isDraggingPt ? "grabbing" : "crosshair") : "crosshair";

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <div className="text-center mb-6">
        <h2 className="font-display text-2xl font-700 text-white mb-2">{d("cr_title")}</h2>
        <p className="text-slate-400 text-sm">
          {activeMode === "facade"
            ? (drawingFacade
              ? `${4 - pendingPts.length} ${d("cr_facade_pts" as DTKey)}`
              : d("cr_facade_hint" as DTKey))
            : (hasCrop ? d("cr_adjust_hint") : d("cr_drag_hint"))
          }
        </p>
      </div>

      {/* Mode toggle (only for facade) */}
      {showFacadeDelimitation && (
        <div className="flex items-center justify-center gap-2 mb-4">
          <button
            onClick={() => { setActiveMode("crop"); setDrawingFacade(false); setPendingPts([]); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${activeMode === "crop" ? "bg-cyan-500 text-white shadow-sm" : "text-slate-400 hover:text-white bg-white/5"}`}
          >
            <Crop className="w-3.5 h-3.5" /> {d("cr_crop_mode" as DTKey)}
          </button>
          <button
            onClick={() => setActiveMode("facade")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${activeMode === "facade" ? "bg-amber-500 text-white shadow-sm" : "text-slate-400 hover:text-white bg-white/5"}`}
          >
            <Building2 className="w-3.5 h-3.5" /> {d("cr_facade_mode" as DTKey)}
          </button>
        </div>
      )}

      {/* Image container */}
      <div
        ref={containerRef}
        className="relative mx-auto max-w-3xl rounded-2xl border border-white/10 overflow-hidden bg-white select-none"
        style={{ cursor }}
        onMouseDown={handleMouseDown}
      >
        <img
          ref={imgRef}
          src={`data:image/png;base64,${imageB64}`}
          alt="Plan"
          className="w-full h-auto block max-h-[calc(100vh-200px)] object-contain"
          draggable={false}
          onLoad={updateImgOffset}
        />

        {/* SVG overlay */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {/* ── Crop rectangle overlay ── */}
          {svgCrop && svgCrop.w > 2 && svgCrop.h > 2 ? (
            <>
              {/* Dark surround with transparent hole */}
              <defs>
                <mask id="crop-mask">
                  <rect width="100%" height="100%" fill="white" />
                  <rect x={svgCrop.x} y={svgCrop.y} width={svgCrop.w} height={svgCrop.h} fill="black" />
                </mask>
              </defs>
              <rect width="100%" height="100%" fill="rgba(0,0,0,0.52)" mask="url(#crop-mask)" />

              {/* Selection border */}
              <rect
                x={svgCrop.x} y={svgCrop.y} width={svgCrop.w} height={svgCrop.h}
                fill="none" stroke="#22D3EE" strokeWidth={2}
              />

              {/* Rule of thirds (only when idle) */}
              {!isDrawing && hasCrop && [1 / 3, 2 / 3].map(f => (
                <g key={f}>
                  <line
                    x1={svgCrop.x + svgCrop.w * f} y1={svgCrop.y}
                    x2={svgCrop.x + svgCrop.w * f} y2={svgCrop.y + svgCrop.h}
                    stroke="rgba(34,211,238,0.28)" strokeWidth={1}
                  />
                  <line
                    x1={svgCrop.x} y1={svgCrop.y + svgCrop.h * f}
                    x2={svgCrop.x + svgCrop.w} y2={svgCrop.y + svgCrop.h * f}
                    stroke="rgba(34,211,238,0.28)" strokeWidth={1}
                  />
                </g>
              ))}

              {/* L-shaped corner handles (only when idle) */}
              {!isDrawing && hasCrop && (
                ([
                  [svgCrop.x, svgCrop.y, 1, 1],
                  [svgCrop.x + svgCrop.w, svgCrop.y, -1, 1],
                  [svgCrop.x, svgCrop.y + svgCrop.h, 1, -1],
                  [svgCrop.x + svgCrop.w, svgCrop.y + svgCrop.h, -1, -1],
                ] as [number, number, number, number][]).map(([cx, cy, dx, dy], i) => {
                  const s = 14;
                  return (
                    <polyline
                      key={i}
                      points={`${cx + dx * s},${cy} ${cx},${cy} ${cx},${cy + dy * s}`}
                      fill="none" stroke="#22D3EE" strokeWidth={3} strokeLinecap="round"
                    />
                  );
                })
              )}
            </>
          ) : (
            !isDrawing && activeMode === "crop" && (
              <text
                x="50%" y="50%"
                textAnchor="middle" dominantBaseline="middle"
                fill="rgba(148,163,184,0.6)" fontSize={14} fontFamily="system-ui"
              >
                {d("cr_drag_hint")}
              </text>
            )
          )}

          {/* ── Facade polygon zones ── */}
          {showFacadeDelimitation && facadeZones.map(zone => {
            const svgPts = zone.pts.map(normToSvg);
            const polyStr = svgPts.map(p => `${p.sx},${p.sy}`).join(" ");
            const isSelected = selectedZoneId === zone.id;
            return (
              <g key={zone.id}>
                {/* Fill */}
                <polygon
                  points={polyStr}
                  fill={isSelected ? "rgba(251,191,36,0.18)" : "rgba(251,191,36,0.10)"}
                  stroke="#fbbf24"
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  strokeDasharray={isSelected ? "none" : "6 3"}
                />
                {/* Draggable corners */}
                {svgPts.map((p, pi) => (
                  <circle
                    key={pi}
                    cx={p.sx} cy={p.sy} r={6}
                    fill="#fbbf24" stroke="#fff" strokeWidth={2}
                    style={{ cursor: "grab", pointerEvents: "all" }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      draggingPtRef.current = { zoneId: zone.id, ptIdx: pi };
                      setIsDraggingPt(true);
                      setSelectedZoneId(zone.id);
                    }}
                  />
                ))}
                {/* Zone label */}
                {svgPts.length >= 2 && (
                  <text
                    x={(svgPts[0].sx + svgPts[2].sx) / 2}
                    y={(svgPts[0].sy + svgPts[2].sy) / 2}
                    textAnchor="middle" dominantBaseline="middle"
                    fill="#fbbf24" fontSize={11} fontFamily="system-ui" fontWeight={600}
                  >
                    Façade
                  </text>
                )}
              </g>
            );
          })}

          {/* ── Pending polygon points (being drawn) ── */}
          {showFacadeDelimitation && drawingFacade && pendingPts.length > 0 && (() => {
            const svgPts = pendingPts.map(normToSvg);
            return (
              <g>
                {/* Lines between placed points */}
                {svgPts.length >= 2 && (
                  <polyline
                    points={svgPts.map(p => `${p.sx},${p.sy}`).join(" ")}
                    fill="none" stroke="#fbbf24" strokeWidth={2} strokeDasharray="4 2"
                  />
                )}
                {/* Point dots */}
                {svgPts.map((p, pi) => (
                  <circle key={pi} cx={p.sx} cy={p.sy} r={5}
                    fill="#fbbf24" stroke="#fff" strokeWidth={2}
                  />
                ))}
                {/* Counter badge */}
                <text
                  x={svgPts[svgPts.length - 1].sx + 14}
                  y={svgPts[svgPts.length - 1].sy - 10}
                  fill="#fbbf24" fontSize={11} fontFamily="system-ui" fontWeight={700}
                >
                  {pendingPts.length}/4
                </text>
              </g>
            );
          })()}
        </svg>
      </div>

      {hasCrop && crop && activeMode === "crop" && (
        <p className="text-center text-xs text-slate-500 mt-3">
          {Math.round(crop.x)}%, {Math.round(crop.y)}% — {Math.round(crop.w)}% × {Math.round(crop.h)}%
        </p>
      )}

      {/* Facade zones panel */}
      {showFacadeDelimitation && activeMode === "facade" && (
        <div className="mt-4 mx-auto max-w-3xl">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-sm font-semibold text-amber-400 flex items-center gap-1.5">
              <Building2 className="w-4 h-4" /> {d("cr_facade_zones" as DTKey)} ({facadeZones.length})
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setDrawingFacade(true); setPendingPts([]); }}
              disabled={drawingFacade}
              className="text-xs"
            >
              <PlusCircle className="w-3.5 h-3.5" /> {d("cr_new_facade" as DTKey)}
            </Button>
            {drawingFacade && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setDrawingFacade(false); setPendingPts([]); }}
                className="text-xs text-slate-500"
              >
                {d("cr_cancel" as DTKey)}
              </Button>
            )}
          </div>
          {facadeZones.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {facadeZones.map((zone, zi) => (
                <div
                  key={zone.id}
                  onClick={() => setSelectedZoneId(selectedZoneId === zone.id ? null : zone.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-all ${
                    selectedZoneId === zone.id
                      ? "bg-amber-500/20 border border-amber-500/40 text-amber-300"
                      : "bg-white/5 border border-white/10 text-slate-400 hover:text-slate-300"
                  }`}
                >
                  <span>Façade {zi + 1}</span>
                  <span className="font-mono text-[10px] opacity-70">
                    {(polygonAreaNorm(zone.pts) * 100).toFixed(1)}%
                  </span>
                  <button
                    onClick={e2 => {
                      e2.stopPropagation();
                      setFacadeZones(prev => prev.filter(z => z.id !== zone.id));
                      if (selectedZoneId === zone.id) setSelectedZoneId(null);
                    }}
                    className="text-red-400/60 hover:text-red-400"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3 justify-center mt-6">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} disabled={confirming}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => { setCrop(null); setActiveMode("crop"); }} disabled={confirming || !hasCrop}>
          <RotateCcw className="w-4 h-4" /> {d("cr_reset")}
        </Button>
        <Button variant="outline" onClick={onSkip} disabled={confirming}>
          {d("cr_skip")}
        </Button>
        <Button onClick={handleConfirm} disabled={confirming || !hasCrop}>
          {confirming
            ? <><Loader2 className="w-4 h-4 animate-spin" /> {d("cr_applying")}</>
            : <>{d("cr_confirm")} <ArrowRight className="w-4 h-4" /></>}
        </Button>
      </div>
    </motion.div>
  );
}
