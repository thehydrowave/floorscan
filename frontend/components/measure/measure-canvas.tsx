"use client";

import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { Trash2, Undo2, Redo2, Pentagon, Square, ZoomIn, ZoomOut, RotateCcw, Spline, MinusSquare, Ruler, Scissors, Search, Save, Loader2, MousePointer2, Copy, Type, Download, ArrowRight, Pen, Cloud, Stamp, MessageSquare, Minus, CircleDot, Highlighter, LayoutGrid, Group, Ungroup, Paintbrush, Layers, Eye, EyeOff, Lock, Unlock, Wrench } from "lucide-react";
import { SurfaceType, MeasureZone, pointInPolygon, splitPolygonByLine, LinearCategory, LinearMeasure, CountGroup, CountPoint, CountShape, AngleMeasurement, CircleMeasure, circleMetrics, DisplayUnit, fmtLinear, fmtArea, fmtVolume, slopeCorrectedArea, zoneVolumeM3, TextAnnotation, MarkupAnnotation, MarkupType, StampKind, STAMP_LABELS, MarkupGroup, MeasureLayer, DEFAULT_LAYERS, ToolChestCategory, DEFAULT_TOOL_CHEST, ToolPreset } from "@/lib/measure-types";
import type { VisualSearchMatch, CustomDetection } from "@/lib/types";

import { BACKEND } from "@/lib/backend";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
// @ts-ignore — no types for polygon-clipping
import polygonClipping from "polygon-clipping";

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
  onActiveCountGroupIdChange?: (id: string) => void;
  onCountGroupsChange?: (groups: CountGroup[]) => void;
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
  // Markup annotations (arrow, line, callout, cloud, rect, ellipse, highlight, pen, stamp)
  markupAnnotations?: MarkupAnnotation[];
  onMarkupAnnotationsChange?: (markups: MarkupAnnotation[]) => void;
  // Groups
  markupGroups?: MarkupGroup[];
  onMarkupGroupsChange?: (groups: MarkupGroup[]) => void;
  // Layers
  layers?: MeasureLayer[];
  onLayersChange?: (layers: MeasureLayer[]) => void;
  activeLayerId?: string;
  onActiveLayerIdChange?: (id: string) => void;
  // Export callback
  onExportPNG?: () => void;
}

type Tool = "select" | "polygon" | "rect" | "angle" | "wall" | "split" | "visual_search" | "scale" | "linear" | "count" | "circle" | "text"
  | "arrow" | "mk_line" | "callout" | "cloud" | "rect_annot" | "ellipse" | "highlight" | "pen" | "stamp"
  | "lasso" | "note" | "dimension" | "polyline_annot" | "eraser";

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

/** Convert a circle to a polygon approximation (N points) in normalized coords */
function circleToPolygon(center: { x: number; y: number }, edge: { x: number; y: number }, n = 48): { x: number; y: number }[] {
  const r = Math.hypot(edge.x - center.x, edge.y - center.y);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
  }
  return pts;
}

/** Convert a rect (2 corners) to a polygon */
function rectToPolygon(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number }[] {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

/** Close a ring if not already closed */
function closeRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 2) return ring;
  const f = ring[0], l = ring[ring.length - 1];
  if (f[0] !== l[0] || f[1] !== l[1]) return [...ring, [f[0], f[1]]];
  return ring;
}

/** Remove closing point from a ring (our zone format doesn't repeat first point) */
function openRing(ring: [number, number][]): { x: number; y: number }[] {
  const pts = ring.map(c => ({ x: c[0], y: c[1] }));
  if (pts.length > 1 && Math.abs(pts[0].x - pts[pts.length - 1].x) < 1e-9 && Math.abs(pts[0].y - pts[pts.length - 1].y) < 1e-9) pts.pop();
  return pts;
}

/**
 * Bridge holes into the outer ring to create a single polygon.
 * Uses a thin slit (zero-width bridge) connecting each hole to the outer ring.
 * Standard technique for polygon systems that don't support holes.
 */
function bridgeHoles(outer: [number, number][], holes: [number, number][][]): [number, number][] {
  if (holes.length === 0) return outer;
  // Work with open rings (no closing duplicate)
  let ring = [...outer];
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();

  for (const hole of holes) {
    let hRing = [...hole];
    if (hRing.length > 1 && hRing[0][0] === hRing[hRing.length - 1][0] && hRing[0][1] === hRing[hRing.length - 1][1]) hRing.pop();
    if (hRing.length < 3) continue;

    // Find closest pair of points between outer ring and hole
    let bestDist = Infinity, bestO = 0, bestH = 0;
    for (let i = 0; i < ring.length; i++) {
      for (let j = 0; j < hRing.length; j++) {
        const d = (ring[i][0] - hRing[j][0]) ** 2 + (ring[i][1] - hRing[j][1]) ** 2;
        if (d < bestDist) { bestDist = d; bestO = i; bestH = j; }
      }
    }

    // Reorder hole ring to start at the closest point
    const reordered = [...hRing.slice(bestH), ...hRing.slice(0, bestH)];

    // Splice hole into outer ring with a bridge:
    // ... outer[bestO] → hole[0] → hole[1] → ... → hole[N-1] → hole[0] → outer[bestO] → outer[bestO+1] ...
    const bridged: [number, number][] = [
      ...ring.slice(0, bestO + 1),
      ...reordered,
      reordered[0],       // close the hole loop back to start
      ring[bestO],        // bridge back to outer ring point
      ...ring.slice(bestO + 1),
    ];
    ring = bridged;
  }
  return ring;
}

/**
 * Subtract an eraser polygon from all zones. Returns the new zones array.
 * Zones fully inside the eraser are removed.
 * Zones partially intersecting are clipped (boolean difference).
 * If clipping creates holes, they are bridged into the outer ring.
 * Zones outside are kept unchanged.
 */
function subtractEraserFromZones(
  zones: MeasureZone[],
  eraserPoly: { x: number; y: number }[],
): MeasureZone[] {
  if (eraserPoly.length < 3) return zones;
  const clip: [number, number][][] = [closeRing(eraserPoly.map(p => [p.x, p.y] as [number, number]))];

  const result: MeasureZone[] = [];
  for (const zone of zones) {
    const subject: [number, number][][] = [closeRing(zone.points.map(p => [p.x, p.y] as [number, number]))];

    try {
      const diff = polygonClipping.difference([subject], [clip]);
      if (!diff || diff.length === 0) {
        // Zone fully erased → skip
        continue;
      }
      // Each result polygon becomes a zone
      for (let i = 0; i < diff.length; i++) {
        const outerRing = diff[i][0];
        const holeRings = diff[i].slice(1);
        if (!outerRing || outerRing.length < 3) continue;

        // If there are holes, bridge them into the outer ring
        let finalRing: [number, number][];
        if (holeRings.length > 0) {
          finalRing = bridgeHoles(outerRing, holeRings);
        } else {
          finalRing = outerRing;
        }

        const pts = openRing(finalRing);
        if (pts.length < 3) continue;

        result.push({
          ...zone,
          id: i === 0 ? zone.id : crypto.randomUUID(),
          points: pts,
          name: i === 0 ? zone.name : (zone.name ? `${zone.name} (${i + 1})` : undefined),
        });
      }
    } catch {
      // If clipping fails, keep original zone
      result.push(zone);
    }
  }
  return result;
}

