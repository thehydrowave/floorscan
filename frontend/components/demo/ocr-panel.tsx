"use client";

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Type, ChevronDown, ChevronUp, Loader2, AlertTriangle, MapPin } from "lucide-react";
import type { AnalysisResult, Room } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

interface OcrLabel {
  text: string;
  confidence: number;
  x_norm: number;
  y_norm: number;
  w_norm: number;
  h_norm: number;
}

interface OcrPanelProps {
  result: AnalysisResult;
}

export default function OcrPanel({ result }: OcrPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [expanded, setExpanded] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [labels, setLabels] = useState<OcrLabel[]>([]);
  const [hasRun, setHasRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<any>(null);

  const planB64 = result.plan_b64 || result.overlay_openings_b64;

  const runOcr = useCallback(async () => {
    if (!planB64 || running) return;
    setRunning(true);
    setProgress(0);
    setError(null);
    setLabels([]);

    try {
      // Dynamic import to avoid bundling in SSR
      const Tesseract = await import("tesseract.js");

      // Create an offscreen image to get natural dimensions
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = `data:image/png;base64,${planB64}`;
      });
      const imgW = img.naturalWidth;
      const imgH = img.naturalHeight;

      const worker = await Tesseract.createWorker("fra+eng", undefined, {
        logger: (m: any) => {
          if (m.status === "recognizing text") {
            setProgress(Math.round((m.progress ?? 0) * 100));
          }
        },
      });
      workerRef.current = worker;

      const { data } = await worker.recognize(`data:image/png;base64,${planB64}`);

      // Convert Tesseract words to OcrLabels
      // Tesseract.js v5: data is a Page, words are accessed via data.blocks[].paragraphs[].lines[].words[]
      // Or we can cast and access legacy compat fields
      const detected: OcrLabel[] = [];
      const anyData = data as any;
      const wordList: any[] = anyData.words ?? [];
      // Fallback: extract words from blocks hierarchy if .words is empty
      if (wordList.length === 0 && anyData.blocks) {
        for (const block of anyData.blocks) {
          for (const para of block.paragraphs ?? []) {
            for (const line of para.lines ?? []) {
              for (const word of line.words ?? []) {
                wordList.push(word);
              }
            }
          }
        }
      }
      for (const word of wordList) {
        const text = (word.text ?? "").trim();
        if (text.length < 2) continue; // skip single chars
        const conf = word.confidence ?? 0;
        if (conf < 30) continue; // skip very low confidence
        const bbox = word.bbox ?? { x0: 0, y0: 0, x1: 0, y1: 0 };

        detected.push({
          text,
          confidence: Math.round(conf),
          x_norm: bbox.x0 / imgW,
          y_norm: bbox.y0 / imgH,
          w_norm: (bbox.x1 - bbox.x0) / imgW,
          h_norm: (bbox.y1 - bbox.y0) / imgH,
        });
      }

      setLabels(detected);
      setHasRun(true);
      await worker.terminate();
      workerRef.current = null;
    } catch (e: any) {
      console.error("OCR error:", e);
      setError(e.message ?? "OCR failed");
    } finally {
      setRunning(false);
    }
  }, [planB64, running]);

  /** Try to match OCR text labels to rooms by position overlap */
  const mapToRooms = useCallback(() => {
    const rooms = result.rooms ?? [];
    if (rooms.length === 0 || labels.length === 0) return;

    const mapped: OcrLabel[] = labels.map(label => {
      const lCx = label.x_norm + label.w_norm / 2;
      const lCy = label.y_norm + label.h_norm / 2;

      // Find room whose bbox contains this label's center
      let bestRoom: Room | null = null;
      for (const room of rooms) {
        const rb = room.bbox_norm;
        if (lCx >= rb.x && lCx <= rb.x + rb.w && lCy >= rb.y && lCy <= rb.y + rb.h) {
          bestRoom = room;
          break;
        }
      }

      if (bestRoom) {
        return { ...label, text: `${label.text} [→ ${bestRoom.label_fr}]` };
      }
      return label;
    });

    setLabels(mapped);
  }, [labels, result.rooms]);

  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden mt-4">
      {/* ── Header ── */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Type className="w-5 h-5 text-violet-400" />
          <span className="font-display font-semibold text-white text-sm">
            {d("ocr_title" as DTKey)}
          </span>
          <span className="text-[10px] bg-violet-500/20 border border-violet-500/30 rounded px-1.5 py-0.5 font-semibold text-violet-400 uppercase tracking-wider">
            Beta
          </span>
          {hasRun && labels.length > 0 && (
            <span className="text-xs text-slate-500 ml-2">
              {d("ocr_found" as DTKey).replace("{n}", String(labels.length))}
            </span>
          )}
        </div>
        {expanded
          ? <ChevronUp className="w-5 h-5 text-slate-400" />
          : <ChevronDown className="w-5 h-5 text-slate-400" />}
      </button>

      {/* ── Content ── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="ocr-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-2 space-y-4">
              {!planB64 && (
                <div className="flex items-center gap-2 text-amber-500 text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  No image available for OCR
                </div>
              )}

              {planB64 && (
                <>
                  {/* Launch button */}
                  {!hasRun && !running && (
                    <button
                      onClick={runOcr}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-500/20 text-violet-400 border border-violet-500/30 hover:bg-violet-500/30 transition-colors text-sm font-semibold"
                    >
                      <Type className="w-4 h-4" />
                      {d("ocr_launch" as DTKey)}
                    </button>
                  )}

                  {/* Progress */}
                  {running && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-slate-400">
                        <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                        {d("ocr_running" as DTKey)}
                      </div>
                      <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-violet-500 rounded-full transition-all duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-600">{progress}%</p>
                    </div>
                  )}

                  {/* Error */}
                  {error && (
                    <div className="flex items-center gap-2 text-red-400 text-sm">
                      <AlertTriangle className="w-4 h-4" />
                      {error}
                    </div>
                  )}

                  {/* Results */}
                  {hasRun && !running && (
                    <>
                      {labels.length === 0 ? (
                        <p className="text-sm text-slate-500">{d("ocr_no_text" as DTKey)}</p>
                      ) : (
                        <>
                          {/* Actions */}
                          <div className="flex items-center gap-3 flex-wrap">
                            <button
                              onClick={runOcr}
                              className="text-xs text-slate-400 hover:text-white transition-colors"
                            >
                              Re-run OCR
                            </button>
                            {(result.rooms ?? []).length > 0 && (
                              <button
                                onClick={mapToRooms}
                                className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                              >
                                <MapPin className="w-3 h-3" />
                                {d("ocr_map_rooms" as DTKey)}
                              </button>
                            )}
                          </div>

                          {/* Table */}
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-white/10">
                                  <th className="text-left text-xs text-slate-500 font-600 pb-2 pr-4">{d("ocr_text" as DTKey)}</th>
                                  <th className="text-right text-xs text-slate-500 font-600 pb-2 px-2">{d("ocr_confidence" as DTKey)}</th>
                                  <th className="text-right text-xs text-slate-500 font-600 pb-2 pl-2">Position</th>
                                </tr>
                              </thead>
                              <tbody>
                                {labels.map((label, i) => (
                                  <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                                    <td className="py-1.5 pr-4 text-slate-300 font-mono text-xs">{label.text}</td>
                                    <td className="text-right py-1.5 px-2">
                                      <span className={`font-mono text-xs ${
                                        label.confidence >= 80 ? "text-emerald-400" :
                                        label.confidence >= 60 ? "text-amber-400" : "text-red-400"
                                      }`}>
                                        {label.confidence}%
                                      </span>
                                    </td>
                                    <td className="text-right py-1.5 pl-2 text-xs text-slate-600 font-mono">
                                      ({(label.x_norm * 100).toFixed(0)}%, {(label.y_norm * 100).toFixed(0)}%)
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
