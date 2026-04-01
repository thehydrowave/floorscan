"use client";

import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { Trash2, Undo2, Redo2, Pentagon, Square, ZoomIn, ZoomOut, RotateCcw, Spline, MinusSquare, Ruler, Scissors, Search, Save, Loader2, MousePointer2, Copy, Type, Download } from "lucide-react";
import { SurfaceType, MeasureZone, pointInPolygon, splitPolygonByLine, LinearCategory, LinearMeasure, CountGroup, CountPoint, AngleMeasurement, CircleMeasure, circleMetrics, DisplayUnit, fmtLinear, fmtArea, fmtVolume, slopeCorrectedArea, zoneVolumeM3, TextAnnotation } from "@/lib/measure-types";
import type { VisualSearchMatch, CustomDetection } from "@/lib/types";

import { BACKEND } from "@/lib/backend";

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
  onPpmChange?: (ppm: number) => void;
  // Linear tool props
  linearMeasures?: LinearMeasure[];
  onLinearMeasuresChange?: (measures: LinearMeasure[]) => void;
  linearCategories?: LinearCategory[];
  activeLinearCategoryId?: string;
  // Count tool props
  countPoints?: CountPoint[];
  onCountPointsChange?: (pts: CountPoint[]) => void;
  countGroups?: CountGroup[];
  activeCountGroupId?: string;
  // Selection props (lifted to parent)
  selectedZoneId?: string | null;
  onSelectedZoneIdChange?: (id: string | null) => void;
  selectedLinearId?: string | null;
  onSelectedLinearIdChange?: (id: string | null) => void;
  // Angle tool (lifted state)
  angleMeasurements?: AngleMeasurement[];
  onAngleMeasurementsChange?: (angles: AngleMeasurement[]) => void;
  // Circle tool
  circleMeasures?: CircleMeasure[];
  onCircleMeasuresChange?: (circles: CircleMeasure[]) => void;
  // Display unit
  displayUnit?: DisplayUnit;
  // Text annotations
  textAnnotations?: TextAnnotation[];
  onTextAnnotationsChange?: (annotations: TextAnnotation[]) => void;
  // Export callback
  onExportPNG?: () => void;
}

type Tool = "select" | "polygon" | "rect" | "angle" | "wall" | "split" | "visual_search" | "scale" | "linear" | "count" | "circle" | "text";

