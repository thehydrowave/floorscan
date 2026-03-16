"use client";

import { useCallback, useEffect, useState } from "react";
import { Upload, FileText, AlertCircle, ChevronLeft, ChevronRight, BookOpen, HardDrive } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

import { BACKEND } from "@/lib/backend";
const MAX_SIZE_MB = 50;

interface UploadStepProps {
  onUploaded: (sessionId: string, imageB64: string) => void;
  onPdfMetadata?: (data: { pdfBase64: string; fileName: string; pageCount: number }) => void;
  onPageSelected?: (pageIdx: number) => void;
  initialPdfData?: { pdfBase64: string; fileName: string; pageCount: number };
  analyzedPages?: number[];
  titleOverride?: string;
  subtitleOverride?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

export default function UploadStep({ onUploaded, onPdfMetadata, onPageSelected, initialPdfData, analyzedPages, titleOverride, subtitleOverride }: UploadStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<string | null>(null);

  // Multi-page state
  const [pageCount, setPageCount] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string | null>(null);
  const [awaitingPage, setAwaitingPage] = useState(false);

  // Auto-enter page selector when returning from editor with saved PDF data
  useEffect(() => {
    if (initialPdfData && !awaitingPage) {
      setPdfBase64(initialPdfData.pdfBase64);
      setPendingFileName(initialPdfData.fileName);
      setPageCount(initialPdfData.pageCount);
      setCurrentPage(0);
      setAwaitingPage(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const uploadPage = useCallback(async (b64: string, fname: string, page: number) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${BACKEND}/upload-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdf_base64: b64, filename: fname, zoom: 3.0, page }),
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail ?? `Erreur serveur ${r.status}`);
      }

      const data = await r.json();
      const count = data.page_count ?? 1;
      setPageCount(count);
      setCurrentPage(page);

      if (count > 1 && page === 0 && !awaitingPage) {
        // First load of a multi-page PDF → show page selector
        setPdfBase64(b64);
        setPendingFileName(fname);
        setAwaitingPage(true);
        setLoading(false);
        onPdfMetadata?.({ pdfBase64: b64, fileName: fname, pageCount: count });
        return;
      }

      toast({ title: dt("up_pdf_loaded", lang), description: `${data.width}×${data.height} px`, variant: "success" });
      setAwaitingPage(false);
      onUploaded(data.session_id, data.image_b64);
    } catch (e: any) {
      const msg = e.message ?? dt("err_unknown", lang);
      setError(msg);
      toast({ title: dt("up_err_upload", lang), description: msg, variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [onUploaded, onPdfMetadata, lang, awaitingPage]);

  const processFile = useCallback(async (f: File) => {
    setError(null);
    setAwaitingPage(false);

    const ext = f.name.toLowerCase().split('.').pop() ?? '';
    const isImage = ['jpg', 'jpeg', 'png'].includes(ext);
    const isPdf = ext === 'pdf';

    // Type validation
    if (!isPdf && !isImage) {
      setError(d("up_bad_format"));
      return;
    }

    // Size validation
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`${d("up_file_too_large")} (${formatBytes(f.size)}). Max ${MAX_SIZE_MB} MB.`);
      return;
    }

    // Empty file check
    if (f.size === 0) {
      setError(d("up_file_empty"));
      return;
    }

    setFileName(f.name);
    setFileSize(formatBytes(f.size));

    let b64: string;
    try {
      b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = () => reject(new Error(d("up_file_read_error")));
        reader.readAsDataURL(f);
      });
    } catch (e: any) {
      setError(e.message);
      return;
    }

    if (isImage) {
      // Direct image upload — no multi-page
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`${BACKEND}/upload-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_base64: b64, filename: f.name }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.detail ?? `Erreur serveur ${r.status}`);
        }
        const data = await r.json();
        toast({ title: d("up_img_loaded"), description: `${data.width}×${data.height} px`, variant: "success" });
        onUploaded(data.session_id, data.image_b64);
      } catch (e: any) {
        const msg = e.message ?? d("err_unknown");
        setError(msg);
        toast({ title: d("up_err_upload"), description: msg, variant: "error" });
      } finally {
        setLoading(false);
      }
    } else {
      await uploadPage(b64, f.name, 0);
    }
  }, [uploadPage, onUploaded, lang, d]);

  const confirmPage = async () => {
    if (!pdfBase64 || !pendingFileName) return;
    onPageSelected?.(currentPage);
    await uploadPage(pdfBase64, pendingFileName, currentPage);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  }, [processFile]);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="font-display text-2xl font-700 text-white mb-2">{titleOverride ?? d("up_title")}</h2>
        <p className="text-slate-400 text-sm">{subtitleOverride ?? d("up_sub")}</p>
      </div>

      <AnimatePresence mode="wait">
        {/* ── Page selector ── */}
        {awaitingPage ? (
          <motion.div key="pages" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="glass border border-white/10 rounded-2xl p-8 text-center">
            <BookOpen className="w-10 h-10 text-accent mx-auto mb-4" />
            <p className="text-white font-display font-700 text-lg mb-1">{pendingFileName}</p>
            <p className="text-slate-400 text-sm mb-6">
              {d("up_multipage_hint")} ({pageCount} pages)
            </p>
            {/* Page picker */}
            <div className="flex items-center justify-center gap-3 mb-6">
              <button
                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="glass border border-white/10 rounded-lg p-2 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="flex gap-1.5 flex-wrap justify-center max-w-xs">
                {Array.from({ length: Math.min(pageCount, 20) }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentPage(i)}
                    className={cn(
                      "w-9 h-9 rounded-lg text-sm font-mono font-600 transition-all relative",
                      currentPage === i
                        ? "bg-accent text-white"
                        : "glass border border-white/10 text-slate-400 hover:text-white"
                    )}
                  >
                    {i + 1}
                    {analyzedPages?.includes(i) && (
                      <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full flex items-center justify-center text-[7px] text-white font-bold">✓</span>
                    )}
                  </button>
                ))}
                {pageCount > 20 && (
                  <span className="text-slate-500 text-xs self-center">+{pageCount - 20}</span>
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
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => { setAwaitingPage(false); setFileName(null); setFileSize(null); }}
                className="px-4 py-2 glass border border-white/10 rounded-xl text-sm text-slate-400 hover:text-white transition-colors"
              >
                {d("up_cancel")}
              </button>
              <button
                onClick={confirmPage}
                disabled={loading}
                className="px-6 py-2 bg-accent hover:bg-accent/80 disabled:opacity-50 text-white rounded-xl text-sm font-600 transition-colors"
              >
                {loading ? d("up_loading") : `${d("up_analyze_page")} ${currentPage + 1}`}
              </button>
            </div>
          </motion.div>
        ) : (
          /* ── Drop zone ── */
          <motion.div key="dropzone" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => !loading && document.getElementById("file-input-demo")?.click()}
              className={cn(
                "relative border-2 border-dashed border-white/10 rounded-2xl p-12 text-center transition-all duration-200 cursor-pointer hover:border-accent/40 hover:bg-accent/5",
                dragging && "border-accent/60 bg-accent/10"
              )}
            >
              <input id="file-input-demo" type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ""; }} />

              {loading ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center animate-pulse">
                    <FileText className="w-6 h-6 text-accent" />
                  </div>
                  <p className="text-slate-400 text-sm">{d("up_sending")}</p>
                  <p className="text-slate-600 text-xs">
                    {fileName}
                    {fileSize && <span className="ml-2 text-slate-700">({fileSize})</span>}
                  </p>
                </div>
              ) : fileName && !error ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-accent-green/10 flex items-center justify-center">
                    <FileText className="w-6 h-6 text-accent-green" />
                  </div>
                  <p className="text-slate-200 font-medium">{fileName}</p>
                  {fileSize && (
                    <p className="flex items-center gap-1 text-xs text-slate-600">
                      <HardDrive className="w-3 h-3" /> {fileSize}
                    </p>
                  )}
                  <p className="text-slate-500 text-sm">{d("up_success")}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center transition-all", dragging ? "bg-accent/20 scale-110" : "bg-white/5")}>
                    <Upload className={cn("w-7 h-7 transition-colors", dragging ? "text-accent" : "text-slate-500")} />
                  </div>
                  <div>
                    <p className="text-slate-200 font-medium mb-1">{dragging ? d("up_drop") : d("up_drag")}</p>
                    <p className="text-slate-500 text-sm">{d("up_click")}</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="px-3 py-1 glass rounded-md border border-white/5 text-xs text-slate-600">{d("up_formats")}</span>
                    <span className="px-3 py-1 glass rounded-md border border-white/5 text-xs text-slate-600">Max {MAX_SIZE_MB} Mo</span>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="mt-4 flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p>{error}</p>
                  {(error.includes("serveur") || error.includes("server") || error.includes("backend")) && (
                    <p className="text-xs text-red-400/70 mt-1">
                      {d("up_backend_error")}
                    </p>
                  )}
                </div>
              </div>
            )}

            {!loading && (
              <p className="text-center text-xs text-slate-600 mt-6">
                {d("up_backend_hint")}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
