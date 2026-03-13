"use client";

import { useState, useCallback, useRef } from "react";
import { Trash2 } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

interface Point { x: number; y: number } // pixel coords in natural image space

export interface Measurement {
  id: number;
  p1: Point;
  p2: Point;
  distM: number;
}

interface MeasureToolProps {
  /** Pixels per metre (null = uncalibrated) */
  ppm: number | null;
  /** Whether the tool is currently active */
  active: boolean;
  /** Natural (full-res) image width */
  imgW: number;
  /** Natural (full-res) image height */
  imgH: number;
}

let nextId = 1;

export default function MeasureTool({ ppm, active, imgW, imgH }: MeasureToolProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [pending, setPending] = useState<Point | null>(null);
  const [mouse, setMouse] = useState<Point | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  /** Convert client coords to image-space coords */
  const toImageCoords = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * imgW;
      const y = ((e.clientY - rect.top) / rect.height) * imgH;
      return { x, y };
    },
    [imgW, imgH],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!active || !ppm || ppm <= 0) return;
      e.stopPropagation();
      const pt = toImageCoords(e);
      if (!pt) return;

      if (!pending) {
        // First click: set pending point
        setPending(pt);
      } else {
        // Second click: compute distance and save
        const dx = pt.x - pending.x;
        const dy = pt.y - pending.y;
        const pxDist = Math.sqrt(dx * dx + dy * dy);
        const distM = pxDist / ppm;

        setMeasurements(prev => [...prev, { id: nextId++, p1: pending, p2: pt, distM }]);
        setPending(null);
      }
    },
    [active, ppm, pending, toImageCoords],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!active || !pending) return;
      const pt = toImageCoords(e);
      if (pt) setMouse(pt);
    },
    [active, pending, toImageCoords],
  );

  const clearAll = useCallback(() => {
    setMeasurements([]);
    setPending(null);
    setMouse(null);
  }, []);

  if (!active) return null;

  const sw = Math.max(2, imgW * 0.002); // stroke width
  const r = Math.max(4, imgW * 0.004);  // point radius
  const fs = Math.max(12, imgW * 0.012); // font size

  return (
    <>
      {/* SVG overlay */}
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full z-20"
        viewBox={`0 0 ${imgW} ${imgH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ cursor: ppm && ppm > 0 ? "crosshair" : "not-allowed" }}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
      >
        {/* Saved measurements */}
        {measurements.map(m => {
          const mx = (m.p1.x + m.p2.x) / 2;
          const my = (m.p1.y + m.p2.y) / 2;
          return (
            <g key={m.id}>
              <line
                x1={m.p1.x} y1={m.p1.y} x2={m.p2.x} y2={m.p2.y}
                stroke="#0ea5e9" strokeWidth={sw} strokeDasharray={`${sw * 3} ${sw * 2}`}
              />
              <circle cx={m.p1.x} cy={m.p1.y} r={r} fill="#0ea5e9" />
              <circle cx={m.p2.x} cy={m.p2.y} r={r} fill="#0ea5e9" />
              {/* Label background */}
              <rect
                x={mx - fs * 2.5} y={my - fs * 0.9}
                width={fs * 5} height={fs * 1.6}
                rx={fs * 0.25} fill="rgba(0,0,0,0.8)"
              />
              <text
                x={mx} y={my + fs * 0.1}
                fontSize={fs} fill="#0ea5e9" textAnchor="middle"
                dominantBaseline="middle" fontWeight="700"
                fontFamily="monospace"
              >
                {m.distM.toFixed(2)} m
              </text>
            </g>
          );
        })}

        {/* Pending line (following mouse) */}
        {pending && mouse && (
          <g>
            <line
              x1={pending.x} y1={pending.y} x2={mouse.x} y2={mouse.y}
              stroke="#0ea5e9" strokeWidth={sw} strokeDasharray={`${sw * 3} ${sw * 2}`}
              opacity={0.6}
            />
            <circle cx={pending.x} cy={pending.y} r={r} fill="#0ea5e9" />
            <circle cx={mouse.x} cy={mouse.y} r={r * 0.7} fill="#0ea5e9" opacity={0.5} />
            {ppm && ppm > 0 && (() => {
              const dx = mouse.x - pending.x;
              const dy = mouse.y - pending.y;
              const dist = Math.sqrt(dx * dx + dy * dy) / ppm;
              const mx2 = (pending.x + mouse.x) / 2;
              const my2 = (pending.y + mouse.y) / 2;
              return (
                <>
                  <rect
                    x={mx2 - fs * 2.5} y={my2 - fs * 0.9}
                    width={fs * 5} height={fs * 1.6}
                    rx={fs * 0.25} fill="rgba(0,0,0,0.6)"
                  />
                  <text
                    x={mx2} y={my2 + fs * 0.1}
                    fontSize={fs} fill="#0ea5e9" textAnchor="middle"
                    dominantBaseline="middle" fontWeight="700"
                    fontFamily="monospace" opacity={0.7}
                  >
                    {dist.toFixed(2)} m
                  </text>
                </>
              );
            })()}
          </g>
        )}

        {/* Pending point alone */}
        {pending && !mouse && (
          <circle cx={pending.x} cy={pending.y} r={r} fill="#0ea5e9" />
        )}
      </svg>

      {/* Floating control bar */}
      <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
        {!ppm || ppm <= 0 ? (
          <div className="bg-amber-500/20 text-amber-400 text-xs px-3 py-1.5 rounded-lg border border-amber-500/30">
            {d("meas_no_scale" as DTKey)}
          </div>
        ) : (
          <>
            <div className="bg-sky-500/15 text-sky-400 text-xs px-3 py-1.5 rounded-lg border border-sky-500/30">
              {d("meas_hint" as DTKey)} · {measurements.length} {d("meas_count" as DTKey)}
            </div>
            {measurements.length > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); clearAll(); }}
                className="bg-red-500/15 text-red-400 text-xs px-2.5 py-1.5 rounded-lg border border-red-500/30 hover:bg-red-500/25 transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> {d("meas_clear" as DTKey)}
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}
