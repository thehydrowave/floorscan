"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Brain, Loader2, ArrowRight, AlertTriangle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FacadeAnalysisResult, FacadeElement, FacadeElementType } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

import { BACKEND } from "@/lib/backend";

interface FacadeAnalyzeStepProps {
  sessionId: string;
  imageB64: string;
  apiKey: string;
  ppm?: number | null;
  onAnalyzed: (result: FacadeAnalysisResult) => void;
}

/* ── Labels français par type ── */
const LABELS_FR: Record<FacadeElementType, string> = {
  window: "Fenêtre",
  door: "Porte",
  balcony: "Balcon",
  floor_line: "Ligne d'étage",
  roof: "Toiture",
  column: "Colonne",
  other: "Autre",
};

/* ── Mock facade result generator ── */
function generateMockFacadeResult(
  sessionId: string,
  imageB64: string,
  ppm: number | null,
): FacadeAnalysisResult {
  const elements: FacadeElement[] = [];
  let id = 0;

  // Façade dimensions (normalized): leave 10% margin on all sides
  const facadeX = 0.08;
  const facadeY = 0.06;
  const facadeW = 0.84;
  const facadeH = 0.88;

  // Generate 3 floors
  const floorsCount = 3;
  const floorH = facadeH / floorsCount;

  for (let floor = 0; floor < floorsCount; floor++) {
    const floorY = facadeY + floor * floorH;
    const floorLevel = floorsCount - 1 - floor; // top floor = highest number

    // Floor line (except for the top)
    if (floor > 0) {
      elements.push({
        id: id++,
        type: "floor_line",
        label_fr: "Ligne d'étage",
        bbox_norm: { x: facadeX, y: floorY - 0.005, w: facadeW, h: 0.01 },
        area_m2: null,
        floor_level: floorLevel + 1,
      });
    }

    // Windows per floor (3-4)
    const winCount = floor === 0 ? 3 : 4;
    const winW = 0.08;
    const winH = floorH * 0.45;
    const spacing = facadeW / (winCount + 1);

    for (let w = 0; w < winCount; w++) {
      const wx = facadeX + spacing * (w + 1) - winW / 2;
      const wy = floorY + floorH * 0.2;
      const areaPx2 = winW * winH; // normalized area
      elements.push({
        id: id++,
        type: "window",
        label_fr: "Fenêtre",
        bbox_norm: { x: wx, y: wy, w: winW, h: winH },
        area_m2: ppm ? (areaPx2 * (1 / (ppm * ppm))) * 1e6 : null,
        floor_level: floorLevel,
        confidence: 0.85 + Math.random() * 0.12,
      });
    }

    // Balconies (floors 1 and 2 only — i.e. not ground floor)
    if (floorLevel > 0 && floorLevel < floorsCount - 1) {
      const balW = 0.25;
      const balH = floorH * 0.12;
      const bx = facadeX + facadeW / 2 - balW / 2;
      const by = floorY + floorH * 0.72;
      elements.push({
        id: id++,
        type: "balcony",
        label_fr: "Balcon",
        bbox_norm: { x: bx, y: by, w: balW, h: balH },
        area_m2: ppm ? (balW * balH) / (ppm * ppm) * 1e6 : null,
        floor_level: floorLevel,
        confidence: 0.78 + Math.random() * 0.15,
      });
    }

    // Door (ground floor only)
    if (floorLevel === 0) {
      const doorW = 0.06;
      const doorH = floorH * 0.65;
      const dx = facadeX + facadeW / 2 - doorW / 2;
      const dy = floorY + floorH - doorH - 0.02;
      elements.push({
        id: id++,
        type: "door",
        label_fr: "Porte",
        bbox_norm: { x: dx, y: dy, w: doorW, h: doorH },
        area_m2: ppm ? (doorW * doorH) / (ppm * ppm) * 1e6 : null,
        floor_level: 0,
        confidence: 0.91,
      });
    }
  }

  // Count elements
  const windows = elements.filter(e => e.type === "window");
  const doors = elements.filter(e => e.type === "door");
  const balconies = elements.filter(e => e.type === "balcony");

  // Total openings area
  const openingElements = elements.filter(e => ["window", "door", "balcony"].includes(e.type));
  const openings_area_m2 = ppm
    ? openingElements.reduce((s, e) => s + (e.area_m2 ?? 0), 0)
    : null;

  const facade_area_m2 = ppm ? (facadeW * facadeH) / (ppm * ppm) * 1e6 : null;
  const ratio_openings = facade_area_m2 && openings_area_m2
    ? openings_area_m2 / facade_area_m2
    : null;

  return {
    session_id: sessionId,
    windows_count: windows.length,
    doors_count: doors.length,
    balconies_count: balconies.length,
    floors_count: floorsCount,
    elements,
    facade_area_m2,
    openings_area_m2,
    ratio_openings,
    pixels_per_meter: ppm,
    overlay_b64: imageB64,
    plan_b64: imageB64,
    is_mock: true,
  };
}