export default function MeasureCanvas({
  imageB64, imageMime = "image/png",
  zones, activeTypeId, surfaceTypes, ppm, onZonesChange,
  onHistoryPush, onHistoryUndo, onHistoryRedo, canUndo = false, canRedo = false,
  sessionId, onEnsureSession, vsMatches = [], onVsMatchesChange, customDetections = [], onSaveDetection,
  onPpmChange,
  linearMeasures = [], onLinearMeasuresChange, linearCategories = [], activeLinearCategoryId = "",
  countPoints = [], onCountPointsChange, countGroups = [], activeCountGroupId = "", onActiveCountGroupIdChange, onCountGroupsChange: onCountGroupsChangeProp,
  selectedZoneId = null, onSelectedZoneIdChange, selectedLinearId = null, onSelectedLinearIdChange,
  angleMeasurements = [], onAngleMeasurementsChange,
  circleMeasures = [], onCircleMeasuresChange,
  displayUnit = "m" as DisplayUnit,
  textAnnotations = [], onTextAnnotationsChange,
  markupAnnotations = [], onMarkupAnnotationsChange,
  markupGroups = [], onMarkupGroupsChange,
  layers = DEFAULT_LAYERS, onLayersChange, activeLayerId = "lyr_general", onActiveLayerIdChange,
  onExportPNG,
}: MeasureCanvasProps) {
  const { lang } = useLang();
  const d = (k: DTKey) => dt(k, lang);

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
  // Grid & Rulers toggles
  const [showGrid, setShowGrid] = useState(false);
  const [showRulers, setShowRulers] = useState(false);
  const isDeductionRef = useRef(false);
  useEffect(() => { isDeductionRef.current = isDeductionMode; }, [isDeductionMode]);

  // Clear all selections when switching away from select tool
  useEffect(() => {
    if (tool !== "select") {
      setSelectedMarkupId(null);
      setSelectedTextId(null);
      setSelectedCircleId(null);
      setSelectedZoneIds(new Set());
    }
  }, [tool]);

  // Angle tool state
  const [anglePts, setAnglePts]               = useState<{ x: number; y: number }[]>([]);
  // angleMeasurements now comes from props (lifted to parent)

  // Circle tool in-progress state
  const [circleCenter, setCircleCenter] = useState<{ x: number; y: number } | null>(null);

  // Text annotation in-progress state
  const [textInputPos, setTextInputPos] = useState<{ x: number; y: number } | null>(null);
  const [textInputValue, setTextInputValue] = useState("");

  // Eraser sub-modes
  type EraserMode = "click" | "rect" | "polygon" | "circle";
  const [eraserMode, setEraserMode] = useState<EraserMode>("click");
  const [eraserStart, setEraserStart] = useState<{ x: number; y: number } | null>(null);
  const [eraserDrawingPoly, setEraserDrawingPoly] = useState<{ x: number; y: number }[]>([]);

  // Format painter
  const [formatPainterStyle, setFormatPainterStyle] = useState<{ color: string; lineWidth?: number; fillColor?: string; fillOpacity?: number } | null>(null);
  // Clipboard for copy/paste
  const clipboardRef = useRef<{ kind: string; data: any } | null>(null);
  // Extended selection (for markups, texts, circles)
  const [selectedMarkupId, setSelectedMarkupId] = useState<string | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [selectedCircleId, setSelectedCircleId] = useState<string | null>(null);
  // Markup drag state
  const dragMarkupRef = useRef<{ id: string; kind: "markup" | "text" | "circle"; startNorm: { x: number; y: number }; origX1: number; origY1: number; origX2: number; origY2: number } | null>(null);
  // Layers panel & Tool Chest panel
  const [showLayersPanel, setShowLayersPanel] = useState(false);
  const [showToolChest, setShowToolChest] = useState(false);
  // Layer creation modal
  const [newLayerModalOpen, setNewLayerModalOpen] = useState(false);
  const [newLayerName, setNewLayerName] = useState("");
  const [newLayerColor, setNewLayerColor] = useState("#" + Math.floor(Math.random()*16777215).toString(16).padStart(6,"0"));
  // Dropdown menus
  const [showAnnotDropdown, setShowAnnotDropdown] = useState(false);
  const [showEraserDropdown, setShowEraserDropdown] = useState(false);

  // Lasso multi-select
  const [lassoStart, setLassoStart] = useState<{ x: number; y: number } | null>(null);
  const [lassoEnd, setLassoEnd] = useState<{ x: number; y: number } | null>(null);
  const [selectedZoneIds, setSelectedZoneIds] = useState<Set<string>>(new Set());

  // Markup in-progress state (arrow, line, callout, cloud, rect_annot, ellipse, highlight, pen)
  const [mkStart, setMkStart] = useState<{ x: number; y: number } | null>(null);
  const [penDrawing, setPenDrawing] = useState<{ x: number; y: number }[]>([]);
  const penDrawingRef = useRef<{ x: number; y: number }[]>([]);
  const [activeStamp, setActiveStamp] = useState<StampKind>("approved");
  // Callout text input
  const [calloutInputPos, setCalloutInputPos] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
  const [calloutInputValue, setCalloutInputValue] = useState("");

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
  const markupAnnotationsRef = useRef(markupAnnotations);
  const onMarkupAnnotationsChangeRef = useRef(onMarkupAnnotationsChange);
  const activeColorRef = useRef("");
  const textAnnotationsRef = useRef(textAnnotations);
  const onTextAnnotationsChangeRef = useRef(onTextAnnotationsChange);

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
  useEffect(() => { markupAnnotationsRef.current = markupAnnotations; }, [markupAnnotations]);
  useEffect(() => { onMarkupAnnotationsChangeRef.current = onMarkupAnnotationsChange; }, [onMarkupAnnotationsChange]);
  useEffect(() => { textAnnotationsRef.current = textAnnotations; }, [textAnnotations]);
  useEffect(() => { onTextAnnotationsChangeRef.current = onTextAnnotationsChange; }, [onTextAnnotationsChange]);

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
      // Markup/text/circle drag
      if (dragMarkupRef.current) {
        const n = getNorm(e);
        if (!n) return;
        const { id, kind, startNorm, origX1, origY1, origX2, origY2 } = dragMarkupRef.current;
        const dx = n.x - startNorm.x, dy = n.y - startNorm.y;
        if (kind === "markup") {
          onMarkupAnnotationsChangeRef.current?.(markupAnnotationsRef.current.map(m =>
            m.id !== id ? m : { ...m, x1: origX1 + dx, y1: origY1 + dy, x2: origX2 + dx, y2: origY2 + dy,
              ...(m.penPoints ? { penPoints: m.penPoints.map(p => ({ x: p.x + dx, y: p.y + dy })) } : {}),
            }
          ));
        } else if (kind === "text") {
          onTextAnnotationsChangeRef.current?.(textAnnotationsRef.current.map(t =>
            t.id !== id ? t : { ...t, x: origX1 + dx, y: origY1 + dy }
          ));
        } else if (kind === "circle") {
          onCircleMeasuresChangeRef.current?.(circleMeasuresRef.current.map(c =>
            c.id !== id ? c : { ...c, center: { x: origX1 + dx, y: origY1 + dy }, edgePoint: { x: origX2 + dx, y: origY2 + dy } }
          ));
        }
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
        if (dragMarkupRef.current) { dragMarkupRef.current = null; }
        // Lasso: finalize multi-select
        // (handled in component via useEffect since we need access to zones state)

        // Pen tool: finalize freehand drawing on mouseup
        if (penDrawingRef.current.length > 2) {
          const pts = penDrawingRef.current;
          onMarkupAnnotationsChangeRef.current?.([...markupAnnotationsRef.current, {
            id: crypto.randomUUID(), type: "pen" as const, color: activeColorRef.current, layer: activeLayerId,
            x1: pts[0].x, y1: pts[0].y, x2: pts[pts.length - 1].x, y2: pts[pts.length - 1].y,
            penPoints: [...pts], lineWidth: 2, opacity: 1,
          }]);
          penDrawingRef.current = [];
        }
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
      layer: activeLayerId,
      ...(isDeductionRef.current ? { isDeduction: true } : {}),
    };
    onZonesChange([...zones, newZone]);
    drawingPointsRef.current = [];  // sync reset so dblclick handler sees [] immediately
    setDrawingPoints([]);
  }, [zones, activeTypeId, onZonesChange, onHistoryPush]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragVertexRef.current || dragZoneRef.current || dragLinearVertexRef.current || dragCountPointRef.current || dragMarkupRef.current) return;
    // Pen tool: accumulate freehand points
    if (tool === "pen" && penDrawingRef.current.length > 0) {
      const n = toNorm(e.clientX, e.clientY);
      if (n) { penDrawingRef.current.push(n); setPenDrawing([...penDrawingRef.current]); }
    }
    // Lasso: update drag rect
    if (tool === "lasso" && lassoStart) {
      const n = toNorm(e.clientX, e.clientY);
      if (n) setLassoEnd(n);
    }
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
      // If a markup is selected → start drag
      if (selectedMarkupId) {
        const mk = markupAnnotations.find(m => m.id === selectedMarkupId);
        if (mk) {
          dragMarkupRef.current = { id: mk.id, kind: "markup", startNorm: n, origX1: mk.x1, origY1: mk.y1, origX2: mk.x2, origY2: mk.y2 };
          skipNextClickRef.current = true;
          return;
        }
      }
      // If a text is selected → start drag
      if (selectedTextId) {
        const ta = textAnnotations.find(t => t.id === selectedTextId);
        if (ta) {
          dragMarkupRef.current = { id: ta.id, kind: "text", startNorm: n, origX1: ta.x, origY1: ta.y, origX2: ta.x, origY2: ta.y };
          skipNextClickRef.current = true;
          return;
        }
      }
      // If a circle is selected → start drag
      if (selectedCircleId) {
        const cm = circleMeasures.find(c => c.id === selectedCircleId);
        if (cm) {
          dragMarkupRef.current = { id: cm.id, kind: "circle", startNorm: n, origX1: cm.center.x, origY1: cm.center.y, origX2: cm.edgePoint.x, origY2: cm.edgePoint.y };
          skipNextClickRef.current = true;
          return;
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
    // Pen tool: start freehand drawing
    if (tool === "pen" && e.button === 0) {
      const n = toNorm(e.clientX, e.clientY);
      if (n) { penDrawingRef.current = [n]; setPenDrawing([n]); }
    }
    // Lasso: start drag selection
    if (tool === "lasso" && e.button === 0) {
      const n = toNorm(e.clientX, e.clientY);
      if (n) { setLassoStart(n); setLassoEnd(n); }
    }
  }, [tool, toNorm, vsEditMode, selectedZoneId, selectedLinearId, onHistoryPush, selectedMarkupId, selectedTextId, selectedCircleId, markupAnnotations, textAnnotations, circleMeasures]);

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
    // Close dropdown menus on any canvas click
    setShowAnnotDropdown(false);
    setShowEraserDropdown(false);
    if (skipNextClickRef.current) { skipNextClickRef.current = false; return; }
    if (e.button !== 0) return;
    const raw = toNorm(e.clientX, e.clientY);
    if (!raw) return;
    // Use already-snapped mouseNorm if shift is held while drawing
    const pt: { x: number; y: number } =
      (tool === "polygon" && e.shiftKey && mouseNorm && drawingPoints.length > 0) ? mouseNorm : raw;
    if (tool === "select") {
      const clearAll = () => { onSelectedZoneIdChange?.(null); onSelectedLinearIdChange?.(null); setSelectedMarkupId(null); setSelectedTextId(null); setSelectedCircleId(null); };

      // 1. Check markups (reverse for topmost) — pen uses point proximity, others use bbox
      for (let i = markupAnnotations.length - 1; i >= 0; i--) {
        const mk = markupAnnotations[i];
        const pad = 0.015;
        let hit = false;
        if (mk.type === "pen" && mk.penPoints && mk.penPoints.length > 1) {
          // Check proximity to any segment of the pen stroke
          for (let j = 0; j < mk.penPoints.length - 1; j++) {
            const a = mk.penPoints[j], b = mk.penPoints[j + 1];
            const abx = b.x - a.x, aby = b.y - a.y;
            const apx = pt.x - a.x, apy = pt.y - a.y;
            const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby || 1)));
            const dx = a.x + t * abx - pt.x, dy = a.y + t * aby - pt.y;
            if (Math.hypot(dx, dy) < pad) { hit = true; break; }
          }
        } else if (mk.type === "polyline_annot" && mk.polyPoints && mk.polyPoints.length > 1) {
          for (let j = 0; j < mk.polyPoints.length - 1; j++) {
            const a = mk.polyPoints[j], b = mk.polyPoints[j + 1];
            const abx = b.x - a.x, aby = b.y - a.y;
            const apx = pt.x - a.x, apy = pt.y - a.y;
            const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby || 1)));
            const dx = a.x + t * abx - pt.x, dy = a.y + t * aby - pt.y;
            if (Math.hypot(dx, dy) < pad) { hit = true; break; }
          }
        } else {
          const x0 = Math.min(mk.x1, mk.x2), y0 = Math.min(mk.y1, mk.y2);
          const x1 = Math.max(mk.x1, mk.x2), y1 = Math.max(mk.y1, mk.y2);
          hit = pt.x >= x0 - pad && pt.x <= x1 + pad && pt.y >= y0 - pad && pt.y <= y1 + pad;
        }
        if (hit) { clearAll(); setSelectedMarkupId(mk.id); return; }
      }
      // 2. Check text annotations
      for (const ta of textAnnotations) {
        if (Math.abs(pt.x - ta.x) < 0.05 && Math.abs(pt.y - ta.y) < 0.03) {
          clearAll(); setSelectedTextId(ta.id); return;
        }
      }
      // 3. Check circles
      for (const cm of circleMeasures) {
        const dist = Math.hypot(pt.x - cm.center.x, pt.y - cm.center.y);
        const edgeDist = Math.hypot(cm.edgePoint.x - cm.center.x, cm.edgePoint.y - cm.center.y);
        if (dist < edgeDist + 0.02) {
          clearAll(); setSelectedCircleId(cm.id); return;
        }
      }
      // 4. Check zones
      const hitZone = [...zones].reverse().find(z => pointInPolygon(pt, z.points));
      if (hitZone) { clearAll(); onSelectedZoneIdChange?.(hitZone.id); return; }
      // 5. Check linears
      const hitLinearId = findNearestLinear(pt);
      if (hitLinearId) { clearAll(); onSelectedLinearIdChange?.(hitLinearId); return; }
      // Nothing hit → deselect all
      clearAll();
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
      setTextInputPos(pt);
      setTextInputValue("");
    } else if (tool === "arrow" || tool === "mk_line" || tool === "rect_annot" || tool === "ellipse" || tool === "highlight") {
      // 2-click tools: start → end
      if (!mkStart) {
        setMkStart(pt);
      } else {
        const c = activeColorRef.current || "#3B82F6";
        const mkType: MarkupType = tool === "arrow" ? "arrow" : tool === "mk_line" ? "line" : tool === "rect_annot" ? "rect_annot" : tool === "ellipse" ? "ellipse" : "highlight";
        onMarkupAnnotationsChange?.([...markupAnnotations, {
          id: crypto.randomUUID(), type: mkType, color: c, layer: activeLayerId,
          x1: mkStart.x, y1: mkStart.y, x2: pt.x, y2: pt.y,
          lineWidth: 2, opacity: mkType === "highlight" ? 0.35 : 1,
          fillOpacity: mkType === "highlight" ? 0.35 : 0.15,
          fillColor: c,
        }]);
        setMkStart(null);
      }
    } else if (tool === "callout") {
      if (!mkStart) {
        setMkStart(pt);
      } else {
        setCalloutInputPos({ start: mkStart, end: pt });
        setCalloutInputValue("");
        setMkStart(null);
      }
    } else if (tool === "cloud") {
      if (!mkStart) {
        setMkStart(pt);
      } else {
        const c = activeColorRef.current || "#3B82F6";
        onMarkupAnnotationsChange?.([...markupAnnotations, {
          id: crypto.randomUUID(), type: "cloud", color: c, layer: activeLayerId,
          x1: Math.min(mkStart.x, pt.x), y1: Math.min(mkStart.y, pt.y),
          x2: Math.max(mkStart.x, pt.x), y2: Math.max(mkStart.y, pt.y),
          lineWidth: 2, opacity: 1, fillOpacity: 0.08, fillColor: c,
        }]);
        setMkStart(null);
      }
    } else if (tool === "stamp") {
      onMarkupAnnotationsChange?.([...markupAnnotations, {
        id: crypto.randomUUID(), type: "stamp", color: "#EF4444", layer: activeLayerId,
        x1: Math.max(0, pt.x - 0.04), y1: Math.max(0, pt.y - 0.015),
        x2: Math.min(1, pt.x + 0.04), y2: Math.min(1, pt.y + 0.015),
        stampKind: activeStamp, lineWidth: 2, opacity: 0.9,
      }]);
    } else if (tool === "pen") {
      // Pen: handled via mousedown/move/up, not click
    } else if (tool === "lasso") {
      // Lasso: handled via mousedown/move/up for drag selection
    } else if (tool === "note") {
      // Sticky note: click to place, opens text input
      setTextInputPos(pt);
      setTextInputValue("");
      // Will create a "note" markup instead of TextAnnotation
    } else if (tool === "dimension") {
      // Dimension line: 2-click like arrow but with measurement label
      if (!mkStart) {
        setMkStart(pt);
      } else {
        const c = activeColorRef.current || "#3B82F6";
        // Calculate dimension value
        let dimVal = "";
        if (ppm && naturalSize.w > 0) {
          const dx = (pt.x - mkStart.x) * naturalSize.w;
          const dy = (pt.y - mkStart.y) * naturalSize.h;
          const lenM = Math.sqrt(dx * dx + dy * dy) / ppm;
          dimVal = fmtLinear(lenM, displayUnit);
        }
        onMarkupAnnotationsChange?.([...markupAnnotations, {
          id: crypto.randomUUID(), type: "dimension", color: c, layer: activeLayerId,
          x1: mkStart.x, y1: mkStart.y, x2: pt.x, y2: pt.y,
          dimensionValue: dimVal, lineWidth: 1.5, opacity: 1,
        }]);
        setMkStart(null);
      }
    } else if (tool === "eraser") {
      if (eraserMode === "click") {
        // Click mode: delete element under cursor
        const hitZ = [...zones].reverse().find(z => pointInPolygon(pt, z.points));
        if (hitZ) { onHistoryPush?.(zones); onZonesChange(zones.filter(z => z.id !== hitZ.id)); return; }
        for (let i = markupAnnotations.length - 1; i >= 0; i--) {
          const mk = markupAnnotations[i];
          const pad = 0.015;
          let hit = false;
          if (mk.type === "pen" && mk.penPoints) {
            for (let j = 0; j < mk.penPoints.length - 1; j++) {
              const a = mk.penPoints[j], b = mk.penPoints[j + 1];
              const abx = b.x - a.x, aby = b.y - a.y;
              const apx = pt.x - a.x, apy = pt.y - a.y;
              const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby || 1)));
              if (Math.hypot(a.x + t * abx - pt.x, a.y + t * aby - pt.y) < pad) { hit = true; break; }
            }
          } else {
            const x0 = Math.min(mk.x1, mk.x2), y0 = Math.min(mk.y1, mk.y2);
            const x1 = Math.max(mk.x1, mk.x2), y1 = Math.max(mk.y1, mk.y2);
            hit = pt.x >= x0 - pad && pt.x <= x1 + pad && pt.y >= y0 - pad && pt.y <= y1 + pad;
          }
          if (hit) { onMarkupAnnotationsChange?.(markupAnnotations.filter(m => m.id !== mk.id)); return; }
        }
        for (const cm of circleMeasures) {
          const dist = Math.hypot(pt.x - cm.center.x, pt.y - cm.center.y);
          const edgeDist = Math.hypot(cm.edgePoint.x - cm.center.x, cm.edgePoint.y - cm.center.y);
          if (dist < edgeDist + 0.02) { onCircleMeasuresChange?.(circleMeasures.filter(c => c.id !== cm.id)); return; }
        }
        const hitLin = findNearestLinear(pt);
        if (hitLin) { onLinearMeasuresChange?.(linearMeasures.filter(m => m.id !== hitLin)); return; }
        for (const cp of countPoints) {
          if (Math.hypot(pt.x - cp.x, pt.y - cp.y) < 0.02) { onCountPointsChange?.(countPoints.filter(p => p.id !== cp.id)); return; }
        }
      } else if (eraserMode === "rect") {
        // Rect eraser: 2 clicks define area → subtract shape from zones, delete other elements inside
        if (!eraserStart) { setEraserStart(pt); }
        else {
          const eraserPoly = rectToPolygon(eraserStart, pt);
          const inBox = (px: number, py: number) => {
            const x0 = Math.min(eraserStart.x, pt.x), y0 = Math.min(eraserStart.y, pt.y);
            const x1 = Math.max(eraserStart.x, pt.x), y1 = Math.max(eraserStart.y, pt.y);
            return px >= x0 && px <= x1 && py >= y0 && py <= y1;
          };
          onHistoryPush?.(zones);
          // Boolean subtract from surface zones
          onZonesChange(subtractEraserFromZones(zones, eraserPoly));
          // Delete other elements whose centroid is inside
          onMarkupAnnotationsChange?.(markupAnnotations.filter(m => { const cx = (m.x1 + m.x2) / 2, cy = (m.y1 + m.y2) / 2; return !inBox(cx, cy); }));
          onCircleMeasuresChange?.(circleMeasures.filter(c => !inBox(c.center.x, c.center.y)));
          onLinearMeasuresChange?.(linearMeasures.filter(m => { const cx = m.points.reduce((s, p) => s + p.x, 0) / m.points.length; const cy = m.points.reduce((s, p) => s + p.y, 0) / m.points.length; return !inBox(cx, cy); }));
          onCountPointsChange?.(countPoints.filter(p => !inBox(p.x, p.y)));
          setEraserStart(null);
        }
      } else if (eraserMode === "circle") {
        // Circle eraser: 2 clicks (center + edge) → subtract circle from zones
        if (!eraserStart) { setEraserStart(pt); }
        else {
          const eraserPoly = circleToPolygon(eraserStart, pt);
          const r = Math.hypot(pt.x - eraserStart.x, pt.y - eraserStart.y);
          const inCircle = (px: number, py: number) => Math.hypot(px - eraserStart.x, py - eraserStart.y) <= r;
          onHistoryPush?.(zones);
          // Boolean subtract from surface zones
          onZonesChange(subtractEraserFromZones(zones, eraserPoly));
          // Delete other elements whose centroid is inside
          onMarkupAnnotationsChange?.(markupAnnotations.filter(m => !inCircle((m.x1 + m.x2) / 2, (m.y1 + m.y2) / 2)));
          onCircleMeasuresChange?.(circleMeasures.filter(c => !inCircle(c.center.x, c.center.y)));
          onLinearMeasuresChange?.(linearMeasures.filter(m => { const cx = m.points.reduce((s, p) => s + p.x, 0) / m.points.length; const cy = m.points.reduce((s, p) => s + p.y, 0) / m.points.length; return !inCircle(cx, cy); }));
          onCountPointsChange?.(countPoints.filter(p => !inCircle(p.x, p.y)));
          setEraserStart(null);
        }
      } else if (eraserMode === "polygon") {
        // Polygon eraser: click to add points, double-click to finalize
        setEraserDrawingPoly(prev => [...prev, pt]);
      }
      return;
    } else if (tool === "polyline_annot") {
      // Polyline annotation: multi-click, Enter to finish
      setLinearDrawingPts(prev => { const next = [...prev, pt]; linearDrawingPtsRef.current = next; return next; });
    }
  }, [tool, toNorm, nearFirst, drawingPoints, addZone, anglePts, splitPts, onHistoryPush, vsEditMode, vsMatches, onVsMatchesChange, scalePts, scaleInputOpen, linearDrawingPts, activeCountGroupId, countPoints, onCountPointsChange, zones, findNearestLinear, onSelectedZoneIdChange, onSelectedLinearIdChange, circleCenter, circleMeasures, onCircleMeasuresChange, activeLinearCategoryId, angleMeasurements, onAngleMeasurementsChange, mkStart, markupAnnotations, onMarkupAnnotationsChange, activeStamp, textAnnotations, onTextAnnotationsChange, ppm, naturalSize, displayUnit]);

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
    } else if (tool === "eraser" && eraserMode === "polygon" && eraserDrawingPoly.length >= 3) {
      e.preventDefault();
      const poly = eraserDrawingPoly.slice(0, -1); // remove dblclick duplicate
      if (poly.length >= 3) {
        onHistoryPush?.(zones);
        // Boolean subtract polygon from surface zones
        onZonesChange(subtractEraserFromZones(zones, poly));
        // Delete other elements whose centroid is inside the polygon
        onMarkupAnnotationsChange?.(markupAnnotations.filter(m => !pointInPolygon({ x: (m.x1 + m.x2) / 2, y: (m.y1 + m.y2) / 2 }, poly)));
        onCircleMeasuresChange?.(circleMeasures.filter(c => !pointInPolygon(c.center, poly)));
        onCountPointsChange?.(countPoints.filter(p => !pointInPolygon({ x: p.x, y: p.y }, poly)));
        onLinearMeasuresChange?.(linearMeasures.filter(m => { const cx = m.points.reduce((s, p) => s + p.x, 0) / m.points.length; const cy = m.points.reduce((s, p) => s + p.y, 0) / m.points.length; return !pointInPolygon({ x: cx, y: cy }, poly); }));
      }
      setEraserDrawingPoly([]);
    }
  }, [tool, addZone, linearDrawingPts, linearMeasures, onLinearMeasuresChange, activeLinearCategoryId, eraserMode, eraserDrawingPoly, zones, markupAnnotations, circleMeasures, countPoints, onHistoryPush, onZonesChange, onMarkupAnnotationsChange, onCircleMeasuresChange, onCountPointsChange, onLinearMeasuresChange]);

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
    // Lasso: finalize multi-select — select zones whose centroid falls in the lasso rect
    if (tool === "lasso" && lassoStart) {
      const n = toNorm(e.clientX, e.clientY);
      if (n) {
        const x0 = Math.min(lassoStart.x, n.x), y0 = Math.min(lassoStart.y, n.y);
        const x1 = Math.max(lassoStart.x, n.x), y1 = Math.max(lassoStart.y, n.y);
        if (x1 - x0 > 0.005 && y1 - y0 > 0.005) {
          const hits = new Set<string>();
          for (const z of zones) {
            const cx = z.points.reduce((s, p) => s + p.x, 0) / z.points.length;
            const cy = z.points.reduce((s, p) => s + p.y, 0) / z.points.length;
            if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) hits.add(z.id);
          }
          setSelectedZoneIds(hits);
          if (hits.size === 1) { onSelectedZoneIdChange?.(Array.from(hits)[0]); }
        }
      }
      setLassoStart(null);
      setLassoEnd(null);
    }
  }, [dragVertex, tool, rectStart, wallStart, wallThicknessCm, naturalSize, ppm, toNorm, addZone, vsCropStart, vsEditMode, onEnsureSession, onVsMatchesChange, lassoStart, zones, onSelectedZoneIdChange]);

  // Sync touch refs after these callbacks are (re)created
  useEffect(() => { addZoneRef.current = addZone; }, [addZone]);
  useEffect(() => { nearFirstRef.current = nearFirst; }, [nearFirst]);

  const cancelDrawing = useCallback(() => { drawingPointsRef.current = []; setDrawingPoints([]); setRectStart(null); setWallStart(null); setAnglePts([]); setSplitPts([]); setVsCropStart(null); setScalePts([]); setScaleInputOpen(false); linearDrawingPtsRef.current = []; setLinearDrawingPts([]); setCircleCenter(null); setTextInputPos(null); setTextInputValue(""); setMkStart(null); setPenDrawing([]); penDrawingRef.current = []; setCalloutInputPos(null); setCalloutInputValue(""); setLassoStart(null); setLassoEnd(null); setEraserStart(null); setEraserDrawingPoly([]); }, []);
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

      // ── Escape → cancel drawing + deselect ALL ──
      if (e.key === "Escape") {
        cancelDrawing();
        onSelectedZoneIdChange?.(null);
        onSelectedLinearIdChange?.(null);
        setSelectedMarkupId(null);
        setSelectedTextId(null);
        setSelectedCircleId(null);
        setSelectedZoneIds(new Set());
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
      if (e.key === "Enter" && tool === "polyline_annot") {
        e.preventDefault();
        const latest = linearDrawingPtsRef.current;
        if (latest.length >= 2 && onMarkupAnnotationsChange) {
          const c = activeColorRef.current || "#3B82F6";
          onMarkupAnnotationsChange([...markupAnnotations, {
            id: crypto.randomUUID(), type: "polyline_annot", color: c, layer: activeLayerId,
            x1: latest[0].x, y1: latest[0].y, x2: latest[latest.length - 1].x, y2: latest[latest.length - 1].y,
            polyPoints: [...latest], lineWidth: 2, opacity: 1,
          }]);
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

      // ── Copy (Ctrl+C) — copy selected element to clipboard ──
      if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        if (selectedZoneId) { clipboardRef.current = { kind: "zone", data: zonesRef.current.find(z => z.id === selectedZoneId) }; }
        else if (selectedLinearId) { clipboardRef.current = { kind: "linear", data: linearMeasuresRef.current.find(m => m.id === selectedLinearId) }; }
        else if (selectedMarkupId) { clipboardRef.current = { kind: "markup", data: markupAnnotationsRef.current.find(m => m.id === selectedMarkupId) }; }
        else if (selectedTextId) { clipboardRef.current = { kind: "text", data: textAnnotationsRef.current.find(t => t.id === selectedTextId) }; }
        else if (selectedCircleId) { clipboardRef.current = { kind: "circle", data: circleMeasuresRef.current.find(c => c.id === selectedCircleId) }; }
        return;
      }

      // ── Paste (Ctrl+V) — paste from clipboard with offset ──
      if ((e.ctrlKey || e.metaKey) && e.key === "v" && clipboardRef.current) {
        e.preventDefault();
        const { kind, data } = clipboardRef.current;
        const off = 0.02;
        if (kind === "zone" && data) {
          onHistoryPush?.(zonesRef.current);
          const dup = { ...data, id: crypto.randomUUID(), name: data.name ? `${data.name} (copie)` : undefined, points: data.points.map((p: any) => ({ x: p.x + off, y: p.y + off })) };
          onZonesChangeRef.current([...zonesRef.current, dup]);
          onSelectedZoneIdChange?.(dup.id);
        } else if (kind === "linear" && data) {
          const dup = { ...data, id: crypto.randomUUID(), points: data.points.map((p: any) => ({ x: p.x + off, y: p.y + off })) };
          onLinearMeasuresChangeRef.current?.([...linearMeasuresRef.current, dup]);
          onSelectedLinearIdChange?.(dup.id);
        } else if (kind === "markup" && data) {
          const dup = { ...data, id: crypto.randomUUID(), x1: data.x1 + off, y1: data.y1 + off, x2: data.x2 + off, y2: data.y2 + off,
            ...(data.penPoints ? { penPoints: data.penPoints.map((p: any) => ({ x: p.x + off, y: p.y + off })) } : {}),
            ...(data.polyPoints ? { polyPoints: data.polyPoints.map((p: any) => ({ x: p.x + off, y: p.y + off })) } : {}),
          };
          onMarkupAnnotationsChangeRef.current?.([...markupAnnotationsRef.current, dup]);
          setSelectedMarkupId(dup.id);
        } else if (kind === "text" && data) {
          const dup = { ...data, id: crypto.randomUUID(), x: data.x + off, y: data.y + off };
          onTextAnnotationsChangeRef.current?.([...textAnnotationsRef.current, dup]);
          setSelectedTextId(dup.id);
        } else if (kind === "circle" && data) {
          const dup = { ...data, id: crypto.randomUUID(), center: { x: data.center.x + off, y: data.center.y + off }, edgePoint: { x: data.edgePoint.x + off, y: data.edgePoint.y + off } };
          onCircleMeasuresChangeRef.current?.([...circleMeasuresRef.current, dup]);
          setSelectedCircleId(dup.id);
        }
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

      // ── Group selected zones (Ctrl+G) ──
      if ((e.ctrlKey || e.metaKey) && e.key === "g" && !e.shiftKey && selectedZoneIds.size > 1) {
        e.preventDefault();
        const groupId = crypto.randomUUID();
        const newGroup: MarkupGroup = { id: groupId, memberIds: Array.from(selectedZoneIds) };
        onMarkupGroupsChange?.([...markupGroups, newGroup]);
        // Tag zones with groupId
        onZonesChangeRef.current(zonesRef.current.map(z =>
          selectedZoneIds.has(z.id) ? { ...z, groupId } : z
        ));
        return;
      }
      // ── Ungroup (Ctrl+Shift+G) ──
      if ((e.ctrlKey || e.metaKey) && e.key === "G" && e.shiftKey && selectedZoneId) {
        e.preventDefault();
        const zone = zonesRef.current.find(z => z.id === selectedZoneId);
        if (zone?.groupId) {
          const gid = zone.groupId;
          onMarkupGroupsChange?.(markupGroups.filter(g => g.id !== gid));
          onZonesChangeRef.current(zonesRef.current.map(z =>
            z.groupId === gid ? { ...z, groupId: undefined } : z
          ));
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
      if ((e.key === "Delete" || e.key === "Backspace") && selectedMarkupId) {
        e.preventDefault();
        onMarkupAnnotationsChangeRef.current?.(markupAnnotationsRef.current.filter(m => m.id !== selectedMarkupId));
        setSelectedMarkupId(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedTextId) {
        e.preventDefault();
        onTextAnnotationsChangeRef.current?.(textAnnotationsRef.current.filter(t => t.id !== selectedTextId));
        setSelectedTextId(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedCircleId) {
        e.preventDefault();
        onCircleMeasuresChangeRef.current?.(circleMeasuresRef.current.filter(c => c.id !== selectedCircleId));
        setSelectedCircleId(null);
        return;
      }

      // ── Arrow key nudge selected element ──
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && (selectedZoneId || selectedMarkupId || selectedTextId || selectedCircleId)) {
        e.preventDefault();
        const step = e.shiftKey ? 0.01 : 0.002;
        const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
        const dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
        if (selectedZoneId) {
          if (!nudgeActiveRef.current) { onHistoryPush?.(zonesRef.current); nudgeActiveRef.current = true; }
          onZonesChangeRef.current(zonesRef.current.map(z =>
            z.id !== selectedZoneId ? z : { ...z, points: z.points.map(p => ({ x: p.x + dx, y: p.y + dy })) }
          ));
        } else if (selectedMarkupId) {
          onMarkupAnnotationsChangeRef.current?.(markupAnnotationsRef.current.map(m =>
            m.id !== selectedMarkupId ? m : { ...m, x1: m.x1 + dx, y1: m.y1 + dy, x2: m.x2 + dx, y2: m.y2 + dy,
              ...(m.penPoints ? { penPoints: m.penPoints.map(p => ({ x: p.x + dx, y: p.y + dy })) } : {}),
              ...(m.polyPoints ? { polyPoints: m.polyPoints.map(p => ({ x: p.x + dx, y: p.y + dy })) } : {}),
            }
          ));
        } else if (selectedTextId) {
          onTextAnnotationsChangeRef.current?.(textAnnotationsRef.current.map(t =>
            t.id !== selectedTextId ? t : { ...t, x: t.x + dx, y: t.y + dy }
          ));
        } else if (selectedCircleId) {
          onCircleMeasuresChangeRef.current?.(circleMeasuresRef.current.map(c =>
            c.id !== selectedCircleId ? c : { ...c, center: { x: c.center.x + dx, y: c.center.y + dy }, edgePoint: { x: c.edgePoint.x + dx, y: c.edgePoint.y + dy } }
          ));
        }
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
        const switchTool = (t: Tool) => { setTool(t); cancelDrawing(); onSelectedZoneIdChange?.(null); onSelectedLinearIdChange?.(null); setSelectedMarkupId(null); setSelectedTextId(null); setSelectedCircleId(null); };
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
          // Markup tools
          case "f": switchTool("arrow"); break;     // F = flèche
          case "n": switchTool("callout"); break;   // N = note
          case "k": switchTool("cloud"); break;     // K = cloud (nuage)
          case "h": switchTool("highlight"); break; // H = highlight
          case "d": if (!e.ctrlKey && !e.metaKey) switchTool("pen"); break; // D = draw (pen)
          case "b": switchTool("stamp"); break;     // B = tampon (Badge)
          case "e": switchTool("ellipse"); break;   // E = ellipse
          case "j": switchTool("mk_line"); break;   // J = ligne
          case "g": setShowGrid(v => !v); break;   // G = grid toggle
          case "x": switchTool("eraser"); break;   // X = eraser
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
  }, [cancelDrawing, drawingPoints, anglePts, onHistoryUndo, onHistoryRedo, tool, addZone, selectedZoneId, selectedLinearId, onHistoryPush, onSelectedZoneIdChange, onSelectedLinearIdChange, linearMeasures, activeLinearCategoryId, onLinearMeasuresChange, selectedMarkupId, selectedTextId, selectedCircleId, markupGroups, onMarkupGroupsChange, selectedZoneIds]);

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
  useEffect(() => { activeColorRef.current = activeColor; }, [activeColor]);

  const hint = dragZoneRef.current ? "Glissez pour repositionner la zone · relâchez pour valider"
    : dragVertex ? "Glissez pour repositionner le sommet · relâchez pour valider"
    : spacebarPan ? "Relâchez Espace pour revenir à l'outil"
    : tool === "select"
    ? selectedZoneId
      ? "Zone sélectionnée · Glissez pour déplacer · Ctrl+D dupliquer · Flèches ajuster · Suppr supprimer"
      : selectedLinearId
      ? "Linéaire sélectionné · Glissez un vertex pour éditer · Suppr supprimer"
      : selectedMarkupId
      ? "Annotation sélectionnée · Glissez pour déplacer · Suppr supprimer"
      : selectedTextId
      ? "Texte sélectionné · Glissez pour déplacer · Suppr supprimer"
      : selectedCircleId
      ? "Cercle sélectionné · Glissez pour déplacer · Suppr supprimer"
      : "Cliquez un élément pour le sélectionner · Glissez pour déplacer · Suppr supprimer"
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
    : tool === "eraser"
    ? "Cliquez sur un élément pour le supprimer · fonctionne sur tous les types"
    : "Cliquez et glissez pour dessiner un rectangle";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-2">

      {/* ══ BAR 1 : CALQUES ══ */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 glass rounded-xl border border-white/10 shrink-0 min-w-0 overflow-x-auto overflow-y-visible">
        <Layers size={12} className="text-blue-400 shrink-0" />
        <span className="text-[9px] text-blue-400 uppercase tracking-wider font-semibold mr-1 shrink-0">{d("sv_layers" as DTKey)}</span>

        {/* ── Inline layer buttons ── */}
        {layers.map(lyr => (
          <button key={lyr.id}
            onClick={() => onActiveLayerIdChange?.(lyr.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${
              activeLayerId === lyr.id
                ? "border-blue-500/40 bg-blue-500/15 text-white shadow-sm shadow-blue-500/10"
                : "border-white/5 text-slate-500 hover:text-slate-300 hover:border-white/10 hover:bg-white/5"
            }`}>
            <span className={`w-2.5 h-2.5 rounded-full ring-1 shrink-0 ${activeLayerId === lyr.id ? "ring-white/30" : "ring-white/10"}`} style={{ background: lyr.color }} />
            <span className="truncate max-w-20">{lyr.name}</span>
            {lyr.locked && <Lock className="w-2.5 h-2.5 text-red-400 shrink-0" />}
            {!lyr.visible && <EyeOff className="w-2.5 h-2.5 text-slate-600 shrink-0" />}
          </button>
        ))}

        {/* Create new layer */}
        <button onClick={() => { setNewLayerName(""); setNewLayerColor("#" + Math.floor(Math.random()*16777215).toString(16).padStart(6,"0")); setNewLayerModalOpen(true); }}
          title={d("mc_create_layer" as DTKey)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] border border-dashed border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:border-blue-500/50 transition-all">
          {d("mc_new_layer" as DTKey)}
        </button>

        {/* Manage layers (open panel) */}
        <button onClick={() => setShowLayersPanel(v => !v)} title={d("mc_manage_layers" as DTKey)}
          className={`p-1 rounded text-slate-500 hover:text-blue-400 transition-colors ${showLayersPanel ? "text-blue-400 bg-blue-500/10" : ""}`}>
          <Wrench size={11} />
        </button>

        {/* ── Right side: just undo/redo ── */}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={undoLast} title={d("common_undo" as DTKey)}
            disabled={drawingPoints.length === 0 && !canUndo}
            className="p-1 rounded text-slate-400 hover:text-white transition-colors disabled:opacity-30">
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onHistoryRedo?.()} title={d("common_redo" as DTKey)}
            disabled={!canRedo}
            className="p-1 rounded text-slate-400 hover:text-white transition-colors disabled:opacity-30">
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ══ BAR 2 : SURFACES ══ */}
      <div className="relative z-20 flex items-center gap-1 px-2.5 py-1.5 glass rounded-xl border border-white/10 shrink-0 flex-wrap text-xs min-w-0">
        <span className="text-[9px] text-accent uppercase tracking-wider font-semibold mr-0.5 shrink-0">{d("mc_surfaces" as DTKey)}</span>

        {/* ── Selection ── */}
        <button onClick={() => { setTool("select"); cancelDrawing(); }} title={d("mc_tool_select" as DTKey)}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            tool === "select" ? "bg-violet-500/20 border border-violet-500/40 text-violet-300" : "text-slate-400 hover:text-white"}`}>
          <MousePointer2 className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-5 bg-white/10 shrink-0 mx-0.5" />

        {/* ── Drawing tools ── */}
        <button onClick={() => { setTool("polygon"); cancelDrawing(); }} title={d("mc_tool_polygon" as DTKey)}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            tool === "polygon" ? "bg-accent text-white" : "text-slate-400 hover:text-white"}`}>
          <Pentagon className="w-3.5 h-3.5" /> {d("mc_tool_polygon" as DTKey)}
        </button>
        <button onClick={() => { setTool("rect"); cancelDrawing(); }} title={d("mc_tool_rect" as DTKey)}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            tool === "rect" ? "bg-accent text-white" : "text-slate-400 hover:text-white"}`}>
          <Square className="w-3.5 h-3.5" /> {d("mc_tool_rect" as DTKey)}
        </button>
        <button onClick={() => { setTool("angle"); cancelDrawing(); }} title={d("mc_tool_angle" as DTKey)}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            tool === "angle" ? "bg-amber-500 text-white" : "text-slate-400 hover:text-white"}`}>
          <Spline className="w-3.5 h-3.5" /> {d("mc_tool_angle" as DTKey)}
        </button>
        <button onClick={() => { setTool("wall"); cancelDrawing(); }} title={d("mc_tool_wall" as DTKey)}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            tool === "wall" ? "bg-orange-500/20 border border-orange-500/40 text-orange-300" : "text-slate-400 hover:text-white"}`}>
          <Ruler className="w-3.5 h-3.5" /> {d("mc_tool_wall" as DTKey)}
        </button>
        {onPpmChange && (
          <button onClick={() => { setTool("scale"); setScalePts([]); setScaleInputOpen(false); cancelDrawing(); }}
            title={d("mc_tool_scale" as DTKey)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tool === "scale" ? "bg-yellow-500/20 border border-yellow-500/40 text-yellow-300"
                : !ppm ? "text-yellow-400 hover:text-yellow-300" : "text-slate-400 hover:text-white"}`}>
            <Ruler className="w-3.5 h-3.5" /> {d("mc_tool_scale" as DTKey)}
          </button>
        )}
        <button onClick={() => { setTool("split"); cancelDrawing(); }} title={d("mc_tool_split" as DTKey)}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            tool === "split" ? "bg-red-500/20 border border-red-500/40 text-red-300" : "text-slate-400 hover:text-white"}`}>
          <Scissors className="w-3.5 h-3.5" /> {d("mc_tool_split" as DTKey)}
        </button>
        <button onClick={() => { setTool("visual_search"); cancelDrawing(); setVsEditMode("search"); }} title={d("mc_tool_search" as DTKey)}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            tool === "visual_search" ? "bg-cyan-500/20 border border-cyan-500/40 text-cyan-300" : "text-slate-400 hover:text-white"}`}>
          <Search className="w-3.5 h-3.5" /> {d("mc_tool_search" as DTKey)}
        </button>
        {onLinearMeasuresChange && (
          <button onClick={() => { setTool("linear"); cancelDrawing(); }} title={d("mc_tool_linear" as DTKey)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tool === "linear" ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-300" : "text-slate-400 hover:text-white"}`}>
            <Ruler className="w-3.5 h-3.5" /> {d("mc_tool_linear" as DTKey)}
          </button>
        )}
        {onCountPointsChange && (
          <button onClick={() => { setTool("count"); cancelDrawing(); }} title={d("mc_tool_count" as DTKey)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tool === "count" ? "bg-pink-500/20 border border-pink-500/40 text-pink-300" : "text-slate-400 hover:text-white"}`}>
            <span className="font-bold text-xs">#</span> {d("mc_tool_count" as DTKey)}
          </button>
        )}
        {onTextAnnotationsChange && (
          <button onClick={() => { setTool("text"); cancelDrawing(); }} title={d("mc_tool_text" as DTKey)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tool === "text" ? "bg-sky-500/20 border border-sky-500/40 text-sky-300" : "text-slate-400 hover:text-white"}`}>
            <Type className="w-3.5 h-3.5" /> {d("mc_tool_text" as DTKey)}
          </button>
        )}

        <div className="w-px h-5 bg-white/10 shrink-0 mx-0.5" />

        {/* ── Dessin libre (dropdown) ── */}
        {onMarkupAnnotationsChange && (
          <div className="relative">
            <button onClick={() => { setShowAnnotDropdown(v => !v); setShowEraserDropdown(false); }}
              title={d("mc_freedraw" as DTKey)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                showAnnotDropdown || ["arrow","mk_line","callout","cloud","rect_annot","ellipse","highlight","pen","stamp","note","dimension"].includes(tool)
                  ? "bg-rose-500/20 border-rose-500/40 text-rose-300" : "border-transparent text-slate-400 hover:text-white"}`}>
              <Pen className="w-3.5 h-3.5" /> {d("mc_freedraw" as DTKey)}
              <span className="text-[8px] opacity-60">▾</span>
            </button>
            {showAnnotDropdown && (
              <div className="absolute top-full left-0 mt-1 z-50 glass border border-rose-500/20 rounded-xl p-2 shadow-2xl min-w-48 pointer-events-auto"
                onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                <p className="text-[9px] text-rose-400 uppercase tracking-wider font-semibold mb-1.5 px-1">{d("mc_freedraw" as DTKey)}</p>
                <div className="flex flex-col gap-0.5">
                  {([
                    { t: "polygon" as Tool, icon: <Pentagon className="w-3.5 h-3.5" />, label: d("mc_mk_polygon" as DTKey), c: "accent" },
                    { t: "arrow" as Tool, icon: <ArrowRight className="w-3.5 h-3.5" />, label: d("mc_mk_arrow" as DTKey), c: "rose" },
                    { t: "mk_line" as Tool, icon: <Minus className="w-3.5 h-3.5" />, label: d("mc_mk_line" as DTKey), c: "rose" },
                    { t: "callout" as Tool, icon: <MessageSquare className="w-3.5 h-3.5" />, label: d("mc_mk_callout" as DTKey), c: "rose" },
                    { t: "cloud" as Tool, icon: <Cloud className="w-3.5 h-3.5" />, label: d("mc_mk_cloud" as DTKey), c: "rose" },
                    { t: "rect_annot" as Tool, icon: <Square className="w-3.5 h-3.5" />, label: d("mc_mk_rect" as DTKey), c: "rose" },
                    { t: "ellipse" as Tool, icon: <CircleDot className="w-3.5 h-3.5" />, label: d("mc_mk_ellipse" as DTKey), c: "rose" },
                    { t: "highlight" as Tool, icon: <Highlighter className="w-3.5 h-3.5" />, label: d("mc_mk_highlight" as DTKey), c: "yellow" },
                    { t: "pen" as Tool, icon: <Pen className="w-3.5 h-3.5" />, label: d("mc_mk_pen" as DTKey), c: "rose" },
                    { t: "stamp" as Tool, icon: <Stamp className="w-3.5 h-3.5" />, label: d("mc_mk_stamp" as DTKey), c: "red" },
                    { t: "note" as Tool, icon: <MessageSquare className="w-3.5 h-3.5" style={{ fill: "currentColor" }} />, label: d("mc_mk_note" as DTKey), c: "yellow" },
                    { t: "dimension" as Tool, icon: <Ruler className="w-3.5 h-3.5" />, label: d("mc_mk_dimension" as DTKey), c: "rose" },
                  ] as Array<{ t: Tool; icon: any; label: string; c: string }>).map(({ t, icon, label }) => (
                    <button key={t} onClick={() => { setTool(t); cancelDrawing(); setShowAnnotDropdown(false); }}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors w-full text-left ${
                        tool === t ? "bg-rose-500/15 text-rose-300" : "text-slate-400 hover:text-white hover:bg-white/5"}`}>
                      {icon} {label}
                    </button>
                  ))}
                </div>
                {tool === "stamp" && (
                  <div className="mt-2 pt-2 border-t border-white/10">
                    <select value={activeStamp} onChange={e => setActiveStamp(e.target.value as StampKind)}
                      className="w-full bg-white/5 text-xs text-red-300 font-mono border border-red-500/30 rounded-lg px-2 py-1 outline-none">
                      {(Object.keys(STAMP_LABELS) as StampKind[]).map(k => (
                        <option key={k} value={k} className="bg-slate-900">{STAMP_LABELS[k].fr}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Gommage (dropdown) ── */}
        <div className="relative">
          <button onClick={() => { setShowEraserDropdown(v => !v); setShowAnnotDropdown(false); }}
            title={d("mc_eraser" as DTKey)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              showEraserDropdown || tool === "eraser"
                ? "bg-red-500/20 border-red-500/40 text-red-400" : "border-transparent text-slate-400 hover:text-white"}`}>
            <Trash2 className="w-3.5 h-3.5" /> {d("mc_eraser" as DTKey)}
            <span className="text-[8px] opacity-60">▾</span>
          </button>
          {showEraserDropdown && (
            <div className="absolute top-full left-0 mt-1 z-50 glass border border-red-500/20 rounded-xl p-2 shadow-2xl min-w-44 pointer-events-auto"
              onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
              <p className="text-[9px] text-red-400 uppercase tracking-wider font-semibold mb-1.5 px-1">{d("mc_eraser" as DTKey)}</p>
              <div className="flex flex-col gap-0.5">
                {([
                  { mode: "click" as const, icon: <Trash2 className="w-3.5 h-3.5" />, label: d("mc_eraser_click" as DTKey) },
                  { mode: "rect" as const, icon: <Square className="w-3.5 h-3.5" />, label: d("mc_mk_rect" as DTKey) },
                  { mode: "polygon" as const, icon: <Pentagon className="w-3.5 h-3.5" />, label: d("mc_mk_polygon" as DTKey) },
                  { mode: "circle" as const, icon: <CircleDot className="w-3.5 h-3.5" />, label: d("ml_kind_circle" as DTKey) },
                ] as Array<{ mode: "click" | "rect" | "polygon" | "circle"; icon: any; label: string }>).map(({ mode, icon, label }) => (
                  <button key={mode} onClick={() => { setTool("eraser"); setEraserMode(mode); cancelDrawing(); setShowEraserDropdown(false); }}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors w-full text-left ${
                      tool === "eraser" && eraserMode === mode ? "bg-red-500/15 text-red-400" : "text-slate-400 hover:text-white hover:bg-white/5"}`}>
                    {icon} {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-white/10 shrink-0 mx-0.5" />

        {/* Format Painter */}
        <button
          onClick={() => {
            if (formatPainterStyle) { setFormatPainterStyle(null); return; }
            if (selectedZoneId) {
              const zone = zones.find(z => z.id === selectedZoneId);
              if (zone) { const type = surfaceTypes.find(t => t.id === zone.typeId); setFormatPainterStyle({ color: type?.color ?? "#3B82F6" }); }
            }
            if (selectedLinearId) {
              const lm = linearMeasures.find(m => m.id === selectedLinearId);
              if (lm) { const cat = linearCategories.find(c => c.id === lm.categoryId); setFormatPainterStyle({ color: cat?.color ?? "#10B981" }); }
            }
          }}
          title={d("mc_copy_format" as DTKey)}
          className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            formatPainterStyle ? "bg-purple-500/20 border border-purple-500/40 text-purple-300" : "text-slate-400 hover:text-white"}`}>
          <Paintbrush className="w-3.5 h-3.5" />
        </button>

        {isDrawing && (
          <button onClick={cancelDrawing}
            className="text-xs text-slate-500 hover:text-red-400 transition-colors px-2 py-1 rounded-lg border border-white/5 hover:border-red-500/30">
            {d("mc_cancel_esc" as DTKey)}
          </button>
        )}

        {/* ── Contextual: Wall thickness ── */}
        {tool === "wall" && (<>
          <div className="w-px h-5 bg-white/10 shrink-0 mx-0.5" />
          <div className="flex items-center gap-2 border border-orange-500/20 rounded-lg px-2 py-1">
            <Ruler className="w-3 h-3 text-orange-400 shrink-0" />
            <span className="text-xs text-slate-400">{d("mc_thickness" as DTKey)}</span>
            <input type="number" min={1} max={500} step={1} value={wallThicknessCm}
              onChange={e => setWallThicknessCm(Math.max(1, parseInt(e.target.value) || 15))}
              className="w-14 bg-transparent text-orange-300 text-xs font-mono text-center border-b border-orange-500/30 focus:outline-none focus:border-orange-400" />
            <span className="text-xs text-slate-500">{ppm ? "cm" : "px"}</span>
            {ppm && <span className="text-[10px] text-slate-600 font-mono">= {((wallThicknessCm / 100) * ppm).toFixed(0)} px</span>}
          </div>
        </>)}

        {/* ── Contextual: Visual Search ── */}
        {tool === "visual_search" && (<>
          <div className="w-px h-5 bg-white/10 shrink-0 mx-0.5" />
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1 border border-cyan-500/20 rounded-lg p-0.5">
              {(["search", "add", "remove"] as const).map(m => (
                <button key={m} onClick={() => setVsEditMode(m)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    vsEditMode === m ? "bg-cyan-500/30 text-cyan-200" : "text-slate-400 hover:text-white"}`}>
                  {m === "search" ? `🔍 ${d("mc_vs_search" as DTKey)}` : m === "add" ? `＋ ${d("mc_vs_add" as DTKey)}` : `− ${d("mc_vs_remove" as DTKey)}`}
                </button>
              ))}
            </div>
            {vsSearching && <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />}
            {vsMatches.length > 0 && (<>
              <span className="text-xs text-cyan-400 font-mono">{vsMatches.length} {d("mc_vs_found" as DTKey)}</span>
              <button onClick={() => onVsMatchesChange?.([])} className="text-xs text-slate-500 hover:text-red-400 px-2 py-1 border border-white/10 rounded-lg transition-colors">{d("mc_vs_clear" as DTKey)}</button>
              <button onClick={() => { setShowVsSave(true); setVsSaveLabel(""); }} className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 px-2 py-1 border border-cyan-500/20 rounded-lg transition-colors"><Save className="w-3 h-3" /> {d("mc_vs_save" as DTKey)}</button>
            </>)}
            {showVsSave && (
              <div className="flex items-center gap-1.5">
                <input autoFocus value={vsSaveLabel} onChange={e => setVsSaveLabel(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && vsSaveLabel.trim()) { onSaveDetection?.(vsSaveLabel.trim(), vsMatches); onVsMatchesChange?.([]); setShowVsSave(false); } if (e.key === "Escape") setShowVsSave(false); }}
                  placeholder={d("mc_vs_name_ph" as DTKey)} className="w-40 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-600 outline-none focus:border-cyan-500" />
                <button disabled={!vsSaveLabel.trim()} onClick={() => { if (vsSaveLabel.trim()) { onSaveDetection?.(vsSaveLabel.trim(), vsMatches); onVsMatchesChange?.([]); setShowVsSave(false); } }}
                  className="text-xs text-cyan-400 hover:text-cyan-300 px-2 py-1 border border-cyan-500/20 rounded-lg transition-colors disabled:opacity-40">OK</button>
              </div>
            )}
          </div>
        </>)}

        {/* ── Contextual: Stamp kind ── */}
        {tool === "stamp" && (
          <select value={activeStamp} onChange={e => setActiveStamp(e.target.value as StampKind)}
            className="bg-transparent text-xs text-red-300 font-mono border border-red-500/30 rounded px-1.5 py-0.5 outline-none">
            {(Object.keys(STAMP_LABELS) as StampKind[]).map(k => (
              <option key={k} value={k} className="bg-slate-900">{STAMP_LABELS[k].fr}</option>
            ))}
          </select>
        )}
      </div>

      {/* Hint */}
      <div className="flex items-center gap-2 -mt-1">
        <div className="glass border border-white/10 rounded-lg px-3 py-1.5 flex-1">
          <span className="text-sm text-slate-300 font-medium">{hint}</span>
        </div>
        {/* Actions for selected element */}
        {(selectedZoneId || selectedLinearId || selectedMarkupId || selectedTextId || selectedCircleId) && (
          <div className="flex items-center gap-1">
            {/* Color picker for selected element */}
            <input type="color"
              value={(() => {
                if (selectedMarkupId) return markupAnnotations.find(m => m.id === selectedMarkupId)?.color ?? "#3B82F6";
                if (selectedTextId) return textAnnotations.find(t => t.id === selectedTextId)?.color ?? "#3B82F6";
                if (selectedCircleId) { const cm = circleMeasures.find(c => c.id === selectedCircleId); const cat = linearCategories.find(c => c.id === cm?.categoryId); return cat?.color ?? "#10B981"; }
                if (selectedZoneId) { const z = zones.find(v => v.id === selectedZoneId); const t = surfaceTypes.find(st => st.id === z?.typeId); return t?.color ?? "#3B82F6"; }
                if (selectedLinearId) { const lm = linearMeasures.find(m => m.id === selectedLinearId); const cat = linearCategories.find(c => c.id === lm?.categoryId); return cat?.color ?? "#10B981"; }
                return "#3B82F6";
              })()}
              onChange={e => {
                const c = e.target.value;
                if (selectedMarkupId) onMarkupAnnotationsChange?.(markupAnnotations.map(m => m.id === selectedMarkupId ? { ...m, color: c, fillColor: c } : m));
                else if (selectedTextId) onTextAnnotationsChange?.(textAnnotations.map(t => t.id === selectedTextId ? { ...t, color: c } : t));
              }}
              className="w-7 h-7 rounded-lg border border-white/20 cursor-pointer p-0"
              title={d("common_color" as DTKey)}
            />
            <button onClick={() => {
              // Copy selected element
              if (selectedZoneId) {
                const z = zones.find(v => v.id === selectedZoneId);
                if (z) { onHistoryPush?.(zones); const dup = { ...z, id: crypto.randomUUID(), name: z.name ? `${z.name} (copie)` : undefined, points: z.points.map(p => ({ x: p.x + 0.02, y: p.y + 0.02 })) }; onZonesChange([...zones, dup]); onSelectedZoneIdChange?.(dup.id); }
              } else if (selectedMarkupId) {
                const mk = markupAnnotations.find(m => m.id === selectedMarkupId);
                if (mk) { const dup = { ...mk, id: crypto.randomUUID(), x1: mk.x1 + 0.02, y1: mk.y1 + 0.02, x2: mk.x2 + 0.02, y2: mk.y2 + 0.02, ...(mk.penPoints ? { penPoints: mk.penPoints.map(p => ({ x: p.x + 0.02, y: p.y + 0.02 })) } : {}), ...(mk.polyPoints ? { polyPoints: mk.polyPoints.map(p => ({ x: p.x + 0.02, y: p.y + 0.02 })) } : {}) }; onMarkupAnnotationsChange?.([...markupAnnotations, dup]); setSelectedMarkupId(dup.id); }
              } else if (selectedTextId) {
                const ta = textAnnotations.find(t => t.id === selectedTextId);
                if (ta) { const dup = { ...ta, id: crypto.randomUUID(), x: ta.x + 0.02, y: ta.y + 0.02 }; onTextAnnotationsChange?.([...textAnnotations, dup]); setSelectedTextId(dup.id); }
              } else if (selectedCircleId) {
                const cm = circleMeasures.find(c => c.id === selectedCircleId);
                if (cm) { const dup = { ...cm, id: crypto.randomUUID(), center: { x: cm.center.x + 0.02, y: cm.center.y + 0.02 }, edgePoint: { x: cm.edgePoint.x + 0.02, y: cm.edgePoint.y + 0.02 } }; onCircleMeasuresChange?.([...circleMeasures, dup]); setSelectedCircleId(dup.id); }
              } else if (selectedLinearId) {
                const lm = linearMeasures.find(m => m.id === selectedLinearId);
                if (lm) { const dup = { ...lm, id: crypto.randomUUID(), points: lm.points.map(p => ({ x: p.x + 0.02, y: p.y + 0.02 })) }; onLinearMeasuresChange?.([...linearMeasures, dup]); onSelectedLinearIdChange?.(dup.id); }
              }
            }} title={d("common_copy" as DTKey)} className="glass border border-white/10 rounded-lg p-2 text-slate-400 hover:text-cyan-400 transition-colors">
              <Copy className="w-4 h-4" />
            </button>
            {/* Toggle déduction — only for zones */}
            {selectedZoneId && (() => {
              const z = zones.find(v => v.id === selectedZoneId);
              return (
                <button onClick={() => {
                  onHistoryPush?.(zones);
                  onZonesChange(zones.map(v => v.id !== selectedZoneId ? v : { ...v, isDeduction: !v.isDeduction }));
                }} title={z?.isDeduction ? "Retirer la déduction" : "Marquer comme déduction (soustrait du total)"}
                  className={`glass border rounded-lg p-2 transition-colors ${z?.isDeduction ? "border-red-500/50 text-red-400 bg-red-500/10" : "border-white/10 text-slate-400 hover:text-red-400"}`}>
                  <MinusSquare className="w-4 h-4" />
                </button>
              );
            })()}
            <button onClick={() => {
              // Delete selected element
              if (selectedZoneId) { onHistoryPush?.(zones); onZonesChange(zones.filter(z => z.id !== selectedZoneId)); onSelectedZoneIdChange?.(null); }
              else if (selectedMarkupId) { onMarkupAnnotationsChange?.(markupAnnotations.filter(m => m.id !== selectedMarkupId)); setSelectedMarkupId(null); }
              else if (selectedTextId) { onTextAnnotationsChange?.(textAnnotations.filter(t => t.id !== selectedTextId)); setSelectedTextId(null); }
              else if (selectedCircleId) { onCircleMeasuresChange?.(circleMeasures.filter(c => c.id !== selectedCircleId)); setSelectedCircleId(null); }
              else if (selectedLinearId) { onLinearMeasuresChange?.(linearMeasures.filter(m => m.id !== selectedLinearId)); onSelectedLinearIdChange?.(null); }
            }} title={d("common_delete" as DTKey)} className="glass border border-red-500/30 rounded-lg p-2 text-red-400 hover:text-red-300 hover:border-red-500/50 transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* ── Canvas ── */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-white select-none"
        style={{ height: "calc(100vh - 230px)", minHeight: 400, cursor: dragZoneRef.current ? "move" : dragVertex ? "move" : panCursor ? "grabbing" : spacebarPan ? "grab" : isNearFirst ? "pointer" : tool === "select" ? "default" : tool === "eraser" ? "cell" : "crosshair" }}
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

          {/* ── Grid overlay ── */}
          {showGrid && ppm && imgOffset.w > 0 && naturalSize.w > 0 && (() => {
            // Grid spacing: 1m in SVG pixels
            const pxPerM = ppm * (imgOffset.w / naturalSize.w);
            // Choose grid step that makes cells 30-120px on screen
            let stepM = 1;
            if (pxPerM < 30) stepM = 5;
            else if (pxPerM < 60) stepM = 2;
            else if (pxPerM > 200) stepM = 0.5;
            else if (pxPerM > 400) stepM = 0.25;
            const stepPx = stepM * pxPerM;
            const lines: React.ReactNode[] = [];
            // Vertical lines
            for (let x = imgOffset.x; x < imgOffset.x + imgOffset.w; x += stepPx) {
              lines.push(<line key={`gv${x}`} x1={x} y1={imgOffset.y} x2={x} y2={imgOffset.y + imgOffset.h} stroke="rgba(148,163,184,0.12)" strokeWidth={0.5} />);
            }
            // Horizontal lines
            for (let y = imgOffset.y; y < imgOffset.y + imgOffset.h; y += stepPx) {
              lines.push(<line key={`gh${y}`} x1={imgOffset.x} y1={y} x2={imgOffset.x + imgOffset.w} y2={y} stroke="rgba(148,163,184,0.12)" strokeWidth={0.5} />);
            }
            return <g className="pointer-events-none">{lines}</g>;
          })()}

          {/* ── Rulers overlay (top + left edges) ── */}
          {showRulers && ppm && imgOffset.w > 0 && naturalSize.w > 0 && (() => {
            const pxPerM = ppm * (imgOffset.w / naturalSize.w);
            let stepM = 1;
            if (pxPerM < 40) stepM = 5;
            else if (pxPerM < 80) stepM = 2;
            else if (pxPerM > 250) stepM = 0.5;
            const stepPx = stepM * pxPerM;
            const ticks: React.ReactNode[] = [];
            // Top ruler
            for (let x = imgOffset.x, i = 0; x < imgOffset.x + imgOffset.w; x += stepPx, i++) {
              ticks.push(
                <g key={`rt${i}`}>
                  <line x1={x} y1={imgOffset.y} x2={x} y2={imgOffset.y + 10} stroke="rgba(148,163,184,0.5)" strokeWidth={0.8} />
                  <text x={x + 2} y={imgOffset.y + 9} fontSize={7} fill="rgba(148,163,184,0.5)" fontFamily="ui-monospace">{(i * stepM).toFixed(stepM < 1 ? 1 : 0)}</text>
                </g>
              );
            }
            // Left ruler
            for (let y = imgOffset.y, i = 0; y < imgOffset.y + imgOffset.h; y += stepPx, i++) {
              ticks.push(
                <g key={`rl${i}`}>
                  <line x1={imgOffset.x} y1={y} x2={imgOffset.x + 10} y2={y} stroke="rgba(148,163,184,0.5)" strokeWidth={0.8} />
                  <text x={imgOffset.x + 2} y={y - 1} fontSize={7} fill="rgba(148,163,184,0.5)" fontFamily="ui-monospace">{(i * stepM).toFixed(stepM < 1 ? 1 : 0)}</text>
                </g>
              );
            }
            return <g className="pointer-events-none">{ticks}</g>;
          })()}

          {/* Completed zones (filtered by layer visibility) */}
          {zones.filter(z => { const lyr = layers.find(l => l.id === (z.layer ?? "lyr_general")); return !lyr || lyr.visible; }).map(zone => {
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
                  fill={zone.isDeduction ? "url(#hatch-deduction)" : hexToRgba(color, (selectedZoneId === zone.id || selectedZoneIds.has(zone.id)) ? 0.38 : 0.28)}
                  stroke={color}
                  strokeWidth={(selectedZoneId === zone.id || selectedZoneIds.has(zone.id)) ? 3 : 2}
                  strokeDasharray={zone.isDeduction ? "6 3" : (selectedZoneId === zone.id || selectedZoneIds.has(zone.id)) ? "8 4" : undefined}
                  strokeLinejoin="round"
                  style={{
                    ...((selectedZoneId === zone.id || selectedZoneIds.has(zone.id)) ? { filter: `drop-shadow(0 0 6px ${color})`, cursor: "move" } : {}),
                    ...(tool === "select" || tool === "lasso" ? { pointerEvents: "all" as const, ...(!selectedZoneId || selectedZoneId !== zone.id ? { cursor: "pointer" } : {}) } : {}),
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

          {/* ── Count points (completed) — draggable + right-click delete + shapes ── */}
          {countPoints.map((cp) => {
            const grp = countGroups.find(g => g.id === cp.groupId);
            const cpColor = grp?.color ?? "#EC4899";
            const shape = grp?.shape ?? "circle";
            const s = toSvg({ x: cp.x, y: cp.y });
            const num = countPoints.filter(p => p.groupId === cp.groupId).findIndex(p => p.id === cp.id) + 1;
            const r = 10;
            // Shape SVG paths
            const shapeEl = shape === "triangle" ? (
              <polygon points={`${s.x},${s.y - r} ${s.x - r * 0.87},${s.y + r * 0.5} ${s.x + r * 0.87},${s.y + r * 0.5}`} fill={cpColor} stroke="white" strokeWidth={1.5} />
            ) : shape === "diamond" ? (
              <polygon points={`${s.x},${s.y - r} ${s.x + r},${s.y} ${s.x},${s.y + r} ${s.x - r},${s.y}`} fill={cpColor} stroke="white" strokeWidth={1.5} />
            ) : shape === "square" ? (
              <rect x={s.x - r * 0.75} y={s.y - r * 0.75} width={r * 1.5} height={r * 1.5} rx={2} fill={cpColor} stroke="white" strokeWidth={1.5} />
            ) : shape === "checkmark" ? (
              <g>
                <circle cx={s.x} cy={s.y} r={r} fill={cpColor} stroke="white" strokeWidth={1.5} />
                <path d={`M${s.x - 4},${s.y} L${s.x - 1},${s.y + 3.5} L${s.x + 5},${s.y - 3}`} fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
              </g>
            ) : shape === "cross" ? (
              <g>
                <circle cx={s.x} cy={s.y} r={r} fill={cpColor} stroke="white" strokeWidth={1.5} />
                <path d={`M${s.x - 4},${s.y - 4} L${s.x + 4},${s.y + 4} M${s.x + 4},${s.y - 4} L${s.x - 4},${s.y + 4}`} fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" />
              </g>
            ) : (
              <circle cx={s.x} cy={s.y} r={r} fill={cpColor} stroke="white" strokeWidth={1.5} />
            );
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
                {shapeEl}
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
              <g key={cm.id} style={{ pointerEvents: "all", cursor: tool === "select" ? (selectedCircleId === cm.id ? "move" : "pointer") : "default", ...(selectedCircleId === cm.id ? { filter: `drop-shadow(0 0 6px ${cColor})` } : {}) }}
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
              <g key={ta.id} style={{ pointerEvents: "all", cursor: tool === "select" ? (selectedTextId === ta.id ? "move" : "pointer") : "default", ...(selectedTextId === ta.id ? { filter: `drop-shadow(0 0 6px ${ta.color})` } : {}) }}
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

          {/* ── Markup annotations (filtered by layer visibility) ── */}
          {markupAnnotations.filter(m => { const lyr = layers.find(l => l.id === (m.layer ?? "lyr_general")); return !lyr || lyr.visible; }).map(mk => {
            const s1 = toSvg({ x: mk.x1, y: mk.y1 });
            const s2 = toSvg({ x: mk.x2, y: mk.y2 });
            const lw = mk.lineWidth ?? 2;
            const op = mk.opacity ?? 1;
            const fc = mk.fillColor ?? mk.color;
            const fo = mk.fillOpacity ?? 0.15;
            const isSel = selectedMarkupId === mk.id;
            const common = { style: { pointerEvents: "all" as const, cursor: tool === "select" ? (isSel ? "move" : "pointer") : "default", opacity: op, ...(isSel ? { filter: `drop-shadow(0 0 6px ${mk.color})` } : {}) },
              onContextMenu: (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); onMarkupAnnotationsChange?.(markupAnnotations.filter(m => m.id !== mk.id)); } };

            if (mk.type === "arrow" || mk.type === "line") {
              const dx = s2.x - s1.x, dy = s2.y - s1.y;
              const len = Math.hypot(dx, dy);
              const ux = len > 0 ? dx / len : 1, uy = len > 0 ? dy / len : 0;
              const headLen = Math.min(12, len * 0.3);
              return (
                <g key={mk.id} {...common}>
                  <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} stroke={mk.color} strokeWidth={lw} />
                  {/* Invisible fat hit area */}
                  <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} stroke="transparent" strokeWidth={12} />
                  {mk.type === "arrow" && (
                    <polygon points={`${s2.x},${s2.y} ${s2.x - ux * headLen + uy * headLen * 0.4},${s2.y - uy * headLen - ux * headLen * 0.4} ${s2.x - ux * headLen - uy * headLen * 0.4},${s2.y - uy * headLen + ux * headLen * 0.4}`}
                      fill={mk.color} />
                  )}
                </g>
              );
            }

            if (mk.type === "rect_annot" || mk.type === "highlight") {
              const x = Math.min(s1.x, s2.x), y = Math.min(s1.y, s2.y);
              const w = Math.abs(s2.x - s1.x), h = Math.abs(s2.y - s1.y);
              return (
                <g key={mk.id} {...common}>
                  <rect x={x} y={y} width={w} height={h} rx={mk.type === "highlight" ? 0 : 3}
                    fill={hexToRgba(fc, fo)} stroke={mk.type === "highlight" ? "none" : mk.color}
                    strokeWidth={lw} />
                </g>
              );
            }

            if (mk.type === "ellipse") {
              const cx = (s1.x + s2.x) / 2, cy = (s1.y + s2.y) / 2;
              const rx = Math.abs(s2.x - s1.x) / 2, ry = Math.abs(s2.y - s1.y) / 2;
              return (
                <g key={mk.id} {...common}>
                  <ellipse cx={cx} cy={cy} rx={rx} ry={ry}
                    fill={hexToRgba(fc, fo)} stroke={mk.color} strokeWidth={lw} />
                </g>
              );
            }

            if (mk.type === "cloud") {
              const x = Math.min(s1.x, s2.x), y = Math.min(s1.y, s2.y);
              const w = Math.abs(s2.x - s1.x), h = Math.abs(s2.y - s1.y);
              // Cloud border: scalloped edge using arc segments
              const bumps = Math.max(4, Math.round((2 * w + 2 * h) / 20));
              const bumpR = Math.max(4, Math.min(Math.min(w, h) / 4, 14, (2 * w + 2 * h) / bumps / 1.8));
              const pts: string[] = [];
              // Generate points along rectangle perimeter
              const perimPts: { x: number; y: number }[] = [];
              const steps = bumps * 4;
              for (let i = 0; i < steps; i++) {
                const t = i / steps;
                const totalPerim = 2 * w + 2 * h;
                let d = t * totalPerim;
                if (d < w) perimPts.push({ x: x + d, y });
                else if (d < w + h) perimPts.push({ x: x + w, y: y + (d - w) });
                else if (d < 2 * w + h) perimPts.push({ x: x + w - (d - w - h), y: y + h });
                else perimPts.push({ x, y: y + h - (d - 2 * w - h) });
              }
              // Build scalloped path
              let cloudPath = `M ${perimPts[0].x} ${perimPts[0].y}`;
              const step = Math.max(1, Math.floor(steps / bumps));
              for (let i = 0; i < perimPts.length; i += step) {
                const next = perimPts[(i + step) % perimPts.length];
                cloudPath += ` A ${bumpR} ${bumpR} 0 0 1 ${next.x} ${next.y}`;
              }
              cloudPath += " Z";
              return (
                <g key={mk.id} {...common}>
                  <path d={cloudPath} fill={hexToRgba(fc, fo)} stroke={mk.color} strokeWidth={lw} />
                </g>
              );
            }

            if (mk.type === "callout") {
              const textLines = (mk.text ?? "").split("\n");
              const fs = 10;
              const lineH = fs + 3;
              const maxW = Math.max(60, ...textLines.map(l => l.length * fs * 0.55 + 16));
              const totalH = Math.max(20, textLines.length * lineH + 8);
              return (
                <g key={mk.id} {...common}>
                  {/* Leader line from start to text box */}
                  <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} stroke={mk.color} strokeWidth={1.5} />
                  <circle cx={s1.x} cy={s1.y} r={3} fill={mk.color} />
                  {/* Text box at end point */}
                  <rect x={s2.x} y={s2.y - totalH / 2} width={maxW} height={totalH} rx={4}
                    fill="rgba(0,0,0,0.8)" stroke={mk.color} strokeWidth={1.5} />
                  {textLines.map((line, li) => (
                    <text key={li} x={s2.x + 6} y={s2.y - totalH / 2 + 12 + li * lineH}
                      fontSize={fs} fill={mk.color} fontFamily="system-ui">{line}</text>
                  ))}
                </g>
              );
            }

            if (mk.type === "pen" && mk.penPoints && mk.penPoints.length > 1) {
              const d = mk.penPoints.map((p, i) => {
                const s = toSvg(p);
                return `${i === 0 ? "M" : "L"} ${s.x} ${s.y}`;
              }).join(" ");
              return (
                <g key={mk.id} {...common}>
                  <path d={d} fill="none" stroke={mk.color} strokeWidth={lw} strokeLinecap="round" strokeLinejoin="round" />
                  <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
                </g>
              );
            }

            if (mk.type === "stamp" && mk.stampKind) {
              const label = STAMP_LABELS[mk.stampKind]?.fr ?? mk.stampKind;
              const x = Math.min(s1.x, s2.x), y = Math.min(s1.y, s2.y);
              const w = Math.abs(s2.x - s1.x), h = Math.abs(s2.y - s1.y);
              return (
                <g key={mk.id} {...common} transform={`rotate(-12, ${x + w / 2}, ${y + h / 2})`}>
                  <rect x={x} y={y} width={w} height={h} rx={3}
                    fill="none" stroke={mk.color} strokeWidth={2.5} />
                  <text x={x + w / 2} y={y + h / 2 + 1} textAnchor="middle" dominantBaseline="middle"
                    fontSize={Math.min(11, h * 0.6)} fontWeight="900" fill={mk.color}
                    fontFamily="system-ui" letterSpacing="1">{label}</text>
                </g>
              );
            }

            if (mk.type === "note") {
              const noteText = mk.text ?? "Note";
              const collapsed = mk.collapsed !== false;
              return (
                <g key={mk.id} {...common}>
                  {/* Sticky note icon */}
                  <rect x={s1.x} y={s1.y} width={collapsed ? 20 : Math.max(80, noteText.length * 6 + 16)} height={collapsed ? 20 : 32} rx={2}
                    fill="#FEF3C7" stroke="#F59E0B" strokeWidth={1.5} />
                  {collapsed ? (
                    <text x={s1.x + 10} y={s1.y + 13} textAnchor="middle" fontSize={12} fill="#92400E">📝</text>
                  ) : (
                    <text x={s1.x + 6} y={s1.y + 16} fontSize={9} fill="#92400E" fontFamily="system-ui">{noteText}</text>
                  )}
                </g>
              );
            }

            if (mk.type === "dimension") {
              const dx = s2.x - s1.x, dy = s2.y - s1.y;
              const len = Math.hypot(dx, dy);
              if (len < 5) return null;
              const perpX = -dy / len, perpY = dx / len;
              const off = 16;
              const rawAngle = Math.atan2(dy, dx) * 180 / Math.PI;
              const angle = (rawAngle > 90 || rawAngle <= -90) ? rawAngle + 180 : rawAngle;
              const mid = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 };
              const dimLabel = mk.dimensionValue ?? "";
              const dlw = dimLabel.length * 6 + 14;
              return (
                <g key={mk.id} {...common}>
                  {/* Dimension offset line */}
                  <line x1={s1.x + perpX * off} y1={s1.y + perpY * off}
                    x2={s2.x + perpX * off} y2={s2.y + perpY * off}
                    stroke={mk.color} strokeWidth={1} />
                  {/* Extension lines */}
                  <line x1={s1.x} y1={s1.y} x2={s1.x + perpX * (off + 5)} y2={s1.y + perpY * (off + 5)}
                    stroke={mk.color} strokeWidth={0.8} />
                  <line x1={s2.x} y1={s2.y} x2={s2.x + perpX * (off + 5)} y2={s2.y + perpY * (off + 5)}
                    stroke={mk.color} strokeWidth={0.8} />
                  {/* Tick marks */}
                  <line x1={s1.x + perpX * (off - 4)} y1={s1.y + perpY * (off - 4)}
                    x2={s1.x + perpX * (off + 4)} y2={s1.y + perpY * (off + 4)}
                    stroke={mk.color} strokeWidth={1.5} />
                  <line x1={s2.x + perpX * (off - 4)} y1={s2.y + perpY * (off - 4)}
                    x2={s2.x + perpX * (off + 4)} y2={s2.y + perpY * (off + 4)}
                    stroke={mk.color} strokeWidth={1.5} />
                  {/* Label */}
                  {dimLabel && (
                    <g transform={`translate(${mid.x + perpX * off},${mid.y + perpY * off}) rotate(${angle})`}>
                      <rect x={-dlw / 2} y={-9} width={dlw} height={18} rx={4}
                        fill="rgba(0,0,0,0.8)" stroke={mk.color} strokeWidth={0.8} />
                      <text textAnchor="middle" dominantBaseline="middle"
                        fontSize={10} fill="white" fontWeight="600" fontFamily="ui-monospace, monospace">{dimLabel}</text>
                    </g>
                  )}
                </g>
              );
            }

            if (mk.type === "polyline_annot" && mk.polyPoints && mk.polyPoints.length > 1) {
              const d = mk.polyPoints.map((p, i) => {
                const s = toSvg(p);
                return `${i === 0 ? "M" : "L"} ${s.x} ${s.y}`;
              }).join(" ");
              return (
                <g key={mk.id} {...common}>
                  <path d={d} fill="none" stroke={mk.color} strokeWidth={lw} strokeLinecap="round" strokeLinejoin="round" />
                  <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
                </g>
              );
            }

            return null;
          })}

          {/* Markup in-progress preview */}
          {mkStart && mouseNorm && (tool === "arrow" || tool === "mk_line" || tool === "callout" || tool === "cloud" || tool === "rect_annot" || tool === "ellipse" || tool === "highlight" || tool === "dimension") && (() => {
            const s1 = toSvg(mkStart);
            const s2 = toSvg(mouseNorm);
            if (tool === "arrow" || tool === "mk_line") {
              return <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} stroke={activeColor} strokeWidth={2} strokeDasharray="6 3" />;
            }
            if (tool === "rect_annot" || tool === "highlight") {
              const x = Math.min(s1.x, s2.x), y = Math.min(s1.y, s2.y);
              return <rect x={x} y={y} width={Math.abs(s2.x - s1.x)} height={Math.abs(s2.y - s1.y)}
                fill={hexToRgba(activeColor, 0.1)} stroke={activeColor} strokeWidth={2} strokeDasharray="6 3" />;
            }
            if (tool === "ellipse") {
              return <ellipse cx={(s1.x + s2.x) / 2} cy={(s1.y + s2.y) / 2} rx={Math.abs(s2.x - s1.x) / 2} ry={Math.abs(s2.y - s1.y) / 2}
                fill="none" stroke={activeColor} strokeWidth={2} strokeDasharray="6 3" />;
            }
            if (tool === "cloud" || tool === "callout") {
              return (
                <g>
                  <rect x={Math.min(s1.x, s2.x)} y={Math.min(s1.y, s2.y)}
                    width={Math.abs(s2.x - s1.x)} height={Math.abs(s2.y - s1.y)}
                    fill="none" stroke={activeColor} strokeWidth={1.5} strokeDasharray="5 3" />
                  {tool === "callout" && <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} stroke={activeColor} strokeWidth={1.5} strokeDasharray="4 2" />}
                </g>
              );
            }
            if (tool === "dimension") {
              return <line x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} stroke={activeColor} strokeWidth={1.5} strokeDasharray="6 3" />;
            }
            return null;
          })()}

          {/* Eraser rect/circle/polygon preview */}
          {tool === "eraser" && eraserStart && mouseNorm && (eraserMode === "rect" || eraserMode === "circle") && (() => {
            const s1 = toSvg(eraserStart), s2 = toSvg(mouseNorm);
            if (eraserMode === "rect") {
              return <rect x={Math.min(s1.x, s2.x)} y={Math.min(s1.y, s2.y)} width={Math.abs(s2.x - s1.x)} height={Math.abs(s2.y - s1.y)}
                fill="rgba(239,68,68,0.08)" stroke="#EF4444" strokeWidth={1.5} strokeDasharray="6 3" rx={2} />;
            }
            const r = Math.hypot(s2.x - s1.x, s2.y - s1.y);
            return <circle cx={s1.x} cy={s1.y} r={r} fill="rgba(239,68,68,0.08)" stroke="#EF4444" strokeWidth={1.5} strokeDasharray="6 3" />;
          })()}
          {tool === "eraser" && eraserMode === "polygon" && eraserDrawingPoly.length > 0 && (() => {
            const pts = [...eraserDrawingPoly, ...(mouseNorm ? [mouseNorm] : [])];
            const d = pts.map((p, i) => { const s = toSvg(p); return `${i === 0 ? "M" : "L"} ${s.x} ${s.y}`; }).join(" ") + (pts.length > 2 ? " Z" : "");
            return <path d={d} fill="rgba(239,68,68,0.05)" stroke="#EF4444" strokeWidth={1.5} strokeDasharray="6 3" />;
          })()}

          {/* Lasso selection rect */}
          {tool === "lasso" && lassoStart && lassoEnd && (() => {
            const s1 = toSvg(lassoStart), s2 = toSvg(lassoEnd);
            const x = Math.min(s1.x, s2.x), y = Math.min(s1.y, s2.y);
            return <rect x={x} y={y} width={Math.abs(s2.x - s1.x)} height={Math.abs(s2.y - s1.y)}
              fill="rgba(139,92,246,0.08)" stroke="#8B5CF6" strokeWidth={1.5} strokeDasharray="6 3" rx={2} />;
          })()}

          {/* Pen in-progress */}
          {penDrawing.length > 1 && (() => {
            const d = penDrawing.map((p, i) => {
              const s = toSvg(p);
              return `${i === 0 ? "M" : "L"} ${s.x} ${s.y}`;
            }).join(" ");
            return <path d={d} fill="none" stroke={activeColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 2" />;
          })()}

          {/* Empty state hint */}
          {zones.length === 0 && !isDrawing && textAnnotations.length === 0 && markupAnnotations.length === 0 && (
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
                    if (tool === "note") {
                      // Create a sticky note markup
                      onMarkupAnnotationsChange?.([...markupAnnotations, {
                        id: crypto.randomUUID(), type: "note", color: "#F59E0B", layer: activeLayerId,
                        x1: textInputPos.x, y1: textInputPos.y, x2: textInputPos.x + 0.08, y2: textInputPos.y + 0.03,
                        text: textInputValue.trim(), collapsed: false, lineWidth: 1.5, opacity: 1,
                      }]);
                    } else {
                      onTextAnnotationsChange?.([...textAnnotations, {
                        id: crypto.randomUUID(),
                        x: textInputPos.x, y: textInputPos.y,
                        text: textInputValue.trim(), color: activeColor,
                      }]);
                    }
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

        {/* ── Layers panel overlay ── */}
        {showLayersPanel && (
          <div className="absolute top-14 left-4 z-50 glass border border-blue-500/30 rounded-2xl p-3 shadow-2xl min-w-72 pointer-events-auto max-h-96 overflow-y-auto"
            onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-blue-300 uppercase tracking-wider">{d("mc_layers" as DTKey)}</span>
              <div className="flex items-center gap-1.5">
                <button onClick={() => { setNewLayerName(""); setNewLayerColor("#" + Math.floor(Math.random()*16777215).toString(16).padStart(6,"0")); setNewLayerModalOpen(true); }}
                  className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-[10px] px-2 py-1 border border-blue-500/30 rounded-lg hover:bg-blue-500/10 transition-all">
                  + {d("mc_layer_create" as DTKey)}
                </button>
                <button onClick={() => setShowLayersPanel(false)} className="text-slate-500 hover:text-white p-0.5 rounded hover:bg-white/5 transition-colors">
                  <span className="text-xs">✕</span>
                </button>
              </div>
            </div>

            {/* New layer creation form (inline modal) */}
            {newLayerModalOpen && (
              <div className="mb-3 p-2.5 rounded-xl border border-blue-500/20 bg-blue-500/5">
                <p className="text-[10px] text-blue-300 font-medium mb-2 uppercase tracking-wider">{d("mc_new_layer_title" as DTKey)}</p>
                <div className="flex flex-col gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={newLayerName}
                    onChange={e => setNewLayerName(e.target.value)}
                    onKeyDown={e => {
                      e.stopPropagation();
                      if (e.key === "Enter" && newLayerName.trim()) {
                        const id = `lyr_${Date.now()}`;
                        onLayersChange?.([...layers, { id, name: newLayerName.trim(), color: newLayerColor, visible: true, locked: false }]);
                        onActiveLayerIdChange?.(id);
                        setNewLayerModalOpen(false);
                      }
                      if (e.key === "Escape") setNewLayerModalOpen(false);
                    }}
                    placeholder={d("mc_layer_name_ph" as DTKey)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/40"
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-slate-500 shrink-0">{d("mc_layer_color" as DTKey)}</label>
                    <input type="color" value={newLayerColor}
                      onChange={e => setNewLayerColor(e.target.value)}
                      className="w-6 h-6 rounded-lg border border-white/20 cursor-pointer p-0 shrink-0" />
                    <span className="text-[10px] text-slate-500 font-mono">{newLayerColor}</span>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      disabled={!newLayerName.trim()}
                      onClick={() => {
                        const id = `lyr_${Date.now()}`;
                        onLayersChange?.([...layers, { id, name: newLayerName.trim(), color: newLayerColor, visible: true, locked: false }]);
                        onActiveLayerIdChange?.(id);
                        setNewLayerModalOpen(false);
                      }}
                      className="flex-1 py-1.5 text-[10px] bg-blue-500/20 border border-blue-500/30 text-blue-300 rounded-lg hover:bg-blue-500/30 transition-colors disabled:opacity-30">
                      {d("mc_layer_create" as DTKey)}
                    </button>
                    <button onClick={() => setNewLayerModalOpen(false)}
                      className="px-3 py-1.5 text-[10px] border border-white/10 text-slate-400 rounded-lg hover:text-white transition-colors">
                      {d("common_cancel" as DTKey)}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Layer list */}
            <div className="flex flex-col gap-0.5">
              {layers.map(lyr => {
                const zoneCount = zones.filter(z => (z.layer ?? "lyr_general") === lyr.id).length;
                const mkCount = markupAnnotations.filter(m => (m.layer ?? "lyr_general") === lyr.id).length;
                const total = zoneCount + mkCount;
                return (
                  <div key={lyr.id} className={`group flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs transition-all cursor-pointer ${
                    activeLayerId === lyr.id ? "bg-blue-500/10 border border-blue-500/30 shadow-sm" : "border border-transparent hover:bg-white/5 hover:border-white/5"
                  }`}
                    onClick={() => onActiveLayerIdChange?.(lyr.id)}>
                    <button onClick={e => { e.stopPropagation(); onLayersChange?.(layers.map(l => l.id === lyr.id ? { ...l, visible: !l.visible } : l)); }}
                      className="text-slate-400 hover:text-white shrink-0" title={lyr.visible ? "Masquer" : "Afficher"}>
                      {lyr.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 opacity-40" />}
                    </button>
                    <button onClick={e => { e.stopPropagation(); onLayersChange?.(layers.map(l => l.id === lyr.id ? { ...l, locked: !l.locked } : l)); }}
                      className="text-slate-400 hover:text-white shrink-0" title={lyr.locked ? "Déverrouiller" : "Verrouiller"}>
                      {lyr.locked ? <Lock className="w-3.5 h-3.5 text-red-400" /> : <Unlock className="w-3.5 h-3.5 opacity-40" />}
                    </button>
                    <span className="w-4 h-4 rounded-md ring-1 ring-white/20 shrink-0 cursor-pointer relative overflow-hidden group/color"
                      style={{ background: lyr.color }}>
                      <input type="color" value={lyr.color}
                        onChange={e => { e.stopPropagation(); onLayersChange?.(layers.map(l => l.id === lyr.id ? { ...l, color: e.target.value } : l)); }}
                        onClick={e => e.stopPropagation()}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" title="Changer la couleur" />
                    </span>
                    <span className={`flex-1 text-left truncate ${activeLayerId === lyr.id ? "text-white font-medium" : "text-slate-400"}`}>
                      {lyr.name}
                    </span>
                    {total > 0 && <span className="text-[9px] text-slate-600 font-mono bg-white/5 px-1.5 py-0.5 rounded-md">{total}</span>}
                    {lyr.id !== "lyr_general" && lyr.id !== "lyr_structure" && lyr.id !== "lyr_annotation" && (
                      <button onClick={e => {
                        e.stopPropagation();
                        if (!confirm(`Supprimer le calque "${lyr.name}" ?`)) return;
                        onLayersChange?.(layers.filter(l => l.id !== lyr.id));
                        if (activeLayerId === lyr.id) onActiveLayerIdChange?.("lyr_general");
                      }} className="text-slate-600 hover:text-red-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" title="Supprimer">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Tool Chest panel overlay ── */}
        {showToolChest && (
          <div className="absolute top-14 right-4 z-50 glass border border-amber-500/30 rounded-2xl p-3 shadow-2xl min-w-64 pointer-events-auto max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-amber-300">Boîte à outils</span>
              <button onClick={() => setShowToolChest(false)} className="text-slate-500 hover:text-white text-xs">✕</button>
            </div>
            {DEFAULT_TOOL_CHEST.map(cat => (
              <div key={cat.id} className="mb-3">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 px-1">{cat.name}</p>
                <div className="grid grid-cols-2 gap-1">
                  {cat.presets.map(preset => (
                    <button key={preset.id}
                      onClick={() => {
                        // Apply preset: switch to the right tool, set color, layer, etc.
                        if (preset.toolType === "area") setTool("polygon");
                        else if (preset.toolType === "polylength") setTool("linear");
                        else if (preset.toolType === "count") {
                          setTool("count");
                          // Find or create a count group matching this preset with correct color + shape
                          const existing = countGroups.find(g => g.name === preset.subject || g.name === preset.name);
                          if (existing) {
                            // Update color and shape if different
                            if (existing.color !== preset.color || existing.shape !== preset.countShape) {
                              onCountGroupsChangeProp?.([...countGroups.map(g => g.id === existing.id ? { ...g, color: preset.color, shape: preset.countShape } : g)]);
                            }
                            onActiveCountGroupIdChange?.(existing.id);
                          } else if (onCountGroupsChangeProp) {
                            const newGrp: CountGroup = { id: `cnt_${Date.now()}`, name: preset.subject || preset.name, color: preset.color, shape: preset.countShape };
                            onCountGroupsChangeProp([...countGroups, newGrp]);
                            onActiveCountGroupIdChange?.(newGrp.id);
                          }
                        }
                        else if (preset.toolType === "diameter") setTool("circle");
                        else if (preset.toolType === "angle") setTool("angle");
                        if (preset.layerId) onActiveLayerIdChange?.(preset.layerId);
                        setShowToolChest(false);
                      }}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] text-left hover:bg-white/5 transition-colors border border-white/5"
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: preset.color }} />
                      <span className="text-slate-300 truncate">{preset.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Callout text input overlay */}
        {calloutInputPos && (() => {
          const sp = toSvg(calloutInputPos.end);
          return (
            <div className="absolute z-50 pointer-events-auto" style={{ left: sp.x, top: sp.y }}>
              <input autoFocus value={calloutInputValue}
                onChange={e => setCalloutInputValue(e.target.value)}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === "Enter" && calloutInputValue.trim()) {
                    onMarkupAnnotationsChange?.([...markupAnnotations, {
                      id: crypto.randomUUID(), type: "callout", color: activeColor, layer: activeLayerId,
                      x1: calloutInputPos.start.x, y1: calloutInputPos.start.y,
                      x2: calloutInputPos.end.x, y2: calloutInputPos.end.y,
                      text: calloutInputValue.trim(), lineWidth: 1.5, opacity: 1,
                    }]);
                    setCalloutInputPos(null); setCalloutInputValue("");
                  }
                  if (e.key === "Escape") { setCalloutInputPos(null); setCalloutInputValue(""); }
                }}
                onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                placeholder="Note…"
                className="bg-black/90 border border-rose-500/60 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-rose-400 min-w-44 shadow-xl"
              />
            </div>
          );
        })()}

        {/* Scale calibration input dialog + presets */}
        {tool === "scale" && scaleInputOpen && scalePts.length === 2 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 glass border border-yellow-500/40 rounded-2xl p-4 shadow-2xl flex flex-col gap-3 min-w-72 pointer-events-auto">
            <p className="text-sm text-yellow-300 font-semibold">{d("mc_scale_title" as DTKey)}</p>
            <p className="text-xs text-slate-400">{d("mc_scale_real_length" as DTKey)}</p>
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
              <span className="text-[10px] text-slate-500 shrink-0">{d("mc_scale_presets" as DTKey)}</span>
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
                {d("mc_scale_confirm" as DTKey)}
              </button>
              <button
                onClick={e => { e.stopPropagation(); setScalePts([]); setScaleInputOpen(false); setTool("polygon"); }}
                className="px-3 py-1.5 glass border border-white/10 text-slate-400 text-xs rounded-lg hover:text-white transition-colors"
              >
                {d("common_cancel" as DTKey)}
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
            {d("mc_hint_scroll" as DTKey)}
          </div>
        </div>
      </div>


    </div>
  );
}
