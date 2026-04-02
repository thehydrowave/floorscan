"use client";

import { useState, useMemo, useRef } from "react";
import { Plus, Trash2, Check, Package, Download, Search, Home, Ruler, Hash, FileText, Table2, Upload } from "lucide-react";
import {
  SurfaceType, MeasureZone,
  aggregateByType, aggregatePerimeterByType,
  isRoomTypeId, isEmpriseTypeId, EMPRISE_TYPE,
  polygonAreaPx, polygonPerimeterM,
  LinearCategory, LinearMeasure, aggregateLinearByCategory,
  CountGroup, CountPoint,
  AngleMeasurement, angleDeg,
  CircleMeasure, circleMetrics,
  DisplayUnit, UNIT_LABELS_AREA, UNIT_LABELS_VOLUME,
  slopeCorrectedArea, zoneVolumeM3,
} from "@/lib/measure-types";
import { useLang } from "@/lib/lang-context";
import { dt } from "@/lib/i18n";
import type { CustomDetection } from "@/lib/types";
import { PdfBuilder, safeTxt, fmtQty, C, TABLE, TYPO, PAGE } from "@/lib/pdf-theme";
import * as XLSX from "xlsx";

const PRESET_COLORS = [
  "#3B82F6", "#F97316", "#8B5CF6", "#6B7280", "#EC4899",
  "#10B981", "#F59E0B", "#EF4444", "#06B6D4", "#84CC16",
];

const DEFAULT_IDS = ["carrelage", "parquet", "peinture", "beton", "moquette"];

interface SurfacePanelProps {
  types: SurfaceType[];
  zones: MeasureZone[];
  activeTypeId: string;
  imageW: number;
  imageH: number;
  ppm: number | null;
  onTypesChange: (types: SurfaceType[]) => void;
  onActiveTypeChange: (id: string) => void;
  customDetections?: CustomDetection[];
  onDeleteDetection?: (id: string) => void;
  // Room mode
  panelMode?: "metre" | "rooms" | "linear" | "count";
  onPanelModeChange?: (mode: "metre" | "rooms" | "linear" | "count") => void;
  roomTypes?: SurfaceType[];
  // Linear tool
  linearCategories?: LinearCategory[];
  linearMeasures?: LinearMeasure[];
  onLinearCategoriesChange?: (cats: LinearCategory[]) => void;
  onLinearMeasuresChange?: (measures: LinearMeasure[]) => void;
  activeLinearCategoryId?: string;
  onActiveLinearCategoryChange?: (id: string) => void;
  // Count tool
  countGroups?: CountGroup[];
  countPoints?: CountPoint[];
  onCountGroupsChange?: (groups: CountGroup[]) => void;
  onCountPointsChange?: (pts: CountPoint[]) => void;
  activeCountGroupId?: string;
  onActiveCountGroupChange?: (id: string) => void;
  // Wave 2 additions
  angleMeasurements?: AngleMeasurement[];
  circleMeasures?: CircleMeasure[];
  displayUnit?: DisplayUnit;
}

