"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ScanLine, ArrowLeft, Upload, Ruler, PenLine, BarChart3, Loader2, ImageIcon, FileDown, BookOpen, ChevronLeft, ChevronRight, FileText, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import ScaleStep from "@/components/demo/scale-step";
import MeasureCanvas from "@/components/measure/measure-canvas";
import SurfacePanel from "@/components/measure/surface-panel";
import { SurfaceType, MeasureZone, DEFAULT_SURFACE_TYPES, aggregateByType } from "@/lib/measure-types";
import LangSwitcher from "@/components/ui/lang-switcher";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
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
  const STEP_LABELS = [d("me_step_import"), d("me_step_scale"), d("me_step_survey"), d("me_step_results")];
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

  // Devis info
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [tvaRate, setTvaRate] = useState<number>(10); // 10% travaux par défaut

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
      if (s.projectName) setProjectName(s.projectName);
      if (s.clientName)  setClientName(s.clientName);
      if (s.activeTypeId) setActiveTypeId(s.activeTypeId);
      if (s.imageB64) {
        setImageB64(s.imageB64);
        setImageMime(s.imageMime || "image/png");
        if (s.step !== undefined) setStep(s.step);
      }
    } catch { /* silencieux */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── localStorage : sauvegarde à chaque changement ─────────────────────────
  useEffect(() => {
    if (!imageB64) return; // ne pas sauvegarder un projet vide
    const payload = { imageB64, imageMime, zones, surfaceTypes, ppm, tvaRate, projectName, clientName, activeTypeId, step };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Quota dépassé → sauvegarder sans l'image
      try {
        const { imageB64: _img, imageMime: _mime, ...rest } = payload;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...rest, step: 0 }));
      } catch { /* silencieux */ }
    }
  }, [imageB64, imageMime, zones, surfaceTypes, ppm, tvaRate, projectName, clientName, activeTypeId, step]);

  // ── Nouveau projet ─────────────────────────────────────────────────────────
  const newProject = () => {
    if (!confirm("Effacer le projet en cours et repartir de zéro ?")) return;
    localStorage.removeItem(STORAGE_KEY);
    setImageB64(null); setImageMime("image/png"); setImageNatural({ w: 0, h: 0 });
    setZones([]); setSurfaceTypes(DEFAULT_SURFACE_TYPES);
    setPpm(null); setProjectName(""); setClientName("");
    setActiveTypeId(DEFAULT_SURFACE_TYPES[0].id); setStep(0);
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

  const handleScaled = (value: number | null) => {
    setPpm(value);
    setStep(2);
  };

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

  // ── Export PDF Devis ───────────────────────────────────────────────────────
  const exportPdfDevis = async () => {
    if (!imageB64) return;
    setExportingPdf(true);
    try {
      // Rendu du plan annoté côté client (zones colorées + labels)
      let planB64 = imageB64;
      try {
        planB64 = await renderAnnotatedPlan(imageB64, imageMime, zones, surfaceTypes, ppm);
      } catch { /* fallback sur image brute */ }

      const surface_totals = surfaceTypes
        .filter(t => (totals[t.id] ?? 0) > 0)
        .map(t => ({
          name: t.name,
          color: t.color,
          area_m2: totals[t.id] ?? 0,
          price_per_m2: t.pricePerM2 ?? 0,
        }));

      const r = await fetch(`${BACKEND}/export-measure-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_b64: planB64,       // ← plan avec zones superposées
          surface_totals,
          total_m2: totalAll,
          ppm,
          project_name: projectName,
          client_name: clientName,
          tva_rate: tvaRate,
        }),
      });
      if (!r.ok) throw new Error(`Erreur PDF ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "floorscan_devis.pdf";
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Devis PDF exporté", variant: "success" });
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
                <p className="text-slate-600 text-sm">PDF, JPG, PNG, TIFF</p>
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

          {/* ── STEP 1: Scale ── */}
          {step === 1 && imageB64 && (
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

          {/* ── STEP 2: Measure ── */}
          {step === 2 && imageB64 && (
            <div className="flex flex-col lg:flex-row gap-6">
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-display text-xl font-700 text-white">{d("me_draw")}</h2>
                  <div className="flex items-center gap-2">
                    {ppm && (
                      <span className="text-xs text-slate-500 glass border border-white/5 rounded-lg px-2.5 py-1 font-mono">
                        {ppm.toFixed(1)} px/m
                      </span>
                    )}
                    <Button size="sm" onClick={() => setStep(3)} disabled={zones.length === 0}>
                      {d("me_view_results")}
                    </Button>
                  </div>
                </div>
                <MeasureCanvas
                  imageB64={imageB64}
                  imageMime={imageMime}
                  zones={zones}
                  activeTypeId={activeTypeId}
                  surfaceTypes={surfaceTypes}
                  ppm={ppm}
                  onZonesChange={setZones}
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

          {/* ── STEP 3: Results ── */}
          {step === 3 && (() => {
            const activeSurfaces = surfaceTypes.filter(t => (totals[t.id] ?? 0) > 0);
            const hasPrices = activeSurfaces.some(t => (t.pricePerM2 ?? 0) > 0);
            const totalHT = activeSurfaces.reduce((s, t) => s + (totals[t.id] ?? 0) * (t.pricePerM2 ?? 0), 0);
            const tvaAmount = totalHT * tvaRate / 100;
            const totalTTC = totalHT + tvaAmount;

            return (
              <div className="max-w-2xl mx-auto">
                <div className="text-center mb-8">
                  <h2 className="font-display text-2xl font-700 text-white mb-2">{d("me_summary")}</h2>
                  <p className="text-slate-400 text-sm">{zones.length} zone{zones.length > 1 ? "s" : ""} mesurée{zones.length > 1 ? "s" : ""}</p>
                </div>

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
                    ⚠ Aucune échelle définie — les surfaces sont en px². Retournez à l'étape 2 pour calibrer.
                  </p>
                )}

                <div className="flex gap-3 justify-center flex-wrap">
                  <Button variant="outline" onClick={() => setStep(2)}>
                    {d("me_back_survey")}
                  </Button>
                  <Button variant="outline" onClick={exportCsv} className="flex items-center gap-1.5">
                    <FileText className="w-4 h-4" /> CSV
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

          <div className="flex items-center gap-3">
            <LangSwitcher />
            {imageB64 && (
              <button
                onClick={newProject}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white glass border border-white/10 rounded-lg px-2.5 py-1.5 transition-colors"
                title="Nouveau projet"
              >
                <PlusCircle className="w-3.5 h-3.5" /> Nouveau
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