export default function FacadeAnalyzeStep({
  sessionId, imageB64, apiKey, ppm, onAnalyzed,
}: FacadeAnalyzeStepProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);

    const steps = [
      d("an_p1"),
      d("fa_analyzing"),
      d("an_p4"),
      d("an_p5"),
      d("an_p6"),
    ];
    let i = 0;
    setProgress(steps[0]);
    const interval = setInterval(() => {
      i = Math.min(i + 1, steps.length - 1);
      setProgress(steps[i]);
    }, 1500);

    try {
      // Try calling backend with real Roboflow model
      const r = await fetch(`${BACKEND}/analyze-facade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          admin_key: process.env.NEXT_PUBLIC_FACADE_ADMIN_KEY ?? "",
          roboflow_api_key: apiKey,
          pixels_per_meter: ppm ?? null,
        }),
      });

      clearInterval(interval);

      if (r.ok) {
        const data = await r.json();
        data.session_id = sessionId;
        toast({
          title: d("fa_title"),
          description: `${data.windows_count} ${d("fa_windows").toLowerCase()} · ${data.doors_count} ${d("fa_doors").toLowerCase()} · ${data.floors_count} ${d("fa_floors").toLowerCase()}`,
          variant: "success",
        });
        setLoading(false);
        setProgress("");
        onAnalyzed(data as FacadeAnalysisResult);
        return;
      }
      // If backend doesn't have the endpoint, fall through to mock
      throw new Error("no-backend");
    } catch {
      clearInterval(interval);
    }

    // ── Generate mock results ──
    setProgress(d("fa_no_model"));

    await new Promise(res => setTimeout(res, 800));

    const mockResult = generateMockFacadeResult(sessionId, imageB64, ppm ?? null);

    toast({
      title: d("fa_title"),
      description: d("fa_no_model"),
      variant: "default",
    });

    setLoading(false);
    setProgress("");
    onAnalyzed(mockResult);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-xl mx-auto">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mx-auto mb-4">
          <Brain className="w-8 h-8 text-white" />
        </div>
        <h2 className="font-display text-2xl font-700 text-white mb-2">{d("fa_title")}</h2>
        <p className="text-slate-400 text-sm">{d("fa_subtitle")}</p>
      </div>

      <div className="glass rounded-2xl border border-white/10 p-8 flex flex-col items-center gap-6">
        {/* Config info */}
        <div className="w-full glass rounded-xl border border-white/5 p-4 text-xs font-mono text-slate-500 flex flex-col gap-2">
          <div className="flex justify-between">
            <span>Module</span>
            <span className="text-amber-400">{d("fa_title")}</span>
          </div>
          <div className="flex justify-between">
            <span>Session</span>
            <span className="text-slate-400">{sessionId.slice(0, 8)}...</span>
          </div>
          <div className="flex justify-between">
            <span>{d("fa_st_scale")}</span>
            <span className={ppm ? "text-accent-green" : "text-slate-500"}>
              {ppm ? `${ppm.toFixed(1)} px/m` : "Auto"}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Status</span>
            <span className="text-amber-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> {d("fa_wip")}
            </span>
          </div>
        </div>

        {/* Mock warning */}
        <div className="w-full glass rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300/80 leading-relaxed">{d("fa_mock_warn")}</p>
        </div>

        {/* Loader */}
        {loading && (
          <div className="flex flex-col items-center gap-4 w-full">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center">
              <Brain className="w-7 h-7 text-amber-400 animate-pulse" />
            </div>
            <p className="text-slate-300 text-sm font-medium text-center">{progress}</p>
            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full animate-pulse w-3/4" />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="w-full glass rounded-xl border border-red-500/25 p-4 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300/80">{error}</p>
          </div>
        )}

        {/* Launch button */}
        {!loading && (
          <Button onClick={runAnalysis} className="w-full bg-amber-600 hover:bg-amber-700" size="lg">
            <Zap className="w-4 h-4" />
            {d("an_launch")}
            <ArrowRight className="w-4 h-4" />
          </Button>
        )}
      </div>
    </motion.div>
  );
}
