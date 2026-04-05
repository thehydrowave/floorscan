"use client";

import { useRef, useState, useEffect, useCallback, useLayoutEffect, useMemo, type ElementType } from "react";
import { motion } from "framer-motion";
import { Download, RotateCcw, Loader2, AlertTriangle, PenLine, Layers, Undo2, Redo2, FileDown, MousePointer2, Trash2, Eye, EyeOff, LayoutGrid, Scissors, Merge, Search, X, Save, Plus, ZoomIn, ZoomOut, Magnet, ChevronDown, Square, Eraser, DoorOpen, AppWindow, Maximize2, Sparkles, Check, Columns2, BrickWall, SeparatorVertical, Home, Hash, PenOff, PaintBucket, Wrench, Ruler, Minus, Compass, Type, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalysisResult, Room, VisualSearchMatch, CustomDetection } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { useAuth } from "@/lib/use-auth";
import MeasureCanvas from "@/components/measure/measure-canvas";
import SurfacePanel from "@/components/measure/surface-panel";
import EditorTutorialOverlay, { resetEditorTutorial } from "@/components/demo/editor-tutorial-overlay";
import { SurfaceType, MeasureZone, DEFAULT_SURFACE_TYPES, ROOM_SURFACE_TYPES, EMPRISE_TYPE, aggregateByType, aggregatePerimeterByType, polygonPerimeterM, pointInPolygon as pointInPolygonObj, polygonAreaNorm, CountGroup, CountPoint, DEFAULT_COUNT_GROUPS, TextAnnotation, CircleMeasure, circleMetrics, fmtLinear } from "@/lib/measure-types";
import type { WallSegment } from "@/lib/types";
import { snapIntelligent, SnapResult, SnapConfig, DEFAULT_SNAP_CONFIG } from "@/lib/snap-engine";

import { BACKEND } from "@/lib/backend";
import { getRoomColor } from "@/lib/room-colors";
type Layer = "door" | "window" | "french_door" | "interior" | "rooms" | "wall" | "cloison" | "surface" | "utilities" | null;
type EditorTool = "add_rect" | "erase_rect" | "add_poly" | "erase_poly" | "sam" | "select" | "split" | "visual_search" | "deduct_rect" | "linear" | "angle" | "count" | "rescale" | "text" | "circle";
// ── Constantes pièces ──────────────────────────────────────────────────────────
const ROOM_TYPES: { type: string; i18nKey: DTKey }[] = [
  { type: "bedroom",      i18nKey: "rt_bedroom" },
  { type: "living room",  i18nKey: "rt_living" },
  { type: "kitchen",      i18nKey: "rt_kitchen" },
  { type: "bathroom",     i18nKey: "rt_bathroom" },
  { type: "hallway",      i18nKey: "rt_hallway" },
  { type: "office",       i18nKey: "rt_office" },
  { type: "wc",           i18nKey: "rt_wc" },
  { type: "dining room",  i18nKey: "rt_dining" },
  { type: "storage",      i18nKey: "rt_storage" },
  { type: "garage",       i18nKey: "rt_garage" },
  { type: "balcony",      i18nKey: "rt_balcony" },
  { type: "laundry",      i18nKey: "rt_laundry" },
];

// ROOM_COLORS & getRoomColor imported from @/lib/room-colors

/** Ray-casting point-in-polygon test (normalized coords) — thin wrapper around shared impl */
function pointInPolygon(x: number, y: number, polygon: { x: number; y: number }[]): boolean {
  return pointInPolygonObj({ x, y }, polygon);
}

/* polygonAreaNorm is now imported from @/lib/measure-types */

/** Snap a normalized point to the nearest wall segment if within threshold (screen px) */
function snapToWalls(
  normX: number, normY: number,
  walls: WallSegment[] | undefined,
  dispW: number, dispH: number,
  threshold = 10
): { x: number; y: number; snapped: boolean } {
  if (!walls || walls.length === 0) return { x: normX, y: normY, snapped: false };
  let bestDist = Infinity;
  let bestX = normX, bestY = normY;
  const px = normX * dispW, py = normY * dispH;
  for (const w of walls) {
    const ax = w.x1_norm * dispW, ay = w.y1_norm * dispH;
    const bx = w.x2_norm * dispW, by = w.y2_norm * dispH;
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) continue;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const cx = ax + t * dx, cy = ay + t * dy;
    const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
    if (dist < bestDist) {
      bestDist = dist;
      bestX = cx / dispW;
      bestY = cy / dispH;
    }
  }
  if (bestDist <= threshold) return { x: bestX, y: bestY, snapped: true };
  return { x: normX, y: normY, snapped: false };
}

/** Edge length in meters from two normalized points */
function edgeLengthM(
  p1: { x: number; y: number }, p2: { x: number; y: number },
  natW: number, natH: number, ppm: number
): number {
  const dx = (p2.x - p1.x) * natW;
  const dy = (p2.y - p1.y) * natH;
  return Math.sqrt(dx * dx + dy * dy) / ppm;
}

export interface MeasurementSnapshot {
  surfaceZones?: Array<{ typeName: string; totalArea: number; zoneCount: number }>;
  linearMeasures?: Array<{ distanceM: number | null }>;
  angleMeasures?: Array<{ angleDeg: number }>;
  countCategories?: Array<{ name: string; count: number }>;
  customDetections?: Array<{ label: string; count: number; area_m2?: number | null }>;
}

interface EditorStepProps {
  sessionId: string;
  initialResult: AnalysisResult;
  initialCustomDetections?: CustomDetection[];
  onRestart: () => void;
  onSessionExpired?: () => void;
  onAddPage?: () => void;
  onGoResults?: (updatedResult: AnalysisResult, detections?: CustomDetection[]) => void;
  onMeasurementDataChange?: (data: MeasurementSnapshot) => void;
  originalImageB64?: string | null;
  cropRect?: { x: number; y: number; w: number; h: number } | null;
}

