"use client";

import { useRef, useState, useCallback, useEffect, useLayoutEffect } from "react";
import { Trash2, Undo2, Redo2, Pentagon, Square, ZoomIn, ZoomOut, RotateCcw, Spline, MinusSquare, Ruler, Scissors, Search, Save, Loader2 } from "lucide-react";
import { SurfaceType, MeasureZone, pointInPolygon, splitPolygonByLine } from "@/lib/measure-types";
import type { VisualSearchMatch, CustomDetection } from "@/lib/types";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface MeasureCanvasProps {
  imageB64: string;
  imageMime?: string;
  zones: MeasureZone[];
  activeTypeId: string;
  surfaceTypes: SurfaceType[];
  ppm: number | null;
  onZonesChange: (zones: MeasureZone[]) => void;
  onHistoryPush?: (snapshot: MeasureZone[]) => void;
  onHistoryUndo?: () => void;
  onHistoryRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  // Visual search props
  sessionId?: string | null;
  onEnsureSession?: () => Promise<string | null>;
  vsMatches?: VisualSearchMatch[];
  onVsMatchesChange?: (matches: VisualSearchMatch[]) => void;
  customDetections?: CustomDetection[];
  onSaveDetection?: (label: string, matches: VisualSearchMatch[]) => void;
}

type Tool = "polygon" | "rect" | "angle" | "wall" | "split" | "visual_search";

interface AngleMeasurement {
  id: string;
  a: { x: number; y: number };
  v: { x: number; y: number };
  b: { x: number; y: number };
}

const CLOSE_RADIUS = 12; // px screen-space

function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Snap point to nearest 45° angle from anchor, using image pixel space for correct aspect ratio */
function snapTo45(
  anchor: { x: number; y: number },
  cur: { x: number; y: number },
  imageW: number,
  imageH: number
): { x: number; y: number } {
  const ax = anchor.x * imageW, ay = anchor.y * imageH;
  const cx = cur.x * imageW,    cy = cur.y * imageH;
  const dx = cx - ax, dy = cy - ay;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return cur;
  const dist  = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  const snap  = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: anchor.x + dist * Math.cos(snap) / imageW,
    y: anchor.y + dist * Math.sin(snap) / imageH,
  };
}

function getCentroid(points: { x: number; y: number }[]) {
  return {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  };
}

