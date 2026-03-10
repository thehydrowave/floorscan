"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Download, RotateCcw, Loader2, AlertTriangle, PenLine, Layers, Undo2, Redo2, FileDown, MousePointer2, Trash2, Eye, EyeOff, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalysisResult, Room } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import MeasureCanvas from "@/components/measure/measure-canvas";
import SurfacePanel from "@/components/measure/surface-panel";
import { SurfaceType, MeasureZone, DEFAULT_SURFACE_TYPES, aggregateByType, aggregatePerimeterByType } from "@/lib/measure-types";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
type Layer = "door" | "window" | "interior" | "rooms";
type EditorTool = "add_rect" | "erase_rect" | "add_poly" | "erase_poly" | "sam" | "select";
type Mode = "editor" | "measure";

// ── Constantes pièces ──────────────────────────────────────────────────────────
const ROOM_TYPES: { type: string; label_fr: string }[] = [
  { type: "bedroom",      label_fr: "Chambre" },
  { type: "living room",  label_fr: "Séjour" },
  { type: "kitchen",      label_fr: "Cuisine" },
  { type: "bathroom",     label_fr: "Salle de bain" },
  { type: "hallway",      label_fr: "Couloir" },
  { type: "office",       label_fr: "Bureau" },
  { type: "wc",           label_fr: "WC" },
  { type: "dining room",  label_fr: "Salle à manger" },
  { type: "storage",      label_fr: "Rangement" },
  { type: "garage",       label_fr: "Garage" },
  { type: "balcony",      label_fr: "Balcon" },
  { type: "laundry",      label_fr: "Buanderie" },
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

interface EditorStepProps {
  sessionId: string;
  initialResult: AnalysisResult;
  onRestart: () => void;
  onSessionExpired?: () => void;
}

export default function EditorStep({ sessionId, initialResult, onRestart, onSessionExpired }: EditorStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [result, setResult] = useState(initialResult);
  const [mode, setMode] = useState<Mode>("editor");
  const [layer, setLayer] = useState<Layer>("door");
  const [tool, setTool] = useState<EditorTool>("add_rect");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  // Opening selection & highlight
  const [selectedOpeningIdx, setSelectedOpeningIdx] = useState<number | null>(null);
  const [showOpeningOverlay, setShowOpeningOverlay] = useState(true);

  // Overlays visibilité (murs / pièces)
  const [showWalls, setShowWalls] = useState(true);
  const [showRooms, setShowRooms] = useState(true);

  // Sélection / édition de pièce
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [editingRoomId, setEditingRoomId] = useState<number | null>(null);
  const [activeRoomType, setActiveRoomType] = useState<string>("bedroom");

  // Taille d'affichage de l'image (pour les SVG overlays)
  const [imgDisplaySize, setImgDisplaySize] = useState({ w: 0, h: 0 });

  // Measure state
  const [zones, setZones] = useState<MeasureZone[]>([]);
  const [surfaceTypes, setSurfaceTypes] = useState<SurfaceType[]>(DEFAULT_SURFACE_TYPES);
  const [activeTypeId, setActiveTypeId] = useState(DEFAULT_SURFACE_TYPES[0].id);
  const [imageNatural, setImageNatural] = useState({ w: 0, h: 0 });
  const [exportingMeasurePdf, setExportingMeasurePdf] = useState(false);

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
    const color = isErase ? "#F87171" : (layer === "interior" ? "#34D399" : layer === "door" ? "#D946EF" : "#22D3EE");
    if (pts.current.length > 0 && (tool === "add_poly" || tool === "erase_poly")) {
      const img = imgRef.current!;
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
        ctx.beginPath(); ctx.arc(sx, sy, 4, 0, 2 * Math.PI);
        ctx.fillStyle = "white"; ctx.fill();
      });
    }
  }, [tool, layer]);

  const sendEditRoom = async (params: any) => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${BACKEND}/edit-room-mask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, room_type: activeRoomType, ...params }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? "Erreur édition pièce");
      const data = await r.json();
      setResult(prev => ({
        ...prev,
        mask_rooms_b64: data.mask_rooms_b64 ?? prev.mask_rooms_b64,
        rooms: data.rooms ?? prev.rooms,
      }));
      toast({ title: "Pièce mise à jour ✓", variant: "success" });
    } catch (e: any) {
      if (e.message?.includes("Session introuvable")) {
        toast({ title: "Session expirée", description: "Veuillez recommencer l'upload.", variant: "error" });
        onSessionExpired?.();
      } else { setError(e.message); toast({ title: "Erreur", description: e.message, variant: "error" }); }
    } finally { setLoading(false); }
  };

  const sendEdit = async (params: any) => {
    if (layer === "rooms") { await sendEditRoom(params); return; }
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${BACKEND}/edit-mask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, layer, ...params }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? "Erreur édition");
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
      toast({ title: dt("ed_mask_updated", lang), variant: "success" });
    } catch (e: any) {
      if (e.message?.includes("Session introuvable")) {
        toast({ title: "Session expirée", description: "Le serveur a redémarré. Veuillez recommencer l'upload.", variant: "error" });
        onSessionExpired?.();
      } else {
        setError(e.message);
        toast({ title: "Error", description: e.message, variant: "error" });
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
      toast({ title: "Région segmentée ✓", variant: "success" });
    } catch (e: any) {
      if (e.message?.includes("Session introuvable")) {
        toast({ title: "Session expirée", description: "Le serveur a redémarré. Veuillez recommencer l'upload.", variant: "error" });
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
      toast({ title: "Ouverture supprimée ✓", variant: "success" });
    } catch (e: any) {
      if (e.message?.includes("Session introuvable")) {
        toast({ title: "Session expirée", description: "Le serveur a redémarré. Veuillez recommencer l'upload.", variant: "error" });
        onSessionExpired?.();
      } else {
        setError(e.message);
        toast({ title: "Erreur suppression", description: e.message, variant: "error" });
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
      if (!r.ok) throw new Error((await r.json()).detail ?? "Erreur");
      const data = await r.json();
      setResult(prev => ({ ...prev, rooms: data.rooms }));
      setEditingRoomId(null);
      toast({ title: "Type de pièce mis à jour", variant: "success" });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "error" });
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const rx = scaleX(e.clientX - rect.left);
    const ry = scaleY(e.clientY - rect.top);
    if (tool === "sam") { sendSam(Math.round(rx), Math.round(ry)); return; }
    if (tool === "select") {
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
    if (!drawing.current) return;
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const isErase = tool.startsWith("erase");
    const color = isErase ? "#F87171" : (layer === "interior" ? "#34D399" : layer === "door" ? "#D946EF" : "#22D3EE");
    const img = imgRef.current!;
    const x0 = startPt.current.x * img.offsetWidth / img.naturalWidth;
    const y0 = startPt.current.y * img.offsetHeight / img.naturalHeight;
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([4, 2]);
    ctx.fillStyle = color + "22";
    ctx.fillRect(x0, y0, e.clientX - rect.left - x0, e.clientY - rect.top - y0);
    ctx.strokeRect(x0, y0, e.clientX - rect.left - x0, e.clientY - rect.top - y0);
    ctx.setLineDash([]);
  };

  const handleMouseUp = async (e: React.MouseEvent<HTMLCanvasElement>) => {
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
    if (pts.current.length < 3) { toast({ title: "Minimum 3 points", variant: "error" }); return; }
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
      toast({ title: "Devis PDF exporté ✓", variant: "success" });
    } catch (e: any) {
      toast({ title: "Erreur export PDF", description: e.message, variant: "error" });
    } finally {
      setExportingMeasurePdf(false);
    }
  };

  const sf = result.surfaces ?? {};
  const ppm = result.pixels_per_meter ?? null;
  const editingRoom = editingRoomId !== null
    ? result.rooms?.find(r => r.id === editingRoomId) ?? null
    : null;

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
          <Button variant="ghost" onClick={onRestart}><RotateCcw className="w-4 h-4" /> {d("ed_restart")}</Button>
        </div>
      </div>

      {/* ── MODE ÉDITEUR ── */}
      {mode === "editor" && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          <div className="lg:col-span-3 flex flex-col gap-3">
            <div className="glass rounded-xl border border-white/10 p-3 flex gap-2 flex-wrap">
              <span className="text-xs text-slate-500 self-center font-mono mr-1">{d("ed_layer_lbl")}:</span>
              {(["door", "window", "interior", "rooms"] as Layer[]).map(l => (
                <button key={l} onClick={() => setLayer(l)}
                  className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all",
                    layer === l
                      ? l === "rooms" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-accent/40 bg-accent/10 text-accent"
                      : "border-white/10 text-slate-500 hover:text-slate-300")}>
                  {l === "door" ? `🚪 ${d("ed_doors")}` : l === "window" ? `🪟 ${d("ed_windows")}` : l === "interior" ? `🏠 ${d("ed_living_s")}` : `🏘️ Pièces`}
                </button>
              ))}
              {/* Sélecteur type de pièce (visible seulement en mode rooms) */}
              {layer === "rooms" && (
                <>
                  <div className="w-px bg-white/10 mx-1 self-stretch" />
                  <span className="text-xs text-slate-500 self-center font-mono mr-1">Type:</span>
                  <div className="flex gap-1 flex-wrap">
                    {ROOM_TYPES.slice(0, 8).map(rt => (
                      <button key={rt.type} onClick={() => setActiveRoomType(rt.type)}
                        title={rt.label_fr}
                        className={cn("w-6 h-6 rounded-full border-2 transition-all shrink-0",
                          activeRoomType === rt.type ? "border-white scale-110" : "border-transparent opacity-70 hover:opacity-100")}
                        style={{ background: getRoomColor(rt.type) }}
                      />
                    ))}
                  </div>
                  <span className="text-xs self-center px-2 py-1 rounded-lg bg-white/5 text-slate-300">
                    {ROOM_TYPES.find(rt => rt.type === activeRoomType)?.label_fr}
                  </span>
                </>
              )}
              <div className="w-px bg-white/10 mx-1 self-stretch" />
              <span className="text-xs text-slate-500 self-center font-mono mr-1">{d("ed_tool_lbl")}:</span>
              {([
                { id: "add_rect", label: "+ Rectangle" },
                { id: "erase_rect", label: "− Rectangle", erase: true },
                { id: "add_poly", label: "+ Polygone" },
                { id: "erase_poly", label: "− Polygone", erase: true },
                { id: "sam", label: "🪄 SAM auto", special: true },
                { id: "select", label: "Sélectionner", select: true },
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
              <div className="w-px bg-white/10 mx-1 self-stretch" />
              {/* Toggle opening number overlay */}
              <button
                onClick={() => setShowOpeningOverlay(v => !v)}
                title={showOpeningOverlay ? "Masquer les numéros" : "Afficher les numéros"}
                className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1",
                  showOpeningOverlay
                    ? "border-white/20 bg-white/5 text-white"
                    : "border-white/10 text-slate-500 hover:text-slate-300"
                )}
              >
                {showOpeningOverlay ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                {showOpeningOverlay ? "Numéros ON" : "Numéros OFF"}
              </button>
              {/* Toggles overlay murs / pièces */}
              <div className="w-px bg-white/10 mx-1 self-stretch" />
              <button
                onClick={() => setShowWalls(v => !v)}
                title={showWalls ? "Masquer les murs" : "Afficher les murs"}
                className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                  showWalls ? "border-orange-500/40 bg-orange-500/10 text-orange-400" : "border-white/10 text-slate-500 hover:text-slate-300")}>
                <Layers size={13} className={showWalls ? "" : "opacity-40"} />
                Murs
              </button>
              <button
                onClick={() => setShowRooms(v => !v)}
                title={showRooms ? "Masquer les pièces" : "Afficher les pièces"}
                className={cn("px-3 py-1.5 rounded-lg text-xs font-600 border transition-all flex items-center gap-1.5",
                  showRooms ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-white/10 text-slate-500 hover:text-slate-300")}>
                <LayoutGrid size={13} className={showRooms ? "" : "opacity-40"} />
                Pièces
              </button>
            </div>

            <div className="relative glass rounded-xl border border-white/10 overflow-hidden bg-white">
              {loading && (
                <div className="absolute inset-0 bg-ink/70 flex items-center justify-center z-20">
                  <Loader2 className="w-8 h-8 text-accent animate-spin" />
                </div>
              )}
              <img ref={imgRef} src={`data:image/png;base64,${currentOverlay}`} alt="Plan"
                className="w-full h-auto block max-h-[550px] object-contain"
                onLoad={updateImgDisplaySize} />

              {/* Masque coloré des pièces (RGBA semi-transparent) */}
              {showRooms && result.mask_rooms_b64 && (
                <img
                  src={`data:image/png;base64,${result.mask_rooms_b64}`}
                  alt=""
                  className="absolute top-0 left-0 w-full h-auto block max-h-[550px] object-contain pointer-events-none"
                  style={{ zIndex: 1 }}
                />
              )}

              {/* SVG overlay murs + pièces (zIndex:1, under openings overlay) */}
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
                  {showRooms && result.rooms?.map(room => {
                    const rcx = room.centroid_norm.x * imgDisplaySize.w;
                    const rcy = room.centroid_norm.y * imgDisplaySize.h;
                    const rcolor = getRoomColor(room.type);
                    const isSelected = selectedRoomId === room.id;
                    // Taille du label proportionnelle à la bbox de la pièce
                    const bboxW = room.bbox_norm.w * imgDisplaySize.w;
                    const bboxH = room.bbox_norm.h * imgDisplaySize.h;
                    const minDim = Math.min(bboxW, bboxH);
                    const fs = Math.max(7, Math.min(11, minDim * 0.14));
                    if (isSelected) {
                      // Pièce sélectionnée : label complet avec surface
                      const label = room.area_m2 != null
                        ? `${room.label_fr}  ${room.area_m2.toFixed(1)} m²`
                        : room.label_fr;
                      const pw = Math.max(70, label.length * 5.5);
                      return (
                        <g key={room.id}>
                          <rect x={rcx - pw/2} y={rcy - 13} width={pw} height={20} rx={4}
                            fill="rgba(10,16,32,0.92)" stroke={rcolor} strokeWidth={1.5} />
                          <text x={rcx} y={rcy + 2} textAnchor="middle"
                            fill={rcolor} fontSize={10} fontWeight="700" fontFamily="system-ui,sans-serif">
                            {label}
                          </text>
                        </g>
                      );
                    }
                    // Pièce non-sélectionnée : juste le nom en petit
                    const shortName = room.label_fr.length > 12
                      ? room.label_fr.slice(0, 10) + "…"
                      : room.label_fr;
                    const pw = Math.max(30, shortName.length * (fs * 0.6));
                    return (
                      <g key={room.id} opacity={0.85}>
                        <rect x={rcx - pw/2} y={rcy - fs * 0.85} width={pw} height={fs * 1.7} rx={3}
                          fill="rgba(10,16,32,0.70)" stroke={rcolor} strokeWidth={0.8} />
                        <text x={rcx} y={rcy + fs * 0.35} textAnchor="middle"
                          fill={rcolor} fontSize={fs} fontWeight="600" fontFamily="system-ui,sans-serif">
                          {shortName}
                        </text>
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

              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ cursor: tool === "select" ? "default" : "crosshair", zIndex: 10 }}
                onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} />
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
            {/* Éditeur de type de pièce */}
            {editingRoom && (
              <div className="glass rounded-xl border border-emerald-500/25 p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-600 text-emerald-400">Modifier le type</p>
                  <button onClick={() => setEditingRoomId(null)} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">✕</button>
                </div>
                <p className="text-xs text-slate-400 mb-2">
                  Actuel : <span style={{ color: getRoomColor(editingRoom.type) }}>{editingRoom.label_fr}</span>
                </p>
                <div className="flex flex-col gap-1 max-h-44 overflow-y-auto">
                  {ROOM_TYPES.map(rt => (
                    <button key={rt.type}
                      onClick={() => updateRoomLabel(editingRoom.id, rt.type, rt.label_fr)}
                      className={cn("flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all text-left",
                        editingRoom.type === rt.type ? "bg-white/10 text-white" : "hover:bg-white/5 text-slate-400 hover:text-slate-200")}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: getRoomColor(rt.type) }} />
                      {rt.label_fr}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Liste des pièces */}
            {result.rooms && result.rooms.length > 0 && (
              <div className="glass rounded-xl border border-white/10 p-4 text-xs text-slate-600">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-600 text-slate-500">Pièces détectées</p>
                  <button onClick={() => setShowRooms(v => !v)} className="text-slate-600 hover:text-slate-400 transition-colors">
                    {showRooms ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                </div>
                <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                  {result.rooms.map(room => (
                    <div key={room.id}
                      className={cn("flex items-center gap-2 p-1.5 rounded-lg cursor-pointer transition-all group",
                        selectedRoomId === room.id ? "bg-white/10" : "hover:bg-white/5")}
                      onClick={() => { setSelectedRoomId(id => id === room.id ? null : room.id); setEditingRoomId(room.id); }}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: getRoomColor(room.type) }} />
                      <span className="flex-1 text-slate-400">{room.label_fr}</span>
                      {room.area_m2 != null && <span className="text-slate-500">{room.area_m2.toFixed(1)} m²</span>}
                      <button
                        onClick={e => { e.stopPropagation(); sendEditRoom({ action: "delete_room", room_id: room.id }); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-red-500/70 hover:text-red-400 ml-1"
                        title="Supprimer cette pièce"
                      ><Trash2 size={11} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="glass rounded-xl border border-white/10 p-4 text-xs">
              <div className="flex items-center justify-between mb-2">
                <p className="font-600 text-slate-500">{d("ed_openings_det")}</p>
                {selectedOpeningIdx !== null && (
                  <button
                    onClick={() => setSelectedOpeningIdx(null)}
                    className="text-slate-600 hover:text-slate-400 transition-colors text-[10px]"
                  >Désélectionner</button>
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
                    #{selectedOpeningIdx + 1} — Modifier le masque
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {/* Extend */}
                    <button
                      onClick={() => {
                        const o = result.openings![selectedOpeningIdx];
                        setLayer(o.class === "door" ? "door" : "window");
                        setTool("add_rect");
                        toast({ title: "Mode Étendre actif", description: "Dessinez un rectangle sur la zone à ajouter au masque.", variant: "default" });
                      }}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors text-xs"
                    >
                      <span className="text-sm">＋</span> Étendre le masque
                    </button>
                    {/* Reduce */}
                    <button
                      onClick={() => {
                        const o = result.openings![selectedOpeningIdx];
                        setLayer(o.class === "door" ? "door" : "window");
                        setTool("erase_rect");
                        toast({ title: "Mode Réduire actif", description: "Dessinez un rectangle sur la zone à retirer du masque.", variant: "default" });
                      }}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-colors text-xs"
                    >
                      <span className="text-sm">－</span> Réduire le masque
                    </button>
                    {/* Redraw from scratch */}
                    <button
                      onClick={() => {
                        const o = result.openings![selectedOpeningIdx];
                        setLayer(o.class === "door" ? "door" : "window");
                        setTool("add_poly");
                        toast({ title: "Mode Polygone actif", description: "Tracez un nouveau contour précis autour de l'ouverture.", variant: "default" });
                      }}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 transition-colors text-xs"
                    >
                      <PenLine className="w-3 h-3" /> Tracer au polygone
                    </button>
                  </div>
                </div>
              )}
            </div>
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
                  title="Annuler (Ctrl+Z)">
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={redoHistory} disabled={futureLen === 0}
                  className="glass border border-white/10 rounded-lg p-1.5 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                  title="Rétablir (Ctrl+Y)">
                  <Redo2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={exportMeasurePdf} disabled={exportingMeasurePdf || zones.length === 0}
                  className="flex items-center gap-1.5 glass border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-40 transition-colors"
                  title="Exporter devis PDF">
                  {exportingMeasurePdf
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <FileDown className="w-3.5 h-3.5" />}
                  {exportingMeasurePdf ? "Génération…" : "Devis PDF"}
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
