"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Trash2, Undo2, Pentagon, Square } from "lucide-react";
import { SurfaceType, MeasureZone } from "@/lib/measure-types";

interface MeasureCanvasProps {
  imageB64: string;           // base64 image
  imageMime?: string;         // "image/png" | "image/jpeg" etc.
  zones: MeasureZone[];
  activeTypeId: string;
  surfaceTypes: SurfaceType[];
  ppm: number | null;
  onZonesChange: (zones: MeasureZone[]) => void;
}

type Tool = "polygon" | "rect";

const CLOSE_RADIUS = 12; // px — click near first point to close polygon

function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function MeasureCanvas({
  imageB64, imageMime = "image/png",
  zones, activeTypeId, surfaceTypes, ppm, onZonesChange,
}: MeasureCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });

  const [tool, setTool] = useState<Tool>("polygon");
  const [drawingPoints, setDrawingPoints] = useState<{ x: number; y: number }[]>([]);
  const [mouseNorm, setMouseNorm] = useState<{ x: number; y: number } | null>(null);

  // rect draw
  const [rectStart, setRectStart] = useState<{ x: number; y: number } | null>(null);

  // Track image offset
  const updateOffset = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;
    const ir = img.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    setImgOffset({ x: ir.left - cr.left, y: ir.top - cr.top, w: ir.width, h: ir.height });
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  useEffect(() => {
    window.addEventListener("resize", updateOffset);
    return () => window.removeEventListener("resize", updateOffset);
  }, [updateOffset]);

  // Normalize coords relative to image (0-1)
  const toNorm = useCallback((clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img) return null;
    const r = img.getBoundingClientRect();
    const x = (clientX - r.left) / r.width;
    const y = (clientY - r.top) / r.height;
    if (x < 0 || y < 0 || x > 1 || y > 1) return null;
    return { x, y };
  }, []);

  // Convert normalized to SVG coords (container-relative)
  const toSvg = useCallback((n: { x: number; y: number }) => ({
    x: imgOffset.x + n.x * imgOffset.w,
    y: imgOffset.y + n.y * imgOffset.h,
  }), [imgOffset]);

  // Check if point is close to first drawing point
  const nearFirst = useCallback((clientX: number, clientY: number) => {
    if (drawingPoints.length < 3) return false;
    const first = drawingPoints[0];
    const fs = toSvg(first);
    const container = containerRef.current!.getBoundingClientRect();
    const dx = clientX - container.left - fs.x;
    const dy = clientY - container.top - fs.y;
    return Math.hypot(dx, dy) < CLOSE_RADIUS;
  }, [drawingPoints, toSvg]);

  const addZone = useCallback((points: { x: number; y: number }[]) => {
    if (points.length < 3) return;
    const zone: MeasureZone = {
      id: crypto.randomUUID(),
      typeId: activeTypeId,
      points,
    };
    onZonesChange([...zones, zone]);
    setDrawingPoints([]);
  }, [zones, activeTypeId, onZonesChange]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const n = toNorm(e.clientX, e.clientY);
    setMouseNorm(n);
  }, [toNorm]);

  const handleMouseLeave = () => setMouseNorm(null);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (tool !== "polygon") return;
    const n = toNorm(e.clientX, e.clientY);
    if (!n) return;

    // Close polygon if clicking near first point
    if (nearFirst(e.clientX, e.clientY)) {
      addZone(drawingPoints);
      return;
    }
    setDrawingPoints(prev => [...prev, n]);
  }, [tool, toNorm, nearFirst, drawingPoints, addZone]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (tool !== "polygon") return;
    e.preventDefault();
    // Remove last point (added by the preceding click) then close
    const pts = drawingPoints.length >= 3
      ? drawingPoints.slice(0, -1)
      : drawingPoints;
    addZone(pts);
  }, [tool, drawingPoints, addZone]);

  // Rectangle tool
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (tool !== "rect") return;
    if (e.button !== 0) return;
    const n = toNorm(e.clientX, e.clientY);
    if (!n) return;
    setRectStart(n);
  }, [tool, toNorm]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (tool !== "rect" || !rectStart) return;
    const n = toNorm(e.clientX, e.clientY);
    if (!n) { setRectStart(null); return; }
    const x0 = Math.min(rectStart.x, n.x);
    const y0 = Math.min(rectStart.y, n.y);
    const x1 = Math.max(rectStart.x, n.x);
    const y1 = Math.max(rectStart.y, n.y);
    if (x1 - x0 > 0.01 && y1 - y0 > 0.01) {
      addZone([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]);
    }
    setRectStart(null);
  }, [tool, rectStart, toNorm, addZone]);

  const cancelDrawing = useCallback(() => {
    setDrawingPoints([]);
    setRectStart(null);
  }, []);

  // Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelDrawing();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelDrawing]);

  const deleteZone = (id: string) => onZonesChange(zones.filter(z => z.id !== id));
  const undoLast = () => {
    if (drawingPoints.length > 0) { setDrawingPoints(p => p.slice(0, -1)); return; }
    onZonesChange(zones.slice(0, -1));
  };

  const getColor = (typeId: string) =>
    surfaceTypes.find(t => t.id === typeId)?.color ?? "#6B7280";

  // Build preview polygon points string (SVG)
  const previewPoints = [...drawingPoints, ...(mouseNorm ? [mouseNorm] : [])]
    .map(p => { const s = toSvg(p); return `${s.x},${s.y}`; }).join(" ");

  // Rectangle preview
  const rectPreview = rectStart && mouseNorm ? (() => {
    const x0 = Math.min(rectStart.x, mouseNorm.x);
    const y0 = Math.min(rectStart.y, mouseNorm.y);
    const x1 = Math.max(rectStart.x, mouseNorm.x);
    const y1 = Math.max(rectStart.y, mouseNorm.y);
    const s0 = toSvg({ x: x0, y: y0 });
    const s1 = toSvg({ x: x1, y: y1 });
    return { x: s0.x, y: s0.y, w: s1.x - s0.x, h: s1.y - s0.y };
  })() : null;

  const isDrawing = drawingPoints.length > 0 || rectStart !== null;

  const activeColor = getColor(activeTypeId);

  const hint = tool === "polygon"
    ? drawingPoints.length === 0
      ? "Cliquez pour placer le premier point"
      : drawingPoints.length < 2
      ? "Continuez à cliquer pour tracer"
      : "Double-clic ou cliquez le 1er point pour fermer"
    : "Cliquez et glissez pour dessiner un rectangle";

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 glass border border-white/10 rounded-xl p-1">
          <button
            onClick={() => { setTool("polygon"); cancelDrawing(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tool === "polygon" ? "bg-accent text-white" : "text-slate-400 hover:text-white"}`}
          >
            <Pentagon className="w-3.5 h-3.5" /> Polygone
          </button>
          <button
            onClick={() => { setTool("rect"); cancelDrawing(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tool === "rect" ? "bg-accent text-white" : "text-slate-400 hover:text-white"}`}
          >
            <Square className="w-3.5 h-3.5" /> Rectangle
          </button>
        </div>

        <button onClick={undoLast} title="Annuler (Ctrl+Z)"
          className="glass border border-white/10 rounded-lg p-2 text-slate-400 hover:text-white transition-colors">
          <Undo2 className="w-4 h-4" />
        </button>

        {isDrawing && (
          <button onClick={cancelDrawing}
            className="text-xs text-slate-500 hover:text-red-400 transition-colors px-2 py-1.5 glass border border-white/10 rounded-lg">
            Annuler (Échap)
          </button>
        )}

        <span className="ml-auto text-xs text-slate-500 italic">{hint}</span>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative rounded-2xl overflow-hidden border border-white/10 bg-white select-none"
        style={{ cursor: tool === "polygon" ? "crosshair" : "crosshair" }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      >
        <img
          ref={imgRef}
          src={`data:${imageMime};base64,${imageB64}`}
          alt="Plan"
          className="w-full h-auto block max-h-[560px] object-contain"
          draggable={false}
          onLoad={updateOffset}
        />

        {/* SVG overlay */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {/* Completed zones */}
          {zones.map(zone => {
            const color = getColor(zone.typeId);
            const pts = zone.points.map(p => { const s = toSvg(p); return `${s.x},${s.y}`; }).join(" ");
            return (
              <g key={zone.id}>
                <polygon
                  points={pts}
                  fill={hexToRgba(color, 0.28)}
                  stroke={color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
              </g>
            );
          })}

          {/* Rectangle preview */}
          {rectPreview && (
            <rect
              x={rectPreview.x} y={rectPreview.y}
              width={rectPreview.w} height={rectPreview.h}
              fill={hexToRgba(activeColor, 0.2)}
              stroke={activeColor} strokeWidth={2} strokeDasharray="6 3"
            />
          )}

          {/* Polygon in progress */}
          {drawingPoints.length > 0 && (
            <>
              {drawingPoints.length > 1 && (
                <polygon
                  points={previewPoints}
                  fill={hexToRgba(activeColor, 0.15)}
                  stroke={activeColor} strokeWidth={2}
                  strokeDasharray="6 3" strokeLinejoin="round"
                />
              )}
              {drawingPoints.length === 1 && mouseNorm && (
                <line
                  x1={toSvg(drawingPoints[0]).x} y1={toSvg(drawingPoints[0]).y}
                  x2={toSvg(mouseNorm).x} y2={toSvg(mouseNorm).y}
                  stroke={activeColor} strokeWidth={2} strokeDasharray="6 3"
                />
              )}

              {/* Points */}
              {drawingPoints.map((p, i) => {
                const s = toSvg(p);
                const isFirst = i === 0;
                return (
                  <circle key={i}
                    cx={s.x} cy={s.y}
                    r={isFirst ? 5 : 3}
                    fill={isFirst ? activeColor : "white"}
                    stroke={activeColor} strokeWidth={1.5}
                  />
                );
              })}
            </>
          )}

          {/* Empty state */}
          {zones.length === 0 && !isDrawing && (
            <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle"
              fill="rgba(148,163,184,0.6)" fontSize={14} fontFamily="system-ui">
              ✛ Sélectionnez un type et commencez à dessiner
            </text>
          )}
        </svg>
      </div>

      {/* Zones list */}
      {zones.length > 0 && (
        <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto">
          {zones.map((zone, i) => {
            const type = surfaceTypes.find(t => t.id === zone.typeId);
            const areaPx = (() => {
              if (naturalSize.w === 0) return 0;
              let a = 0;
              for (let j = 0; j < zone.points.length; j++) {
                const k = (j + 1) % zone.points.length;
                a += zone.points[j].x * naturalSize.w * zone.points[k].y * naturalSize.h;
                a -= zone.points[k].x * naturalSize.w * zone.points[j].y * naturalSize.h;
              }
              return Math.abs(a) / 2;
            })();
            const areaM2 = ppm ? areaPx / ppm ** 2 : null;

            return (
              <div key={zone.id} className="flex items-center gap-2 glass border border-white/5 rounded-lg px-3 py-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: type?.color ?? "#6B7280" }} />
                <span className="text-slate-400">{type?.name ?? zone.typeId}</span>
                <span className="text-slate-500 ml-1">#{i + 1}</span>
                <span className="ml-auto font-mono text-slate-300">
                  {areaM2 != null ? `${areaM2.toFixed(2)} m²` : `${Math.round(areaPx).toLocaleString()} px²`}
                </span>
                <button onClick={() => deleteZone(zone.id)} className="text-slate-600 hover:text-red-400 transition-colors ml-1">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
