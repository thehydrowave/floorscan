"use client";

import { useCallback, useState } from "react";
import { Upload, FileText, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface UploadStepProps {
  onUploaded: (sessionId: string, imageB64: string) => void;
}

export default function UploadStep({ onUploaded }: UploadStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const processFile = useCallback(async (f: File) => {
    setError(null);
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      setError(dt("up_toast_errd", lang));
      return;
    }
    setLoading(true);
    setFileName(f.name);
    try {
      const pdfBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = () => reject(new Error("File read failed"));
        reader.readAsDataURL(f);
      });

      const r = await fetch(`${BACKEND}/upload-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdf_base64: pdfBase64, filename: f.name, zoom: 3.0 }),
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail ?? `Server error ${r.status}`);
      }

      const data = await r.json();
      toast({ title: dt("up_pdf_loaded", lang), description: `${data.width}x${data.height} px`, variant: "success" });
      onUploaded(data.session_id, data.image_b64);
    } catch (e: any) {
      setError(e.message);
      toast({ title: dt("up_err_upload", lang), description: e.message, variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [onUploaded, lang]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  }, [processFile]);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="font-display text-2xl font-700 text-white mb-2">{d("up_title")}</h2>
        <p className="text-slate-400 text-sm">{d("up_sub")}</p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !loading && document.getElementById("file-input")?.click()}
        className={cn(
          "relative border-2 border-dashed border-white/10 rounded-2xl p-12 text-center transition-all duration-200 cursor-pointer hover:border-accent/40 hover:bg-accent/5",
          dragging && "border-accent/60 bg-accent/10"
        )}
      >
        <input id="file-input" type="file" accept=".pdf" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }} />

        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center animate-pulse">
              <FileText className="w-6 h-6 text-accent" />
            </div>
            <p className="text-slate-400 text-sm">{d("up_sending")}</p>
            <p className="text-slate-600 text-xs">{fileName} — {d("up_sending_hint")}</p>
          </div>
        ) : fileName && !error ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-accent-green/10 flex items-center justify-center">
              <FileText className="w-6 h-6 text-accent-green" />
            </div>
            <p className="text-slate-200 font-medium">{fileName}</p>
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
            <span className="px-3 py-1 glass rounded-md border border-white/5 text-xs text-slate-600">{d("up_pdf_only")}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!loading && (
        <p className="text-center text-xs text-slate-600 mt-6">
          {d("up_backend_hint")}
        </p>
      )}
    </motion.div>
  );
}