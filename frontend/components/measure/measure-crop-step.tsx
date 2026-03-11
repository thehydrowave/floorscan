"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { RotateCcw, ArrowRight, Loader2, Crop } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MeasureCropStepProps {
  imageB64: string;
  imageMime: string;
  onCropped: (b64: string, mime: string) => void;
  onSkip: () => void;
}

interface CropRect { x: number; y: number; w: number; h: number; }

export default function MeasureCropStep({ imageB64, imageMime, onCropped, onSkip }: MeasureCropStepProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef       = useRef<HTMLImageElement>(null);
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [crop, setCrop]           = useState<CropRect | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const drawStartRef = useRef({ px: 0, py: 0 });

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

  // Track rendered image bounds (handles object-contain letterboxing)
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

  // % of rendered image from clientX/Y (uses actual rendered bounds, not element rect)
  const toPct = useCallback((clientX: number, clientY: number) => {
    const bounds = getRenderedImageBounds();
    if (!bounds) return { px: 0, py: 0 };
    return {
      px: Math.max(0, Math.min(100, (clientX - bounds.left) / bounds.width * 100)),
      py: Math.max(0, Math.min(100, (clientY - bounds.top) / bounds.height * 100)),
    };
  }, [getRenderedImageBounds]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const { px, py } = toPct(e.clientX, e.clientY);
    drawStartRef.current = { px, py };
    setCrop({ x: px, y: py, w: 0, h: 0 });
    setIsDrawing(true);
  }, [toPct]);

  // Touch support
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    const { px, py } = toPct(t.clientX, t.clientY);
    drawStartRef.current = { px, py };
    setCrop({ x: px, y: py, w: 0, h: 0 });
    setIsDrawing(true);
  }, [toPct]);

  useEffect(() => {
    if (!isDrawing) return;
    const onMove = (e: MouseEvent) => {
      const { px, py } = toPct(e.clientX, e.clientY);
      const sx = drawStartRef.current.px, sy = drawStartRef.current.py;
      setCrop({ x: Math.min(sx, px), y: Math.min(sy, py), w: Math.abs(px - sx), h: Math.abs(py - sy) });
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      const { px, py } = toPct(t.clientX, t.clientY);
      const sx = drawStartRef.current.px, sy = drawStartRef.current.py;
      setCrop({ x: Math.min(sx, px), y: Math.min(sy, py), w: Math.abs(px - sx), h: Math.abs(py - sy) });
    };
    const onUp = () => setIsDrawing(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [isDrawing, toPct]);

  const hasCrop = !!crop && crop.w > 2 && crop.h > 2;

  // Client-side crop using Canvas API — no backend needed
  const handleConfirm = async () => {
    if (!hasCrop || !crop) return;
    setConfirming(true);
    try {
      const img = imgRef.current!;
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      const x0 = Math.round(crop.x / 100 * nw);
      const y0 = Math.round(crop.y / 100 * nh);
      const cw = Math.max(1, Math.round(crop.w / 100 * nw));
      const ch = Math.max(1, Math.round(crop.h / 100 * nh));

      const canvas = document.createElement("canvas");
      canvas.width  = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d")!;

      // Draw only the cropped region
      ctx.drawImage(img, x0, y0, cw, ch, 0, 0, cw, ch);

      const dataUrl = canvas.toDataURL("image/png");
      const b64     = dataUrl.split(",")[1];
      onCropped(b64, "image/png");
    } catch (e: any) {
      console.error("Crop error:", e);
    } finally {
      setConfirming(false);
    }
  };

  // SVG coords for overlay (relative to container, accounting for letterboxing)
  const svgCrop = crop && imgOffset.w > 0 ? {
    x: imgOffset.x + crop.x / 100 * imgOffset.w,
    y: imgOffset.y + crop.y / 100 * imgOffset.h,
    w: crop.w / 100 * imgOffset.w,
    h: crop.h / 100 * imgOffset.h,
  } : null;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <div className="text-center mb-6">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-400 to-accent flex items-center justify-center mx-auto mb-4">
          <Crop className="w-6 h-6 text-white" />
        </div>
        <h2 className="font-display text-2xl font-700 text-white mb-2">Recadrer le plan</h2>
        <p className="text-slate-400 text-sm">
          {hasCrop
            ? "Ajustez la sélection ou confirmez le recadrage"
            : "Dessinez un rectangle sur le plan pour le recadrer"}
        </p>
      </div>

      {/* Image container */}
      <div
        ref={containerRef}
        className="relative mx-auto max-w-3xl rounded-2xl border border-white/10 overflow-hidden bg-white select-none"
        style={{ cursor: "crosshair" }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <img
          ref={imgRef}
          src={`data:${imageMime};base64,${imageB64}`}
          alt="Plan"
          className="w-full h-auto block max-h-[520px] object-contain"
          draggable={false}
          onLoad={updateImgOffset}
          crossOrigin="anonymous"
        />

        {/* SVG overlay */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {svgCrop && svgCrop.w > 2 && svgCrop.h > 2 ? (
            <>
              <defs>
                <mask id="mcrop-mask">
                  <rect width="100%" height="100%" fill="white" />
                  <rect x={svgCrop.x} y={svgCrop.y} width={svgCrop.w} height={svgCrop.h} fill="black" />
                </mask>
              </defs>
              {/* Dark surround */}
              <rect width="100%" height="100%" fill="rgba(0,0,0,0.50)" mask="url(#mcrop-mask)" />
              {/* Selection border */}
              <rect x={svgCrop.x} y={svgCrop.y} width={svgCrop.w} height={svgCrop.h}
                fill="none" stroke="#22D3EE" strokeWidth={2} />
              {/* Rule of thirds */}
              {!isDrawing && hasCrop && [1 / 3, 2 / 3].map(f => (
                <g key={f}>
                  <line x1={svgCrop.x + svgCrop.w * f} y1={svgCrop.y}
                    x2={svgCrop.x + svgCrop.w * f} y2={svgCrop.y + svgCrop.h}
                    stroke="rgba(34,211,238,0.28)" strokeWidth={1} />
                  <line x1={svgCrop.x} y1={svgCrop.y + svgCrop.h * f}
                    x2={svgCrop.x + svgCrop.w} y2={svgCrop.y + svgCrop.h * f}
                    stroke="rgba(34,211,238,0.28)" strokeWidth={1} />
                </g>
              ))}
              {/* L-shaped corner handles */}
              {!isDrawing && hasCrop && (
                ([
                  [svgCrop.x, svgCrop.y, 1, 1],
                  [svgCrop.x + svgCrop.w, svgCrop.y, -1, 1],
                  [svgCrop.x, svgCrop.y + svgCrop.h, 1, -1],
                  [svgCrop.x + svgCrop.w, svgCrop.y + svgCrop.h, -1, -1],
                ] as [number, number, number, number][]).map(([cx, cy, dx, dy], i) => {
                  const s = 14;
                  return (
                    <polyline key={i}
                      points={`${cx + dx * s},${cy} ${cx},${cy} ${cx},${cy + dy * s}`}
                      fill="none" stroke="#22D3EE" strokeWidth={3} strokeLinecap="round" />
                  );
                })
              )}
              {/* Dimensions label */}
              {!isDrawing && hasCrop && (
                <text x={svgCrop.x + svgCrop.w / 2} y={svgCrop.y - 8}
                  textAnchor="middle" fill="#22D3EE" fontSize={11} fontFamily="monospace">
                  {Math.round(crop!.w)}% × {Math.round(crop!.h)}%
                </text>
              )}
            </>
          ) : (
            !isDrawing && (
              <text x="50%" y="50%"
                textAnchor="middle" dominantBaseline="middle"
                fill="rgba(148,163,184,0.6)" fontSize={14} fontFamily="system-ui">
                Cliquez et glissez pour recadrer
              </text>
            )
          )}
        </svg>
      </div>

      <div className="flex gap-3 justify-center mt-6">
        <Button variant="ghost" size="sm" onClick={() => setCrop(null)} disabled={confirming || !hasCrop}>
          <RotateCcw className="w-4 h-4" /> Réinitialiser
        </Button>
        <Button variant="outline" onClick={onSkip} disabled={confirming}>
          Passer
        </Button>
        <Button onClick={handleConfirm} disabled={confirming || !hasCrop}>
          {confirming
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Application…</>
            : <>Recadrer <ArrowRight className="w-4 h-4" /></>}
        </Button>
      </div>
    </motion.div>
  );
}
