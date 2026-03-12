"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Download,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  AlertCircle,
  MinusCircle,
} from "lucide-react";
import type { AnalysisResult } from "@/lib/types";
import {
  runComplianceChecks,
  ComplianceResult,
  ComplianceCheck,
  ComplianceCategory,
  CheckStatus,
} from "@/lib/compliance-checker";
import { downloadCompliancePdf } from "@/lib/compliance-pdf";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

// ── Props ───────────────────────────────────────────────────────────────────────

interface CompliancePanelProps {
  result: AnalysisResult;
}

// ── Category config ─────────────────────────────────────────────────────────────

const CATEGORIES: {
  key: ComplianceCategory;
  title_key: string;
  color: string;
}[] = [
  { key: "pmr", title_key: "compliance_cat_pmr", color: "#3b82f6" },
  { key: "carrez", title_key: "compliance_cat_carrez", color: "#8b5cf6" },
  { key: "rt2012", title_key: "compliance_cat_rt2012", color: "#f59e0b" },
  {
    key: "ventilation",
    title_key: "compliance_cat_ventilation",
    color: "#06b6d4",
  },
  { key: "nfc15100", title_key: "compliance_cat_nfc15100", color: "#facc15" },
];

// ── Status icon + color ─────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: CheckStatus }) {
  switch (status) {
    case "pass":
      return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
    case "fail":
      return <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
    case "warning":
      return <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />;
    case "na":
      return <MinusCircle className="w-4 h-4 text-slate-600 shrink-0" />;
  }
}

function statusColor(status: CheckStatus): string {
  switch (status) {
    case "pass":
      return "text-emerald-400";
    case "fail":
      return "text-red-400";
    case "warning":
      return "text-amber-400";
    case "na":
      return "text-slate-600";
  }
}

function scoreColor(pct: number): string {
  if (pct >= 80) return "text-emerald-400 bg-emerald-500/20 border-emerald-500/30";
  if (pct >= 50) return "text-amber-400 bg-amber-500/20 border-amber-500/30";
  return "text-red-400 bg-red-500/20 border-red-500/30";
}

// ── Component ───────────────────────────────────────────────────────────────────

