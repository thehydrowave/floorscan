"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Download, RotateCcw, Loader2, AlertTriangle, PenLine, Layers, Undo2, Redo2, FileDown, MousePointer2, Trash2, Eye, EyeOff, LayoutGrid, Scissors, Merge, Search, X, Save, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalysisResult, Room, VisualSearchMatch, CustomDetection } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import MeasureCanvas from "@/components/measure/measure-canvas";
import SurfacePanel from "@/components/measure/surface-panel";
import { SurfaceType, MeasureZone, DEFAULT_SURFACE_TYPES, aggregateByType, aggregatePerimeterByType, polygonPerimeterM } from "@/lib/measure-types";
import type { WallSegment } from "@/lib/types";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
type Layer = "door" | "window" | "interior" | "rooms";
type EditorTool = "add_rect" | "erase_rect" | "add_poly" | "erase_poly" | "sam" | "select" | "split" | "visual_search";
type Mode = "editor" | "measure";

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

const ROOM_COLORS: Record<string, string> = {
  "bedroom":      "#818cf8",
  "living room":  "#34d399",
  "living":       "#34d399",
  "kitchen":      "#fb923c",
  "bathroom":     "#22d3ee",
  "hallway":      "#94a3b8",
  "corridor":     "#94a3b8",
  "office":       "#a78bfa",
  "study":        "#a78bfa",
  "wc":           "#fbbf24",
  "toilet":       "#fbbf24",
  "dining room":  "#f472b6",
  "storage":      "#78716c",
  "closet":       "#78716c",
  "garage":       "#6b7280",
  "balcony":      "#86efac",
  "laundry":      "#67e8f9",
};

function getRoomColor(type: string) {
  return ROOM_COLORS[type?.toLowerCase()] ?? "#94a3b8";
}

