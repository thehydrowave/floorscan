"use client";

import { useRef, useState, useEffect, useCallback, useLayoutEffect, useMemo, type ElementType } from "react";
import { motion } from "framer-motion";
import { Download, RotateCcw, Loader2, AlertTriangle, PenLine, Layers, Undo2, Redo2, FileDown, MousePointer2, Trash2, Eye, EyeOff, LayoutGrid, Scissors, Merge, Search, X, Save, Plus, ZoomIn, ZoomOut, Magnet, ChevronDown, Square, Eraser, DoorOpen, AppWindow, Maximize2, Sparkles, Check, Columns2, BrickWall, SeparatorVertical, Home, Hash, PenOff, PaintBucket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalysisResult, Room, VisualSearchMatch, CustomDetection } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import MeasureCanvas from "@/components/measure/measure-canvas";
import SurfacePanel from "@/components/measure/surface-panel";
import { SurfaceType, MeasureZone, DEFAULT_SURFACE_TYPES, ROOM_SURFACE_TYPES, EMPRISE_TYPE, aggregateByType, aggregatePerimeterByType, polygonPerimeterM, pointInPolygon as pointInPolygonObj, polygonAreaNorm } from "@/lib/measure-types";
import type { WallSegment } from "@/lib/types";
import { snapIntelligent, SnapResult, SnapConfig, DEFAULT_SNAP_CONFIG } from "@/lib/snap-engine";

import { BACKEND } from "@/lib/backend";
import { getRoomColor } from "@/lib/room-colors";
type Layer = "door" | "window" | "french_door" | "interior" | "rooms" | "wall" | "cloison" | null;
type EditorTool = "add_rect" | "erase_rect" | "add_poly" | "erase_poly" | "sam" | "select" | "split" | "visual_search";
type Mode = "editor" | "measure";

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

function pointInPolygon(x: number, y: number, polygon: { x: number; y: number }[]): boolean {
  return pointInPolygonObj({ x, y }, polygon);
}

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
    if (dist < bestDist) { bestDist = dist; bestX = cx / dispW; bestY = cy / dispH; }
  }
  if (bestDist <= threshold) return { x: bestX, y: bestY, snapped: true };
  return { x: normX, y: normY, snapped: false };
}