export default function CompliancePanel({ result }: CompliancePanelProps) {
  const { lang } = useLang();
  const d = (key: DTKey) => dt(key, lang);

  // ── State ─────────────────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [ceilingHeight, setCeilingHeight] = useState(2.5);

  // ── Run compliance checks ─────────────────────────────────────────────────────
  const compliance = useMemo<ComplianceResult>(
    () => runComplianceChecks(result, { ceilingHeight }),
    [result, ceilingHeight]
  );

  // ── Group checks by category ──────────────────────────────────────────────────
  const checksByCategory = useMemo(() => {
    const map: Record<string, ComplianceCheck[]> = {};
    for (const cat of CATEGORIES) {
      map[cat.key] = compliance.checks.filter((c) => c.category === cat.key);
    }
    return map;
  }, [compliance]);

  // ── Category toggle ───────────────────────────────────────────────────────────
  function toggleCat(key: string) {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ── Category summary ──────────────────────────────────────────────────────────
  function catSummary(checks: ComplianceCheck[]): { worst: CheckStatus } {
    let worst: CheckStatus = "na" as CheckStatus;
    for (const c of checks) {
      if (c.status === "fail") return { worst: "fail" };
      if (c.status === "warning") worst = "warning";
      if (c.status === "pass" && worst === ("na" as CheckStatus)) worst = "pass";
    }
    return { worst };
  }

  // ── PDF export ────────────────────────────────────────────────────────────────
  function exportPdf() {
    downloadCompliancePdf(compliance, lang);
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="glass rounded-2xl border border-white/10 overflow-hidden mt-4">
      {/* ── Header toggle ──────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-amber-400" />
          <span className="font-display font-semibold text-white text-sm">
            {d("compliance_title" as DTKey)}
          </span>
          <span className="text-[10px] bg-amber-500/20 border border-amber-500/30 rounded px-1.5 py-0.5 font-semibold text-amber-400 uppercase tracking-wider">
            {d("compliance_wip" as DTKey)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!expanded && (
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded border ${scoreColor(
                compliance.score_pct
              )}`}
            >
              {(d("compliance_score" as DTKey) as string).replace(
                "{n}",
                String(compliance.score_pct)
              )}
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-400" />
          )}
        </div>
      </button>

      {/* ── Expandable content ──────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="compliance-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {/* No scale warning */}
            {!result.pixels_per_meter && (
              <div className="mx-5 mb-4 flex items-center gap-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {d("compliance_no_scale" as DTKey)}
              </div>
            )}

            {/* Score + params row */}
            <div className="flex items-center gap-4 px-5 mb-4 flex-wrap">
              {/* Score badge */}
              <div
                className={`text-lg font-bold px-3 py-1 rounded-lg border ${scoreColor(
                  compliance.score_pct
                )}`}
              >
                {(d("compliance_score" as DTKey) as string).replace(
                  "{n}",
                  String(compliance.score_pct)
                )}
              </div>

              {/* Summary counts */}
              <div className="flex items-center gap-3 text-xs">
                <span className="text-emerald-400">
                  ✓ {compliance.pass_count}
                </span>
                <span className="text-red-400">
                  ✗ {compliance.fail_count}
                </span>
                <span className="text-amber-400">
                  ⚠ {compliance.warn_count}
                </span>
                <span className="text-slate-600">
                  — {compliance.na_count}
                </span>
              </div>

              {/* Ceiling height input */}
              <label className="text-xs text-slate-500 flex items-center gap-2 ml-auto">
                {d("compliance_ceiling_h" as DTKey)}
                <input
                  type="number"
                  value={ceilingHeight}
                  step={0.05}
                  min={1.8}
                  max={4}
                  onChange={(e) =>
                    setCeilingHeight(parseFloat(e.target.value) || 2.5)
                  }
                  className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-sm text-right focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                <span className="text-slate-600">m</span>
              </label>
            </div>

            {/* ── Category sections ──────────────────────────────────────────── */}
            {CATEGORIES.map((cat) => {
              const checks = checksByCategory[cat.key] ?? [];
              if (checks.length === 0) return null;
              const isOpen = expandedCats.has(cat.key);
              const summary = catSummary(checks);

              return (
                <div key={cat.key} className="border-t border-white/5">
                  {/* Category header */}
                  <button
                    type="button"
                    onClick={() => toggleCat(cat.key)}
                    className="w-full px-5 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition-colors cursor-pointer"
                  >
                    <StatusIcon status={summary.worst} />
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span className="text-sm text-white font-medium flex-1 text-left">
                      {d(cat.title_key as DTKey)}
                    </span>
                    <span className="text-xs text-slate-500">
                      {checks.length} {checks.length > 1 ? "règles" : "règle"}
                    </span>
                    {isOpen ? (
                      <ChevronUp className="w-4 h-4 text-slate-500" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    )}
                  </button>

                  {/* Category checks */}
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        key={`cat-${cat.key}`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-4 space-y-2">
                          {checks.map((check) => (
                            <div
                              key={check.id}
                              className="bg-white/[0.02] rounded-lg px-4 py-3"
                            >
                              {/* Rule line */}
                              <div className="flex items-center gap-3">
                                <StatusIcon status={check.status} />
                                <span className="text-sm text-white flex-1">
                                  {d(check.rule_key as DTKey)}
                                </span>
                                <span className="font-mono text-xs text-slate-500">
                                  {d("compliance_target" as DTKey)}:{" "}
                                  <span className="text-slate-400">
                                    {check.target}
                                  </span>
                                </span>
                                <span className="font-mono text-xs text-slate-500">
                                  {d("compliance_actual" as DTKey)}:{" "}
                                  <span className={statusColor(check.status)}>
                                    {check.actual}
                                  </span>
                                </span>
                              </div>

                              {/* Affected elements */}
                              {check.affected && check.affected.length > 0 && (
                                <div className="mt-2 pl-7 flex flex-wrap gap-1.5">
                                  {check.affected.map((item, idx) => (
                                    <span
                                      key={idx}
                                      className="text-[10px] bg-red-500/10 border border-red-500/20 text-red-400 rounded px-1.5 py-0.5"
                                    >
                                      {item}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            {/* ── Export buttons ──────────────────────────────────────────────── */}
            <div className="flex gap-2 px-5 py-4 border-t border-white/5">
              <button
                type="button"
                onClick={exportPdf}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                {d("compliance_export_pdf" as DTKey)}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
