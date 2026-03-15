"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { RotateCcw, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

import { BACKEND } from "@/lib/backend";

interface CropStepProps {
  sessionId: string;
  imageB64: string;
  onCropped: () => void;
  onSkip: () => void;
  onSessionExpired?: () => void;
}

// x, y, w, h in % of the rendered image
interface CropRect { x: number; y: number; w: number; h: number; }

export default function CropStep({ sessionId, imageB64, onCropped, onSkip, onSessionExpired }: CropStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [crop, setCrop] = useState<CropRect | null>(null);
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

  // Convert clientX/Y to % of rendered image (uses actual rendered bounds, not element rect)
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
      onCropped();
    } catch (e: any) {
      if (e.message?.includes("Session introuvable")) {
        toast({ title: "Session expirée", description: "Le serveur a redémarré. Veuillez recommencer l'upload.", variant: "error" });
        onSessionExpired?.();
      } else {
        toast({ title: "Error", description: e.message, variant: "error" });
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

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <div className="text-center mb-6">
        <h2 className="font-display text-2xl font-700 text-white mb-2">{d("cr_title")}</h2>
        <p className="text-slate-400 text-sm">
          {hasCrop ? d("cr_adjust_hint") : d("cr_drag_hint")}
        </p>
      </div>

      {/* Image container */}
      <div
        ref={containerRef}
        className="relative mx-auto max-w-3xl rounded-2xl border border-white/10 overflow-hidden bg-white select-none"
        style={{ cursor: "crosshair" }}
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
            !isDrawing && (
              <text
                x="50%" y="50%"
                textAnchor="middle" dominantBaseline="middle"
                fill="rgba(148,163,184,0.6)" fontSize={14} fontFamily="system-ui"
              >
                {d("cr_drag_hint")}
              </text>
            )
          )}
        </svg>
      </div>

      {hasCrop && crop && (
        <p className="text-center text-xs text-slate-500 mt-3">
          {Math.round(crop.x)}%, {Math.round(crop.y)}% — {Math.round(crop.w)}% × {Math.round(crop.h)}%
        </p>
      )}

      <div className="flex gap-3 justify-center mt-6">
        <Button variant="ghost" size="sm" onClick={() => setCrop(null)} disabled={confirming || !hasCrop}>
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