/** Ray-casting point-in-polygon test (normalized coords) */
function pointInPolygon(x: number, y: number, polygon: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Shoelace formula: polygon area in pixels from normalized coords */
function polygonAreaNorm(polygon: { x: number; y: number }[], imgW: number, imgH: number): number {
  let a = 0;
  for (let j = 0; j < polygon.length; j++) {
    const k = (j + 1) % polygon.length;
    a += polygon[j].x * imgW * polygon[k].y * imgH;
    a -= polygon[k].x * imgW * polygon[j].y * imgH;
  }
  return Math.abs(a) / 2;
}

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

interface EditorStepProps {
  sessionId: string;
  initialResult: AnalysisResult;
  initialCustomDetections?: CustomDetection[];
  onRestart: () => void;
  onSessionExpired?: () => void;
  onAddPage?: () => void;
  onGoResults?: (updatedResult: AnalysisResult, detections?: CustomDetection[]) => void;
}

export default function EditorStep({ sessionId, initialResult, initialCustomDetections, onRestart, onSessionExpired, onAddPage, onGoResults }: EditorStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [result, setResult] = useState(initialResult);
  const [mode, setMode] = useState<Mode>("editor");
  const [layer, setLayer] = useState<Layer>("door");
  const [tool, setTool] = useState<EditorTool>("add_rect");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingDxf, setExportingDxf] = useState(false);
  const [roomHistoryLen, setRoomHistoryLen] = useState(0);
  const [roomFutureLen, setRoomFutureLen] = useState(0);

  // Opening selection & highlight
  const [selectedOpeningIdx, setSelectedOpeningIdx] = useState<number | null>(null);
  const [showOpeningOverlay, setShowOpeningOverlay] = useState(false);

  // Overlays visibilité (murs / pièces)
  const [showWalls, setShowWalls] = useState(false);
  const [showRooms, setShowRooms] = useState(true);

  // Sélection / édition de pièce
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [editingRoomId, setEditingRoomId] = useState<number | null>(null);
  const [activeRoomType, setActiveRoomType] = useState<string>("bedroom");

  // Auto-enable overlays + reset tool on layer change
  useEffect(() => {
    if (layer === "rooms") {
      setShowRooms(true);
      setTool("select");
    } else if (layer === "door" || layer === "window") {
      if (tool === "split") setTool("add_rect");
    } else if (layer === "interior") {
      if (tool === "split" || tool === "select") setTool("add_rect");
    }
    if (layer !== "rooms") {
      setSelectedRoomId(null);
      setEditingRoomId(null);
    }
  }, [layer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Vertex drag editing for room polygons
  const [dragRoomVertex, setDragRoomVertex] = useState<{ roomId: number; idx: number } | null>(null);
  const [localRooms, setLocalRooms] = useState<Room[] | null>(null);
  const [snappedVertex, setSnappedVertex] = useState(false);
  const dragRoomVertexRef = useRef<{ roomId: number; idx: number } | null>(null);
  const localRoomsRef = useRef<Room[] | null>(null);

  // Taille d'affichage de l'image (pour les SVG overlays)
  const [imgDisplaySize, setImgDisplaySize] = useState({ w: 0, h: 0 });

  // Measure state
  const [zones, setZones] = useState<MeasureZone[]>([]);
  const [surfaceTypes, setSurfaceTypes] = useState<SurfaceType[]>(DEFAULT_SURFACE_TYPES);
  const [activeTypeId, setActiveTypeId] = useState(DEFAULT_SURFACE_TYPES[0].id);
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

  // Canvas (editor mode)
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const pts = useRef<[number, number][]>([]);
  const startPt = useRef({ x: 0, y: 0 });

  const currentOverlay = layer === "interior" && result.overlay_interior_b64
    ? result.overlay_interior_b64
    : result.overlay_openings_b64;

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

  // ── Window-level mousemove/mouseup for room vertex drag ──
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const dv = dragRoomVertexRef.current;
      if (!dv) return;
      const img = imgRef.current;
      if (!img) return;
      const r = img.getBoundingClientRect();
      const rawX = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const rawY = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      // Snap to nearest wall segment
      const ds = imgDisplaySizeRef.current;
      const snap = snapToWalls(rawX, rawY, resultWallsRef.current, ds.w, ds.h);
      const normX = snap.x, normY = snap.y;
      setSnappedVertex(snap.snapped);
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
      const dv = dragRoomVertexRef.current;
      if (e.button !== 0 || !dv) return;
      const rooms = localRoomsRef.current;

      dragRoomVertexRef.current = null;
      setDragRoomVertex(null);
      setSnappedVertex(false);

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

  // ── Keyboard: Ctrl+Z/Y for room undo/redo in editor mode ──
  useEffect(() => {
    if (mode !== "editor" || layer !== "rooms") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault(); sendUndoRoom();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault(); sendRedoRoom();
      }
      if (e.key === "Escape" && tool === "split") {
        pts.current = []; drawCanvas(); setTool("select");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // runs every render to capture latest sendUndoRoom/sendRedoRoom

  function scaleX(px: number) {
    const img = imgRef.current!;
    return px * img.naturalWidth / img.offsetWidth;
  }
  function scaleY(py: number) {
    const img = imgRef.current!;
    return py * img.naturalHeight / img.offsetHeight;
  }

  const drawCanvas = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const isErase = tool.startsWith("erase");
    const roomColor = layer === "rooms" ? getRoomColor(activeRoomType) : null;
    const color = isErase ? "#F87171" : (roomColor ?? (layer === "interior" ? "#34D399" : layer === "door" ? "#D946EF" : "#22D3EE"));
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
        overlay_openings_b64: data.overlay_openings_b64 ?? prev.overlay_openings_b64,
        overlay_interior_b64: data.overlay_interior_b64 ?? prev.overlay_interior_b64,
        mask_doors_b64: data.mask_doors_b64 ?? prev.mask_doors_b64,
        mask_windows_b64: data.mask_windows_b64 ?? prev.mask_windows_b64,
        mask_walls_b64: data.mask_walls_b64 ?? prev.mask_walls_b64,
        doors_count: data.doors_count ?? prev.doors_count,
        windows_count: data.windows_count ?? prev.windows_count,
        surfaces: data.surfaces ?? prev.surfaces,
        openings: data.openings ?? prev.openings,
        rooms: data.rooms ?? prev.rooms,
        walls: data.walls ?? prev.walls,
      }));
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
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const rx = scaleX(e.clientX - rect.left);
    const ry = scaleY(e.clientY - rect.top);
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
    // ── Split tool: collect 2 points then submit ──
    if (tool === "split" && layer === "rooms") {
      pts.current.push([rx, ry]);
      drawCanvas();
      if (pts.current.length >= 2) {
        const img = imgRef.current!;
        const cutPoints = pts.current.map(([px, py]) => ({ x: px / img.naturalWidth, y: py / img.naturalHeight }));
        pts.current = [];
        sendEditRoom({ action: "split_room", room_id: selectedRoomId, cut_points: cutPoints });
        setTool("select");
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
          setSelectedRoomId(prev => prev === hitRoom!.id ? null : hitRoom!.id);
          setEditingRoomId(hitRoom.id);
          setActiveRoomType(hitRoom.type);
        } else {
          setSelectedRoomId(null);
          setEditingRoomId(null);
        }
        return;
      }
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
      if (bestIdx >= 0 && (bestDist === 0 || bestDist < 150)) {
        setSelectedOpeningIdx(prev => prev === bestIdx ? null : bestIdx);
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
      const cv = canvasRef.current!;
      const rect = cv.getBoundingClientRect();
      const img = imgRef.current!;
      const rx = scaleX(e.clientX - rect.left);
      const ry = scaleY(e.clientY - rect.top);
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
    const rect = cv.getBoundingClientRect();
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const isErase = tool.startsWith("erase");
    const roomColorMv = layer === "rooms" ? getRoomColor(activeRoomType) : null;
    const color = isErase ? "#F87171" : (roomColorMv ?? (layer === "interior" ? "#34D399" : layer === "door" ? "#D946EF" : "#22D3EE"));
    const img = imgRef.current!;
    const x0 = startPt.current.x * img.offsetWidth / img.naturalWidth;
    const y0 = startPt.current.y * img.offsetHeight / img.naturalHeight;
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([4, 2]);
    ctx.fillStyle = color + "22";
    ctx.fillRect(x0, y0, e.clientX - rect.left - x0, e.clientY - rect.top - y0);
    ctx.strokeRect(x0, y0, e.clientX - rect.left - x0, e.clientY - rect.top - y0);
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
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const x1 = scaleX(e.clientX - rect.left);
    const y1 = scaleY(e.clientY - rect.top);
    cv.getContext("2d")!.clearRect(0, 0, cv.width, cv.height);
    if (Math.abs(x1 - startPt.current.x) > 5 || Math.abs(y1 - startPt.current.y) > 5) {
      await sendEdit({ action: tool, x0: startPt.current.x, y0: startPt.current.y, x1, y1 });
    }
  };

  const finishPoly = async () => {
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
  const exportMeasureCsv = () => {
    const ppmVal = result.pixels_per_meter ?? null;
    const totals = imageNatural.w > 0 ? aggregateByType(zones, imageNatural.w, imageNatural.h, ppmVal) : {};
    const rows: string[][] = [[d("me_step_survey"), ppmVal ? "Surface (m\u00B2)" : "Surface (px\u00B2)"]];
    surfaceTypes.filter(t => (totals[t.id] ?? 0) > 0).forEach(t => {
      rows.push([t.name, ppmVal ? (totals[t.id]).toFixed(4) : String(Math.round(totals[t.id]))]);
    });
    const totalAll = Object.values(totals).reduce((a, b) => a + b, 0);
    rows.push(["TOTAL", ppmVal ? totalAll.toFixed(4) : String(Math.round(totalAll))]);
    const csv = "\uFEFF" + rows.map(r => r.join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `floorscan_metre_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast({ title: "CSV export\u00E9 \u2713", variant: "success" });
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
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-xs font-mono text-accent uppercase tracking-widest mb-1">{d("ed_step_label")}</p>
          <h2 className="font-display text-2xl font-700 text-white">
            {mode === "editor" ? d("re_editor") : d("sel_met_title")}
          </h2>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Mode toggle */}
          <div className="flex glass border border-white/10 rounded-xl p-1 gap-1">
            <button
              onClick={() => setMode("editor")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${mode === "editor" ? "bg-accent text-white" : "text-slate-400 hover:text-white"}`}
            >
              <Layers className="w-3.5 h-3.5" /> {d("ed_ia_editor")}
            </button>
            <button
              onClick={() => setMode("measure")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${mode === "measure" ? "bg-accent text-white" : "text-slate-400 hover:text-white"}`}
            >
              <PenLine className="w-3.5 h-3.5" /> {d("me_step_survey")}
            </button>
          </div>

          <Button onClick={handleExportPdf} disabled={exportingPdf} variant="outline">
            {exportingPdf ? <><Loader2 className="w-4 h-4 animate-spin" /> {d("re_exporting")}</> : <><Download className="w-4 h-4" /> {d("re_pdf")}</>}
          </Button>
          <Button onClick={handleExportDxf} disabled={exportingDxf || !ppm} variant="outline" title={!ppm ? d("ed_dxf_need") : d("ed_dxf_tt")}>
            {exportingDxf ? <><Loader2 className="w-4 h-4 animate-spin" /> {d("ed_exporting")}</> : <><FileDown className="w-4 h-4" /> DXF</>}
          </Button>
          {onGoResults && (
            <Button variant="outline" onClick={() => onGoResults(result, customDetections)}>
              <LayoutGrid className="w-4 h-4" /> {d("re_title")}
            </Button>
          )}
          {onAddPage && (
            <Button variant="outline" onClick={onAddPage}>
              <Layers className="w-4 h-4" /> {d("btn_add_page")}
            </Button>
          )}
          <Button variant="ghost" onClick={onRestart}><RotateCcw className="w-4 h-4" /> {d("ed_restart")}</Button>
        </div>
      </div>

      {/* ── MODE ÉDITEUR ── */}
      {mode === "editor" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          <div className="flex flex-col gap-3 min-w-0">
            {/* ── Row 1: Layers + Visibility toggles ── */}
            <div className="glass rounded-xl border border-white/10 p-3 flex gap-2 flex-wrap items-center">
              <span className="text-xs text-slate-500 self-center font-mono mr-1">{d("ed_layer_lbl")}:</span>
              {(["door", "window", "interior", "rooms"] as Layer[]).map(l => (
                <button key={l} onClick={() => setLayer(l)}
                  className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all",
                    layer === l
                      ? l === "rooms" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-accent/40 bg-accent/10 text-accent"
                      : "border-white/10 text-slate-500 hover:text-slate-300")}>
                  {l === "door" ? `🚪 ${d("ed_doors")}` : l === "window" ? `🪟 ${d("ed_windows")}` : l === "interior" ? `🏠 ${d("ed_living_s")}` : `🏘️ ${d("ed_rooms")}`}
                </button>
              ))}
              <div className="flex-1" />
              <button
                onClick={() => setShowOpeningOverlay(v => !v)}
                title={showOpeningOverlay ? d("ed_hide_nums") : d("ed_show_nums")}
                className={cn("px-2 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1",
                  showOpeningOverlay ? "border-white/20 bg-white/5 text-white" : "border-white/10 text-slate-500 hover:text-slate-300")}>
                {showOpeningOverlay ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                N°
              </button>
              <button
                onClick={() => setShowWalls(v => !v)}
                title={showWalls ? d("ed_hide_walls") : d("ed_show_walls")}
                className={cn("px-2 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1",
                  showWalls ? "border-orange-500/40 bg-orange-500/10 text-orange-400" : "border-white/10 text-slate-500 hover:text-slate-300")}>
                <Layers size={12} className={showWalls ? "" : "opacity-40"} />
                {d("ed_walls")}
              </button>
              <button
                onClick={() => setShowRooms(v => !v)}
                title={showRooms ? d("ed_hide_rooms") : d("ed_show_rooms")}
                className={cn("px-2 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1",
                  showRooms ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-white/10 text-slate-500 hover:text-slate-300")}>
                <LayoutGrid size={12} className={showRooms ? "" : "opacity-40"} />
                {d("ed_rooms")}
              </button>
            </div>

            {/* ── Row 2: Contextual tools ── */}
            <div className="glass rounded-xl border border-white/10 p-3 flex gap-2 flex-wrap items-center">
              {/* Mask tools — door / window / interior */}
              {(layer === "door" || layer === "window" || layer === "interior") && (
                <>
                  <span className="text-xs text-slate-500 self-center font-mono mr-1">{d("ed_tool_lbl")}:</span>
                  {([
                    { id: "add_rect", label: d("ed_add_rect") },
                    { id: "erase_rect", label: d("ed_erase_rect"), erase: true },
                    { id: "add_poly", label: d("ed_add_poly") },
                    { id: "erase_poly", label: d("ed_erase_poly"), erase: true },
                    { id: "sam", label: d("ed_sam_auto"), special: true },
                    { id: "select", label: d("ed_select"), select: true },
                  ] as any[]).map(({ id, label, erase, special, select: sel }) => (
                    <button key={id} onClick={() => { setTool(id as EditorTool); pts.current = []; if (id !== "select") setSelectedOpeningIdx(null); }}
                      className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1",
                        tool === id
                          ? erase   ? "border-red-500/40 bg-red-500/10 text-red-400"
                            : special ? "border-orange-500/40 bg-orange-500/10 text-orange-400"
                            : sel    ? "border-teal-500/40 bg-teal-500/10 text-teal-400"
                            :          "border-accent/40 bg-accent/10 text-accent"
                          : erase   ? "border-red-500/20 text-red-500/60 hover:text-red-400"
                            : special ? "border-orange-500/20 text-orange-500/60 hover:text-orange-400"
                            : sel    ? "border-teal-500/20 text-teal-500/60 hover:text-teal-400"
                            :          "border-white/10 text-slate-500 hover:text-slate-300")}>
                      {sel && <MousePointer2 className="w-3 h-3" />}
                      {label}
                    </button>
                  ))}
                  {(tool === "add_poly" || tool === "erase_poly") && (
                    <button onClick={finishPoly} className="px-3 py-1.5 rounded-lg text-xs font-600 border border-accent-green/40 bg-accent-green/10 text-accent-green">
                      {d("ed_finish_poly")}
                    </button>
                  )}
                </>
              )}
              {/* Room tools */}
              {layer === "rooms" && (
                <>
                  <button onClick={() => { setTool("select"); pts.current = []; }}
                    className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1",
                      tool === "select" ? "border-teal-500/40 bg-teal-500/10 text-teal-400" : "border-teal-500/20 text-teal-500/60 hover:text-teal-400")}>
                    <MousePointer2 className="w-3 h-3" /> {d("ed_select")}
                  </button>
                  {/* Room creation / erase tools */}
                  {([
                    { id: "add_rect", label: d("ed_add_rect") },
                    { id: "erase_rect", label: d("ed_erase_rect"), erase: true },
                    { id: "add_poly", label: d("ed_add_poly") },
                    { id: "erase_poly", label: d("ed_erase_poly"), erase: true },
                  ] as any[]).map(({ id, label, erase }) => (
                    <button key={id} onClick={() => { setTool(id as EditorTool); pts.current = []; }}
                      className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1",
                        tool === id
                          ? erase ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-accent/40 bg-accent/10 text-accent"
                          : erase ? "border-red-500/20 text-red-500/60 hover:text-red-400" : "border-white/10 text-slate-500 hover:text-slate-300")}>
                      {label}
                    </button>
                  ))}
                  {(tool === "add_poly" || tool === "erase_poly") && (
                    <button onClick={finishPoly} className="px-3 py-1.5 rounded-lg text-xs font-600 border border-accent-green/40 bg-accent-green/10 text-accent-green">
                      {d("ed_finish_poly")}
                    </button>
                  )}
                  <div className="w-px bg-white/10 mx-1 self-stretch" />
                  <span className="text-xs text-slate-500 self-center font-mono mr-1">{d("ed_type")}:</span>
                  <div className="flex gap-1 flex-wrap">
                    {ROOM_TYPES.slice(0, 8).map(rt => (
                      <button key={rt.type} onClick={() => setActiveRoomType(rt.type)}
                        title={d(rt.i18nKey)}
                        className={cn("w-6 h-6 rounded-full border-2 transition-all shrink-0",
                          activeRoomType === rt.type ? "border-white scale-110" : "border-transparent opacity-70 hover:opacity-100")}
                        style={{ background: getRoomColor(rt.type) }}
                      />
                    ))}
                  </div>
                  <span className="text-xs self-center px-2 py-1 rounded-lg bg-white/5 text-slate-300">
                    {ROOM_TYPES.find(rt => rt.type === activeRoomType)?.i18nKey ? d(ROOM_TYPES.find(rt => rt.type === activeRoomType)!.i18nKey) : ""}
                  </span>
                  {selectedRoomId !== null && (
                    <>
                      <div className="w-px bg-white/10 mx-1 self-stretch" />
                      <button onClick={() => { setTool("split"); pts.current = []; toast({ title: d("ed_mode_split"), description: d("ed_mode_split_d"), variant: "default" }); }}
                        className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1",
                          tool === "split" ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-red-500/20 text-red-500/60 hover:text-red-400")}>
                        <Scissors className="w-3 h-3" /> {d("ed_split")}
                      </button>
                    </>
                  )}
                  <div className="w-px bg-white/10 mx-1 self-stretch" />
                  <button onClick={sendUndoRoom} disabled={roomHistoryLen === 0 || loading}
                    className="p-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                    title={d("ed_undo_tt")}>
                    <Undo2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={sendRedoRoom} disabled={roomFutureLen === 0 || loading}
                    className="p-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                    title={d("ed_redo_tt")}>
                    <Redo2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>

            {/* ── Row 3: Visual search (always visible) ── */}
            <div className="glass rounded-xl border border-white/10 p-2 flex gap-2 flex-wrap items-center">
              <button
                onClick={() => { setTool(tool === "visual_search" ? "select" : "visual_search" as EditorTool); if (tool !== "visual_search") { setVsCrop(null); } setVsEditMode("search"); }}
                className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                  tool === "visual_search"
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                    : "border-white/10 text-slate-500 hover:text-slate-300")}
                title={d("vs_tool")}
              >
                <Search className="w-3.5 h-3.5" /> {d("vs_tool")}
              </button>
              {/* Sub-mode buttons: Search / Add / Remove */}
              {tool === "visual_search" && vsMatches.length > 0 && (
                <>
                  <div className="w-px bg-white/10 mx-0.5 self-stretch" />
                  {(["search", "add", "remove"] as const).map((m) => (
                    <button key={m}
                      onClick={() => setVsEditMode(m)}
                      className={cn("px-2 py-1 rounded-lg text-[11px] font-500 border transition-all flex items-center gap-1",
                        vsEditMode === m
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                          : "border-white/5 text-slate-500 hover:text-slate-300")}
                    >
                      {m === "search" && <><Search className="w-3 h-3" /> {d("vs_search")}</>}
                      {m === "add" && <><Plus className="w-3 h-3" /> {d("vs_add")}</>}
                      {m === "remove" && <><Trash2 className="w-3 h-3" /> {d("vs_remove")}</>}
                    </button>
                  ))}
                </>
              )}
              {tool === "visual_search" && !vsSearching && vsMatches.length === 0 && (
                <span className="text-xs text-slate-500 italic">{d("vs_select")}</span>
              )}
              {vsSearching && (
                <span className="text-xs text-amber-400 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {d("vs_searching")}
                </span>
              )}
              {vsMatches.length > 0 && (
                <>
                  <div className="w-px bg-white/10 mx-0.5 self-stretch" />
                  <span className="text-xs font-600 text-amber-400">{vsMatches.length} {d("vs_found")}</span>
                  <div className="w-px bg-white/10 mx-0.5 self-stretch" />
                  {!vsSaveOpen ? (
                    <button
                      onClick={() => setVsSaveOpen(true)}
                      className="px-2 py-1 rounded-lg text-xs border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 flex items-center gap-1 transition-colors"
                    >
                      <Save className="w-3 h-3" /> {d("vs_save")}
                    </button>
                  ) : (
                    <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); saveVsAsDetection(vsSaveLabel); }}>
                      <input
                        type="text"
                        value={vsSaveLabel}
                        onChange={(e) => setVsSaveLabel(e.target.value)}
                        placeholder={d("vs_save_ph")}
                        className="px-2 py-1 rounded-lg text-xs bg-white/5 border border-white/10 text-white placeholder:text-slate-600 w-44 focus:outline-none focus:border-emerald-500/40"
                        autoFocus
                      />
                      <button type="submit" disabled={!vsSaveLabel.trim()}
                        className="px-2 py-1 rounded-lg text-xs bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-30 transition-colors">
                        OK
                      </button>
                      <button type="button" onClick={() => { setVsSaveOpen(false); setVsSaveLabel(""); }}
                        className="p-1 rounded-lg text-slate-500 hover:text-white transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </form>
                  )}
                  <button
                    onClick={() => { setVsMatches([]); setVsCrop(null); setVsSaveOpen(false); }}
                    className="px-2 py-1 rounded-lg text-xs border border-white/10 text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
                  >
                    <X className="w-3 h-3" /> {d("vs_clear")}
                  </button>
                </>
              )}
            </div>

            <div className={cn("glass rounded-xl border border-white/10 bg-white", isWideImage ? "overflow-x-auto overflow-y-hidden" : "overflow-hidden")}>
              {loading && (
                <div className="absolute inset-0 bg-ink/70 flex items-center justify-center z-20" style={{ position: "sticky", left: 0 }}>
                  <Loader2 className="w-8 h-8 text-accent animate-spin" />
                </div>
              )}
              <div className="relative" style={{ display: isWideImage ? "inline-block" : "block", minWidth: "100%" }}>
              <img ref={imgRef} src={`data:image/png;base64,${currentOverlay}`} alt="Plan"
                className={cn("block", isWideImage ? "h-[min(50vh,500px)] w-auto max-w-none" : "w-full h-auto max-h-[calc(100vh-200px)] object-contain")}
                onLoad={updateImgDisplaySize} />

              {/* Masque coloré raster (fallback si pas de polygon_norm) */}
              {showRooms && result.mask_rooms_b64 && !(result.rooms?.some(r => r.polygon_norm)) && selectedRoomId === null && (
                <img
                  src={`data:image/png;base64,${result.mask_rooms_b64}`}
                  alt=""
                  className={cn("absolute top-0 left-0 pointer-events-none", isWideImage ? "h-[min(50vh,500px)] w-auto max-w-none" : "w-full h-auto max-h-[calc(100vh-200px)] object-contain")}
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
                    && (selectedRoomId === null || room.id === selectedRoomId)
                  ).map(room => {
                    const rcx = room.centroid_norm.x * imgDisplaySize.w;
                    const rcy = room.centroid_norm.y * imgDisplaySize.h;
                    const rcolor = getRoomColor(room.type);
                    const isSelected = selectedRoomId === room.id;
                    const bboxW = room.bbox_norm.w * imgDisplaySize.w;
                    const bboxH = room.bbox_norm.h * imgDisplaySize.h;
                    const minDim = Math.min(bboxW, bboxH);
                    const fs = Math.max(7, Math.min(12, minDim * 0.14));

                    // Polygon SVG points
                    const polyPoints = room.polygon_norm
                      ? room.polygon_norm
                          .map(p => `${p.x * imgDisplaySize.w},${p.y * imgDisplaySize.h}`)
                          .join(" ")
                      : null;

                    // Perimeter
                    const perimM = room.perimeter_m != null ? room.perimeter_m
                      : (room.polygon_norm && ppm && imageNatural.w > 0
                        ? polygonPerimeterM(room.polygon_norm, imageNatural.w, imageNatural.h, ppm)
                        : null);

                    // Label 2-line : room name (large) + measurements (small)
                    const areaStr = room.area_m2 != null ? `${room.area_m2.toFixed(1)} m²` : "";
                    const perimStr = perimM != null ? `P ${perimM.toFixed(1)} m` : "";
                    const measLine = areaStr && perimStr ? `${areaStr} · ${perimStr}` : areaStr;
                    const nameFontSize = isSelected ? fs + 2 : fs + 1;
                    const measFontSize = Math.max(6, fs - 2);
                    const hasMeas = measLine.length > 0;
                    const nameWidth = Math.max(50, room.label_fr.length * (nameFontSize * 0.62));
                    const measWidth = hasMeas ? Math.max(40, measLine.length * (measFontSize * 0.6)) : 0;
                    const pw = Math.max(nameWidth, measWidth) + 12;
                    const ph = hasMeas ? nameFontSize + measFontSize + 8 : nameFontSize + 6;

                    return (
                      <g key={room.id} opacity={isSelected ? 1 : 0.85}>
                        {/* Polygone rempli semi-transparent */}
                        {polyPoints && (
                          <polygon
                            points={polyPoints}
                            fill={rcolor + "30"}
                            stroke={rcolor}
                            strokeWidth={isSelected ? 2.5 : 1.2}
                            strokeLinejoin="round"
                          />
                        )}
                        {/* Surbrillance sélection */}
                        {isSelected && polyPoints && (
                          <polygon
                            points={polyPoints}
                            fill={rcolor + "18"}
                            stroke={rcolor}
                            strokeWidth={3}
                            strokeDasharray="6 3"
                            strokeLinejoin="round"
                          />
                        )}
                        {/* Edge dimension annotations (selected room only) */}
                        {isSelected && room.polygon_norm && ppm && imageNatural.w > 0 && room.polygon_norm.map((p, ei) => {
                          const next = room.polygon_norm![(ei + 1) % room.polygon_norm!.length];
                          const x1 = p.x * imgDisplaySize.w, y1 = p.y * imgDisplaySize.h;
                          const x2 = next.x * imgDisplaySize.w, y2 = next.y * imgDisplaySize.h;
                          const edgeLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
                          if (edgeLen < 30) return null; // too short
                          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
                          const lenM = edgeLengthM(p, next, imageNatural.w, imageNatural.h, ppm);
                          const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
                          const rot = (angle > 90 || angle < -90) ? angle + 180 : angle;
                          // Offset perpendicular to edge
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
                                fontSize={8}
                                fontFamily="monospace"
                                fontWeight="600"
                                transform={`rotate(${rot},${tx},${ty})`}
                              >{dimText}</text>
                            </g>
                          );
                        })}
                        {/* Label fond 2 lignes */}
                        <rect
                          x={rcx - pw / 2} y={rcy - ph / 2}
                          width={pw} height={ph} rx={4}
                          fill={isSelected ? "rgba(10,16,32,0.92)" : "rgba(10,16,32,0.80)"}
                          stroke={rcolor}
                          strokeWidth={isSelected ? 1.5 : 0.8}
                        />
                        {/* Room name — large, bold, colored */}
                        <text
                          x={rcx} y={hasMeas ? rcy - ph / 2 + nameFontSize + 2 : rcy + nameFontSize * 0.35}
                          textAnchor="middle"
                          fill={rcolor}
                          fontSize={nameFontSize}
                          fontWeight="700"
                          fontFamily="system-ui,sans-serif"
                        >
                          {room.label_fr}
                        </text>
                        {/* Measurements — small, dimmer */}
                        {hasMeas && (
                          <text
                            x={rcx} y={rcy - ph / 2 + nameFontSize + measFontSize + 5}
                            textAnchor="middle"
                            fill="#94a3b8"
                            fontSize={measFontSize}
                            fontWeight="500"
                            fontFamily="monospace"
                          >
                            {measLine}
                          </text>
                        )}
                      </g>
                    );
                  })}
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
                      // Background click: select another room or deselect
                      const rect = e.currentTarget.getBoundingClientRect();
                      const normX = (e.clientX - rect.left) / imgDisplaySize.w;
                      const normY = (e.clientY - rect.top) / imgDisplaySize.h;
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
                      const fs = Math.max(7, Math.min(12, minDim * 0.14));
                      const rcx = selRoom.centroid_norm.x * imgDisplaySize.w;
                      const rcy = selRoom.centroid_norm.y * imgDisplaySize.h;

                      const perimM = selRoom.perimeter_m != null ? selRoom.perimeter_m
                        : (selRoom.polygon_norm && ppm && imageNatural.w > 0
                          ? polygonPerimeterM(selRoom.polygon_norm, imageNatural.w, imageNatural.h, ppm)
                          : null);
                      const areaStr = selRoom.area_m2 != null ? `${selRoom.area_m2.toFixed(1)} m²` : "";
                      const perimStr = perimM != null ? `P ${perimM.toFixed(1)} m` : "";
                      const measLine = areaStr && perimStr ? `${areaStr} · ${perimStr}` : areaStr;
                      const nameFontSize = fs + 2;
                      const measFontSize = Math.max(6, fs - 2);
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
                                  fontSize={8} fontFamily="monospace" fontWeight="600"
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
                        {/* Visible handle — hover: larger + filled with zone color */}
                        <circle cx={cx} cy={cy}
                          r={isDragging ? 9 : isSnapped ? 8 : 7}
                          fill={isDragging ? rcolor : isSnapped ? "#f97316" : "white"}
                          stroke={isSnapped ? "#ea580c" : rcolor}
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
                onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} />
              </div>{/* /inner wrapper */}
            </div>
            <p className="text-xs text-slate-600">{d("ed_canvas_hint")}</p>
          </div>

          {/* Panel résultats */}
          <div className="flex flex-col gap-4">
            {error && (
              <div className="glass rounded-xl border border-red-500/25 p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{error}</p>
              </div>
            )}
            <div className="glass rounded-xl border border-white/10 p-4">
              <p className="text-xs font-mono text-accent uppercase tracking-widest mb-3">{d("ed_ia_results")}</p>
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">🚪 {d("ed_doors")}</span>
                  <span className="font-700 text-purple-400">{result.doors_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">🪟 {d("ed_windows")}</span>
                  <span className="font-700 text-cyan-400">{result.windows_count}</span>
                </div>
                <div className="border-t border-white/5 my-1" />
                <div className="flex justify-between">
                  <span className="text-slate-500">{d("ed_living_s")}</span>
                  <span className="font-700 text-emerald-400">{sf.area_hab_m2 ? sf.area_hab_m2.toFixed(1) + " m²" : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">{d("ed_footprint")}</span>
                  <span className="font-700 text-blue-400">{sf.area_building_m2 ? sf.area_building_m2.toFixed(1) + " m²" : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">{d("ed_walls_s")}</span>
                  <span className="font-700 text-slate-300">{sf.area_walls_m2 ? sf.area_walls_m2.toFixed(1) + " m²" : "—"}</span>
                </div>
              </div>
            </div>
            {/* ── Détections personnalisées (visual search) ── */}
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
                        <span className="text-xs font-600 text-slate-300">×{det.count}</span>
                        {det.total_area_m2 !== null && (
                          <span className="text-xs text-slate-500">{det.total_area_m2.toFixed(2)} m²</span>
                        )}
                        <button
                          onClick={() => setCustomDetections(prev => prev.filter(d => d.id !== det.id))}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-600 hover:text-red-400 transition-all"
                          title={d("vs_delete")}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="border-t border-white/5 mt-1 pt-2 flex justify-between text-xs">
                    <span className="text-slate-500">{d("vs_area")}</span>
                    <span className="font-600 text-amber-400">
                      {(() => {
                        const total = customDetections.reduce((s, d) => s + (d.total_area_m2 ?? 0), 0);
                        const hasScale = customDetections.some(d => d.total_area_m2 !== null);
                        return hasScale ? `${total.toFixed(2)} m²` : "—";
                      })()}
                    </span>
                  </div>
                </div>
              </div>
            )}
            {/* ── Panneau pièces unifié (toujours visible si rooms existent) ── */}
            {displayRooms.length > 0 && (
              <div className="glass rounded-xl border border-white/10 p-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-600 text-slate-400 uppercase tracking-wide">{d("ed_rooms_det")}</h3>
                  <button onClick={() => setShowRooms(v => !v)} className="glass border border-white/10 rounded-lg p-1 text-slate-400 hover:text-white transition-colors">
                    {showRooms ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Room cards */}
                <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto pr-0.5">
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

                        {/* Row 1 — nom + surface + périmètre */}
                        <div
                          onClick={() => {
                            setSelectedRoomId(id => id === room.id ? null : room.id);
                            setEditingRoomId(room.id);
                            setActiveRoomType(room.type);
                          }}
                          className="flex items-center gap-2.5 px-3 pt-2.5 pb-1 cursor-pointer group"
                        >
                          <span className="w-3.5 h-3.5 rounded-full ring-1 ring-white/20 shrink-0" style={{ background: rcolor }} />
                          <span className={cn("text-sm font-medium flex-1 truncate", isSelected ? "text-white" : "text-slate-300")}>
                            {room.label_fr}
                          </span>
                          <div className="flex flex-col items-end gap-0">
                            <span className="text-xs text-slate-400 font-mono">
                              {room.area_m2 != null ? `${room.area_m2.toFixed(2)} m²` : "—"}
                            </span>
                            {rPerim != null && (
                              <span className="text-[10px] text-slate-600 font-mono">P {rPerim.toFixed(1)} m</span>
                            )}
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); sendEditRoom({ action: "delete_room", room_id: room.id }); }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-red-400 ml-0.5"
                            title={d("ed_delete_room")}
                          ><Trash2 className="w-3 h-3" /></button>
                        </div>

                        {/* Row 2 — type change + actions (when selected) */}
                        {isSelected && (
                          <div className="px-3 pb-2.5 pt-1 flex flex-col gap-2" onClick={e => e.stopPropagation()}>
                            {/* Type selector — color dots */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] text-slate-600 uppercase tracking-wide mr-0.5">{d("ed_type")}:</span>
                              {ROOM_TYPES.map(rt => (
                                <button key={rt.type}
                                  onClick={() => updateRoomLabel(room.id, rt.type, d(rt.i18nKey))}
                                  title={d(rt.i18nKey)}
                                  className={cn("w-5 h-5 rounded-full border-2 transition-all shrink-0",
                                    room.type === rt.type ? "border-white scale-110" : "border-transparent opacity-60 hover:opacity-100")}
                                  style={{ background: getRoomColor(rt.type) }}
                                />
                              ))}
                            </div>
                            {/* Actions — merge / split / delete */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                onClick={() => toast({ title: d("ed_mode_merge"), description: d("ed_mode_merge_d"), variant: "default" })}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors text-[10px]"
                              >
                                <Merge className="w-2.5 h-2.5" /> {d("ed_merge")}
                              </button>
                              <button
                                onClick={() => { setTool("split"); pts.current = []; toast({ title: d("ed_mode_split"), description: d("ed_mode_split_d"), variant: "default" }); }}
                                className={cn("flex items-center gap-1 px-2 py-1 rounded-lg border transition-colors text-[10px]",
                                  tool === "split" ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-red-500/30 text-red-400 hover:bg-red-500/10")}
                              >
                                <Scissors className="w-2.5 h-2.5" /> {d("ed_split")}
                              </button>
                              <span className="text-[9px] text-slate-600 ml-auto" title={d("hint_vertex")}>{d("ed_shift_merge")} · {d("hint_vertex")}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Totals */}
                {displayRooms.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/5 flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-slate-500">{d("ed_total_area")}</span>
                      <span className="font-mono text-sm text-white font-600">
                        {(() => {
                          const total = displayRooms.reduce((s, r) => s + (r.area_m2 ?? 0), 0);
                          return total > 0 ? `${total.toFixed(2)} m²` : "—";
                        })()}
                      </span>
                    </div>
                    {ppm && (
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">{d("ed_total_perim")}</span>
                        <span className="font-mono text-xs text-slate-400">
                          {(() => {
                            const total = displayRooms.reduce((s, r) => {
                              const p = r.perimeter_m != null ? r.perimeter_m
                                : (r.polygon_norm && imageNatural.w > 0
                                  ? polygonPerimeterM(r.polygon_norm, imageNatural.w, imageNatural.h, ppm)
                                  : 0);
                              return s + (p ?? 0);
                            }, 0);
                            return total > 0 ? `${total.toFixed(1)} m` : "—";
                          })()}
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

            {/* Ouvertures (visible uniquement en mode door/window) */}
            {(layer === "door" || layer === "window") && (
            <div className="glass rounded-xl border border-white/10 p-4 text-xs">
              <div className="flex items-center justify-between mb-2">
                <p className="font-600 text-slate-500">{d("ed_openings_det")}</p>
                {selectedOpeningIdx !== null && (
                  <button
                    onClick={() => setSelectedOpeningIdx(null)}
                    className="text-slate-600 hover:text-slate-400 transition-colors text-[10px]"
                  >{d("ed_deselect")}</button>
                )}
              </div>
              <div className="flex flex-col gap-1 max-h-52 overflow-y-auto pr-0.5">
                {result.openings?.map((o, i) => {
                  const isSelected = selectedOpeningIdx === i;
                  const color = o.class === "door" ? "purple" : "cyan";
                  return (
                    <div
                      key={i}
                      onClick={() => {
                        setSelectedOpeningIdx(prev => prev === i ? null : i);
                        setTool("select");
                      }}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all border",
                        isSelected
                          ? color === "purple"
                            ? "bg-purple-500/15 border-purple-500/40 text-white"
                            : "bg-cyan-500/15 border-cyan-500/40 text-white"
                          : "border-transparent text-slate-500 hover:bg-white/5 hover:text-slate-300"
                      )}
                    >
                      {/* Numbered badge */}
                      <span className={cn(
                        "w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0",
                        isSelected
                          ? color === "purple" ? "bg-purple-500/30 text-purple-300" : "bg-cyan-500/30 text-cyan-300"
                          : color === "purple" ? "bg-purple-500/15 text-purple-500" : "bg-cyan-500/15 text-cyan-500"
                      )}>
                        {i + 1}
                      </span>
                      {/* Label */}
                      <span className="flex-1 truncate">
                        {o.class === "door" ? d("door_lbl") : d("win_lbl")}
                      </span>
                      {/* Length */}
                      {o.length_m && (
                        <span className="text-slate-600 font-mono">{o.length_m.toFixed(2)}m</span>
                      )}
                      {/* Delete button — visible only when selected */}
                      {isSelected && (
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteOpening(i); }}
                          className="ml-0.5 p-0.5 rounded text-red-500 hover:text-red-300 hover:bg-red-500/15 transition-colors shrink-0"
                          title="Supprimer cette ouverture"
                          disabled={loading}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {(!result.openings || result.openings.length === 0) && (
                  <p className="text-slate-600">{d("ed_no_elem")}</p>
                )}
              </div>
              {/* Actions when selection active */}
              {selectedOpeningIdx !== null && result.openings?.[selectedOpeningIdx] && (
                <div className="mt-3 pt-3 border-t border-white/5">
                  <p className="mb-2 text-[10px] font-500 text-slate-500 uppercase tracking-wide">
                    #{selectedOpeningIdx + 1} — {d("ed_edit_mask")}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {/* Extend */}
                    <button
                      onClick={() => {
                        const o = result.openings![selectedOpeningIdx];
                        setLayer(o.class === "door" ? "door" : "window");
                        setTool("add_rect");
                        toast({ title: d("ed_mode_extend"), description: d("ed_mode_extend_d"), variant: "default" });
                      }}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors text-xs"
                    >
                      <span className="text-sm">＋</span> {d("ed_extend_mask")}
                    </button>
                    {/* Reduce */}
                    <button
                      onClick={() => {
                        const o = result.openings![selectedOpeningIdx];
                        setLayer(o.class === "door" ? "door" : "window");
                        setTool("erase_rect");
                        toast({ title: d("ed_mode_reduce"), description: d("ed_mode_reduce_d"), variant: "default" });
                      }}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-colors text-xs"
                    >
                      <span className="text-sm">－</span> {d("ed_reduce_mask")}
                    </button>
                    {/* Redraw from scratch */}
                    <button
                      onClick={() => {
                        const o = result.openings![selectedOpeningIdx];
                        setLayer(o.class === "door" ? "door" : "window");
                        setTool("add_poly");
                        toast({ title: d("ed_mode_poly"), description: d("ed_mode_poly_d"), variant: "default" });
                      }}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 transition-colors text-xs"
                    >
                      <PenLine className="w-3 h-3" /> {d("ed_trace_poly")}
                    </button>
                  </div>
                </div>
              )}
            </div>
            )}
          </div>
        </div>
      )}

      {/* ── MODE MÉTRÉ ── */}
      {mode === "measure" && (
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 min-w-0">
            {/* Toolbar mesure */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              {ppm ? (
                <span className="glass border border-white/5 rounded-lg px-2.5 py-1 font-mono text-xs text-accent">
                  {ppm.toFixed(1)} px/m — {d("ed_scale_ia")}
                </span>
              ) : (
                <span className="text-xs text-orange-400/80 glass border border-orange-500/20 rounded-lg px-3 py-1.5">
                  ⚠️ {d("ed_no_scale_warn")}
                </span>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                <button onClick={undoHistory} disabled={historyLen === 0}
                  className="glass border border-white/10 rounded-lg p-1.5 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                  title={d("hint_undo")}>
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={redoHistory} disabled={futureLen === 0}
                  className="glass border border-white/10 rounded-lg p-1.5 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                  title={d("hint_redo")}>
                  <Redo2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={exportMeasureCsv} disabled={zones.length === 0}
                  className="flex items-center gap-1.5 glass border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-40 transition-colors"
                  title="CSV">
                  <FileDown className="w-3.5 h-3.5" /> CSV
                </button>
                <button onClick={exportMeasurePdf} disabled={exportingMeasurePdf || zones.length === 0}
                  className="flex items-center gap-1.5 glass border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-40 transition-colors"
                  title={d("ed_quote_pdf")}>
                  {exportingMeasurePdf
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <FileDown className="w-3.5 h-3.5" />}
                  {exportingMeasurePdf ? d("ed_gen_pdf") : d("ed_quote_pdf")}
                </button>
              </div>
            </div>
            <MeasureCanvas
              imageB64={currentOverlay}
              imageMime="image/png"
              zones={zones}
              activeTypeId={activeTypeId}
              surfaceTypes={surfaceTypes}
              ppm={ppm}
              onZonesChange={setZones}
              onHistoryPush={pushHistory}
              onHistoryUndo={undoHistory}
              onHistoryRedo={redoHistory}
              canUndo={historyLen > 0}
              canRedo={futureLen > 0}
            />
          </div>

          <div className="lg:w-64 shrink-0">
            <SurfacePanel
              types={surfaceTypes}
              zones={zones}
              activeTypeId={activeTypeId}
              imageW={imageNatural.w}
              imageH={imageNatural.h}
              ppm={ppm}
              onTypesChange={setSurfaceTypes}
              onActiveTypeChange={setActiveTypeId}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}
