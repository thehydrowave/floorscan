"use client";

import { useState, useMemo } from "react";
import { Trash2, Download, ChevronUp, ChevronDown, Filter } from "lucide-react";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import {
  MeasureZone, SurfaceType, LinearMeasure, LinearCategory, CountGroup, CountPoint,
  AngleMeasurement, angleDeg, CircleMeasure, circleMetrics,
  TextAnnotation, MarkupAnnotation, STAMP_LABELS,
  DisplayUnit, fmtLinear, fmtArea, fmtVolume,
  polygonAreaPx, polygonPerimeterM, linearLengthM, slopeCorrectedArea, zoneVolumeM3,
  MeasureLayer,
} from "@/lib/measure-types";
import * as XLSX from "xlsx";

// ── Unified markup row (flattened from all measurement types) ────────────────

interface MarkupRow {
  id: string;
  kind: "zone" | "linear" | "count" | "angle" | "circle" | "text" | "markup";
  subject: string;    // e.g. "Carrelage", "Plinthe", "Flèche"
  label: string;      // e.g. zone name, markup text
  color: string;
  layer: string;
  // Measurements
  area?: number;      // m²
  length?: number;    // m
  volume?: number;    // m³
  count?: number;
  angle?: number;     // degrees
  depth?: number;     // m
  slope?: number;     // degrees
  // Reference to original
  originalId: string;
}

interface MarkupsListProps {
  zones: MeasureZone[];
  surfaceTypes: SurfaceType[];
  linearMeasures: LinearMeasure[];
  linearCategories: LinearCategory[];
  countPoints: CountPoint[];
  countGroups: CountGroup[];
  angleMeasurements: AngleMeasurement[];
  circleMeasures: CircleMeasure[];
  textAnnotations: TextAnnotation[];
  markupAnnotations: MarkupAnnotation[];
  imageW: number;
  imageH: number;
  ppm: number | null;
  displayUnit: DisplayUnit;
  layers: MeasureLayer[];
  onSelectItem?: (id: string) => void;
  onDeleteItem?: (id: string, kind: string) => void;
}

