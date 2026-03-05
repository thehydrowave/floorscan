"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ScanLine, ArrowLeft, Upload, Ruler, PenLine, BarChart3, Loader2, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import ScaleStep from "@/components/demo/scale-step";
import MeasureCanvas from "@/components/measure/measure-canvas";
import SurfacePanel from "@/components/measure/surface-panel";
import { SurfaceType, MeasureZone, DEFAULT_SURFACE_TYPES, aggregateByType } from "@/lib/measure-types";

const STEP_LABELS = ["Import", "Échelle", "Métré", "Résultats"];

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export default function MeasureClient({ embedded = false }: { embedded?: boolean }) {
  const [step, setStep] = useState(0);

  // Image state
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState("image/png");
  const [imageNatural, setImageNatural] = useState({ w: 0, h: 0 });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Scale
  const [ppm, setPpm] = useState<number | null>(null);

  // Measure state
  const [zones, setZones] = useState<MeasureZone[]>([]);
  const [surfaceTypes, setSurfaceTypes] = useState<SurfaceType[]>(DEFAULT_SURFACE_TYPES);
  const [activeTypeId, setActiveTypeId] = useState(DEFAULT_SURFACE_TYPES[0].id);

  // ── Upload ──────────────────────────────────────────────────────────────
  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      if (file.type === "application/pdf") {
        // Send to backend to render first page as image
        const fd = new FormData();
        fd.append("file", file);
        const r = await fetch(`${BACKEND}/upload`, { method: "POST", body: fd });
        if (!r.ok) throw new Error("Erreur upload PDF");
        const data = await r.json();
        setImageB64(data.preview_b64);
        setImageMime("image/png");
      } else {
        // Direct image — read as base64
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          const [header, b64] = dataUrl.split(",");
          const mime = header.split(":")[1].split(";")[0];
          setImageB64(b64);
          setImageMime(mime);
        };
        reader.readAsDataURL(file);
      }
      setStep(1);
    } catch (err: any) {
      alert("Erreur : " + err.message);
    } finally {
      setUploading(false);
    }
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
            {step === 0 && (
              <div className="max-w-xl mx-auto">
                <div className="text-center mb-8">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-400 to-accent flex items-center justify-center mx-auto mb-4">
                    <PenLine className="w-8 h-8 text-white" />
                  </div>
                  <h1 className="font-display text-3xl font-700 text-white mb-2">Outil de métré</h1>
                  <p className="text-slate-400">Importez un plan, définissez l'échelle et mesurez vos surfaces par type.</p>
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
                    {uploading ? "Traitement en cours..." : "Glissez votre fichier ici"}
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
                    { icon: <ImageIcon className="w-5 h-5" />, label: "PDF, JPG, PNG…" },
                    { icon: <Ruler className="w-5 h-5" />, label: "Échelle 2 points" },
                    { icon: <BarChart3 className="w-5 h-5" />, label: "Agrégation par type" },
                  ].map((item, i) => (
                    <div key={i} className="glass border border-white/5 rounded-xl p-4 text-center">
                      <div className="text-accent mx-auto mb-2 flex justify-center">{item.icon}</div>
                      <p className="text-xs text-slate-400">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── STEP 1: Scale ── */}
            {step === 1 && imageB64 && (
              <ScaleStep imageB64={imageB64} onScaled={handleScaled} />
            )}

            {/* ── STEP 2: Measure ── */}
            {step === 2 && imageB64 && (
              <div className="flex flex-col lg:flex-row gap-6">
                {/* Canvas */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-display text-xl font-700 text-white">Dessiner les zones</h2>
                    <div className="flex items-center gap-2">
                      {ppm && (
                        <span className="text-xs text-slate-500 glass border border-white/5 rounded-lg px-2.5 py-1 font-mono">
                          {ppm.toFixed(1)} px/m
                        </span>
                      )}
                      <Button size="sm" onClick={() => setStep(3)} disabled={zones.length === 0}>
                        Voir résultats →
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
                    onZonesChange={newZones => {
                      setZones(newZones);
                      // capture natural size on first render
                      const img = new Image();
                      img.onload = () => setImageNatural({ w: img.naturalWidth, h: img.naturalHeight });
                      img.src = `data:${imageMime};base64,${imageB64}`;
                    }}
                  />
                </div>

                {/* Sidebar */}
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
            {step === 3 && (
              <div className="max-w-2xl mx-auto">
                <div className="text-center mb-8">
                  <h2 className="font-display text-2xl font-700 text-white mb-2">Récapitulatif</h2>
                  <p className="text-slate-400 text-sm">{zones.length} zone{zones.length > 1 ? "s" : ""} mesurée{zones.length > 1 ? "s" : ""}</p>
                </div>

                <div className="glass rounded-2xl border border-white/10 overflow-hidden mb-6">
                  <div className="p-4 border-b border-white/5 flex items-center justify-between">
                    <span className="text-sm font-600 text-slate-300">Type</span>
                    <span className="text-sm font-600 text-slate-300">Surface</span>
                  </div>
                  {surfaceTypes.filter(t => totals[t.id] > 0).map(type => (
                    <div key={type.id} className="flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0">
                      <span className="w-3 h-3 rounded-full" style={{ background: type.color }} />
                      <span className="text-slate-200 flex-1">{type.name}</span>
                      <span className="font-mono text-white font-600">
                        {ppm ? `${totals[type.id].toFixed(2)} m²` : `${Math.round(totals[type.id]).toLocaleString()} px²`}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 px-4 py-3 bg-white/5">
                    <span className="w-3 h-3" />
                    <span className="text-white font-600 flex-1">Total</span>
                    <span className="font-mono text-accent font-700 text-lg">
                      {ppm ? `${totalAll.toFixed(2)} m²` : `${Math.round(totalAll).toLocaleString()} px²`}
                    </span>
                  </div>
                </div>

                <div className="flex gap-3 justify-center">
                  <Button variant="outline" onClick={() => setStep(2)}>
                    ← Retour au métré
                  </Button>
                  <Button onClick={() => {
                    // Simple CSV export
                    const rows = [["Type", ppm ? "Surface (m²)" : "Surface (px²)"]];
                    surfaceTypes.filter(t => totals[t.id] > 0).forEach(t => {
                      rows.push([t.name, ppm ? totals[t.id].toFixed(4) : String(Math.round(totals[t.id]))]);
                    });
                    rows.push(["TOTAL", ppm ? totalAll.toFixed(4) : String(Math.round(totalAll))]);
                    const csv = rows.map(r => r.join(",")).join("\n");
                    const blob = new Blob([csv], { type: "text/csv" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = "metrage.csv";
                    a.click();
                  }}>
                    Exporter CSV
                  </Button>
                </div>
              </div>
            )}

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

          <div className="flex items-center gap-3">
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
          </div>

          <Link href="/" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Retour
          </Link>
        </div>
      </div>

      {content}
    </div>
  );
}
