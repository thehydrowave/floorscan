"use client";

/**
 * FacadeDebugPanel — Donnees brutes d'analyse facade.
 * Affiche: JSON complet (collapsible), dimensions image, PPM, ROI, elements par type,
 * donnees polygon/bbox par element.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bug,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Copy,
  Check,
} from "lucide-react";
import { FacadeAnalysisResult, FacadeElementType } from "@/lib/types";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

/* ── Stat line component ── */
function Stat({
  label,
  value,
  color = "text-slate-300",
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/[0.03]">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-xs font-mono ${color}`}>{String(value)}</span>
    </div>
  );
}

/* ── Collapsible section ── */
function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-white/5">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-white/[0.02] transition-colors cursor-pointer text-left"
      >
        <ChevronRight
          className={`w-3.5 h-3.5 text-slate-600 transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
        <span className="text-xs text-slate-400 font-medium">{title}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Props ── */
interface FacadeDebugPanelProps {
  result: FacadeAnalysisResult;
}

/* ── Type labels ── */
const ALL_TYPES: FacadeElementType[] = ["window", "door", "balcony", "floor_line", "roof", "column", "other"];

/* ── Type colors ── */
const TYPE_COLOR: Record<string, string> = {
  window:     "text-blue-400",
  door:       "text-pink-400",
  balcony:    "text-emerald-400",
  floor_line: "text-orange-400",
  roof:       "text-violet-400",
  column:     "text-slate-400",
  other:      "text-amber-400",
};

export default function FacadeDebugPanel({ result }: FacadeDebugPanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);
  const isFr = lang === "fr";

  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  /* ── Counts per type ── */
  const typeCounts = useMemo(() => {
    const map = new Map<FacadeElementType, number>();
    for (const el of result.elements) {
      map.set(el.type, (map.get(el.type) ?? 0) + 1);
    }
    return map;
  }, [result.elements]);

  /* ── Raw classes (de Roboflow, avant mapping) ── */
  const rawClasses = useMemo(() => {
    const counts = new Map<string, number>();
    for (const el of result.elements) {
      const rc = el.raw_class ?? "—";
      counts.set(rc, (counts.get(rc) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [result.elements]);

  /* ── Masks/overlays present ── */
  const overlays = useMemo(() => {
    const m: string[] = [];
    if (result.overlay_b64) m.push("overlay");
    if (result.plan_b64) m.push("plan");
    return m;
  }, [result]);

  /* ── Copy JSON (strip base64) ── */
  async function handleCopy() {
    try {
      const stripped = { ...result } as Record<string, unknown>;
      const b64Keys = ["overlay_b64", "plan_b64"];
      for (const k of b64Keys) {
        if (stripped[k]) {
          stripped[k] = `[base64 ${(stripped[k] as string).length} chars]`;
        }
      }
      await navigator.clipboard.writeText(JSON.stringify(stripped, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn("Clipboard copy failed:", e);
    }
  }

  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden mt-4 opacity-70 hover:opacity-100 transition-opacity">
      {/* Header toggle */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Bug className="w-4 h-4 text-slate-500" />
          <span className="font-display font-medium text-slate-400 text-xs">
            {isFr ? "Debug facade" : "Facade Debug"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!expanded && (
            <span className="text-[10px] text-slate-600 font-mono mr-2">
              {result.session_id?.slice(0, 8)}
            </span>
          )}
          {expanded
            ? <ChevronUp className="w-4 h-4 text-slate-600" />
            : <ChevronDown className="w-4 h-4 text-slate-600" />}
        </div>
      </button>

      {/* Expandable content */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="fadebug-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {/* Overview */}
            <Section title="Overview" defaultOpen={true}>
              <Stat label="Session ID" value={result.session_id || "—"} />
              <Stat
                label={isFr ? "Echelle (PPM)" : "Scale (PPM)"}
                value={
                  result.pixels_per_meter
                    ? `${result.pixels_per_meter.toFixed(2)} px/m`
                    : (isFr ? "non calibre" : "not calibrated")
                }
                color={result.pixels_per_meter ? "text-emerald-400" : "text-red-400"}
              />
              <Stat
                label={isFr ? "Surface facade" : "Facade area"}
                value={result.facade_area_m2 != null ? `${result.facade_area_m2.toFixed(2)} m²` : "—"}
              />
              <Stat
                label={isFr ? "Surface ouvertures" : "Openings area"}
                value={result.openings_area_m2 != null ? `${result.openings_area_m2.toFixed(2)} m²` : "—"}
              />
              <Stat
                label={isFr ? "Ratio ouvertures" : "Openings ratio"}
                value={result.ratio_openings != null ? `${(result.ratio_openings * 100).toFixed(1)}%` : "—"}
              />
              <Stat
                label={isFr ? "Elements totaux" : "Total elements"}
                value={result.elements.length}
                color="text-sky-400"
              />
              <Stat
                label={isFr ? "Donnees fictives" : "Mock data"}
                value={result.is_mock ? "true" : "false"}
                color={result.is_mock ? "text-amber-400" : "text-slate-400"}
              />
            </Section>

            {/* Element count per type */}
            <Section title={isFr ? "Comptage par type mappé" : "Count per mapped type"}>
              {ALL_TYPES.map(type => {
                const count = typeCounts.get(type) ?? 0;
                if (count === 0) return null;
                return (
                  <Stat
                    key={type}
                    label={type}
                    value={count}
                    color={TYPE_COLOR[type] ?? "text-sky-300"}
                  />
                );
              })}
              {result.elements.length === 0 && (
                <span className="text-[10px] text-slate-600">{isFr ? "Aucun element" : "No elements"}</span>
              )}
            </Section>

            {/* Raw classes from Roboflow — DIAGNOSTIC */}
            <Section title={isFr ? "⚠ Classes brutes Roboflow (diagnostic)" : "⚠ Raw Roboflow classes (diagnostic)"}>
              <p className="text-[10px] text-slate-600 mb-2">
                {isFr
                  ? "Noms de classes renvoyés par le modèle avant mapping. Si tout est 'other', le nom de classe n'est pas reconnu."
                  : "Class names returned by the model before mapping. If everything is 'other', the class name is not recognized."}
              </p>
              {rawClasses.length === 0 && (
                <span className="text-[10px] text-slate-600">{isFr ? "Aucun élément" : "No elements"}</span>
              )}
              {rawClasses.map(([rc, count]) => (
                <div key={rc} className="flex items-center justify-between py-1 border-b border-white/[0.03]">
                  <span className="text-[10px] font-mono text-amber-300">{rc}</span>
                  <span className="text-[10px] font-mono text-slate-500">×{count}</span>
                </div>
              ))}
            </Section>

            {/* ROI info */}
            <Section title="ROI (Region of Interest)">
              {result.building_roi ? (
                <>
                  <Stat label="x" value={result.building_roi.x.toFixed(4)} />
                  <Stat label="y" value={result.building_roi.y.toFixed(4)} />
                  <Stat label="w" value={result.building_roi.w.toFixed(4)} />
                  <Stat label="h" value={result.building_roi.h.toFixed(4)} />
                </>
              ) : (
                <span className="text-[10px] text-slate-600">
                  {isFr ? "Pas de ROI — image entiere" : "No ROI — full image"}
                </span>
              )}
            </Section>

            {/* Overlays present */}
            <Section title={`Overlays (${overlays.length})`}>
              <div className="flex flex-wrap gap-1.5">
                {overlays.map(m => (
                  <span
                    key={m}
                    className="text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-slate-400 font-mono"
                  >
                    {m}
                  </span>
                ))}
                {overlays.length === 0 && (
                  <span className="text-[10px] text-slate-600">{isFr ? "aucun" : "none"}</span>
                )}
              </div>
            </Section>

            {/* Raw element data */}
            {result.elements.length > 0 && (
              <Section title={`${isFr ? "Elements bruts" : "Raw elements"} (${result.elements.length})`}>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {result.elements.map((el, i) => (
                    <div
                      key={el.id ?? i}
                      className="text-[10px] py-1.5 border-b border-white/[0.02]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">
                          #{el.id}{" "}
                          <span className={TYPE_COLOR[el.type] ?? "text-sky-400"}>{el.type}</span>
                          {el.raw_class && el.raw_class !== el.type && (
                            <span className="text-amber-500/70 ml-1 font-mono text-[9px]">
                              ({el.raw_class})
                            </span>
                          )}
                          {el.floor_level != null && (
                            <span className="text-slate-600 ml-1">L{el.floor_level}</span>
                          )}
                        </span>
                        <span className="font-mono text-slate-500">
                          {el.area_m2 != null ? `${el.area_m2.toFixed(2)} m²` : "—"}
                          {el.confidence != null && (
                            <span className="ml-1 text-emerald-400/70">
                              {(el.confidence * 100).toFixed(0)}%
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="text-slate-600 font-mono mt-0.5">
                        bbox: x={el.bbox_norm.x.toFixed(3)} y={el.bbox_norm.y.toFixed(3)} w={el.bbox_norm.w.toFixed(3)} h={el.bbox_norm.h.toFixed(3)}
                      </div>
                      {el.polygon_norm && el.polygon_norm.length > 0 && (
                        <div className="text-slate-600 font-mono mt-0.5">
                          polygon: {el.polygon_norm.length} pts
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Full JSON viewer */}
            <Section title={isFr ? "JSON complet (sans images)" : "Full JSON (no images)"}>
              <pre className="text-[10px] text-slate-500 font-mono bg-white/[0.02] rounded p-3 max-h-64 overflow-auto whitespace-pre-wrap break-all">
                {JSON.stringify(
                  (() => {
                    const stripped = { ...result } as Record<string, unknown>;
                    const b64Keys = ["overlay_b64", "plan_b64"];
                    for (const k of b64Keys) {
                      if (stripped[k]) {
                        stripped[k] = `[base64 ${(stripped[k] as string).length} chars]`;
                      }
                    }
                    return stripped;
                  })(),
                  null,
                  2
                )}
              </pre>
            </Section>

            {/* Copy JSON button */}
            <div className="flex gap-2 px-5 py-3 border-t border-white/5">
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-400 rounded-lg text-xs font-medium border border-white/10 transition-colors"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-green-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copied
                  ? (isFr ? "Copie !" : "Copied!")
                  : (isFr ? "Copier le JSON" : "Copy JSON")}
              </button>
              <span className="text-[10px] text-slate-600 self-center">
                {isFr ? "JSON sans images base64" : "JSON without base64 images"}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