export default function MarkupsList({
  zones, surfaceTypes, linearMeasures, linearCategories, countPoints, countGroups,
  angleMeasurements, circleMeasures, textAnnotations, markupAnnotations,
  imageW, imageH, ppm, displayUnit, layers,
  onSelectItem, onDeleteItem,
}: MarkupsListProps) {
  const { lang } = useLang();
  const d = (k: DTKey) => dt(k, lang);

  const [sortKey, setSortKey] = useState<keyof MarkupRow>("kind");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterKind, setFilterKind] = useState<string>("all");
  const [collapsed, setCollapsed] = useState(false);

  // Build unified rows
  const rows = useMemo<MarkupRow[]>(() => {
    const result: MarkupRow[] = [];

    // Zones
    for (const z of zones) {
      const type = surfaceTypes.find(t => t.id === z.typeId);
      const areaPx = polygonAreaPx(z.points, imageW, imageH);
      const areaM2 = ppm ? areaPx / ppm ** 2 : 0;
      const perimM = ppm ? polygonPerimeterM(z.points, imageW, imageH, ppm) : 0;
      const corrArea = slopeCorrectedArea(areaM2, z.slopeDeg);
      const vol = zoneVolumeM3(corrArea, z.depthM ?? type?.defaultDepthM);
      result.push({
        id: z.id, kind: "zone", originalId: z.id,
        subject: type?.name ?? z.typeId,
        label: z.name ?? "",
        color: type?.color ?? "#6B7280",
        layer: z.layer ?? "lyr_general",
        area: areaM2 > 0 ? (z.isDeduction ? -areaM2 : areaM2) : undefined,
        length: perimM > 0 ? perimM : undefined,
        volume: vol ?? undefined,
        depth: z.depthM,
        slope: z.slopeDeg,
      });
    }

    // Linear measures
    for (const lm of linearMeasures) {
      const cat = linearCategories.find(c => c.id === lm.categoryId);
      const lenM = ppm ? linearLengthM(lm.points, imageW, imageH, ppm) : 0;
      result.push({
        id: lm.id, kind: "linear", originalId: lm.id,
        subject: cat?.name ?? "Linéaire",
        label: `${lm.points.length} pts`,
        color: cat?.color ?? "#10B981",
        layer: "lyr_general",
        length: lenM > 0 ? lenM : undefined,
      });
    }

    // Count points (grouped by group)
    const groupedCounts: Record<string, CountPoint[]> = {};
    for (const cp of countPoints) {
      (groupedCounts[cp.groupId] ??= []).push(cp);
    }
    for (const [gid, pts] of Object.entries(groupedCounts)) {
      const grp = countGroups.find(g => g.id === gid);
      result.push({
        id: gid, kind: "count", originalId: gid,
        subject: grp?.name ?? "Comptage",
        label: `${pts.length} pts`,
        color: grp?.color ?? "#F59E0B",
        layer: "lyr_general",
        count: pts.length,
      });
    }

    // Angles
    for (const am of angleMeasurements) {
      result.push({
        id: am.id, kind: "angle", originalId: am.id,
        subject: "Angle",
        label: am.label ?? `${angleDeg(am).toFixed(1)}°`,
        color: "#FBBF24",
        layer: "lyr_general",
        angle: angleDeg(am),
      });
    }

    // Circles
    for (const cm of circleMeasures) {
      const m = circleMetrics(cm, imageW, imageH, ppm);
      const cat = linearCategories.find(c => c.id === cm.categoryId);
      result.push({
        id: cm.id, kind: "circle", originalId: cm.id,
        subject: "Cercle",
        label: m ? `r=${fmtLinear(m.radiusM, displayUnit)}` : "",
        color: cat?.color ?? "#14B8A6",
        layer: "lyr_general",
        area: m?.areaM2,
        length: m?.circumferenceM,
      });
    }

    // Text annotations
    for (const ta of textAnnotations) {
      result.push({
        id: ta.id, kind: "text", originalId: ta.id,
        subject: "Texte",
        label: ta.text,
        color: ta.color,
        layer: "lyr_general",
      });
    }

    // Markup annotations
    for (const mk of markupAnnotations) {
      const typeLabels: Record<string, string> = {
        arrow: d("mc_mk_arrow"), line: d("mc_mk_line"), callout: d("mc_mk_callout"), cloud: d("mc_mk_cloud"),
        rect_annot: d("mc_mk_rect"), ellipse: d("mc_mk_ellipse"), highlight: d("mc_mk_highlight"),
        pen: d("mc_mk_pen"), stamp: d("mc_mk_stamp"), note: d("mc_mk_note"), dimension: d("mc_mk_dimension"),
        polyline_annot: "Polyligne", image: "Image",
      };
      result.push({
        id: mk.id, kind: "markup", originalId: mk.id,
        subject: typeLabels[mk.type] ?? mk.type,
        label: mk.text ?? mk.label ?? (mk.stampKind ? STAMP_LABELS[mk.stampKind]?.fr : "") ?? "",
        color: mk.color,
        layer: mk.layer ?? "lyr_general",
      });
    }

    return result;
  }, [zones, surfaceTypes, linearMeasures, linearCategories, countPoints, countGroups,
      angleMeasurements, circleMeasures, textAnnotations, markupAnnotations,
      imageW, imageH, ppm, displayUnit, lang]);

  // Filter & sort
  const filtered = useMemo(() => {
    let r = filterKind === "all" ? rows : rows.filter(row => row.kind === filterKind);
    r.sort((a, b) => {
      const av = a[sortKey] ?? "", bv = b[sortKey] ?? "";
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return r;
  }, [rows, filterKind, sortKey, sortDir]);

  const toggleSort = (key: keyof MarkupRow) => {
    if (sortKey === key) setSortDir(prev => prev === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortIcon = ({ k }: { k: keyof MarkupRow }) =>
    sortKey === k ? (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : null;

  // Export CSV unifié
  const exportUnifiedCSV = () => {
    const sep = ";";
    const headers = ["Type", "Sujet", "Label", "Couleur", "Calque", "Surface", "Longueur", "Volume", "Comptage", "Angle", "Profondeur", "Pente"];
    const csvRows = filtered.map(r => [
      r.kind, r.subject, r.label, r.color,
      layers.find(l => l.id === r.layer)?.name ?? r.layer,
      r.area != null ? r.area.toFixed(2) : "",
      r.length != null ? r.length.toFixed(2) : "",
      r.volume != null ? r.volume.toFixed(3) : "",
      r.count != null ? String(r.count) : "",
      r.angle != null ? r.angle.toFixed(1) : "",
      r.depth != null ? String(r.depth) : "",
      r.slope != null ? String(r.slope) : "",
    ]);
    const lines = [headers.join(sep), ...csvRows.map(r => r.join(sep))];
    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `floorscan_markups_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  // Export XLSX unifié (1 ligne par markup)
  const exportUnifiedXLSX = () => {
    const wb = XLSX.utils.book_new();
    const data: (string | number)[][] = [
      ["FloorScan — Markups List", "", "", "", "", "", "", "", "", "", "", ""],
      [`Date: ${new Date().toLocaleDateString("fr-FR")}`, "", "", "", "", "", "", "", "", "", "", ""],
      [],
      ["Type", "Sujet", "Label", "Couleur", "Calque", "Surface (m²)", "Longueur (m)", "Volume (m³)", "Comptage", "Angle (°)", "Profondeur (m)", "Pente (°)"],
    ];
    for (const r of filtered) {
      data.push([
        r.kind, r.subject, r.label, r.color,
        layers.find(l => l.id === r.layer)?.name ?? r.layer,
        r.area != null ? +r.area.toFixed(2) : "",
        r.length != null ? +r.length.toFixed(2) : "",
        r.volume != null ? +r.volume.toFixed(3) : "",
        r.count ?? "",
        r.angle != null ? +r.angle.toFixed(1) : "",
        r.depth ?? "",
        r.slope ?? "",
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 10 }, { wch: 20 }, { wch: 25 }, { wch: 10 }, { wch: 15 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, "Markups List");
    XLSX.writeFile(wb, `floorscan_markups_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Kind labels for display
  const kindLabels = useMemo<Record<string, string>>(() => ({
    zone: d("ml_kind_zone"), linear: d("ml_kind_linear"), count: d("ml_kind_count"),
    angle: d("ml_kind_angle"), circle: d("ml_kind_circle"), text: d("ml_kind_text"), markup: d("ml_kind_markup"),
  }), [lang]);

  if (rows.length === 0) return null;

  // Summary stats
  const totalArea = rows.filter(r => r.area && r.area > 0).reduce((s, r) => s + (r.area ?? 0), 0);
  const totalLength = rows.filter(r => r.length).reduce((s, r) => s + (r.length ?? 0), 0);
  const totalCount = rows.filter(r => r.count).reduce((s, r) => s + (r.count ?? 0), 0);

  return (
    <div className="glass border border-white/10 rounded-xl overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-white/[0.02]">
        <button onClick={() => setCollapsed(v => !v)} className="flex items-center gap-2 text-xs font-semibold text-slate-200 hover:text-white transition-colors">
          {collapsed ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
          <span className="uppercase tracking-wide text-[10px]">{d("ml_summary")}</span>
          <span className="text-[10px] font-mono text-slate-500 bg-white/5 px-1.5 py-0.5 rounded">{rows.length}</span>
        </button>
        <div className="flex items-center gap-2">
          {/* Quick stats */}
          {!collapsed && totalArea > 0 && <span className="text-[10px] font-mono text-accent">{totalArea.toFixed(1)} m²</span>}
          {!collapsed && totalLength > 0 && <span className="text-[10px] font-mono text-emerald-400">{totalLength.toFixed(1)} ml</span>}
          {!collapsed && totalCount > 0 && <span className="text-[10px] font-mono text-pink-400">{totalCount}×</span>}

          <div className="w-px h-4 bg-white/10" />

          {/* Filter */}
          <div className="flex items-center gap-1">
            <Filter className="w-3 h-3 text-slate-600" />
            <select value={filterKind} onChange={e => setFilterKind(e.target.value)}
              className="bg-transparent text-[10px] text-slate-400 border border-white/10 rounded-md px-1.5 py-0.5 outline-none hover:border-white/20 transition-colors cursor-pointer">
              <option value="all" className="bg-slate-900">{d("ml_all")}</option>
              <option value="zone" className="bg-slate-900">{d("ml_surfaces")}</option>
              <option value="linear" className="bg-slate-900">{d("ml_linear")}</option>
              <option value="count" className="bg-slate-900">{d("ml_counts")}</option>
              <option value="angle" className="bg-slate-900">{d("ml_angles")}</option>
              <option value="circle" className="bg-slate-900">{d("ml_circles")}</option>
              <option value="text" className="bg-slate-900">{d("ml_texts")}</option>
              <option value="markup" className="bg-slate-900">{d("ml_annotations")}</option>
            </select>
          </div>

          <div className="w-px h-4 bg-white/10" />

          {/* Export */}
          <button onClick={exportUnifiedCSV} title={d("ml_export_csv")} className="text-slate-500 hover:text-white p-1 rounded hover:bg-white/5 transition-colors">
            <Download className="w-3.5 h-3.5" />
          </button>
          <button onClick={exportUnifiedXLSX} title={d("ml_export_xlsx")} className="text-slate-500 hover:text-emerald-400 p-1 rounded hover:bg-white/5 transition-colors text-[10px] font-bold font-mono">
            XLSX
          </button>
        </div>
      </div>

      {/* Table */}
      {!collapsed && (
        <div className="max-h-52 overflow-y-auto">
          <table className="w-full text-[10px]">
            <thead className="bg-white/[0.03] sticky top-0 z-10">
              <tr className="border-b border-white/10">
                <th className="px-3 py-2 text-left text-[9px] text-slate-500 font-semibold uppercase tracking-wider cursor-pointer hover:text-slate-300 transition-colors" onClick={() => toggleSort("kind")}>
                  <span className="flex items-center gap-0.5">{d("ml_col_type")} <SortIcon k="kind" /></span>
                </th>
                <th className="px-2 py-2 text-left text-[9px] text-slate-500 font-semibold uppercase tracking-wider cursor-pointer hover:text-slate-300 transition-colors" onClick={() => toggleSort("subject")}>
                  <span className="flex items-center gap-0.5">{d("ml_col_element")} <SortIcon k="subject" /></span>
                </th>
                <th className="px-2 py-2 text-left text-[9px] text-slate-500 font-semibold uppercase tracking-wider cursor-pointer hover:text-slate-300 transition-colors" onClick={() => toggleSort("label")}>
                  <span className="flex items-center gap-0.5">{d("ml_col_detail")} <SortIcon k="label" /></span>
                </th>
                <th className="px-2 py-2 text-right text-[9px] text-slate-500 font-semibold uppercase tracking-wider cursor-pointer hover:text-slate-300 transition-colors" onClick={() => toggleSort("area")}>
                  <span className="flex items-center justify-end gap-0.5">{d("ml_col_area")} <SortIcon k="area" /></span>
                </th>
                <th className="px-2 py-2 text-right text-[9px] text-slate-500 font-semibold uppercase tracking-wider cursor-pointer hover:text-slate-300 transition-colors" onClick={() => toggleSort("length")}>
                  <span className="flex items-center justify-end gap-0.5">{d("ml_col_length")} <SortIcon k="length" /></span>
                </th>
                <th className="px-2 py-2 text-right text-[9px] text-slate-500 font-semibold uppercase tracking-wider cursor-pointer hover:text-slate-300 transition-colors" onClick={() => toggleSort("count")}>
                  <span className="flex items-center justify-end gap-0.5">{d("ml_col_qty")} <SortIcon k="count" /></span>
                </th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {filtered.map(row => (
                <tr key={row.id}
                  className="hover:bg-white/[0.03] cursor-pointer transition-colors group"
                  onClick={() => onSelectItem?.(row.originalId)}
                >
                  <td className="px-3 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: row.color }} />
                      <span className="text-slate-500 font-medium">{kindLabels[row.kind] ?? row.kind}</span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-slate-200 font-medium truncate max-w-32">{row.subject}</td>
                  <td className="px-2 py-1.5 text-slate-500 truncate max-w-28">{row.label}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-slate-300">{row.area != null ? fmtArea(Math.abs(row.area), displayUnit) : <span className="text-slate-700">—</span>}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-slate-300">{row.length != null ? fmtLinear(row.length, displayUnit) : <span className="text-slate-700">—</span>}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-slate-300">{row.count ?? (row.angle != null ? <span className="text-amber-400">{row.angle.toFixed(1)}°</span> : <span className="text-slate-700">—</span>)}</td>
                  <td className="px-3 py-1.5 text-center">
                    <button onClick={e => { e.stopPropagation(); onDeleteItem?.(row.originalId, row.kind); }}
                      className="text-slate-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
