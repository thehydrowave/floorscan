"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { Crop, RotateCcw, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";

const BACKEND = "http://localhost:8000";

interface CropStepProps {
  sessionId: string;
  imageB64: string;
  onCropped: () => void;
  onSkip: () => void;
}

export default function CropStep({ sessionId, imageB64, onCropped, onSkip }: CropStepProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0, offsetX: 0, offsetY: 0 });
  const [crop, setCrop] = useState({ x: 5, y: 5, width: 90, height: 90 });
  const [dragging, setDragging] = useState<null | "move" | "resize-se" | "resize-sw" | "resize-ne" | "resize-nw">(null);
  const dragStart = useRef({ mouseX: 0, mouseY: 0, cropX: 0, cropY: 0, cropW: 0, cropH: 0 });
  const [confirming, setConfirming] = useState(false);
  const [hasCrop, setHasCrop] = useState(false);

  const updateImgSize = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;
    const rect = img.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    setImgSize({ w: rect.width, h: rect.height, offsetX: rect.left - containerRect.left, offsetY: rect.top - containerRect.top });
  }, []);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) updateImgSize();
    else img.addEventListener("load", updateImgSize);
    window.addEventListener("resize", updateImgSize);
    return () => { img.removeEventListener("load", updateImgSize); window.removeEventListener("resize", updateImgSize); };
  }, [imageB64, updateImgSize]);

  const pxToPct = useCallback((px: number, dim: "w" | "h") => (px / (dim === "w" ? imgSize.w : imgSize.h)) * 100, [imgSize]);
  const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));

  const onMouseDown = (e: React.MouseEvent, type: typeof dragging) => {
    e.stopPropagation(); e.preventDefault();
    setDragging(type);
    dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, cropX: crop.x, cropY: crop.y, cropW: crop.width, cropH: crop.height };
  };

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging || !imgSize.w) return;
    const dx = pxToPct(e.clientX - dragStart.current.mouseX, "w");
    const dy = pxToPct(e.clientY - dragStart.current.mouseY, "h");
    const { cropX, cropY, cropW, cropH } = dragStart.current;
    setHasCrop(true);
    if (dragging === "move") setCrop({ x: clamp(cropX + dx, 0, 100 - cropW), y: clamp(cropY + dy, 0, 100 - cropH), width: cropW, height: cropH });
    else if (dragging === "resize-se") setCrop({ x: cropX, y: cropY, width: clamp(cropW + dx, 10, 100 - cropX), height: clamp(cropH + dy, 10, 100 - cropY) });
    else if (dragging === "resize-sw") { const nx = clamp(cropX + dx, 0, cropX + cropW - 10); setCrop({ x: nx, y: cropY, width: clamp(cropW - dx, 10, cropX + cropW), height: clamp(cropH + dy, 10, 100 - cropY) }); }
    else if (dragging === "resize-ne") { const ny = clamp(cropY + dy, 0, cropY + cropH - 10); setCrop({ x: cropX, y: ny, width: clamp(cropW + dx, 10, 100 - cropX), height: clamp(cropH - dy, 10, cropY + cropH) }); }
    else if (dragging === "resize-nw") { const nx = clamp(cropX + dx, 0, cropX + cropW - 10); const ny = clamp(cropY + dy, 0, cropY + cropH - 10); setCrop({ x: nx, y: ny, width: clamp(cropW - dx, 10, cropX + cropW), height: clamp(cropH - dy, 10, cropY + cropH) }); }
  }, [dragging, imgSize, pxToPct]);

  const onMouseUp = useCallback(() => setDragging(null), []);

  useEffect(() => {
    if (dragging) { window.addEventListener("mousemove", onMouseMove); window.addEventListener("mouseup", onMouseUp); }
    return () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); };
  }, [dragging, onMouseMove, onMouseUp]);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const img = imgRef.current!;
      const naturalW = img.naturalWidth;
      const naturalH = img.naturalHeight;
      const x0 = Math.round((crop.x / 100) * naturalW);
      const y0 = Math.round((crop.y / 100) * naturalH);
      const x1 = Math.round(((crop.x + crop.width) / 100) * naturalW);
      const y1 = Math.round(((crop.y + crop.height) / 100) * naturalH);

      const r = await fetch(`${BACKEND}/crop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, x0, y0, x1, y1 }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? "Erreur crop");
      const data = await r.json();
      toast({ title: "Crop appliqué", description: `${data.width}×${data.height} px`, variant: "success" });
      onCropped();
    } catch (e: any) {
      toast({ title: "Erreur crop", description: e.message, variant: "error" });
    } finally {
      setConfirming(false);
    }
  };

  const handleSkip = async () => {
    toast({ title: "Crop ignoré", description: "Image complète utilisée pour l'analyse", variant: "default" });
    onSkip();
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <div className="text-center mb-6">
        <h2 className="font-display text-2xl font-700 text-white mb-2">Recadrer la zone d'analyse</h2>
        <p className="text-slate-400 text-sm">Déplacez le rectangle pour sélectionner la région à analyser. Ignorez pour garder l'image entière.</p>
      </div>

      <div ref={containerRef} className="relative mx-auto max-w-3xl glass rounded-2xl border border-white/10 overflow-hidden bg-white" style={{ userSelect: "none" }}>
        <img ref={imgRef} src={`data:image/png;base64,${imageB64}`} alt="Plan" className="w-full h-auto block max-h-[500px] object-contain" draggable={false} onLoad={updateImgSize} />

        {imgSize.w > 0 && (
          <div className="absolute" style={{ top: imgSize.offsetY, left: imgSize.offsetX, width: imgSize.w, height: imgSize.h }}>
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <defs>
                <mask id="crop-mask">
                  <rect width="100%" height="100%" fill="white" />
                  <rect x={`${crop.x}%`} y={`${crop.y}%`} width={`${crop.width}%`} height={`${crop.height}%`} fill="black" />
                </mask>
              </defs>
              <rect width="100%" height="100%" fill="rgba(0,0,0,0.45)" mask="url(#crop-mask)" />
            </svg>

            <div className="absolute border-2 border-accent cursor-move"
              style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.width}%`, height: `${crop.height}%` }}
              onMouseDown={(e) => onMouseDown(e, "move")}>
              {[
                { corner: "resize-nw", style: { top: -5, left: -5, cursor: "nw-resize" } },
                { corner: "resize-ne", style: { top: -5, right: -5, cursor: "ne-resize" } },
                { corner: "resize-sw", style: { bottom: -5, left: -5, cursor: "sw-resize" } },
                { corner: "resize-se", style: { bottom: -5, right: -5, cursor: "se-resize" } },
              ].map(({ corner, style }) => (
                <div key={corner} className="absolute w-3 h-3 bg-accent rounded-sm border border-ink z-10"
                  style={{ ...style, position: "absolute" }} onMouseDown={(e) => onMouseDown(e, corner as any)} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-2 mt-4 text-xs text-slate-500">
        <Crop className="w-3.5 h-3.5" />
        <span>Crop: {Math.round(crop.x)}%, {Math.round(crop.y)}% — {Math.round(crop.width)}% × {Math.round(crop.height)}%</span>
      </div>

      <div className="flex gap-3 justify-center mt-6">
        <Button variant="ghost" size="sm" onClick={() => { setCrop({ x: 5, y: 5, width: 90, height: 90 }); setHasCrop(false); }} disabled={confirming}>
          <RotateCcw className="w-4 h-4" /> Reset
        </Button>
        <Button variant="outline" onClick={handleSkip} disabled={confirming}>Ignorer le crop</Button>
        <Button onClick={handleConfirm} disabled={confirming}>
          {confirming ? <><Loader2 className="w-4 h-4 animate-spin" /> Application...</> : <>Confirmer <ArrowRight className="w-4 h-4" /></>}
        </Button>
      </div>
    </motion.div>
  );
}
