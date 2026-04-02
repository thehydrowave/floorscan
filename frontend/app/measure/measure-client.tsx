"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ScanLine, ArrowLeft, Upload, Ruler, PenLine, BarChart3, Loader2, ImageIcon, FileDown, BookOpen, ChevronLeft, ChevronRight, FileText, PlusCircle, Download, FolderOpen, Layers, Plus, X, RotateCcw, FileBox, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import ScaleStep from "@/components/demo/scale-step";
import MeasureCanvas from "@/components/measure/measure-canvas";
import SurfacePanel from "@/components/measure/surface-panel";
import MeasureCropStep from "@/components/measure/measure-crop-step";
import MarkupsList from "@/components/measure/markups-list";
import { SurfaceType, MeasureZone, PlanSnapshot, DEFAULT_SURFACE_TYPES, ROOM_SURFACE_TYPES, EMPRISE_TYPE, aggregateByType, aggregatePerimeterByType, polygonAreaPx, polygonPerimeterM, LinearCategory, LinearMeasure, CountGroup, CountPoint, DEFAULT_LINEAR_CATEGORIES, DEFAULT_COUNT_GROUPS, AngleMeasurement, CircleMeasure, DisplayUnit, TextAnnotation, MarkupAnnotation, MarkupGroup, MeasureLayer, DEFAULT_LAYERS } from "@/lib/measure-types";
import LangSwitcher from "@/components/ui/lang-switcher";
import ThemeSwitcher from "@/components/ui/theme-switcher";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import type { VisualSearchMatch, CustomDetection } from "@/lib/types";

import { BACKEND } from "@/lib/backend";
const STORAGE_KEY = "floorscan_project_v2";

// ── Rendu canvas : plan annoté avec zones colorées + labels ──────────────────
async function renderAnnotatedPlan(
  imageB64: string,
  imageMime: string,
  zones: MeasureZone[],
  surfaceTypes: SurfaceType[],
  ppm: number | null,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);

      const hexRgb = (hex: string): [number, number, number] => [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
      ];

      // Helper: rounded rect path
      const rrect = (x: number, y: number, w: number, h: number, r: number) => {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);  ctx.arcTo(x + w, y,     x + w, y + r,     r);
        ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r,  y + h);  ctx.arcTo(x,     y + h, x,     y + h - r, r);
        ctx.lineTo(x,      y + r);  ctx.arcTo(x,     y,     x + r, y,         r);
        ctx.closePath();
      };

      const W = img.naturalWidth;
      const H = img.naturalHeight;

      for (const zone of zones) {
        const type  = surfaceTypes.find(t => t.id === zone.typeId);
        const hex   = type?.color ?? "#6B7280";
        const [r, g, b] = hexRgb(hex);
        const pts   = zone.points.map(p => ({ x: p.x * W, y: p.y * H }));
        if (pts.length < 3) continue;

        // ── Polygon fill + stroke ─────────────────────────────────────────
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.fillStyle   = `rgba(${r},${g},${b},0.32)`;
        ctx.fill();
        ctx.strokeStyle = hex;
        ctx.lineWidth   = Math.max(2.5, W / 400);
        (ctx as any).lineJoin = "round";
        ctx.stroke();

        // ── Label au centroïde ────────────────────────────────────────────
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const zoneName = zone.name || type?.name || zone.typeId;

        // Surface
        let areaPx = 0;
        for (let j = 0; j < zone.points.length; j++) {
          const k = (j + 1) % zone.points.length;
          areaPx += zone.points[j].x * W * zone.points[k].y * H;
          areaPx -= zone.points[k].x * W * zone.points[j].y * H;
        }
        areaPx = Math.abs(areaPx) / 2;
        const areaM2    = ppm ? areaPx / ppm ** 2 : null;
        const areaLabel = areaM2 !== null ? `${areaM2.toFixed(2)} m\u00b2` : null;

        // Dimensions du label
        const fs  = Math.max(14, Math.min(W / 52, 42));
        const pad = fs * 0.5;
        ctx.font = `bold ${fs}px system-ui, sans-serif`;
        const tw1 = ctx.measureText(zoneName).width;
        ctx.font = `${Math.round(fs * 0.85)}px monospace`;
        const tw2 = areaLabel ? ctx.measureText(areaLabel).width : 0;
        const bw  = Math.max(tw1, tw2) + pad * 2;
        const bh  = areaLabel ? fs * 2.6 : fs * 1.8;

        // Background
        rrect(cx - bw / 2, cy - bh / 2, bw, bh, 5);
        ctx.fillStyle   = "rgba(0,0,0,0.70)";
        ctx.fill();
        ctx.strokeStyle = hex;
        ctx.lineWidth   = 1.5;
        ctx.stroke();

        // Texte
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.font         = `bold ${fs}px system-ui, sans-serif`;
        ctx.fillStyle    = "#ffffff";
        ctx.fillText(zoneName, cx, areaLabel ? cy - fs * 0.65 : cy);
        if (areaLabel) {
          ctx.font      = `${Math.round(fs * 0.85)}px monospace`;
          ctx.fillStyle = hex;
          ctx.fillText(areaLabel, cx, cy + fs * 0.75);
        }
      }
      resolve(canvas.toDataURL("image/png").split(",")[1]);
    };
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = `data:${imageMime};base64,${imageB64}`;
  });
}

