"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Copy,
  Download,
  FileText,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import type { CartoucheResult, CartoucheField } from "@/lib/types";

/* ── Props ──────────────────────────────────────────────────────────────────── */

interface CartoucheResultStepProps {
  result: CartoucheResult;
  onRestart: () => void;
}

/* ── Field key to i18n mapping ──────────────────────────────────────────────── */

const FIELD_I18N: Record<string, DTKey> = {
  project_name: "ca_project",
  architect: "ca_architect",
  scale: "ca_scale_text",
  date: "ca_date",
  plan_number: "ca_plan_number",
  revision: "ca_revision",
};

/* ── Component ──────────────────────────────────────────────────────────────── */

export default function CartoucheResultStep({
  result,
  onRestart,
}: CartoucheResultStepProps) {
  const { lang } = useLang();
  const d = (k: DTKey) => dt(k, lang);

  /* state */
  const [editedFields, setEditedFields] = useState<CartoucheField[]>(
    result.fields,
  );
  const [showRawText, setShowRawText] = useState(false);
  const [copied, setCopied] = useState(false);

  /* image natural dimensions for SVG overlay */
  const [imgNatural, setImgNatural] = useState({ w: 1, h: 1 });

  /* ── Helpers ────────────────────────────────────────────────────────────── */

  function updateField(key: string, value: string) {
    setEditedFields((prev) =>
      prev.map((f) => (f.key === key ? { ...f, value } : f)),
    );
  }

  function copyAll() {
    const text = editedFields
      .map((f) => `${f.label_fr}: ${f.value}`)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: d("ca_copy"), variant: "default" });
  }

  function exportJson() {
    const data = Object.fromEntries(
      editedFields.map((f) => [f.key, f.value]),
    );
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cartouche.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ── Derived values ─────────────────────────────────────────────────────── */

  const bbox = result.cartouche_bbox_norm;
  const imgW = imgNatural.w;
  const imgH = imgNatural.h;

  /* ── Render ─────────────────────────────────────────────────────────────── */

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-6"
    >
      {/* ── Title ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/20 text-violet-400">
          <FileText className="h-5 w-5" />
        </div>
        <h2 className="text-xl font-semibold text-white">
          {d("ca_st_results")}
        </h2>
      </div>

      {/* ── Main 2-column layout ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── Left column: Plan preview ────────────────────────────────────── */}
        <div className="glass overflow-hidden rounded-2xl border border-white/10 p-4">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${result.plan_b64}`}
              alt="Plan"
              className="w-full rounded-lg"
              onLoad={(e) => {
                const el = e.currentTarget;
                setImgNatural({ w: el.naturalWidth, h: el.naturalHeight });
              }}
            />

            {/* SVG overlay: dashed purple rectangle around detected cartouche */}
            {bbox && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox={`0 0 ${imgW} ${imgH}`}
              >
                <rect
                  x={bbox.x * imgW}
                  y={bbox.y * imgH}
                  width={bbox.w * imgW}
                  height={bbox.h * imgH}
                  fill="none"
                  stroke="#8b5cf6"
                  strokeWidth={3}
                  strokeDasharray="8 4"
                  rx={4}
                />
              </svg>
            )}
          </div>

          {/* Zoomed cartouche crop */}
          {result.cartouche_b64 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`data:image/png;base64,${result.cartouche_b64}`}
              alt="Cartouche crop"
              className="mt-3 w-full rounded-lg border border-violet-500/30"
            />
          )}
        </div>

        {/* ── Right column: Extracted fields ───────────────────────────────── */}
        <div className="glass space-y-4 rounded-2xl border border-white/10 p-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              {d("ca_fields")}
            </h3>
            <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-xs text-violet-400">
              {editedFields.length}
            </span>
          </div>

          {/* Field list */}
          {editedFields.map((field) => {
            const i18nKey = FIELD_I18N[field.key];
            const fieldLabel = i18nKey ? d(i18nKey) : field.label_fr;

            return (
              <div key={field.key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs uppercase tracking-wider text-slate-500">
                    {fieldLabel}
                  </label>
                  {field.confidence > 0 && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px]",
                        field.confidence >= 0.7
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-amber-500/20 text-amber-400",
                      )}
                    >
                      {field.confidence >= 0.7 ? (
                        <CheckCircle2 className="mr-0.5 inline h-3 w-3" />
                      ) : (
                        <AlertTriangle className="mr-0.5 inline h-3 w-3" />
                      )}
                      {Math.round(field.confidence * 100)}%
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={field.value}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  placeholder="\u2014"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Raw OCR text (collapsible) ─────────────────────────────────────── */}
      <div className="glass rounded-2xl border border-white/10 p-4">
        <button
          type="button"
          onClick={() => setShowRawText((v) => !v)}
          className="flex w-full items-center justify-between text-sm font-medium text-slate-400 transition-colors hover:text-white"
        >
          <span>{d("ca_raw_text")}</span>
          {showRawText ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {showRawText && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={{ duration: 0.25 }}
          >
            <pre className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/30 p-4 text-xs text-slate-400">
              {result.raw_text}
            </pre>
          </motion.div>
        )}
      </div>

      {/* ── Action buttons ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="glass"
          size="sm"
          onClick={copyAll}
          className={cn(
            "gap-1.5",
            copied && "border-emerald-500/40 text-emerald-400",
          )}
        >
          {copied ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          {d("ca_copy")}
        </Button>

        <Button variant="glass" size="sm" onClick={exportJson} className="gap-1.5">
          <Download className="h-4 w-4" />
          {d("ca_export_json")}
        </Button>

        <Button variant="ghost" size="sm" onClick={onRestart} className="gap-1.5">
          <RotateCcw className="h-4 w-4" />
          {d("ca_st_upload")}
        </Button>
      </div>
    </motion.div>
  );
}