export default function MeasureCanvas({
  imageB64, imageMime = "image/png",
  zones, activeTypeId, surfaceTypes, ppm, onZonesChange,
  onHistoryPush, onHistoryUndo, onHistoryRedo, canUndo = false, canRedo = false,
  sessionId, onEnsureSession, vsMatches = [], onVsMatchesChange, customDetections = [], onSaveDetection,
}: MeasureCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef       = useRef<HTMLImageElement>(null);

  // imgOffset: container-relative bounding rect of the rendered image
  // Updated via useLayoutEffect after every zoom/translate change → always current before paint
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });

  // Drawing state
  const [tool, setTool]               = useState<Tool>("polygon");
  const [drawingPoints, setDrawingPoints] = useState<{ x: number; y: number }[]>([]);
  const [mouseNorm, setMouseNorm]     = useState<{ x: number; y: number } | null>(null);
  const [rectStart, setRectStart]     = useState<{ x: number; y: number } | null>(null);
  // Wall tool state
  const [wallStart, setWallStart]       = useState<{ x: number; y: number } | null>(null);
  const [wallThicknessCm, setWallThicknessCm] = useState(15);

  // Zoom / pan state
  const [zoom, setZoom]         = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [panCursor, setPanCursor] = useState(false);

  // Vertex edit state
  const [dragVertex, setDragVertex] = useState<{ zoneId: string; idx: number } | null>(null);

  // Déduction mode
  const [isDeductionMode, setIsDeductionMode] = useState(false);
  const isDeductionRef = useRef(false);
  useEffect(() => { isDeductionRef.current = isDeductionMode; }, [isDeductionMode]);

  // Angle tool state
  const [anglePts, setAnglePts]               = useState<{ x: number; y: number }[]>([]);
  const [angleMeasurements, setAngleMeasurements] = useState<AngleMeasurement[]>([]);

  // Split tool state
  const [splitPts, setSplitPts] = useState<{ x: number; y: number }[]>([]);

  // Visual search state
  const [vsCropStart, setVsCropStart] = useState<{ x: number; y: number } | null>(null);
  const [vsSearching, setVsSearching] = useState(false);
  const [vsEditMode, setVsEditMode]   = useState<"search" | "add" | "remove">("search");
  const [showVsSave, setShowVsSave]   = useState(false);
  const [vsSaveLabel, setVsSaveLabel] = useState("");

  // Stable refs for use in event handlers
  const zoomRef          = useRef(zoom);
  const translateRef     = useRef(translate);
  const isPanRef         = useRef(false);
  const panStartRef      = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });
  const dragVertexRef    = useRef<{ zoneId: string; idx: number } | null>(null);
  const zonesRef         = useRef(zones);
  const onZonesChangeRef = useRef(onZonesChange);
  const skipNextClickRef  = useRef(false);
  // Touch-specific refs (stable values for touch effect with [] deps)
  const drawingPointsRef  = useRef<{ x: number; y: number }[]>([]);
  const addZoneRef        = useRef<(pts: { x: number; y: number }[]) => void>(() => {});
  const nearFirstRef      = useRef<(cx: number, cy: number) => boolean>(() => false);
  const touchPinchRef     = useRef<{ dist: number; zoom: number; tx: number; ty: number; cx: number; cy: number } | null>(null);
  const lastTapTimeRef    = useRef(0);
  const touchStartRef     = useRef({ time: 0, x: 0, y: 0 });

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { translateRef.current = translate; }, [translate]);
  useEffect(() => { dragVertexRef.current = dragVertex; }, [dragVertex]);
  useEffect(() => { zonesRef.current = zones; }, [zones]);
  useEffect(() => { onZonesChangeRef.current = onZonesChange; }, [onZonesChange]);

  // ── Update imgOffset after zoom/translate is committed to DOM ──────────────
  const updateOffset = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;
    const ir = img.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    setImgOffset({ x: ir.left - cr.left, y: ir.top - cr.top, w: ir.width, h: ir.height });
  }, []);

  // Run synchronously before paint so SVG overlay is always in sync with image
  useLayoutEffect(() => { updateOffset(); }, [zoom, translate, updateOffset]);

  useEffect(() => {
    window.addEventListener("resize", updateOffset);
    return () => window.removeEventListener("resize", updateOffset);
  }, [updateOffset]);

  // ── Wheel zoom centered on cursor ─────────────────────────────────────────
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top  - rect.height / 2;
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoom(prevZ => {
      const newZ  = Math.max(1, Math.min(12, prevZ * factor));
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

  // ── Global pan (right-click drag) + vertex drag ───────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isPanRef.current) {
        const dx = e.clientX - panStartRef.current.mx;
        const dy = e.clientY - panStartRef.current.my;
        setTranslate({ x: panStartRef.current.tx + dx, y: panStartRef.current.ty + dy });
        return;
      }
      if (dragVertexRef.current) {
        const img = imgRef.current;
        if (!img) return;
        const r = img.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        const y = Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height));
        const { zoneId, idx } = dragVertexRef.current;
        onZonesChangeRef.current(zonesRef.current.map(z =>
          z.id !== zoneId ? z :
          { ...z, points: z.points.map((p, i) => i === idx ? { x, y } : p) }
        ));
      }
    };
    const onUp = (e: MouseEvent) => {
      if (e.button === 2) {
        isPanRef.current = false;
        setPanCursor(false);
        return;
      }
      if (e.button === 0 && dragVertexRef.current) {
        dragVertexRef.current = null;
        setDragVertex(null);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, []);

  // ── Coordinate helpers ────────────────────────────────────────────────────

  // Screen coords → normalized image coords (0-1)
  const toNorm = useCallback((clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img) return null;
    const r = img.getBoundingClientRect();
    const x = (clientX - r.left)  / r.width;
    const y = (clientY - r.top)   / r.height;
    if (x < 0 || y < 0 || x > 1 || y > 1) return null;
    return { x, y };
  }, []);

  // Normalized → container-relative SVG coords (uses latest imgOffset)
  const toSvg = useCallback((n: { x: number; y: number }) => ({
    x: imgOffset.x + n.x * imgOffset.w,
    y: imgOffset.y + n.y * imgOffset.h,
  }), [imgOffset]);

  // Is cursor near the first drawing point?
  const nearFirst = useCallback((clientX: number, clientY: number) => {
    if (drawingPoints.length < 3) return false;
    const fs = toSvg(drawingPoints[0]);
    const container = containerRef.current!.getBoundingClientRect();
    const dx = clientX - container.left - fs.x;
    const dy = clientY - container.top  - fs.y;
    return Math.hypot(dx, dy) < CLOSE_RADIUS;
  }, [drawingPoints, toSvg]);

  // ── Touch refs — synced after each render ──────────────────────────────────
  useEffect(() => { drawingPointsRef.current = drawingPoints; }, [drawingPoints]);

  // ── Touch support (synced via refs → [] deps, no re-registration) ──────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const getDist = (t1: Touch, t2: Touch) =>
      Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        touchPinchRef.current = null;
        touchStartRef.current = { time: Date.now(), x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        const rect = el.getBoundingClientRect();
        touchPinchRef.current = {
          dist: getDist(e.touches[0], e.touches[1]),
          zoom: zoomRef.current,
          tx: translateRef.current.x,
          ty: translateRef.current.y,
          cx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left - rect.width  / 2,
          cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top  - rect.height / 2,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 2 && touchPinchRef.current) {
        const p = touchPinchRef.current;
        const newDist = getDist(e.touches[0], e.touches[1]);
        const newZoom = Math.max(1, Math.min(12, p.zoom * (newDist / p.dist)));
        const ratio   = newZoom / p.zoom;
        const rect    = el.getBoundingClientRect();
        const newCx   = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left - rect.width  / 2;
        const newCy   = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top  - rect.height / 2;
        setZoom(newZoom);
        setTranslate({ x: p.cx * (1 - ratio) + p.tx * ratio + (newCx - p.cx), y: p.cy * (1 - ratio) + p.ty * ratio + (newCy - p.cy) });
      } else if (e.touches.length === 1 && !touchPinchRef.current) {
        // Draw preview
        const img = imgRef.current;
        if (!img) return;
        const r = img.getBoundingClientRect();
        const x = (e.touches[0].clientX - r.left) / r.width;
        const y = (e.touches[0].clientY - r.top)  / r.height;
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) setMouseNorm({ x, y });
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      if (e.changedTouches.length === 1 && e.touches.length === 0 && !touchPinchRef.current) {
        const ts      = touchStartRef.current;
        const elapsed = Date.now() - ts.time;
        const moved   = Math.hypot(e.changedTouches[0].clientX - ts.x, e.changedTouches[0].clientY - ts.y);
        if (elapsed < 350 && moved < 15) {
          const t   = e.changedTouches[0];
          const now = Date.now();
          if (now - lastTapTimeRef.current < 350) {
            // Double tap → close polygon
            lastTapTimeRef.current = 0;
            const pts = drawingPointsRef.current;
            if (pts.length >= 3) addZoneRef.current(pts.slice(0, -1));
          } else {
            lastTapTimeRef.current = now;
            // Single tap → add point
            const img = imgRef.current;
            if (!img) return;
            const r = img.getBoundingClientRect();
            const x = (t.clientX - r.left) / r.width;
            const y = (t.clientY - r.top)  / r.height;
            if (x < 0 || y < 0 || x > 1 || y > 1) return;
            if (nearFirstRef.current(t.clientX, t.clientY)) {
              addZoneRef.current(drawingPointsRef.current);
            } else {
              setDrawingPoints(prev => [...prev, { x, y }]);
            }
          }
        }
      }
      if (e.touches.length < 2) touchPinchRef.current = null;
      if (e.touches.length === 0) setMouseNorm(null);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove",  onTouchMove,  { passive: false });
    el.addEventListener("touchend",   onTouchEnd,   { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove",  onTouchMove);
      el.removeEventListener("touchend",   onTouchEnd);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // all mutable values accessed via stable refs

  // ── Drawing actions ───────────────────────────────────────────────────────
  const addZone = useCallback((points: { x: number; y: number }[]) => {
    if (points.length < 3) return;
    onHistoryPush?.(zonesRef.current);
    const newZone: MeasureZone = {
      id: crypto.randomUUID(),
      typeId: activeTypeId,
      points,
      ...(isDeductionRef.current ? { isDeduction: true } : {}),
    };
    onZonesChange([...zones, newZone]);
    setDrawingPoints([]);
  }, [zones, activeTypeId, onZonesChange, onHistoryPush]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragVertexRef.current) return;
    let n = toNorm(e.clientX, e.clientY);
    if (n && e.shiftKey && tool === "polygon" && drawingPoints.length > 0 && naturalSize.w > 0) {
      n = snapTo45(drawingPoints[drawingPoints.length - 1], n, naturalSize.w, naturalSize.h);
    }
    setMouseNorm(n);
  }, [toNorm, tool, drawingPoints, naturalSize]);

  const handleMouseLeave = () => setMouseNorm(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) {
      // Right-click → pan
      e.preventDefault();
      isPanRef.current = true;
      panStartRef.current = {
        mx: e.clientX, my: e.clientY,
        tx: translateRef.current.x, ty: translateRef.current.y,
      };
      setPanCursor(true);
      return;
    }
    if (tool === "rect" && e.button === 0) {
      const n = toNorm(e.clientX, e.clientY);
      if (n) setRectStart(n);
    }
    if (tool === "wall" && e.button === 0) {
      const n = toNorm(e.clientX, e.clientY);
      if (n) setWallStart(n);
    }
    if (tool === "visual_search" && vsEditMode === "search" && e.button === 0) {
      const n = toNorm(e.clientX, e.clientY);
      if (n) setVsCropStart(n);
    }
  }, [tool, toNorm, vsEditMode]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (skipNextClickRef.current) { skipNextClickRef.current = false; return; }
    if (e.button !== 0) return;
    const raw = toNorm(e.clientX, e.clientY);
    if (!raw) return;
    // Use already-snapped mouseNorm if shift is held while drawing
    const pt: { x: number; y: number } =
      (tool === "polygon" && e.shiftKey && mouseNorm && drawingPoints.length > 0) ? mouseNorm : raw;
    if (tool === "polygon") {
      if (nearFirst(e.clientX, e.clientY)) { addZone(drawingPoints); return; }
      setDrawingPoints(prev => [...prev, pt]);
    } else if (tool === "angle") {
      if (anglePts.length < 2) {
        setAnglePts(prev => [...prev, pt]);
      } else {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
        setAngleMeasurements(prev => [...prev, { id, a: anglePts[0], v: anglePts[1], b: pt }]);
        setAnglePts([]);
      }
    } else if (tool === "split") {
      if (splitPts.length === 0) {
        setSplitPts([pt]);
      } else {
        const p1 = splitPts[0];
        const p2 = pt;
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const currentZones = zonesRef.current;
        // Priority: zone whose interior contains the midpoint of the cut line
        let idx = currentZones.findIndex(z =>
          pointInPolygon(mid, z.points) && splitPolygonByLine(z.points, p1, p2) !== null
        );
        // Fallback: first zone the line actually intersects
        if (idx < 0) idx = currentZones.findIndex(z => splitPolygonByLine(z.points, p1, p2) !== null);
        if (idx >= 0) {
          const result = splitPolygonByLine(currentZones[idx].points, p1, p2);
          if (result) {
            onHistoryPush?.(currentZones);
            const [polyA, polyB] = result;
            const target = currentZones[idx];
            const newZones = [...currentZones];
            newZones.splice(idx, 1,
              { ...target, id: crypto.randomUUID(), points: polyA },
              { ...target, id: crypto.randomUUID(), points: polyB }
            );
            onZonesChangeRef.current(newZones);
          }
        }
        setSplitPts([]);
      }
    } else if (tool === "visual_search" && vsEditMode === "add") {
      // Add a manual match at click position
      if (onVsMatchesChange) {
        const newMatch: VisualSearchMatch = { x_norm: pt.x - 0.02, y_norm: pt.y - 0.02, w_norm: 0.04, h_norm: 0.04, score: 1 };
        onVsMatchesChange([...vsMatches, newMatch]);
      }
    } else if (tool === "visual_search" && vsEditMode === "remove") {
      // Remove match closest to click
      if (onVsMatchesChange && vsMatches.length > 0) {
        let bestIdx = 0;
        let bestDist = Infinity;
        vsMatches.forEach((m, i) => {
          const cx = m.x_norm + m.w_norm / 2;
          const cy = m.y_norm + m.h_norm / 2;
          const d = Math.hypot(cx - pt.x, cy - pt.y);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        });
        if (bestDist < 0.05) {
          onVsMatchesChange(vsMatches.filter((_, i) => i !== bestIdx));
        }
      }
    }
  }, [tool, toNorm, nearFirst, drawingPoints, addZone, anglePts, splitPts, onHistoryPush, vsEditMode, vsMatches, onVsMatchesChange]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (tool !== "polygon") return;
    e.preventDefault();
    const pts = drawingPoints.length >= 3 ? drawingPoints.slice(0, -1) : drawingPoints;
    addZone(pts);
  }, [tool, drawingPoints, addZone]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (dragVertex) return; // handled by global listener
    if (e.button !== 0) return;
    // Rect tool
    if (tool === "rect" && rectStart) {
      const n = toNorm(e.clientX, e.clientY);
      if (!n) { setRectStart(null); return; }
      const x0 = Math.min(rectStart.x, n.x), y0 = Math.min(rectStart.y, n.y);
      const x1 = Math.max(rectStart.x, n.x), y1 = Math.max(rectStart.y, n.y);
      if (x1 - x0 > 0.01 && y1 - y0 > 0.01) {
        addZone([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]);
      }
      setRectStart(null);
    }
    // Wall tool — creates a rotated rectangle (4-point polygon) oriented along the drag axis
    if (tool === "wall" && wallStart && naturalSize.w > 0) {
      const n = toNorm(e.clientX, e.clientY);
      if (!n) { setWallStart(null); return; }
      const sx = wallStart.x * naturalSize.w, sy = wallStart.y * naturalSize.h;
      const ex = n.x * naturalSize.w,        ey = n.y * naturalSize.h;
      const dx = ex - sx, dy = ey - sy;
      const len = Math.hypot(dx, dy);
      if (len > 3) {
        // Perpendicular unit vector in image-pixel space
        const px = -dy / len, py = dx / len;
        // Half-thickness: if ppm known → cm→pixels; otherwise treat value as raw image pixels
        const halfT = ppm ? (wallThicknessCm / 100) * ppm / 2 : wallThicknessCm / 2;
        const corners: { x: number; y: number }[] = [
          { x: (sx + px * halfT) / naturalSize.w, y: (sy + py * halfT) / naturalSize.h },
          { x: (ex + px * halfT) / naturalSize.w, y: (ey + py * halfT) / naturalSize.h },
          { x: (ex - px * halfT) / naturalSize.w, y: (ey - py * halfT) / naturalSize.h },
          { x: (sx - px * halfT) / naturalSize.w, y: (sy - py * halfT) / naturalSize.h },
        ];
        addZone(corners);
      }
      setWallStart(null);
    }
    // Visual search crop → trigger search
    if (tool === "visual_search" && vsEditMode === "search" && vsCropStart && e.button === 0) {
      const n = toNorm(e.clientX, e.clientY);
      if (n) {
        const x0 = Math.min(vsCropStart.x, n.x), y0 = Math.min(vsCropStart.y, n.y);
        const x1 = Math.max(vsCropStart.x, n.x), y1 = Math.max(vsCropStart.y, n.y);
        const w = x1 - x0, h = y1 - y0;
        if (w > 0.01 && h > 0.01 && onEnsureSession && onVsMatchesChange) {
          setVsSearching(true);
          onEnsureSession().then(sid => {
            if (!sid) { setVsSearching(false); return; }
            fetch(`${BACKEND}/visual-search`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                session_id: sid,
                x_pct: x0 * 100, y_pct: y0 * 100,
                w_pct: w * 100,  h_pct: h * 100,
                threshold: 0.80,
              }),
            })
              .then(r => r.json())
              .then(data => { onVsMatchesChange(data.matches ?? []); })
              .catch(() => { /* silent */ })
              .finally(() => setVsSearching(false));
          });
        }
      }
      setVsCropStart(null);
    }
  }, [dragVertex, tool, rectStart, wallStart, wallThicknessCm, naturalSize, ppm, toNorm, addZone, vsCropStart, vsEditMode, onEnsureSession, onVsMatchesChange]);

  // Sync touch refs after these callbacks are (re)created
  useEffect(() => { addZoneRef.current = addZone; }, [addZone]);
  useEffect(() => { nearFirstRef.current = nearFirst; }, [nearFirst]);

  const cancelDrawing = useCallback(() => { setDrawingPoints([]); setRectStart(null); setWallStart(null); setAnglePts([]); setSplitPts([]); setVsCropStart(null); }, []);
  const resetView     = useCallback(() => { setZoom(1); setTranslate({ x: 0, y: 0 }); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { cancelDrawing(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (drawingPoints.length > 0) { setDrawingPoints(p => p.slice(0, -1)); return; }
        if (anglePts.length > 0) { setAnglePts(p => p.slice(0, -1)); return; }
        onHistoryUndo?.();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        onHistoryRedo?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelDrawing, drawingPoints, anglePts, onHistoryUndo, onHistoryRedo]);

  const deleteZone = (id: string) => {
    onHistoryPush?.(zonesRef.current);
    onZonesChange(zones.filter(z => z.id !== id));
  };
  const undoLast = () => {
    if (drawingPoints.length > 0) { setDrawingPoints(p => p.slice(0, -1)); return; }
    onHistoryUndo?.();
  };

  const getColor = (typeId: string) => surfaceTypes.find(t => t.id === typeId)?.color ?? "#6B7280";

  // ── SVG preview data ──────────────────────────────────────────────────────
  const previewPoints = [...drawingPoints, ...(mouseNorm ? [mouseNorm] : [])]
    .map(p => { const s = toSvg(p); return `${s.x},${s.y}`; }).join(" ");

  const rectPreview = rectStart && mouseNorm ? (() => {
    const x0 = Math.min(rectStart.x, mouseNorm.x), y0 = Math.min(rectStart.y, mouseNorm.y);
    const x1 = Math.max(rectStart.x, mouseNorm.x), y1 = Math.max(rectStart.y, mouseNorm.y);
    const s0 = toSvg({ x: x0, y: y0 }), s1 = toSvg({ x: x1, y: y1 });
    return { x: s0.x, y: s0.y, w: s1.x - s0.x, h: s1.y - s0.y };
  })() : null;

  // Wall preview: rotated rectangle oriented along the drag axis
  const wallPreviewPts: { x: number; y: number }[] | null =
    tool === "wall" && wallStart && mouseNorm && naturalSize.w > 0
      ? (() => {
          const sx = wallStart.x * naturalSize.w, sy = wallStart.y * naturalSize.h;
          const ex = mouseNorm.x * naturalSize.w,  ey = mouseNorm.y * naturalSize.h;
          const dx = ex - sx, dy = ey - sy;
          const len = Math.hypot(dx, dy);
          if (len < 1) return null;
          const px = -dy / len, py = dx / len;
          const halfT = ppm ? (wallThicknessCm / 100) * ppm / 2 : wallThicknessCm / 2;
          const corners: { x: number; y: number }[] = [
            { x: (sx + px * halfT) / naturalSize.w, y: (sy + py * halfT) / naturalSize.h },
            { x: (ex + px * halfT) / naturalSize.w, y: (ey + py * halfT) / naturalSize.h },
            { x: (ex - px * halfT) / naturalSize.w, y: (ey - py * halfT) / naturalSize.h },
            { x: (sx - px * halfT) / naturalSize.w, y: (sy - py * halfT) / naturalSize.h },
          ];
          return corners.map(c => toSvg(c));
        })()
      : null;

  const isDrawing   = drawingPoints.length > 0 || rectStart !== null || wallStart !== null || splitPts.length > 0 || vsCropStart !== null;
  const activeColor = getColor(activeTypeId);

  const hint = dragVertex ? "Glissez pour repositionner le sommet · relâchez pour valider"
    : tool === "angle"
    ? anglePts.length === 0 ? "Cliquez pour placer le 1er point de la mesure d'angle"
    : anglePts.length === 1 ? "Cliquez pour placer le sommet de l'angle"
    : "Cliquez pour valider l'angle · Clic droit sur ∠ pour supprimer"
    : tool === "polygon"
    ? drawingPoints.length === 0
      ? zones.length > 0
        ? "Cliquez pour tracer · Glissez un ● pour déplacer · Clic droit ● pour supprimer · ＋ pour insérer"
        : "Cliquez pour placer le premier point"
      : drawingPoints.length < 2   ? "Continuez à cliquer · Maj pour contraindre à 45°"
      : "Double-clic ou cliquez le 1er point pour fermer · Maj = snap 45°"
    : tool === "wall"
    ? wallStart
      ? `Relâchez pour valider le mur · épaisseur ${wallThicknessCm} ${ppm ? "cm" : "px"}`
      : `Cliquez et glissez pour tracer un mur · épaisseur : ${wallThicknessCm} ${ppm ? "cm" : "px"}`
    : tool === "split"
    ? splitPts.length === 0
      ? "Cliquez le 1er point de la ligne de découpe"
      : "Cliquez le 2e point pour découper la zone"
    : tool === "visual_search"
    ? vsSearching ? "Recherche en cours…"
    : vsEditMode === "search" ? "Dessinez un rectangle autour du motif à rechercher"
    : vsEditMode === "add" ? "Cliquez pour ajouter un résultat manuellement"
    : "Cliquez sur un résultat pour le supprimer"
    : "Cliquez et glissez pour dessiner un rectangle";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap">

        {/* Tool selector */}
        <div className="flex gap-1 glass border border-white/10 rounded-xl p-1">
          <button
            onClick={() => { setTool("polygon"); cancelDrawing(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tool === "polygon" ? "bg-accent text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            <Pentagon className="w-3.5 h-3.5" /> Polygone
          </button>
          <button
            onClick={() => { setTool("rect"); cancelDrawing(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tool === "rect" ? "bg-accent text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            <Square className="w-3.5 h-3.5" /> Rectangle
          </button>
          <button
            onClick={() => { setTool("angle"); cancelDrawing(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tool === "angle" ? "bg-amber-500 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            <Spline className="w-3.5 h-3.5" /> Angle
          </button>
          <button
            onClick={() => { setTool("wall"); cancelDrawing(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tool === "wall"
                ? "bg-orange-500/20 border border-orange-500/40 text-orange-300"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Ruler className="w-3.5 h-3.5" /> Mur
          </button>
          <button
            onClick={() => { setTool("split"); cancelDrawing(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tool === "split"
                ? "bg-red-500/20 border border-red-500/40 text-red-300"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Scissors className="w-3.5 h-3.5" /> Découper
          </button>
          <button
            onClick={() => { setTool("visual_search"); cancelDrawing(); setVsEditMode("search"); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tool === "visual_search"
                ? "bg-cyan-500/20 border border-cyan-500/40 text-cyan-300"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Search className="w-3.5 h-3.5" /> Recherche
          </button>
        </div>

        {/* Wall thickness control — shown only when wall tool is active */}
        {tool === "wall" && (
          <div className="flex items-center gap-2 glass border border-orange-500/20 rounded-xl px-3 py-1.5">
            <Ruler className="w-3 h-3 text-orange-400 shrink-0" />
            <span className="text-xs text-slate-400">Épaisseur</span>
            <input
              type="number"
              min={1}
              max={500}
              step={1}
              value={wallThicknessCm}
              onChange={e => setWallThicknessCm(Math.max(1, parseInt(e.target.value) || 15))}
              className="w-14 bg-transparent text-orange-300 text-xs font-mono text-center border-b border-orange-500/30 focus:outline-none focus:border-orange-400"
            />
            <span className="text-xs text-slate-500">{ppm ? "cm" : "px"}</span>
            {ppm && (
              <span className="text-[10px] text-slate-600 font-mono">
                = {((wallThicknessCm / 100) * ppm).toFixed(0)} px
              </span>
            )}
          </div>
        )}

        {/* VS sub-toolbar */}
        {tool === "visual_search" && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1 glass border border-cyan-500/20 rounded-xl p-1">
              {(["search", "add", "remove"] as const).map(m => (
                <button key={m} onClick={() => setVsEditMode(m)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    vsEditMode === m ? "bg-cyan-500/30 text-cyan-200" : "text-slate-400 hover:text-white"
                  }`}>
                  {m === "search" ? "🔍 Chercher" : m === "add" ? "＋ Ajouter" : "− Retirer"}
                </button>
              ))}
            </div>
            {vsSearching && <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />}
            {vsMatches.length > 0 && (
              <>
                <span className="text-xs text-cyan-400 font-mono">{vsMatches.length} trouvé{vsMatches.length > 1 ? "s" : ""}</span>
                <button onClick={() => onVsMatchesChange?.([])}
                  className="text-xs text-slate-500 hover:text-red-400 px-2 py-1 glass border border-white/10 rounded-lg transition-colors">
                  Effacer
                </button>
                <button onClick={() => { setShowVsSave(true); setVsSaveLabel(""); }}
                  className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 px-2 py-1 glass border border-cyan-500/20 rounded-lg transition-colors">
                  <Save className="w-3 h-3" /> Sauvegarder
                </button>
              </>
            )}
            {showVsSave && (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={vsSaveLabel}
                  onChange={e => setVsSaveLabel(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && vsSaveLabel.trim()) {
                      onSaveDetection?.(vsSaveLabel.trim(), vsMatches);
                      onVsMatchesChange?.([]);
                      setShowVsSave(false);
                    }
                    if (e.key === "Escape") setShowVsSave(false);
                  }}
                  placeholder="Nom de la détection…"
                  className="w-40 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-600 outline-none focus:border-cyan-500"
                />
                <button
                  disabled={!vsSaveLabel.trim()}
                  onClick={() => {
                    if (vsSaveLabel.trim()) {
                      onSaveDetection?.(vsSaveLabel.trim(), vsMatches);
                      onVsMatchesChange?.([]);
                      setShowVsSave(false);
                    }
                  }}
                  className="text-xs text-cyan-400 hover:text-cyan-300 px-2 py-1 glass border border-cyan-500/20 rounded-lg transition-colors disabled:opacity-40"
                >
                  OK
                </button>
              </div>
            )}
          </div>
        )}

        {/* Déduction toggle */}
        <button
          onClick={() => setIsDeductionMode(v => !v)}
          title="Mode déduction — la zone dessinée sera soustraite du total"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
            isDeductionMode
              ? "bg-red-500/20 border-red-500/50 text-red-400"
              : "glass border-white/10 text-slate-400 hover:text-white"
          }`}
        >
          <MinusSquare className="w-3.5 h-3.5" />
          {isDeductionMode ? "Déduction ON" : "Déduction"}
        </button>

        <button onClick={undoLast} title="Annuler (Ctrl+Z)"
          disabled={drawingPoints.length === 0 && !canUndo}
          className="glass border border-white/10 rounded-lg p-2 text-slate-400 hover:text-white transition-colors disabled:opacity-30">
          <Undo2 className="w-4 h-4" />
        </button>
        <button onClick={() => onHistoryRedo?.()} title="Rétablir (Ctrl+Y)"
          disabled={!canRedo}
          className="glass border border-white/10 rounded-lg p-2 text-slate-400 hover:text-white transition-colors disabled:opacity-30">
          <Redo2 className="w-4 h-4" />
        </button>

        {isDrawing && (
          <button onClick={cancelDrawing}
            className="text-xs text-slate-500 hover:text-red-400 transition-colors px-2 py-1.5 glass border border-white/10 rounded-lg">
            Annuler (Échap)
          </button>
        )}

        {/* Zoom controls */}
        <div className="flex gap-1 ml-auto">
          <button onClick={() => setZoom(z => Math.min(12, z * 1.3))} title="Zoom +"
            className="glass border border-white/10 rounded-lg p-2 text-slate-400 hover:text-white transition-colors">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button onClick={() => setZoom(z => Math.max(1, z / 1.3))} title="Zoom -"
            className="glass border border-white/10 rounded-lg p-2 text-slate-400 hover:text-white transition-colors">
            <ZoomOut className="w-4 h-4" />
          </button>
          <button onClick={resetView} title="Réinitialiser la vue"
            className="glass border border-white/10 rounded-lg p-2 text-slate-400 hover:text-white transition-colors">
            <RotateCcw className="w-4 h-4" />
          </button>
          {zoom > 1.05 && (
            <span className="self-center text-xs text-slate-500 font-mono ml-1">×{zoom.toFixed(1)}</span>
          )}
        </div>

      </div>

      {/* Hint */}
      <span className="text-xs text-slate-500 italic -mt-1">{hint}</span>

      {/* ── Canvas ── */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-white select-none"
        style={{ height: "calc(100vh - 220px)", minHeight: 400, cursor: dragVertex ? "move" : panCursor ? "grabbing" : "crosshair" }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onContextMenu={e => e.preventDefault()}
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
            src={`data:${imageMime};base64,${imageB64}`}
            alt="Plan"
            style={{ display: "block", maxWidth: "90vw", maxHeight: "calc(100vh - 240px)" }}
            draggable={false}
            onLoad={() => {
              const img = imgRef.current;
              if (img) {
                setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                updateOffset();
              }
            }}
          />
        </div>

        {/* SVG overlay — same coordinate space as container */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <defs>
            <pattern id="hatch-deduction" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(239,68,68,0.55)" strokeWidth="3" />
            </pattern>
          </defs>

          {/* Completed zones */}
          {zones.map(zone => {
            const color = zone.isDeduction ? "#EF4444" : getColor(zone.typeId);
            const pts = zone.points.map(p => { const s = toSvg(p); return `${s.x},${s.y}`; }).join(" ");

            // Label at centroid
            const centroid = toSvg(getCentroid(zone.points));
            const typeName = zone.name || surfaceTypes.find(t => t.id === zone.typeId)?.name || zone.typeId;
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
            const areaLabel = zone.isDeduction
              ? (areaM2 != null ? `−${areaM2.toFixed(2)} m²` : "EXCLU")
              : (areaM2 != null ? `${areaM2.toFixed(2)} m²` : null);
            const LW = 82;
            const LH = areaLabel ? 32 : 20;

            return (
              <g key={zone.id} className="group">
                <polygon
                  points={pts}
                  fill={zone.isDeduction ? "url(#hatch-deduction)" : hexToRgba(color, 0.28)}
                  stroke={color}
                  strokeWidth={zone.isDeduction ? 2 : 2}
                  strokeDasharray={zone.isDeduction ? "6 3" : undefined}
                  strokeLinejoin="round"
                />
                {/* Zone label */}
                <g transform={`translate(${centroid.x},${centroid.y})`}>
                  <rect
                    x={-LW / 2} y={-LH / 2}
                    width={LW} height={LH}
                    rx={5} ry={5}
                    fill="rgba(0,0,0,0.62)"
                    stroke={color} strokeWidth={1.2}
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="middle"
                    y={areaLabel ? -7 : 0}
                    fontSize={10.5}
                    fontWeight="600"
                    fill="white"
                    fontFamily="system-ui, sans-serif"
                  >
                    {typeName}
                  </text>
                  {areaLabel && (
                    <text
                      textAnchor="middle"
                      dominantBaseline="middle"
                      y={7}
                      fontSize={9.5}
                      fill={color}
                      fontFamily="ui-monospace, monospace"
                    >
                      {areaLabel}
                    </text>
                  )}
                </g>
                {/* Edge length labels (shown only when scale is set) */}
                {ppm && naturalSize.w > 0 && zone.points.map((p, idx) => {
                  const next = zone.points[(idx + 1) % zone.points.length];
                  const s1 = toSvg(p);
                  const s2 = toSvg(next);
                  const screenLen = Math.hypot(s2.x - s1.x, s2.y - s1.y);
                  if (screenLen < 32) return null; // skip tiny edges
                  const mid = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 };
                  const dxImg = (next.x - p.x) * naturalSize.w;
                  const dyImg = (next.y - p.y) * naturalSize.h;
                  const lenM = Math.sqrt(dxImg * dxImg + dyImg * dyImg) / ppm;
                  const label = lenM >= 1 ? `${lenM.toFixed(2)} m` : `${(lenM * 100).toFixed(0)} cm`;
                  const rawAngle = Math.atan2(s2.y - s1.y, s2.x - s1.x) * 180 / Math.PI;
                  const angle = (rawAngle > 90 || rawAngle <= -90) ? rawAngle + 180 : rawAngle;
                  const rw = label.length * 5 + 10;
                  return (
                    <g key={`len-${idx}`} transform={`translate(${mid.x},${mid.y}) rotate(${angle})`}>
                      <rect x={-rw / 2} y={-7} width={rw} height={13} rx={3} fill="rgba(0,0,0,0.65)" />
                      <text textAnchor="middle" dominantBaseline="middle"
                        fontSize={8.5} fill="white" fontFamily="ui-monospace, monospace">
                        {label}
                      </text>
                    </g>
                  );
                })}
                {/* Edge midpoints — click to insert a new vertex */}
                {zone.points.map((p, idx) => {
                  const next = zone.points[(idx + 1) % zone.points.length];
                  const midNorm = { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 };
                  const mid = toSvg(midNorm);
                  return (
                    <g
                      key={`mid-${idx}`}
                      transform={`translate(${mid.x},${mid.y})`}
                      className="opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                      style={{ pointerEvents: "all", cursor: "copy" }}
                      onClick={e => {
                        e.stopPropagation();
                        e.preventDefault();
                        onHistoryPush?.(zonesRef.current); // snapshot avant insertion
                        skipNextClickRef.current = true;
                        const newPts = [...zone.points];
                        newPts.splice(idx + 1, 0, midNorm);
                        onZonesChange(zones.map(z => z.id !== zone.id ? z : { ...z, points: newPts }));
                      }}
                    >
                      <circle r={9} fill="white" stroke={color} strokeWidth={1.5} opacity={0.85} />
                      <text textAnchor="middle" dominantBaseline="middle" fontSize={13} fontWeight="700"
                        fill={color} style={{ userSelect: "none", pointerEvents: "none" }}>+</text>
                    </g>
                  );
                })}
                {/* Vertex handles — draggable (left) / delete (right-click) */}
                {zone.points.map((p, idx) => {
                  const s = toSvg(p);
                  const isDragging = dragVertex?.zoneId === zone.id && dragVertex?.idx === idx;
                  return (
                    <circle
                      key={idx}
                      cx={s.x} cy={s.y}
                      r={isDragging ? 10 : 7}
                      fill={isDragging ? color : "white"}
                      stroke={color}
                      strokeWidth={2}
                      style={{ pointerEvents: "all", cursor: "move" }}
                      onMouseDown={e => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (e.button === 0) {
                          onHistoryPush?.(zonesRef.current); // snapshot avant drag
                          skipNextClickRef.current = true;
                          setDragVertex({ zoneId: zone.id, idx });
                        }
                      }}
                      onContextMenu={e => {
                        e.stopPropagation();
                        e.preventDefault();
                        onHistoryPush?.(zonesRef.current); // snapshot avant suppression
                        const newPts = zone.points.filter((_, i) => i !== idx);
                        if (newPts.length < 3) {
                          onZonesChange(zones.filter(z => z.id !== zone.id));
                        } else {
                          onZonesChange(zones.map(z => z.id !== zone.id ? z : { ...z, points: newPts }));
                        }
                      }}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* Angle measurements */}
          {angleMeasurements.map(({ id, a, v, b }) => {
            const sA = toSvg(a), sV = toSvg(v), sB = toSvg(b);
            const dA = { x: sA.x - sV.x, y: sA.y - sV.y };
            const dB = { x: sB.x - sV.x, y: sB.y - sV.y };
            const lenA = Math.hypot(dA.x, dA.y), lenB = Math.hypot(dB.x, dB.y);
            if (lenA < 1 || lenB < 1) return null;
            const uA = { x: dA.x / lenA, y: dA.y / lenA };
            const uB = { x: dB.x / lenB, y: dB.y / lenB };
            const dot = Math.max(-1, Math.min(1, uA.x * uB.x + uA.y * uB.y));
            const angleRad = Math.acos(dot);
            const angleDeg = angleRad * 180 / Math.PI;
            const cross = uA.x * uB.y - uA.y * uB.x;
            const arcR = Math.min(32, lenA * 0.35, lenB * 0.35);
            const arcStart = { x: sV.x + uA.x * arcR, y: sV.y + uA.y * arcR };
            const arcEnd   = { x: sV.x + uB.x * arcR, y: sV.y + uB.y * arcR };
            const sweepFlag = cross >= 0 ? 0 : 1;
            const arcPath = `M ${arcStart.x} ${arcStart.y} A ${arcR} ${arcR} 0 0 ${sweepFlag} ${arcEnd.x} ${arcEnd.y}`;
            const bisX = uA.x + uB.x, bisY = uA.y + uB.y;
            const bisLen = Math.hypot(bisX, bisY);
            const labelDist = arcR + 16;
            const lx = bisLen > 0.01 ? sV.x + (bisX / bisLen) * labelDist : sV.x;
            const ly = bisLen > 0.01 ? sV.y + (bisY / bisLen) * labelDist : sV.y - labelDist;
            const label = `${angleDeg.toFixed(1)}°`;
            const lw = label.length * 6 + 10;
            return (
              <g key={id} style={{ pointerEvents: "all" }}
                onContextMenu={e => { e.stopPropagation(); e.preventDefault(); setAngleMeasurements(ms => ms.filter(m => m.id !== id)); }}>
                <line x1={sV.x} y1={sV.y} x2={sA.x} y2={sA.y} stroke="#FBBF24" strokeWidth={1.5} />
                <line x1={sV.x} y1={sV.y} x2={sB.x} y2={sB.y} stroke="#FBBF24" strokeWidth={1.5} />
                <path d={arcPath} fill="none" stroke="#FBBF24" strokeWidth={1.5} />
                <circle cx={sV.x} cy={sV.y} r={3} fill="#FBBF24" />
                <circle cx={sA.x} cy={sA.y} r={3} fill="#FBBF24" />
                <circle cx={sB.x} cy={sB.y} r={3} fill="#FBBF24" />
                <rect x={lx - lw / 2} y={ly - 8} width={lw} height={15} rx={3} fill="rgba(0,0,0,0.75)" />
                <text x={lx} y={ly + 1} textAnchor="middle" dominantBaseline="middle"
                  fontSize={9} fill="#FBBF24" fontFamily="ui-monospace, monospace" fontWeight="700">{label}</text>
              </g>
            );
          })}

          {/* Angle in progress */}
          {tool === "angle" && (
            <>
              {anglePts.length >= 1 && mouseNorm && (
                <line
                  x1={anglePts.length === 1 ? toSvg(anglePts[0]).x : toSvg(anglePts[1]).x}
                  y1={anglePts.length === 1 ? toSvg(anglePts[0]).y : toSvg(anglePts[1]).y}
                  x2={toSvg(mouseNorm).x} y2={toSvg(mouseNorm).y}
                  stroke="#FBBF24" strokeWidth={1.5} strokeDasharray="5 3"
                />
              )}
              {anglePts.length === 2 && mouseNorm && (() => {
                const sV = toSvg(anglePts[1]);
                const sA = toSvg(anglePts[0]);
                const sB = toSvg(mouseNorm);
                const dA = { x: sA.x - sV.x, y: sA.y - sV.y };
                const dB = { x: sB.x - sV.x, y: sB.y - sV.y };
                const lenA = Math.hypot(dA.x, dA.y), lenB = Math.hypot(dB.x, dB.y);
                if (lenA < 1 || lenB < 1) return null;
                const uA = { x: dA.x / lenA, y: dA.y / lenA };
                const uB = { x: dB.x / lenB, y: dB.y / lenB };
                const dot = Math.max(-1, Math.min(1, uA.x * uB.x + uA.y * uB.y));
                const angleRad = Math.acos(dot);
                const cross = uA.x * uB.y - uA.y * uB.x;
                const arcR = Math.min(28, lenA * 0.35, lenB * 0.35);
                const arcStart = { x: sV.x + uA.x * arcR, y: sV.y + uA.y * arcR };
                const arcEnd   = { x: sV.x + uB.x * arcR, y: sV.y + uB.y * arcR };
                const sweepFlag = cross >= 0 ? 0 : 1;
                const arcPath = `M ${arcStart.x} ${arcStart.y} A ${arcR} ${arcR} 0 0 ${sweepFlag} ${arcEnd.x} ${arcEnd.y}`;
                const bisX = uA.x + uB.x, bisY = uA.y + uB.y;
                const bisLen = Math.hypot(bisX, bisY);
                const lx = bisLen > 0.01 ? sV.x + (bisX / bisLen) * (arcR + 16) : sV.x;
                const ly = bisLen > 0.01 ? sV.y + (bisY / bisLen) * (arcR + 16) : sV.y - arcR - 16;
                const label = `${(angleRad * 180 / Math.PI).toFixed(1)}°`;
                const lw = label.length * 6 + 10;
                return (
                  <g>
                    <line x1={sV.x} y1={sV.y} x2={sA.x} y2={sA.y} stroke="#FBBF24" strokeWidth={1.5} />
                    <path d={arcPath} fill="none" stroke="#FBBF24" strokeWidth={1.5} strokeDasharray="4 2" />
                    <rect x={lx - lw / 2} y={ly - 8} width={lw} height={15} rx={3} fill="rgba(0,0,0,0.75)" />
                    <text x={lx} y={ly + 1} textAnchor="middle" dominantBaseline="middle"
                      fontSize={9} fill="#FBBF24" fontFamily="ui-monospace, monospace" fontWeight="700">{label}</text>
                  </g>
                );
              })()}
              {anglePts.map((p, i) => {
                const s = toSvg(p);
                return <circle key={i} cx={s.x} cy={s.y} r={4} fill="#FBBF24" stroke="white" strokeWidth={1.5} />;
              })}
            </>
          )}

          {/* Rectangle preview */}
          {rectPreview && (
            <rect
              x={rectPreview.x} y={rectPreview.y}
              width={rectPreview.w} height={rectPreview.h}
              fill={hexToRgba(activeColor, 0.2)}
              stroke={activeColor} strokeWidth={2} strokeDasharray="6 3"
            />
          )}

          {/* Wall preview — rotated rectangle oriented along drag direction */}
          {wallPreviewPts && (
            <polygon
              points={wallPreviewPts.map(p => `${p.x},${p.y}`).join(" ")}
              fill={hexToRgba(activeColor, 0.25)}
              stroke={activeColor} strokeWidth={2} strokeDasharray="6 3"
              strokeLinejoin="round"
            />
          )}
          {/* Wall start anchor dot */}
          {tool === "wall" && wallStart && (
            <circle
              cx={toSvg(wallStart).x} cy={toSvg(wallStart).y}
              r={5} fill={activeColor} stroke="white" strokeWidth={1.5}
            />
          )}

          {/* VS match rectangles (orange) */}
          {vsMatches.map((m, i) => {
            const tl = toSvg({ x: m.x_norm, y: m.y_norm });
            const br = toSvg({ x: m.x_norm + m.w_norm, y: m.y_norm + m.h_norm });
            const w = br.x - tl.x, h = br.y - tl.y;
            return (
              <g key={`vs-${i}`}>
                <rect x={tl.x} y={tl.y} width={w} height={h}
                  fill="rgba(249,115,22,0.15)" stroke="#F97316" strokeWidth={2} rx={3}
                  style={tool === "visual_search" && vsEditMode === "remove" ? { pointerEvents: "all", cursor: "pointer" } : undefined}
                />
                {ppm && naturalSize.w > 0 && (
                  <text x={tl.x + w / 2} y={tl.y - 4} textAnchor="middle"
                    fontSize={8} fill="#F97316" fontFamily="ui-monospace, monospace">
                    {((m.w_norm * naturalSize.w * m.h_norm * naturalSize.h) / (ppm ** 2)).toFixed(2)} m²
                  </text>
                )}
              </g>
            );
          })}

          {/* Custom detection rectangles (colored) */}
          {customDetections.map(det =>
            det.matches.map((m, i) => {
              const tl = toSvg({ x: m.x_norm, y: m.y_norm });
              const br = toSvg({ x: m.x_norm + m.w_norm, y: m.y_norm + m.h_norm });
              return (
                <rect key={`det-${det.id}-${i}`}
                  x={tl.x} y={tl.y} width={br.x - tl.x} height={br.y - tl.y}
                  fill={hexToRgba(det.color, 0.12)} stroke={det.color} strokeWidth={1.5} rx={2}
                />
              );
            })
          )}

          {/* VS crop selection preview (cyan dashed) */}
          {tool === "visual_search" && vsEditMode === "search" && vsCropStart && mouseNorm && (() => {
            const x0 = Math.min(vsCropStart.x, mouseNorm.x), y0 = Math.min(vsCropStart.y, mouseNorm.y);
            const x1 = Math.max(vsCropStart.x, mouseNorm.x), y1 = Math.max(vsCropStart.y, mouseNorm.y);
            const s0 = toSvg({ x: x0, y: y0 }), s1 = toSvg({ x: x1, y: y1 });
            return (
              <rect x={s0.x} y={s0.y} width={s1.x - s0.x} height={s1.y - s0.y}
                fill="rgba(6,182,212,0.1)" stroke="#06B6D4" strokeWidth={2} strokeDasharray="6 3" rx={3}
              />
            );
          })()}

          {/* Split tool preview line */}
          {tool === "split" && splitPts.length === 1 && (
            <>
              {mouseNorm && (
                <line
                  x1={toSvg(splitPts[0]).x} y1={toSvg(splitPts[0]).y}
                  x2={toSvg(mouseNorm).x} y2={toSvg(mouseNorm).y}
                  stroke="#EF4444" strokeWidth={2} strokeDasharray="8 4"
                />
              )}
              <circle
                cx={toSvg(splitPts[0]).x} cy={toSvg(splitPts[0]).y}
                r={5} fill="#EF4444" stroke="white" strokeWidth={1.5}
              />
              {mouseNorm && (
                <circle
                  cx={toSvg(mouseNorm).x} cy={toSvg(mouseNorm).y}
                  r={4} fill="white" stroke="#EF4444" strokeWidth={1.5}
                />
              )}
            </>
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
                  x2={toSvg(mouseNorm).x}        y2={toSvg(mouseNorm).y}
                  stroke={activeColor} strokeWidth={2} strokeDasharray="6 3"
                />
              )}
              {/* Control points */}
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

          {/* Empty state hint */}
          {zones.length === 0 && !isDrawing && (
            <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle"
              fill="rgba(148,163,184,0.6)" fontSize={14} fontFamily="system-ui">
              ✛ Sélectionnez un type et commencez à dessiner
            </text>
          )}
        </svg>

        {/* Controls hint */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="glass border border-white/10 rounded-xl px-3 py-1.5 text-xs text-slate-500 whitespace-nowrap">
            Scroll — zoom &nbsp;·&nbsp; Clic droit glisser — déplacer
          </div>
        </div>
      </div>

      {/* ── Zones list ── */}
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
              <div key={zone.id} className="glass border border-white/5 rounded-lg px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${zone.isDeduction ? "ring-1 ring-red-400" : ""}`}
                    style={{ background: zone.isDeduction ? "#EF4444" : (type?.color ?? "#6B7280") }} />
                  <input
                    value={zone.name ?? ""}
                    onChange={e => {
                      const name = e.target.value;
                      onZonesChange(zones.map(z => z.id === zone.id ? { ...z, name: name || undefined } : z));
                    }}
                    placeholder={`${zone.isDeduction ? "Déduction" : (type?.name ?? zone.typeId)} #${i + 1}`}
                    className="flex-1 min-w-0 bg-transparent text-slate-300 placeholder-slate-600 focus:outline-none focus:text-white text-xs"
                  />
                  <span className={`font-mono shrink-0 ${zone.isDeduction ? "text-red-400" : "text-slate-300"}`}>
                    {zone.isDeduction ? "−" : ""}{areaM2 != null ? `${areaM2.toFixed(2)} m²` : `${Math.round(areaPx).toLocaleString()} px²`}
                  </span>
                  <button onClick={() => deleteZone(zone.id)}
                    className="text-slate-600 hover:text-red-400 transition-colors ml-1 shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <input
                  value={zone.note ?? ""}
                  onChange={e => {
                    const note = e.target.value;
                    onZonesChange(zones.map(z => z.id === zone.id ? { ...z, note: note || undefined } : z));
                  }}
                  placeholder="Note… (ex: attention dénivelé)"
                  className="mt-1 w-full bg-transparent text-slate-500 placeholder-slate-700 focus:outline-none focus:text-slate-300 text-[10px] italic"
                />
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