export default function MeasureClient({ embedded = false }: { embedded?: boolean }) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const STEP_LABELS = [d("me_step_import"), d("cr_title"), d("me_step_scale"), d("me_step_survey"), d("me_step_results")];
  const [step, setStep] = useState(0);

  // Image state
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState("image/png");
  const [imageNatural, setImageNatural] = useState({ w: 0, h: 0 });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Multi-page PDF state
  const [pageCount, setPageCount] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [awaitingPage, setAwaitingPage] = useState(false);

  // Scale
  const [ppm, setPpm] = useState<number | null>(null);

  // Measure state
  const [zones, setZones] = useState<MeasureZone[]>([]);
  const [surfaceTypes, setSurfaceTypes] = useState<SurfaceType[]>(DEFAULT_SURFACE_TYPES);
  const [activeTypeId, setActiveTypeId] = useState(DEFAULT_SURFACE_TYPES[0].id);

  // Room panel mode
  const [panelMode, setPanelMode] = useState<"metre" | "rooms" | "linear" | "count">("metre");
  const allTypes = useMemo(
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

  // Linear tool state
  const [linearCategories, setLinearCategories] = useState<LinearCategory[]>(DEFAULT_LINEAR_CATEGORIES);
  const [linearMeasures, setLinearMeasures]     = useState<LinearMeasure[]>([]);
  const [activeLinearCategoryId, setActiveLinearCategoryId] = useState(DEFAULT_LINEAR_CATEGORIES[0].id);

  // Count tool state
  const [countGroups, setCountGroups]   = useState<CountGroup[]>(DEFAULT_COUNT_GROUPS);
  const [countPoints, setCountPoints]   = useState<CountPoint[]>([]);
  const [activeCountGroupId, setActiveCountGroupId] = useState(DEFAULT_COUNT_GROUPS[0].id);

  // Selection state (lifted from canvas for cross-component use)
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedLinearId, setSelectedLinearId] = useState<string | null>(null);

  // Display unit
  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>("m");

  // Angle measurements (lifted from canvas)
  const [angleMeasurements, setAngleMeasurements] = useState<AngleMeasurement[]>([]);

  // Circle measurements
  const [circleMeasures, setCircleMeasures] = useState<CircleMeasure[]>([]);

  // Text annotations
  const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>([]);
  // Markup annotations (arrow, line, callout, cloud, rect, ellipse, highlight, pen, stamp)
  const [markupAnnotations, setMarkupAnnotations] = useState<MarkupAnnotation[]>([]);
  // Groups & Layers
  const [markupGroups, setMarkupGroups] = useState<MarkupGroup[]>([]);
  const [measureLayers, setMeasureLayers] = useState<MeasureLayer[]>(DEFAULT_LAYERS);
  const [activeLayerId, setActiveLayerId] = useState("lyr_general");

  // Undo / Redo history
  const historyRef  = useRef<MeasureZone[][]>([]);
  const futureRef   = useRef<MeasureZone[][]>([]);
  const zonesSnapRef = useRef<MeasureZone[]>(zones); // tracks latest zones for undo/redo
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

  // Backend session (lazy — created when VS is first used)
  const [sessionId, setSessionId]           = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [showRestoreBanner, setShowRestoreBanner] = useState(false);
  const [vsMatches, setVsMatches]               = useState<VisualSearchMatch[]>([]);
  const [customDetections, setCustomDetections] = useState<CustomDetection[]>([]);

  const DETECT_COLORS = ["#F97316", "#06B6D4", "#8B5CF6", "#10B981", "#EF4444", "#F59E0B", "#EC4899"];
  const saveDetection = useCallback((label: string, matches: VisualSearchMatch[]) => {
    const color = DETECT_COLORS[customDetections.length % DETECT_COLORS.length];
    const totalPx2 = matches.reduce((s, m) => {
      const wPx = m.w_norm * (imageNatural.w || 1);
      const hPx = m.h_norm * (imageNatural.h || 1);
      return s + wPx * hPx;
    }, 0);
    const totalM2 = ppm ? totalPx2 / (ppm ** 2) : null;
    const det: CustomDetection = {
      id: crypto.randomUUID(),
      label,
      color,
      matches,
      count: matches.length,
      total_area_m2: totalM2,
      total_area_px2: totalPx2,
    };
    setCustomDetections(prev => [...prev, det]);
    toast({ title: `Détection "${label}" sauvegardée (${matches.length})` });
  }, [customDetections.length, imageNatural, ppm]);

  /** Lazily create a backend session by uploading the plan image.
   *  Returns the session_id or null on failure. */
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionId) return sessionId;
    if (!imageB64) return null;
    setCreatingSession(true);
    try {
      const res = await fetch(`${BACKEND}/upload-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: imageB64, filename: "plan.png" }),
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setSessionId(data.session_id);
      return data.session_id;
    } catch {
      toast({ title: "Erreur connexion backend" });
      return null;
    } finally {
      setCreatingSession(false);
    }
  }, [sessionId, imageB64]);

  // Devis info
  const [projectName, setProjectName]     = useState("");
  const [clientName, setClientName]       = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [quoteNumber, setQuoteNumber]     = useState("");
  const [quoteDate, setQuoteDate]         = useState(() => new Date().toISOString().slice(0, 10));
  const [exportingPdf, setExportingPdf]   = useState(false);
  const [tvaRate, setTvaRate]             = useState<number>(10);

  // Multi-plan
  const [savedPlans, setSavedPlans]   = useState<PlanSnapshot[]>([]);
  const [activePlanId, setActivePlanId] = useState("plan-main");
  const [currentPlanName, setCurrentPlanName] = useState("Plan 1");

  // ── localStorage : restauration au montage ────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.surfaceTypes) setSurfaceTypes(s.surfaceTypes);
      if (s.zones)        setZones(s.zones);
      if (s.ppm !== undefined && s.ppm !== null) setPpm(s.ppm);
      if (s.tvaRate !== undefined)  setTvaRate(s.tvaRate);
      if (s.projectName)   setProjectName(s.projectName);
      if (s.clientName)    setClientName(s.clientName);
      if (s.clientAddress) setClientAddress(s.clientAddress);
      if (s.quoteNumber)   setQuoteNumber(s.quoteNumber);
      if (s.quoteDate)     setQuoteDate(s.quoteDate);
      if (s.savedPlans)    setSavedPlans(s.savedPlans);
      if (s.currentPlanName) setCurrentPlanName(s.currentPlanName);
      if (s.activeTypeId) setActiveTypeId(s.activeTypeId);
      if (s.displayUnit) setDisplayUnit(s.displayUnit);
      if (s.angleMeasurements) setAngleMeasurements(s.angleMeasurements);
      if (s.circleMeasures) setCircleMeasures(s.circleMeasures);
      if (s.textAnnotations) setTextAnnotations(s.textAnnotations);
      if (s.markupAnnotations) setMarkupAnnotations(s.markupAnnotations);
      if (s.markupGroups) setMarkupGroups(s.markupGroups);
      if (s.measureLayers) setMeasureLayers(s.measureLayers);
      if (s.activeLayerId) setActiveLayerId(s.activeLayerId);
      if (s.imageB64) {
        setImageB64(s.imageB64);
        setImageMime(s.imageMime || "image/png");
        // Migrate old step numbers (v1: 0=Upload,1=Scale,2=Measure,3=Results)
        // New: 0=Upload,1=Crop,2=Scale,3=Measure,4=Results
        if (s.step !== undefined) {
          const migrated: Record<number, number> = { 0: 0, 1: 2, 2: 3, 3: 4 };
          setStep(migrated[s.step] ?? s.step);
        }
        // Show restore banner if there are zones to resume
        if (s.zones?.length > 0) setShowRestoreBanner(true);
      }
    } catch { /* silencieux */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── localStorage : sauvegarde à chaque changement ─────────────────────────
  useEffect(() => {
    if (!imageB64) return; // ne pas sauvegarder un projet vide
    const payload = { imageB64, imageMime, zones, surfaceTypes, ppm, tvaRate, projectName, clientName, clientAddress, quoteNumber, quoteDate, savedPlans, currentPlanName, activeTypeId, step, displayUnit, angleMeasurements, circleMeasures, textAnnotations, markupAnnotations, markupGroups, measureLayers, activeLayerId };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Quota dépassé → sauvegarder sans l'image
      try {
        const { imageB64: _img, imageMime: _mime, ...rest } = payload;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...rest, step: 0 }));
      } catch { /* silencieux */ }
    }
  }, [imageB64, imageMime, zones, surfaceTypes, ppm, tvaRate, projectName, clientName, clientAddress, quoteNumber, quoteDate, savedPlans, currentPlanName, activeTypeId, step, displayUnit, angleMeasurements, circleMeasures, textAnnotations, markupAnnotations, markupGroups, measureLayers, activeLayerId]);

  // ── Warn before leaving with unsaved work ─────────────────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (imageB64 && zones.length > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [imageB64, zones]);

  // ── Nouveau projet ─────────────────────────────────────────────────────────
  const newProject = () => {
    if (!confirm("Effacer le projet en cours et repartir de zéro ?")) return;
    localStorage.removeItem(STORAGE_KEY);
    historyRef.current = []; futureRef.current = [];
    setHistoryLen(0); setFutureLen(0);
    setImageB64(null); setImageMime("image/png"); setImageNatural({ w: 0, h: 0 });
    setZones([]); setSurfaceTypes(DEFAULT_SURFACE_TYPES);
    setPpm(null); setProjectName(""); setClientName("");
    setClientAddress(""); setQuoteNumber(""); setQuoteDate(new Date().toISOString().slice(0, 10));
    setSavedPlans([]); setCurrentPlanName("Plan 1"); setActivePlanId("plan-main");
    setActiveTypeId(DEFAULT_SURFACE_TYPES[0].id); setStep(0);
    // Reset all new module states
    setLinearMeasures([]); setLinearCategories(DEFAULT_LINEAR_CATEGORIES);
    setCountPoints([]); setCountGroups(DEFAULT_COUNT_GROUPS);
    setAngleMeasurements([]); setCircleMeasures([]);
    setTextAnnotations([]); setMarkupAnnotations([]);
    setMarkupGroups([]); setMeasureLayers(DEFAULT_LAYERS);
    setActiveLayerId("lyr_general"); setDisplayUnit("m");
    setSelectedZoneId(null); setSelectedLinearId(null);
    setCustomDetections([]); setVsMatches([]);
    setSessionId(null);
  };

  // ── Import / Export .floorscan ─────────────────────────────────────────────
  const importRef = useRef<HTMLInputElement>(null);

  const exportProject = () => {
    if (!imageB64) return;
    const payload = { version: "floorscan_v1", imageB64, imageMime, zones, surfaceTypes, ppm, tvaRate, projectName, clientName, clientAddress, quoteNumber, quoteDate, savedPlans, currentPlanName, activeTypeId, step };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${projectName || "floorscan"}.floorscan`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importProject = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const s = JSON.parse(e.target?.result as string);
        if (!s.version?.startsWith("floorscan")) throw new Error("Format invalide");
        historyRef.current = []; futureRef.current = [];
        setHistoryLen(0); setFutureLen(0);
        if (s.surfaceTypes)    setSurfaceTypes(s.surfaceTypes);
        if (s.zones)           setZones(s.zones);
        if (s.ppm != null)     setPpm(s.ppm);
        if (s.tvaRate != null) setTvaRate(s.tvaRate);
        if (s.projectName)     setProjectName(s.projectName);
        if (s.clientName)      setClientName(s.clientName);
        if (s.clientAddress)   setClientAddress(s.clientAddress);
        if (s.quoteNumber)     setQuoteNumber(s.quoteNumber);
        if (s.quoteDate)       setQuoteDate(s.quoteDate);
        if (s.savedPlans)      setSavedPlans(s.savedPlans);
        if (s.currentPlanName) setCurrentPlanName(s.currentPlanName);
        if (s.activePlanId)    setActivePlanId(s.activePlanId);
        if (s.activeTypeId)    setActiveTypeId(s.activeTypeId);
        if (s.imageB64) {
          setImageB64(s.imageB64);
          setImageMime(s.imageMime || "image/png");
          if (s.step !== undefined) setStep(s.step);
        }
        toast({ title: "Projet importé", variant: "success" });
      } catch {
        toast({ title: "Erreur import", description: "Fichier .floorscan invalide", variant: "error" });
      }
    };
    reader.readAsText(file);
  };

  // ── Sync imageNatural when image changes ──────────────────────────────────
  useEffect(() => {
    if (!imageB64) return;
    const img = new Image();
    img.onload = () => setImageNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = `data:${imageMime};base64,${imageB64}`;
  }, [imageB64, imageMime]);

  // ── Upload ──────────────────────────────────────────────────────────────
  const uploadPdfPage = async (b64: string, fname: string, page: number, isPageConfirm = false) => {
    setUploading(true);
    try {
      const r = await fetch(`${BACKEND}/upload-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdf_base64: b64, filename: fname, zoom: 3.0, page }),
      });
      if (!r.ok) throw new Error("Erreur upload PDF");
      const data = await r.json();
      const count = data.page_count ?? 1;
      setPageCount(count);
      setCurrentPage(page);

      if (count > 1 && !isPageConfirm) {
        // Multi-page: show selector
        setPdfBase64(b64);
        setPdfFileName(fname);
        setAwaitingPage(true);
        setUploading(false);
        return;
      }

      setImageB64(data.image_b64);
      setImageMime("image/png");
      setAwaitingPage(false);
      setStep(1);
    } catch (err: any) {
      toast({ title: "Erreur upload", description: err.message, variant: "error" });
    } finally {
      setUploading(false);
    }
  };

  const handleFile = async (file: File) => {
    setAwaitingPage(false);
    setZones([]);
    setPpm(null);
    if (file.type === "application/pdf") {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = () => reject(new Error("File read failed"));
        reader.readAsDataURL(file);
      });
      setPdfFileName(file.name);
      await uploadPdfPage(b64, file.name, 0);
    } else {
      setUploading(true);
      try {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          const [header, b64] = dataUrl.split(",");
          const mime = header.split(":")[1].split(";")[0];
          setImageB64(b64);
          setImageMime(mime);
          setStep(1);
        };
        reader.readAsDataURL(file);
      } finally {
        setUploading(false);
      }
    }
  };

  const confirmPage = async () => {
    if (!pdfBase64 || !pdfFileName) return;
    await uploadPdfPage(pdfBase64, pdfFileName, currentPage, true);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // Callback when crop is confirmed (client-side crop)
  const handleCropped = (b64: string, mime: string) => {
    setImageB64(b64);
    setImageMime(mime);
    setStep(2);
  };

  const handleScaled = (value: number | null) => {
    setPpm(value);
    setStep(3);
  };

  // ── Multi-plan ─────────────────────────────────────────────────────────────
  const saveCurrentPlan = (): PlanSnapshot | null => {
    if (!imageB64) return null;
    return { id: activePlanId, name: currentPlanName, imageB64, imageMime, zones, ppm };
  };

  const switchToPlan = (plan: PlanSnapshot) => {
    // Save current before switching
    const cur = saveCurrentPlan();
    if (cur) setSavedPlans(ps => {
      const exists = ps.find(p => p.id === cur.id);
      return exists ? ps.map(p => p.id === cur.id ? cur : p) : [...ps, cur];
    });
    // Load new plan
    setActivePlanId(plan.id);
    setCurrentPlanName(plan.name);
    setImageB64(plan.imageB64);
    setImageMime(plan.imageMime);
    setZones(plan.zones);
    setPpm(plan.ppm);
    historyRef.current = []; futureRef.current = [];
    setHistoryLen(0); setFutureLen(0);
    setStep(plan.imageB64 ? 3 : 0);
  };

  const addNewPlan = () => {
    const cur = saveCurrentPlan();
    if (cur) setSavedPlans(ps => {
      const exists = ps.find(p => p.id === cur.id);
      return exists ? ps.map(p => p.id === cur.id ? cur : p) : [...ps, cur];
    });
    const newId = "plan-" + Date.now();
    const newName = `Plan ${savedPlans.length + 2}`;
    setActivePlanId(newId);
    setCurrentPlanName(newName);
    setImageB64(null); setImageMime("image/png");
    setZones([]); setPpm(null);
    historyRef.current = []; futureRef.current = [];
    setHistoryLen(0); setFutureLen(0);
    setStep(0);
  };

  const deletePlan = (id: string) => {
    setSavedPlans(ps => ps.filter(p => p.id !== id));
  };

  // All plans (current + saved) for tab bar
  const allPlans: PlanSnapshot[] = [
    ...(imageB64 ? [{ id: activePlanId, name: currentPlanName, imageB64, imageMime, zones, ppm }] : []),
    ...savedPlans.filter(p => p.id !== activePlanId),
  ];

  const totals = imageNatural.w > 0
    ? aggregateByType(zones, imageNatural.w, imageNatural.h, ppm)
    : {};

  const totalAll = Object.values(totals).reduce((a, b) => a + b, 0);

  // ── Export CSV ─────────────────────────────────────────────────────────────
  const exportCsv = () => {
    const rows: string[][] = [[d("me_step_survey"), ppm ? "Surface (m²)" : "Surface (px²)"]];
    surfaceTypes.filter(t => (totals[t.id] ?? 0) > 0).forEach(t => {
      rows.push([t.name, ppm ? totals[t.id].toFixed(4) : String(Math.round(totals[t.id]))]);
    });
    rows.push(["TOTAL", ppm ? totalAll.toFixed(4) : String(Math.round(totalAll))]);
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "metrage.csv";
    a.click();
  };

  // ── Export DXF (client-side, no backend) ──────────────────────────────────
  const exportDxf = () => {
    if (!ppm || !imageNatural.w) {
      toast({ title: d("sv_dxf_need"), variant: "error" });
      return;
    }
    const W = imageNatural.w;
    const H = imageNatural.h;
    const acad_color = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      if (r > g && r > b) return 1; // red
      if (g > r && g > b) return 3; // green
      if (b > r && b > g) return 5; // blue
      if (r > 200 && g > 100 && b < 100) return 2; // yellow-ish → yellow
      if (r > 100 && g < 100 && b > 100) return 6; // purple → magenta
      return 7; // white
    };
    let dxf = "0\nSECTION\n2\nHEADER\n0\nENDSEC\n";
    dxf += "0\nSECTION\n2\nENTITIES\n";
    for (const zone of zones) {
      const type = surfaceTypes.find(t => t.id === zone.typeId);
      const color = acad_color(type?.color ?? "#6B7280");
      const pts = zone.points.map(p => ({
        x: (p.x * W) / ppm,
        y: ((1 - p.y) * H) / ppm, // DXF Y is inverted
      }));
      if (pts.length < 3) continue;
      // LWPOLYLINE
      dxf += `0\nLWPOLYLINE\n8\n${type?.name ?? zone.typeId}\n62\n${color}\n90\n${pts.length}\n70\n1\n`;
      for (const p of pts) dxf += `10\n${p.x.toFixed(4)}\n20\n${p.y.toFixed(4)}\n`;
      // TEXT label at centroid
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      const label = zone.name || type?.name || zone.typeId;
      dxf += `0\nTEXT\n8\n${type?.name ?? zone.typeId}\n62\n${color}\n10\n${cx.toFixed(4)}\n20\n${cy.toFixed(4)}\n40\n0.15\n1\n${label}\n`;
    }
    dxf += "0\nENDSEC\n0\nEOF\n";
    const blob = new Blob([dxf], { type: "application/dxf" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${projectName || "metrage"}.dxf`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast({ title: d("sv_dxf_ok") });
  };

  // ── Export PDF Devis (client-side jsPDF) ──────────────────────────────────
  const exportPdfDevis = async () => {
    if (!imageB64) return;
    setExportingPdf(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W = 210, M = 15;
      let y = M;

      const hex2rgb = (hex: string): [number,number,number] => [
        parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)
      ];

      // ── En-tête ──
      doc.setFillColor(15,23,42);
      doc.rect(0, 0, W, 28, "F");
      doc.setTextColor(255,255,255);
      doc.setFontSize(18); doc.setFont("helvetica","bold");
      doc.text("FloorScan", M, 12);
      doc.setFontSize(9); doc.setFont("helvetica","normal");
      doc.setTextColor(148,163,184);
      doc.text("Métré & Devis de surfaces", M, 18);
      if (quoteNumber) { doc.setTextColor(255,255,255); doc.text(`Devis N° ${quoteNumber}`, W-M, 12, { align:"right" }); }
      doc.setTextColor(148,163,184);
      doc.text(new Date(quoteDate).toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"}), W-M, 18, { align:"right" });
      y = 36;

      // ── Infos projet / client ──
      doc.setTextColor(30,41,59); doc.setFontSize(9); doc.setFont("helvetica","normal");
      const col2 = W/2 + 5;
      doc.setFont("helvetica","bold"); doc.text("Projet", M, y); doc.setFont("helvetica","normal");
      doc.text(projectName || "—", M, y+5);
      doc.setFont("helvetica","bold"); doc.text("Client", col2, y); doc.setFont("helvetica","normal");
      doc.text(clientName || "—", col2, y+5);
      if (clientAddress) doc.text(clientAddress, col2, y+10);
      y += clientAddress ? 20 : 16;

      doc.setDrawColor(226,232,240); doc.setLineWidth(0.3); doc.line(M, y, W-M, y); y += 6;

      // ── Plans multi ──
      const plansToExport = allPlans.length > 1 ? allPlans : [{ id:"main", name: currentPlanName||"Plan", imageB64, imageMime, zones, ppm }];

      for (const plan of plansToExport) {
        if (plansToExport.length > 1) {
          doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(30,41,59);
          doc.text(plan.name, M, y); y += 6;
        }

        const planTotals = imageNatural.w > 0 ? aggregateByType(plan.zones, imageNatural.w, imageNatural.h, plan.ppm) : {};
        const planPerims = plan.ppm && imageNatural.w > 0 ? aggregatePerimeterByType(plan.zones, imageNatural.w, imageNatural.h, plan.ppm) : {};
        const activeSurfaces = surfaceTypes.filter(t => (planTotals[t.id] ?? 0) > 0);
        const hasPrices = activeSurfaces.some(t => (t.pricePerM2 ?? 0) > 0);
        if (activeSurfaces.length === 0) continue;

        // Table header
        const cols = hasPrices && plan.ppm
          ? [M, 70, 100, 120, 145, 170]
          : [M, 90, 130, 160];
        const headers = hasPrices && plan.ppm
          ? ["Type","Surface","Périm.","Chute","Qté cmd","Montant HT"]
          : ["Type","Surface","Périm.","—"];

        doc.setFillColor(248,250,252); doc.rect(M, y-4, W-2*M, 8, "F");
        doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(100,116,139);
        headers.forEach((h,i) => doc.text(h, cols[i], y));
        y += 5; doc.setDrawColor(226,232,240); doc.line(M, y, W-M, y); y += 4;

        let planHT = 0;
        doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(30,41,59);
        for (const type of activeSurfaces) {
          const area   = planTotals[type.id] ?? 0;
          const perim  = planPerims[type.id] ?? 0;
          const waste  = type.wastePercent ?? 10;
          const cmd    = area * (1 + waste/100);
          const lineHT = area * (type.pricePerM2 ?? 0);
          planHT += lineHT;
          const [r,g,b] = hex2rgb(type.color);
          doc.setFillColor(r,g,b); doc.circle(cols[0]+1.5, y-1.5, 1.5, "F");
          doc.text(type.name, cols[0]+5, y);
          doc.text(plan.ppm ? `${area.toFixed(2)} m²` : "—", cols[1], y);
          if (hasPrices && plan.ppm) {
            doc.text(perim > 0 ? `${perim.toFixed(1)} ml` : "—", cols[2], y);
            doc.text(`+${waste}%`, cols[3], y);
            doc.text(`${cmd.toFixed(2)} m²`, cols[4], y);
            doc.text(lineHT > 0 ? `${lineHT.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} €` : "—", cols[5], y);
          } else if (plan.ppm) {
            doc.text(perim > 0 ? `${perim.toFixed(1)} ml` : "—", cols[2], y);
          }
          y += 5;
          // Note de zone
          const zonesOfType = plan.zones.filter(z => z.typeId === type.id && z.note);
          for (const z of zonesOfType) {
            doc.setFontSize(7.5); doc.setTextColor(100,116,139);
            doc.text(`  ↳ ${z.name || type.name}: ${z.note}`, cols[0]+5, y);
            doc.setFontSize(8.5); doc.setTextColor(30,41,59);
            y += 4;
          }
          if (y > 260) { doc.addPage(); y = M; }
        }

        // Total plan
        const planTotalM2 = Object.values(planTotals).reduce((a,b) => a+b, 0);
        doc.setDrawColor(226,232,240); doc.line(M, y, W-M, y); y += 3;
        doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(30,41,59);
        doc.text("Total surfaces", M, y);
        doc.text(plan.ppm ? `${planTotalM2.toFixed(2)} m²` : "—", cols[1], y);
        if (hasPrices && plan.ppm && planHT > 0) {
          doc.text(`${planHT.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} €`, cols[5], y);
        }
        y += 8;
      }

      // ── Récap financier ──
      const hasPrices = surfaceTypes.some(t => (t.pricePerM2 ?? 0) > 0);
      const totalHT   = surfaceTypes.reduce((s,t) => s + (totals[t.id]??0)*(t.pricePerM2??0), 0);
      if (hasPrices && ppm && totalHT > 0) {
        doc.line(M, y, W-M, y); y += 5;
        doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(30,41,59);
        const rows: [string,string][] = [
          ["Total HT", `${totalHT.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} €`],
          [`TVA ${tvaRate}%`, `${(totalHT*tvaRate/100).toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} €`],
        ];
        rows.forEach(([k,v]) => { doc.text(k, W-M-50, y); doc.text(v, W-M, y, {align:"right"}); y += 5; });
        doc.setFont("helvetica","bold"); doc.setFontSize(11);
        doc.text("Total TTC", W-M-50, y);
        doc.text(`${(totalHT*(1+tvaRate/100)).toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} €`, W-M, y, {align:"right"});
        y += 8;
      }

      // ── Plan annoté ──
      try {
        const planB64 = await renderAnnotatedPlan(imageB64, imageMime, zones, allTypes, ppm);
        if (y > 180) { doc.addPage(); y = M; }
        const imgProps = (doc as any).getImageProperties?.(`data:image/png;base64,${planB64}`) ?? { width: 1, height: 1 };
        const maxW = W - 2*M;
        const ratio = imgProps.height / imgProps.width;
        const imgH = Math.min(maxW * ratio, 100);
        doc.addImage(`data:image/png;base64,${planB64}`, "PNG", M, y, maxW, imgH);
        y += imgH + 5;
      } catch { /* skip plan image */ }

      // ── Pied de page ──
      doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(148,163,184);
      doc.text("Généré par FloorScan · floorscan.app", W/2, 292, { align:"center" });

      const filename = `devis_${(projectName||"floorscan").replace(/\s+/g,"-")}_${quoteDate}.pdf`;
      doc.save(filename);
      toast({ title: "Devis PDF exporté ✓", variant: "success" });
    } catch (e: any) {
      toast({ title: "Erreur export PDF", description: e.message, variant: "error" });
    } finally {
      setExportingPdf(false);
    }
  };

  // ── Page selector component ───────────────────────────────────────────────
  const PageSelector = () => (
    <div className="max-w-xl mx-auto">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-400 to-accent flex items-center justify-center mx-auto mb-4">
          <BookOpen className="w-8 h-8 text-white" />
        </div>
        <h1 className="font-display text-2xl font-700 text-white mb-2">PDF multi-pages</h1>
        <p className="text-slate-400 text-sm">{pdfFileName} · {pageCount} pages</p>
      </div>
      <div className="glass border border-white/10 rounded-2xl p-8">
        <p className="text-slate-300 text-sm text-center mb-6">
          Ce PDF contient <span className="text-white font-700">{pageCount}</span> pages.<br />
          Choisissez la page à analyser.
        </p>
        <div className="flex items-center justify-center gap-3 mb-6">
          <button
            onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            className="glass border border-white/10 rounded-lg p-2 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex gap-1.5 flex-wrap justify-center max-w-sm">
            {Array.from({ length: Math.min(pageCount, 24) }, (_, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i)}
                className={cn(
                  "w-10 h-10 rounded-lg text-sm font-mono font-600 transition-all",
                  currentPage === i
                    ? "bg-accent text-white shadow-lg"
                    : "glass border border-white/10 text-slate-400 hover:text-white"
                )}
              >
                {i + 1}
              </button>
            ))}
            {pageCount > 24 && (
              <span className="text-slate-500 text-xs self-center">…+{pageCount - 24}</span>
            )}
          </div>
          <button
            onClick={() => setCurrentPage(p => Math.min(pageCount - 1, p + 1))}
            disabled={currentPage === pageCount - 1}
            className="glass border border-white/10 rounded-lg p-2 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        <div className="flex justify-center">
          <Button onClick={confirmPage} disabled={uploading}>
            {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {uploading ? "Chargement…" : `Charger la page ${currentPage + 1}`}
          </Button>
        </div>
      </div>
    </div>
  );

  const content = (
    <div className={embedded ? "" : "max-w-7xl mx-auto px-6 py-10"}>
      {/* Restore banner */}
      <AnimatePresence>
        {showRestoreBanner && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.25 }}
            className="glass border border-accent/30 rounded-xl px-4 py-3 flex items-center justify-between gap-3 mb-5"
          >
            <span className="text-sm text-slate-300">
              {d("sv_restore_found")} — {zones.length} zone{zones.length !== 1 ? "s" : ""}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowRestoreBanner(false)}
                className="px-3 py-1 rounded-lg text-xs font-600 bg-accent text-white hover:bg-accent/80 transition-colors"
              >
                {d("sv_restore_resume")}
              </button>
              <button
                onClick={() => { setShowRestoreBanner(false); newProject(); }}
                className="text-slate-500 hover:text-white transition-colors p-1"
                title="Ignorer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2 }}
        >
          {/* ── STEP 0: Upload ── */}
          {step === 0 && !awaitingPage && (
            <div className="max-w-xl mx-auto">
              <div className="text-center mb-8">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-400 to-accent flex items-center justify-center mx-auto mb-4">
                  <PenLine className="w-8 h-8 text-white" />
                </div>
                <h1 className="font-display text-3xl font-700 text-white mb-2">{d("me_title")}</h1>
                <p className="text-slate-400">{d("me_sub")}</p>
              </div>

              <div
                className="glass border-2 border-dashed border-white/15 rounded-2xl p-10 text-center hover:border-accent/40 transition-all cursor-pointer"
                onClick={() => fileRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={e => e.preventDefault()}
              >
                {uploading ? (
                  <Loader2 className="w-8 h-8 text-accent animate-spin mx-auto mb-3" />
                ) : (
                  <Upload className="w-8 h-8 text-slate-500 mx-auto mb-3" />
                )}
                <p className="text-slate-300 font-medium mb-1">
                  {uploading ? d("me_processing") : d("me_drop")}
                </p>
                <p className="text-slate-500 text-sm">
                  Image ou PDF — JPG, PNG, TIFF, WEBP, PDF
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif,.webp"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
              </div>

              <div className="mt-6 grid grid-cols-3 gap-3">
                {[
                  { icon: <ImageIcon className="w-5 h-5" />, label: d("me_feat1") },
                  { icon: <Ruler className="w-5 h-5" />, label: d("me_feat2") },
                  { icon: <BarChart3 className="w-5 h-5" />, label: d("me_feat3") },
                ].map((item, i) => (
                  <div key={i} className="glass border border-white/5 rounded-xl p-4 text-center">
                    <div className="text-accent mx-auto mb-2 flex justify-center">{item.icon}</div>
                    <p className="text-xs text-slate-400">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── PAGE SELECTOR ── */}
          {step === 0 && awaitingPage && <PageSelector />}

          {/* ── STEP 1: Crop ── */}
          {step === 1 && imageB64 && (
            <MeasureCropStep
              imageB64={imageB64}
              imageMime={imageMime}
              onCropped={handleCropped}
              onSkip={() => setStep(2)}
            />
          )}

          {/* ── STEP 2: Scale ── */}
          {step === 2 && imageB64 && (
            <div>
              {/* Page change hint for multi-page PDFs */}
              {pageCount > 1 && (
                <div className="flex items-center gap-2 mb-4 glass border border-white/10 rounded-xl px-4 py-2 w-fit">
                  <BookOpen className="w-3.5 h-3.5 text-accent" />
                  <span className="text-xs text-slate-400">
                    Page {currentPage + 1}/{pageCount}
                  </span>
                  <button
                    onClick={() => { setAwaitingPage(true); setStep(0); }}
                    className="text-xs text-accent hover:underline ml-1"
                  >
                    Changer
                  </button>
                </div>
              )}
              <ScaleStep imageB64={imageB64} onScaled={handleScaled} />
            </div>
          )}

          {/* ── STEP 3: Measure ── */}
          {step === 3 && imageB64 && (
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex-1 min-w-0">
                {/* Multi-plan tab bar */}
                {(savedPlans.length > 0 || true) && (
                  <div className="flex items-center gap-1 mb-4 flex-wrap">
                    {/* Current plan tab */}
                    <div className="flex items-center gap-1 bg-accent/20 border border-accent/40 rounded-lg px-3 py-1.5 text-xs text-white">
                      <Layers className="w-3 h-3" />
                      <input
                        value={currentPlanName}
                        onChange={e => setCurrentPlanName(e.target.value)}
                        className="bg-transparent w-20 text-white text-xs outline-none font-medium"
                      />
                    </div>
                    {/* Saved plans */}
                    {savedPlans.map(plan => (
                      <button key={plan.id}
                        onClick={() => switchToPlan(plan)}
                        className="flex items-center gap-1.5 glass border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors group">
                        <Layers className="w-3 h-3" />
                        {plan.name}
                        <span onClick={e => { e.stopPropagation(); deletePlan(plan.id); }}
                          className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all ml-1">
                          <X className="w-3 h-3" />
                        </span>
                      </button>
                    ))}
                    <button onClick={addNewPlan}
                      className="glass border border-white/10 border-dashed rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:text-white hover:border-white/30 transition-colors flex items-center gap-1">
                      <Plus className="w-3 h-3" /> Nouveau plan
                    </button>
                  </div>
                )}
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-display text-xl font-700 text-white">{d("me_draw")}</h2>
                  <div className="flex items-center gap-2">
                    {ppm && (
                      <span className="text-xs text-slate-500 glass border border-white/5 rounded-lg px-2.5 py-1 font-mono">
                        {ppm.toFixed(1)} px/m
                      </span>
                    )}
                    <button
                      onClick={newProject}
                      className="flex items-center gap-1.5 text-xs text-red-400/80 hover:text-red-300 border border-red-500/20 hover:border-red-500/40 rounded-lg px-2.5 py-1.5 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Recommencer
                    </button>
                    <Button size="sm" onClick={() => setStep(4)} disabled={zones.length === 0}>
                      {d("me_view_results")}
                    </Button>
                  </div>
                </div>
                <MeasureCanvas
                  imageB64={imageB64}
                  imageMime={imageMime}
                  zones={zones}
                  activeTypeId={activeTypeId}
                  surfaceTypes={allTypes}
                  ppm={ppm}
                  onZonesChange={setZones}
                  onHistoryPush={pushHistory}
                  onHistoryUndo={undoHistory}
                  onHistoryRedo={redoHistory}
                  canUndo={historyLen > 0}
                  canRedo={futureLen > 0}
                  sessionId={sessionId}
                  onEnsureSession={ensureSession}
                  vsMatches={vsMatches}
                  onVsMatchesChange={setVsMatches}
                  customDetections={customDetections}
                  onSaveDetection={saveDetection}
                  onPpmChange={setPpm}
                  linearMeasures={linearMeasures}
                  onLinearMeasuresChange={setLinearMeasures}
                  linearCategories={linearCategories}
                  activeLinearCategoryId={activeLinearCategoryId}
                  countPoints={countPoints}
                  onCountPointsChange={setCountPoints}
                  countGroups={countGroups}
                  activeCountGroupId={activeCountGroupId}
                  onActiveCountGroupIdChange={setActiveCountGroupId}
                  onCountGroupsChange={setCountGroups}
                  selectedZoneId={selectedZoneId}
                  onSelectedZoneIdChange={setSelectedZoneId}
                  selectedLinearId={selectedLinearId}
                  onSelectedLinearIdChange={setSelectedLinearId}
                  angleMeasurements={angleMeasurements}
                  onAngleMeasurementsChange={setAngleMeasurements}
                  circleMeasures={circleMeasures}
                  onCircleMeasuresChange={setCircleMeasures}
                  displayUnit={displayUnit}
                  textAnnotations={textAnnotations}
                  onTextAnnotationsChange={setTextAnnotations}
                  markupAnnotations={markupAnnotations}
                  onMarkupAnnotationsChange={setMarkupAnnotations}
                  markupGroups={markupGroups}
                  onMarkupGroupsChange={setMarkupGroups}
                  layers={measureLayers}
                  onLayersChange={setMeasureLayers}
                  activeLayerId={activeLayerId}
                  onActiveLayerIdChange={setActiveLayerId}
                  onExportPNG={async () => {
                    try {
                      const b64 = await renderAnnotatedPlan(imageB64, imageMime, zones, allTypes, ppm);
                      const a = document.createElement("a");
                      a.href = b64;
                      a.download = `floorscan_plan_${new Date().toISOString().slice(0, 10)}.png`;
                      a.click();
                    } catch (e) { console.error("PNG export error:", e); }
                  }}
                />
              </div>
              <div className="lg:w-72 shrink-0">
                <SurfacePanel
                  types={surfaceTypes}
                  zones={zones}
                  activeTypeId={activeTypeId}
                  imageW={imageNatural.w}
                  imageH={imageNatural.h}
                  ppm={ppm}
                  onTypesChange={setSurfaceTypes}
                  onActiveTypeChange={setActiveTypeId}
                  customDetections={customDetections}
                  onDeleteDetection={(id) => setCustomDetections(prev => prev.filter(d => d.id !== id))}
                  panelMode={panelMode}
                  onPanelModeChange={handlePanelModeChange}
                  roomTypes={[...ROOM_SURFACE_TYPES, EMPRISE_TYPE]}
                  linearCategories={linearCategories}
                  linearMeasures={linearMeasures}
                  onLinearCategoriesChange={setLinearCategories}
                  onLinearMeasuresChange={setLinearMeasures}
                  activeLinearCategoryId={activeLinearCategoryId}
                  onActiveLinearCategoryChange={setActiveLinearCategoryId}
                  countGroups={countGroups}
                  countPoints={countPoints}
                  onCountGroupsChange={setCountGroups}
                  onCountPointsChange={setCountPoints}
                  activeCountGroupId={activeCountGroupId}
                  onActiveCountGroupChange={setActiveCountGroupId}
                  angleMeasurements={angleMeasurements}
                  circleMeasures={circleMeasures}
                  displayUnit={displayUnit}
                />
              </div>
            </div>
          )}
          {/* ── Markups List (bottom panel, visible during step 3) ── */}
          {step === 3 && (
            <MarkupsList
              zones={zones} surfaceTypes={allTypes}
              linearMeasures={linearMeasures} linearCategories={linearCategories}
              countPoints={countPoints} countGroups={countGroups}
              angleMeasurements={angleMeasurements} circleMeasures={circleMeasures}
              textAnnotations={textAnnotations} markupAnnotations={markupAnnotations}
              imageW={imageNatural.w} imageH={imageNatural.h} ppm={ppm}
              displayUnit={displayUnit} layers={measureLayers}
              onSelectItem={(id) => { setSelectedZoneId(id); }}
              onDeleteItem={(id, kind) => {
                if (kind === "zone") setZones(z => z.filter(v => v.id !== id));
                else if (kind === "linear") setLinearMeasures(m => m.filter(v => v.id !== id));
                else if (kind === "angle") setAngleMeasurements(a => a.filter(v => v.id !== id));
                else if (kind === "circle") setCircleMeasures(c => c.filter(v => v.id !== id));
                else if (kind === "text") setTextAnnotations(t => t.filter(v => v.id !== id));
                else if (kind === "markup") setMarkupAnnotations(m => m.filter(v => v.id !== id));
                else if (kind === "count") setCountPoints(p => p.filter(v => v.groupId !== id));
              }}
            />
          )}

          {/* ── STEP 4: Results ── */}
          {step === 4 && (() => {
            const activeSurfaces = surfaceTypes.filter(t => (totals[t.id] ?? 0) > 0);
            const hasPrices = activeSurfaces.some(t => (t.pricePerM2 ?? 0) > 0);
            const totalHT = activeSurfaces.reduce((s, t) => s + (totals[t.id] ?? 0) * (t.pricePerM2 ?? 0), 0);
            const tvaAmount = totalHT * tvaRate / 100;
            const totalTTC = totalHT + tvaAmount;
            // Perimeters by type (for recap table)
            const perims = (ppm && imageNatural.w > 0)
              ? aggregatePerimeterByType(zones, imageNatural.w, imageNatural.h, ppm)
              : {} as Record<string, number>;
            // Zone counts by type
            const zoneCountByType: Record<string, number> = {};
            for (const z of zones) {
              if (!z.isDeduction) zoneCountByType[z.typeId] = (zoneCountByType[z.typeId] ?? 0) + 1;
            }
            const uniqueTypeCount = activeSurfaces.length;

            return (
              <div className="max-w-2xl mx-auto">
                <div className="text-center mb-8">
                  <h2 className="font-display text-2xl font-700 text-white mb-2">{d("me_summary")}</h2>
                  <p className="text-slate-400 text-sm">{zones.length} zone{zones.length > 1 ? "s" : ""} mesurée{zones.length > 1 ? "s" : ""}</p>
                </div>

                {/* ── KPI Dashboard ── */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  <div className="glass border border-white/10 rounded-xl p-3 text-center">
                    <LayoutGrid className="w-4 h-4 mx-auto mb-1 text-accent" />
                    <div className="text-xl font-700 text-white">{zones.filter(z => !z.isDeduction).length}</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">{d("sv_kpi_zones")}</div>
                  </div>
                  <div className="glass border border-white/10 rounded-xl p-3 text-center">
                    <Layers className="w-4 h-4 mx-auto mb-1 text-brand-400" />
                    <div className="text-xl font-700 text-white">{uniqueTypeCount}</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">{d("sv_kpi_types")}</div>
                  </div>
                  <div className="glass border border-white/10 rounded-xl p-3 text-center">
                    <Ruler className="w-4 h-4 mx-auto mb-1 text-emerald-400" />
                    <div className="text-xl font-700 text-white">
                      {ppm ? `${totalAll.toFixed(1)}` : Math.round(totalAll).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                      {ppm ? "m² total" : "px² total"}
                    </div>
                  </div>
                  {hasPrices && ppm && (
                    <div className="glass border border-white/10 rounded-xl p-3 text-center">
                      <BarChart3 className="w-4 h-4 mx-auto mb-1 text-amber-400" />
                      <div className="text-xl font-700 text-white">
                        {totalHT.toLocaleString("fr-FR", { maximumFractionDigits: 0 })}
                      </div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{d("sv_kpi_total_ht")}</div>
                    </div>
                  )}
                  {!(hasPrices && ppm) && (
                    <div className="glass border border-white/10 rounded-xl p-3 text-center">
                      <BarChart3 className="w-4 h-4 mx-auto mb-1 text-slate-600" />
                      <div className="text-xl font-700 text-slate-600">—</div>
                      <div className="text-[10px] text-slate-600 uppercase tracking-wide">{d("sv_kpi_total_ht")}</div>
                    </div>
                  )}
                </div>

                {/* ── Recap table by type ── */}
                {activeSurfaces.length > 0 && (
                  <div className="glass rounded-2xl border border-white/10 overflow-hidden mb-4">
                    <div className="px-4 py-2.5 bg-white/5 border-b border-white/5">
                      <span className="text-xs font-600 text-slate-400 uppercase tracking-wider">{d("sv_recap_title")}</span>
                    </div>
                    <div className="grid gap-0 border-b border-white/5 bg-white/[0.02]"
                      style={{ gridTemplateColumns: ppm ? "1fr 60px 90px 90px" : "1fr 60px 90px" }}>
                      <div className="px-4 py-2 text-[10px] font-600 text-slate-500 uppercase">Type</div>
                      <div className="px-2 py-2 text-[10px] font-600 text-slate-500 text-center uppercase">{d("sv_recap_nb")}</div>
                      <div className="px-2 py-2 text-[10px] font-600 text-slate-500 text-right uppercase">{d("sv_recap_net")}</div>
                      {ppm && <div className="px-2 py-2 text-[10px] font-600 text-slate-500 text-right uppercase">{d("sv_recap_perim")}</div>}
                    </div>
                    {activeSurfaces.map(type => (
                      <div key={type.id}
                        className="grid border-b border-white/5 last:border-0"
                        style={{ gridTemplateColumns: ppm ? "1fr 60px 90px 90px" : "1fr 60px 90px" }}>
                        <div className="flex items-center gap-2 px-4 py-2.5">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: type.color }} />
                          <span className="text-slate-300 text-xs">{type.name}</span>
                        </div>
                        <div className="px-2 py-2.5 text-center font-mono text-slate-300 text-xs">
                          {zoneCountByType[type.id] ?? 0}
                        </div>
                        <div className="px-2 py-2.5 text-right font-mono text-white text-xs font-600">
                          {ppm ? `${totals[type.id].toFixed(2)} m\u00b2` : `${Math.round(totals[type.id]).toLocaleString()} px\u00b2`}
                        </div>
                        {ppm && (
                          <div className="px-2 py-2.5 text-right font-mono text-slate-400 text-xs">
                            {(perims[type.id] ?? 0).toFixed(1)} m
                          </div>
                        )}
                      </div>
                    ))}
                    <div className="grid bg-white/5"
                      style={{ gridTemplateColumns: ppm ? "1fr 60px 90px 90px" : "1fr 60px 90px" }}>
                      <div className="px-4 py-2.5 text-white font-600 text-xs">{d("sv_recap_total")}</div>
                      <div className="px-2 py-2.5 text-center font-mono text-slate-400 text-xs">
                        {zones.filter(z => !z.isDeduction).length}
                      </div>
                      <div className="px-2 py-2.5 text-right font-mono text-accent font-700 text-xs">
                        {ppm ? `${totalAll.toFixed(2)} m\u00b2` : `${Math.round(totalAll).toLocaleString()} px\u00b2`}
                      </div>
                      {ppm && (
                        <div className="px-2 py-2.5 text-right font-mono text-slate-400 text-xs">
                          {Object.values(perims).reduce((a, b) => a + b, 0).toFixed(1)} m
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Project info */}
                <div className="glass border border-white/10 rounded-2xl p-4 mb-4 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Nom du projet</label>
                    <input
                      value={projectName}
                      onChange={e => setProjectName(e.target.value)}
                      placeholder="Ex. Appartement Paris 11e"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Client</label>
                    <input
                      value={clientName}
                      onChange={e => setClientName(e.target.value)}
                      placeholder="Nom du client"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-accent"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-slate-500 mb-1">Adresse client</label>
                    <input
                      value={clientAddress}
                      onChange={e => setClientAddress(e.target.value)}
                      placeholder="Ex. 12 rue de la Paix, 75001 Paris"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">N° de devis</label>
                    <input
                      value={quoteNumber}
                      onChange={e => setQuoteNumber(e.target.value)}
                      placeholder="Ex. 2025-001"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Date du devis</label>
                    <input
                      type="date"
                      value={quoteDate}
                      onChange={e => setQuoteDate(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent"
                    />
                  </div>
                </div>

                {/* TVA rate selector (shown only when prices are set) */}
                {hasPrices && ppm && (
                  <div className="flex items-center gap-3 mb-4 px-1">
                    <span className="text-xs text-slate-500">Taux TVA :</span>
                    {[0, 10, 20].map(rate => (
                      <button
                        key={rate}
                        onClick={() => setTvaRate(rate)}
                        className={`px-3 py-1 rounded-lg text-xs font-mono font-600 transition-all ${
                          tvaRate === rate
                            ? "bg-accent text-white"
                            : "glass border border-white/10 text-slate-400 hover:text-white"
                        }`}
                      >
                        {rate === 0 ? "Exo." : `${rate}%`}
                      </button>
                    ))}
                    <span className="text-xs text-slate-600 ml-1">
                      {tvaRate === 10 ? "— travaux rénovation" : tvaRate === 20 ? "— standard" : "— exonéré"}
                    </span>
                  </div>
                )}

                {/* Surface + price table */}
                <div className="glass rounded-2xl border border-white/10 overflow-hidden mb-4">
                  {/* Header */}
                  <div className="grid gap-0 border-b border-white/5 bg-white/5"
                    style={{ gridTemplateColumns: hasPrices && ppm ? "1fr 90px 80px 100px" : "1fr 120px" }}>
                    <div className="px-4 py-3 text-xs font-600 text-slate-400">Type de surface</div>
                    <div className="px-2 py-3 text-xs font-600 text-slate-400 text-right">Surface</div>
                    {hasPrices && ppm && <>
                      <div className="px-2 py-3 text-xs font-600 text-slate-400 text-right">€/m²</div>
                      <div className="px-4 py-3 text-xs font-600 text-slate-400 text-right">Montant HT</div>
                    </>}
                  </div>

                  {/* Rows */}
                  {activeSurfaces.map(type => (
                    <div key={type.id}
                      className="grid border-b border-white/5 last:border-0"
                      style={{ gridTemplateColumns: hasPrices && ppm ? "1fr 90px 80px 100px" : "1fr 120px" }}>
                      <div className="flex items-center gap-2.5 px-4 py-3">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: type.color }} />
                        <span className="text-slate-200 text-sm">{type.name}</span>
                      </div>
                      <div className="px-2 py-3 text-right font-mono text-white text-sm font-600">
                        {ppm
                          ? `${totals[type.id].toFixed(2)} m²`
                          : `${Math.round(totals[type.id]).toLocaleString()} px²`}
                      </div>
                      {hasPrices && ppm && <>
                        <div className="px-2 py-3 text-right font-mono text-slate-400 text-sm">
                          {(type.pricePerM2 ?? 0) > 0 ? `${type.pricePerM2} €` : "—"}
                        </div>
                        <div className="px-4 py-3 text-right font-mono text-slate-200 text-sm font-600">
                          {(type.pricePerM2 ?? 0) > 0
                            ? `${(totals[type.id] * type.pricePerM2!).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
                            : "—"}
                        </div>
                      </>}
                    </div>
                  ))}

                  {/* Total surfaces row */}
                  <div className="grid bg-white/5"
                    style={{ gridTemplateColumns: hasPrices && ppm ? "1fr 90px 80px 100px" : "1fr 120px" }}>
                    <div className="px-4 py-3 text-white font-600 text-sm">Total surfaces</div>
                    <div className="px-2 py-3 text-right font-mono text-accent font-700">
                      {ppm ? `${totalAll.toFixed(2)} m²` : `${Math.round(totalAll).toLocaleString()} px²`}
                    </div>
                    {hasPrices && ppm && <>
                      <div />
                      <div className="px-4 py-3 text-right font-mono text-accent font-700">
                        {totalHT.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                      </div>
                    </>}
                  </div>
                </div>

                {/* Financial summary (HT/TVA/TTC) */}
                {hasPrices && ppm && totalHT > 0 && (
                  <div className="glass border border-white/10 rounded-2xl p-4 mb-4">
                    <div className="flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-400">Total HT</span>
                        <span className="font-mono text-white font-600">
                          {totalHT.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-400">TVA ({tvaRate}%)</span>
                        <span className="font-mono text-slate-300">
                          {tvaAmount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                        </span>
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t border-white/10">
                        <span className="text-base font-700 text-white">Total TTC</span>
                        <span className="font-mono text-accent font-700 text-xl">
                          {totalTTC.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {!ppm && (
                  <p className="text-xs text-amber-400/80 text-center mb-4">
                    ⚠ Aucune échelle définie — les surfaces sont en px². Retournez à l'étape 3 pour calibrer.
                  </p>
                )}

                <div className="flex gap-3 justify-center flex-wrap">
                  <button
                    onClick={newProject}
                    className="flex items-center gap-1.5 text-xs text-red-400/80 hover:text-red-300 border border-red-500/20 hover:border-red-500/40 rounded-lg px-3 py-2 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Recommencer
                  </button>
                  <Button variant="outline" onClick={() => setStep(3)}>
                    {d("me_back_survey")}
                  </Button>
                  <Button variant="outline" onClick={exportCsv} className="flex items-center gap-1.5">
                    <FileText className="w-4 h-4" /> CSV
                  </Button>
                  <Button
                    variant="outline"
                    onClick={exportDxf}
                    disabled={!ppm || zones.length === 0}
                    className="flex items-center gap-1.5"
                    title={!ppm ? d("sv_dxf_need") : d("sv_dxf_export")}
                  >
                    <FileBox className="w-4 h-4" /> DXF
                  </Button>
                  <Button
                    onClick={exportPdfDevis}
                    disabled={exportingPdf || zones.length === 0}
                    className="flex items-center gap-1.5"
                  >
                    {exportingPdf
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <FileDown className="w-4 h-4" />}
                    {exportingPdf ? "Génération…" : "Devis PDF"}
                  </Button>
                </div>
              </div>
            );
          })()}

        </motion.div>
      </AnimatePresence>
    </div>
  );

  if (embedded) return content;

  return (
    <div className="min-h-screen bg-ink">
      {/* Top bar */}
      <div className="border-b border-white/5 glass sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-400 to-accent flex items-center justify-center">
              <ScanLine className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-display font-700 text-base text-white">
              Floor<span className="text-gradient">Scan</span>
            </span>
          </Link>

          <div className="hidden sm:flex items-center gap-1">
            {STEP_LABELS.map((label, i) => (
              <div key={i} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                i === step ? "bg-accent/15 text-accent" : i < step ? "text-slate-500" : "text-slate-700"
              }`}>
                {i < step && <span className="text-accent-green">✓</span>}
                {label}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            <LangSwitcher />
            {/* Import .floorscan */}
            <button
              onClick={() => importRef.current?.click()}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white glass border border-white/10 rounded-lg px-2.5 py-1.5 transition-colors"
              title="Importer un projet .floorscan"
            >
              <FolderOpen className="w-3.5 h-3.5" /> Importer
            </button>
            <input ref={importRef} type="file" accept=".floorscan,.json" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) importProject(f); e.target.value = ""; }} />
            {/* Export .floorscan */}
            {imageB64 && (
              <button
                onClick={exportProject}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white glass border border-white/10 rounded-lg px-2.5 py-1.5 transition-colors"
                title="Exporter le projet .floorscan"
              >
                <Download className="w-3.5 h-3.5" /> Exporter
              </button>
            )}
            {imageB64 && (
              <button
                onClick={newProject}
                className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 glass border border-red-500/25 hover:border-red-500/50 rounded-lg px-3 py-1.5 transition-colors"
                title="Effacer le projet et repartir de zéro"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Recommencer
              </button>
            )}
            <Link href="/" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors">
              <ArrowLeft className="w-4 h-4" /> {d("me_back_ret")}
            </Link>
          </div>
        </div>
      </div>

      {content}
    </div>
  );
}