const CLOSE_RADIUS = 18; // px screen-space — generous hit area for closing polygon

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
  onPpmChange,
  linearMeasures = [], onLinearMeasuresChange, linearCategories = [], activeLinearCategoryId = "",
  countPoints = [], onCountPointsChange, countGroups = [], activeCountGroupId = "",
  selectedZoneId = null, onSelectedZoneIdChange, selectedLinearId = null, onSelectedLinearIdChange,
  angleMeasurements = [], onAngleMeasurementsChange,
  circleMeasures = [], onCircleMeasuresChange,
  displayUnit = "m" as DisplayUnit,
  textAnnotations = [], onTextAnnotationsChange,
  onExportPNG,
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

  // Scale calibration tool state
  const [scalePts, setScalePts] = useState<{ x: number; y: number }[]>([]);
  const [scaleInputOpen, setScaleInputOpen] = useState(false);
  const [scaleRealDist, setScaleRealDist] = useState("1");

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
  // angleMeasurements now comes from props (lifted to parent)

  // Circle tool in-progress state
  const [circleCenter, setCircleCenter] = useState<{ x: number; y: number } | null>(null);

  // Text annotation in-progress state
  const [textInputPos, setTextInputPos] = useState<{ x: number; y: number } | null>(null);
  const [textInputValue, setTextInputValue] = useState("");

  // Split tool state
  const [splitPts, setSplitPts] = useState<{ x: number; y: number }[]>([]);

  // Linear tool in-progress points
  const [linearDrawingPts, setLinearDrawingPts] = useState<{ x: number; y: number }[]>([]);
  const linearDrawingPtsRef = useRef<{ x: number; y: number }[]>([]);

  // Select tool — zone drag (whole zone move)
  const dragZoneRef = useRef<{ zoneId: string; startNorm: { x: number; y: number }; originalPoints: { x: number; y: number }[] } | null>(null);
  // Select tool — linear vertex drag
  const dragLinearVertexRef = useRef<{ measureId: string; idx: number } | null>(null);
  // Select tool — count point drag
  const dragCountPointRef = useRef<{ pointId: string } | null>(null);
  // Spacebar temporary pan
  const [spacebarPan, setSpacebarPan] = useState(false);
  const spacebarPanRef = useRef(false);
  // Refs for select tool callbacks
  const onSelectedZoneIdChangeRef = useRef(onSelectedZoneIdChange);
  const onSelectedLinearIdChangeRef = useRef(onSelectedLinearIdChange);
  const linearMeasuresRef = useRef(linearMeasures);
  const countPointsRef = useRef(countPoints);
  const onLinearMeasuresChangeRef = useRef(onLinearMeasuresChange);
  const onCountPointsChangeRef = useRef(onCountPointsChange);
  const circleMeasuresRef = useRef(circleMeasures);
  const onCircleMeasuresChangeRef = useRef(onCircleMeasuresChange);

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
  useEffect(() => { onSelectedZoneIdChangeRef.current = onSelectedZoneIdChange; }, [onSelectedZoneIdChange]);
  useEffect(() => { onSelectedLinearIdChangeRef.current = onSelectedLinearIdChange; }, [onSelectedLinearIdChange]);
  useEffect(() => { linearMeasuresRef.current = linearMeasures; }, [linearMeasures]);
  useEffect(() => { countPointsRef.current = countPoints; }, [countPoints]);
  useEffect(() => { onLinearMeasuresChangeRef.current = onLinearMeasuresChange; }, [onLinearMeasuresChange]);
  useEffect(() => { onCountPointsChangeRef.current = onCountPointsChange; }, [onCountPointsChange]);
  useEffect(() => { circleMeasuresRef.current = circleMeasures; }, [circleMeasures]);
  useEffect(() => { onCircleMeasuresChangeRef.current = onCircleMeasuresChange; }, [onCircleMeasuresChange]);

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

  // ── Global pan (right-click drag) + vertex drag + zone drag + linear/count drag ──
  useEffect(() => {
    const getNorm = (e: MouseEvent) => {
      const img = imgRef.current;
      if (!img) return null;
      const r = img.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
        y: Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height)),
      };
    };
    const onMove = (e: MouseEvent) => {
      if (isPanRef.current) {
        const dx = e.clientX - panStartRef.current.mx;
        const dy = e.clientY - panStartRef.current.my;
        setTranslate({ x: panStartRef.current.tx + dx, y: panStartRef.current.ty + dy });
        return;
      }
      if (dragVertexRef.current) {
        const n = getNorm(e);
        if (!n) return;
        const { zoneId, idx } = dragVertexRef.current;
        onZonesChangeRef.current(zonesRef.current.map(z =>
          z.id !== zoneId ? z :
          { ...z, points: z.points.map((p, i) => i === idx ? { x: n.x, y: n.y } : p) }
        ));
        return;
      }
      // Zone whole drag
      if (dragZoneRef.current) {
        const n = getNorm(e);
        if (!n) return;
        const { zoneId, startNorm, originalPoints } = dragZoneRef.current;
        const dx = n.x - startNorm.x;
        const dy = n.y - startNorm.y;
        onZonesChangeRef.current(zonesRef.current.map(z =>
          z.id !== zoneId ? z :
          { ...z, points: originalPoints.map(p => ({ x: p.x + dx, y: p.y + dy })) }
        ));
        return;
      }
      // Linear vertex drag
      if (dragLinearVertexRef.current) {
        const n = getNorm(e);
        if (!n) return;
        const { measureId, idx } = dragLinearVertexRef.current;
        onLinearMeasuresChangeRef.current?.(linearMeasuresRef.current.map(m =>
          m.id !== measureId ? m :
          { ...m, points: m.points.map((p, i) => i === idx ? { x: n.x, y: n.y } : p) }
        ));
        return;
      }
      // Count point drag
      if (dragCountPointRef.current) {
        const n = getNorm(e);
        if (!n) return;
        const { pointId } = dragCountPointRef.current;
        onCountPointsChangeRef.current?.(countPointsRef.current.map(p =>
          p.id !== pointId ? p : { ...p, x: n.x, y: n.y }
        ));
        return;
      }
    };
    const onUp = (e: MouseEvent) => {
      if (e.button === 2) {
        isPanRef.current = false;
        setPanCursor(false);
        return;
      }
      if (e.button === 0) {
        if (dragVertexRef.current) { dragVertexRef.current = null; setDragVertex(null); }
        if (dragZoneRef.current) { dragZoneRef.current = null; }
        if (dragLinearVertexRef.current) { dragLinearVertexRef.current = null; }
        if (dragCountPointRef.current) { dragCountPointRef.current = null; }
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

  // Visual indicator: is the cursor hovering the first point close-zone?
  const isNearFirst = useMemo(() => {
    if (tool !== "polygon" || drawingPoints.length < 3 || !mouseNorm) return false;
    const fs = toSvg(drawingPoints[0]);
    const ms = toSvg(mouseNorm);
    return Math.hypot(ms.x - fs.x, ms.y - fs.y) < CLOSE_RADIUS;
  }, [tool, drawingPoints, mouseNorm, toSvg]);

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
    drawingPointsRef.current = [];  // sync reset so dblclick handler sees [] immediately
    setDrawingPoints([]);
  }, [zones, activeTypeId, onZonesChange, onHistoryPush]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragVertexRef.current || dragZoneRef.current || dragLinearVertexRef.current || dragCountPointRef.current) return;
    let n = toNorm(e.clientX, e.clientY);
    if (n && e.shiftKey && tool === "polygon" && drawingPoints.length > 0 && naturalSize.w > 0) {
      n = snapTo45(drawingPoints[drawingPoints.length - 1], n, naturalSize.w, naturalSize.h);
    }
    setMouseNorm(n);
  }, [toNorm, tool, drawingPoints, naturalSize]);

  const handleMouseLeave = () => setMouseNorm(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Right-click OR spacebar-held left-click → pan
    if (e.button === 2 || (e.button === 0 && spacebarPanRef.current)) {
      e.preventDefault();
      isPanRef.current = true;
      panStartRef.current = {
        mx: e.clientX, my: e.clientY,
        tx: translateRef.current.x, ty: translateRef.current.y,
      };
      setPanCursor(true);
      return;
    }
    // Select tool: drag whole zone or drag linear vertex
    if (tool === "select" && e.button === 0) {
      const n = toNorm(e.clientX, e.clientY);
      if (!n) return;
      // If a zone is selected and click is inside it → start zone drag
      if (selectedZoneId) {
        const zone = zonesRef.current.find(z => z.id === selectedZoneId);
        if (zone && pointInPolygon(n, zone.points)) {
          onHistoryPush?.(zonesRef.current);
          dragZoneRef.current = { zoneId: selectedZoneId, startNorm: n, originalPoints: zone.points.map(p => ({ ...p })) };
          skipNextClickRef.current = true;
          return;
        }
      }
      // If a linear is selected, check if clicking on one of its vertices
      if (selectedLinearId) {
        const lm = linearMeasuresRef.current.find(m => m.id === selectedLinearId);
        if (lm) {
          for (let i = 0; i < lm.points.length; i++) {
            const d = Math.hypot(n.x - lm.points[i].x, n.y - lm.points[i].y);
            if (d < 0.015) {
              dragLinearVertexRef.current = { measureId: selectedLinearId, idx: i };
              skipNextClickRef.current = true;
              return;
            }
          }
        }
      }
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
  }, [tool, toNorm, vsEditMode, selectedZoneId, selectedLinearId, onHistoryPush]);

  /** Find the nearest linear measure to a normalized point (returns measure id or null) */
  const findNearestLinear = useCallback((pt: { x: number; y: number }, threshold = 0.015): string | null => {
    let bestId: string | null = null;
    let bestDist = threshold;
    for (const lm of linearMeasures) {
      for (let i = 0; i < lm.points.length - 1; i++) {
        const a = lm.points[i], b = lm.points[i + 1];
        const abx = b.x - a.x, aby = b.y - a.y;
        const apx = pt.x - a.x, apy = pt.y - a.y;
        const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby || 1)));
        const dx = a.x + t * abx - pt.x, dy = a.y + t * aby - pt.y;
        const d = Math.hypot(dx, dy);
        if (d < bestDist) { bestDist = d; bestId = lm.id; }
      }
    }
    return bestId;
  }, [linearMeasures]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (skipNextClickRef.current) { skipNextClickRef.current = false; return; }
    if (e.button !== 0) return;
    const raw = toNorm(e.clientX, e.clientY);
    if (!raw) return;
    // Use already-snapped mouseNorm if shift is held while drawing
    const pt: { x: number; y: number } =
      (tool === "polygon" && e.shiftKey && mouseNorm && drawingPoints.length > 0) ? mouseNorm : raw;
    if (tool === "select") {
      // Hit test: find zone under cursor (reverse for topmost)
      const hitZone = [...zones].reverse().find(z => pointInPolygon(pt, z.points));
      if (hitZone) {
        onSelectedZoneIdChange?.(hitZone.id);
        onSelectedLinearIdChange?.(null);
        return;
      }
      // Check linear measures
      const hitLinearId = findNearestLinear(pt);
      if (hitLinearId) {
        onSelectedLinearIdChange?.(hitLinearId);
        onSelectedZoneIdChange?.(null);
        return;
      }
      // Click on empty → deselect
      onSelectedZoneIdChange?.(null);
      onSelectedLinearIdChange?.(null);
      return;
    }
    if (tool === "polygon") {
      // Skip the 2nd+ click in a double-click sequence (detail≥2) — they're handled by dblclick
      if (e.detail >= 2) return;
      if (nearFirst(e.clientX, e.clientY)) { addZone(drawingPoints); return; }
      setDrawingPoints(prev => {
        const next = [...prev, pt];
        drawingPointsRef.current = next; // sync ref so dblclick handler reads the latest value
        return next;
      });
    } else if (tool === "angle") {
      if (anglePts.length < 2) {
        setAnglePts(prev => [...prev, pt]);
      } else {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
        onAngleMeasurementsChange?.([...angleMeasurements, { id, a: anglePts[0], v: anglePts[1], b: pt }]);
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
    } else if (tool === "scale") {
      if (scaleInputOpen) return; // already waiting for input
      const next = [...scalePts, pt];
      setScalePts(next);
      if (next.length === 2) setScaleInputOpen(true);
    } else if (tool === "linear") {
      // linear: click adds points, double-click finishes (handled in dblclick)
      if (e.detail >= 2) return; // handled by dblclick
      const next = [...linearDrawingPts, pt];
      linearDrawingPtsRef.current = next;
      setLinearDrawingPts(next);
    } else if (tool === "count" && activeCountGroupId) {
      // count: click places a dot
      if (onCountPointsChange) {
        const newPt: CountPoint = {
          id: crypto.randomUUID(),
          groupId: activeCountGroupId,
          x: pt.x,
          y: pt.y,
        };
        onCountPointsChange([...countPoints, newPt]);
      }
    } else if (tool === "circle") {
      if (!circleCenter) {
        setCircleCenter(pt);
      } else {
        if (onCircleMeasuresChange) {
          const newCircle: CircleMeasure = {
            id: crypto.randomUUID(),
            categoryId: activeLinearCategoryId,
            center: circleCenter,
            edgePoint: pt,
          };
          onCircleMeasuresChange([...circleMeasures, newCircle]);
        }
        setCircleCenter(null);
      }
    } else if (tool === "text") {
      // Place text input at click position
      setTextInputPos(pt);
      setTextInputValue("");
    }
  }, [tool, toNorm, nearFirst, drawingPoints, addZone, anglePts, splitPts, onHistoryPush, vsEditMode, vsMatches, onVsMatchesChange, scalePts, scaleInputOpen, linearDrawingPts, activeCountGroupId, countPoints, onCountPointsChange, zones, findNearestLinear, onSelectedZoneIdChange, onSelectedLinearIdChange, circleCenter, circleMeasures, onCircleMeasuresChange, activeLinearCategoryId, angleMeasurements, onAngleMeasurementsChange]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (tool === "polygon") {
      e.preventDefault();
      const latest = drawingPointsRef.current;
      if (latest.length < 3) return;
      addZone(latest.slice(0, -1));
    } else if (tool === "linear") {
      e.preventDefault();
      // The detail=1 click added the last point → remove it (dblclick fires after 2 click events)
      const latest = linearDrawingPtsRef.current.slice(0, -1);
      if (latest.length < 2 || !onLinearMeasuresChange || !activeLinearCategoryId) return;
      const newMeasure: LinearMeasure = {
        id: crypto.randomUUID(),
        categoryId: activeLinearCategoryId,
        points: latest,
      };
      onLinearMeasuresChange([...linearMeasures, newMeasure]);
      linearDrawingPtsRef.current = [];
      setLinearDrawingPts([]);
    }
  }, [tool, addZone, linearDrawingPts, linearMeasures, onLinearMeasuresChange, activeLinearCategoryId]);

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

  const cancelDrawing = useCallback(() => { drawingPointsRef.current = []; setDrawingPoints([]); setRectStart(null); setWallStart(null); setAnglePts([]); setSplitPts([]); setVsCropStart(null); setScalePts([]); setScaleInputOpen(false); linearDrawingPtsRef.current = []; setLinearDrawingPts([]); setCircleCenter(null); setTextInputPos(null); setTextInputValue(""); }, []);
  const resetView     = useCallback(() => { setZoom(1); setTranslate({ x: 0, y: 0 }); }, []);

  // Track if nudge sequence is active (to only push history once)
  const nudgeActiveRef = useRef(false);

  useEffect(() => {
    const isInInput = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable;
    };
    const isDrawingActive = () =>
      drawingPointsRef.current.length > 0 || linearDrawingPtsRef.current.length > 0;

    const onKey = (e: KeyboardEvent) => {
      if (isInInput(e)) return;

      // ── Escape → cancel drawing + deselect ──
      if (e.key === "Escape") {
        cancelDrawing();
        onSelectedZoneIdChange?.(null);
        onSelectedLinearIdChange?.(null);
        return;
      }

      // ── Enter → close polygon / finish linear ──
      if (e.key === "Enter" && tool === "polygon") {
        e.preventDefault();
        const latest = drawingPointsRef.current;
        if (latest.length >= 3) addZone(latest);
        return;
      }
      if (e.key === "Enter" && tool === "linear") {
        e.preventDefault();
        const latest = linearDrawingPtsRef.current;
        if (latest.length >= 2 && onLinearMeasuresChange && activeLinearCategoryId) {
          const newMeasure: LinearMeasure = { id: crypto.randomUUID(), categoryId: activeLinearCategoryId, points: latest };
          onLinearMeasuresChange([...linearMeasures, newMeasure]);
          linearDrawingPtsRef.current = [];
          setLinearDrawingPts([]);
        }
        return;
      }

      // ── Undo/Redo ──
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (drawingPoints.length > 0) {
          setDrawingPoints(p => { const next = p.slice(0, -1); drawingPointsRef.current = next; return next; });
          return;
        }
        if (anglePts.length > 0) { setAnglePts(p => p.slice(0, -1)); return; }
        onHistoryUndo?.();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        onHistoryRedo?.();
        return;
      }

      // ── Duplicate selected zone (Ctrl+D) ──
      if ((e.ctrlKey || e.metaKey) && e.key === "d" && selectedZoneId) {
        e.preventDefault();
        const zone = zonesRef.current.find(z => z.id === selectedZoneId);
        if (zone) {
          onHistoryPush?.(zonesRef.current);
          const dup: MeasureZone = {
            ...zone,
            id: crypto.randomUUID(),
            name: zone.name ? `${zone.name} (copie)` : undefined,
            points: zone.points.map(p => ({ x: p.x + 0.02, y: p.y + 0.02 })),
          };
          onZonesChangeRef.current([...zonesRef.current, dup]);
          onSelectedZoneIdChange?.(dup.id);
        }
        return;
      }

      // ── Delete selected (Delete / Backspace) ──
      if ((e.key === "Delete" || e.key === "Backspace") && selectedZoneId) {
        e.preventDefault();
        onHistoryPush?.(zonesRef.current);
        onZonesChangeRef.current(zonesRef.current.filter(z => z.id !== selectedZoneId));
        onSelectedZoneIdChange?.(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedLinearId) {
        e.preventDefault();
        onLinearMeasuresChangeRef.current?.(linearMeasuresRef.current.filter(m => m.id !== selectedLinearId));
        onSelectedLinearIdChange?.(null);
        return;
      }

      // ── Arrow key nudge selected zone ──
      if (selectedZoneId && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        if (!nudgeActiveRef.current) { onHistoryPush?.(zonesRef.current); nudgeActiveRef.current = true; }
        const step = e.shiftKey ? 0.01 : 0.002;
        const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
        const dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
        onZonesChangeRef.current(zonesRef.current.map(z =>
          z.id !== selectedZoneId ? z :
          { ...z, points: z.points.map(p => ({ x: p.x + dx, y: p.y + dy })) }
        ));
        return;
      }

      // ── Spacebar → temporary pan ──
      if (e.key === " " && !spacebarPanRef.current) {
        e.preventDefault();
        spacebarPanRef.current = true;
        setSpacebarPan(true);
        return;
      }

      // ── Tool switching shortcuts (only when not drawing) ──
      if (!isDrawingActive() && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const switchTool = (t: Tool) => { setTool(t); cancelDrawing(); };
        switch (e.key.toLowerCase()) {
          case "q": switchTool("select"); break;
          case "p": switchTool("polygon"); break;
          case "r": switchTool("rect"); break;
          case "l": switchTool("linear"); break;
          case "c": switchTool("count"); break;
          case "a": switchTool("angle"); break;
          case "w": switchTool("wall"); break;
          case "s": switchTool("split"); break;
          case "v": switchTool("visual_search"); break;
          case "m": switchTool("scale"); break;
          case "o": switchTool("circle"); break;
          case "t": switchTool("text"); break;
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") { spacebarPanRef.current = false; setSpacebarPan(false); }
      // End nudge sequence
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) { nudgeActiveRef.current = false; }
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); };
  }, [cancelDrawing, drawingPoints, anglePts, onHistoryUndo, onHistoryRedo, tool, addZone, selectedZoneId, selectedLinearId, onHistoryPush, onSelectedZoneIdChange, onSelectedLinearIdChange, linearMeasures, activeLinearCategoryId, onLinearMeasuresChange]);

  const deleteZone = (id: string) => {
    onHistoryPush?.(zonesRef.current);
    onZonesChange(zones.filter(z => z.id !== id));
  };

  const confirmScale = useCallback(() => {
    if (scalePts.length < 2) return;
    const realM = parseFloat(scaleRealDist);
    if (!realM || realM <= 0) return;
    const dx = (scalePts[1].x - scalePts[0].x) * naturalSize.w;
    const dy = (scalePts[1].y - scalePts[0].y) * naturalSize.h;
    const pixelLen = Math.sqrt(dx * dx + dy * dy);
    if (pixelLen < 1) return;
    onPpmChange?.(pixelLen / realM);
    setScalePts([]);
    setScaleInputOpen(false);
    setTool("polygon");
  }, [scalePts, scaleRealDist, naturalSize, onPpmChange]);
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

  const isDrawing   = drawingPoints.length > 0 || rectStart !== null || wallStart !== null || splitPts.length > 0 || vsCropStart !== null || scalePts.length > 0 || linearDrawingPts.length > 0 || circleCenter !== null;
  const activeColor = getColor(activeTypeId);

  const hint = dragZoneRef.current ? "Glissez pour repositionner la zone · relâchez pour valider"
    : dragVertex ? "Glissez pour repositionner le sommet · relâchez pour valider"
    : spacebarPan ? "Relâchez Espace pour revenir à l'outil"
    : tool === "select"
    ? selectedZoneId
      ? "Zone sélectionnée · Glissez pour déplacer · Ctrl+D dupliquer · Flèches ajuster · Suppr supprimer"
      : selectedLinearId
      ? "Linéaire sélectionné · Glissez un vertex pour éditer · Suppr supprimer"
      : "Cliquez une zone ou un linéaire pour sélectionner"
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
      : isNearFirst ? "✓ Cliquez pour fermer le polygone"
      : "Double-clic · Entrée · ou cliquez le 1er point ● pour fermer · Maj = snap 45°"
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
    : tool === "scale"
    ? scalePts.length === 0 ? "Cliquez un 1er point du segment de référence"
    : scalePts.length === 1 ? "Cliquez le 2e point du segment, puis entrez la longueur réelle"
    : "Entrez la longueur réelle ci-dessous et confirmez"
    : tool === "linear"
    ? linearDrawingPts.length === 0
      ? "Cliquez pour démarrer une mesure linéaire"
      : linearDrawingPts.length === 1
        ? "Cliquez pour ajouter des points · Entrée ou double-clic pour terminer"
        : `${linearDrawingPts.length} pts · Entrée ou double-clic pour terminer · Échap pour annuler`
    : tool === "count"
    ? `Cliquez pour placer un point de comptage${activeCountGroupId ? "" : " — sélectionnez un groupe d'abord"}`
    : tool === "circle"
    ? !circleCenter
      ? "Cliquez pour placer le centre du cercle"
      : "Cliquez pour définir le rayon · Échap pour annuler"
    : tool === "text"
    ? textInputPos
      ? "Tapez votre texte · Entrée pour valider · Échap pour annuler"
      : "Cliquez pour placer une annotation texte"
    : "Cliquez et glissez pour dessiner un rectangle";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap">

        {/* Tool selector */}
        <div className="flex gap-1 glass border border-white/10 rounded-xl p-1">
          <button
            onClick={() => { setTool("select"); cancelDrawing(); }}
            title="Sélection (Q)"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tool === "select" ? "bg-violet-500/20 border border-violet-500/40 text-violet-300" : "text-slate-400 hover:text-white"
            }`}
          >
            <MousePointer2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { setTool("polygon"); cancelDrawing(); }}
            title="Polygone (P)"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tool === "polygon" ? "bg-accent text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            <Pentagon className="w-3.5 h-3.5" /> Polygone
          </button>
          <button
            onClick={() => { setTool("rect"); cancelDrawing(); }}
            title="Rectangle (R)"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tool === "rect" ? "bg-accent text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            <Square className="w-3.5 h-3.5" /> Rectangle
          </button>
          <button
            onClick={() => { setTool("angle"); cancelDrawing(); }}
            title="Angle (A)"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tool === "angle" ? "bg-amber-500 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            <Spline className="w-3.5 h-3.5" /> Angle
          </button>
          <button
            onClick={() => { setTool("wall"); cancelDrawing(); }}
            title="Mur (W)"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tool === "wall"
                ? "bg-orange-500/20 border border-orange-500/40 text-orange-300"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Ruler className="w-3.5 h-3.5" /> Mur
          </button>
          {onPpmChange && (
            <button
              onClick={() => { setTool("scale"); setScalePts([]); setScaleInputOpen(false); cancelDrawing(); }}
              title={ppm ? `Échelle (M) — Recalibrer (actuelle : ${ppm.toFixed(1)} px/m)` : "Échelle (M) — Calibrer pour afficher les m²"}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tool === "scale"
                  ? "bg-yellow-500/20 border border-yellow-500/40 text-yellow-300"
                  : !ppm
                  ? "text-yellow-400 hover:text-yellow-300"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Ruler className="w-3.5 h-3.5" /> Échelle
            </button>
          )}
          <button
            onClick={() => { setTool("split"); cancelDrawing(); }}
            title="Découper (S)"
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
            title="Recherche visuelle (V)"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tool === "visual_search"
                ? "bg-cyan-500/20 border border-cyan-500/40 text-cyan-300"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Search className="w-3.5 h-3.5" /> Recherche
          </button>
          {onLinearMeasuresChange && (
            <button
              onClick={() => { setTool("linear"); cancelDrawing(); }}
              title="Linéaire (L)"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tool === "linear"
                  ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-300"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Ruler className="w-3.5 h-3.5" /> Linéaire
            </button>
          )}
          {onCountPointsChange && (
            <button
              onClick={() => { setTool("count"); cancelDrawing(); }}
              title="Comptage (C)"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tool === "count"
                  ? "bg-pink-500/20 border border-pink-500/40 text-pink-300"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span className="font-bold text-xs">#</span> Comptage
            </button>
          )}
          {onCircleMeasuresChange && (
            <button
              onClick={() => { setTool("circle"); cancelDrawing(); }}
              title="Cercle (O)"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tool === "circle"
                  ? "bg-teal-500/20 border border-teal-500/40 text-teal-300"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span className="w-3 h-3 rounded-full border-2 border-current inline-block" /> Cercle
            </button>
          )}
          {onTextAnnotationsChange && (
            <button
              onClick={() => { setTool("text"); cancelDrawing(); }}
              title="Texte (T)"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tool === "text"
                  ? "bg-sky-500/20 border border-sky-500/40 text-sky-300"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Type className="w-3.5 h-3.5" /> Texte
            </button>
          )}
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

        {/* Export PNG */}
        {onExportPNG && zones.length > 0 && (
          <button onClick={onExportPNG} title="Exporter image annotée (PNG)"
            className="glass border border-white/10 rounded-lg p-2 text-slate-400 hover:text-cyan-400 transition-colors ml-auto">
            <Download className="w-4 h-4" />
          </button>
        )}

        {/* Zoom controls */}
        <div className={`flex gap-1 ${!onExportPNG || zones.length === 0 ? "ml-auto" : ""}`}>
          <button onClick={() => setZoom(prevZ => {
            const newZ = Math.min(12, prevZ * 1.3);
            const ratio = newZ / prevZ;
            // Adjust translate so zoom feels centered on the current view, not image origin
            setTranslate(t => ({ x: t.x * ratio, y: t.y * ratio }));
            return newZ;
          })} title="Zoom + (molette aussi)"
            className="glass border border-white/10 rounded-lg p-2 text-slate-400 hover:text-white transition-colors">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button onClick={() => setZoom(prevZ => {
            const newZ = Math.max(1, prevZ / 1.3);
            const ratio = newZ / prevZ;
            setTranslate(t => ({ x: t.x * ratio, y: t.y * ratio }));
            return newZ;
          })} title="Zoom -"
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

        {/* Unit selector */}
        <div className="flex items-center glass border border-white/10 rounded-lg px-2 py-1">
          <span className="text-[10px] text-slate-500 mr-1.5">Unité</span>
          <select
            value={displayUnit}
            onChange={() => {/* controlled by parent via prop */}}
            className="bg-transparent text-xs text-slate-300 font-mono outline-none cursor-default"
            disabled
            title="Unité d'affichage (configurable dans les options)"
          >
            <option value={displayUnit}>{displayUnit}</option>
          </select>
        </div>

      </div>

      {/* Hint */}
      <span className="text-xs text-slate-500 italic -mt-1">{hint}</span>

      {/* ── Canvas ── */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-white select-none"
        style={{ height: "calc(100vh - 220px)", minHeight: 400, cursor: dragZoneRef.current ? "move" : dragVertex ? "move" : panCursor ? "grabbing" : spacebarPan ? "grab" : isNearFirst ? "pointer" : tool === "select" ? "default" : "crosshair" }}
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
              ? (areaM2 != null ? `−${fmtArea(areaM2, displayUnit)}` : "EXCLU")
              : (areaM2 != null ? fmtArea(areaM2, displayUnit) : null);
            const LW = 82;
            const LH = areaLabel ? 32 : 20;

            return (
              <g key={zone.id} className="group">
                <polygon
                  points={pts}
                  fill={zone.isDeduction ? "url(#hatch-deduction)" : hexToRgba(color, selectedZoneId === zone.id ? 0.38 : 0.28)}
                  stroke={color}
                  strokeWidth={selectedZoneId === zone.id ? 3 : 2}
                  strokeDasharray={zone.isDeduction ? "6 3" : selectedZoneId === zone.id ? "8 4" : undefined}
                  strokeLinejoin="round"
                  style={{
                    ...(selectedZoneId === zone.id ? { filter: `drop-shadow(0 0 6px ${color})`, cursor: "move" } : {}),
                    ...(tool === "select" ? { pointerEvents: "all" as const, ...(selectedZoneId !== zone.id ? { cursor: "pointer" } : {}) } : {}),
                  }}
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
                {/* Edge dimension lines — architectural style (shown only when scale is set) */}
                {ppm && naturalSize.w > 0 && zone.points.map((p, idx) => {
                  const next = zone.points[(idx + 1) % zone.points.length];
                  const s1 = toSvg(p);
                  const s2 = toSvg(next);
                  const screenLen = Math.hypot(s2.x - s1.x, s2.y - s1.y);
                  if (screenLen < 40) return null;
                  const mid = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 };
                  const dxImg = (next.x - p.x) * naturalSize.w;
                  const dyImg = (next.y - p.y) * naturalSize.h;
                  const lenM = Math.sqrt(dxImg * dxImg + dyImg * dyImg) / ppm;
                  const label = fmtLinear(lenM, displayUnit);
                  const rawAngle = Math.atan2(s2.y - s1.y, s2.x - s1.x) * 180 / Math.PI;
                  const angle = (rawAngle > 90 || rawAngle <= -90) ? rawAngle + 180 : rawAngle;
                  const rw = label.length * 6 + 14;
                  // Perpendicular offset for dimension line
                  const perpX = -(s2.y - s1.y) / screenLen;
                  const perpY = (s2.x - s1.x) / screenLen;
                  const off = 14;
                  const oMid = { x: mid.x + perpX * off, y: mid.y + perpY * off };
                  return (
                    <g key={`dim-${idx}`}>
                      {/* Dimension offset line */}
                      <line x1={s1.x + perpX * off} y1={s1.y + perpY * off}
                        x2={s2.x + perpX * off} y2={s2.y + perpY * off}
                        stroke={color} strokeWidth={0.8} opacity={0.4} />
                      {/* Tick marks */}
                      <line x1={s1.x + perpX * 8} y1={s1.y + perpY * 8}
                        x2={s1.x + perpX * 20} y2={s1.y + perpY * 20}
                        stroke={color} strokeWidth={1} opacity={0.5} />
                      <line x1={s2.x + perpX * 8} y1={s2.y + perpY * 8}
                        x2={s2.x + perpX * 20} y2={s2.y + perpY * 20}
                        stroke={color} strokeWidth={1} opacity={0.5} />
                      {/* Label with background */}
                      <g transform={`translate(${oMid.x},${oMid.y}) rotate(${angle})`}>
                        <rect x={-rw / 2} y={-9} width={rw} height={18} rx={4}
                          fill="rgba(0,0,0,0.78)" stroke={color} strokeWidth={0.8} />
                        <text textAnchor="middle" dominantBaseline="middle"
                          fontSize={10} fill="white" fontWeight="600"
                          fontFamily="ui-monospace, monospace">
                          {label}
                        </text>
                      </g>
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
                      <circle r={9} className="svg-handle" fill="white" stroke={color} strokeWidth={1.5} opacity={0.85} />
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
                onContextMenu={e => { e.stopPropagation(); e.preventDefault(); onAngleMeasurementsChange?.(angleMeasurements.filter(m => m.id !== id)); }}>
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
                    {fmtArea((m.w_norm * naturalSize.w * m.h_norm * naturalSize.h) / (ppm ** 2), displayUnit)}
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
                  r={4} className="svg-handle" fill="white" stroke="#EF4444" strokeWidth={1.5}
                />
              )}
            </>
          )}

          {/* Scale calibration line preview */}
          {tool === "scale" && (
            <>
              {scalePts.length >= 1 && (mouseNorm || scalePts.length === 2) && (
                <line
                  x1={toSvg(scalePts[0]).x} y1={toSvg(scalePts[0]).y}
                  x2={scalePts.length === 2 ? toSvg(scalePts[1]).x : toSvg(mouseNorm!).x}
                  y2={scalePts.length === 2 ? toSvg(scalePts[1]).y : toSvg(mouseNorm!).y}
                  stroke="#FCD34D" strokeWidth={2} strokeDasharray="8 4"
                />
              )}
              {scalePts.map((p, i) => {
                const s = toSvg(p);
                return <circle key={i} cx={s.x} cy={s.y} r={5} fill="#FCD34D" stroke="white" strokeWidth={1.5} />;
              })}
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
              {/* Live dimension labels on edges during drawing */}
              {ppm && naturalSize.w > 0 && (() => {
                const allPts = [...drawingPoints, ...(mouseNorm ? [mouseNorm] : [])];
                return allPts.map((p, i) => {
                  if (i >= allPts.length - 1) return null;
                  const next = allPts[i + 1];
                  const s1 = toSvg(p), s2 = toSvg(next);
                  const screenLen = Math.hypot(s2.x - s1.x, s2.y - s1.y);
                  if (screenLen < 30) return null;
                  const mid = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 };
                  const dxI = (next.x - p.x) * naturalSize.w, dyI = (next.y - p.y) * naturalSize.h;
                  const lenM = Math.sqrt(dxI * dxI + dyI * dyI) / ppm;
                  const label = fmtLinear(lenM, displayUnit);
                  const rawA = Math.atan2(s2.y - s1.y, s2.x - s1.x) * 180 / Math.PI;
                  const angle = (rawA > 90 || rawA <= -90) ? rawA + 180 : rawA;
                  const rw = label.length * 6 + 12;
                  return (
                    <g key={`draw-dim-${i}`} transform={`translate(${mid.x},${mid.y}) rotate(${angle})`}>
                      <rect x={-rw / 2} y={-9} width={rw} height={18} rx={4}
                        fill="rgba(0,0,0,0.78)" stroke={activeColor} strokeWidth={0.8} />
                      <text textAnchor="middle" dominantBaseline="middle"
                        fontSize={10} fill="white" fontWeight="600"
                        fontFamily="ui-monospace, monospace">{label}</text>
                    </g>
                  );
                });
              })()}
              {/* Control points */}
              {drawingPoints.map((p, i) => {
                const s = toSvg(p);
                const isFirst = i === 0;
                const closeSnap = isFirst && isNearFirst;
                return (
                  <g key={i}>
                    {closeSnap && (
                      <circle
                        cx={s.x} cy={s.y}
                        r={CLOSE_RADIUS}
                        fill={`${activeColor}18`}
                        stroke={activeColor}
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                      />
                    )}
                    <circle
                      cx={s.x} cy={s.y}
                      r={isFirst ? (closeSnap ? 8 : 6) : 3}
                      fill={isFirst ? activeColor : "white"}
                      stroke={isFirst ? "white" : activeColor}
                      strokeWidth={1.5}
                    />
                  </g>
                );
              })}
            </>
          )}

          {/* ── Linear measures (completed) ── */}
          {linearMeasures.map(lm => {
            const cat = linearCategories.find(c => c.id === lm.categoryId);
            const lColor = cat?.color ?? "#10B981";
            if (lm.points.length < 2) return null;
            const isSelected = selectedLinearId === lm.id;
            const svgPts = lm.points.map(p => toSvg(p));
            const pathD = svgPts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
            const midIdx = Math.floor((svgPts.length - 1) / 2);
            const lx = (svgPts[midIdx].x + svgPts[midIdx + 1 < svgPts.length ? midIdx + 1 : midIdx].x) / 2;
            const ly = (svgPts[midIdx].y + svgPts[midIdx + 1 < svgPts.length ? midIdx + 1 : midIdx].y) / 2;
            let totalM = 0;
            if (ppm && naturalSize.w > 0) {
              for (let i = 0; i < lm.points.length - 1; i++) {
                const dx = (lm.points[i + 1].x - lm.points[i].x) * naturalSize.w;
                const dy = (lm.points[i + 1].y - lm.points[i].y) * naturalSize.h;
                totalM += Math.sqrt(dx * dx + dy * dy) / ppm;
              }
            }
            const totalLabel = ppm ? `Σ ${fmtLinear(totalM, displayUnit)}` : `${lm.points.length - 1} seg.`;
            const tlw = totalLabel.length * 5.5 + 12;
            return (
              <g key={lm.id}>
                {/* Thicker invisible hit area for click/right-click */}
                <path d={pathD} fill="none" stroke="transparent" strokeWidth={12}
                  style={{ pointerEvents: "all", cursor: tool === "select" ? "pointer" : "default" }}
                  onContextMenu={e => { e.stopPropagation(); e.preventDefault(); onLinearMeasuresChange?.(linearMeasures.filter(m => m.id !== lm.id)); }}
                />
                <path d={pathD} fill="none" stroke={lColor}
                  strokeWidth={isSelected ? 3.5 : 2.5}
                  strokeLinejoin="round" strokeLinecap="round"
                  strokeDasharray={isSelected ? "8 4" : undefined}
                  style={isSelected ? { filter: `drop-shadow(0 0 5px ${lColor})` } : undefined}
                />
                {/* Per-segment dimension labels */}
                {ppm && naturalSize.w > 0 && lm.points.length > 2 && lm.points.map((pt, si) => {
                  if (si >= lm.points.length - 1) return null;
                  const next = lm.points[si + 1];
                  const ss1 = toSvg(pt), ss2 = toSvg(next);
                  const sLen = Math.hypot(ss2.x - ss1.x, ss2.y - ss1.y);
                  if (sLen < 28) return null;
                  const sMid = { x: (ss1.x + ss2.x) / 2, y: (ss1.y + ss2.y) / 2 };
                  const dxI = (next.x - pt.x) * naturalSize.w, dyI = (next.y - pt.y) * naturalSize.h;
                  const segM = Math.sqrt(dxI * dxI + dyI * dyI) / ppm;
                  const segL = fmtLinear(segM, displayUnit);
                  const rawA = Math.atan2(ss2.y - ss1.y, ss2.x - ss1.x) * 180 / Math.PI;
                  const sAngle = (rawA > 90 || rawA <= -90) ? rawA + 180 : rawA;
                  const srw = segL.length * 5 + 10;
                  return (
                    <g key={`lseg-${si}`} transform={`translate(${sMid.x},${sMid.y}) rotate(${sAngle})`}>
                      <rect x={-srw / 2} y={-7} width={srw} height={14} rx={3} fill="rgba(0,0,0,0.65)" />
                      <text textAnchor="middle" dominantBaseline="middle"
                        fontSize={8} fill={lColor} fontFamily="ui-monospace, monospace">{segL}</text>
                    </g>
                  );
                })}
                {/* Endpoint dots — draggable when selected */}
                {svgPts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y}
                    r={isSelected ? 7 : (i === 0 || i === svgPts.length - 1 ? 4 : 3)}
                    fill={isSelected ? "white" : lColor} stroke={lColor} strokeWidth={isSelected ? 2 : 1.5}
                    style={{ pointerEvents: "all", cursor: isSelected ? "move" : "pointer" }}
                    onMouseDown={isSelected ? (e => {
                      e.stopPropagation(); e.preventDefault();
                      if (e.button === 0) { dragLinearVertexRef.current = { measureId: lm.id, idx: i }; skipNextClickRef.current = true; }
                    }) : undefined}
                    onContextMenu={e => { e.stopPropagation(); e.preventDefault(); onLinearMeasuresChange?.(linearMeasures.filter(m => m.id !== lm.id)); }}
                  />
                ))}
                {/* Midpoint insertion handles when selected */}
                {isSelected && lm.points.map((pt, mi) => {
                  if (mi >= lm.points.length - 1) return null;
                  const next = lm.points[mi + 1];
                  const midN = { x: (pt.x + next.x) / 2, y: (pt.y + next.y) / 2 };
                  const mSvg = toSvg(midN);
                  return (
                    <g key={`lmid-${mi}`} transform={`translate(${mSvg.x},${mSvg.y})`}
                      className="opacity-0 hover:opacity-100 transition-opacity"
                      style={{ pointerEvents: "all", cursor: "copy" }}
                      onClick={e => {
                        e.stopPropagation(); e.preventDefault(); skipNextClickRef.current = true;
                        const newPts = [...lm.points]; newPts.splice(mi + 1, 0, midN);
                        onLinearMeasuresChange?.(linearMeasures.map(m => m.id !== lm.id ? m : { ...m, points: newPts }));
                      }}>
                      <circle r={8} fill="white" stroke={lColor} strokeWidth={1.5} opacity={0.85} />
                      <text textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight="700"
                        fill={lColor} style={{ userSelect: "none", pointerEvents: "none" }}>+</text>
                    </g>
                  );
                })}
                {/* Total length label */}
                <rect x={lx - tlw / 2} y={ly - 10} width={tlw} height={18} rx={4} fill="rgba(0,0,0,0.78)" stroke={lColor} strokeWidth={0.6} />
                <text x={lx} y={ly + 1} textAnchor="middle" dominantBaseline="middle"
                  fontSize={9} fill={lColor} fontWeight="600" fontFamily="ui-monospace, monospace">{totalLabel}</text>
              </g>
            );
          })}

          {/* ── Linear in-progress ── */}
          {tool === "linear" && linearDrawingPts.length > 0 && (() => {
            const activeCat = linearCategories.find(c => c.id === activeLinearCategoryId);
            const color = activeCat?.color ?? "#10B981";
            const allPts = [...linearDrawingPts, ...(mouseNorm ? [mouseNorm] : [])];
            const svgPts = allPts.map(p => toSvg(p));
            const pathD = svgPts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
            return (
              <g>
                <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeDasharray="6 3"
                  strokeLinejoin="round" strokeLinecap="round" />
                {svgPts.slice(0, -1).map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={i === 0 ? 5 : 3}
                    fill={i === 0 ? color : "white"} stroke={color} strokeWidth={1.5} />
                ))}
              </g>
            );
          })()}

          {/* ── Count points (completed) — draggable + right-click delete ── */}
          {countPoints.map((cp) => {
            const grp = countGroups.find(g => g.id === cp.groupId);
            const cpColor = grp?.color ?? "#EC4899";
            const s = toSvg({ x: cp.x, y: cp.y });
            const num = countPoints.filter(p => p.groupId === cp.groupId).findIndex(p => p.id === cp.id) + 1;
            return (
              <g key={cp.id} style={{ pointerEvents: "all", cursor: "move" }}
                onMouseDown={e => {
                  if (e.button === 0) {
                    e.stopPropagation(); e.preventDefault();
                    dragCountPointRef.current = { pointId: cp.id };
                    skipNextClickRef.current = true;
                  }
                }}
                onContextMenu={e => {
                  e.stopPropagation(); e.preventDefault();
                  onCountPointsChange?.(countPoints.filter(p => p.id !== cp.id));
                }}>
                <circle cx={s.x} cy={s.y} r={10} fill={cpColor} stroke="white" strokeWidth={1.5} />
                <text x={s.x} y={s.y + 1} textAnchor="middle" dominantBaseline="middle"
                  fontSize={9} fontWeight="700" fill="white" fontFamily="system-ui, sans-serif">
                  {String(num)}
                </text>
              </g>
            );
          })}

          {/* Count tool cursor dot */}
          {tool === "count" && mouseNorm && (() => {
            const activeCG = countGroups.find(g => g.id === activeCountGroupId);
            const color = activeCG?.color ?? "#EC4899";
            const s = toSvg(mouseNorm);
            return <circle cx={s.x} cy={s.y} r={8} fill={hexToRgba(color, 0.5)} stroke={color} strokeWidth={1.5} strokeDasharray="3 2" />;
          })()}

          {/* ── Completed circles ── */}
          {circleMeasures.map(cm => {
            const cat = linearCategories.find(c => c.id === cm.categoryId);
            const cColor = cat?.color ?? "#10B981";
            const cs = toSvg(cm.center);
            const es = toSvg(cm.edgePoint);
            const radiusSvg = Math.hypot(es.x - cs.x, es.y - cs.y);
            const metrics = circleMetrics(cm, naturalSize.w, naturalSize.h, ppm);
            const cLabel = metrics ? `r=${fmtLinear(metrics.radiusM, displayUnit)}` : "";
            const clw = cLabel.length * 5.5 + 12;
            return (
              <g key={cm.id} style={{ pointerEvents: "all" }}
                onContextMenu={e => {
                  e.stopPropagation(); e.preventDefault();
                  onCircleMeasuresChange?.(circleMeasures.filter(c => c.id !== cm.id));
                }}>
                <circle cx={cs.x} cy={cs.y} r={radiusSvg}
                  fill={hexToRgba(cColor, 0.08)} stroke={cColor} strokeWidth={2} />
                <line x1={cs.x} y1={cs.y} x2={es.x} y2={es.y}
                  stroke={cColor} strokeWidth={1} strokeDasharray="4 2" />
                <circle cx={cs.x} cy={cs.y} r={3} fill={cColor} />
                <circle cx={es.x} cy={es.y} r={3} fill={cColor} stroke="white" strokeWidth={1} />
                {metrics && (
                  <g transform={`translate(${cs.x}, ${cs.y - radiusSvg - 14})`}>
                    <rect x={-clw / 2} y={-9} width={clw} height={18} rx={4}
                      fill="rgba(0,0,0,0.78)" stroke={cColor} strokeWidth={0.6} />
                    <text textAnchor="middle" dominantBaseline="middle"
                      fontSize={9} fill={cColor} fontWeight="600" fontFamily="ui-monospace, monospace">
                      {cLabel}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Circle in-progress preview */}
          {tool === "circle" && circleCenter && mouseNorm && (() => {
            const cs = toSvg(circleCenter);
            const ms = toSvg(mouseNorm);
            const r = Math.hypot(ms.x - cs.x, ms.y - cs.y);
            const activeCat = linearCategories.find(c => c.id === activeLinearCategoryId);
            const cColor = activeCat?.color ?? "#10B981";
            let rLabel = "";
            if (ppm && naturalSize.w > 0) {
              const dx = (mouseNorm.x - circleCenter.x) * naturalSize.w;
              const dy = (mouseNorm.y - circleCenter.y) * naturalSize.h;
              const radiusM = Math.sqrt(dx * dx + dy * dy) / ppm;
              rLabel = `r=${fmtLinear(radiusM, displayUnit)}`;
            }
            const rlw = rLabel.length * 5.5 + 12;
            return (
              <g>
                <circle cx={cs.x} cy={cs.y} r={r}
                  fill="none" stroke={cColor} strokeWidth={2} strokeDasharray="6 3" />
                <line x1={cs.x} y1={cs.y} x2={ms.x} y2={ms.y}
                  stroke={cColor} strokeWidth={1} strokeDasharray="4 2" />
                <circle cx={cs.x} cy={cs.y} r={4} fill={cColor} stroke="white" strokeWidth={1.5} />
                {rLabel && (
                  <g transform={`translate(${cs.x}, ${cs.y - r - 12})`}>
                    <rect x={-rlw / 2} y={-8} width={rlw} height={16} rx={3} fill="rgba(0,0,0,0.7)" />
                    <text textAnchor="middle" dominantBaseline="middle"
                      fontSize={8.5} fill={cColor} fontFamily="ui-monospace, monospace">{rLabel}</text>
                  </g>
                )}
              </g>
            );
          })()}

          {/* ── Text annotations ── */}
          {textAnnotations.map(ta => {
            const s = toSvg({ x: ta.x, y: ta.y });
            const fs = ta.fontSize ?? 12;
            const lines = ta.text.split("\n");
            const lineH = fs + 3;
            const maxW = Math.max(...lines.map(l => l.length)) * fs * 0.58 + 16;
            const totalH = lines.length * lineH + 8;
            return (
              <g key={ta.id} style={{ pointerEvents: "all", cursor: "default" }}
                onContextMenu={e => {
                  e.stopPropagation(); e.preventDefault();
                  onTextAnnotationsChange?.(textAnnotations.filter(t => t.id !== ta.id));
                }}>
                <rect x={s.x - 4} y={s.y - 4} width={maxW} height={totalH} rx={4}
                  fill="rgba(0,0,0,0.75)" stroke={ta.color} strokeWidth={1} />
                {lines.map((line, li) => (
                  <text key={li} x={s.x + 4} y={s.y + 8 + li * lineH}
                    fontSize={fs} fill={ta.color} fontFamily="system-ui, sans-serif">
                    {line}
                  </text>
                ))}
              </g>
            );
          })}

          {/* Empty state hint */}
          {zones.length === 0 && !isDrawing && textAnnotations.length === 0 && (
            <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle"
              fill="rgba(148,163,184,0.6)" fontSize={14} fontFamily="system-ui">
              ✛ Sélectionnez un type et commencez à dessiner
            </text>
          )}
        </svg>

        {/* Text annotation input overlay */}
        {textInputPos && (() => {
          const sp = toSvg(textInputPos);
          return (
            <div className="absolute z-50 pointer-events-auto"
              style={{ left: sp.x, top: sp.y }}>
              <input
                autoFocus
                value={textInputValue}
                onChange={e => setTextInputValue(e.target.value)}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === "Enter" && textInputValue.trim()) {
                    onTextAnnotationsChange?.([...textAnnotations, {
                      id: crypto.randomUUID(),
                      x: textInputPos.x,
                      y: textInputPos.y,
                      text: textInputValue.trim(),
                      color: activeColor,
                    }]);
                    setTextInputPos(null);
                    setTextInputValue("");
                  }
                  if (e.key === "Escape") { setTextInputPos(null); setTextInputValue(""); }
                }}
                onClick={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}
                placeholder="Texte…"
                className="bg-black/90 border border-sky-500/60 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-sky-400 min-w-44 shadow-xl"
              />
            </div>
          );
        })()}

        {/* Scale calibration input dialog + presets */}
        {tool === "scale" && scaleInputOpen && scalePts.length === 2 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 glass border border-yellow-500/40 rounded-2xl p-4 shadow-2xl flex flex-col gap-3 min-w-72 pointer-events-auto">
            <p className="text-sm text-yellow-300 font-semibold">Calibrage de l'échelle</p>
            <p className="text-xs text-slate-400">Longueur réelle du segment tracé :</p>
            {/* Quick distance presets */}
            <div className="flex gap-1.5 flex-wrap">
              {[0.5, 1, 2, 5, 10].map(v => (
                <button key={v}
                  onClick={e => { e.stopPropagation(); setScaleRealDist(String(v)); }}
                  className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                    scaleRealDist === String(v)
                      ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-300"
                      : "border-white/10 text-slate-500 hover:text-yellow-300 hover:border-yellow-500/30"
                  }`}
                >{v} m</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                autoFocus
                type="number"
                min={0.01}
                step={0.01}
                value={scaleRealDist}
                onChange={e => setScaleRealDist(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") confirmScale();
                  if (e.key === "Escape") { setScalePts([]); setScaleInputOpen(false); setTool("polygon"); }
                }}
                onClick={e => e.stopPropagation()}
                className="flex-1 bg-transparent border-b border-yellow-500/50 text-yellow-200 text-sm font-mono text-center focus:outline-none focus:border-yellow-400"
              />
              <span className="text-xs text-slate-400 shrink-0">m</span>
            </div>
            {/* Scale ratio presets */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-500 shrink-0">Échelles :</span>
              {[{l:"1:20",r:20},{l:"1:50",r:50},{l:"1:75",r:75},{l:"1:100",r:100},{l:"1:200",r:200},{l:"1:500",r:500}].map(({l,r}) => (
                <button key={l}
                  onClick={e => {
                    e.stopPropagation();
                    // With scale ratio: ppm = DPI / (ratio * 0.0254) — but DPI unknown
                    // Instead: calculate from drawn segment pixel length ÷ (pixel_length / (ratio×100) cm → m)
                    if (scalePts.length === 2 && naturalSize.w > 0) {
                      const dx = (scalePts[1].x - scalePts[0].x) * naturalSize.w;
                      const dy = (scalePts[1].y - scalePts[0].y) * naturalSize.h;
                      const pxLen = Math.sqrt(dx * dx + dy * dy);
                      // At scale 1:r, 1 cm on plan = r cm real = r/100 m
                      // Assume typical plan DPI → use segment as reference
                      // Pre-fill distance: pxLen / estimated_ppm is unknowable without DPI
                      // Simpler: show the ratio as info, user still enters real distance
                      setScaleRealDist((pxLen / (ppm || 100) * 1).toFixed(2));
                    }
                  }}
                  className="px-1.5 py-0.5 text-[10px] rounded border border-white/10 text-slate-500 hover:text-yellow-300 hover:border-yellow-500/30 transition-colors"
                >{l}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={e => { e.stopPropagation(); confirmScale(); }}
                className="flex-1 py-1.5 bg-yellow-500/20 border border-yellow-500/40 text-yellow-300 text-xs rounded-lg hover:bg-yellow-500/30 transition-colors"
              >
                Confirmer
              </button>
              <button
                onClick={e => { e.stopPropagation(); setScalePts([]); setScaleInputOpen(false); setTool("polygon"); }}
                className="px-3 py-1.5 glass border border-white/10 text-slate-400 text-xs rounded-lg hover:text-white transition-colors"
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* Scale bar — fixed position bottom-left */}
        {ppm && ppm > 0 && imgOffset.w > 0 && naturalSize.w > 0 && (() => {
          const oneMeterPx = ppm * (imgOffset.w / naturalSize.w);
          let refM = 1;
          if (oneMeterPx < 30) refM = 5;
          else if (oneMeterPx < 60) refM = 2;
          else if (oneMeterPx > 400) refM = 0.2;
          else if (oneMeterPx > 200) refM = 0.5;
          const barW = Math.max(20, Math.min(220, refM * oneMeterPx));
          const label = refM >= 1 ? `${refM} m` : `${refM * 100} cm`;
          return (
            <div className="absolute bottom-10 left-4 pointer-events-none">
              <div className="flex flex-col items-start gap-0.5">
                <div className="relative" style={{ width: barW }}>
                  <div className="h-1.5 rounded-full" style={{ width: barW, background: "rgba(255,255,255,0.85)" }} />
                  <div className="absolute left-0 top-[-3px] w-0.5 h-[9px] bg-white rounded-sm" />
                  <div className="absolute right-0 top-[-3px] w-0.5 h-[9px] bg-white rounded-sm" />
                </div>
                <span className="text-[10px] font-mono font-semibold text-white/80 drop-shadow-sm">{label}</span>
              </div>
            </div>
          );
        })()}

        {/* Controls hint */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="glass border border-white/10 rounded-xl px-3 py-1.5 text-xs text-slate-500 whitespace-nowrap">
            Scroll — zoom &nbsp;·&nbsp; Clic droit ou Espace — déplacer &nbsp;·&nbsp; Q — sélection
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
              <div key={zone.id}
                className={`glass border rounded-lg px-3 py-2 text-xs cursor-pointer transition-colors ${
                  selectedZoneId === zone.id ? "border-violet-500/50 bg-violet-500/5" : "border-white/5 hover:border-white/15"
                }`}
                onClick={() => { onSelectedZoneIdChange?.(zone.id); setTool("select"); }}
              >
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
                    {zone.isDeduction ? "−" : ""}{areaM2 != null ? fmtArea(areaM2, displayUnit) : `${Math.round(areaPx).toLocaleString()} px²`}
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
                {/* Depth + Slope inline */}
                <div className="flex items-center gap-1.5 mt-1 flex-wrap" onClick={e => e.stopPropagation()}>
                  <span className="text-[10px] text-slate-600">Prof.</span>
                  <input type="number"
                    value={zone.depthM != null ? +(zone.depthM * 100).toFixed(1) : ""}
                    onChange={e => {
                      const cm = parseFloat(e.target.value);
                      onZonesChange(zones.map(z => z.id === zone.id ? { ...z, depthM: isNaN(cm) || cm <= 0 ? undefined : cm / 100 } : z));
                    }}
                    placeholder={(() => { const t = surfaceTypes.find(t => t.id === zone.typeId); return t?.defaultDepthM ? String(+(t.defaultDepthM * 100).toFixed(1)) : "—"; })()}
                    className="w-11 bg-white/5 border border-white/10 rounded px-1 py-0.5 text-[10px] text-slate-300 font-mono text-center focus:outline-none focus:border-accent"
                  />
                  <span className="text-[10px] text-slate-600">cm</span>
                  <span className="text-[10px] text-slate-600 ml-1">∠</span>
                  <select value={zone.slopeDeg ?? 0}
                    onChange={e => onZonesChange(zones.map(z => z.id === zone.id ? { ...z, slopeDeg: parseFloat(e.target.value) || undefined } : z))}
                    className="w-12 bg-white/5 border border-white/10 rounded px-0.5 py-0.5 text-[10px] text-slate-300 font-mono text-center focus:outline-none focus:border-accent appearance-none"
                  >
                    <option value={0}>0°</option>
                    <option value={5}>5°</option>
                    <option value={15}>15°</option>
                    <option value={30}>30°</option>
                    <option value={45}>45°</option>
                  </select>
                  {(() => {
                    const effArea = slopeCorrectedArea(areaM2 ?? 0, zone.slopeDeg);
                    const t = surfaceTypes.find(t => t.id === zone.typeId);
                    const vol = zoneVolumeM3(effArea, zone.depthM ?? t?.defaultDepthM);
                    return vol != null ? (
                      <span className="text-[10px] text-blue-400 font-mono ml-auto">{fmtVolume(vol, displayUnit)}</span>
                    ) : (zone.slopeDeg ?? 0) > 0 ? (
                      <span className="text-[10px] text-amber-400 font-mono ml-auto">↗ {fmtArea(effArea, displayUnit)}</span>
                    ) : null;
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