export default function SurfacePanel({
  types, zones, activeTypeId, imageW, imageH, ppm,
  onTypesChange, onActiveTypeChange,
  customDetections = [], onDeleteDetection,
  panelMode = "metre", onPanelModeChange, roomTypes = [],
  linearCategories = [], linearMeasures = [],
  onLinearCategoriesChange, onLinearMeasuresChange,
  activeLinearCategoryId = "", onActiveLinearCategoryChange,
  countGroups = [], countPoints = [],
  onCountGroupsChange, onCountPointsChange,
  activeCountGroupId = "", onActiveCountGroupChange,
  angleMeasurements = [], circleMeasures = [], displayUnit = "m" as DisplayUnit,
}: SurfacePanelProps) {
  const { lang } = useLang();
  const d = (k: string) => dt(k as any, lang);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[5]);

  // Linear category adding
  const [addingLinear, setAddingLinear] = useState(false);
  const [newLinearName, setNewLinearName] = useState("");
  const [newLinearColor, setNewLinearColor] = useState(PRESET_COLORS[2]);

  // Count group adding
  const [addingCount, setAddingCount] = useState(false);
  const [newCountName, setNewCountName] = useState("");
  const [newCountColor, setNewCountColor] = useState(PRESET_COLORS[4]);

  // Volume (rooms mode)
  const [ceilingHeightM, setCeilingHeightM] = useState(2.5);

  // Export state
  const [exporting, setExporting] = useState(false);

  const totals    = aggregateByType(zones, imageW, imageH, ppm);
  const perims    = ppm ? aggregatePerimeterByType(zones, imageW, imageH, ppm) : {};
  const totalAll  = Object.values(totals).reduce((a, b) => a + b, 0);
  const totalHT   = ppm
    ? types.reduce((sum, t) => sum + (totals[t.id] ?? 0) * (t.pricePerM2 ?? 0), 0)
    : 0;
  const hasPrices = types.some(t => (t.pricePerM2 ?? 0) > 0);

  // Linear aggregates
  const linearTotals = ppm ? aggregateLinearByCategory(linearMeasures, imageW, imageH, ppm) : {};

  const addType = () => {
    if (!newName.trim()) return;
    const id = newName.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
    onTypesChange([...types, { id, name: newName.trim(), color: newColor, wastePercent: 10 }]);
    onActiveTypeChange(id);
    setNewName("");
    setAdding(false);
  };

  const removeType = (id: string) => {
    onTypesChange(types.filter(t => t.id !== id));
    if (activeTypeId === id && types.length > 1) {
      onActiveTypeChange(types.find(t => t.id !== id)!.id);
    }
  };

  const updatePrice    = (id: string, val: string) => {
    const v = parseFloat(val);
    onTypesChange(types.map(t =>
      t.id === id ? { ...t, pricePerM2: val === "" || isNaN(v) ? undefined : v } : t
    ));
  };
  const updateWaste    = (id: string, val: string) => {
    const v = parseFloat(val);
    onTypesChange(types.map(t =>
      t.id === id ? { ...t, wastePercent: val === "" || isNaN(v) ? undefined : Math.max(0, v) } : t
    ));
  };
  const updateBoxSize  = (id: string, val: string) => {
    const v = parseFloat(val);
    onTypesChange(types.map(t =>
      t.id === id ? { ...t, boxSizeM2: val === "" || isNaN(v) ? undefined : Math.max(0, v) } : t
    ));
  };
  const updateColor    = (id: string, color: string) => {
    onTypesChange(types.map(t => t.id === id ? { ...t, color } : t));
  };

  // ── Import CSV de prix ────────────────────────────────────────────────────
  const csvInputRef = useRef<HTMLInputElement>(null);
  const importPriceCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) return;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      let updated = [...types];
      let matched = 0;
      for (const line of lines) {
        // Support ; or , as separator
        const sep = line.includes(";") ? ";" : ",";
        const cols = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ""));
        if (cols.length < 2) continue;
        const name = cols[0].toLowerCase();
        const price = parseFloat(cols[1]);
        if (isNaN(price) || price <= 0) continue;
        // Match by name (case insensitive)
        const idx = updated.findIndex(t => t.name.toLowerCase() === name);
        if (idx >= 0) {
          updated[idx] = { ...updated[idx], pricePerM2: price };
          matched++;
        } else {
          // Optional: also accept ID match
          const idIdx = updated.findIndex(t => t.id.toLowerCase() === name);
          if (idIdx >= 0) {
            updated[idIdx] = { ...updated[idIdx], pricePerM2: price };
            matched++;
          }
        }
      }
      if (matched > 0) onTypesChange(updated);
      // Reset file input
      if (csvInputRef.current) csvInputRef.current.value = "";
    };
    reader.readAsText(file, "utf-8");
  };

  /** Export CSV du métré */
  const exportCSV = () => {
    const sep = ";";
    const headers = [
      "Type", "Surface nette (m²)", "Périmètre (ml)", "Chute (%)",
      "Qté à commander (m²)", "m²/boîte", "Boîtes", "Prix/m²", "Montant HT (€)",
    ];
    const rows: (string | number)[][] = types
      .filter(t => (totals[t.id] ?? 0) > 0 || zones.some(z => z.typeId === t.id))
      .map(type => {
        const area  = totals[type.id] ?? 0;
        const perim = perims[type.id] ?? 0;
        const waste = type.wastePercent ?? 10;
        const cmd   = area > 0 ? area * (1 + waste / 100) : 0;
        const boxes = type.boxSizeM2 && type.boxSizeM2 > 0 && cmd > 0
          ? Math.ceil(cmd / type.boxSizeM2) : "";
        const ht = ppm && area > 0 && (type.pricePerM2 ?? 0) > 0
          ? (area * type.pricePerM2!).toFixed(2) : "";
        return [
          type.name,
          ppm ? area.toFixed(2) : "",
          ppm ? perim.toFixed(2) : "",
          waste,
          ppm ? cmd.toFixed(2) : "",
          type.boxSizeM2 ?? "",
          boxes,
          type.pricePerM2 ?? "",
          ht,
        ];
      });

    const totalCmd = ppm
      ? types.reduce((s, t) => {
          const a = totals[t.id] ?? 0;
          return s + a * (1 + (t.wastePercent ?? 10) / 100);
        }, 0)
      : 0;

    const lines = [
      headers.join(sep),
      ...rows.map(r => r.join(sep)),
      "",
      ["TOTAL NET", ppm ? totalAll.toFixed(2) : "", "", "", ppm ? totalCmd.toFixed(2) : ""].join(sep),
      ...(hasPrices && ppm && totalHT > 0
        ? [["TOTAL HT", "", "", "", "", "", "", "", totalHT.toFixed(2)].join(sep)]
        : []),
    ];

    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `floorscan_metre_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Export XLSX du métré */
  const exportXLSX = () => {
    const wb = XLSX.utils.book_new();

    // ── Feuille Métré surfaces ────────────────────────────────────────────────
    const surfaceRows: (string | number)[][] = [
      ["FloorScan — Métré surfaces", "", "", "", "", "", "", "", ""],
      [`Date: ${new Date().toLocaleDateString("fr-FR")}`, "", "", "", "", "", "", "", ""],
      [],
      ["Type", "Surface nette (m²)", "Périmètre (ml)", "Chute (%)", "Qté à commander (m²)", "m²/boîte", "Boîtes", "Prix/m² (€)", "Montant HT (€)"],
    ];

    types
      .filter(t => (totals[t.id] ?? 0) > 0 || zones.some(z => z.typeId === t.id))
      .forEach(type => {
        const area  = totals[type.id] ?? 0;
        const perim = perims[type.id] ?? 0;
        const waste = type.wastePercent ?? 10;
        const cmd   = area > 0 ? area * (1 + waste / 100) : 0;
        const boxes = type.boxSizeM2 && type.boxSizeM2 > 0 && cmd > 0 ? Math.ceil(cmd / type.boxSizeM2) : "";
        const ht    = ppm && area > 0 && (type.pricePerM2 ?? 0) > 0 ? area * type.pricePerM2! : "";
        surfaceRows.push([
          type.name,
          ppm ? parseFloat(area.toFixed(2)) : "",
          ppm ? parseFloat(perim.toFixed(2)) : "",
          waste,
          ppm ? parseFloat(cmd.toFixed(2)) : "",
          type.boxSizeM2 ?? "",
          boxes,
          type.pricePerM2 ?? "",
          ht,
        ]);
      });

    surfaceRows.push([]);
    surfaceRows.push(["TOTAL NET", ppm ? parseFloat(totalAll.toFixed(2)) : ""]);
    if (hasPrices && ppm && totalHT > 0) {
      surfaceRows.push(["TOTAL HT (€)", ppm ? parseFloat(totalHT.toFixed(2)) : ""]);
    }

    const wsSurface = XLSX.utils.aoa_to_sheet(surfaceRows);
    wsSurface["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsSurface, "Métré surfaces");

    // ── Feuille Linéaires ─────────────────────────────────────────────────────
    if (linearMeasures.length > 0) {
      const linRows: (string | number)[][] = [
        ["FloorScan — Linéaires", "", "", ""],
        [],
        ["Catégorie", "Longueur totale (ml)", "Prix/ml (€)", "Montant HT (€)"],
      ];
      linearCategories
        .filter(c => (linearTotals[c.id] ?? 0) > 0)
        .forEach(cat => {
          const total = linearTotals[cat.id] ?? 0;
          const ht    = cat.pricePerM ? total * cat.pricePerM : "";
          linRows.push([cat.name, parseFloat(total.toFixed(2)), cat.pricePerM ?? "", ht]);
        });
      const wsLin = XLSX.utils.aoa_to_sheet(linRows);
      wsLin["!cols"] = [{ wch: 22 }, { wch: 20 }, { wch: 12 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, wsLin, "Linéaires");
    }

    // ── Feuille Comptage ──────────────────────────────────────────────────────
    if (countPoints.length > 0) {
      const cntRows: (string | number)[][] = [
        ["FloorScan — Comptage", "", "", ""],
        [],
        ["Groupe", "Quantité", "Prix/unité (€)", "Montant HT (€)"],
      ];
      countGroups
        .filter(g => countPoints.some(p => p.groupId === g.id))
        .forEach(grp => {
          const qty = countPoints.filter(p => p.groupId === grp.id).length;
          const ht  = grp.pricePerUnit ? qty * grp.pricePerUnit : "";
          cntRows.push([grp.name, qty, grp.pricePerUnit ?? "", ht]);
        });
      const wsCnt = XLSX.utils.aoa_to_sheet(cntRows);
      wsCnt["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 14 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, wsCnt, "Comptage");
    }

    // ── Feuille Angles ────────────────────────────────────────────────────────
    if (angleMeasurements.length > 0) {
      const angRows: (string | number)[][] = [
        ["FloorScan — Angles", "", ""],
        [],
        ["N°", "Angle (°)", "Label"],
      ];
      angleMeasurements.forEach((am, i) => {
        angRows.push([i + 1, parseFloat(angleDeg(am).toFixed(1)), am.label ?? ""]);
      });
      const wsAng = XLSX.utils.aoa_to_sheet(angRows);
      wsAng["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, wsAng, "Angles");
    }

    // ── Feuille Cercles ─────────────────────────────────────────────────────
    if (circleMeasures.length > 0 && ppm) {
      const circRows: (string | number)[][] = [
        ["FloorScan — Cercles", "", "", "", ""],
        [],
        ["N°", "Rayon (m)", "Diamètre (m)", "Périmètre (m)", "Surface (m²)"],
      ];
      circleMeasures.forEach((cm, i) => {
        const m = circleMetrics(cm, imageW, imageH, ppm);
        if (m) {
          circRows.push([i + 1, +m.radiusM.toFixed(3), +m.diameterM.toFixed(3), +m.circumferenceM.toFixed(2), +m.areaM2.toFixed(2)]);
        }
      });
      const wsCirc = XLSX.utils.aoa_to_sheet(circRows);
      wsCirc["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, wsCirc, "Cercles");
    }

    XLSX.writeFile(wb, `floorscan_metre_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  /** Export PDF du métré */
  const exportPDF = async () => {
    setExporting(true);
    try {
      const dateStr = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
      const builder = await PdfBuilder.create({
        docType: "METRE",
        docSubtitle: "Metre manuel - surfaces & lineaires",
        dateStr,
        lang,
      });

      builder.newPage();
      const mx = PAGE.MARGIN_X;

      // ── Section surfaces ───────────────────────────────────────────────────
      builder.drawSectionTitle("Surfaces");

      const SURF_COLS = [
        { key: "type",    label: "Type",            x: mx,       width: 155, align: "left"  as const },
        { key: "area",    label: "Surface (m2)",     x: mx + 160, width: 72,  align: "right" as const },
        { key: "perim",   label: "Perim. (ml)",      x: mx + 237, width: 68,  align: "right" as const },
        { key: "cmd",     label: "A commander (m2)", x: mx + 310, width: 80,  align: "right" as const },
        { key: "ht",      label: "Montant HT",       x: mx + 395, width: 65,  align: "right" as const },
      ];

      builder.drawTableHeader(SURF_COLS, lang);

      const activeTypes = types.filter(t => (totals[t.id] ?? 0) > 0 || zones.some(z => z.typeId === t.id));
      for (const type of activeTypes) {
        const area  = totals[type.id] ?? 0;
        const perim = perims[type.id] ?? 0;
        const waste = type.wastePercent ?? 10;
        const cmd   = ppm && area > 0 ? area * (1 + waste / 100) : null;
        const ht    = ppm && area > 0 && (type.pricePerM2 ?? 0) > 0 ? area * type.pricePerM2! : null;
        builder.drawTableRow(SURF_COLS, {
          type: safeTxt(type.name),
          area:  ppm ? area.toFixed(2)  : "—",
          perim: ppm ? perim.toFixed(2) : "—",
          cmd:   cmd  ? cmd.toFixed(2)  : "—",
          ht:    ht   ? ht.toLocaleString("fr-FR", { minimumFractionDigits: 2 }).replace(/\u00A0/g, " ") : "—",
        });
      }

      // Total row
      builder.drawTableTotalRow(SURF_COLS, {
        type:  "TOTAL NET",
        area:  ppm ? `${totalAll.toFixed(2)} m2` : "—",
        perim: "—",
        cmd:   "—",
        ht:    hasPrices && ppm && totalHT > 0
          ? totalHT.toLocaleString("fr-FR", { minimumFractionDigits: 2 }).replace(/\u00A0/g, " ")
          : "—",
      }, { bg: C.VIOLET_PALE, color: C.VIOLET });

      // ── Section linéaires ──────────────────────────────────────────────────
      if (ppm && linearMeasures.length > 0) {
        builder.ensureSpace(60);
        builder.drawSectionTitle("Lineaires (ml)");

        const LIN_COLS = [
          { key: "cat",   label: "Categorie",    x: mx,       width: 200 },
          { key: "len",   label: "Longueur (ml)", x: mx + 205, width: 95,  align: "right" as const },
          { key: "price", label: "Prix/ml (EUR)", x: mx + 305, width: 85,  align: "right" as const },
          { key: "ht",    label: "Montant HT",   x: mx + 395, width: 65,  align: "right" as const },
        ];
        builder.drawTableHeader(LIN_COLS, lang);
        for (const cat of linearCategories.filter(c => (linearTotals[c.id] ?? 0) > 0)) {
          const total = linearTotals[cat.id] ?? 0;
          builder.drawTableRow(LIN_COLS, {
            cat:   safeTxt(cat.name),
            len:   total.toFixed(2),
            price: cat.pricePerM ? cat.pricePerM.toFixed(2) : "—",
            ht:    cat.pricePerM ? (total * cat.pricePerM).toFixed(2) : "—",
          });
        }
      }

      // ── Section comptage ───────────────────────────────────────────────────
      if (countPoints.length > 0) {
        builder.ensureSpace(60);
        builder.drawSectionTitle("Comptage");
        const CNT_COLS = [
          { key: "grp",  label: "Groupe",        x: mx,       width: 200 },
          { key: "qty",  label: "Quantite",       x: mx + 205, width: 80,  align: "right" as const },
          { key: "pu",   label: "Prix/unite",     x: mx + 290, width: 100, align: "right" as const },
          { key: "ht",   label: "Montant HT",     x: mx + 395, width: 65,  align: "right" as const },
        ];
        builder.drawTableHeader(CNT_COLS, lang);
        for (const grp of countGroups.filter(g => countPoints.some(p => p.groupId === g.id))) {
          const qty = countPoints.filter(p => p.groupId === grp.id).length;
          const ht  = grp.pricePerUnit ? qty * grp.pricePerUnit : null;
          builder.drawTableRow(CNT_COLS, {
            grp:  safeTxt(grp.name),
            qty:  String(qty),
            pu:   grp.pricePerUnit ? grp.pricePerUnit.toFixed(2) : "—",
            ht:   ht ? ht.toFixed(2) : "—",
          });
        }
      }

      // ── Section angles ──────────────────────────────────────────────────
      if (angleMeasurements.length > 0) {
        builder.ensureSpace(60);
        builder.drawSectionTitle("Angles");
        const ANG_COLS = [
          { key: "num",   label: "N.",           x: mx,       width: 40 },
          { key: "angle", label: "Angle (deg)",  x: mx + 45,  width: 100, align: "right" as const },
          { key: "label", label: "Label",        x: mx + 150, width: 310 },
        ];
        builder.drawTableHeader(ANG_COLS, lang);
        angleMeasurements.forEach((am, i) => {
          builder.drawTableRow(ANG_COLS, {
            num: String(i + 1),
            angle: angleDeg(am).toFixed(1) + "°",
            label: am.label ?? "",
          });
        });
      }

      // ── Section cercles ──────────────────────────────────────────────────
      if (circleMeasures.length > 0 && ppm) {
        builder.ensureSpace(60);
        builder.drawSectionTitle("Cercles");
        const CIRC_COLS = [
          { key: "num",   label: "N.",            x: mx,       width: 40 },
          { key: "rad",   label: "Rayon (m)",     x: mx + 45,  width: 90,  align: "right" as const },
          { key: "diam",  label: "Diametre (m)",  x: mx + 140, width: 90,  align: "right" as const },
          { key: "circ",  label: "Perimetre (m)", x: mx + 235, width: 100, align: "right" as const },
          { key: "area",  label: "Surface (m2)",  x: mx + 340, width: 120, align: "right" as const },
        ];
        builder.drawTableHeader(CIRC_COLS, lang);
        circleMeasures.forEach((cm, i) => {
          const m = circleMetrics(cm, imageW, imageH, ppm);
          if (m) {
            builder.drawTableRow(CIRC_COLS, {
              num: String(i + 1),
              rad: m.radiusM.toFixed(3),
              diam: m.diameterM.toFixed(3),
              circ: m.circumferenceM.toFixed(2),
              area: m.areaM2.toFixed(2),
            });
          }
        });
      }

      builder.finalize();
      await builder.saveAndDownload(`floorscan_metre_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error("PDF export error:", err);
    } finally {
      setExporting(false);
    }
  };

  // ── Room mode data ──────────────────────────────────────────────────────────
  const roomZones = useMemo(
    () => zones.filter(z => isRoomTypeId(z.typeId) && !isEmpriseTypeId(z.typeId) && !z.isDeduction),
    [zones]
  );
  const empriseZones = useMemo(
    () => zones.filter(z => isEmpriseTypeId(z.typeId)),
    [zones]
  );

  const roomZoneLabels = useMemo(() => {
    const countByType: Record<string, number> = {};
    const labels: Record<string, string> = {};
    for (const z of roomZones) countByType[z.typeId] = (countByType[z.typeId] ?? 0) + 1;
    const currentIndex: Record<string, number> = {};
    for (const z of roomZones) {
      currentIndex[z.typeId] = (currentIndex[z.typeId] ?? 0) + 1;
      const typeDef = roomTypes.find(t => t.id === z.typeId);
      const baseName = z.name || typeDef?.name || z.typeId;
      labels[z.id] = countByType[z.typeId] > 1 ? `${baseName} ${currentIndex[z.typeId]}` : baseName;
    }
    return labels;
  }, [roomZones, roomTypes]);

  const habArea = useMemo(() => {
    if (!ppm) return 0;
    return roomZones.reduce((sum, z) => sum + polygonAreaPx(z.points, imageW, imageH) / ppm ** 2, 0);
  }, [roomZones, imageW, imageH, ppm]);

  const empriseArea = useMemo(() => {
    if (!ppm || empriseZones.length === 0) return 0;
    return empriseZones.reduce((sum, z) => sum + polygonAreaPx(z.points, imageW, imageH) / ppm ** 2, 0);
  }, [empriseZones, imageW, imageH, ppm]);

  const roomTotalPerim = useMemo(() => {
    if (!ppm) return 0;
    return roomZones.reduce((sum, z) => sum + polygonPerimeterM(z.points, imageW, imageH, ppm), 0);
  }, [roomZones, imageW, imageH, ppm]);

  // Volume m³
  const habVolume = ppm && habArea > 0 ? habArea * ceilingHeightM : 0;

  const exportRoomsCSV = () => {
    const sep = ";";
    const headers = ["Pièce", "Type", "Surface (m²)", "Périmètre (m)", "Volume (m³)"];
    const rows: (string | number)[][] = roomZones.map(z => {
      const typeDef = roomTypes.find(t => t.id === z.typeId);
      const area  = ppm ? polygonAreaPx(z.points, imageW, imageH) / ppm ** 2 : 0;
      const perim = ppm ? polygonPerimeterM(z.points, imageW, imageH, ppm) : 0;
      const vol   = ppm && area > 0 ? area * ceilingHeightM : 0;
      return [
        roomZoneLabels[z.id] ?? "",
        typeDef?.name ?? z.typeId,
        ppm ? area.toFixed(2) : "",
        ppm ? perim.toFixed(2) : "",
        ppm ? vol.toFixed(2) : "",
      ];
    });
    if (empriseZones.length > 0) {
      for (const ez of empriseZones) {
        const area  = ppm ? polygonAreaPx(ez.points, imageW, imageH) / ppm ** 2 : 0;
        const perim = ppm ? polygonPerimeterM(ez.points, imageW, imageH, ppm) : 0;
        rows.push([d("sv_emprise"), d("sv_emprise"), ppm ? area.toFixed(2) : "", ppm ? perim.toFixed(2) : "", ""]);
      }
    }
    rows.push([]);
    rows.push(["TOTAL", "", ppm ? (habArea + empriseArea).toFixed(2) : "", ppm ? roomTotalPerim.toFixed(2) : "", ppm ? habVolume.toFixed(2) : ""]);

    const lines = [headers.join(sep), ...rows.map(r => r.join(sep))];
    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `floorscan_rooms_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasTabs = onPanelModeChange != null && roomTypes.length > 0;
  const hasLinearTab = onLinearMeasuresChange != null;
  const hasCountTab  = onCountPointsChange != null;

  // Linear totals for HT
  const linearTotalHT = linearCategories.reduce((sum, c) => {
    const len = linearTotals[c.id] ?? 0;
    return sum + len * (c.pricePerM ?? 0);
  }, 0);

  // Count totals for HT
  const countTotalHT = countGroups.reduce((sum, g) => {
    const qty = countPoints.filter(p => p.groupId === g.id).length;
    return sum + qty * (g.pricePerUnit ?? 0);
  }, 0);

  return (
    <div className="flex flex-col gap-3">
      {/* ── Tab switcher ── */}
      {(hasTabs || hasLinearTab || hasCountTab) && (
        <div className="flex rounded-lg border border-white/10 overflow-hidden">
          <button onClick={() => onPanelModeChange?.("metre")}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-medium transition-colors border-r border-white/10 truncate ${
              panelMode === "metre" ? "bg-accent/20 text-accent" : "text-slate-500 hover:text-slate-300"}`}>
            <Ruler className="w-3 h-3 shrink-0" /> <span className="truncate">{d("sv_tab_metre")}</span>
          </button>
          {hasTabs && (
            <button onClick={() => onPanelModeChange!("rooms")}
              className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-medium transition-colors border-r border-white/10 truncate ${
                panelMode === "rooms" ? "bg-accent/20 text-accent" : "text-slate-500 hover:text-slate-300"}`}>
              <Home className="w-3 h-3 shrink-0" /> <span className="truncate">{d("sv_tab_rooms")}</span>
            </button>
          )}
          {hasLinearTab && (
            <button onClick={() => onPanelModeChange?.("linear")}
              className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-medium transition-colors border-r border-white/10 truncate ${
                panelMode === "linear" ? "bg-emerald-500/20 text-emerald-400" : "text-slate-500 hover:text-slate-300"}`}>
              <Ruler className="w-3 h-3 shrink-0" /> <span className="truncate">ml</span>
            </button>
          )}
          {hasCountTab && (
            <button onClick={() => onPanelModeChange?.("count")}
              className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-medium transition-colors truncate ${
                panelMode === "count" ? "bg-pink-500/20 text-pink-400" : "text-slate-500 hover:text-slate-300"}`}>
              <Hash className="w-3 h-3 shrink-0" /> <span className="truncate">Comptage</span>
            </button>
          )}
        </div>
      )}

      {/* ── METRE MODE ── */}
      {panelMode === "metre" && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-600 text-slate-400 uppercase tracking-wide">Types de surface</h3>
            <div className="flex items-center gap-1">
              {/* Import CSV prix */}
              <input ref={csvInputRef} type="file" accept=".csv,.txt" onChange={importPriceCSV} className="hidden" />
              <button onClick={() => csvInputRef.current?.click()} title="Importer prix CSV (Nom;Prix/m²)"
                className="glass border border-white/10 rounded-lg p-1 text-slate-400 hover:text-amber-400 transition-colors">
                <Upload className="w-3.5 h-3.5" />
              </button>
              {zones.length > 0 && (
                <>
                  <button onClick={exportCSV} title="CSV"
                    className="glass border border-white/10 rounded-lg p-1 text-slate-400 hover:text-white transition-colors">
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={exportXLSX} title="XLSX"
                    className="glass border border-white/10 rounded-lg p-1 text-slate-400 hover:text-emerald-400 transition-colors">
                    <Table2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={exportPDF} disabled={exporting} title="PDF"
                    className="glass border border-white/10 rounded-lg p-1 text-slate-400 hover:text-red-400 transition-colors disabled:opacity-50">
                    <FileText className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              <button onClick={() => setAdding(v => !v)}
                className="glass border border-white/10 rounded-lg p-1 text-slate-400 hover:text-white transition-colors">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {adding && (
            <div className="glass border border-white/10 rounded-xl p-3 flex flex-col gap-2">
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addType(); if (e.key === "Escape") setAdding(false); }}
                placeholder="Nom du type..."
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 outline-none focus:border-accent" />
              <div className="flex items-center gap-2 flex-wrap">
                {PRESET_COLORS.map(c => (
                  <button key={c} onClick={() => setNewColor(c)}
                    className="w-5 h-5 rounded-full border-2 transition-all"
                    style={{ background: c, borderColor: newColor === c ? "white" : "transparent", transform: newColor === c ? "scale(1.2)" : "scale(1)" }} />
                ))}
                <label className="relative w-6 h-6 cursor-pointer" title="Couleur personnalisée">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full border-2 text-white text-xs font-bold"
                    style={{ background: PRESET_COLORS.includes(newColor) ? "#374151" : newColor, borderColor: PRESET_COLORS.includes(newColor) ? "#6B7280" : "white" }}>+</span>
                  <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                </label>
              </div>
              <button onClick={addType} disabled={!newName.trim()}
                className="flex items-center justify-center gap-1.5 bg-accent hover:bg-accent/80 disabled:opacity-40 text-white rounded-lg py-1.5 text-xs font-medium transition-colors">
                <Check className="w-3.5 h-3.5" /> Ajouter
              </button>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            {types.map(type => {
              const area      = totals[type.id] ?? 0;
              const perimM    = perims[type.id] ?? 0;
              const isActive  = activeTypeId === type.id;
              const zoneCount = zones.filter(z => z.typeId === type.id && !z.isDeduction).length;
              const waste     = type.wastePercent ?? 10;
              const areaCmd   = area > 0 ? area * (1 + waste / 100) : 0;
              const boxes     = type.boxSizeM2 && type.boxSizeM2 > 0 && areaCmd > 0
                ? Math.ceil(areaCmd / type.boxSizeM2) : null;
              const lineTotal = ppm && area > 0 && (type.pricePerM2 ?? 0) > 0 ? area * type.pricePerM2! : null;

              return (
                <div key={type.id}
                  className={`rounded-xl border transition-all ${isActive ? "border-accent/40 bg-accent/10" : "border-white/5 glass"}`}>
                  <div onClick={() => onActiveTypeChange(type.id)}
                    className="flex items-center gap-2.5 px-3 pt-2.5 pb-1 cursor-pointer">
                    <label className="relative w-3.5 h-3.5 shrink-0 cursor-pointer" title="Changer la couleur"
                      onClick={e => e.stopPropagation()}>
                      <span className="block w-3.5 h-3.5 rounded-full ring-1 ring-white/20 hover:ring-white/60 transition-all" style={{ background: type.color }} />
                      <input type="color" value={type.color} onChange={e => updateColor(type.id, e.target.value)}
                        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                    </label>
                    <span className={`text-sm font-medium flex-1 ${isActive ? "text-white" : "text-slate-300"}`}>{type.name}</span>
                    <div className="flex flex-col items-end gap-0">
                      <span className="text-xs text-slate-400 font-mono">
                        {zoneCount > 0 ? ppm ? `${area.toFixed(2)} m²` : `${zoneCount} zone${zoneCount > 1 ? "s" : ""}` : "—"}
                      </span>
                      {ppm && perimM > 0 && (
                        <span className="text-[10px] text-slate-600 font-mono">{perimM.toFixed(1)} ml périm.</span>
                      )}
                    </div>
                    {!DEFAULT_IDS.includes(type.id) && (
                      <button onClick={e => { e.stopPropagation(); removeType(type.id); }}
                        className="text-slate-600 hover:text-red-400 transition-colors ml-1">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 px-3 pb-1.5" onClick={e => e.stopPropagation()}>
                    <span className="text-xs text-slate-600">€/m²</span>
                    <input type="number" value={type.pricePerM2 ?? ""} onChange={e => updatePrice(type.id, e.target.value)}
                      placeholder="0" min={0} step={1}
                      className="w-16 bg-white/5 border border-white/10 rounded px-2 py-0.5 text-xs text-white font-mono focus:outline-none focus:border-accent" />
                    <span className="text-xs text-slate-600 ml-1">Chute</span>
                    <input type="number" value={type.wastePercent ?? 10} onChange={e => updateWaste(type.id, e.target.value)}
                      placeholder="10" min={0} max={100} step={1}
                      className="w-12 bg-white/5 border border-white/10 rounded px-2 py-0.5 text-xs text-white font-mono focus:outline-none focus:border-accent" />
                    <span className="text-xs text-slate-600">%</span>
                    {lineTotal !== null && (
                      <span className="ml-auto text-xs text-accent font-mono">
                        {lineTotal.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                      </span>
                    )}
                  </div>
                  {ppm && area > 0 && (
                    <div className="flex items-center gap-2 px-3 pb-2" onClick={e => e.stopPropagation()}>
                      <Package className="w-3 h-3 text-slate-600 shrink-0" />
                      <input type="number" value={type.boxSizeM2 ?? ""} onChange={e => updateBoxSize(type.id, e.target.value)}
                        placeholder="m²/boîte" min={0} step={0.1}
                        className="w-20 bg-white/5 border border-white/10 rounded px-2 py-0.5 text-xs text-white font-mono focus:outline-none focus:border-accent" />
                      <span className="text-xs text-slate-600">m²/boîte</span>
                      <span className="ml-auto text-xs text-slate-400 font-mono">
                        {areaCmd.toFixed(2)} m²
                        {boxes !== null && <span className="text-amber-400 ml-1">→ {boxes} boîtes</span>}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {customDetections.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/5">
              <h3 className="text-xs font-600 text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Search className="w-3 h-3" /> Détections
              </h3>
              <div className="flex flex-col gap-1.5">
                {customDetections.map(det => (
                  <div key={det.id} className="glass border border-white/5 rounded-xl px-3 py-2 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: det.color }} />
                    <span className="text-sm text-slate-300 flex-1 truncate">{det.label}</span>
                    <span className="text-xs text-slate-500 font-mono">{det.count}×</span>
                    <span className="text-xs font-mono" style={{ color: det.color }}>
                      {det.total_area_m2 != null ? `${det.total_area_m2.toFixed(2)} m²` : `${Math.round(det.total_area_px2).toLocaleString()} px²`}
                    </span>
                    {onDeleteDetection && (
                      <button onClick={() => onDeleteDetection(det.id)}
                        className="text-slate-600 hover:text-red-400 transition-colors ml-1 shrink-0">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {zones.length > 0 && (
            <div className="mt-2 pt-3 border-t border-white/5 flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Total net</span>
                <span className="font-mono text-sm text-white font-600">
                  {ppm ? `${totalAll.toFixed(2)} m²` : `${zones.filter(z => !z.isDeduction).length} zone${zones.length > 1 ? "s" : ""}`}
                </span>
              </div>
              {ppm && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">À commander (avec chutes)</span>
                  <span className="font-mono text-xs text-amber-400">
                    {types.reduce((sum, t) => {
                      const a = totals[t.id] ?? 0;
                      return sum + a * (1 + (t.wastePercent ?? 10) / 100);
                    }, 0).toFixed(2)} m²
                  </span>
                </div>
              )}
              {hasPrices && ppm && totalHT > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">Total HT</span>
                  <span className="font-mono text-sm text-accent font-600">
                    {totalHT.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                  </span>
                </div>
              )}
              {!ppm && <p className="text-xs text-slate-600 mt-1">Définissez l'échelle pour voir les m²</p>}
              <div className="flex gap-1 mt-1">
                <button onClick={exportCSV}
                  className="flex-1 flex items-center justify-center gap-1 text-xs text-slate-500 hover:text-slate-300 glass border border-white/5 rounded-lg py-1.5 transition-colors">
                  <Download className="w-3 h-3" /> CSV
                </button>
                <button onClick={exportXLSX}
                  className="flex-1 flex items-center justify-center gap-1 text-xs text-slate-500 hover:text-emerald-400 glass border border-white/5 rounded-lg py-1.5 transition-colors">
                  <Table2 className="w-3 h-3" /> XLSX
                </button>
                <button onClick={exportPDF} disabled={exporting}
                  className="flex-1 flex items-center justify-center gap-1 text-xs text-slate-500 hover:text-red-400 glass border border-white/5 rounded-lg py-1.5 transition-colors disabled:opacity-50">
                  <FileText className="w-3 h-3" /> {exporting ? "..." : "PDF"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── ROOMS MODE ── */}
      {panelMode === "rooms" && (
        <>
          {/* Ceiling height + volume */}
          <div className="flex items-center gap-2 glass border border-blue-500/20 rounded-xl px-3 py-2">
            <span className="text-xs text-slate-400 shrink-0">H plafond</span>
            <input type="number" value={ceilingHeightM} min={1.5} max={10} step={0.05}
              onChange={e => setCeilingHeightM(Math.max(1, parseFloat(e.target.value) || 2.5))}
              className="w-16 bg-transparent border-b border-blue-500/30 text-blue-300 text-xs font-mono text-center focus:outline-none focus:border-blue-400" />
            <span className="text-xs text-slate-500">m</span>
            {ppm && habVolume > 0 && (
              <span className="ml-auto text-xs font-mono text-blue-400">{habVolume.toFixed(1)} m³</span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-600 text-slate-400 uppercase tracking-wide">{d("sv_emprise")}</h3>
            <button onClick={() => onActiveTypeChange(EMPRISE_TYPE.id)}
              className={`rounded-xl border px-3 py-2.5 flex items-center gap-2.5 transition-all ${
                activeTypeId === EMPRISE_TYPE.id ? "border-blue-400/40 bg-blue-500/10" : "border-white/5 glass hover:border-white/20"
              }`}>
              <span className="w-4 h-4 rounded-full ring-1 ring-white/20 shrink-0" style={{ background: EMPRISE_TYPE.color }} />
              <span className={`text-sm font-medium flex-1 text-left ${activeTypeId === EMPRISE_TYPE.id ? "text-white" : "text-slate-300"}`}>
                {d("sv_emprise")}
              </span>
              {empriseZones.length > 0 && ppm
                ? <span className="text-xs text-slate-400 font-mono">{empriseArea.toFixed(2)} m²</span>
                : <span className="text-[10px] text-slate-600 italic">{d("sv_emprise_hint")}</span>
              }
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-600 text-slate-400 uppercase tracking-wide">{d("sv_tab_rooms")}</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {roomTypes.filter(t => !isEmpriseTypeId(t.id)).map(rt => {
                const isActive = activeTypeId === rt.id;
                return (
                  <button key={rt.id} onClick={() => onActiveTypeChange(rt.id)}
                    className={`rounded-lg border px-2 py-1.5 flex items-center gap-1.5 text-left transition-all ${
                      isActive ? "border-accent/40 bg-accent/10" : "border-white/5 glass hover:border-white/20"
                    }`}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: rt.color }} />
                    <span className={`text-[11px] font-medium truncate ${isActive ? "text-white" : "text-slate-400"}`}>{rt.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {roomZones.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-1">
              {roomZones.map(z => {
                const typeDef = roomTypes.find(t => t.id === z.typeId);
                const area  = ppm ? polygonAreaPx(z.points, imageW, imageH) / ppm ** 2 : 0;
                const perim = ppm ? polygonPerimeterM(z.points, imageW, imageH, ppm) : 0;
                const vol   = ppm && area > 0 ? area * ceilingHeightM : 0;
                return (
                  <div key={z.id} className="glass border border-white/5 rounded-xl px-3 py-2 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: typeDef?.color ?? "#6B7280" }} />
                    <span className="text-sm text-slate-300 flex-1 truncate">
                      {roomZoneLabels[z.id] ?? typeDef?.name ?? z.typeId}
                    </span>
                    {ppm ? (
                      <div className="flex flex-col items-end">
                        <span className="text-xs text-slate-400 font-mono whitespace-nowrap">{area.toFixed(2)} m²</span>
                        <span className="text-[10px] text-blue-400 font-mono">{vol.toFixed(1)} m³</span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {roomZones.length === 0 && empriseZones.length === 0 && (
            <p className="text-xs text-slate-600 text-center py-4">{d("sv_no_room")}</p>
          )}

          {(roomZones.length > 0 || empriseZones.length > 0) && (
            <div className="mt-2 pt-3 border-t border-white/5 flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">{d("sv_room_count")}</span>
                <span className="font-mono text-sm text-white font-600">{roomZones.length}</span>
              </div>
              {ppm && habArea > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">{d("sv_hab_area")}</span>
                  <span className="font-mono text-sm text-white font-600">{habArea.toFixed(2)} m²</span>
                </div>
              )}
              {ppm && habVolume > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">Volume habitable</span>
                  <span className="font-mono text-sm text-blue-400 font-600">{habVolume.toFixed(1)} m³</span>
                </div>
              )}
              {ppm && roomTotalPerim > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">{d("sv_room_perim")}</span>
                  <span className="font-mono text-xs text-slate-400">{roomTotalPerim.toFixed(1)} m</span>
                </div>
              )}
              {ppm && empriseArea > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">{d("sv_emprise_area")}</span>
                  <span className="font-mono text-sm text-blue-400 font-600">{empriseArea.toFixed(2)} m²</span>
                </div>
              )}
              <button onClick={exportRoomsCSV}
                className="mt-1 flex items-center justify-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 glass border border-white/5 rounded-lg py-1.5 transition-colors">
                <Download className="w-3 h-3" /> {d("sv_rooms_csv")}
              </button>
            </div>
          )}
        </>
      )}

      {/* ── LINEAR MODE ── */}
      {panelMode === "linear" && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-600 text-slate-400 uppercase tracking-wide">Catégories linéaires</h3>
            <button onClick={() => setAddingLinear(v => !v)}
              className="glass border border-white/10 rounded-lg p-1 text-slate-400 hover:text-white transition-colors">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {addingLinear && (
            <div className="glass border border-white/10 rounded-xl p-3 flex flex-col gap-2">
              <input autoFocus value={newLinearName} onChange={e => setNewLinearName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && newLinearName.trim()) {
                    const id = newLinearName.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
                    onLinearCategoriesChange?.([...linearCategories, { id, name: newLinearName.trim(), color: newLinearColor }]);
                    onActiveLinearCategoryChange?.(id);
                    setNewLinearName(""); setAddingLinear(false);
                  }
                  if (e.key === "Escape") setAddingLinear(false);
                }}
                placeholder="Nom de la catégorie..."
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 outline-none focus:border-emerald-500" />
              <div className="flex items-center gap-2 flex-wrap">
                {PRESET_COLORS.map(c => (
                  <button key={c} onClick={() => setNewLinearColor(c)}
                    className="w-5 h-5 rounded-full border-2 transition-all"
                    style={{ background: c, borderColor: newLinearColor === c ? "white" : "transparent" }} />
                ))}
              </div>
              <button
                onClick={() => {
                  if (!newLinearName.trim()) return;
                  const id = newLinearName.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
                  onLinearCategoriesChange?.([...linearCategories, { id, name: newLinearName.trim(), color: newLinearColor }]);
                  onActiveLinearCategoryChange?.(id);
                  setNewLinearName(""); setAddingLinear(false);
                }}
                disabled={!newLinearName.trim()}
                className="flex items-center justify-center gap-1.5 bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-40 text-white rounded-lg py-1.5 text-xs font-medium transition-colors">
                <Check className="w-3.5 h-3.5" /> Ajouter
              </button>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            {linearCategories.map(cat => {
              const totalM    = linearTotals[cat.id] ?? 0;
              const lineCount = linearMeasures.filter(m => m.categoryId === cat.id).length;
              const isActive  = activeLinearCategoryId === cat.id;
              const ht        = cat.pricePerM && totalM > 0 ? totalM * cat.pricePerM : null;
              return (
                <div key={cat.id}
                  className={`rounded-xl border transition-all ${isActive ? "border-emerald-500/40 bg-emerald-500/10" : "border-white/5 glass"}`}>
                  <div onClick={() => onActiveLinearCategoryChange?.(cat.id)}
                    className="flex items-center gap-2.5 px-3 pt-2.5 pb-1 cursor-pointer">
                    <span className="w-3.5 h-3.5 rounded-full ring-1 ring-white/20 shrink-0" style={{ background: cat.color }} />
                    <span className={`text-sm font-medium flex-1 ${isActive ? "text-white" : "text-slate-300"}`}>{cat.name}</span>
                    <div className="flex flex-col items-end gap-0">
                      <span className="text-xs text-slate-400 font-mono">
                        {lineCount > 0 ? ppm ? `${totalM.toFixed(2)} ml` : `${lineCount} seg.` : "—"}
                      </span>
                      {ht !== null && (
                        <span className="text-[10px] text-emerald-400 font-mono">{ht.toFixed(2)} €</span>
                      )}
                    </div>
                    <button onClick={e => {
                      e.stopPropagation();
                      onLinearCategoriesChange?.(linearCategories.filter(c => c.id !== cat.id));
                      onLinearMeasuresChange?.(linearMeasures.filter(m => m.categoryId !== cat.id));
                    }} className="text-slate-600 hover:text-red-400 transition-colors ml-1">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 px-3 pb-2" onClick={e => e.stopPropagation()}>
                    <span className="text-xs text-slate-600">€/ml</span>
                    <input type="number" value={cat.pricePerM ?? ""} min={0} step={0.5}
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        onLinearCategoriesChange?.(linearCategories.map(c =>
                          c.id === cat.id ? { ...c, pricePerM: isNaN(v) ? undefined : v } : c
                        ));
                      }}
                      placeholder="0"
                      className="w-20 bg-white/5 border border-white/10 rounded px-2 py-0.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Linear totals */}
          {linearMeasures.length > 0 && ppm && (
            <div className="mt-2 pt-3 border-t border-white/5 flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Total linéaire</span>
                <span className="font-mono text-sm text-emerald-400 font-600">
                  {Object.values(linearTotals).reduce((a, b) => a + b, 0).toFixed(2)} ml
                </span>
              </div>
              {linearTotalHT > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">Total HT</span>
                  <span className="font-mono text-sm text-accent font-600">
                    {linearTotalHT.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €
                  </span>
                </div>
              )}
            </div>
          )}

          {linearCategories.length === 0 && (
            <p className="text-xs text-slate-600 text-center py-4">
              Ajoutez une catégorie puis utilisez l'outil <strong className="text-slate-400">Linéaire</strong> pour mesurer.
            </p>
          )}
        </>
      )}

      {/* ── COUNT MODE ── */}
      {panelMode === "count" && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-600 text-slate-400 uppercase tracking-wide">Groupes de comptage</h3>
            <button onClick={() => setAddingCount(v => !v)}
              className="glass border border-white/10 rounded-lg p-1 text-slate-400 hover:text-white transition-colors">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {addingCount && (
            <div className="glass border border-white/10 rounded-xl p-3 flex flex-col gap-2">
              <input autoFocus value={newCountName} onChange={e => setNewCountName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && newCountName.trim()) {
                    const id = newCountName.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
                    onCountGroupsChange?.([...countGroups, { id, name: newCountName.trim(), color: newCountColor }]);
                    onActiveCountGroupChange?.(id);
                    setNewCountName(""); setAddingCount(false);
                  }
                  if (e.key === "Escape") setAddingCount(false);
                }}
                placeholder="Nom du groupe..."
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 outline-none focus:border-pink-500" />
              <div className="flex items-center gap-2 flex-wrap">
                {PRESET_COLORS.map(c => (
                  <button key={c} onClick={() => setNewCountColor(c)}
                    className="w-5 h-5 rounded-full border-2 transition-all"
                    style={{ background: c, borderColor: newCountColor === c ? "white" : "transparent" }} />
                ))}
              </div>
              <button
                onClick={() => {
                  if (!newCountName.trim()) return;
                  const id = newCountName.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
                  onCountGroupsChange?.([...countGroups, { id, name: newCountName.trim(), color: newCountColor }]);
                  onActiveCountGroupChange?.(id);
                  setNewCountName(""); setAddingCount(false);
                }}
                disabled={!newCountName.trim()}
                className="flex items-center justify-center gap-1.5 bg-pink-600/80 hover:bg-pink-600 disabled:opacity-40 text-white rounded-lg py-1.5 text-xs font-medium transition-colors">
                <Check className="w-3.5 h-3.5" /> Ajouter
              </button>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            {countGroups.map(grp => {
              const qty      = countPoints.filter(p => p.groupId === grp.id).length;
              const isActive = activeCountGroupId === grp.id;
              const ht       = grp.pricePerUnit && qty > 0 ? qty * grp.pricePerUnit : null;
              return (
                <div key={grp.id}
                  className={`rounded-xl border transition-all ${isActive ? "border-pink-500/40 bg-pink-500/10" : "border-white/5 glass"}`}>
                  <div onClick={() => onActiveCountGroupChange?.(grp.id)}
                    className="flex items-center gap-2.5 px-3 pt-2.5 pb-1 cursor-pointer">
                    <span className="w-3.5 h-3.5 rounded-full ring-1 ring-white/20 shrink-0" style={{ background: grp.color }} />
                    <span className={`text-sm font-medium flex-1 ${isActive ? "text-white" : "text-slate-300"}`}>{grp.name}</span>
                    <div className="flex flex-col items-end gap-0">
                      <span className="text-xs font-mono" style={{ color: grp.color }}>
                        {qty > 0 ? `${qty} ×` : "—"}
                      </span>
                      {ht !== null && (
                        <span className="text-[10px] text-pink-400 font-mono">{ht.toFixed(2)} €</span>
                      )}
                    </div>
                    <button onClick={e => {
                      e.stopPropagation();
                      onCountGroupsChange?.(countGroups.filter(g => g.id !== grp.id));
                      onCountPointsChange?.(countPoints.filter(p => p.groupId !== grp.id));
                    }} className="text-slate-600 hover:text-red-400 transition-colors ml-1">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 px-3 pb-2" onClick={e => e.stopPropagation()}>
                    <span className="text-xs text-slate-600">€/u</span>
                    <input type="number" value={grp.pricePerUnit ?? ""} min={0} step={1}
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        onCountGroupsChange?.(countGroups.map(g =>
                          g.id === grp.id ? { ...g, pricePerUnit: isNaN(v) ? undefined : v } : g
                        ));
                      }}
                      placeholder="0"
                      className="w-20 bg-white/5 border border-white/10 rounded px-2 py-0.5 text-xs text-white font-mono focus:outline-none focus:border-pink-500" />
                    {qty > 0 && (
                      <button onClick={e => {
                        e.stopPropagation();
                        onCountPointsChange?.(countPoints.filter(p => p.groupId !== grp.id));
                      }} className="ml-auto text-xs text-slate-600 hover:text-red-400 transition-colors">
                        Effacer {qty}×
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Count totals */}
          {countPoints.length > 0 && (
            <div className="mt-2 pt-3 border-t border-white/5 flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Total éléments</span>
                <span className="font-mono text-sm text-pink-400 font-600">{countPoints.length} ×</span>
              </div>
              {countTotalHT > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">Total HT</span>
                  <span className="font-mono text-sm text-accent font-600">
                    {countTotalHT.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €
                  </span>
                </div>
              )}
            </div>
          )}

          {countGroups.length === 0 && (
            <p className="text-xs text-slate-600 text-center py-4">
              Ajoutez un groupe puis utilisez l'outil <strong className="text-slate-400"># Comptage</strong> pour placer des points.
            </p>
          )}
        </>
      )}
    </div>
  );
}