export default function EditorStep({ sessionId, initialResult, initialCustomDetections, onRestart, onSessionExpired, onAddPage, onGoResults, onMeasurementDataChange, originalImageB64, cropRect }: EditorStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const { isAdmin } = useAuth();

  const [result, setResult] = useState(initialResult);
  const [layer, setLayer] = useState<Layer>(null);
  const [tool, setTool] = useState<EditorTool>("add_rect");
  // Toggle between cropped (AI analysis) view and original (full image) view
  const [showOriginal, setShowOriginal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingDxf, setExportingDxf] = useState(false);
  const [roomHistoryLen, setRoomHistoryLen] = useState(0);
  const [roomFutureLen, setRoomFutureLen] = useState(0);

  // Opening selection & highlight
  const [selectedOpeningIdx, setSelectedOpeningIdx] = useState<number | null>(null);
  const [showOpeningOverlay, setShowOpeningOverlay] = useState(false);

  // Overlays visibilité (murs / pièces / portes / fenêtres)
  const [showWalls, setShowWalls] = useState(false);
  const [showRooms, setShowRooms] = useState(false);
  const [showDoors, setShowDoors] = useState(true);
  const [showWindows, setShowWindows] = useState(true);
  const [showFrenchDoors, setShowFrenchDoors] = useState(false);
  const [showCloisons, setShowCloisons] = useState(false);
  const [showSurfaces, setShowSurfaces] = useState(true);

  // Mask edit undo/redo lengths
  const [editHistoryLen, setEditHistoryLen] = useState(0);
  const [editFutureLen, setEditFutureLen] = useState(0);

  // Zoom / pan state (matching Survey canvas behavior)
  const [zoom, setZoom] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [panCursor, setPanCursor] = useState(false);
  const zoomContainerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const isPanRef = useRef(false);
  const panStartRef = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { translateRef.current = translate; }, [translate]);

  // Sélection / édition de pièce
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [editingRoomId, setEditingRoomId] = useState<number | null>(null);
  const [activeRoomType, setActiveRoomType] = useState<string>("bedroom");

  // Multi-selection
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<number>>(new Set());
  const [selectedOpeningIdxs, setSelectedOpeningIdxs] = useState<Set<number>>(new Set());
  // Clipboard
  const clipboardRef = useRef<{ rooms: any[]; openings: any[]; texts?: any[]; measures?: any[]; countPoints?: any[] } | null>(null);

  // Auto-enable overlays + reset tool on layer change
  useEffect(() => {
    if (layer === null) {
      // Désélection : réinitialiser sans changer la visibilité
      pts.current = [];
      setTool("add_rect");
      setSelectedRoomId(null);
      setEditingRoomId(null);
      setSelectedRoomIds(new Set());
      setSelectedOpeningIdxs(new Set());
      return;
    }
    // Visibilité exclusive : n'afficher que l'overlay de l'élément sélectionné
    setShowDoors(layer === "door");
    setShowWindows(layer === "window");
    setShowFrenchDoors(layer === "french_door");
    setShowWalls(layer === "wall");
    setShowCloisons(layer === "cloison");
    setShowRooms(layer === "rooms");
    // Réinitialisation outil
    if (layer === "rooms") {
      setTool("select");
    } else {
      if (tool === "select" || tool === "split") setTool("add_rect");
      if (tool === "sam" && ((!isAdmin) || (layer !== "door" && layer !== "window" && layer !== "interior"))) setTool("add_rect");
      pts.current = [];
    }
    if (layer !== "rooms") {
      setSelectedRoomId(null);
      setEditingRoomId(null);
      setSelectedRoomIds(new Set());
      setSelectedOpeningIdxs(new Set());
    }
  }, [layer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Vertex drag editing for room polygons
  const [dragRoomVertex, setDragRoomVertex] = useState<{ roomId: number; idx: number } | null>(null);
  const [localRooms, setLocalRooms] = useState<Room[] | null>(null);
  const [snappedVertex, setSnappedVertex] = useState(false);
  const [snapConfig, setSnapConfig] = useState<SnapConfig>(DEFAULT_SNAP_CONFIG);
  const [snapResult, setSnapResult] = useState<SnapResult | null>(null);
  const snapConfigRef = useRef<SnapConfig>(DEFAULT_SNAP_CONFIG);
  useEffect(() => { snapConfigRef.current = snapConfig; }, [snapConfig]);
  const dragRoomVertexRef = useRef<{ roomId: number; idx: number } | null>(null);
  const localRoomsRef = useRef<Room[] | null>(null);

  // Taille d'affichage de l'image (pour les SVG overlays)
  const [imgDisplaySize, setImgDisplaySize] = useState({ w: 0, h: 0 });

  // Measure state
  const [zones, setZones] = useState<MeasureZone[]>([]);
  const [linearMeasures, setLinearMeasures] = useState<{id: string; p1: {x:number;y:number}; p2: {x:number;y:number}; distPx: number}[]>([]);
  const [angleMeasures, setAngleMeasures] = useState<{id: string; p1: {x:number;y:number}; vertex: {x:number;y:number}; p3: {x:number;y:number}; angleDeg: number}[]>([]);
  const [surfaceTypes, setSurfaceTypes] = useState<SurfaceType[]>(DEFAULT_SURFACE_TYPES);
  const [activeTypeId, setActiveTypeId] = useState(DEFAULT_SURFACE_TYPES[0].id);
  const [panelMode, setPanelMode] = useState<"metre" | "rooms" | "linear" | "count">("metre");
  // Count categories
  const [countGroups, setCountGroups] = useState<CountGroup[]>(DEFAULT_COUNT_GROUPS);
  const [countPoints, setCountPoints] = useState<CountPoint[]>([]);
  const [activeCountGroupId, setActiveCountGroupId] = useState<string>(DEFAULT_COUNT_GROUPS[0].id);
  const [countGroupVisibility, setCountGroupVisibility] = useState<Record<string, boolean>>({});
  const [sidebarTab, setSidebarTab] = useState<"results" | "rooms" | "visibility">("results");

  // Text annotations & Circle measurements (Wave 4)
  const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>([]);
  const [circleMeasures, setCircleMeasures] = useState<CircleMeasure[]>([]);
  // Text selection & editing
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  // Measure selection (linear/circle/angle)
  const [selectedMeasureId, setSelectedMeasureId] = useState<string | null>(null);
  const [selectedMeasureType, setSelectedMeasureType] = useState<"linear" | "circle" | "angle" | null>(null);
  // Admin: full plan overlay
  const [showFullPlan, setShowFullPlan] = useState(false);
  const [textInputPos, setTextInputPos] = useState<{ x: number; y: number } | null>(null);
  const [textInputValue, setTextInputValue] = useState("");
  const [textColor, setTextColor] = useState("#38BDF8");
  const [textFontSize, setTextFontSize] = useState(12);
  const [circleCenter, setCircleCenter] = useState<{ x: number; y: number } | null>(null);
  const [showLinearMeasures, setShowLinearMeasures] = useState(true);
  const [showTuto, setShowTuto] = useState(false);
  const [showCountDropdown, setShowCountDropdown] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [activeFloorTypeId, setActiveFloorTypeId] = useState<string>("");
  const [showNewFloorType, setShowNewFloorType] = useState(false);
  const [newFloorTypeName, setNewFloorTypeName] = useState("");
  const [newFloorTypeColor, setNewFloorTypeColor] = useState("#3B82F6");
  const allMeasureTypes = useMemo(
    () => [...surfaceTypes, ...ROOM_SURFACE_TYPES, EMPRISE_TYPE],
    [surfaceTypes]
  );
  const handlePanelModeChange = useCallback((mode: "metre" | "rooms" | "linear" | "count") => {
    setPanelMode(mode);
    if (mode === "rooms") {
      setActiveTypeId(ROOM_SURFACE_TYPES[0].id);
    } else if (mode === "metre") {
      setActiveTypeId(surfaceTypes[0]?.id || DEFAULT_SURFACE_TYPES[0].id);
    }
  }, [surfaceTypes]);
  const [imageNatural, setImageNatural] = useState({ w: 0, h: 0 });
  const [exportingMeasurePdf, setExportingMeasurePdf] = useState(false);

  // Visual search state
  const [vsMatches, setVsMatches] = useState<VisualSearchMatch[]>([]);
  const [vsSearching, setVsSearching] = useState(false);
  const [vsCrop, setVsCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const vsDrawing = useRef(false);
  const vsStart = useRef({ x: 0, y: 0 });
  const [vsSaveLabel, setVsSaveLabel] = useState("");
  const [vsSaveOpen, setVsSaveOpen] = useState(false);
  const [vsEditMode, setVsEditMode] = useState<"search" | "add" | "remove">("search");
  const [customDetections, setCustomDetections] = useState<CustomDetection[]>(initialCustomDetections ?? []);

  // Push measurement data up to parent (for chatbot context)
  useEffect(() => {
    onMeasurementDataChange?.({
      surfaceZones: surfaceTypes.map(st => {
        const stZones = zones.filter(z => z.typeId === st.id);
        return { typeName: st.name, totalArea: 0, zoneCount: stZones.length };
      }).filter(s => s.zoneCount > 0),
      linearMeasures: linearMeasures.map(lm => ({
        distanceM: ppm ? lm.distPx / ppm : null,
      })),
      angleMeasures: angleMeasures.map(am => ({ angleDeg: am.angleDeg })),
      countCategories: countGroups.map(g => ({
        name: g.name,
        count: countPoints.filter(p => p.groupId === g.id).length,
      })).filter(c => c.count > 0),
      customDetections: customDetections.map(det => ({
        label: det.label, count: det.count, area_m2: det.total_area_m2,
      })),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones.length, linearMeasures.length, angleMeasures.length, countPoints.length, customDetections.length]);

  // Undo / Redo (measure mode)
  const historyRef   = useRef<MeasureZone[][]>([]);
  const futureRef    = useRef<MeasureZone[][]>([]);
  const zonesSnapRef = useRef<MeasureZone[]>(zones);
  const [historyLen, setHistoryLen] = useState(0);
  const [futureLen,  setFutureLen]  = useState(0);
  useEffect(() => { zonesSnapRef.current = zones; }, [zones]);

  const pushHistory = useCallback((snapshot: MeasureZone[]) => {
    historyRef.current = [...historyRef.current.slice(-49), snapshot];
    futureRef.current  = [];
    setHistoryLen(historyRef.current.length);
    setFutureLen(0);
  }, []);

  const undoHistory = useCallback(() => {
    if (!historyRef.current.length) return;
    const prev = historyRef.current[historyRef.current.length - 1];
    futureRef.current  = [zonesSnapRef.current, ...futureRef.current.slice(0, 49)];
    historyRef.current = historyRef.current.slice(0, -1);
    setHistoryLen(historyRef.current.length);
    setFutureLen(futureRef.current.length);
    setZones(prev);
  }, []);

  const redoHistory = useCallback(() => {
    if (!futureRef.current.length) return;
    const next = futureRef.current[0];
    historyRef.current = [...historyRef.current.slice(-49), zonesSnapRef.current];
    futureRef.current  = futureRef.current.slice(1);
    setHistoryLen(historyRef.current.length);
    setFutureLen(futureRef.current.length);
    setZones(next);
  }, []);

  // Track img display size for SVG overlay positioning
  const updateImgDisplaySize = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setImgDisplaySize({ w: img.offsetWidth, h: img.offsetHeight });
  }, []);

  useEffect(() => {
    window.addEventListener("resize", updateImgDisplaySize);
    return () => window.removeEventListener("resize", updateImgDisplaySize);
  }, [updateImgDisplaySize]);

  // Auto-fit : calcule le zoom qui remplit le canvas à ~90 % sans dépasser
  const fitToView = useCallback(() => {
    requestAnimationFrame(() => {
      const container = zoomContainerRef.current;
      const img = imgRef.current;
      if (!container || !img || img.offsetWidth === 0 || img.offsetHeight === 0) return;
      const pad = 40;
      const fitZoom = Math.min(
        (container.clientWidth  - pad * 2) / img.offsetWidth,
        (container.clientHeight - pad * 2) / img.offsetHeight,
      );
      setZoom(Math.max(0.3, Math.min(3, fitZoom)));
      setTranslate({ x: 0, y: 0 });
    });
  }, []);

  /** Zoom + pan to focus on a specific layer's detected elements */
  const zoomToLayerElements = useCallback((layerType: string) => {
    requestAnimationFrame(() => {
      const container = zoomContainerRef.current;
      const img = imgRef.current;
      if (!container || !img || img.offsetWidth === 0 || imageNatural.w === 0) return;

      // Map layer type to mask/data: find bounding box of all elements of that type
      let bbox: { x: number; y: number; w: number; h: number } | null = null;

      // Check rooms
      if (layerType === "rooms" && result.rooms && result.rooms.length > 0) {
        const allPts = result.rooms.flatMap(r => r.polygon_norm ?? [{ x: r.centroid_norm.x, y: r.centroid_norm.y }]);
        if (allPts.length > 0) {
          const xs = allPts.map(p => p.x), ys = allPts.map(p => p.y);
          bbox = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        }
      }

      // For mask-based layers (door, window, etc), we can't get a precise bbox from the mask image
      // So just reset to fit view — the mask overlay will be visible
      if (!bbox) { fitToView(); return; }

      // Compute zoom to fit the bbox with padding
      const pad = 60;
      const imgW = img.offsetWidth;
      const imgH = img.offsetHeight;
      const containerW = container.clientWidth;
      const containerH = container.clientHeight;

      // Bbox in image pixel space
      const bxPx = bbox.x * imgW, byPx = bbox.y * imgH;
      const bwPx = bbox.w * imgW, bhPx = bbox.h * imgH;

      if (bwPx < 5 || bhPx < 5) { fitToView(); return; }

      const newZoom = Math.min(
        (containerW - pad * 2) / bwPx,
        (containerH - pad * 2) / bhPx,
        5, // max zoom
      );
      const newZoomClamped = Math.max(0.5, newZoom);

      // Center of bbox in image space (relative to image center)
      const bCx = (bxPx + bwPx / 2) - imgW / 2;
      const bCy = (byPx + bhPx / 2) - imgH / 2;

      setZoom(newZoomClamped);
      setTranslate({ x: -bCx * newZoomClamped, y: -bCy * newZoomClamped });
    });
  }, [imageNatural.w, result.rooms, fitToView]);

  // ── Wheel zoom centered on cursor (same behavior as Survey canvas) ──
  const handleWheelZoom = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const container = zoomContainerRef.current;
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
    const el = zoomContainerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheelZoom, { passive: false });
    return () => el.removeEventListener("wheel", handleWheelZoom);
  }, [handleWheelZoom]);

  // Canvas (editor mode)
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const pts = useRef<[number, number][]>([]);
  const startPt = useRef({ x: 0, y: 0 });

  const currentOverlay = showOriginal && originalImageB64
    ? originalImageB64
    : (layer === "wall" || layer === "cloison")
      ? result.plan_b64!
      : layer === "interior" && result.overlay_interior_b64
        ? result.overlay_interior_b64
        : result.plan_b64 ?? result.overlay_openings_b64!;

  // Track natural image size for measure tool
  useEffect(() => {
    const img = new Image();
    img.onload = () => setImageNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = `data:image/png;base64,${currentOverlay}`;
  }, [currentOverlay]);

  useEffect(() => {
    const img = imgRef.current;
    const cv = canvasRef.current;
    if (!img || !cv) return;
    const sync = () => {
      cv.width = img.offsetWidth;
      cv.height = img.offsetHeight;
      updateImgDisplaySize();
    };
    if (img.complete) sync();
    else img.onload = sync;
    const ro = new ResizeObserver(sync);
    ro.observe(img);
    return () => ro.disconnect();
  }, [currentOverlay, updateImgDisplaySize]);

  // ── Refs for vertex drag window handlers (avoids stale closures) ──
  const resultRoomsRef = useRef(result.rooms);
  const resultWallsRef = useRef(result.walls);
  const imageNaturalRef = useRef(imageNatural);
  const ppmRef = useRef<number | null>(result.pixels_per_meter ?? null);
  const imgDisplaySizeRef = useRef(imgDisplaySize);
  resultRoomsRef.current = result.rooms;
  resultWallsRef.current = result.walls;
  imageNaturalRef.current = imageNatural;
  imgDisplaySizeRef.current = imgDisplaySize;

  // Ref for sendEditRoom (assigned after function is defined)
  const sendEditRoomRef = useRef<(params: any) => Promise<void>>(async () => {});

  // ── Window-level mousemove/mouseup for room vertex drag + pan ──
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // Pan (right-click drag)
      if (isPanRef.current) {
        const dx = e.clientX - panStartRef.current.mx;
        const dy = e.clientY - panStartRef.current.my;
        setTranslate({ x: panStartRef.current.tx + dx, y: panStartRef.current.ty + dy });
        return;
      }
      const dv = dragRoomVertexRef.current;
      if (!dv) return;
      const img = imgRef.current;
      if (!img) return;
      const r = img.getBoundingClientRect();
      const rawX = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const rawY = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      // Snap intelligent (multi-criteria: vertex, wall, midpoint, alignment, grid)
      const ds = imgDisplaySizeRef.current;
      const dv2 = dragRoomVertexRef.current!;
      const snap = snapIntelligent(rawX, rawY, snapConfigRef.current, {
        walls: resultWallsRef.current,
        rooms: localRoomsRef.current ?? resultRoomsRef.current,
        currentRoomId: dv2.roomId,
        currentVertexIdx: dv2.idx,
        dispW: ds.w,
        dispH: ds.h,
      });
      const normX = snap.x, normY = snap.y;
      setSnappedVertex(snap.snapped);
      setSnapResult(snap);
      const { roomId, idx } = dv;

      const natW = imageNaturalRef.current.w;
      const natH = imageNaturalRef.current.h;
      const rooms = localRoomsRef.current ?? resultRoomsRef.current ?? [];
      const updated = rooms.map(room => {
        if (room.id !== roomId || !room.polygon_norm) return room;
        const newPoly = room.polygon_norm.map((p, i) => i === idx ? { x: normX, y: normY } : p);
        const areaPx = polygonAreaNorm(newPoly, natW, natH);
        const ppmV = ppmRef.current;
        const areaM2 = ppmV ? areaPx / (ppmV * ppmV) : null;
        const perimeterM = ppmV && natW > 0 ? polygonPerimeterM(newPoly, natW, natH, ppmV) : undefined;
        const cx = newPoly.reduce((s, p) => s + p.x, 0) / newPoly.length;
        const cy = newPoly.reduce((s, p) => s + p.y, 0) / newPoly.length;
        // Recalculate bbox_norm for proper label sizing
        const xs = newPoly.map(p => p.x), ys = newPoly.map(p => p.y);
        const bx = Math.min(...xs), by = Math.min(...ys);
        const bbox_norm = { x: bx, y: by, w: Math.max(...xs) - bx, h: Math.max(...ys) - by };
        return { ...room, polygon_norm: newPoly, area_m2: areaM2, perimeter_m: perimeterM, centroid_norm: { x: cx, y: cy }, bbox_norm };
      });
      localRoomsRef.current = updated;
      setLocalRooms(updated);
    };

    const onUp = (e: MouseEvent) => {
      // Release pan
      if (e.button === 2) {
        isPanRef.current = false;
        setPanCursor(false);
        return;
      }
      const dv = dragRoomVertexRef.current;
      if (e.button !== 0 || !dv) return;
      const rooms = localRoomsRef.current;

      dragRoomVertexRef.current = null;
      setDragRoomVertex(null);
      setSnappedVertex(false);
      setSnapResult(null);

      if (rooms) {
        // Commit updated polygon directly to result (frontend-only, no backend round-trip).
        // The backend mask pipeline (erase→redraw→findContours) can lose rooms,
        // so we just keep the updated coordinates as-is.
        setResult(prev => ({ ...prev, rooms }));
      }
      localRoomsRef.current = null;
      setLocalRooms(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard: Ctrl+Z/Y for undo/redo ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (layer === "rooms") sendUndoRoom();
        else sendUndoMask();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        if (layer === "rooms") sendRedoRoom();
        else sendRedoMask();
      }
      if (e.key === "Escape" && tool === "split") {
        pts.current = []; drawCanvas(); setTool("select");
      }
      if (e.key === "Escape" && tool === "add_poly" && layer === "rooms") {
        pts.current = []; drawCanvas(); setTool("select");
      }

      // Ctrl+C: Copy selected elements
      if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        e.preventDefault();
        const rooms: any[] = [];
        const openings: any[] = [];
        const copiedTexts: any[] = selectedTextId ? textAnnotations.filter(t => t.id === selectedTextId) : [];
        const copiedMeasures: any[] = [];
        if (selectedMeasureId && selectedMeasureType === "linear") {
          const m = linearMeasures.find(lm => lm.id === selectedMeasureId);
          if (m) copiedMeasures.push({ type: "linear", data: m });
        }
        if (selectedMeasureId && selectedMeasureType === "circle") {
          const m = circleMeasures.find(cm => cm.id === selectedMeasureId);
          if (m) copiedMeasures.push({ type: "circle", data: m });
        }
        if (selectedMeasureId && selectedMeasureType === "angle") {
          const m = angleMeasures.find(am => am.id === selectedMeasureId);
          if (m) copiedMeasures.push({ type: "angle", data: m });
        }
        // Collect from multi-select
        if (selectedRoomIds.size > 0) {
          (result.rooms ?? []).forEach(r => { if (selectedRoomIds.has(r.id)) rooms.push(r); });
        } else if (selectedRoomId) {
          const r = (result.rooms ?? []).find(r => r.id === selectedRoomId);
          if (r) rooms.push(r);
        }
        if (selectedOpeningIdxs.size > 0) {
          (result.openings ?? []).forEach((o, i) => { if (selectedOpeningIdxs.has(i)) openings.push(o); });
        } else if (selectedOpeningIdx !== null) {
          const o = result.openings?.[selectedOpeningIdx];
          if (o) openings.push(o);
        }
        if (rooms.length > 0 || openings.length > 0 || copiedTexts.length > 0 || copiedMeasures.length > 0) {
          clipboardRef.current = { rooms, openings, texts: copiedTexts, measures: copiedMeasures };
          toast({ title: `${rooms.length + openings.length + copiedTexts.length + copiedMeasures.length} element(s) copied`, variant: "success" });
        }
      }

      // Ctrl+V: Paste
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        e.preventDefault();
        if (!clipboardRef.current) return;
        const offset = 0.02;
        if (clipboardRef.current.rooms.length > 0) {
          const maxId = Math.max(0, ...(result.rooms ?? []).map(r => r.id));
          const newRooms = clipboardRef.current.rooms.map((r: any, i: number) => ({
            ...r,
            id: maxId + i + 1,
            label_fr: `${r.label_fr} (copie)`,
            centroid_norm: { x: r.centroid_norm.x + offset, y: r.centroid_norm.y + offset },
            bbox_norm: { ...r.bbox_norm, x: r.bbox_norm.x + offset, y: r.bbox_norm.y + offset },
            polygon_norm: r.polygon_norm?.map((p: any) => ({ x: p.x + offset, y: p.y + offset })),
          }));
          setResult(prev => ({ ...prev, rooms: [...(prev.rooms ?? []), ...newRooms] }));
        }
        if (clipboardRef.current.openings.length > 0) {
          const pxOff = 30;
          const newOpenings = clipboardRef.current.openings.map((o: any) => ({
            ...o, x_px: o.x_px + pxOff, y_px: o.y_px + pxOff,
          }));
          setResult(prev => ({ ...prev, openings: [...(prev.openings ?? []), ...newOpenings] }));
        }
        if (clipboardRef.current.texts && clipboardRef.current.texts.length > 0) {
          const newTexts = clipboardRef.current.texts.map((t: any) => ({ ...t, id: crypto.randomUUID(), x: t.x + 0.02, y: t.y + 0.02 }));
          setTextAnnotations(prev => [...prev, ...newTexts]);
        }
        if (clipboardRef.current.measures && clipboardRef.current.measures.length > 0) {
          for (const m of clipboardRef.current.measures) {
            if (m.type === "linear") {
              setLinearMeasures(prev => [...prev, { ...m.data, id: crypto.randomUUID(), p1: { x: m.data.p1.x + 0.02, y: m.data.p1.y + 0.02 }, p2: { x: m.data.p2.x + 0.02, y: m.data.p2.y + 0.02 } }]);
            }
            if (m.type === "circle") {
              setCircleMeasures(prev => [...prev, { ...m.data, id: crypto.randomUUID(), center: { x: m.data.center.x + 0.02, y: m.data.center.y + 0.02 }, edgePoint: { x: m.data.edgePoint.x + 0.02, y: m.data.edgePoint.y + 0.02 } }]);
            }
            if (m.type === "angle") {
              setAngleMeasures(prev => [...prev, { ...m.data, id: crypto.randomUUID(), p1: { x: m.data.p1.x + 0.02, y: m.data.p1.y + 0.02 }, vertex: { x: m.data.vertex.x + 0.02, y: m.data.vertex.y + 0.02 }, p3: { x: m.data.p3.x + 0.02, y: m.data.p3.y + 0.02 } }]);
            }
          }
        }
        toast({ title: "Elements pasted", variant: "success" });
      }

      // Delete/Backspace: Delete selected
      if (e.key === "Delete" || e.key === "Backspace") {
        // Don't prevent default if focused on an input
        if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
        e.preventDefault();
        if (selectedTextId) {
          setTextAnnotations(prev => prev.filter(t => t.id !== selectedTextId));
          setSelectedTextId(null);
        } else if (selectedMeasureId) {
          if (selectedMeasureType === "linear") setLinearMeasures(prev => prev.filter(m => m.id !== selectedMeasureId));
          if (selectedMeasureType === "circle") setCircleMeasures(prev => prev.filter(c => c.id !== selectedMeasureId));
          if (selectedMeasureType === "angle") setAngleMeasures(prev => prev.filter(a => a.id !== selectedMeasureId));
          setSelectedMeasureId(null); setSelectedMeasureType(null);
        } else if (selectedRoomIds.size > 0) {
          selectedRoomIds.forEach(id => sendEditRoom({ action: "delete_room", room_id: id }));
          setSelectedRoomIds(new Set());
        } else if (selectedRoomId) {
          sendEditRoom({ action: "delete_room", room_id: selectedRoomId });
          setSelectedRoomId(null);
        }
      }

      // Arrow keys: Move selected rooms
      if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key) && (selectedRoomIds.size > 0 || selectedRoomId)) {
        if ((e.target as HTMLElement)?.tagName === "INPUT") return;
        e.preventDefault();
        const delta = 0.005;
        const dx = e.key === "ArrowLeft" ? -delta : e.key === "ArrowRight" ? delta : 0;
        const dy = e.key === "ArrowUp" ? -delta : e.key === "ArrowDown" ? delta : 0;
        const idsToMove = selectedRoomIds.size > 0 ? selectedRoomIds : new Set(selectedRoomId ? [selectedRoomId] : []);
        if (idsToMove.size > 0) {
          setResult(prev => ({
            ...prev,
            rooms: (prev.rooms ?? []).map(r => {
              if (!idsToMove.has(r.id)) return r;
              return {
                ...r,
                centroid_norm: { x: r.centroid_norm.x + dx, y: r.centroid_norm.y + dy },
                bbox_norm: { ...r.bbox_norm, x: r.bbox_norm.x + dx, y: r.bbox_norm.y + dy },
                polygon_norm: r.polygon_norm?.map(p => ({ x: p.x + dx, y: p.y + dy })),
              };
            }),
          }));
        }
      }

      // Escape: Clear all selection
      if (e.key === "Escape") {
        setSelectedRoomIds(new Set());
        setSelectedOpeningIdxs(new Set());
        setSelectedRoomId(null);
        setSelectedOpeningIdx(null);
        setSelectedTextId(null);
        setEditingTextId(null);
        setSelectedMeasureId(null);
        setSelectedMeasureType(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // runs every render to capture latest undo/redo refs

  function scaleX(px: number) {
    const img = imgRef.current!;
    return px * img.naturalWidth / img.offsetWidth;
  }
  function scaleY(py: number) {
    const img = imgRef.current!;
    return py * img.naturalHeight / img.offsetHeight;
  }

  /** Convert mouse event viewport coords → canvas-space coords (accounts for zoom) */
  function mouseToCanvas(clientX: number, clientY: number) {
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (cv.width  / rect.width),
      y: (clientY - rect.top)  * (cv.height / rect.height),
    };
  }

  const drawCanvas = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const isErase = tool.startsWith("erase");
    const roomColor = layer === "rooms" ? getRoomColor(activeRoomType) : null;
    const color = isErase ? "#F87171" : (roomColor ?? (layer === "interior" ? "#34D399" : layer === "door" ? "#D946EF" : layer === "french_door" ? "#F97316" : layer === "wall" ? "#EF4444" : layer === "cloison" ? "#0064ff" : "#22D3EE"));
    if (pts.current.length > 0 && (tool === "add_poly" || tool === "erase_poly")) {
      const img = imgRef.current!;
      // Fill the polygon shape preview with semi-transparent color
      if (pts.current.length >= 3) {
        ctx.beginPath();
        pts.current.forEach(([px, py], i) => {
          const sx = px * img.offsetWidth / img.naturalWidth;
          const sy = py * img.offsetHeight / img.naturalHeight;
          if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        });
        ctx.closePath();
        ctx.fillStyle = color + "28";
        ctx.fill();
      }
      ctx.beginPath();
      pts.current.forEach(([px, py], i) => {
        const sx = px * img.offsetWidth / img.naturalWidth;
        const sy = py * img.offsetHeight / img.naturalHeight;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
      pts.current.forEach(([px, py]) => {
        const sx = px * img.offsetWidth / img.naturalWidth;
        const sy = py * img.offsetHeight / img.naturalHeight;
        ctx.beginPath(); ctx.arc(sx, sy, 5, 0, 2 * Math.PI);
        ctx.fillStyle = "white"; ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
      });
    }
    // Split tool: draw preview points and line
    if (tool === "split" && pts.current.length > 0) {
      const img = imgRef.current!;
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 2.5;
      ctx.beginPath();
      pts.current.forEach(([px, py], i) => {
        const sx = px * img.offsetWidth / img.naturalWidth;
        const sy = py * img.offsetHeight / img.naturalHeight;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      pts.current.forEach(([px, py]) => {
        const sx = px * img.offsetWidth / img.naturalWidth;
        const sy = py * img.offsetHeight / img.naturalHeight;
        ctx.beginPath(); ctx.arc(sx, sy, 5, 0, 2 * Math.PI);
        ctx.fillStyle = "#ef4444"; ctx.fill();
        ctx.strokeStyle = "white"; ctx.lineWidth = 1.5; ctx.stroke();
      });
    }
  }, [tool, layer, activeRoomType]);

  const sendEditRoom = async (params: any) => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${BACKEND}/edit-room-mask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, room_type: activeRoomType, ...params }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? d("ed_err_edit"));
      const data = await r.json();
      setResult(prev => ({
        ...prev,
        mask_rooms_b64: data.mask_rooms_b64 ?? prev.mask_rooms_b64,
        rooms: data.rooms ?? prev.rooms,
      }));
      if (data.history_len != null) setRoomHistoryLen(data.history_len);
      if (data.future_len != null) setRoomFutureLen(data.future_len);
      // Pour replace_polygon, garder la sélection (vertex drag continu)
      if (params.action !== "replace_polygon") {
        setSelectedRoomId(null);
        setEditingRoomId(null);
      }
      toast({ title: d("ed_room_updated"), variant: "success" });
    } catch (e: any) {
      if (e.message?.includes("Session introuvable")) {
        toast({ title: d("ed_session_exp"), description: d("ed_session_msg"), variant: "error" });
        onSessionExpired?.();
      } else { setError(e.message); toast({ title: d("ed_err"), description: e.message, variant: "error" }); }
    } finally { setLoading(false); }
  };
  sendEditRoomRef.current = sendEditRoom;

  // ── Undo / Redo room edits ──
  const sendUndoRoom = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND}/undo-room-mask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? d("ed_err"));
      const data = await r.json();
      setResult(prev => ({ ...prev, mask_rooms_b64: data.mask_rooms_b64 ?? prev.mask_rooms_b64, rooms: data.rooms ?? prev.rooms }));
      setRoomHistoryLen(data.history_len ?? 0);
      setRoomFutureLen(data.future_len ?? 0);
      toast({ title: d("ed_undone"), variant: "success" });
    } catch (e: any) {
      toast({ title: d("ed_err"), description: e.message, variant: "error" });
    } finally { setLoading(false); }
  };

  const sendRedoRoom = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND}/redo-room-mask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? d("ed_err"));
      const data = await r.json();
      setResult(prev => ({ ...prev, mask_rooms_b64: data.mask_rooms_b64 ?? prev.mask_rooms_b64, rooms: data.rooms ?? prev.rooms }));
      setRoomHistoryLen(data.history_len ?? 0);
      setRoomFutureLen(data.future_len ?? 0);
      toast({ title: d("ed_redone"), variant: "success" });
    } catch (e: any) {
      toast({ title: d("ed_err"), description: e.message, variant: "error" });
    } finally { setLoading(false); }
  };

  // ── DXF export ──
  const handleExportDxf = async () => {
    setExportingDxf(true);
    try {
      const r = await fetch(`${BACKEND}/export-dxf`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? d("ed_err"));
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "floorscan_export.dxf"; a.click();
      URL.revokeObjectURL(url);
      toast({ title: d("ed_dxf_ok"), variant: "success" });
    } catch (e: any) {
      toast({ title: d("ed_dxf_err"), description: e.message, variant: "error" });
    } finally { setExportingDxf(false); }
  };

  const sendEdit = async (params: any) => {
    if (layer === "rooms") { await sendEditRoom(params); return; }
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${BACKEND}/edit-mask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, layer, ...params }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? d("ed_err_edit"));
      const data = await r.json();
      setResult(prev => ({
        ...prev,
        overlay_openings_b64:  data.overlay_openings_b64  ?? prev.overlay_openings_b64,
        overlay_interior_b64:  data.overlay_interior_b64  ?? prev.overlay_interior_b64,
        mask_doors_b64:        data.mask_doors_b64        ?? prev.mask_doors_b64,
        mask_windows_b64:      data.mask_windows_b64      ?? prev.mask_windows_b64,
        mask_walls_b64:        data.mask_walls_b64        ?? prev.mask_walls_b64,
        mask_walls_pixel_b64:  data.mask_walls_pixel_b64  ?? prev.mask_walls_pixel_b64,
        mask_cloisons_b64:     data.mask_cloisons_b64     ?? prev.mask_cloisons_b64,
        mask_french_doors_b64: data.mask_french_doors_b64 ?? prev.mask_french_doors_b64,
        doors_count:  data.doors_count  ?? prev.doors_count,
        windows_count: data.windows_count ?? prev.windows_count,
        french_doors_count: data.french_doors_count ?? prev.french_doors_count,
        surfaces: data.surfaces ?? prev.surfaces,
        openings: data.openings ?? prev.openings,
        rooms:    data.rooms    ?? prev.rooms,
        walls:    data.walls    ?? prev.walls,
      }));
      if (data.edit_history_len != null) setEditHistoryLen(data.edit_history_len);
      if (data.edit_future_len != null) setEditFutureLen(data.edit_future_len);
      toast({ title: d("ed_mask_updated"), variant: "success" });
    } catch (e: any) {
      if (e.message?.includes("Session introuvable")) {
        toast({ title: d("ed_session_exp"), description: d("ed_session_msg"), variant: "error" });
        onSessionExpired?.();
      } else {
        setError(e.message);
        toast({ title: d("ed_err"), description: e.message, variant: "error" });
      }
    } finally { setLoading(false); }
  };

  // ── Undo / Redo for mask edits (door/window/interior) ──
  const sendUndoMask = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND}/undo-edit-mask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? d("ed_err"));
      const data = await r.json();
      setResult(prev => ({
        ...prev,
        overlay_openings_b64:  data.overlay_openings_b64  ?? prev.overlay_openings_b64,
        overlay_interior_b64:  data.overlay_interior_b64  ?? prev.overlay_interior_b64,
        mask_doors_b64:        data.mask_doors_b64        ?? prev.mask_doors_b64,
        mask_windows_b64:      data.mask_windows_b64      ?? prev.mask_windows_b64,
        mask_walls_b64:        data.mask_walls_b64        ?? prev.mask_walls_b64,
        mask_walls_pixel_b64:  data.mask_walls_pixel_b64  ?? prev.mask_walls_pixel_b64,
        mask_cloisons_b64:     data.mask_cloisons_b64     ?? prev.mask_cloisons_b64,
        mask_french_doors_b64: data.mask_french_doors_b64 ?? prev.mask_french_doors_b64,
        doors_count:  data.doors_count  ?? prev.doors_count,
        windows_count: data.windows_count ?? prev.windows_count,
        french_doors_count: data.french_doors_count ?? prev.french_doors_count,
        surfaces: data.surfaces ?? prev.surfaces,
        openings: data.openings ?? prev.openings,
        rooms:    data.rooms    ?? prev.rooms,
        walls:    data.walls    ?? prev.walls,
      }));
      setEditHistoryLen(data.edit_history_len ?? 0);
      setEditFutureLen(data.edit_future_len ?? 0);
      toast({ title: d("ed_undone"), variant: "success" });
    } catch (e: any) {
      toast({ title: d("ed_err"), description: e.message, variant: "error" });
    } finally { setLoading(false); }
  };

  const sendRedoMask = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND}/redo-edit-mask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? d("ed_err"));
      const data = await r.json();
      setResult(prev => ({
        ...prev,
        overlay_openings_b64:  data.overlay_openings_b64  ?? prev.overlay_openings_b64,
        overlay_interior_b64:  data.overlay_interior_b64  ?? prev.overlay_interior_b64,
        mask_doors_b64:        data.mask_doors_b64        ?? prev.mask_doors_b64,
        mask_windows_b64:      data.mask_windows_b64      ?? prev.mask_windows_b64,
        mask_walls_b64:        data.mask_walls_b64        ?? prev.mask_walls_b64,
        mask_walls_pixel_b64:  data.mask_walls_pixel_b64  ?? prev.mask_walls_pixel_b64,
        mask_cloisons_b64:     data.mask_cloisons_b64     ?? prev.mask_cloisons_b64,
        mask_french_doors_b64: data.mask_french_doors_b64 ?? prev.mask_french_doors_b64,
        doors_count:  data.doors_count  ?? prev.doors_count,
        windows_count: data.windows_count ?? prev.windows_count,
        french_doors_count: data.french_doors_count ?? prev.french_doors_count,
        surfaces: data.surfaces ?? prev.surfaces,
        openings: data.openings ?? prev.openings,
        rooms:    data.rooms    ?? prev.rooms,
        walls:    data.walls    ?? prev.walls,
      }));
      setEditHistoryLen(data.edit_history_len ?? 0);
      setEditFutureLen(data.edit_future_len ?? 0);
      toast({ title: d("ed_redone"), variant: "success" });
    } catch (e: any) {
      toast({ title: d("ed_err"), description: e.message, variant: "error" });
    } finally { setLoading(false); }
  };

  const sendSam = async (x: number, y: number) => {
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND}/sam-segment`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, x, y, mode: "interior", action: "add", apply_to: layer }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? "Erreur SAM");
      const data = await r.json();
      setResult(prev => ({
        ...prev, ...data,
        rooms: data.rooms ?? prev.rooms,
        walls: data.walls ?? prev.walls,
      }));
      if (data.edit_history_len != null) setEditHistoryLen(data.edit_history_len);
      if (data.edit_future_len != null) setEditFutureLen(data.edit_future_len);
      toast({ title: d("ed_sam_ok"), variant: "success" });
    } catch (e: any) {
      if (e.message?.includes("Session introuvable")) {
        toast({ title: d("ed_session_exp"), description: d("ed_session_msg"), variant: "error" });
        onSessionExpired?.();
      } else { setError(e.message); }
    } finally { setLoading(false); }
  };

  // Delete an individual opening by erasing its bounding-box region
  const deleteOpening = useCallback(async (idx: number) => {
    const o = result.openings?.[idx];
    if (!o) return;
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${BACKEND}/edit-mask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          layer: o.class === "door" ? "door" : "window",
          action: "erase_rect",
          x0: Math.round(o.x_px),
          y0: Math.round(o.y_px),
          x1: Math.round(o.x_px + o.width_px),
          y1: Math.round(o.y_px + o.height_px),
        }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? "Erreur suppression");
      const data = await r.json();
      setResult(prev => ({
        ...prev,
        overlay_openings_b64: data.overlay_openings_b64 ?? prev.overlay_openings_b64,
        overlay_interior_b64: data.overlay_interior_b64 ?? prev.overlay_interior_b64,
        mask_doors_b64: data.mask_doors_b64 ?? prev.mask_doors_b64,
        mask_windows_b64: data.mask_windows_b64 ?? prev.mask_windows_b64,
        mask_walls_b64: data.mask_walls_b64 ?? prev.mask_walls_b64,
        doors_count: data.doors_count ?? prev.doors_count,
        windows_count: data.windows_count ?? prev.windows_count,
        surfaces: data.surfaces ?? prev.surfaces,
        // If backend doesn't return fresh openings, optimistically remove from list
        openings: data.openings ?? prev.openings?.filter((_, i) => i !== idx),
        rooms: data.rooms ?? prev.rooms,
        walls: data.walls ?? prev.walls,
      }));
      setSelectedOpeningIdx(null);
      toast({ title: d("ed_opening_del"), variant: "success" });
    } catch (e: any) {
      if (e.message?.includes("Session introuvable")) {
        toast({ title: d("ed_session_exp"), description: d("ed_session_msg"), variant: "error" });
        onSessionExpired?.();
      } else {
        setError(e.message);
        toast({ title: d("ed_opening_err"), description: e.message, variant: "error" });
      }
    } finally { setLoading(false); }
  }, [result.openings, sessionId, onSessionExpired]);

  const updateRoomLabel = async (roomId: number, newType: string, newLabelFr: string) => {
    try {
      const r = await fetch(`${BACKEND}/update-room-label`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, room_id: roomId, new_type: newType, new_label_fr: newLabelFr }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? d("ed_err"));
      const data = await r.json();
      setResult(prev => ({ ...prev, rooms: data.rooms }));
      setEditingRoomId(null);
      toast({ title: d("ed_room_type_ok"), variant: "success" });
    } catch (e: any) {
      toast({ title: d("ed_err"), description: e.message, variant: "error" });
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return; // ignore right-click (used for pan)
    const mc = mouseToCanvas(e.clientX, e.clientY);
    const rx = scaleX(mc.x);
    const ry = scaleY(mc.y);
    // Visual search & SAM work even without a layer selected
    if (tool === "sam") { sendSam(Math.round(rx), Math.round(ry)); return; }
    // ── Visual search: search / add / remove ──
    if (tool === "visual_search") {
      const img = imgRef.current!;
      const normX = rx / img.naturalWidth;
      const normY = ry / img.naturalHeight;
      const pctX = normX * 100;
      const pctY = normY * 100;

      // Remove mode: click on an existing match to delete it
      if (vsEditMode === "remove" && vsMatches.length > 0) {
        const hitIdx = vsMatches.findIndex(m =>
          normX >= m.x_norm && normX <= m.x_norm + m.w_norm &&
          normY >= m.y_norm && normY <= m.y_norm + m.h_norm
        );
        if (hitIdx >= 0) {
          setVsMatches(prev => prev.filter((_, i) => i !== hitIdx));
          toast({ title: d("vs_removed"), variant: "default" });
        }
        return;
      }

      // Search or Add mode: draw rectangle
      vsDrawing.current = true;
      vsStart.current = { x: pctX, y: pctY };
      setVsCrop({ x: pctX, y: pctY, w: 0, h: 0 });
      return;
    }
    // ── Utilities: angle measurement (3-point) ──
    if (tool === "angle") {
      pts.current.push([rx, ry]);
      drawCanvas();
      if (pts.current.length >= 3) {
        const img = imgRef.current!;
        const [a, b, c] = pts.current;
        // b is the vertex, a and c are the two rays
        const ba = [a[0]-b[0], a[1]-b[1]];
        const bc = [c[0]-b[0], c[1]-b[1]];
        const dot = ba[0]*bc[0] + ba[1]*bc[1];
        const magBA = Math.sqrt(ba[0]*ba[0] + ba[1]*ba[1]);
        const magBC = Math.sqrt(bc[0]*bc[0] + bc[1]*bc[1]);
        const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
        const angleDeg = Math.acos(cosAngle) * 180 / Math.PI;

        // Store angle measurement
        const p1 = { x: a[0]/img.naturalWidth, y: a[1]/img.naturalHeight };
        const p2 = { x: b[0]/img.naturalWidth, y: b[1]/img.naturalHeight };
        const p3 = { x: c[0]/img.naturalWidth, y: c[1]/img.naturalHeight };
        setAngleMeasures(prev => [...prev, { id: crypto.randomUUID(), p1, vertex: p2, p3, angleDeg }]);
        toast({ title: `${d("ut_angle" as DTKey)}: ${angleDeg.toFixed(1)}°`, variant: "success" });
        pts.current = [];
        canvasRef.current?.getContext("2d")?.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
      }
      return;
    }

    // ── Utilities: linear measurement ──
    if (tool === "linear") {
      pts.current.push([rx, ry]);
      drawCanvas();
      if (pts.current.length >= 2) {
        const img = imgRef.current!;
        const p1 = { x: pts.current[0][0] / img.naturalWidth, y: pts.current[0][1] / img.naturalHeight };
        const p2 = { x: pts.current[1][0] / img.naturalWidth, y: pts.current[1][1] / img.naturalHeight };
        const dx = pts.current[1][0] - pts.current[0][0];
        const dy = pts.current[1][1] - pts.current[0][1];
        const distPx = Math.sqrt(dx * dx + dy * dy);
        const distM = ppm ? distPx / ppm : null;
        setLinearMeasures(prev => [...prev, { id: crypto.randomUUID(), p1, p2, distPx }]);
        toast({ title: `${d("ut_distance" as DTKey)}: ${distM ? distM.toFixed(2) + " m" : Math.round(distPx) + " px"}`, variant: "success" });
        pts.current = [];
        canvasRef.current?.getContext("2d")?.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
      }
      return;
    }

    // ── Utilities: count points (category-based) ──
    if (tool === "count" && activeCountGroupId) {
      const img = imgRef.current!;
      const newPt: CountPoint = {
        id: crypto.randomUUID(),
        groupId: activeCountGroupId,
        x: rx / img.naturalWidth,
        y: ry / img.naturalHeight,
      };
      setCountPoints(prev => [...prev, newPt]);
      const grp = countGroups.find(g => g.id === activeCountGroupId);
      const grpTotal = countPoints.filter(p => p.groupId === activeCountGroupId).length + 1;
      toast({ title: `${grp?.name ?? "Point"} #${grpTotal}`, variant: "default" });
      return;
    }

    // ── Utilities: text annotation ──
    if (tool === "text") {
      const img = imgRef.current!;
      setTextInputPos({ x: rx / img.naturalWidth, y: ry / img.naturalHeight });
      setTextInputValue("");
      return;
    }

    // ── Utilities: circle measurement ──
    if (tool === "circle") {
      const img = imgRef.current!;
      const normPt = { x: rx / img.naturalWidth, y: ry / img.naturalHeight };
      if (!circleCenter) {
        setCircleCenter(normPt);
      } else {
        setCircleMeasures(prev => [...prev, {
          id: crypto.randomUUID(),
          categoryId: "circle_default",
          center: circleCenter,
          edgePoint: normPt,
        }]);
        setCircleCenter(null);
      }
      return;
    }

    // ── Utilities: rescale ──
    if (tool === "rescale") {
      pts.current.push([rx, ry]);
      drawCanvas();
      if (pts.current.length >= 2) {
        const dx = pts.current[1][0] - pts.current[0][0];
        const dy = pts.current[1][1] - pts.current[0][1];
        const distPx = Math.sqrt(dx * dx + dy * dy);
        const input = prompt(d("ut_enter_meters"));
        if (input) {
          const meters = parseFloat(input);
          if (meters > 0) {
            const newPpm = distPx / meters;
            setResult(prev => ({ ...prev, pixels_per_meter: newPpm }));
            toast({ title: `${d("ut_scale_updated")}: ${newPpm.toFixed(1)} px/m`, variant: "success" });
          }
        }
        pts.current = [];
        canvasRef.current?.getContext("2d")?.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
      }
      return;
    }

    // For mask editing tools, require a layer to be selected (surface & utilities have their own layer)
    if (layer === null && tool !== "select" && tool !== "split" && tool !== "deduct_rect") return;
    // ── Split tool: collect 2 points then submit ──
    if (tool === "split" && layer === "rooms") {
      pts.current.push([rx, ry]);
      drawCanvas();
      if (pts.current.length >= 2) {
        const img = imgRef.current!;
        const cutPoints = pts.current.map(([px, py]) => ({ x: px / img.naturalWidth, y: py / img.naturalHeight }));
        pts.current = [];
        // Only need a selected room — the cut line can extend beyond the room boundary
        // The backend will handle clipping the line to the room polygon
        const room = (result.rooms ?? []).find(r => r.id === selectedRoomId);
        if (!room || !room.polygon_norm) {
          toast({ title: d("ed_select_room_first" as DTKey), variant: "error" });
          setTool("select");
          return;
        }
        sendEditRoom({ action: "split_room", room_id: selectedRoomId, cut_points: cutPoints });
        setTool("select"); // Return to select after cut
      }
      return;
    }
    if (tool === "select") {
      // Mode rooms : hit-test sur les polygones de pièces
      if (layer === "rooms") {
        const img = imgRef.current!;
        const normX = rx / img.naturalWidth;
        const normY = ry / img.naturalHeight;
        let hitRoom: Room | null = null;
        for (const room of (result.rooms ?? [])) {
          if (room.polygon_norm && pointInPolygon(normX, normY, room.polygon_norm)) {
            hitRoom = room;
            break;
          }
        }
        // ── Shift+click: merge rooms ──
        if (hitRoom && e.shiftKey && selectedRoomId !== null && hitRoom.id !== selectedRoomId) {
          sendEditRoom({ action: "merge_rooms", room_id: selectedRoomId, room_id_b: hitRoom.id });
          return;
        }
        if (hitRoom) {
          if (e.ctrlKey || e.metaKey) {
            // Multi-select: toggle room in set
            setSelectedRoomIds(prev => {
              const s = new Set(prev);
              if (s.has(hitRoom!.id)) s.delete(hitRoom!.id); else s.add(hitRoom!.id);
              return s;
            });
          } else {
            // Single select
            setSelectedRoomId(prev => prev === hitRoom!.id ? null : hitRoom!.id);
            setSelectedRoomIds(new Set());
            setSelectedOpeningIdxs(new Set());
          }
          setEditingRoomId(hitRoom.id);
          setActiveRoomType(hitRoom.type);
          setActiveFloorTypeId(hitRoom.surfaceTypeId ?? "");
          setSidebarTab("rooms");
        } else {
          setSelectedRoomId(null);
          setEditingRoomId(null);
          setSelectedRoomIds(new Set());
        }
        return;
      }
      // Hit-test text annotations
      const imgElSel = imgRef.current;
      if (imgElSel) {
        const normX = rx / imgElSel.naturalWidth;
        const normY = ry / imgElSel.naturalHeight;
        const hitText = textAnnotations.find(ta => {
          const fs = ta.fontSize ?? 12;
          const w = ta.text.length * fs * 0.6 / imgElSel.naturalWidth + 0.02;
          const h = (fs + 10) / imgElSel.naturalHeight + 0.01;
          return normX >= ta.x - 0.005 && normX <= ta.x + w && normY >= ta.y - h && normY <= ta.y + 0.005;
        });
        if (hitText) {
          setSelectedTextId(hitText.id);
          setSelectedMeasureId(null); setSelectedMeasureType(null);
          return;
        }
        // Linear hit-test
        const hitLinear = linearMeasures.find(lm => {
          const p1x = lm.p1.x * imgElSel.naturalWidth, p1y = lm.p1.y * imgElSel.naturalHeight;
          const p2x = lm.p2.x * imgElSel.naturalWidth, p2y = lm.p2.y * imgElSel.naturalHeight;
          const dx = p2x-p1x, dy = p2y-p1y;
          const len2 = dx*dx + dy*dy;
          const t = len2 > 0 ? Math.max(0, Math.min(1, ((rx-p1x)*dx + (ry-p1y)*dy) / len2)) : 0;
          const projX = p1x + t*dx, projY = p1y + t*dy;
          return Math.hypot(rx-projX, ry-projY) < 15;
        });
        if (hitLinear) { setSelectedMeasureId(hitLinear.id); setSelectedMeasureType("linear"); setSelectedTextId(null); return; }

        // Circle hit-test
        const hitCircle = circleMeasures.find(cm => {
          const ccx = cm.center.x * imgElSel.naturalWidth, ccy = cm.center.y * imgElSel.naturalHeight;
          const er = Math.hypot((cm.edgePoint.x - cm.center.x) * imgElSel.naturalWidth, (cm.edgePoint.y - cm.center.y) * imgElSel.naturalHeight);
          return Math.abs(Math.hypot(rx-ccx, ry-ccy) - er) < 15 || Math.hypot(rx-ccx, ry-ccy) < 10;
        });
        if (hitCircle) { setSelectedMeasureId(hitCircle.id); setSelectedMeasureType("circle"); setSelectedTextId(null); return; }

        // Angle hit-test
        const hitAngle = angleMeasures.find(am => Math.hypot(rx - am.vertex.x * imgElSel.naturalWidth, ry - am.vertex.y * imgElSel.naturalHeight) < 15);
        if (hitAngle) { setSelectedMeasureId(hitAngle.id); setSelectedMeasureType("angle"); setSelectedTextId(null); return; }
      }
      // Clear text/measure selection if nothing hit
      setSelectedTextId(null);
      setSelectedMeasureId(null); setSelectedMeasureType(null);
      // Find the opening that the user clicked inside, or the closest one
      let bestIdx = -1;
      let bestDist = Infinity;
      result.openings?.forEach((o, i) => {
        const inside = rx >= o.x_px && rx <= o.x_px + o.width_px
                    && ry >= o.y_px && ry <= o.y_px + o.height_px;
        if (inside) {
          if (0 < bestDist) { bestDist = 0; bestIdx = i; }
        } else {
          const cx = o.x_px + o.width_px / 2;
          const cy = o.y_px + o.height_px / 2;
          const dist = Math.hypot(cx - rx, cy - ry);
          if (dist < bestDist) { bestDist = dist; bestIdx = i; }
        }
      });
      if (bestIdx >= 0 && (bestDist === 0 || bestDist < 50)) {
        if (e.ctrlKey || e.metaKey) {
          // Multi-select
          setSelectedOpeningIdxs(prev => {
            const s = new Set(prev);
            if (s.has(bestIdx)) s.delete(bestIdx); else s.add(bestIdx);
            return s;
          });
        } else {
          const newIdx = selectedOpeningIdx === bestIdx ? null : bestIdx;
          setSelectedOpeningIdx(newIdx);
          setSelectedRoomIds(new Set());
          setSelectedOpeningIdxs(new Set());
          if (newIdx !== null) {
            setSidebarTab("visibility");
            // Zoom to opening
            const opening = result.openings![newIdx];
            if (opening && imgRef.current && zoomContainerRef.current) {
              const img = imgRef.current;
              const container = zoomContainerRef.current;
              const scx = img.offsetWidth / (imageNatural.w || 1);
              const scy = img.offsetHeight / (imageNatural.h || 1);
              const bx = opening.x_px * scx;
              const by = opening.y_px * scy;
              const bw = opening.width_px * scx;
              const bh = opening.height_px * scy;
              const pad = 120;
              const newZoom = Math.min((container.clientWidth - pad*2) / Math.max(bw, 20), (container.clientHeight - pad*2) / Math.max(bh, 20), 5);
              const zoomVal = Math.max(0.8, newZoom);
              const cx = (bx + bw/2) - img.offsetWidth/2;
              const cy = (by + bh/2) - img.offsetHeight/2;
              setZoom(zoomVal);
              setTranslate({ x: -cx * zoomVal, y: -cy * zoomVal });
              setShowDoors(opening.class === "door");
              setShowWindows(opening.class === "window");
              setShowFrenchDoors(opening.class === "french_door");
            }
          }
        }
      } else {
        setSelectedOpeningIdx(null);
      }
      return;
    }
    if (tool === "add_poly" || tool === "erase_poly") { pts.current.push([rx, ry]); drawCanvas(); return; }
    drawing.current = true;
    startPt.current = { x: rx, y: ry };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Visual search drag
    if (vsDrawing.current && tool === "visual_search") {
      const mc = mouseToCanvas(e.clientX, e.clientY);
      const img = imgRef.current!;
      const rx = scaleX(mc.x);
      const ry = scaleY(mc.y);
      const pctX = (rx / img.naturalWidth) * 100;
      const pctY = (ry / img.naturalHeight) * 100;
      const sx = vsStart.current.x, sy = vsStart.current.y;
      setVsCrop({
        x: Math.max(0, Math.min(sx, pctX)),
        y: Math.max(0, Math.min(sy, pctY)),
        w: Math.min(100, Math.abs(pctX - sx)),
        h: Math.min(100, Math.abs(pctY - sy)),
      });
      return;
    }
    if (!drawing.current) return;
    const cv = canvasRef.current!;
    const mc = mouseToCanvas(e.clientX, e.clientY);
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const isErase = tool.startsWith("erase");
    const roomColorMv = layer === "rooms" ? getRoomColor(activeRoomType) : null;
    const color = isErase ? "#F87171" : (roomColorMv ?? (layer === "interior" ? "#34D399" : layer === "door" ? "#D946EF" : layer === "french_door" ? "#F97316" : "#22D3EE"));
    const img = imgRef.current!;
    const x0 = startPt.current.x * img.offsetWidth / img.naturalWidth;
    const y0 = startPt.current.y * img.offsetHeight / img.naturalHeight;
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([4, 2]);
    ctx.fillStyle = color + "22";
    ctx.fillRect(x0, y0, mc.x - x0, mc.y - y0);
    ctx.strokeRect(x0, y0, mc.x - x0, mc.y - y0);
    ctx.setLineDash([]);
  };

  const sendVisualSearch = async (crop: { x: number; y: number; w: number; h: number }) => {
    if (crop.w < 0.5 || crop.h < 0.5) return; // too small
    setVsSearching(true);
    try {
      const r = await fetch(`${BACKEND}/visual-search`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, x_pct: crop.x, y_pct: crop.y, w_pct: crop.w, h_pct: crop.h }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? "Erreur");
      const data = await r.json();
      setVsMatches(data.matches ?? []);
      if (data.count === 0) toast({ title: d("vs_no_match"), variant: "default" });
      else toast({ title: `${data.count} ${d("vs_found")}`, variant: "success" });
    } catch (e: any) {
      toast({ title: d("ed_err"), description: e.message, variant: "error" });
    } finally { setVsSearching(false); setVsCrop(null); }
  };

  const DETECTION_COLORS = ["#F97316", "#8B5CF6", "#EC4899", "#14B8A6", "#EAB308", "#6366F1", "#F43F5E", "#06B6D4"];

  const saveVsAsDetection = (label: string) => {
    if (!label.trim() || vsMatches.length === 0) return;
    const ppm = result.pixels_per_meter;
    const W = imageNatural.w || 1;
    const H = imageNatural.h || 1;

    // Compute area for each match
    let totalAreaPx2 = 0;
    let totalAreaM2: number | null = ppm ? 0 : null;
    for (const m of vsMatches) {
      const wpx = m.w_norm * W;
      const hpx = m.h_norm * H;
      const areaPx = wpx * hpx;
      totalAreaPx2 += areaPx;
      if (ppm && totalAreaM2 !== null) {
        totalAreaM2 += areaPx / (ppm * ppm);
      }
    }

    const color = DETECTION_COLORS[customDetections.length % DETECTION_COLORS.length];
    const det: CustomDetection = {
      id: crypto.randomUUID(),
      label: label.trim(),
      color,
      matches: [...vsMatches],
      count: vsMatches.length,
      total_area_m2: totalAreaM2 !== null ? Math.round(totalAreaM2 * 1000) / 1000 : null,
      total_area_px2: Math.round(totalAreaPx2),
    };

    setCustomDetections(prev => [...prev, det]);
    setVsMatches([]);
    setVsCrop(null);
    setVsSaveOpen(false);
    setVsSaveLabel("");
    toast({ title: `${d("vs_saved")} — ${det.label} (${det.count})`, variant: "success" });
  };

  const handleMouseUp = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return; // ignore right-click (used for pan)
    // Visual search: finish selection
    if (vsDrawing.current && tool === "visual_search") {
      vsDrawing.current = false;
      if (vsCrop && vsCrop.w > 0.5 && vsCrop.h > 0.5) {
        if (vsEditMode === "add") {
          // Manually add a match at the drawn rectangle
          const newMatch: VisualSearchMatch = {
            x_norm: vsCrop.x / 100,
            y_norm: vsCrop.y / 100,
            w_norm: vsCrop.w / 100,
            h_norm: vsCrop.h / 100,
            score: 1.0,
          };
          setVsMatches(prev => [...prev, newMatch]);
          setVsCrop(null);
          toast({ title: d("vs_added"), variant: "success" });
        } else {
          // Search mode: send to backend
          sendVisualSearch(vsCrop);
        }
      } else {
        setVsCrop(null);
      }
      return;
    }
    if (!drawing.current) return;
    drawing.current = false;
    const mc = mouseToCanvas(e.clientX, e.clientY);
    const x1 = scaleX(mc.x);
    const y1 = scaleY(mc.y);
    canvasRef.current!.getContext("2d")!.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
    if (Math.abs(x1 - startPt.current.x) > 5 || Math.abs(y1 - startPt.current.y) > 5) {
      // ── Surface layer: create zone from rect instead of calling backend ──
      if (layer === "surface") {
        const img = imgRef.current!;
        const x0n = Math.min(startPt.current.x, x1) / img.naturalWidth;
        const y0n = Math.min(startPt.current.y, y1) / img.naturalHeight;
        const x1n = Math.max(startPt.current.x, x1) / img.naturalWidth;
        const y1n = Math.max(startPt.current.y, y1) / img.naturalHeight;
        pushHistory(zones);
        if (tool === "deduct_rect") {
          // Remove zones whose centroid falls inside the drawn rect
          setZones(prev => prev.filter(z => {
            const c = z.points.reduce((a: {x:number;y:number}, p: {x:number;y:number}) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
            c.x /= z.points.length; c.y /= z.points.length;
            return !(c.x >= x0n && c.x <= x1n && c.y >= y0n && c.y <= y1n);
          }));
          toast({ title: d("sf_zone_deducted"), variant: "default" });
        } else {
          const polyNorm = [{ x: x0n, y: y0n }, { x: x1n, y: y0n }, { x: x1n, y: y1n }, { x: x0n, y: y1n }];
          setZones(prev => [...prev, { id: crypto.randomUUID(), typeId: activeTypeId, points: polyNorm }]);
          toast({ title: d("sf_zone_added"), variant: "success" });
        }
        return;
      }
      await sendEdit({ action: tool, x0: startPt.current.x, y0: startPt.current.y, x1, y1 });
    }
  };

  const finishPoly = async () => {
    // ── Rooms layer: create a new Room locally from the polygon ──
    if (layer === "rooms" && tool === "add_poly") {
      if (pts.current.length < 3) { toast({ title: d("ed_min3pts"), variant: "error" }); return; }
      const img = imgRef.current!;
      const polyNorm = pts.current.map(([px, py]) => ({ x: px / img.naturalWidth, y: py / img.naturalHeight }));
      const cx = polyNorm.reduce((s, p) => s + p.x, 0) / polyNorm.length;
      const cy = polyNorm.reduce((s, p) => s + p.y, 0) / polyNorm.length;
      const xs = polyNorm.map(p => p.x), ys = polyNorm.map(p => p.y);
      const bbox = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      const areaPx = polygonAreaNorm(polyNorm, img.naturalWidth, img.naturalHeight);
      const area_m2 = ppm ? areaPx / (ppm * ppm) : null;
      const newId = Math.max(0, ...(result.rooms ?? []).map(r => r.id)) + 1;
      const newRoom: Room = {
        id: newId,
        type: activeRoomType,
        label_fr: d(ROOM_TYPES.find(rt => rt.type === activeRoomType)?.i18nKey ?? "rt_bedroom"),
        centroid_norm: { x: cx, y: cy },
        bbox_norm: bbox,
        area_m2,
        area_px2: areaPx,
        polygon_norm: polyNorm,
        surfaceTypeId: activeFloorTypeId || undefined,
      };
      setResult(prev => ({ ...prev, rooms: [...(prev.rooms ?? []), newRoom] }));
      // Auto-create linked MeasureZone if floor type selected
      if (activeFloorTypeId && polyNorm.length >= 3) {
        const zoneId = crypto.randomUUID();
        const linkedZone: MeasureZone = {
          id: zoneId,
          typeId: activeFloorTypeId,
          points: polyNorm.map(p => ({ x: p.x, y: p.y })),
          name: `auto:room:${newId}`,
        };
        setZones(prev => [...prev, linkedZone]);
        // Update room with linkedZoneId
        setResult(prev => ({
          ...prev,
          rooms: (prev.rooms ?? []).map(r => r.id === newId ? { ...r, linkedZoneId: zoneId } : r),
        }));
      }
      toast({ title: `Pièce créée : ${newRoom.label_fr}`, variant: "success" });
      pts.current = [];
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
      return;
    }
    // ── Surface layer: create a MeasureZone instead of calling backend ──
    if (layer === "surface") {
      if (pts.current.length < 3) { toast({ title: d("ed_min3pts"), variant: "error" }); return; }
      const img = imgRef.current!;
      const polyNorm = pts.current.map(([x, y]) => ({ x: x / img.naturalWidth, y: y / img.naturalHeight }));

      // Surface erase polygon: remove zones whose centroid is inside the drawn polygon
      if (tool === "erase_poly") {
        pushHistory(zones);
        setZones(prev => prev.filter(z => {
          if (z.typeId === "__count__") return true;
          const cx = z.points.reduce((s, p) => s + p.x, 0) / z.points.length;
          const cy = z.points.reduce((s, p) => s + p.y, 0) / z.points.length;
          return !pointInPolygon(cx, cy, polyNorm);
        }));
        pts.current = [];
        canvasRef.current?.getContext("2d")?.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
        toast({ title: d("sf_zone_deducted" as DTKey), variant: "default" });
        return;
      }

      const newZone: MeasureZone = {
        id: crypto.randomUUID(),
        typeId: activeTypeId,
        points: polyNorm,
      };
      pushHistory(zones);
      setZones(prev => [...prev, newZone]);
      pts.current = [];
      canvasRef.current?.getContext("2d")?.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
      toast({ title: d("sf_zone_added"), variant: "success" });
      return;
    }
    if (pts.current.length < 3) { toast({ title: d("ed_min3pts"), variant: "error" }); return; }
    await sendEdit({ action: tool, points: pts.current });
    pts.current = [];
    canvasRef.current?.getContext("2d")?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      const r = await fetch(`${BACKEND}/export-pdf`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? "Erreur");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "floorscan_rapport.pdf"; a.click();
      URL.revokeObjectURL(url);
      toast({ title: dt("ed_pdf_ok", lang), variant: "success" });
    } catch (e: any) {
      toast({ title: dt("ed_pdf_err", lang), description: e.message, variant: "error" });
    } finally { setExportingPdf(false); }
  };

  // ── Export CSV (mode mesure, editor) ──────────────────────────────────────
  const exportMeasureXlsx = () => {
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const ppmVal = result.pixels_per_meter ?? null;
    const totals = imageNatural.w > 0 ? aggregateByType(zones, imageNatural.w, imageNatural.h, ppmVal) : {};
    const unit = ppmVal ? "m²" : "px²";

    // Sheet 1: Métré surfaces
    const data1: (string | number)[][] = [
      ["FloorScan — Métré"],
      ["Date", new Date().toLocaleDateString("fr-FR")],
      [],
      ["Type de surface", `Surface (${unit})`],
      ...surfaceTypes.filter(t => (totals[t.id] ?? 0) > 0).map(t => [t.name, ppmVal ? +totals[t.id].toFixed(4) : Math.round(totals[t.id])]),
      [],
      ["TOTAL", ppmVal ? +Object.values(totals).reduce((a, b) => a + b, 0).toFixed(4) : Math.round(Object.values(totals).reduce((a, b) => a + b, 0))],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(data1);
    ws1["!cols"] = [{ wch: 25 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws1, "Métré");

    // Sheet 2: Mesures linéaires
    if (linearMeasures.length > 0) {
      const data2: (string | number)[][] = [["#", "Distance (m)", "Distance (px)"]];
      linearMeasures.forEach((lm, i) => {
        const distM = ppmVal ? +(lm.distPx / ppmVal).toFixed(3) : 0;
        data2.push([i + 1, distM, Math.round(lm.distPx)]);
      });
      data2.push(["TOTAL", ppmVal ? +linearMeasures.reduce((s, lm) => s + lm.distPx / ppmVal!, 0).toFixed(3) : 0, Math.round(linearMeasures.reduce((s, lm) => s + lm.distPx, 0))]);
      const ws2 = XLSX.utils.aoa_to_sheet(data2);
      ws2["!cols"] = [{ wch: 5 }, { wch: 14 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws2, "Linéaires");
    }

    // Sheet 3: Pièces
    if (result.rooms && result.rooms.length > 0) {
      const data3: (string | number)[][] = [["Type", "Pièce", "Surface (m²)", "Périmètre (m)", "Type de sol"]];
      result.rooms.forEach(r => data3.push([r.type, r.label_fr, r.area_m2 != null ? +r.area_m2.toFixed(2) : 0, r.perimeter_m != null ? +r.perimeter_m.toFixed(2) : 0, r.surfaceTypeId ?? "—"]));
      const ws3 = XLSX.utils.aoa_to_sheet(data3);
      ws3["!cols"] = [{ wch: 15 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 15 }];
      XLSX.utils.book_append_sheet(wb, ws3, "Pièces");
    }

    XLSX.writeFile(wb, `floorscan_metre_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast({ title: "Export XLSX ✓", variant: "success" });
  };

  // ── Export PDF Devis (mode mesure, client-side jsPDF) ──────────────────────
  const exportMeasurePdf = async () => {
    setExportingMeasurePdf(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W = 210, M = 15;
      let y = M;

      // ppm est défini dans le JSX mais on en a besoin ici aussi
      const ppmVal = result.pixels_per_meter ?? null;

      const hex2rgb = (hex: string): [number, number, number] => [
        parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16),
      ];

      // En-tête
      doc.setFillColor(15,23,42); doc.rect(0,0,W,28,"F");
      doc.setTextColor(255,255,255);
      doc.setFontSize(18); doc.setFont("helvetica","bold"); doc.text("FloorScan", M, 12);
      doc.setFontSize(9); doc.setFont("helvetica","normal");
      doc.setTextColor(148,163,184);
      doc.text("Métré & Devis de surfaces — Analyse IA", M, 18);
      doc.text(new Date().toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"}), W-M, 18, {align:"right"});
      y = 36;

      // Récap IA
      const sfData = result.surfaces ?? {};
      if (Object.values(sfData).some(v => v != null)) {
        doc.setTextColor(30,41,59); doc.setFontSize(9); doc.setFont("helvetica","bold");
        doc.text("Résultats IA", M, y); y += 5;
        doc.setFont("helvetica","normal");
        if (sfData.area_hab_m2)      { doc.text(`Surface habitable : ${sfData.area_hab_m2.toFixed(1)} m²`, M, y); y += 4; }
        if (sfData.area_building_m2) { doc.text(`Emprise bâtiment : ${sfData.area_building_m2.toFixed(1)} m²`, M, y); y += 4; }
        if (sfData.area_walls_m2)    { doc.text(`Surfaces murs : ${sfData.area_walls_m2.toFixed(1)} m²`, M, y); y += 4; }
        doc.text(`Portes : ${result.doors_count}   Fenêtres : ${result.windows_count}`, M, y); y += 8;
        doc.setDrawColor(226,232,240); doc.line(M, y, W-M, y); y += 6;
      }

      // Table zones métré
      if (zones.length > 0 && imageNatural.w > 0) {
        const totals = aggregateByType(zones, imageNatural.w, imageNatural.h, ppmVal);
        const perims = ppmVal ? aggregatePerimeterByType(zones, imageNatural.w, imageNatural.h, ppmVal) : {};
        const activeSurfaces = surfaceTypes.filter(t => (totals[t.id] ?? 0) > 0);
        const hasPrices = activeSurfaces.some(t => (t.pricePerM2 ?? 0) > 0);

        if (activeSurfaces.length > 0) {
          doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(30,41,59);
          doc.text("Zones de métré", M, y); y += 6;

          const cols = hasPrices && ppmVal ? [M, 70, 100, 120, 145, 170] : [M, 90, 130, 160];
          const headers = hasPrices && ppmVal
            ? ["Type","Surface","Périm.","Chute","Qté cmd","Montant HT"]
            : ["Type","Surface","Périm.","—"];

          doc.setFillColor(248,250,252); doc.rect(M, y-4, W-2*M, 8, "F");
          doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(100,116,139);
          headers.forEach((h,i) => doc.text(h, cols[i], y));
          y += 5; doc.setDrawColor(226,232,240); doc.line(M, y, W-M, y); y += 4;

          let totalHT = 0;
          doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(30,41,59);
          for (const type of activeSurfaces) {
            const area  = totals[type.id] ?? 0;
            const perim = perims[type.id] ?? 0;
            const waste = type.wastePercent ?? 10;
            const cmd   = area * (1 + waste/100);
            const lineHT = area * (type.pricePerM2 ?? 0);
            totalHT += lineHT;
            const [r,g,b] = hex2rgb(type.color);
            doc.setFillColor(r,g,b); doc.circle(cols[0]+1.5, y-1.5, 1.5, "F");
            doc.text(type.name, cols[0]+5, y);
            doc.text(ppmVal ? `${area.toFixed(2)} m²` : "—", cols[1], y);
            if (hasPrices && ppmVal) {
              doc.text(perim > 0 ? `${perim.toFixed(1)} ml` : "—", cols[2], y);
              doc.text(`+${waste}%`, cols[3], y);
              doc.text(`${cmd.toFixed(2)} m²`, cols[4], y);
              doc.text(lineHT > 0 ? `${lineHT.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} €` : "—", cols[5], y);
            } else if (ppmVal) {
              doc.text(perim > 0 ? `${perim.toFixed(1)} ml` : "—", cols[2], y);
            }
            y += 5;
            if (y > 265) { doc.addPage(); y = M; }
          }

          if (hasPrices && totalHT > 0) {
            doc.setDrawColor(226,232,240); doc.line(M, y, W-M, y); y += 4;
            doc.setFont("helvetica","bold"); doc.setFontSize(9);
            doc.text("Total HT", W-M-50, y);
            doc.text(`${totalHT.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} €`, W-M, y, {align:"right"});
          }
        }
      }

      // Pied de page
      doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(148,163,184);
      doc.text("Généré par FloorScan · floorscan.app", W/2, 292, {align:"center"});

      doc.save(`floorscan_metre_${new Date().toISOString().slice(0,10)}.pdf`);
      toast({ title: d("ed_export_ok"), variant: "success" });
    } catch (e: any) {
      toast({ title: d("ed_export_err"), description: e.message, variant: "error" });
    } finally {
      setExportingMeasurePdf(false);
    }
  };

  const sf = result.surfaces ?? {};
  const ppm = result.pixels_per_meter ?? null;
  ppmRef.current = ppm;
  const displayRooms = localRooms ?? result.rooms ?? [];
  const editingRoom = editingRoomId !== null
    ? displayRooms.find(r => r.id === editingRoomId) ?? null
    : null;
  const vertexEditActive = tool === "select" && layer === "rooms" && selectedRoomId !== null
    && displayRooms.find(r => r.id === selectedRoomId)?.polygon_norm != null;
  // Split tool needs canvas interaction even when a room is selected
  const canvasInteractive = tool === "split" || tool === "visual_search" || !vertexEditActive;
  // Detect panoramic/wide images (ratio > 3:1)
  const isWideImage = imageNatural.w > 0 && imageNatural.h > 0 && (imageNatural.w / imageNatural.h) > 3;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      {/* Tutorial overlay — shown once */}
      <EditorTutorialOverlay forceShow={showTuto} />
      {/* ── Compact Header ── */}
      <div className="flex items-center gap-2 h-11 mb-1.5">
        {/* Undo / Redo (unified) */}
        <div className="flex glass border border-white/10 rounded-lg p-0.5 gap-0.5">
          <button onClick={undoHistory} disabled={historyLen === 0}
            className="p-1.5 rounded-md text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
            title={d("hint_undo")}>
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={redoHistory} disabled={futureLen === 0}
            className="p-1.5 rounded-md text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
            title={d("hint_redo")}>
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>
        {error && (
          <div className="flex items-center gap-1.5 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> <span className="truncate max-w-[200px]">{error}</span>
          </div>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          {/* Save button */}
          {onGoResults && (
            <Button size="sm" variant="outline" onClick={() => {
              const updatedResult = {
                ...result,
                _measurements: {
                  zones,
                  linearMeasures,
                  angleMeasures,
                  surfaceTypes,
                },
              };
              onGoResults(updatedResult, customDetections);
            }}>
              <Save className="w-3.5 h-3.5" />
              <span className="hidden sm:inline ml-1">{d("ed_save_btn")}</span>
            </Button>
          )}
          {/* Tutorial replay */}
          <Button size="sm" variant="outline" onClick={() => { resetEditorTutorial(); setShowTuto(v => !v); }} title="Revoir le tutoriel">
            <span className="text-xs">Tutorial</span>
          </Button>
          {/* Export dropdown */}
          <div className="relative">
            <Button size="sm" variant="outline" onClick={() => setExportOpen(v => !v)}>
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline ml-1">{d("ed_export_btn")}</span>
              <ChevronDown className={cn("w-3 h-3 ml-0.5 transition-transform", exportOpen && "rotate-180")} />
            </Button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 glass border border-white/10 rounded-lg p-1 flex flex-col gap-0.5 min-w-[170px] shadow-xl">
                  <button onClick={() => { handleExportPdf(); setExportOpen(false); }} disabled={exportingPdf}
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-slate-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 w-full text-left">
                    {exportingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} PDF
                  </button>
                  <button onClick={() => { handleExportDxf(); setExportOpen(false); }} disabled={exportingDxf || !ppm}
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-slate-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 w-full text-left"
                    title={!ppm ? d("ed_dxf_need") : d("ed_dxf_tt")}>
                    <FileDown className="w-3.5 h-3.5" /> DXF
                  </button>
                  {/* Measure XLSX export */}
                  <button onClick={() => { exportMeasureXlsx(); setExportOpen(false); }} disabled={zones.length === 0}
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-slate-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 w-full text-left">
                    <FileDown className="w-3.5 h-3.5" /> XLSX Métré
                  </button>
                  {/* Measure PDF export */}
                  <button onClick={() => { exportMeasurePdf(); setExportOpen(false); }} disabled={exportingMeasurePdf || zones.length === 0}
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-slate-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 w-full text-left">
                    {exportingMeasurePdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />} {d("ed_quote_pdf")}
                  </button>
                  <div className="h-px bg-white/5 my-0.5" />
                  {onAddPage && (
                    <button onClick={() => { onAddPage(); setExportOpen(false); }}
                      className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-slate-300 hover:text-white hover:bg-white/10 transition-colors w-full text-left">
                      <Plus className="w-3.5 h-3.5" /> {d("ed_add_page")}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          {/* Restart */}
          <Button size="sm" variant="ghost" onClick={onRestart}><RotateCcw className="w-3.5 h-3.5" /></Button>
        </div>
      </div>

      {/* ── ÉDITEUR + MÉTRÉ (unifié) ── */}
      {(
        <div className="flex flex-col gap-1" style={{ height: "calc(100vh - 7rem)" }}>

{/* ══ BAR 1 : VISIBILITÉ ══ */}
          <div data-tuto="visibility-bar" className="flex items-center gap-1 px-2 py-1 glass rounded-xl border border-white/10 shrink-0">
            <span className="text-[8px] text-slate-600 uppercase tracking-wider font-mono mr-0.5 shrink-0">{d("ed_visibility")}</span>
            {([
              { key: "doors",        Icon: DoorOpen,         active: "border-fuchsia-500/30 bg-fuchsia-500/10", iconColor: "text-fuchsia-400", show: showDoors,        set: setShowDoors,        title: d("ed_doors") },
              { key: "windows",      Icon: AppWindow,        active: "border-cyan-500/30 bg-cyan-500/10",       iconColor: "text-cyan-400",    show: showWindows,      set: setShowWindows,      title: d("ed_windows") },
              { key: "french_doors", Icon: Columns2,         active: "border-orange-500/30 bg-orange-500/10",  iconColor: "text-orange-400",  show: showFrenchDoors,  set: setShowFrenchDoors,  title: "Portes-fenêtres" },
              { key: "walls",        Icon: BrickWall,        active: "border-amber-500/30 bg-amber-500/10",    iconColor: "text-amber-400",   show: showWalls,        set: setShowWalls,        title: d("ed_concrete") },
              { key: "cloisons",    Icon: SeparatorVertical, active: "border-blue-500/30 bg-blue-500/10",      iconColor: "text-blue-400",    show: showCloisons,    set: setShowCloisons,    title: d("ed_partitions") },
              { key: "rooms",        Icon: LayoutGrid,       active: "border-emerald-500/30 bg-emerald-500/10",iconColor: "text-emerald-400", show: showRooms,        set: setShowRooms,        title: d("ed_rooms") },
            ] as const).map(({ key, Icon, active, iconColor, show, set, title }) => (
              <button key={key} onClick={() => set((v: boolean) => !v)} title={title}
                className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-all",
                  show ? cn(active, iconColor) : "border-white/5 hover:border-white/10 hover:bg-white/5")}>
                <Icon size={10} className={iconColor} />
                {show ? <Eye className={cn("w-2.5 h-2.5", iconColor)} /> : <EyeOff className="w-2.5 h-2.5 text-slate-600" />}
              </button>
            ))}
            <button onClick={() => setShowOpeningOverlay(v => !v)} title="Numéros d'ouvertures"
              className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-all",
                showOpeningOverlay ? "border-white/20 bg-white/10 text-white" : "border-white/5 text-slate-600 hover:text-slate-400")}>
              <Hash size={10} />
            </button>
            {/* Separator */}
            <div className="w-px h-4 bg-white/10 shrink-0 mx-0.5" />
            {/* Surfaces toggle */}
            {isAdmin && (
            <button onClick={() => setShowSurfaces(v => !v)} title={d("ed_surfaces_label" as DTKey)}
              className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-all",
                showSurfaces ? "border-violet-500/30 bg-violet-500/10 text-violet-400" : "border-white/5 text-slate-600 hover:text-slate-400")}>
              <PaintBucket size={10} className="text-violet-400" />
              {showSurfaces ? <Eye className="w-2.5 h-2.5 text-violet-400" /> : <EyeOff className="w-2.5 h-2.5 text-slate-600" />}
            </button>
            )}
            {/* Annotations toggle (all count points) */}
            {isAdmin && (
            <button onClick={() => {
              const allVisible = countGroups.every(g => countGroupVisibility[g.id] !== false);
              const newVis: Record<string, boolean> = {};
              countGroups.forEach(g => { newVis[g.id] = !allVisible; });
              setCountGroupVisibility(newVis);
            }} title={d("ed_annotations" as DTKey)}
              className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-all",
                countGroups.some(g => countGroupVisibility[g.id] !== false || countGroupVisibility[g.id] === undefined)
                  ? "border-sky-500/30 bg-sky-500/10 text-sky-400" : "border-white/5 text-slate-600 hover:text-slate-400")}>
              <Hash size={10} className="text-sky-400" />
              <span className="text-[8px]">A</span>
            </button>
            )}
            <div className="w-px h-4 bg-white/10 shrink-0 mx-0.5" />
            {/* Linear + Count visibility */}
            <button onClick={() => { setShowLinearMeasures(v => !v); }}
              title="Mesures lin\u00e9aires"
              className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-all",
                showLinearMeasures ? "border-sky-500/30 bg-sky-500/10 text-sky-400" : "border-white/5 hover:border-white/10 hover:bg-white/5")}>
              <Ruler size={10} className="text-sky-400" />
              {showLinearMeasures ? <Eye className="w-2.5 h-2.5 text-sky-400" /> : <EyeOff className="w-2.5 h-2.5 text-slate-600" />}
            </button>
          </div>

{/* ══ BAR 2 : SÉLECTION ÉLÉMENT ══ */}
          <div data-tuto="edit-bar" className="flex items-center gap-1.5 px-2.5 py-1.5 glass rounded-xl border border-white/10 shrink-0 flex-wrap">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mr-1 shrink-0">{d("ed_element")}</span>
            {(["door", "window", "french_door", "wall", "cloison", "interior", "rooms", "surface", "utilities"] as const).filter(l => {
              if (l === "surface" && !isAdmin) return false;
              if (l === "utilities" && !isAdmin) return false;
              return true;
            }).map(l => {
              const layerMeta: Record<typeof l, { Icon: ElementType; label: string; active: string; iconColor: string; tooltip: string }> = {
                door:        { Icon: DoorOpen,          label: d("ed_doors"),      active: "border-fuchsia-500/40 bg-fuchsia-500/10", iconColor: "text-fuchsia-400", tooltip: "Portes : dessinez, effacez ou corrigez les masques de portes d\u00e9tect\u00e9es par l'IA" },
                window:      { Icon: AppWindow,         label: d("ed_windows"),    active: "border-cyan-500/40 bg-cyan-500/10",       iconColor: "text-cyan-400",    tooltip: "Fen\u00eatres : dessinez, effacez ou corrigez les masques de fen\u00eatres d\u00e9tect\u00e9es par l'IA" },
                french_door: { Icon: Columns2,          label: "P-Fen\u00eatres",       active: "border-orange-500/40 bg-orange-500/10",   iconColor: "text-orange-400",  tooltip: "Portes-fen\u00eatres : dessinez ou corrigez les masques de portes-fen\u00eatres (baies vitr\u00e9es)" },
                wall:        { Icon: BrickWall,         label: d("ed_concrete"),   active: "border-red-500/40 bg-red-500/10",         iconColor: "text-red-400",     tooltip: "Murs porteurs : dessinez ou corrigez les masques des murs en b\u00e9ton/porteurs" },
                cloison:     { Icon: SeparatorVertical, label: d("ed_partitions"), active: "border-blue-500/40 bg-blue-500/10",       iconColor: "text-blue-400",    tooltip: "Cloisons : dessinez ou corrigez les cloisons int\u00e9rieures l\u00e9g\u00e8res" },
                interior:    { Icon: Home,              label: d("ed_living_s"),   active: "border-accent/40 bg-accent/10",           iconColor: "text-accent",      tooltip: "Surface habitable : dessinez ou corrigez le masque de la surface int\u00e9rieure habitable" },
                rooms:       { Icon: LayoutGrid,        label: d("ed_rooms"),      active: "border-emerald-500/40 bg-emerald-500/10", iconColor: "text-emerald-400",  tooltip: "Pi\u00e8ces : s\u00e9lectionnez, renommez, d\u00e9coupez ou fusionnez les pi\u00e8ces d\u00e9tect\u00e9es. Shift+clic pour fusionner." },
                surface:     { Icon: PaintBucket,       label: d("sf_surfaces" as DTKey),  active: "border-violet-500/40 bg-violet-500/10",   iconColor: "text-violet-400",  tooltip: "Surfaces : dessinez des zones de rev\u00eatement (carrelage, parquet, peinture...) pour le m\u00e9tr\u00e9" },
                utilities:   { Icon: Wrench,            label: d("ut_tools" as DTKey),    active: "border-sky-500/40 bg-sky-500/10",         iconColor: "text-sky-400",     tooltip: "Outils de mesure : distance, angle, annotations et recalibrage de l'\u00e9chelle" },
              };
              const m = layerMeta[l];
              // Separator before surface & utilities
              const sep = l === "surface";
              return (
                <span key={l} className="contents">
                  {sep && <div className="w-px h-4 bg-white/10 shrink-0 mx-0.5" />}
                  <button
                    data-tuto={l === "rooms" ? "rooms-btn" : l === "surface" ? "surface-btn" : l === "utilities" ? "tools-btn" : undefined}
                    onClick={() => { const selecting = layer !== l; setLayer(layer === l ? null : l); if (l === "surface" && selecting) setTool("add_poly"); if (l === "utilities" && selecting) setTool("linear"); if (l === "rooms" && selecting) { setSidebarTab("rooms"); zoomToLayerElements("rooms"); } if ((l === "door" || l === "window" || l === "french_door") && selecting) { setSidebarTab("visibility"); zoomToLayerElements(l); } }}
                    title={m.tooltip}
                    className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                      layer === l ? cn(m.active, m.iconColor) : "border-white/5 hover:border-white/10 hover:bg-white/5")}>
                    <m.Icon className={cn("w-4 h-4 shrink-0", m.iconColor)} />
                    <span className={layer === l ? "" : "text-slate-400"}>{m.label}</span>
                  </button>
                </span>
              );
            })}
            {layer !== null && (
              <button onClick={() => setLayer(null)} title={d("ed_tt_deselect")}
                className="ml-0.5 p-0.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

{/* ══ BAR 3 : TOOLS ══ */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 glass rounded-xl border border-white/10 shrink-0 flex-wrap">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mr-1 shrink-0">TOOLS</span>

            <button onClick={() => { setTool("select"); setLayer(null); fitToView(); setShowDoors(true); setShowWindows(true); setShowFrenchDoors(false); setShowWalls(false); setShowCloisons(false); }}
              title="Selection — reinitialiser la vue"
              className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                tool === "select" && layer === null ? "border-teal-500/40 bg-teal-500/10 text-teal-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
              <MousePointer2 className="w-3 h-3" /> Select
            </button>

            <div className="w-px h-4 bg-white/10 shrink-0 mx-0.5" />

            {/* AI Detection (was "Detect similar") */}
            <button data-tuto="vs-btn"
              onClick={() => { setTool(tool === "visual_search" ? "select" : "visual_search" as EditorTool); if (tool !== "visual_search") setVsCrop(null); setVsEditMode("search"); }}
              title="AI Detection — Détection automatique d'éléments similaires"
              className={cn("flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-all",
                tool === "visual_search" ? "border-red-500/40 bg-red-500/15 text-red-400" : "border-red-500/20 text-red-400 hover:bg-red-500/10")}>
              <Search className="w-3.5 h-3.5" /> AI Detection
            </button>

            {/* VS sub-toolbar (show when visual_search active) */}
            {tool === "visual_search" && (
              <div className="flex items-center gap-1.5">
                {vsSearching && <span className="text-[10px] text-red-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> {d("vs_searching")}</span>}
                {!vsSearching && vsMatches.length === 0 && <span className="text-[10px] text-slate-500 italic">{d("vs_select")}</span>}
                {vsMatches.length > 0 && (
                  <>
                    {(["search", "add", "remove"] as const).map((m) => (
                      <button key={m} onClick={() => setVsEditMode(m)}
                        className={cn("px-1.5 py-0.5 rounded text-[10px] border transition-all",
                          vsEditMode === m ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                        {m === "search" ? d("vs_search") : m === "add" ? d("vs_add") : d("vs_remove")}
                      </button>
                    ))}
                    <span className="text-[10px] font-600 text-red-400">{vsMatches.length} {d("vs_found")}</span>
                    {!vsSaveOpen ? (
                      <button onClick={() => setVsSaveOpen(true)}
                        className="px-1.5 py-0.5 rounded text-[10px] border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 flex items-center gap-0.5">
                        <Save className="w-3 h-3" /> {d("vs_save")}
                      </button>
                    ) : (
                      <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); saveVsAsDetection(vsSaveLabel); }}>
                        <input type="text" value={vsSaveLabel} onChange={(e) => setVsSaveLabel(e.target.value)}
                          placeholder={d("vs_save_ph")}
                          className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 border border-white/10 text-white placeholder:text-slate-600 w-28 focus:outline-none focus:border-emerald-500/40" autoFocus />
                        <button type="submit" disabled={!vsSaveLabel.trim()} className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 disabled:opacity-30">OK</button>
                        <button type="button" onClick={() => { setVsSaveOpen(false); setVsSaveLabel(""); }} className="text-slate-500 hover:text-white"><X className="w-3 h-3" /></button>
                      </form>
                    )}
                    <button onClick={() => { setVsMatches([]); setVsCrop(null); setVsSaveOpen(false); }}
                      className="text-slate-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                  </>
                )}
              </div>
            )}

            <div className="w-px h-4 bg-white/10 shrink-0 mx-0.5" />

            {/* Text annotation */}
            <button onClick={() => setTool("text" as EditorTool)}
              title="Annotation texte"
              className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                tool === "text" ? "border-sky-500/40 bg-sky-500/10 text-sky-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
              <Type className="w-3 h-3" /> Texte
            </button>

            {/* Linear measurement */}
            <button onClick={() => setTool("linear" as EditorTool)}
              title="Mesure de distance linéaire"
              className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                tool === "linear" ? "border-sky-500/40 bg-sky-500/10 text-sky-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
              <Ruler className="w-3 h-3" /> Linéaire
            </button>

            {/* Count tool with dropdown */}
            <div className="relative">
              <button onClick={() => { setShowCountDropdown(v => !v); }}
                title="Comptage"
                className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                  tool === "count" ? "border-sky-500/40 bg-sky-500/10 text-sky-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                <Hash className="w-3 h-3" /> Comptage
                <ChevronDown className="w-2.5 h-2.5 ml-0.5" />
              </button>
              {showCountDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowCountDropdown(false)} />
                  <div className="absolute bottom-full left-0 mb-1 z-50 glass border border-sky-500/20 rounded-xl p-2 shadow-2xl min-w-48"
                    onClick={e => e.stopPropagation()}>
                    <p className="text-[9px] text-sky-400 uppercase tracking-wider font-semibold mb-1.5 px-1">Categories</p>
                    {countGroups.map(grp => (
                      <button key={grp.id}
                        onClick={() => { setActiveCountGroupId(grp.id); setTool("count"); setShowCountDropdown(false); }}
                        className={cn("flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs w-full text-left transition-colors",
                          activeCountGroupId === grp.id ? "bg-sky-500/15 text-sky-300" : "text-slate-400 hover:text-white hover:bg-white/5")}>
                        <span className="relative w-3 h-3 rounded-full shrink-0 cursor-pointer" style={{ background: grp.color }}>
                          <input type="color" value={grp.color}
                            onClick={e => e.stopPropagation()}
                            onChange={e => { e.stopPropagation(); setCountGroups(prev => prev.map(g => g.id === grp.id ? {...g, color: e.target.value} : g)); }}
                            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                        </span>
                        {grp.name}
                        <span className="ml-auto text-[10px] text-slate-600 font-mono">{countPoints.filter(p => p.groupId === grp.id).length}</span>
                      </button>
                    ))}
                    <div className="border-t border-white/10 mt-1.5 pt-1.5">
                      <button onClick={() => {
                        const name = prompt("Nom de la categorie :");
                        if (!name?.trim()) return;
                        const colors = ["#f472b6", "#34d399", "#fb923c", "#818cf8", "#22d3ee", "#fbbf24"];
                        const color = colors[countGroups.length % colors.length];
                        const newGroup = { id: `grp_${Date.now()}`, name: name.trim(), color };
                        setCountGroups(prev => [...prev, newGroup]);
                        setActiveCountGroupId(newGroup.id);
                        setTool("count");
                        setShowCountDropdown(false);
                      }}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-500 hover:text-white hover:bg-white/5 w-full text-left">
                        <Plus className="w-3 h-3" /> Creer une categorie
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Measurement info */}
            {tool === "linear" && !ppm && (
              <span className="text-[10px] text-amber-400 ml-1">⚠ Calibrez l'échelle pour afficher en mètres</span>
            )}
            {ppm && linearMeasures.length > 0 && (
              <span className="text-[10px] text-sky-400 font-mono ml-1">
                Total : {linearMeasures.reduce((s, lm) => s + (lm.distPx / ppm), 0).toFixed(2)} m
              </span>
            )}
          </div>

{/* ══ BAR 4 : OUTILS CONTEXTUELS (visible seulement si élément sélectionné) ══ */}
          {layer !== null && (
            <div className="flex items-center gap-1 px-2 py-1 glass rounded-xl border border-white/10 shrink-0 flex-wrap">
              {/* Outils couches masque (standard: door/window/french_door/wall/cloison/interior) */}
              {layer !== null && layer !== "rooms" && layer !== "surface" && layer !== "utilities" && (
                <>
                  <button onClick={() => { setTool("add_rect"); pts.current = []; }}
                    title={d("ed_tt_draw_rect")}
                    className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                      tool === "add_rect" ? "border-accent/40 bg-accent/10 text-accent" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                    <Square className="w-3 h-3" /> {d("ed_draw")}
                  </button>
                  <button onClick={() => { setTool("erase_rect"); pts.current = []; }}
                    title={d("ed_tt_erase_rect")}
                    className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                      tool === "erase_rect" ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                    <Eraser className="w-3 h-3" /> {d("ed_erase_tool")}
                  </button>
                  <button onClick={() => { setTool("add_poly"); pts.current = []; }}
                    title={d("ed_tt_free_shape")}
                    className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                      tool === "add_poly" ? "border-accent/40 bg-accent/10 text-accent" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                    <PenLine className="w-3 h-3" /> {d("ed_free_shape")}
                  </button>
                  <button onClick={() => { setTool("erase_poly"); pts.current = []; }}
                    title={d("ed_tt_erase_free")}
                    className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                      tool === "erase_poly" ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                    <PenOff className="w-3 h-3" /> {d("ed_erase_free")}
                  </button>
                  {isAdmin && (layer === "door" || layer === "window" || layer === "french_door" || layer === "interior") && (
                    <button onClick={() => setTool("sam")}
                      title="Détection IA automatique : cliquez sur un élément pour le détecter automatiquement (SAM)"
                      className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                        tool === "sam" ? "border-orange-500/40 bg-orange-500/10 text-orange-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                      <Sparkles className="w-3 h-3" /> {d("ed_ia_auto")}
                    </button>
                  )}
                  {(tool === "add_poly" || tool === "erase_poly") && (
                    <button onClick={finishPoly}
                      title={d("ed_tt_validate")}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 animate-pulse">
                      <Check className="w-3 h-3" /> {d("ed_validate")}
                    </button>
                  )}
                </>
              )}
              {/* Outils couche Pièces */}
              {layer === "rooms" && (
                <>
                  <button onClick={() => { setTool("select"); pts.current = []; }}
                    title={d("ed_tt_select")}
                    className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                      tool === "select" ? "border-teal-500/40 bg-teal-500/10 text-teal-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                    <MousePointer2 className="w-3 h-3" /> {d("ed_select")}
                  </button>
                  {/* Floor type (surface) selector — before room type */}
                  <div className="w-px h-4 bg-white/10 shrink-0 mx-0.5" />
                  <div className="flex items-center gap-1 relative">
                    <span className="text-[9px] text-slate-500 shrink-0">Sol :</span>
                    <select
                      value={activeFloorTypeId}
                      onChange={e => {
                        setActiveFloorTypeId(e.target.value);
                        // Sync: apply to selected room
                        if (selectedRoomId && e.target.value) {
                          const stId = e.target.value;
                          setResult(prev => ({
                            ...prev,
                            rooms: (prev.rooms ?? []).map(r => {
                              if (r.id !== selectedRoomId) return r;
                              if (r.linkedZoneId) setZones(zp => zp.filter(z => z.id !== r.linkedZoneId));
                              if (!r.polygon_norm) return { ...r, surfaceTypeId: stId, linkedZoneId: undefined };
                              const zoneId = crypto.randomUUID();
                              setZones(zp => [...zp.filter(z => z.id !== r.linkedZoneId), { id: zoneId, typeId: stId, points: r.polygon_norm!.map(p => ({x:p.x, y:p.y})), name: `auto:room:${r.id}` }]);
                              return { ...r, surfaceTypeId: stId, linkedZoneId: zoneId };
                            }),
                          }));
                        }
                      }}
                      className="bg-slate-800 border border-white/10 rounded-lg px-1.5 py-0.5 text-[10px] text-white max-w-28"
                    >
                      <option value="">— Aucun —</option>
                      {surfaceTypes.map(st => (
                        <option key={st.id} value={st.id}>{st.name}</option>
                      ))}
                    </select>
                    {activeFloorTypeId && (() => {
                      const st = surfaceTypes.find(s => s.id === activeFloorTypeId);
                      return st ? <span className="w-3 h-3 rounded-full shrink-0" style={{ background: st.color }} /> : null;
                    })()}

                    {/* Create new floor type button */}
                    <button onClick={() => setShowNewFloorType(v => !v)} title="Créer un type de sol"
                      className="w-5 h-5 rounded-full border border-dashed border-violet-500/40 text-violet-400 text-[10px] flex items-center justify-center hover:bg-violet-500/10 transition-colors shrink-0">
                      +
                    </button>

                    {/* New floor type form (dropdown) */}
                    {showNewFloorType && (
                      <div className="absolute top-full left-0 mt-1 z-50 glass border border-violet-500/20 rounded-xl p-3 shadow-2xl min-w-52"
                        onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                        <p className="text-[9px] text-violet-400 uppercase tracking-wider font-semibold mb-2">Nouveau type de sol</p>
                        <div className="flex flex-col gap-2">
                          <input
                            autoFocus
                            type="text"
                            value={newFloorTypeName}
                            onChange={e => setNewFloorTypeName(e.target.value)}
                            onKeyDown={e => {
                              e.stopPropagation();
                              if (e.key === "Enter" && newFloorTypeName.trim()) {
                                const id = newFloorTypeName.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
                                setSurfaceTypes(prev => [...prev, { id, name: newFloorTypeName.trim(), color: newFloorTypeColor, wastePercent: 10, pricePerM2: 0 }]);
                                setActiveFloorTypeId(id);
                                setNewFloorTypeName("");
                                setShowNewFloorType(false);
                              }
                              if (e.key === "Escape") setShowNewFloorType(false);
                            }}
                            placeholder="Nom du type de sol..."
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/40"
                          />
                          <div className="flex items-center gap-2">
                            <label className="text-[10px] text-slate-500 shrink-0">Couleur</label>
                            <div className="flex gap-1 flex-wrap">
                              {["#3B82F6", "#F97316", "#8B5CF6", "#6B7280", "#EC4899", "#10B981", "#F59E0B", "#EF4444"].map(c => (
                                <button key={c} onClick={() => setNewFloorTypeColor(c)}
                                  className="w-4 h-4 rounded-full border-2 transition-all"
                                  style={{ background: c, borderColor: newFloorTypeColor === c ? "white" : "transparent" }} />
                              ))}
                              <input type="color" value={newFloorTypeColor} onChange={e => setNewFloorTypeColor(e.target.value)}
                                className="w-4 h-4 rounded-full border-0 cursor-pointer p-0" />
                            </div>
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              disabled={!newFloorTypeName.trim()}
                              onClick={() => {
                                const id = newFloorTypeName.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
                                setSurfaceTypes(prev => [...prev, { id, name: newFloorTypeName.trim(), color: newFloorTypeColor, wastePercent: 10, pricePerM2: 0 }]);
                                setActiveFloorTypeId(id);
                                setNewFloorTypeName("");
                                setShowNewFloorType(false);
                              }}
                              className="flex-1 py-1 text-[10px] bg-violet-500/20 border border-violet-500/30 text-violet-300 rounded-lg hover:bg-violet-500/30 transition-colors disabled:opacity-30">
                              Créer
                            </button>
                            <button onClick={() => setShowNewFloorType(false)}
                              className="px-2 py-1 text-[10px] border border-white/10 text-slate-400 rounded-lg hover:text-white transition-colors">
                              Annuler
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="w-px h-4 bg-white/10 shrink-0 mx-0.5" />
                  {/* Room type selector */}
                  <select
                    value={activeRoomType}
                    onChange={e => setActiveRoomType(e.target.value)}
                    className="bg-slate-800 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white"
                    title="Type de pièce pour la création"
                  >
                    {ROOM_TYPES.map(rt => (
                      <option key={rt.type} value={rt.type}>{d(rt.i18nKey)}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => { if (!selectedRoomId) return; setTool("split"); pts.current = []; toast({ title: d("ed_mode_split"), description: d("ed_mode_split_d"), variant: "default" }); }}
                    disabled={selectedRoomId === null}
                    title={selectedRoomId === null ? d("ed_tt_cut_need") : d("ed_tt_cut")}
                    className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                      tool === "split" ? "border-orange-500/40 bg-orange-500/10 text-orange-400"
                        : selectedRoomId !== null ? "border-white/5 text-slate-500 hover:text-slate-300"
                        : "border-white/5 text-slate-700 opacity-40 cursor-not-allowed")}>
                    <Scissors className="w-3 h-3" /> {d("ed_cut")}
                  </button>
                  {tool === "split" && (
                    <button onClick={() => { pts.current = []; drawCanvas(); setTool("select"); }}
                      title={d("ed_tt_cancel_cut")}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border border-red-500/30 bg-red-500/10 text-red-400">
                      <X className="w-3 h-3" /> {d("ed_cancel")}
                    </button>
                  )}
                  <button onClick={() => { setTool("add_poly"); pts.current = []; }}
                    title="Créer une pièce : dessinez un polygone"
                    className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                      tool === "add_poly" && layer === "rooms" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                    <PenLine className="w-3 h-3" /> Créer
                  </button>
                  {tool === "add_poly" && layer === "rooms" && (
                    <button onClick={finishPoly}
                      title="Valider le polygone de la pièce"
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 animate-pulse">
                      <Check className="w-3 h-3" /> {d("ed_validate")}
                    </button>
                  )}
                  <div className="flex gap-0.5 items-center ml-1">
                    {ROOM_TYPES.slice(0, 8).map(rt => (
                      <button key={rt.type} onClick={() => setActiveRoomType(rt.type)}
                        title={d(rt.i18nKey)}
                        className={cn("w-4 h-4 rounded-full border-2 transition-all shrink-0",
                          activeRoomType === rt.type ? "border-white scale-110" : "border-transparent opacity-60 hover:opacity-100")}
                        style={{ background: getRoomColor(rt.type) }} />
                    ))}
                    {/* Add custom room type */}
                    <label className="relative w-4 h-4 cursor-pointer" title="Couleur personnalisée">
                      <span className="flex items-center justify-center w-4 h-4 rounded-full border-2 border-dashed border-slate-500 text-slate-500 text-[8px] font-bold hover:border-white hover:text-white transition-colors">+</span>
                      <input type="color" value="#94a3b8"
                        onChange={e => {
                          const color = e.target.value;
                          const type = `custom_${Date.now()}`;
                          setActiveRoomType(type);
                        }}
                        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                    </label>
                  </div>
                  <button onClick={() => { const allOn = snapConfig.enableVertex && snapConfig.enableWall && snapConfig.enableGrid && snapConfig.enableAlignment; const next = !allOn; setSnapConfig(c => ({ ...c, enableVertex: next, enableWall: next, enableMidpoint: next, enableGrid: next, enableAlignment: next })); }}
                    title={d("snap_label")}
                    className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                      snapConfig.enableWall ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-400" : "border-white/10 text-slate-600 hover:text-slate-400")}>
                    <Magnet size={11} /> {d("snap_label")}
                  </button>
                </>
              )}

              {/* ── Outils SURFACE (carrelage, parquet, peinture, etc.) ── */}
              {layer === "surface" && (
                <>
                  <button onClick={() => { setTool("add_poly"); pts.current = []; }}
                    title={d("sf_polygon" as DTKey)}
                    className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                      tool === "add_poly" ? "border-violet-500/40 bg-violet-500/10 text-violet-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                    <PenLine className="w-3 h-3" /> {d("sf_polygon" as DTKey)}
                  </button>
                  <button onClick={() => { setTool("add_rect"); pts.current = []; }}
                    title={d("sf_rectangle" as DTKey)}
                    className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                      tool === "add_rect" ? "border-violet-500/40 bg-violet-500/10 text-violet-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                    <Square className="w-3 h-3" /> {d("sf_rectangle" as DTKey)}
                  </button>
                  <button onClick={() => { setTool("deduct_rect"); pts.current = []; }}
                    title={d("sf_deduct" as DTKey)}
                    className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                      tool === "deduct_rect" ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                    <Minus className="w-3 h-3" /> {d("sf_deduct" as DTKey)}
                  </button>
                  <button onClick={() => { setTool("erase_poly"); pts.current = []; }}
                    title={d("sf_erase_poly" as DTKey)}
                    className={cn("flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-all",
                      tool === "erase_poly" ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                    <PenOff className="w-3 h-3" /> {d("sf_erase_poly" as DTKey)}
                  </button>
                  {(tool === "add_poly" || (tool === "erase_poly" && layer === "surface")) && (
                    <button onClick={finishPoly}
                      title={d("sf_validate" as DTKey)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 animate-pulse">
                      <Check className="w-3 h-3" /> {d("sf_validate" as DTKey)}
                    </button>
                  )}
                  <div className="w-px h-4 bg-white/10 shrink-0 mx-0.5" />
                  {/* Surface type selector */}
                  <span className="text-[8px] text-slate-600 uppercase tracking-wider font-mono shrink-0">{d("sf_type" as DTKey)}</span>
                  {surfaceTypes.map(st => (
                    <button key={st.id} onClick={() => setActiveTypeId(st.id)}
                      title={st.name}
                      className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-all",
                        activeTypeId === st.id ? "border-white/30 bg-white/10 text-white" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: st.color }} />
                      {st.name}
                    </button>
                  ))}
                </>
              )}

              {/* ── Outils UTILITIES (lin\u00e9aire, annotations, angle, \u00e9chelle) ── */}
              {layer === "utilities" && (
                <>
                  <button onClick={() => setTool("linear")}
                    title="Mesure de distance : cliquez 2 points pour mesurer une longueur en mètres"
                    className={cn("flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] border transition-all",
                      tool === "linear" ? "border-sky-500/40 bg-sky-500/10 text-sky-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                    <Ruler className="w-2.5 h-2.5" /> {d("ut_linear" as DTKey)}
                  </button>
                  <button onClick={() => setTool("angle")}
                    title="Mesure d'angle : cliquez 3 points (point de départ, sommet, point d'arrivée) pour mesurer un angle en degrés"
                    className={cn("flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] border transition-all",
                      tool === "angle" ? "border-sky-500/40 bg-sky-500/10 text-sky-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                    <Compass className="w-2.5 h-2.5" /> {d("ut_angle" as DTKey)}
                  </button>
                  <button onClick={() => setTool("count")}
                    title="Annotation : cliquez sur le plan pour placer des points. Créez des catégories (prises, radiateurs, etc.) dans le panneau latéral"
                    className={cn("flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] border transition-all",
                      tool === "count" ? "border-sky-500/40 bg-sky-500/10 text-sky-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                    <Hash className="w-2.5 h-2.5" /> {d("ut_count" as DTKey)}
                  </button>
                  <button onClick={() => setTool("text")}
                    title="Annotation texte : cliquez sur le plan pour placer un texte libre"
                    className={cn("flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] border transition-all",
                      tool === "text" ? "border-sky-500/40 bg-sky-500/10 text-sky-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                    <Type className="w-2.5 h-2.5" /> Texte
                  </button>
                  <button onClick={() => setTool("circle")}
                    title="Mesure de cercle : cliquez le centre puis le bord pour mesurer rayon/diamètre/surface"
                    className={cn("flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] border transition-all",
                      tool === "circle" ? "border-teal-500/40 bg-teal-500/10 text-teal-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                    <Circle className="w-2.5 h-2.5" /> Cercle
                  </button>
                  <button onClick={() => setTool("rescale")}
                    title="Recalibrer l'échelle : cliquez 2 points d'une distance connue pour ajuster le rapport pixels/mètres"
                    className={cn("flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] border transition-all",
                      tool === "rescale" ? "border-amber-500/40 bg-amber-500/10 text-amber-400" : "border-white/5 text-slate-500 hover:text-slate-300")}>
                    <Maximize2 className="w-2.5 h-2.5" /> {d("ut_rescale" as DTKey)}
                  </button>
                  {ppm && (
                    <span className="text-[10px] text-slate-500 font-mono ml-1">
                      {ppm.toFixed(1)} px/m
                    </span>
                  )}
                </>
              )}

              <div className="flex-1" />
              <div className="w-px h-5 bg-white/10 shrink-0 mx-1" />
              {/* Annuler / Rétablir */}
              {layer === "rooms" ? (
                <>
                  <button onClick={sendUndoRoom} disabled={roomHistoryLen === 0 || loading}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-white/5 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                    title={d("ed_undo_tt")}><Undo2 className="w-3 h-3" /></button>
                  <button onClick={sendRedoRoom} disabled={roomFutureLen === 0 || loading}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-white/5 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                    title={d("ed_redo_tt")}><Redo2 className="w-3 h-3" /></button>
                </>
              ) : (
                <>
                  <button onClick={sendUndoMask} disabled={editHistoryLen === 0 || loading}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-white/5 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                    title={d("ed_undo_tt")}><Undo2 className="w-3 h-3" /></button>
                  <button onClick={sendRedoMask} disabled={editFutureLen === 0 || loading}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-white/5 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                    title={d("ed_redo_tt")}><Redo2 className="w-3 h-3" /></button>
                </>
              )}
            </div>
          )}

{/* ══ CANVAS + SIDEBAR ══ */}
          <div className="flex-1 flex gap-1.5 min-h-0">
          <div className="flex-1 flex flex-col gap-1 min-w-0">

            <div
              ref={zoomContainerRef}
              className="flex-1 rounded-xl border border-white/10 relative overflow-hidden"
              style={{
                cursor: panCursor ? "grabbing" : "default",
                background: "#0d1117",
                backgroundImage:
                  "radial-gradient(circle, rgba(148,163,184,0.13) 1px, transparent 1px)",
                backgroundSize: "24px 24px",
              }}
              onContextMenu={e => e.preventDefault()}
              onMouseDown={e => {
                if (e.button === 2) {
                  isPanRef.current = true;
                  setPanCursor(true);
                  panStartRef.current = { mx: e.clientX, my: e.clientY, tx: translateRef.current.x, ty: translateRef.current.y };
                }
              }}
            >
              {loading && (
                <div className="absolute inset-0 bg-ink/70 flex items-center justify-center z-30">
                  <Loader2 className="w-8 h-8 text-accent animate-spin" />
                </div>
              )}
              {/* Split mode overlay instruction */}
              {tool === "split" && (
                <div className="absolute top-3 left-3 z-20 flex items-center gap-2 bg-slate-900/95 border border-orange-500/40 rounded-xl px-4 py-2 shadow-lg pointer-events-none">
                  <Scissors className="w-4 h-4 text-orange-400" />
                  <span className="text-sm text-orange-300">
                    {pts.current.length === 0
                      ? d("ed_cut_pt1" as DTKey)
                      : d("ed_cut_pt2" as DTKey)}
                  </span>
                  <kbd className="text-[10px] px-1.5 py-0.5 border border-white/20 rounded bg-white/5 text-slate-400 pointer-events-auto cursor-pointer"
                    onClick={() => { setTool("select"); pts.current = []; }}>Echap</kbd>
                </div>
              )}
              {/* Floating zoom controls — top-right */}
              <div className="absolute top-3 right-3 z-20 flex items-center gap-1 glass border border-white/10 rounded-lg p-1">
                <button onClick={() => setZoom(z => Math.min(12, z * 1.3))}
                  className="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                  title="Zoom +"><ZoomIn className="w-3.5 h-3.5" /></button>
                <button onClick={() => setZoom(z => { const nz = Math.max(0.3, z * 0.75); if (nz <= 0.32) { fitToView(); return nz; } return nz; })}
                  className="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                  title="Zoom −"><ZoomOut className="w-3.5 h-3.5" /></button>
                <div className="w-px h-5 bg-white/10" />
                <button onClick={fitToView}
                  className="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                  title="Ajuster à la fenêtre"><Maximize2 className="w-3 h-3" /></button>
                {Math.abs(zoom - 1) > 0.05 && (
                  <span className="text-[9px] text-slate-500 font-mono pl-0.5">{zoom.toFixed(1)}x</span>
                )}
                {originalImageB64 && (
                  <>
                    <div className="w-px h-5 bg-white/10" />
                    <button
                      onClick={() => { setShowOriginal(v => !v); requestAnimationFrame(fitToView); }}
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                        showOriginal
                          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                          : "text-slate-400 hover:text-white hover:bg-white/10"
                      }`}
                      title={showOriginal ? "Revenir à la vue analysée (croppée)" : "Voir l'image originale complète"}
                    >
                      {showOriginal ? "Vue analysée" : "Original"}
                    </button>
                    {isAdmin && cropRect && (
                      <button
                        onClick={() => setShowFullPlan(true)}
                        className="px-2 py-1 rounded text-[10px] font-medium text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/40 border border-transparent transition-colors"
                        title="Vue complète : image originale avec détections recalées (admin)"
                      >
                        Vue complète
                      </button>
                    )}
                  </>
                )}
              </div>
              <div style={{
                position: "absolute",
                top: "50%", left: "50%",
                transform: `translate(calc(-50% + ${translate.x}px), calc(-50% + ${translate.y}px)) scale(${zoom})`,
                transformOrigin: "center center",
              }}>
              <div className="relative">
              <img ref={imgRef} src={`data:image/png;base64,${currentOverlay}`} alt="Plan"
                style={{ display: "block", maxWidth: "calc(100vw - 300px)", maxHeight: "calc(100vh - 8rem)" }}
                draggable={false}
                onLoad={() => { updateImgDisplaySize(); fitToView(); }} />

              {/* Masques ouvertures dissociables — portes (fuchsia), fenêtres (cyan) */}
              {showDoors && result.mask_doors_b64 && (
                <div className="absolute inset-0 pointer-events-none" style={{
                  backgroundColor: "#FF00CC",
                  opacity: 0.55,
                  WebkitMaskImage: `url(data:image/png;base64,${result.mask_doors_b64})`,
                  maskImage: `url(data:image/png;base64,${result.mask_doors_b64})`,
                  WebkitMaskSize: "100% 100%",
                  maskSize: "100% 100%",
                  ...({ WebkitMaskMode: "luminance", maskMode: "luminance" } as React.CSSProperties),
                  zIndex: 1,
                }} />
              )}
              {showWindows && result.mask_windows_b64 && (
                <div className="absolute inset-0 pointer-events-none" style={{
                  backgroundColor: "#00CCFF",
                  opacity: 0.55,
                  WebkitMaskImage: `url(data:image/png;base64,${result.mask_windows_b64})`,
                  maskImage: `url(data:image/png;base64,${result.mask_windows_b64})`,
                  WebkitMaskSize: "100% 100%",
                  maskSize: "100% 100%",
                  ...({ WebkitMaskMode: "luminance", maskMode: "luminance" } as React.CSSProperties),
                  zIndex: 1,
                }} />
              )}

              {/* French Doors RGBA overlay (orange) */}
              {showFrenchDoors && result.mask_french_doors_b64 && (
                <img
                  src={`data:image/png;base64,${result.mask_french_doors_b64}`}
                  alt=""
                  className="absolute inset-0 w-full h-full pointer-events-none object-contain"
                  style={{ zIndex: 1, opacity: 0.75 }}
                />
              )}

              {/* Overlay Murs béton (RGBA PNG) — affiché quand couche béton active */}
              {(showWalls || layer === "wall") && result.mask_walls_pixel_b64 && (
                <img
                  src={`data:image/png;base64,${result.mask_walls_pixel_b64}`}
                  alt=""
                  className="absolute inset-0 w-full h-full pointer-events-none object-contain"
                  style={{ zIndex: 2, opacity: 0.75 }}
                />
              )}

              {/* Overlay Cloisons (RGBA PNG) — affiché quand couche cloison active */}
              {(showCloisons || layer === "cloison") && result.mask_cloisons_b64 && (
                <img
                  src={`data:image/png;base64,${result.mask_cloisons_b64}`}
                  alt=""
                  className="absolute inset-0 w-full h-full pointer-events-none object-contain"
                  style={{ zIndex: 2, opacity: 0.75 }}
                />
              )}

              {/* Masque coloré raster (fallback si pas de polygon_norm) */}
              {showRooms && result.mask_rooms_b64 && !(result.rooms?.some(r => r.polygon_norm)) && selectedRoomId === null && (
                <img
                  src={`data:image/png;base64,${result.mask_rooms_b64}`}
                  alt=""
                  className="absolute inset-0 w-full h-full pointer-events-none object-contain"
                  style={{ zIndex: 1 }}
                />
              )}

              {/* SVG overlay murs + pièces (polygones vectoriels) */}
              {imgDisplaySize.w > 0 && (
                <svg
                  className="absolute top-0 left-0 pointer-events-none"
                  width={imgDisplaySize.w}
                  height={imgDisplaySize.h}
                  viewBox={`0 0 ${imgDisplaySize.w} ${imgDisplaySize.h}`}
                  style={{ zIndex: 1 }}
                >
                  {showWalls && result.walls?.map((w, i) => (
                    <line key={i}
                      x1={w.x1_norm * imgDisplaySize.w} y1={w.y1_norm * imgDisplaySize.h}
                      x2={w.x2_norm * imgDisplaySize.w} y2={w.y2_norm * imgDisplaySize.h}
                      stroke="#f97316" strokeWidth={2} strokeLinecap="round" opacity={0.70}
                    />
                  ))}
                  {showRooms && displayRooms.filter(room =>
                    // When vertex editing, the selected room is rendered in the vertex SVG instead
                    (vertexEditActive ? room.id !== selectedRoomId : true)
                    && (selectedRoomId === null || room.id === selectedRoomId || selectedRoomIds.has(room.id))
                  ).map(room => {
                    const rcolor = getRoomColor(room.type);
                    const isSelected = selectedRoomId === room.id;
                    const isMultiSelected = selectedRoomIds.has(room.id);

                    // Polygon SVG points
                    const polyPoints = room.polygon_norm
                      ? room.polygon_norm
                          .map(p => `${p.x * imgDisplaySize.w},${p.y * imgDisplaySize.h}`)
                          .join(" ")
                      : null;

                    return (
                      <g key={room.id}>
                        {/* Colored fill for all rooms (visible overlay) */}
                        {polyPoints && !isSelected && (
                          <polygon
                            points={polyPoints}
                            fill={rcolor + "28"}
                            stroke={rcolor}
                            strokeWidth={1.5}
                            strokeLinejoin="round"
                            opacity={0.85}
                            style={{ pointerEvents: "none" }}
                          />
                        )}
                        {/* Multi-selection highlight (dashed border) */}
                        {isMultiSelected && !isSelected && polyPoints && (
                          <polygon
                            points={polyPoints}
                            fill={rcolor + "15"}
                            stroke={rcolor}
                            strokeWidth={2.5}
                            strokeDasharray="8 4"
                            strokeLinejoin="round"
                            style={{ pointerEvents: "none" }}
                          />
                        )}
                        {/* Invisible polygon for click detection */}
                        {polyPoints && (
                          <polygon
                            points={polyPoints}
                            fill="transparent"
                            stroke="none"
                            style={{ pointerEvents: "all", cursor: "pointer" }}
                            onClick={e => {
                              e.stopPropagation();
                              if (e.ctrlKey || e.metaKey) {
                                setSelectedRoomIds(prev => {
                                  const s = new Set(prev);
                                  if (s.has(room.id)) s.delete(room.id); else s.add(room.id);
                                  return s;
                                });
                              } else {
                                setSelectedRoomId(id => id === room.id ? null : room.id);
                                setSelectedRoomIds(new Set());
                                setSelectedOpeningIdxs(new Set());
                              }
                              setEditingRoomId(room.id);
                              setActiveRoomType(room.type);
                            }}
                          />
                        )}
                        {/* Selection border (no fill, no label) */}
                        {isSelected && polyPoints && (
                          <polygon
                            points={polyPoints}
                            fill={rcolor + "22"}
                            stroke={rcolor}
                            strokeWidth={3}
                            strokeDasharray="6 3"
                            strokeLinejoin="round"
                            style={{ pointerEvents: "none" }}
                          />
                        )}
                        {/* Edge dimension annotations (selected room only) */}
                        {isSelected && room.polygon_norm && ppm && imageNatural.w > 0 && room.polygon_norm.map((p, ei) => {
                          const next = room.polygon_norm![(ei + 1) % room.polygon_norm!.length];
                          const x1 = p.x * imgDisplaySize.w, y1 = p.y * imgDisplaySize.h;
                          const x2 = next.x * imgDisplaySize.w, y2 = next.y * imgDisplaySize.h;
                          const edgeLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
                          if (edgeLen < 30) return null;
                          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
                          const lenM = edgeLengthM(p, next, imageNatural.w, imageNatural.h, ppm);
                          const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
                          const rot = (angle > 90 || angle < -90) ? angle + 180 : angle;
                          const nx = -(y2 - y1) / edgeLen * 8;
                          const ny = (x2 - x1) / edgeLen * 8;
                          const tx = mx + nx, ty = my + ny;
                          const dimText = lenM.toFixed(2) + " m";
                          const tw = dimText.length * 5.5 + 6;
                          return (
                            <g key={`dim-${ei}`}>
                              <rect
                                x={tx - tw / 2} y={ty - 6}
                                width={tw} height={12} rx={2}
                                fill="rgba(10,16,32,0.85)"
                                transform={`rotate(${rot},${tx},${ty})`}
                              />
                              <text
                                x={tx} y={ty + 3}
                                textAnchor="middle"
                                fill="#e2e8f0"
                                fontSize={6}
                                fontFamily="monospace"
                                fontWeight="600"
                                transform={`rotate(${rot},${tx},${ty})`}
                              >{dimText}</text>
                            </g>
                          );
                        })}
                      </g>
                    );
                  })}
                </svg>
              )}

              {/* ── Surface zones (carrelage, parquet, etc.) ── */}
              {showSurfaces && zones.length > 0 && imgDisplaySize.w > 0 && imageNatural.w > 0 && (
                <svg
                  className="absolute top-0 left-0 pointer-events-none"
                  width={imgDisplaySize.w}
                  height={imgDisplaySize.h}
                  viewBox={`0 0 ${imageNatural.w} ${imageNatural.h}`}
                  style={{ zIndex: 2 }}
                >
                  {zones.filter(z => z.typeId !== "__count__").map(zone => {
                    const st = allMeasureTypes.find(t => t.id === zone.typeId);
                    if (!st || !zone.points || zone.points.length < 3) return null;
                    const ptsSvg = zone.points.map(p => `${p.x * imageNatural.w},${p.y * imageNatural.h}`).join(" ");
                    const cx = zone.points.reduce((s, p) => s + p.x, 0) / zone.points.length * imageNatural.w;
                    const cy = zone.points.reduce((s, p) => s + p.y, 0) / zone.points.length * imageNatural.h;
                    const areaPx = polygonAreaNorm(zone.points, imageNatural.w, imageNatural.h);
                    const areaM2 = ppm ? areaPx / (ppm * ppm) : null;
                    const label = st.name;
                    const areaStr = areaM2 != null ? `${areaM2.toFixed(2)} m\u00b2` : "";
                    const fs = 9;
                    return (
                      <g key={zone.id}>
                        <polygon points={ptsSvg} fill={st.color + "35"} stroke={st.color} strokeWidth={1.5} strokeLinejoin="round" opacity={0.85} style={{ pointerEvents: "none" }} />
                        <rect x={cx - 35} y={cy - 10} width={70} height={areaStr ? 22 : 14} rx={3} fill="rgba(10,16,32,0.92)" stroke={st.color} strokeWidth={1} />
                        <text x={cx} y={cy - (areaStr ? 1 : 3)} textAnchor="middle" fill={st.color} fontSize={fs} fontWeight="700" fontFamily="system-ui,sans-serif">{label}</text>
                        {areaStr && <text x={cx} y={cy + 9} textAnchor="middle" fill="#94a3b8" fontSize={7} fontWeight="500" fontFamily="monospace">{areaStr}</text>}
                      </g>
                    );
                  })}
                  {/* Count points (utilities) */}
                  {/* Count points by category (new system) */}
                  {countPoints.filter(cp => countGroupVisibility[cp.groupId] !== false).map(cp => {
                    const grp = countGroups.find(g => g.id === cp.groupId);
                    const color = grp?.color ?? "#38bdf8";
                    const px = cp.x * imageNatural.w;
                    const py = cp.y * imageNatural.h;
                    const num = countPoints.filter(p => p.groupId === cp.groupId).indexOf(cp) + 1;
                    const label = grp?.name ?? "";
                    return (
                      <g key={cp.id} style={{ pointerEvents: "all", cursor: "pointer" }}
                        onClick={() => setCountPoints(prev => prev.filter(p => p.id !== cp.id))}>
                        <circle cx={px} cy={py} r={12} fill={color} fillOpacity={0.35} stroke={color} strokeWidth={2} />
                        <text x={px} y={py + 4} textAnchor="middle" fill="white" fontSize={9} fontWeight="700" fontFamily="monospace">{num}</text>
                        <text x={px + 16} y={py + 4} fill={color} fontSize={8} fontWeight="600" fontFamily="system-ui">{label}</text>
                      </g>
                    );
                  })}
                  {/* Legacy __count__ points (backward compat) */}
                  {zones.filter(z => z.typeId === "__count__").map((zone, i) => {
                    if (!zone.points || zone.points.length < 1) return null;
                    const px = zone.points[0].x * imageNatural.w;
                    const py = zone.points[0].y * imageNatural.h;
                    return (
                      <g key={zone.id}>
                        <circle cx={px} cy={py} r={8} fill="rgba(56,189,248,0.25)" stroke="#38bdf8" strokeWidth={1.5} />
                        <text x={px} y={py + 3.5} textAnchor="middle" fill="#38bdf8" fontSize={8} fontWeight="700" fontFamily="monospace">{i + 1}</text>
                      </g>
                    );
                  })}
                </svg>
              )}

              {/* ── Linear & Angle measurements (always visible when toggled) ── */}
              {showLinearMeasures && (linearMeasures.length > 0 || angleMeasures.length > 0) && imgDisplaySize.w > 0 && imageNatural.w > 0 && (
                <svg
                  className="absolute top-0 left-0"
                  width={imgDisplaySize.w}
                  height={imgDisplaySize.h}
                  viewBox={`0 0 ${imageNatural.w} ${imageNatural.h}`}
                  style={{ zIndex: 2, pointerEvents: "none" }}
                >
                  {/* Linear measurements */}
                  {linearMeasures.map(lm => {
                    const x1 = lm.p1.x * imageNatural.w, y1 = lm.p1.y * imageNatural.h;
                    const x2 = lm.p2.x * imageNatural.w, y2 = lm.p2.y * imageNatural.h;
                    const mx = (x1+x2)/2, my = (y1+y2)/2;
                    const distM = ppm ? lm.distPx / ppm : null;
                    const label = distM ? `${distM.toFixed(2)} m` : `${Math.round(lm.distPx)} px`;
                    const angle = Math.atan2(y2-y1, x2-x1) * 180 / Math.PI;
                    const rot = (angle > 90 || angle < -90) ? angle + 180 : angle;
                    return (
                      <g key={lm.id} style={{ pointerEvents: "all", cursor: "move" }}
                        onMouseDown={e => {
                          e.stopPropagation();
                          setSelectedMeasureId(lm.id); setSelectedMeasureType("linear");
                          const startX = e.clientX, startY = e.clientY;
                          const orig = { p1: {...lm.p1}, p2: {...lm.p2} };
                          const onMove = (ev: MouseEvent) => {
                            const img = imgRef.current;
                            if (!img) return;
                            const rect = img.getBoundingClientRect();
                            const dx = (ev.clientX - startX) / rect.width / zoom;
                            const dy = (ev.clientY - startY) / rect.height / zoom;
                            setLinearMeasures(prev => prev.map(m => m.id === lm.id ? { ...m, p1: {x:orig.p1.x+dx, y:orig.p1.y+dy}, p2: {x:orig.p2.x+dx, y:orig.p2.y+dy} } : m));
                          };
                          const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                          window.addEventListener("mousemove", onMove);
                          window.addEventListener("mouseup", onUp);
                        }}
                      >
                        {selectedMeasureId === lm.id && selectedMeasureType === "linear" && (
                          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#38bdf8" strokeWidth={5} opacity={0.3} />
                        )}
                        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#38bdf8" strokeWidth={2} strokeDasharray="4 2" />
                        <circle cx={x1} cy={y1} r={4} fill="#38bdf8" />
                        <circle cx={x2} cy={y2} r={4} fill="#38bdf8" />
                        <rect x={mx-25} y={my-8} width={50} height={16} rx={3} fill="rgba(10,16,32,0.92)" stroke="#38bdf8" strokeWidth={1} transform={`rotate(${rot},${mx},${my})`} />
                        <text x={mx} y={my+3.5} textAnchor="middle" fill="#38bdf8" fontSize={9} fontWeight="600" fontFamily="monospace" transform={`rotate(${rot},${mx},${my})`}>{label}</text>
                      </g>
                    );
                  })}
                  {/* Angle measurements */}
                  {angleMeasures.map(am => {
                    const vx = am.vertex.x * imageNatural.w, vy = am.vertex.y * imageNatural.h;
                    const ax = am.p1.x * imageNatural.w, ay = am.p1.y * imageNatural.h;
                    const cx = am.p3.x * imageNatural.w, cy = am.p3.y * imageNatural.h;
                    return (
                      <g key={am.id} style={{ pointerEvents: "all", cursor: "move" }}
                        onMouseDown={e => {
                          e.stopPropagation();
                          setSelectedMeasureId(am.id); setSelectedMeasureType("angle");
                          const startX = e.clientX, startY = e.clientY;
                          const origP1 = {...am.p1}, origV = {...am.vertex}, origP3 = {...am.p3};
                          const onMove = (ev: MouseEvent) => {
                            const img = imgRef.current;
                            if (!img) return;
                            const rect = img.getBoundingClientRect();
                            const dx = (ev.clientX - startX) / rect.width / zoom;
                            const dy = (ev.clientY - startY) / rect.height / zoom;
                            setAngleMeasures(prev => prev.map(a => a.id === am.id ? { ...a, p1: {x:origP1.x+dx, y:origP1.y+dy}, vertex: {x:origV.x+dx, y:origV.y+dy}, p3: {x:origP3.x+dx, y:origP3.y+dy} } : a));
                          };
                          const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                          window.addEventListener("mousemove", onMove);
                          window.addEventListener("mouseup", onUp);
                        }}
                      >
                        {selectedMeasureId === am.id && selectedMeasureType === "angle" && (
                          <circle cx={vx} cy={vy} r={20} fill="none" stroke="#f59e0b" strokeWidth={3} opacity={0.3} strokeDasharray="4 2" />
                        )}
                        <line x1={ax} y1={ay} x2={vx} y2={vy} stroke="#f59e0b" strokeWidth={1.5} />
                        <line x1={vx} y1={vy} x2={cx} y2={cy} stroke="#f59e0b" strokeWidth={1.5} />
                        <circle cx={vx} cy={vy} r={5} fill="#f59e0b" />
                        <circle cx={ax} cy={ay} r={3} fill="#f59e0b80" />
                        <circle cx={cx} cy={cy} r={3} fill="#f59e0b80" />
                        <text x={vx+12} y={vy-8} fill="#f59e0b" fontSize={10} fontWeight="700" fontFamily="monospace">{am.angleDeg.toFixed(1)}{"\u00B0"}</text>
                      </g>
                    );
                  })}
                </svg>
              )}

              {/* SVG overlay for count points — separate to allow pointer-events */}
              {imgDisplaySize.w > 0 && countPoints.length > 0 && (
                <svg
                  className="absolute top-0 left-0"
                  width={imgDisplaySize.w}
                  height={imgDisplaySize.h}
                  viewBox={`0 0 ${imgDisplaySize.w} ${imgDisplaySize.h}`}
                  style={{ zIndex: 3, pointerEvents: "none" }}
                >
                  {countPoints.filter(cp => countGroupVisibility[cp.groupId] !== false).map(cp => {
                    const grp = countGroups.find(g => g.id === cp.groupId);
                    const color = grp?.color ?? "#38bdf8";
                    const px = cp.x * imgDisplaySize.w;
                    const py = cp.y * imgDisplaySize.h;
                    const num = countPoints.filter(p => p.groupId === cp.groupId).indexOf(cp) + 1;
                    const label = grp?.name ?? "";
                    return (
                      <g key={cp.id} style={{ pointerEvents: "all", cursor: "move" }}
                        onMouseDown={e => {
                          e.stopPropagation();
                          const startX = e.clientX, startY = e.clientY;
                          const origX = cp.x, origY = cp.y;
                          const onMove = (ev: MouseEvent) => {
                            const img = imgRef.current;
                            if (!img) return;
                            const rect = img.getBoundingClientRect();
                            const dx = (ev.clientX - startX) / rect.width / zoom;
                            const dy = (ev.clientY - startY) / rect.height / zoom;
                            setCountPoints(prev => prev.map(p => p.id === cp.id ? { ...p, x: origX+dx, y: origY+dy } : p));
                          };
                          const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                          window.addEventListener("mousemove", onMove);
                          window.addEventListener("mouseup", onUp);
                        }}
                        onClick={e => e.stopPropagation()}>
                        <circle cx={px} cy={py} r={14} fill={color} fillOpacity={0.4} stroke={color} strokeWidth={2.5} />
                        <text x={px} y={py + 4.5} textAnchor="middle" fill="white" fontSize={10} fontWeight="800" fontFamily="monospace">{num}</text>
                        <rect x={px + 16} y={py - 8} width={label.length * 6 + 8} height={16} rx={4} fill="black" fillOpacity={0.7} style={{ pointerEvents: "none" }} />
                        <text x={px + 20} y={py + 4} fill={color} fontSize={9} fontWeight="700" fontFamily="system-ui" style={{ pointerEvents: "none" }}>{label}</text>
                      </g>
                    );
                  })}
                </svg>
              )}

              {/* ── SVG overlay: text annotations + circle measurements ── */}
              {imgDisplaySize.w > 0 && (textAnnotations.length > 0 || circleMeasures.length > 0) && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none"
                  viewBox={`0 0 ${imageNatural.w || imgDisplaySize.w} ${imageNatural.h || imgDisplaySize.h}`}
                  style={{ zIndex: 4 }}
                >
                  {/* Text annotations (draggable) */}
                  {textAnnotations.map(ta => {
                    const nw = imageNatural.w || imgDisplaySize.w;
                    const nh = imageNatural.h || imgDisplaySize.h;
                    const px = ta.x * nw;
                    const py = ta.y * nh;
                    const fs = ta.fontSize ?? 12;
                    const color = ta.color ?? "#38BDF8";
                    const w = ta.text.length * fs * 0.6 + 16;
                    return (
                      <g key={ta.id}
                        style={{ pointerEvents: "all", cursor: "move" }}
                        onMouseDown={e => {
                          e.stopPropagation();
                          setSelectedTextId(ta.id);
                          const startX = e.clientX, startY = e.clientY;
                          const origX = ta.x, origY = ta.y;
                          const onMove = (ev: MouseEvent) => {
                            const img = imgRef.current;
                            if (!img) return;
                            const rect = img.getBoundingClientRect();
                            const dx = (ev.clientX - startX) / rect.width / zoom;
                            const dy = (ev.clientY - startY) / rect.height / zoom;
                            setTextAnnotations(prev => prev.map(t => t.id === ta.id ? { ...t, x: origX + dx, y: origY + dy } : t));
                          };
                          const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                          window.addEventListener("mousemove", onMove);
                          window.addEventListener("mouseup", onUp);
                        }}
                        onDoubleClick={e => { e.stopPropagation(); setSelectedTextId(ta.id); setEditingTextId(ta.id); }}
                      >
                        {selectedTextId === ta.id && (
                          <rect x={px - 6} y={py - fs - 4} width={w + 4} height={fs + 14} rx={5}
                            fill="none" stroke="#38bdf8" strokeWidth={2} strokeDasharray="4 2" />
                        )}
                        <rect x={px - 4} y={py - fs - 2} width={w} height={fs + 10} rx={4}
                          fill="rgba(0,0,0,0.8)" stroke={color} strokeWidth={1} />
                        <text x={px + 4} y={py} fill={color} fontSize={fs}
                          fontFamily="system-ui" style={{ pointerEvents: "none" }}>{editingTextId === ta.id ? "" : ta.text}</text>
                        {editingTextId === ta.id && (
                          <foreignObject x={px - 2} y={py - fs - 1} width={Math.max(w, 120)} height={fs + 8}>
                            <input
                              autoFocus
                              defaultValue={ta.text}
                              style={{ background: "rgba(0,0,0,0.9)", color: color, border: `1px solid ${color}`, borderRadius: 4, padding: "1px 4px", fontSize: fs, fontFamily: "system-ui", width: "100%", outline: "none" }}
                              onKeyDown={(ev: React.KeyboardEvent<HTMLInputElement>) => {
                                ev.stopPropagation();
                                if (ev.key === "Enter") {
                                  const val = (ev.target as HTMLInputElement).value.trim();
                                  if (val) setTextAnnotations(prev => prev.map(t => t.id === ta.id ? { ...t, text: val } : t));
                                  else setTextAnnotations(prev => prev.filter(t => t.id !== ta.id));
                                  setEditingTextId(null);
                                }
                                if (ev.key === "Escape") setEditingTextId(null);
                              }}
                              onBlur={(ev) => {
                                const val = (ev.target as HTMLInputElement).value.trim();
                                if (val) setTextAnnotations(prev => prev.map(t => t.id === ta.id ? { ...t, text: val } : t));
                                setEditingTextId(null);
                              }}
                              onClick={(ev: React.MouseEvent) => ev.stopPropagation()}
                              onMouseDown={(ev: React.MouseEvent) => ev.stopPropagation()}
                            />
                          </foreignObject>
                        )}
                      </g>
                    );
                  })}
                  {/* Circle measurements */}
                  {circleMeasures.map(cm => {
                    const cmNw = imageNatural.w || imgDisplaySize.w;
                    const cmNh = imageNatural.h || imgDisplaySize.h;
                    const cx = cm.center.x * cmNw;
                    const cy = cm.center.y * cmNh;
                    const ex = cm.edgePoint.x * cmNw;
                    const ey = cm.edgePoint.y * cmNh;
                    const rSvg = Math.hypot(ex - cx, ey - cy);
                    const metrics = ppm ? circleMetrics(cm, imageNatural.w, imageNatural.h, ppm) : null;
                    const cLabel = metrics ? `r=${fmtLinear(metrics.radiusM)}` : "";
                    const clw = cLabel.length * 5.5 + 12;
                    return (
                      <g key={cm.id} style={{ pointerEvents: "all", cursor: "move" }}
                        onMouseDown={e => {
                          e.stopPropagation();
                          setSelectedMeasureId(cm.id); setSelectedMeasureType("circle");
                          const startX = e.clientX, startY = e.clientY;
                          const origCenter = {...cm.center}, origEdge = {...cm.edgePoint};
                          const onMove = (ev: MouseEvent) => {
                            const img = imgRef.current;
                            if (!img) return;
                            const rect = img.getBoundingClientRect();
                            const dx = (ev.clientX - startX) / rect.width / zoom;
                            const dy = (ev.clientY - startY) / rect.height / zoom;
                            setCircleMeasures(prev => prev.map(c => c.id === cm.id ? { ...c, center: {x:origCenter.x+dx, y:origCenter.y+dy}, edgePoint: {x:origEdge.x+dx, y:origEdge.y+dy} } : c));
                          };
                          const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                          window.addEventListener("mousemove", onMove);
                          window.addEventListener("mouseup", onUp);
                        }}
                      >
                        {selectedMeasureId === cm.id && selectedMeasureType === "circle" && (
                          <circle cx={cx} cy={cy} r={rSvg + 3} fill="none" stroke="#14B8A6" strokeWidth={3} opacity={0.3} strokeDasharray="4 2" />
                        )}
                        <circle cx={cx} cy={cy} r={rSvg}
                          fill="rgba(20,184,166,0.08)" stroke="#14B8A6" strokeWidth={2} />
                        <line x1={cx} y1={cy} x2={ex} y2={ey}
                          stroke="#14B8A6" strokeWidth={1} strokeDasharray="4 2" />
                        <circle cx={cx} cy={cy} r={3} fill="#14B8A6" />
                        <circle cx={ex} cy={ey} r={3} fill="#14B8A6" stroke="white" strokeWidth={1} />
                        {cLabel && (
                          <g transform={`translate(${cx}, ${cy - rSvg - 12})`}>
                            <rect x={-clw / 2} y={-8} width={clw} height={16} rx={3}
                              fill="rgba(0,0,0,0.78)" stroke="#14B8A6" strokeWidth={0.6} />
                            <text textAnchor="middle" dominantBaseline="middle"
                              fontSize={9} fill="#14B8A6" fontWeight="600" fontFamily="ui-monospace, monospace">
                              {cLabel}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}
                </svg>
              )}

              {/* Text input overlay */}
              {textInputPos && (() => {
                const px = textInputPos.x * imgDisplaySize.w;
                const py = textInputPos.y * imgDisplaySize.h;
                return (
                  <div className="absolute z-50 pointer-events-auto"
                    style={{ left: px, top: py }}>
                    <input
                      autoFocus
                      value={textInputValue}
                      onChange={e => setTextInputValue(e.target.value)}
                      onKeyDown={e => {
                        e.stopPropagation();
                        if (e.key === "Enter" && textInputValue.trim()) {
                          setTextAnnotations(prev => [...prev, {
                            id: crypto.randomUUID(),
                            x: textInputPos.x,
                            y: textInputPos.y,
                            text: textInputValue.trim(),
                            color: textColor,
                            fontSize: textFontSize,
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
                    <div className="flex items-center gap-1 mt-1">
                      <input type="color" value={textColor} onChange={e => setTextColor(e.target.value)}
                        onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                        className="w-5 h-5 rounded border-0 cursor-pointer p-0" />
                      <select value={textFontSize} onChange={e => setTextFontSize(Number(e.target.value))}
                        onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}
                        className="bg-black/90 border border-white/20 rounded px-1 py-0.5 text-[10px] text-white">
                        <option value={8}>8px</option>
                        <option value={10}>10px</option>
                        <option value={12}>12px</option>
                        <option value={16}>16px</option>
                        <option value={20}>20px</option>
                      </select>
                    </div>
                  </div>
                );
              })()}

              {/* Circle in-progress preview */}
              {tool === "circle" && circleCenter && imgDisplaySize.w > 0 && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none"
                  viewBox={`0 0 ${imgDisplaySize.w} ${imgDisplaySize.h}`}
                  style={{ zIndex: 4 }}>
                  <circle
                    cx={circleCenter.x * imgDisplaySize.w}
                    cy={circleCenter.y * imgDisplaySize.h}
                    r={4} fill="#14B8A6" stroke="white" strokeWidth={1.5} />
                </svg>
              )}

              {/* SVG overlay: shows every opening bbox + number, highlights selected */}
              {showOpeningOverlay && imgDisplaySize.w > 0 && imageNatural.w > 0 && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 5 }}>
                  {result.openings?.map((o, i) => {
                    const scx = imgDisplaySize.w / imageNatural.w;
                    const scy = imgDisplaySize.h / imageNatural.h;
                    const bx = o.x_px * scx;
                    const by = o.y_px * scy;
                    const bw = o.width_px * scx;
                    const bh = o.height_px * scy;
                    const isSelected = selectedOpeningIdx === i;
                    const color = o.class === "door" ? "#D946EF" : "#22D3EE";
                    const cx = bx + bw / 2;
                    const cy = by + bh / 2;
                    return (
                      <g key={i} opacity={isSelected ? 1 : 0.45}>
                        {/* Bounding box */}
                        <rect x={bx} y={by} width={bw} height={bh}
                          fill={color + (isSelected ? "22" : "0A")}
                          stroke={color}
                          strokeWidth={isSelected ? 2.5 : 1.5}
                          strokeDasharray={isSelected ? undefined : "5 3"}
                        />
                        {/* Number badge */}
                        <rect x={cx - 12} y={cy - 9} width={24} height={18} rx={4} fill="rgba(0,0,0,0.80)" />
                        <text x={cx} y={cy}
                          textAnchor="middle" dominantBaseline="central"
                          fill={color}
                          fontSize={isSelected ? 12 : 10}
                          fontWeight={isSelected ? "bold" : "normal"}
                          fontFamily="monospace"
                        >{i + 1}</text>
                        {/* Selection glow ring */}
                        {isSelected && (
                          <rect x={bx - 3} y={by - 3} width={bw + 6} height={bh + 6} rx={3}
                            fill="none" stroke={color} strokeWidth={1} opacity={0.35} />
                        )}
                      </g>
                    );
                  })}
                </svg>
              )}

              {/* ── Interactive vertex editing layer (above canvas when active) ── */}
              {vertexEditActive && imgDisplaySize.w > 0 && (() => {
                const selRoom = displayRooms.find(r => r.id === selectedRoomId);
                if (!selRoom?.polygon_norm) return null;
                const rcolor = getRoomColor(selRoom.type);
                return (
                  <svg
                    className="absolute top-0 left-0"
                    width={imgDisplaySize.w}
                    height={imgDisplaySize.h}
                    viewBox={`0 0 ${imgDisplaySize.w} ${imgDisplaySize.h}`}
                    style={{ zIndex: 15, cursor: dragRoomVertex ? "grabbing" : "default" }}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return; // ignore right-click (used for pan)
                      // Background click: select another room or deselect
                      const rect = e.currentTarget.getBoundingClientRect();
                      const normX = (e.clientX - rect.left) / rect.width;
                      const normY = (e.clientY - rect.top) / rect.height;
                      for (const r of displayRooms) {
                        if (r.polygon_norm && pointInPolygon(normX, normY, r.polygon_norm)) {
                          // Shift+click: merge rooms
                          if (e.shiftKey && selectedRoomId !== null && r.id !== selectedRoomId) {
                            sendEditRoom({ action: "merge_rooms", room_id: selectedRoomId, room_id_b: r.id });
                            return;
                          }
                          setSelectedRoomId(r.id);
                          setEditingRoomId(r.id);
                          setActiveRoomType(r.type);
                          return;
                        }
                      }
                      setSelectedRoomId(null);
                      setEditingRoomId(null);
                    }}
                  >
                    {/* ── Polygon fill + stroke (rendered here so it updates in sync with vertex drag) ── */}
                    {(() => {
                      const polyPoints = selRoom.polygon_norm!
                        .map(p => `${p.x * imgDisplaySize.w},${p.y * imgDisplaySize.h}`)
                        .join(" ");
                      const bboxW = selRoom.bbox_norm.w * imgDisplaySize.w;
                      const bboxH = selRoom.bbox_norm.h * imgDisplaySize.h;
                      const minDim = Math.min(bboxW, bboxH);
                      const fs = Math.max(1, Math.min(2, minDim * 0.024));
                      const rcx = selRoom.centroid_norm.x * imgDisplaySize.w;
                      const rcy = selRoom.centroid_norm.y * imgDisplaySize.h;

                      const perimM = selRoom.perimeter_m != null ? selRoom.perimeter_m
                        : (selRoom.polygon_norm && ppm && imageNatural.w > 0
                          ? polygonPerimeterM(selRoom.polygon_norm, imageNatural.w, imageNatural.h, ppm)
                          : null);
                      const areaStr = selRoom.area_m2 != null ? `${selRoom.area_m2.toFixed(1)} m²` : "";
                      const perimStr = perimM != null ? `P ${perimM.toFixed(1)} m` : "";
                      const measLine = areaStr && perimStr ? `${areaStr} · ${perimStr}` : areaStr;
                      const nameFontSize = fs + 1;
                      const measFontSize = Math.max(3, fs);
                      const hasMeas = measLine.length > 0;
                      const nameWidth = Math.max(50, selRoom.label_fr.length * (nameFontSize * 0.62));
                      const measWidth = hasMeas ? Math.max(40, measLine.length * (measFontSize * 0.6)) : 0;
                      const pw = Math.max(nameWidth, measWidth) + 12;
                      const ph = hasMeas ? nameFontSize + measFontSize + 8 : nameFontSize + 6;

                      return (
                        <g>
                          {/* Filled polygon */}
                          <polygon
                            points={polyPoints}
                            fill={rcolor + "30"}
                            stroke={rcolor}
                            strokeWidth={2.5}
                            strokeLinejoin="round"
                          />
                          {/* Dashed selection highlight */}
                          <polygon
                            points={polyPoints}
                            fill={rcolor + "18"}
                            stroke={rcolor}
                            strokeWidth={3}
                            strokeDasharray="6 3"
                            strokeLinejoin="round"
                          />
                          {/* Edge dimension annotations */}
                          {ppm && imageNatural.w > 0 && selRoom.polygon_norm!.map((p, ei) => {
                            const next = selRoom.polygon_norm![(ei + 1) % selRoom.polygon_norm!.length];
                            const x1 = p.x * imgDisplaySize.w, y1 = p.y * imgDisplaySize.h;
                            const x2 = next.x * imgDisplaySize.w, y2 = next.y * imgDisplaySize.h;
                            const edgeLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
                            if (edgeLen < 30) return null;
                            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
                            const lenM = edgeLengthM(p, next, imageNatural.w, imageNatural.h, ppm);
                            const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
                            const rot = (angle > 90 || angle < -90) ? angle + 180 : angle;
                            const nx = -(y2 - y1) / edgeLen * 8;
                            const ny = (x2 - x1) / edgeLen * 8;
                            const tx = mx + nx, ty = my + ny;
                            const dimText = lenM.toFixed(2) + " m";
                            const tw = dimText.length * 5.5 + 6;
                            return (
                              <g key={`dim-${ei}`}>
                                <rect x={tx - tw / 2} y={ty - 6} width={tw} height={12} rx={2}
                                  fill="rgba(10,16,32,0.85)"
                                  transform={`rotate(${rot},${tx},${ty})`} />
                                <text x={tx} y={ty + 3} textAnchor="middle" fill="#e2e8f0"
                                  fontSize={6} fontFamily="monospace" fontWeight="600"
                                  transform={`rotate(${rot},${tx},${ty})`}
                                >{dimText}</text>
                              </g>
                            );
                          })}
                          {/* Label: room name + measurements */}
                          <rect x={rcx - pw / 2} y={rcy - ph / 2} width={pw} height={ph} rx={4}
                            fill="rgba(10,16,32,0.92)" stroke={rcolor} strokeWidth={1.5} />
                          <text x={rcx} y={hasMeas ? rcy - ph / 2 + nameFontSize + 2 : rcy + nameFontSize * 0.35}
                            textAnchor="middle" fill={rcolor} fontSize={nameFontSize}
                            fontWeight="700" fontFamily="system-ui,sans-serif"
                          >{selRoom.label_fr}</text>
                          {hasMeas && (
                            <text x={rcx} y={rcy - ph / 2 + nameFontSize + measFontSize + 5}
                              textAnchor="middle" fill="#94a3b8" fontSize={measFontSize}
                              fontWeight="500" fontFamily="monospace"
                            >{measLine}</text>
                          )}
                        </g>
                      );
                    })()}

                    {/* Vertex handles — large hit targets + visible handles (like manual survey) */}
                    {selRoom.polygon_norm.map((p, idx) => {
                      const isDragging = dragRoomVertex?.roomId === selRoom.id && dragRoomVertex?.idx === idx;
                      const isSnapped = isDragging && snappedVertex;
                      const cx = p.x * imgDisplaySize.w;
                      const cy = p.y * imgDisplaySize.h;
                      // Snap-type-aware colors
                      const snapFill = isDragging && snapResult?.snapType === "vertex" ? "#22d3ee"
                        : isDragging && snapResult?.snapType === "grid" ? "#10b981"
                        : isDragging && snapResult?.snapType === "midpoint" ? "#f59e0b"
                        : isDragging && (snapResult?.snapType === "align_h" || snapResult?.snapType === "align_v") ? "#a78bfa"
                        : isSnapped ? "#f97316"
                        : null;
                      const snapStroke = isDragging && snapResult?.snapType === "vertex" ? "#0891b2"
                        : isDragging && snapResult?.snapType === "grid" ? "#059669"
                        : isDragging && snapResult?.snapType === "midpoint" ? "#d97706"
                        : isDragging && (snapResult?.snapType === "align_h" || snapResult?.snapType === "align_v") ? "#7c3aed"
                        : isSnapped ? "#ea580c"
                        : null;
                      return (
                      <g key={`v-${idx}`} className="group/vtx">
                        {/* Invisible large hit area for easier targeting */}
                        <circle cx={cx} cy={cy} r={14} fill="transparent"
                          style={{ cursor: dragRoomVertex ? "grabbing" : "grab", pointerEvents: "all" }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            dragRoomVertexRef.current = { roomId: selRoom.id, idx };
                            setDragRoomVertex({ roomId: selRoom.id, idx });
                            localRoomsRef.current = displayRooms;
                            setLocalRooms(displayRooms);
                          }}
                          onContextMenu={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            if (selRoom.polygon_norm!.length <= 3) {
                              sendEditRoom({ action: "delete_room", room_id: selRoom.id });
                              return;
                            }
                            const newPoly = selRoom.polygon_norm!.filter((_, i) => i !== idx);
                            sendEditRoom({
                              action: "replace_polygon",
                              room_id: selRoom.id,
                              room_type: selRoom.type,
                              polygon_norm: newPoly,
                            });
                          }}
                        />
                        {/* Visible handle — color-coded by snap type */}
                        <circle cx={cx} cy={cy}
                          r={isDragging ? 9 : isSnapped ? 8 : 7}
                          fill={snapFill ?? (isDragging ? rcolor : "white")}
                          stroke={snapStroke ?? rcolor}
                          strokeWidth={isDragging ? 3 : 2}
                          style={{ pointerEvents: "none", transition: "r 0.1s, fill 0.1s" }}
                          className="group-hover/vtx:fill-current"
                        />
                        {/* Hover glow ring */}
                        <circle cx={cx} cy={cy} r={11}
                          fill="none" stroke={rcolor} strokeWidth={1} opacity={0}
                          style={{ pointerEvents: "none", transition: "opacity 0.15s" }}
                          className="group-hover/vtx:opacity-40"
                        />
                      </g>
                      );
                    })}
                    {/* Edge midpoints — click to insert vertex */}
                    {!dragRoomVertex && selRoom.polygon_norm.map((p, idx) => {
                      const next = selRoom.polygon_norm![(idx + 1) % selRoom.polygon_norm!.length];
                      const mx = (p.x + next.x) / 2;
                      const my = (p.y + next.y) / 2;
                      return (
                        <g key={`mid-${idx}`} className="group/mid opacity-40 hover:opacity-100 transition-opacity">
                          {/* Larger hit area */}
                          <circle
                            cx={mx * imgDisplaySize.w}
                            cy={my * imgDisplaySize.h}
                            r={12}
                            fill="transparent"
                            style={{ cursor: "copy", pointerEvents: "all" }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              const newPoly = [...selRoom.polygon_norm!];
                              newPoly.splice(idx + 1, 0, { x: mx, y: my });
                              const updated = displayRooms.map(r =>
                                r.id !== selRoom.id ? r : { ...r, polygon_norm: newPoly }
                              );
                              localRoomsRef.current = updated;
                              setLocalRooms(updated);
                              dragRoomVertexRef.current = { roomId: selRoom.id, idx: idx + 1 };
                              setDragRoomVertex({ roomId: selRoom.id, idx: idx + 1 });
                            }}
                          />
                          {/* Visible dot */}
                          <circle
                            cx={mx * imgDisplaySize.w}
                            cy={my * imgDisplaySize.h}
                            r={6}
                            className="svg-handle"
                            fill="white"
                            stroke={rcolor}
                            strokeWidth={1.5}
                            style={{ pointerEvents: "none" }}
                          />
                          <text
                            x={mx * imgDisplaySize.w}
                            y={my * imgDisplaySize.h + 0.5}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fontSize={9}
                            fill={rcolor}
                            fontWeight="bold"
                            style={{ pointerEvents: "none" }}
                          >+</text>
                        </g>
                      );
                    })}
                  </svg>
                );
              })()}

              {/* ── Snap guide lines overlay ── */}
              {snapResult && snapResult.guides.length > 0 && imgDisplaySize.w > 0 && (
                <svg
                  className="absolute top-0 left-0 pointer-events-none"
                  width={imgDisplaySize.w}
                  height={imgDisplaySize.h}
                  viewBox={`0 0 ${imgDisplaySize.w} ${imgDisplaySize.h}`}
                  style={{ zIndex: 16 }}
                >
                  {snapResult.guides.map((guide, i) => (
                    guide.type === "point" ? (
                      <g key={`guide-${i}`}>
                        <circle
                          cx={guide.x1 * imgDisplaySize.w}
                          cy={guide.y1 * imgDisplaySize.h}
                          r={12} fill="none"
                          stroke={guide.color} strokeWidth={2}
                          strokeDasharray="3 2" opacity={0.7}
                        />
                        <circle
                          cx={guide.x1 * imgDisplaySize.w}
                          cy={guide.y1 * imgDisplaySize.h}
                          r={4} fill={guide.color} opacity={0.5}
                        />
                      </g>
                    ) : (
                      <line key={`guide-${i}`}
                        x1={guide.x1 * imgDisplaySize.w}
                        y1={guide.y1 * imgDisplaySize.h}
                        x2={guide.x2 * imgDisplaySize.w}
                        y2={guide.y2 * imgDisplaySize.h}
                        stroke={guide.color}
                        strokeWidth={1}
                        strokeDasharray={guide.type === "horizontal" || guide.type === "vertical" ? "4 3" : "none"}
                        opacity={0.7}
                      />
                    )
                  ))}
                  {snapResult.snapLabel && (
                    <text
                      x={snapResult.x * imgDisplaySize.w + 16}
                      y={snapResult.y * imgDisplaySize.h - 10}
                      fill={snapResult.guides[0]?.color ?? "#22d3ee"}
                      fontSize={9}
                      fontFamily="system-ui, sans-serif"
                      fontWeight="600"
                    >
                      {snapResult.snapLabel}
                    </text>
                  )}
                </svg>
              )}

              {/* ── Grid overlay (when grid snap is enabled and editing rooms) ── */}
              {snapConfig.enableGrid && layer === "rooms" && editingRoomId != null && imgDisplaySize.w > 0 && (
                <svg
                  className="absolute top-0 left-0 pointer-events-none"
                  width={imgDisplaySize.w}
                  height={imgDisplaySize.h}
                  viewBox={`0 0 ${imgDisplaySize.w} ${imgDisplaySize.h}`}
                  style={{ zIndex: 1 }}
                >
                  <defs>
                    <pattern id="snap-grid-pattern"
                      width={snapConfig.gridSpacingNorm * imgDisplaySize.w}
                      height={snapConfig.gridSpacingNorm * imgDisplaySize.h}
                      patternUnits="userSpaceOnUse"
                    >
                      <circle cx={1} cy={1} r={0.8} fill="rgba(16,185,129,0.18)" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#snap-grid-pattern)" />
                </svg>
              )}

              {/* ── Visual search overlay: matches + saved detections + selection rect ── */}
              {imgDisplaySize.w > 0 && (vsMatches.length > 0 || vsCrop || customDetections.length > 0) && (
                <svg
                  className="absolute top-0 left-0 pointer-events-none"
                  width={imgDisplaySize.w}
                  height={imgDisplaySize.h}
                  viewBox={`0 0 ${imgDisplaySize.w} ${imgDisplaySize.h}`}
                  style={{ zIndex: 12 }}
                >
                  {/* Saved custom detections */}
                  {customDetections.map((det) =>
                    det.matches.map((m, i) => (
                      <rect
                        key={`${det.id}-${i}`}
                        x={m.x_norm * imgDisplaySize.w}
                        y={m.y_norm * imgDisplaySize.h}
                        width={m.w_norm * imgDisplaySize.w}
                        height={m.h_norm * imgDisplaySize.h}
                        fill={det.color + "25"}
                        stroke={det.color}
                        strokeWidth={2}
                        rx={2}
                      />
                    ))
                  )}
                  {/* Current search match results */}
                  {vsMatches.map((m, i) => {
                    const W = imageNatural.w || 1;
                    const H = imageNatural.h || 1;
                    const wpx = m.w_norm * W;
                    const hpx = m.h_norm * H;
                    const areaLabel = ppm ? `${(wpx * hpx / (ppm * ppm)).toFixed(2)} m²` : `${Math.round(wpx * hpx)} px²`;
                    return (
                      <g key={i}>
                        <rect
                          x={m.x_norm * imgDisplaySize.w}
                          y={m.y_norm * imgDisplaySize.h}
                          width={m.w_norm * imgDisplaySize.w}
                          height={m.h_norm * imgDisplaySize.h}
                          fill="rgba(251, 146, 60, 0.20)"
                          stroke="#F97316"
                          strokeWidth={2}
                          rx={2}
                        />
                        <text
                          x={m.x_norm * imgDisplaySize.w + 3}
                          y={m.y_norm * imgDisplaySize.h - 4}
                          fontSize={9}
                          fill="#F97316"
                          fontWeight="bold"
                        >{areaLabel}</text>
                      </g>
                    );
                  })}
                  {/* Selection rectangle (while drawing) */}
                  {vsCrop && vsCrop.w > 0 && vsCrop.h > 0 && (
                    <rect
                      x={vsCrop.x / 100 * imgDisplaySize.w}
                      y={vsCrop.y / 100 * imgDisplaySize.h}
                      width={vsCrop.w / 100 * imgDisplaySize.w}
                      height={vsCrop.h / 100 * imgDisplaySize.h}
                      fill="rgba(34, 211, 238, 0.08)"
                      stroke="#22D3EE"
                      strokeWidth={2}
                      strokeDasharray="6 3"
                    />
                  )}
                </svg>
              )}

              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full"
                style={{ cursor: tool === "visual_search" ? "crosshair" : tool === "select" ? "default" : "crosshair", zIndex: tool === "split" ? 20 : (tool === "visual_search" ? 20 : 10), pointerEvents: canvasInteractive ? "auto" : "none" }}
                onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
                onDoubleClick={() => {
                  if (selectedTextId) {
                    setEditingTextId(selectedTextId);
                  }
                }} />
              </div>{/* /inner relative wrapper */}
              </div>{/* /transform wrapper */}
            </div>
            <p className="text-xs text-slate-600">
              {d("ed_canvas_hint")}
              {" · "}
              <span className="text-slate-700">{d("ed_canvas_zoom")}</span>
              {zoom > 1.05 && <span className="text-slate-500 font-mono ml-1">×{zoom.toFixed(1)}</span>}
            </p>

          </div>

          {/* \u2550\u2550 RIGHT SIDEBAR \u2550\u2550 */}
          <div className="w-[280px] shrink-0 flex flex-col gap-1.5 overflow-hidden">
            <div className="flex glass border border-white/10 rounded-lg p-0.5 gap-0.5 shrink-0">
              {([
                { id: "results" as const, label: d("ed_ia_results") },
                { id: "rooms" as const, label: d("ed_rooms") },
                { id: "visibility" as const, label: d("ed_openings_det") },
              ]).map(tab => (
                <button key={tab.id} onClick={() => setSidebarTab(tab.id)}
                  className={cn("flex-1 px-2 py-1.5 rounded-md text-[10px] font-600 transition-colors text-center truncate",
                    sidebarTab === tab.id ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300")}>
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-0.5">
              {/* RESULTS TAB */}
              {sidebarTab === "results" && (
                <>
                  <div className="glass rounded-xl border border-white/10 p-4">
                    <p className="text-xs font-mono text-accent uppercase tracking-widest mb-3">{d("ed_ia_results")}</p>
                    <div className="flex flex-col gap-2 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-1.5 text-slate-400">
                          <DoorOpen className="w-3.5 h-3.5 text-purple-400" />{d("ed_doors")}
                        </span>
                        <span className="font-700 text-purple-400">{result.doors_count}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-1.5 text-slate-400">
                          <AppWindow className="w-3.5 h-3.5 text-cyan-400" />{d("ed_windows")}
                        </span>
                        <span className="font-700 text-cyan-400">{result.windows_count}</span>
                      </div>
                      <div className="border-t border-white/5 my-1" />
                      <div className="flex justify-between">
                        <span className="text-slate-500">{d("ed_living_s")}</span>
                        <span className="font-700 text-emerald-400">{sf.area_hab_m2 ? sf.area_hab_m2.toFixed(1) + " m\u00b2" : "\u2014"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">{d("ed_footprint")}</span>
                        <span className="font-700 text-blue-400">{sf.area_building_m2 ? sf.area_building_m2.toFixed(1) + " m\u00b2" : "\u2014"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">{d("ed_walls_s")}</span>
                        <span className="font-700 text-slate-300">{sf.area_walls_m2 ? sf.area_walls_m2.toFixed(1) + " m\u00b2" : "\u2014"}</span>
                      </div>
                    </div>
                  </div>
                  {customDetections.length > 0 && (
                    <div className="glass rounded-xl border border-white/10 p-4">
                      <p className="text-xs font-mono text-amber-400 uppercase tracking-widest mb-3">{d("vs_detections")}</p>
                      <div className="flex flex-col gap-2">
                        {customDetections.map((det) => (
                          <div key={det.id} className="flex items-center justify-between group">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: det.color }} />
                              <span className="text-sm text-white truncate">{det.label}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-600 text-slate-300">\u00d7{det.count}</span>
                              {det.total_area_m2 !== null && (
                                <span className="text-xs text-slate-500">{det.total_area_m2.toFixed(2)} m\u00b2</span>
                              )}
                              <button onClick={() => setCustomDetections(prev => prev.filter(d => d.id !== det.id))}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-600 hover:text-red-400 transition-all"
                                title={d("vs_delete")}><Trash2 className="w-3 h-3" /></button>
                            </div>
                          </div>
                        ))}
                        <div className="border-t border-white/5 mt-1 pt-2 flex justify-between text-xs">
                          <span className="text-slate-500">{d("vs_area")}</span>
                          <span className="font-600 text-amber-400">
                            {(() => {
                              const total = customDetections.reduce((s, d) => s + (d.total_area_m2 ?? 0), 0);
                              const hasScale = customDetections.some(d => d.total_area_m2 !== null);
                              return hasScale ? `${total.toFixed(2)} m\u00b2` : "\u2014";
                            })()}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                  {zones.length > 0 && (
                    <div className="glass rounded-xl border border-white/10 p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <PaintBucket className="w-3.5 h-3.5 text-violet-400" />
                        <span className="text-xs font-600 text-slate-400 uppercase tracking-wide">Surfaces</span>
                        <span className="text-[10px] font-mono text-violet-400">{zones.filter(z => z.typeId !== "__count__").length} zones</span>
                      </div>
                      <button onClick={() => setShowSurfaces(v => !v)}
                        className="glass border border-white/10 rounded-lg p-1 text-slate-400 hover:text-white transition-colors">
                        {showSurfaces ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* ROOMS TAB */}
              {sidebarTab === "rooms" && displayRooms.length > 0 && (
                <div className="glass rounded-xl border border-white/10 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-600 text-slate-400 uppercase tracking-wide">{d("ed_rooms_det")}</h3>
                    <button onClick={() => setShowRooms(v => !v)} className="glass border border-white/10 rounded-lg p-1 text-slate-400 hover:text-white transition-colors">
                      {showRooms ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <div className="flex flex-col gap-1.5 max-h-[60vh] overflow-y-auto pr-0.5">
                    {displayRooms.map(room => {
                      const isSelected = selectedRoomId === room.id;
                      const rcolor = getRoomColor(room.type);
                      const rPerim = room.perimeter_m != null ? room.perimeter_m
                        : (room.polygon_norm && ppm && imageNatural.w > 0
                          ? polygonPerimeterM(room.polygon_norm, imageNatural.w, imageNatural.h, ppm)
                          : null);
                      return (
                        <div key={room.id}
                          className={cn("rounded-xl border transition-all",
                            isSelected ? "border-emerald-500/40 bg-emerald-500/10" : "border-white/5 glass")}>
                          <div onClick={() => { setSelectedRoomId(id => id === room.id ? null : room.id); setEditingRoomId(room.id); setActiveRoomType(room.type); }}
                            className="flex items-center gap-2.5 px-3 pt-2.5 pb-1 cursor-pointer group">
                            <span className="w-3.5 h-3.5 rounded-full ring-1 ring-white/20 shrink-0" style={{ background: rcolor }} />
                            <input
                              value={room.label_fr}
                              onChange={e => {
                                const newLabel = e.target.value;
                                setResult(prev => ({
                                  ...prev,
                                  rooms: (prev.rooms ?? []).map(r => r.id === room.id ? { ...r, label_fr: newLabel } : r),
                                }));
                              }}
                              onClick={e => e.stopPropagation()}
                              className={cn("text-sm font-medium flex-1 truncate bg-transparent border-none outline-none focus:ring-1 focus:ring-emerald-500/40 rounded px-1 -ml-1",
                                isSelected ? "text-white" : "text-slate-300")}
                            />
                            <div className="flex flex-col items-end gap-0">
                              <span className="text-xs text-slate-400 font-mono">{room.area_m2 != null ? `${room.area_m2.toFixed(2)} m\u00b2` : "\u2014"}</span>
                              {rPerim != null && (<span className="text-[10px] text-slate-600 font-mono">P {rPerim.toFixed(1)} m</span>)}
                            </div>
                            <button onClick={e => { e.stopPropagation(); sendEditRoom({ action: "delete_room", room_id: room.id }); }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-red-400 ml-0.5"
                              title={d("ed_delete_room")}><Trash2 className="w-3 h-3" /></button>
                          </div>
                          {isSelected && (
                            <div className="px-3 pb-2.5 pt-1 flex flex-col gap-2" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] text-slate-600 uppercase tracking-wide mr-0.5">{d("ed_type")}:</span>
                                {ROOM_TYPES.map(rt => (
                                  <button key={rt.type} onClick={() => updateRoomLabel(room.id, rt.type, d(rt.i18nKey))}
                                    title={d(rt.i18nKey)}
                                    className={cn("w-5 h-5 rounded-full border-2 transition-all shrink-0",
                                      room.type === rt.type ? "border-white scale-110" : "border-transparent opacity-60 hover:opacity-100")}
                                    style={{ background: getRoomColor(rt.type) }} />
                                ))}
                              </div>
                              {/* Type de sol */}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] text-slate-600 uppercase tracking-wide mr-0.5">{d("ed_floor_type" as DTKey)}</span>
                                <select
                                  value={room.surfaceTypeId ?? ""}
                                  title="Assigner un type de revêtement de sol à cette pièce. Une zone de surface sera automatiquement créée à partir du contour de la pièce."
                                  onChange={e => {
                                    const stId = e.target.value || undefined;
                                    setResult(prev => ({
                                      ...prev,
                                      rooms: (prev.rooms ?? []).map(r => {
                                        if (r.id !== room.id) return r;
                                        // Remove old linked zone
                                        if (r.linkedZoneId) {
                                          setZones(zp => zp.filter(z => z.id !== r.linkedZoneId));
                                        }
                                        if (!stId || !r.polygon_norm) return { ...r, surfaceTypeId: stId, linkedZoneId: undefined };
                                        // Create new linked zone from room polygon
                                        const zoneId = crypto.randomUUID();
                                        const newZone: MeasureZone = {
                                          id: zoneId,
                                          typeId: stId,
                                          points: r.polygon_norm.map(p => ({ x: p.x, y: p.y })),
                                          name: `auto:room:${r.id}`,
                                        };
                                        setZones(zp => [...zp.filter(z => z.id !== r.linkedZoneId), newZone]);
                                        return { ...r, surfaceTypeId: stId, linkedZoneId: zoneId };
                                      }),
                                    }));
                                  }}
                                  className="text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-slate-300 focus:outline-none focus:ring-1 focus:ring-violet-400/50"
                                >
                                  <option value="" style={{ background: "#1e293b" }}>— Aucun —</option>
                                  {surfaceTypes.map(st => (
                                    <option key={st.id} value={st.id} style={{ background: "#1e293b" }}>
                                      {st.name}
                                    </option>
                                  ))}
                                </select>
                                {room.surfaceTypeId && (() => {
                                  const st = surfaceTypes.find(s => s.id === room.surfaceTypeId);
                                  return st ? <span className="w-3 h-3 rounded-full shrink-0" style={{ background: st.color }} /> : null;
                                })()}
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <button onClick={() => toast({ title: d("ed_mode_merge"), description: d("ed_mode_merge_d"), variant: "default" })}
                                  className="flex items-center gap-1 px-2 py-1 rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors text-[10px]">
                                  <Merge className="w-2.5 h-2.5" /> {d("ed_merge")}
                                </button>
                                <button onClick={() => { setTool("split"); pts.current = []; toast({ title: d("ed_mode_split"), description: d("ed_mode_split_d"), variant: "default" }); }}
                                  className={cn("flex items-center gap-1 px-2 py-1 rounded-lg border transition-colors text-[10px]",
                                    tool === "split" ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-red-500/30 text-red-400 hover:bg-red-500/10")}>
                                  <Scissors className="w-2.5 h-2.5" /> {d("ed_split")}
                                </button>
                                <span className="text-[9px] text-slate-600 ml-auto">{d("ed_shift_merge")}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {displayRooms.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-white/5 flex flex-col gap-1">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">{d("ed_total_area")}</span>
                        <span className="font-mono text-sm text-white font-600">
                          {(() => { const total = displayRooms.reduce((s, r) => s + (r.area_m2 ?? 0), 0); return total > 0 ? `${total.toFixed(2)} m\u00b2` : "\u2014"; })()}
                        </span>
                      </div>
                      {ppm && (
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-slate-500">{d("ed_total_perim")}</span>
                          <span className="font-mono text-xs text-slate-400">
                            {(() => { const total = displayRooms.reduce((s, r) => { const p = r.perimeter_m != null ? r.perimeter_m : (r.polygon_norm && imageNatural.w > 0 ? polygonPerimeterM(r.polygon_norm, imageNatural.w, imageNatural.h, ppm) : 0); return s + (p ?? 0); }, 0); return total > 0 ? `${total.toFixed(1)} m` : "\u2014"; })()}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">{d("ed_rooms")}</span>
                        <span className="font-mono text-xs text-emerald-400 font-600">{displayRooms.length}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* SURFACE TYPES PANEL */}
              {layer === "surface" && (
                <div className="glass rounded-xl border border-white/10 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-600 text-slate-400 uppercase tracking-wide">{d("sf_surfaces")}</h3>
                    <span className="text-[10px] text-slate-600 font-mono">{zones.filter(z => z.typeId !== "__count__").length} zones</span>
                  </div>
                  <div className="flex flex-col gap-1.5 max-h-[40vh] overflow-y-auto pr-0.5">
                    {surfaceTypes.map(st => {
                      const isActive = activeTypeId === st.id;
                      const stZones = zones.filter(z => z.typeId === st.id);
                      const totalArea = stZones.reduce((sum, z) => {
                        const a = polygonAreaNorm(z.points, imageNatural.w, imageNatural.h);
                        return sum + (ppm ? a / (ppm * ppm) : a);
                      }, 0);
                      const isCustom = !DEFAULT_SURFACE_TYPES.some(d => d.id === st.id);
                      return (
                        <div key={st.id}
                          onClick={() => setActiveTypeId(st.id)}
                          className={cn("flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-all border",
                            isActive ? "border-white/30 bg-white/10" : "border-white/5 hover:bg-white/5")}>
                          <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: st.color }} />
                          <span className={cn("text-xs flex-1 truncate", isActive ? "text-white font-medium" : "text-slate-400")}>{st.name}</span>
                          <span className="text-[10px] text-slate-500 font-mono shrink-0">
                            {ppm ? `${totalArea.toFixed(2)} m\u00b2` : stZones.length > 0 ? `${stZones.length}` : ""}
                          </span>
                          {isCustom && (
                            <button onClick={(e) => {
                              e.stopPropagation();
                              setSurfaceTypes(prev => prev.filter(t => t.id !== st.id));
                              setZones(prev => prev.filter(z => z.typeId !== st.id));
                              if (activeTypeId === st.id) setActiveTypeId(surfaceTypes[0]?.id || DEFAULT_SURFACE_TYPES[0].id);
                            }}
                              className="opacity-0 group-hover:opacity-100 hover:!opacity-100 text-slate-600 hover:text-red-400 transition-all ml-0.5 shrink-0"
                              title="Supprimer"><Trash2 className="w-3 h-3" /></button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Add custom surface type */}
                  <div className="mt-2 pt-2 border-t border-white/5">
                    <details className="group">
                      <summary className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 cursor-pointer transition-colors">
                        <Plus className="w-3 h-3" /> {d("sf_add_type")}
                      </summary>
                      <div className="mt-2 flex items-center gap-1.5">
                        <input type="text" placeholder={d("sf_custom_name")} id="sf-custom-name"
                          className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-white/30" />
                        <input type="color" defaultValue="#8b5cf6" id="sf-custom-color"
                          className="w-7 h-7 rounded border border-white/10 bg-transparent cursor-pointer" />
                        <button onClick={() => {
                          const nameEl = document.getElementById("sf-custom-name") as HTMLInputElement;
                          const colorEl = document.getElementById("sf-custom-color") as HTMLInputElement;
                          const name = nameEl?.value?.trim();
                          const color = colorEl?.value || "#8b5cf6";
                          if (!name) return;
                          const newType: SurfaceType = { id: crypto.randomUUID(), name, color };
                          setSurfaceTypes(prev => [...prev, newType]);
                          setActiveTypeId(newType.id);
                          nameEl.value = "";
                          toast({ title: `${d("sf_type")}: ${name}`, variant: "success" });
                        }}
                          className="px-2 py-1 rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors text-[10px] shrink-0">
                          <Check className="w-3 h-3" />
                        </button>
                      </div>
                    </details>
                  </div>
                  {/* Totals */}
                  {zones.filter(z => z.typeId !== "__count__").length > 0 && ppm && (
                    <div className="mt-3 pt-3 border-t border-white/5 flex justify-between items-center">
                      <span className="text-xs text-slate-500">{d("sf_total" as DTKey)}</span>
                      <span className="font-mono text-sm text-white font-600">
                        {(() => {
                          const total = zones.filter(z => z.typeId !== "__count__").reduce((sum, z) => {
                            const a = polygonAreaNorm(z.points, imageNatural.w, imageNatural.h);
                            return sum + a / (ppm! * ppm!);
                          }, 0);
                          return `${total.toFixed(2)} m\u00b2`;
                        })()}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* UTILITIES PANEL */}
              {layer === "utilities" && (
                <div className="glass rounded-xl border border-white/10 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-600 text-slate-400 uppercase tracking-wide">{d("ut_tools")}</h3>
                  </div>
                  {ppm && (
                    <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg border border-white/5 bg-white/5">
                      <Ruler className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs text-slate-400">{d("re_scale")}</span>
                      <span className="ml-auto font-mono text-xs text-amber-400 font-600">{ppm.toFixed(1)} px/m</span>
                    </div>
                  )}
                  {/* Count categories */}
                  <div className="border-t border-white/5 pt-2 mt-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                        <Hash className="w-3 h-3" /> {d("ed_annot_cats" as DTKey)}
                      </span>
                      <button
                        title="Ajouter une catégorie d'annotation (ex: Prises, Radiateurs, Spots...)"
                        onClick={() => {
                          const name = prompt("Nom de l'annotation (ex: Prises, Radiateurs, Spots):");
                          if (!name?.trim()) return;
                          const colors = ["#F59E0B","#06B6D4","#EC4899","#10B981","#8B5CF6","#EF4444","#3B82F6","#F97316"];
                          const color = colors[countGroups.length % colors.length];
                          const newGroup: CountGroup = { id: `cnt_${Date.now()}`, name: name.trim(), color };
                          setCountGroups(prev => [...prev, newGroup]);
                          setActiveCountGroupId(newGroup.id);
                          setTool("count");
                        }}
                        className="text-slate-500 hover:text-emerald-400 transition-colors p-0.5 rounded hover:bg-emerald-500/10">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {countGroups.map(grp => {
                      const pts = countPoints.filter(p => p.groupId === grp.id);
                      const isActive = activeCountGroupId === grp.id;
                      const visible = countGroupVisibility[grp.id] !== false;
                      return (
                        <div key={grp.id}
                          className={cn(
                            "flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all cursor-pointer border",
                            isActive ? "border-white/20 bg-white/5" : "border-transparent hover:bg-white/3"
                          )}
                          onClick={() => { setActiveCountGroupId(grp.id); setTool("count"); }}>
                          <input type="color" value={grp.color}
                            title="Changer la couleur de cette catégorie"
                            onClick={e => e.stopPropagation()}
                            onChange={e => { e.stopPropagation(); setCountGroups(prev => prev.map(g => g.id === grp.id ? { ...g, color: e.target.value } : g)); }}
                            className="w-4 h-4 rounded-full shrink-0 border-0 p-0 cursor-pointer bg-transparent" style={{ background: grp.color }} />
                          <span className={cn("flex-1 truncate", isActive ? "text-white" : "text-slate-400")}>{grp.name}</span>
                          <span className="font-mono text-[10px] text-slate-500">{pts.length}</span>
                          <button
                            title={visible ? `Masquer "${grp.name}" sur le plan` : `Afficher "${grp.name}" sur le plan`}
                            onClick={e => { e.stopPropagation(); setCountGroupVisibility(prev => ({ ...prev, [grp.id]: !visible })); }}
                            className="text-slate-600 hover:text-slate-300 transition-colors p-0.5">
                            {visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                          </button>
                          <button
                            title={`Supprimer la catégorie "${grp.name}" et ses ${pts.length} point(s)`}
                            onClick={e => {
                              e.stopPropagation();
                              setCountPoints(prev => prev.filter(p => p.groupId !== grp.id));
                              setCountGroups(prev => prev.filter(g => g.id !== grp.id));
                              if (activeCountGroupId === grp.id && countGroups.length > 1) {
                                setActiveCountGroupId(countGroups.find(g => g.id !== grp.id)?.id ?? "");
                              }
                            }}
                            className="text-slate-600 hover:text-red-400 transition-colors p-0.5">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                    {countPoints.length > 0 && (
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-slate-500">Total : {countPoints.length} points</span>
                        <button onClick={() => setCountPoints([])}
                          className="text-[10px] text-slate-600 hover:text-red-400 transition-colors">
                          {d("ed_annot_clear" as DTKey)}
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-600 leading-relaxed mt-2">
                    {tool === "linear" && d("ed_dist_help" as DTKey)}
                    {tool === "count" && `${d("ed_annot_help" as DTKey)} "${countGroups.find(g => g.id === activeCountGroupId)?.name ?? ""}"`}
                    {tool === "text" && "Cliquez sur le plan pour placer une annotation texte · Clic sur une annotation pour la supprimer"}
                    {tool === "circle" && (circleCenter ? "Cliquez pour définir le rayon du cercle" : "Cliquez pour placer le centre du cercle")}
                    {tool === "rescale" && d("ed_rescale_help" as DTKey)}
                    {tool === "angle" && d("ed_angle_help" as DTKey)}
                  </p>
                </div>
              )}

              {/* OPENINGS TAB — visible for all layers when visibility tab is selected */}
              {sidebarTab === "visibility" && (
                <div className="glass rounded-xl border border-white/10 p-4 text-xs">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-600 text-slate-500">{d("ed_openings_det")}</p>
                    {selectedOpeningIdx !== null && (
                      <button onClick={() => setSelectedOpeningIdx(null)}
                        className="text-slate-600 hover:text-slate-400 transition-colors text-[10px]">{d("ed_deselect")}</button>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 max-h-52 overflow-y-auto pr-0.5">
                    {result.openings?.map((o, i) => {
                      const isSelected = selectedOpeningIdx === i;
                      const color = o.class === "door" ? "purple" : "cyan";
                      return (
                        <div key={i} onClick={() => {
                          const newIdx = selectedOpeningIdx === i ? null : i;
                          setSelectedOpeningIdx(newIdx);
                          setTool("select");
                          // Zoom to element + isolate its mask layer
                          if (newIdx !== null) {
                            const opening = result.openings![newIdx];
                            if (opening && imgRef.current && zoomContainerRef.current) {
                              const img = imgRef.current;
                              const container = zoomContainerRef.current;
                              const scx = img.offsetWidth / (imageNatural.w || 1);
                              const scy = img.offsetHeight / (imageNatural.h || 1);
                              const bx = opening.x_px * scx;
                              const by = opening.y_px * scy;
                              const bw = opening.width_px * scx;
                              const bh = opening.height_px * scy;
                              const pad = 120;
                              const newZoom = Math.min((container.clientWidth - pad*2) / Math.max(bw, 20), (container.clientHeight - pad*2) / Math.max(bh, 20), 5);
                              const zoomVal = Math.max(0.8, Math.min(newZoom, 5));
                              const cx = (bx + bw/2) - img.offsetWidth/2;
                              const cy = (by + bh/2) - img.offsetHeight/2;
                              setZoom(zoomVal);
                              setTranslate({ x: -cx * zoomVal, y: -cy * zoomVal });
                            }
                            // Isolate: show only this element's mask type
                            setShowDoors(opening.class === "door");
                            setShowWindows(opening.class === "window");
                            setShowFrenchDoors(opening.class === "french_door");
                          }
                        }}
                          className={cn("flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all border",
                            isSelected
                              ? color === "purple" ? "bg-purple-500/15 border-purple-500/40 text-white" : "bg-cyan-500/15 border-cyan-500/40 text-white"
                              : "border-transparent text-slate-500 hover:bg-white/5 hover:text-slate-300")}>
                          <span className={cn("w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0",
                            isSelected
                              ? color === "purple" ? "bg-purple-500/30 text-purple-300" : "bg-cyan-500/30 text-cyan-300"
                              : color === "purple" ? "bg-purple-500/15 text-purple-500" : "bg-cyan-500/15 text-cyan-500")}>{i + 1}</span>
                          <span className="flex-1 truncate">{o.class === "door" ? d("door_lbl") : d("win_lbl")}</span>
                          {o.length_m && (<span className="text-slate-600 font-mono">{o.length_m.toFixed(2)}m</span>)}
                          {isSelected && (
                            <button onClick={(e) => { e.stopPropagation(); deleteOpening(i); }}
                              className="ml-0.5 p-0.5 rounded text-red-500 hover:text-red-300 hover:bg-red-500/15 transition-colors shrink-0"
                              disabled={loading}><Trash2 className="w-3 h-3" /></button>
                          )}
                        </div>
                      );
                    })}
                    {(!result.openings || result.openings.length === 0) && (<p className="text-slate-600">{d("ed_no_elem")}</p>)}
                  </div>
                  {selectedOpeningIdx !== null && result.openings?.[selectedOpeningIdx] && (
                    <div className="mt-3 pt-3 border-t border-white/5">
                      <p className="mb-2 text-[10px] font-500 text-slate-500 uppercase tracking-wide">#{selectedOpeningIdx + 1} \u2014 {d("ed_edit_mask")}</p>
                      <div className="flex flex-col gap-1.5">
                        <button onClick={() => { const o = result.openings![selectedOpeningIdx]; setLayer(o.class === "door" ? "door" : "window"); setTool("add_rect"); toast({ title: d("ed_mode_extend"), description: d("ed_mode_extend_d"), variant: "default" }); }}
                          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors text-xs">
                          <Plus className="w-3 h-3" /> {d("ed_extend_mask")}
                        </button>
                        <button onClick={() => { const o = result.openings![selectedOpeningIdx]; setLayer(o.class === "door" ? "door" : "window"); setTool("erase_rect"); toast({ title: d("ed_mode_reduce"), description: d("ed_mode_reduce_d"), variant: "default" }); }}
                          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-colors text-xs">
                          <Minus className="w-3 h-3" /> {d("ed_reduce_mask")}
                        </button>
                        <button onClick={() => { const o = result.openings![selectedOpeningIdx]; setLayer(o.class === "door" ? "door" : "window"); setTool("add_poly"); toast({ title: d("ed_mode_poly"), description: d("ed_mode_poly_d"), variant: "default" }); }}
                          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 transition-colors text-xs">
                          <PenLine className="w-3 h-3" /> {d("ed_trace_poly")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* VISIBILITY: Count, Surfaces, Detections toggles */}
              {sidebarTab === "visibility" && (
                <div className="glass rounded-xl border border-white/10 p-4 space-y-3">
                  <p className="text-xs font-600 text-slate-500 uppercase tracking-wide">{d("ed_display" as DTKey)}</p>

                  {/* Count groups toggle */}
                  {countGroups.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-slate-600 uppercase tracking-wider">{d("ed_annotations" as DTKey)}</p>
                      {countGroups.map(grp => {
                        const visible = countGroupVisibility[grp.id] !== false;
                        const count = countPoints.filter(p => p.groupId === grp.id).length;
                        return (
                          <button key={grp.id}
                            onClick={() => setCountGroupVisibility(prev => ({ ...prev, [grp.id]: !visible }))}
                            className={cn("w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all hover:bg-white/5",
                              visible ? "opacity-100" : "opacity-40")}>
                            <div className="w-3 h-3 rounded-full shrink-0" style={{ background: grp.color }} />
                            <span className="flex-1 text-left text-slate-300 truncate">{grp.name}</span>
                            <span className="font-mono text-[10px] text-slate-500">{count}</span>
                            {visible ? <Eye className="w-3.5 h-3.5 text-slate-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-600" />}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Overlays: Walls, Rooms, Openings */}
                  <div className="space-y-1">
                    <p className="text-[10px] text-slate-600 uppercase tracking-wider">Calques</p>
                    <button onClick={() => setShowWalls(v => !v)}
                      className={cn("w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all hover:bg-white/5",
                        showWalls ? "opacity-100" : "opacity-40")}>
                      <BrickWall className="w-3.5 h-3.5 text-red-400" />
                      <span className="flex-1 text-left text-slate-300">{d("ed_concrete")}</span>
                      {showWalls ? <Eye className="w-3.5 h-3.5 text-slate-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-600" />}
                    </button>
                    <button onClick={() => setShowRooms(v => !v)}
                      className={cn("w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all hover:bg-white/5",
                        showRooms ? "opacity-100" : "opacity-40")}>
                      <LayoutGrid className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="flex-1 text-left text-slate-300">{d("ed_rooms")}</span>
                      {showRooms ? <Eye className="w-3.5 h-3.5 text-slate-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-600" />}
                    </button>
                    <button onClick={() => setShowOpeningOverlay(v => !v)}
                      className={cn("w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all hover:bg-white/5",
                        showOpeningOverlay ? "opacity-100" : "opacity-40")}>
                      <DoorOpen className="w-3.5 h-3.5 text-fuchsia-400" />
                      <span className="flex-1 text-left text-slate-300">{d("ed_doors")}/{d("ed_windows")}</span>
                      {showOpeningOverlay ? <Eye className="w-3.5 h-3.5 text-slate-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-600" />}
                    </button>
                  </div>

                  {/* Surfaces toggle — always visible */}
                  <div className="space-y-1">
                    <p className="text-[10px] text-slate-600 uppercase tracking-wider">{d("ed_surfaces_label" as DTKey)}</p>
                    <button
                      onClick={() => setShowSurfaces(v => !v)}
                      className={cn("w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all hover:bg-white/5",
                        showSurfaces ? "opacity-100" : "opacity-40")}>
                      <PaintBucket className="w-3.5 h-3.5 text-violet-400" />
                      <span className="flex-1 text-left text-slate-300">{d("sf_surfaces" as DTKey)}</span>
                      <span className="font-mono text-[10px] text-slate-500">{zones.filter(z => z.typeId !== "__count__").length}</span>
                      {showSurfaces ? <Eye className="w-3.5 h-3.5 text-slate-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-600" />}
                    </button>
                  </div>

                  {/* Custom detections toggle */}
                  {customDetections.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-slate-600 uppercase tracking-wider">{d("ed_custom_det" as DTKey)}</p>
                      {customDetections.map(det => (
                        <div key={det.label} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-300">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ background: det.color }} />
                          <span className="flex-1 truncate">{det.label}</span>
                          <span className="font-mono text-[10px] text-slate-500">×{det.count}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Linear/angle measurements */}
                  {(linearMeasures.length > 0 || angleMeasures.length > 0) && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-slate-600 uppercase tracking-wider">{d("ed_measures" as DTKey)}</p>
                      {linearMeasures.length > 0 && (
                        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-300">
                          <Ruler className="w-3.5 h-3.5 text-sky-400" />
                          <span className="flex-1">{d("ed_distances" as DTKey)}</span>
                          <span className="font-mono text-[10px] text-slate-500">{linearMeasures.length}</span>
                        </div>
                      )}
                      {angleMeasures.length > 0 && (
                        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-300">
                          <Compass className="w-3.5 h-3.5 text-amber-400" />
                          <span className="flex-1">{d("ed_angles" as DTKey)}</span>
                          <span className="font-mono text-[10px] text-slate-500">{angleMeasures.length}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
          </div>{/* /inner row canvas+sidebar */}
        </div>
      )}
      {/* ── Admin: Full Plan Overlay (original image + recalibrated detections) ── */}
      {showFullPlan && originalImageB64 && cropRect && (
        <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-white/10">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-amber-400">Vue complète (admin)</span>
              <span className="text-xs text-slate-500">Image originale + détections recalées via crop ({(cropRect.x*100).toFixed(0)}%, {(cropRect.y*100).toFixed(0)}%, {(cropRect.w*100).toFixed(0)}%×{(cropRect.h*100).toFixed(0)}%)</span>
            </div>
            <button onClick={() => setShowFullPlan(false)}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-white glass border border-white/10 rounded-lg transition-colors">
              Fermer ✕
            </button>
          </div>
          {/* Content — image with recalibrated SVG overlays */}
          <div className="flex-1 overflow-auto flex items-center justify-center p-8">
            <div className="relative">
              <img src={`data:image/png;base64,${originalImageB64}`} alt="Plan original"
                style={{ maxWidth: "90vw", maxHeight: "85vh" }}
                onLoad={e => {
                  // Store natural size for SVG viewBox
                  const img = e.currentTarget;
                  (img as any).__natW = img.naturalWidth;
                  (img as any).__natH = img.naturalHeight;
                  (img as any).__dispW = img.offsetWidth;
                  (img as any).__dispH = img.offsetHeight;
                }}
              />
              {/* SVG overlay — all detections offset by crop rect */}
              {(() => {
                // Crop rect is in 0-1 normalized coords of the ORIGINAL image
                // AI detections use 0-1 coords relative to the CROPPED image
                // To map: original_x = cropRect.x + detection_x * cropRect.w
                const cx = cropRect.x, cy = cropRect.y, cw = cropRect.w, ch = cropRect.h;
                const mapX = (normX: number) => `${(cx + normX * cw) * 100}%`;
                const mapY = (normY: number) => `${(cy + normY * ch) * 100}%`;
                return (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                    {/* Crop area outline */}
                    <rect x={cx * 100} y={cy * 100} width={cw * 100} height={ch * 100}
                      fill="none" stroke="#FCD34D" strokeWidth={0.3} strokeDasharray="1 0.5" />
                    {/* Rooms */}
                    {result.rooms?.map((room, ri) => {
                      if (!room.polygon_norm) return null;
                      const pts = room.polygon_norm
                        .map(p => `${(cx + p.x * cw) * 100},${(cy + p.y * ch) * 100}`)
                        .join(" ");
                      const color = getRoomColor(room.type);
                      return (
                        <polygon key={ri} points={pts}
                          fill={color + "25"} stroke={color} strokeWidth={0.2} />
                      );
                    })}
                    {/* Walls */}
                    {result.walls?.map((w, i) => (
                      <line key={`w${i}`}
                        x1={(cx + w.x1_norm * cw) * 100} y1={(cy + w.y1_norm * ch) * 100}
                        x2={(cx + w.x2_norm * cw) * 100} y2={(cy + w.y2_norm * ch) * 100}
                        stroke="#94a3b8" strokeWidth={0.2} />
                    ))}
                    {/* Custom detections */}
                    {customDetections.map(det =>
                      det.matches.map((m, mi) => (
                        <rect key={`${det.id}-${mi}`}
                          x={(cx + m.x_norm * cw) * 100}
                          y={(cy + m.y_norm * ch) * 100}
                          width={m.w_norm * cw * 100}
                          height={m.h_norm * ch * 100}
                          fill={det.color + "20"} stroke={det.color} strokeWidth={0.15} rx={0.2} />
                      ))
                    )}
                    {/* Text annotations */}
                    {textAnnotations.map(ta => (
                      <text key={ta.id}
                        x={(cx + ta.x * cw) * 100}
                        y={(cy + ta.y * ch) * 100}
                        fontSize={0.8} fill={ta.color} fontFamily="system-ui"
                      >{ta.text}</text>
                    ))}
                    {/* Count points */}
                    {countPoints.map(cp => {
                      const grp = countGroups.find(g => g.id === cp.groupId);
                      return (
                        <circle key={cp.id}
                          cx={(cx + cp.x * cw) * 100}
                          cy={(cy + cp.y * ch) * 100}
                          r={0.4} fill={grp?.color ?? "#38bdf8"} />
                      );
                    })}
                    {/* Circles */}
                    {circleMeasures.map(cm => {
                      const ccx = (cx + cm.center.x * cw) * 100;
                      const ccy = (cy + cm.center.y * ch) * 100;
                      const ecx = (cx + cm.edgePoint.x * cw) * 100;
                      const ecy = (cy + cm.edgePoint.y * ch) * 100;
                      const r = Math.hypot(ecx - ccx, ecy - ccy);
                      return (
                        <g key={cm.id}>
                          <ellipse cx={ccx} cy={ccy} rx={r} ry={r}
                            fill="rgba(20,184,166,0.08)" stroke="#14B8A6" strokeWidth={0.15} />
                          <line x1={ccx} y1={ccy} x2={ecx} y2={ecy}
                            stroke="#14B8A6" strokeWidth={0.1} strokeDasharray="0.3 0.2" />
                        </g>
                      );
                    })}
                  </svg>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