function edgeLengthM(p1: { x: number; y: number }, p2: { x: number; y: number }, natW: number, natH: number, ppm: number): number {
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
  const [layer, setLayer] = useState<Layer>(null);
  const [tool, setTool] = useState<EditorTool>("add_rect");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingDxf, setExportingDxf] = useState(false);
  const [roomHistoryLen, setRoomHistoryLen] = useState(0);
  const [roomFutureLen, setRoomFutureLen] = useState(0);

  const [selectedOpeningIdx, setSelectedOpeningIdx] = useState<number | null>(null);
  const [showOpeningOverlay, setShowOpeningOverlay] = useState(false);

  const [showWalls, setShowWalls] = useState(false);
  const [showRooms, setShowRooms] = useState(false);
  const [showDoors, setShowDoors] = useState(true);
  const [showWindows, setShowWindows] = useState(true);
  const [showFrenchDoors, setShowFrenchDoors] = useState(false);
  // ── Surface zones visibility toggle ──
  const [showSurfaces, setShowSurfaces] = useState(true);

  const [editHistoryLen, setEditHistoryLen] = useState(0);
  const [editFutureLen, setEditFutureLen] = useState(0);

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

  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [editingRoomId, setEditingRoomId] = useState<number | null>(null);
  const [activeRoomType, setActiveRoomType] = useState<string>("bedroom");

  useEffect(() => {
    if (layer === null) {
      pts.current = [];
      setTool("add_rect");
      setSelectedRoomId(null);
      setEditingRoomId(null);
      return;
    }
    setShowDoors(layer === "door");
    setShowWindows(layer === "window");
    setShowFrenchDoors(layer === "french_door");
    setShowWalls(layer === "wall" || layer === "cloison");
    setShowRooms(layer === "rooms");
    if (layer === "rooms") {
      setTool("select");
    } else {
      if (tool === "select" || tool === "split") setTool("add_rect");
      if (tool === "sam" && layer !== "door" && layer !== "window" && layer !== "interior") setTool("add_rect");
      pts.current = [];
    }
    if (layer !== "rooms") {
      setSelectedRoomId(null);
      setEditingRoomId(null);
    }
  }, [layer]); // eslint-disable-line react-hooks/exhaustive-deps

  const [dragRoomVertex, setDragRoomVertex] = useState<{ roomId: number; idx: number } | null>(null);
  const [localRooms, setLocalRooms] = useState<Room[] | null>(null);
  const [snappedVertex, setSnappedVertex] = useState(false);
  const [snapConfig, setSnapConfig] = useState<SnapConfig>(DEFAULT_SNAP_CONFIG);
  const [snapResult, setSnapResult] = useState<SnapResult | null>(null);
  const snapConfigRef = useRef<SnapConfig>(DEFAULT_SNAP_CONFIG);
  useEffect(() => { snapConfigRef.current = snapConfig; }, [snapConfig]);
  const dragRoomVertexRef = useRef<{ roomId: number; idx: number } | null>(null);
  const localRoomsRef = useRef<Room[] | null>(null);

  const [imgDisplaySize, setImgDisplaySize] = useState({ w: 0, h: 0 });

  const [zones, setZones] = useState<MeasureZone[]>([]);
  const [surfaceTypes, setSurfaceTypes] = useState<SurfaceType[]>(DEFAULT_SURFACE_TYPES);
  const [activeTypeId, setActiveTypeId] = useState(DEFAULT_SURFACE_TYPES[0].id);
  const [panelMode, setPanelMode] = useState<"metre" | "rooms" | "linear" | "count">("metre");
  const [sidebarTab, setSidebarTab] = useState<"results" | "rooms" | "visibility">("results");
  const [exportOpen, setExportOpen] = useState(false);
  const allMeasureTypes = useMemo(() => [...surfaceTypes, ...ROOM_SURFACE_TYPES, EMPRISE_TYPE], [surfaceTypes]);
  const handlePanelModeChange = useCallback((mode: "metre" | "rooms" | "linear" | "count") => {
    setPanelMode(mode);
    if (mode === "rooms") setActiveTypeId(ROOM_SURFACE_TYPES[0].id);
    else if (mode === "metre") setActiveTypeId(surfaceTypes[0]?.id || DEFAULT_SURFACE_TYPES[0].id);
  }, [surfaceTypes]);
  const [imageNatural, setImageNatural] = useState({ w: 0, h: 0 });
  const [exportingMeasurePdf, setExportingMeasurePdf] = useState(false);

  const [vsMatches, setVsMatches] = useState<VisualSearchMatch[]>([]);
  const [vsSearching, setVsSearching] = useState(false);
  const [vsCrop, setVsCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const vsDrawing = useRef(false);
  const vsStart = useRef({ x: 0, y: 0 });
  const [vsSaveLabel, setVsSaveLabel] = useState("");
  const [vsSaveOpen, setVsSaveOpen] = useState(false);
  const [vsEditMode, setVsEditMode] = useState<"search" | "add" | "remove">("search");
  const [customDetections, setCustomDetections] = useState<CustomDetection[]>(initialCustomDetections ?? []);

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

  const updateImgDisplaySize = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setImgDisplaySize({ w: img.offsetWidth, h: img.offsetHeight });
  }, []);

  useEffect(() => {
    window.addEventListener("resize", updateImgDisplaySize);
    return () => window.removeEventListener("resize", updateImgDisplaySize);
  }, [updateImgDisplaySize]);

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
      setTranslate(t => ({ x: cx * (1 - ratio) + t.x * ratio, y: cy * (1 - ratio) + t.y * ratio }));
      return newZ;
    });
  }, []);

  useEffect(() => {
    const el = zoomContainerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheelZoom, { passive: false });
    return () => el.removeEventListener("wheel", handleWheelZoom);
  }, [handleWheelZoom]);

  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const pts = useRef<[number, number][]>([]);
  const startPt = useRef({ x: 0, y: 0 });

  const currentOverlay =
    (layer === "wall" || layer === "cloison") ? result.plan_b64!
    : layer === "interior" && result.overlay_interior_b64 ? result.overlay_interior_b64
    : result.plan_b64 ?? result.overlay_openings_b64!;

  useEffect(() => {
    const img = new Image();
    img.onload = () => setImageNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = `data:image/png;base64,${currentOverlay}`;
  }, [currentOverlay]);

  useEffect(() => {
    const img = imgRef.current;
    const cv = canvasRef.current;
    if (!img || !cv) return;
    const sync = () => { cv.width = img.offsetWidth; cv.height = img.offsetHeight; updateImgDisplaySize(); };
    if (img.complete) sync();
    else img.onload = sync;
    const ro = new ResizeObserver(sync);
    ro.observe(img);
    return () => ro.disconnect();
  }, [currentOverlay, updateImgDisplaySize]);

  const resultRoomsRef = useRef(result.rooms);
  const resultWallsRef = useRef(result.walls);
  const imageNaturalRef = useRef(imageNatural);
  const ppmRef = useRef<number | null>(result.pixels_per_meter ?? null);
  const imgDisplaySizeRef = useRef(imgDisplaySize);
  resultRoomsRef.current = result.rooms;
  resultWallsRef.current = result.walls;
  imageNaturalRef.current = imageNatural;
  imgDisplaySizeRef.current = imgDisplaySize;

  const sendEditRoomRef = useRef<(params: any) => Promise<void>>(async () => {});

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
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
        const xs = newPoly.map(p => p.x), ys = newPoly.map(p => p.y);
        const bx = Math.min(...xs), by = Math.min(...ys);
        const bbox_norm = { x: bx, y: by, w: Math.max(...xs) - bx, h: Math.max(...ys) - by };
        return { ...room, polygon_norm: newPoly, area_m2: areaM2, perimeter_m: perimeterM, centroid_norm: { x: cx, y: cy }, bbox_norm };
      });
      localRoomsRef.current = updated;
      setLocalRooms(updated);
    };

    const onUp = (e: MouseEvent) => {
      if (e.button === 2) { isPanRef.current = false; setPanCursor(false); return; }
      const dv = dragRoomVertexRef.current;
      if (e.button !== 0 || !dv) return;
      const rooms = localRoomsRef.current;
      dragRoomVertexRef.current = null;
      setDragRoomVertex(null);
      setSnappedVertex(false);
      setSnapResult(null);
      if (rooms) setResult(prev => ({ ...prev, rooms }));
      localRoomsRef.current = null;
      setLocalRooms(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== "editor") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (layer === "rooms") sendUndoRoom(); else sendUndoMask();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        if (layer === "rooms") sendRedoRoom(); else sendRedoMask();
      }
      if (e.key === "Escape" && tool === "split") { pts.current = []; drawCanvas(); setTool("select"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function scaleX(px: number) { const img = imgRef.current!; return px * img.naturalWidth / img.offsetWidth; }
  function scaleY(py: number) { const img = imgRef.current!; return py * img.naturalHeight / img.offsetHeight; }
  function mouseToCanvas(clientX: number, clientY: number) {
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    return { x: (clientX - rect.left) * (cv.width / rect.width), y: (clientY - rect.top) * (cv.height / rect.height) };
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
      if (pts.current.length >= 3) {
        ctx.beginPath();
        pts.current.forEach(([px, py], i) => {
          const sx = px * img.offsetWidth / img.naturalWidth;
          const sy = py * img.offsetHeight / img.naturalHeight;
          if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        });
        ctx.closePath();
        ctx.fillStyle = color + "28"; ctx.fill();
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
    if (tool === "split" && pts.current.length > 0) {
      const img = imgRef.current!;
      ctx.setLineDash([6, 4]); ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 2.5;
      ctx.beginPath();
      pts.current.forEach(([px, py], i) => {
        const sx = px * img.offsetWidth / img.naturalWidth;
        const sy = py * img.offsetHeight / img.naturalHeight;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.stroke(); ctx.setLineDash([]);
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
      setResult(prev => ({ ...prev, mask_rooms_b64: data.mask_rooms_b64 ?? prev.mask_rooms_b64, rooms: data.rooms ?? prev.rooms }));
      if (data.history_len != null) setRoomHistoryLen(data.history_len);
      if (data.future_len != null) setRoomFutureLen(data.future_len);
      if (params.action !== "replace_polygon") { setSelectedRoomId(null); setEditingRoomId(null); }
      toast({ title: d("ed_room_updated"), variant: "success" });
    } catch (e: any) {
      if (e.message?.includes("Session introuvable")) {
        toast({ title: d("ed_session_exp"), description: d("ed_session_msg"), variant: "error" });
        onSessionExpired?.();
      } else { setError(e.message); toast({ title: d("ed_err"), description: e.message, variant: "error" }); }
    } finally { setLoading(false); }
  };
  sendEditRoomRef.current = sendEditRoom;

  const sendUndoRoom = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND}/undo-room-mask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId }) });
      if (!r.ok) throw new Error((await r.json()).detail ?? d("ed_err"));
      const data = await r.json();
      setResult(prev => ({ ...prev, mask_rooms_b64: data.mask_rooms_b64 ?? prev.mask_rooms_b64, rooms: data.rooms ?? prev.rooms }));
      setRoomHistoryLen(data.history_len ?? 0); setRoomFutureLen(data.future_len ?? 0);
      toast({ title: d("ed_undone"), variant: "success" });
    } catch (e: any) { toast({ title: d("ed_err"), description: e.message, variant: "error" }); }
    finally { setLoading(false); }
  };

  const sendRedoRoom = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND}/redo-room-mask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId }) });
      if (!r.ok) throw new Error((await r.json()).detail ?? d("ed_err"));
      const data = await r.json();
      setResult(prev => ({ ...prev, mask_rooms_b64: data.mask_rooms_b64 ?? prev.mask_rooms_b64, rooms: data.rooms ?? prev.rooms }));
      setRoomHistoryLen(data.history_len ?? 0); setRoomFutureLen(data.future_len ?? 0);
      toast({ title: d("ed_redone"), variant: "success" });
    } catch (e: any) { toast({ title: d("ed_err"), description: e.message, variant: "error" }); }
    finally { setLoading(false); }
  };

  const handleExportDxf = async () => {
    setExportingDxf(true);
    try {
      const r = await fetch(`${BACKEND}/export-dxf`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId }) });
      if (!r.ok) throw new Error((await r.json()).detail ?? d("ed_err"));
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "floorscan_export.dxf"; a.click();
      URL.revokeObjectURL(url);
      toast({ title: d("ed_dxf_ok"), variant: "success" });
    } catch (e: any) { toast({ title: d("ed_dxf_err"), description: e.message, variant: "error" }); }
    finally { setExportingDxf(false); }
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
      } else { setError(e.message); toast({ title: d("ed_err"), description: e.message, variant: "error" }); }
    } finally { setLoading(false); }
  };

  const sendUndoMask = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND}/undo-edit-mask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId }) });
      if (!r.ok) throw new Error((await r.json()).detail ?? d("ed_err"));
      const data = await r.json();
      setResult(prev => ({
        ...prev,
        overlay_openings_b64: data.overlay_openings_b64 ?? prev.overlay_openings_b64,
        overlay_interior_b64: data.overlay_interior_b64 ?? prev.overlay_interior_b64,
        mask_doors_b64: data.mask_doors_b64 ?? prev.mask_doors_b64,
        mask_windows_b64: data.mask_windows_b64 ?? prev.mask_windows_b64,
        mask_walls_b64: data.mask_walls_b64 ?? prev.mask_walls_b64,
        mask_walls_pixel_b64: data.mask_walls_pixel_b64 ?? prev.mask_walls_pixel_b64,
        mask_cloisons_b64: data.mask_cloisons_b64 ?? prev.mask_cloisons_b64,
        mask_french_doors_b64: data.mask_french_doors_b64 ?? prev.mask_french_doors_b64,
        doors_count: data.doors_count ?? prev.doors_count,
        windows_count: data.windows_count ?? prev.windows_count,
        french_doors_count: data.french_doors_count ?? prev.french_doors_count,
        surfaces: data.surfaces ?? prev.surfaces,
        openings: data.openings ?? prev.openings,
        rooms: data.rooms ?? prev.rooms,
        walls: data.walls ?? prev.walls,
      }));
      setEditHistoryLen(data.edit_history_len ?? 0); setEditFutureLen(data.edit_future_len ?? 0);
      toast({ title: d("ed_undone"), variant: "success" });
    } catch (e: any) { toast({ title: d("ed_err"), description: e.message, variant: "error" }); }
    finally { setLoading(false); }
  };

  const sendRedoMask = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND}/redo-edit-mask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId }) });
      if (!r.ok) throw new Error((await r.json()).detail ?? d("ed_err"));
      const data = await r.json();
      setResult(prev => ({
        ...prev,
        overlay_openings_b64: data.overlay_openings_b64 ?? prev.overlay_openings_b64,
        overlay_interior_b64: data.overlay_interior_b64 ?? prev.overlay_interior_b64,
        mask_doors_b64: data.mask_doors_b64 ?? prev.mask_doors_b64,
        mask_windows_b64: data.mask_windows_b64 ?? prev.mask_windows_b64,
        mask_walls_b64: data.mask_walls_b64 ?? prev.mask_walls_b64,
        mask_walls_pixel_b64: data.mask_walls_pixel_b64 ?? prev.mask_walls_pixel_b64,
        mask_cloisons_b64: data.mask_cloisons_b64 ?? prev.mask_cloisons_b64,
        mask_french_doors_b64: data.mask_french_doors_b64 ?? prev.mask_french_doors_b64,
        doors_count: data.doors_count ?? prev.doors_count,
        windows_count: data.windows_count ?? prev.windows_count,
        french_doors_count: data.french_doors_count ?? prev.french_doors_count,
        surfaces: data.surfaces ?? prev.surfaces,
        openings: data.openings ?? prev.openings,
        rooms: data.rooms ?? prev.rooms,
        walls: data.walls ?? prev.walls,
      }));
      setEditHistoryLen(data.edit_history_len ?? 0); setEditFutureLen(data.edit_future_len ?? 0);
      toast({ title: d("ed_redone"), variant: "success" });
    } catch (e: any) { toast({ title: d("ed_err"), description: e.message, variant: "error" }); }
    finally { setLoading(false); }
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
      setResult(prev => ({ ...prev, ...data, rooms: data.rooms ?? prev.rooms, walls: data.walls ?? prev.walls }));
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

  const deleteOpening = useCallback(async (idx: number) => {
    const o = result.openings?.[idx];
    if (!o) return;
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${BACKEND}/edit-mask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, layer: o.class === "door" ? "door" : "window", action: "erase_rect", x0: Math.round(o.x_px), y0: Math.round(o.y_px), x1: Math.round(o.x_px + o.width_px), y1: Math.round(o.y_px + o.height_px) }),
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
      } else { setError(e.message); toast({ title: d("ed_opening_err"), description: e.message, variant: "error" }); }
    } finally { setLoading(false); }
  }, [result.openings, sessionId, onSessionExpired]);

  const updateRoomLabel = async (roomId: number, newType: string, newLabelFr: string) => {
    try {
      const r = await fetch(`${BACKEND}/update-room-label`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, room_id: roomId, new_type: newType, new_label_fr: newLabelFr }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? d("ed_err"));
      const data = await r.json();
      setResult(prev => ({ ...prev, rooms: data.rooms }));
      setEditingRoomId(null);
      toast({ title: d("ed_room_type_ok"), variant: "success" });
    } catch (e: any) { toast({ title: d("ed_err"), description: e.message, variant: "error" }); }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    if (layer === null) return;
    const mc = mouseToCanvas(e.clientX, e.clientY);
    const rx = scaleX(mc.x);
    const ry = scaleY(mc.y);
    if (tool === "sam") { sendSam(Math.round(rx), Math.round(ry)); return; }
    if (tool === "visual_search") {
      const img = imgRef.current!;
      const normX = rx / img.naturalWidth;
      const normY = ry / img.naturalHeight;
      if (vsEditMode === "remove" && vsMatches.length > 0) {
        const hitIdx = vsMatches.findIndex(m => normX >= m.x_norm && normX <= m.x_norm + m.w_norm && normY >= m.y_norm && normY <= m.y_norm + m.h_norm);
        if (hitIdx >= 0) { setVsMatches(prev => prev.filter((_, i) => i !== hitIdx)); toast({ title: d("vs_removed"), variant: "default" }); }
        return;
      }
      vsDrawing.current = true;
      vsStart.current = { x: normX * 100, y: normY * 100 };
      setVsCrop({ x: normX * 100, y: normY * 100, w: 0, h: 0 });
      return;
    }
    if (tool === "split" && layer === "rooms") {
      pts.current.push([rx, ry]); drawCanvas();
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
      if (layer === "rooms") {
        const img = imgRef.current!;
        const normX = rx / img.naturalWidth;
        const normY = ry / img.naturalHeight;
        let hitRoom: Room | null = null;
        for (const room of (result.rooms ?? [])) {
          if (room.polygon_norm && pointInPolygon(normX, normY, room.polygon_norm)) { hitRoom = room; break; }
        }
        if (hitRoom && e.shiftKey && selectedRoomId !== null && hitRoom.id !== selectedRoomId) {
          sendEditRoom({ action: "merge_rooms", room_id: selectedRoomId, room_id_b: hitRoom.id }); return;
        }
        if (hitRoom) { setSelectedRoomId(prev => prev === hitRoom!.id ? null : hitRoom!.id); setEditingRoomId(hitRoom.id); setActiveRoomType(hitRoom.type); }
        else { setSelectedRoomId(null); setEditingRoomId(null); }
        return;
      }
      let bestIdx = -1, bestDist = Infinity;
      result.openings?.forEach((o, i) => {
        const inside = rx >= o.x_px && rx <= o.x_px + o.width_px && ry >= o.y_px && ry <= o.y_px + o.height_px;
        if (inside) { if (0 < bestDist) { bestDist = 0; bestIdx = i; } }
        else {
          const cx = o.x_px + o.width_px / 2, cy = o.y_px + o.height_px / 2;
          const dist = Math.hypot(cx - rx, cy - ry);
          if (dist < bestDist) { bestDist = dist; bestIdx = i; }
        }
      });
      if (bestIdx >= 0 && (bestDist === 0 || bestDist < 150)) setSelectedOpeningIdx(prev => prev === bestIdx ? null : bestIdx);
      else setSelectedOpeningIdx(null);
      return;
    }
    if (tool === "add_poly" || tool === "erase_poly") { pts.current.push([rx, ry]); drawCanvas(); return; }
    drawing.current = true;
    startPt.current = { x: rx, y: ry };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (vsDrawing.current && tool === "visual_search") {
      const mc = mouseToCanvas(e.clientX, e.clientY);
      const img = imgRef.current!;
      const rx = scaleX(mc.x), ry = scaleY(mc.y);
      const pctX = (rx / img.naturalWidth) * 100, pctY = (ry / img.naturalHeight) * 100;
      const sx = vsStart.current.x, sy = vsStart.current.y;
      setVsCrop({ x: Math.max(0, Math.min(sx, pctX)), y: Math.max(0, Math.min(sy, pctY)), w: Math.min(100, Math.abs(pctX - sx)), h: Math.min(100, Math.abs(pctY - sy)) });
      return;
    }
    if (!drawing.current) return;
    const cv = canvasRef.current!;
    const mc = mouseToCanvas(e.clientX, e.clientY);
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const isErase = tool.startsWith("erase");
    const roomColorMv = layer === "rooms" ? getRoomColor(activeRoomType) : null;
    const color = isErase ? "#F87171" : (roomColorMv ?? (layer === "interior" ? "#34