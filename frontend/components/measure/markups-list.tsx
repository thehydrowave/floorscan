"use client";

import { useState, useMemo } from "react";
import { Trash2, Download, ChevronUp, ChevronDown, Filter } from "lucide-react";
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
        arrow: "Flèche", line: "Ligne", callout: "Callout", cloud: "Nuage",
        rect_annot: "Rectangle", ellipse: "Ellipse", highlight: "Surligneur",
        pen: "Crayon", stamp: "Tampon", note: "Note", dimension: "Cotation",
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
      imageW, imageH, ppm, displayUnit]);

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
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
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

  if (rows.length === 0) return null;

  return (
    <div className="glass border border-white/10 rounded-xl overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <button onClick={() => setCollapsed(v => !v)} className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
          {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          Markups List ({rows.length})
        </button>
        <div className="flex items-center gap-1.5">
          {/* Filter dropdown */}
          <select value={filterKind} onChange={e => setFilterKind(e.target.value)}
            className="bg-transparent text-[10px] text-slate-400 border border-white/10 rounded px-1.5 py-0.5 outline-none">
            <option value="all" className="bg-slate-900">Tous</option>
            <option value="zone" className="bg-slate-900">Surfaces</option>
            <option value="linear" className="bg-slate-900">Linéaires</option>
            <option value="count" className="bg-slate-900">Comptages</option>
            <option value="angle" className="bg-slate-900">Angles</option>
            <option value="circle" className="bg-slate-900">Cercles</option>
            <option value="text" className="bg-slate-900">Textes</option>
            <option value="markup" className="bg-slate-900">Annotations</option>
          </select>
          <button onClick={exportUnifiedCSV} title="Exporter CSV unifié" className="text-slate-500 hover:text-white p-1">
            <Download className="w-3.5 h-3.5" />
          </button>
          <button onClick={exportUnifiedXLSX} title="Exporter XLSX unifié" className="text-slate-500 hover:text-emerald-400 p-1 text-[10px] font-bold">
            XLS
          </button>
        </div>
      </div>

      {/* Table */}
      {!collapsed && (
        <div className="max-h-48 overflow-y-auto">
          <table className="w-full text-[10px]">
            <thead className="bg-white/5 sticky top-0">
              <tr>
                <th className="px-2 py-1.5 text-left text-slate-500 font-medium cursor-pointer hover:text-white" onClick={() => toggleSort("kind")}>
                  Type <SortIcon k="kind" />
                </th>
                <th className="px-2 py-1.5 text-left text-slate-500 font-medium w-4">⬤</th>
                <th className="px-2 py-1.5 text-left text-slate-500 font-medium cursor-pointer hover:text-white" onClick={() => toggleSort("subject")}>
                  Sujet <SortIcon k="subject" />
                </th>
                <th className="px-2 py-1.5 text-left text-slate-500 font-medium cursor-pointer hover:text-white" onClick={() => toggleSort("label")}>
                  Label <SortIcon k="label" />
                </th>
                <th className="px-2 py-1.5 text-right text-slate-500 font-medium cursor-pointer hover:text-white" onClick={() => toggleSort("area")}>
                  Surface <SortIcon k="area" />
                </th>
                <th className="px-2 py-1.5 text-right text-slate-500 font-medium cursor-pointer hover:text-white" onClick={() => toggleSort("length")}>
                  Longueur <SortIcon k="length" />
                </th>
                <th className="px-2 py-1.5 text-right text-slate-500 font-medium cursor-pointer hover:text-white" onClick={() => toggleSort("volume")}>
                  Volume <SortIcon k="volume" />
                </th>
                <th className="px-2 py-1.5 text-right text-slate-500 font-medium cursor-pointer hover:text-white" onClick={() => toggleSort("count")}>
                  Qté <SortIcon k="count" />
                </th>
                <th className="px-2 py-1.5 text-right text-slate-500 font-medium">∠</th>
                <th className="px-2 py-1.5 text-center text-slate-500 font-medium w-8">🗑</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.id}
                  className="border-t border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
                  onClick={() => onSelectItem?.(row.originalId)}
                >
                  <td className="px-2 py-1 text-slate-500 font-mono">{row.kind}</td>
                  <td className="px-2 py-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: row.color }} /></td>
                  <td className="px-2 py-1 text-slate-300 truncate max-w-28">{row.subject}</td>
                  <td className="px-2 py-1 text-slate-400 truncate max-w-32">{row.label}</td>
                  <td className="px-2 py-1 text-right text-slate-300 font-mono">{row.area != null ? fmtArea(Math.abs(row.area), displayUnit) : ""}</td>
                  <td className="px-2 py-1 text-right text-slate-300 font-mono">{row.length != null ? fmtLinear(row.length, displayUnit) : ""}</td>
                  <td className="px-2 py-1 text-right text-blue-400 font-mono">{row.volume != null ? fmtVolume(row.volume, displayUnit) : ""}</td>
                  <td className="px-2 py-1 text-right text-slate-300 font-mono">{row.count ?? ""}</td>
                  <td className="px-2 py-1 text-right text-amber-400 font-mono">{row.angle != null ? `${row.angle.toFixed(1)}°` : ""}</td>
                  <td className="px-2 py-1 text-center">
                    <button onClick={e => { e.stopPropagation(); onDeleteItem?.(row.originalId, row.kind); }}
                      className="text-slate-600 hover:text-red-400 transition-colors">
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
