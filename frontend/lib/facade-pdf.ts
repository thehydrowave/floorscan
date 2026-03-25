"use client";

import type { FacadeAnalysisResult, FacadeElement } from "@/lib/types";
import type { Lang } from "@/lib/i18n";
import {
  PdfBuilder,
  PAGE,
  TABLE,
  TYPO,
  C,
  d,
  fmtDate,
  fmtPrice,
  safeTxt,
  truncateText,
  type ColDef,
} from "@/lib/pdf-theme";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FacadeRapportOptions {
  projectName: string;
  projectAddress: string;
  clientName: string;
  companyName: string;
  date: string;
}

// ── Column definitions ───────────────────────────────────────────────────────

const ELEMENT_COLS: ColDef[] = [
  { key: "num",    label: "N°",         x: 52,  width: 30,  align: "left" },
  { key: "type",   label: "Type",       x: 86,  width: 110, align: "left" },
  { key: "etage",  label: "Etage",      x: 200, width: 60,  align: "right" },
  { key: "conf",   label: "Confiance",  x: 264, width: 70,  align: "right" },
  { key: "larg",   label: "Larg. (m)",  x: 338, width: 70,  align: "right" },
  { key: "haut",   label: "Haut. (m)",  x: 412, width: 70,  align: "right" },
  { key: "area",   label: "Surf. (m²)", x: 486, width: 60,  align: "right" },
];

const FLOOR_COLS: ColDef[] = [
  { key: "level",     label: "Niveau",           x: 52,  width: 120, align: "left" },
  { key: "windows",   label: "Fenetres",          x: 176, width: 80,  align: "right" },
  { key: "doors",     label: "Portes",            x: 260, width: 80,  align: "right" },
  { key: "balconies", label: "Balcons",           x: 344, width: 80,  align: "right" },
  { key: "area",      label: "Surface ouv. (m²)", x: 428, width: 110, align: "right" },
];

const TYPE_SUMMARY_COLS: ColDef[] = [
  { key: "type",  label: "Type d'element",  x: 52,  width: 160, align: "left" },
  { key: "count", label: "Nb",              x: 216, width: 60,  align: "right" },
  { key: "area",  label: "Surface tot. (m²)", x: 280, width: 100, align: "right" },
  { key: "pct",   label: "% facade",        x: 384, width: 80,  align: "right" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt2(v: number | null | undefined, suffix = ""): string {
  if (v == null) return "—";
  return v.toFixed(2) + suffix;
}

function typeLabel(t: string): string {
  const MAP: Record<string, string> = {
    window:     "Fenetre",
    door:       "Porte",
    balcony:    "Balcon",
    floor_line: "Ligne etage",
    roof:       "Toiture",
    column:     "Colonne",
    other:      "Autre",
  };
  return MAP[t] ?? t;
}

async function embedImg(b: PdfBuilder, b64: string, maxHeightRatio = 0.80): Promise<void> {
  try {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const img   = await b.pdf.embedPng(bytes);
    const maxW  = PAGE.TEXT_WIDTH;
    const maxH  = (PAGE.H - 140) * maxHeightRatio;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const iw    = img.width  * scale;
    const ih    = img.height * scale;
    b.ensureSpace(ih + 20);
    b.page.drawImage(img, { x: (PAGE.W - iw) / 2, y: b.y - ih, width: iw, height: ih });
    b.moveDown(ih + 16);
  } catch {
    b.drawText("(Image non disponible)", { color: C.GRAY_400 });
    b.moveDown(16);
  }
}

function drawKpiGrid(b: PdfBuilder, items: { label: string; value: string; sub?: string }[]): void {
  const cols  = 2;
  const cellW = (PAGE.TEXT_WIDTH - 8) / cols;
  const cellH = 50;
  const rows  = Math.ceil(items.length / cols);
  for (let r = 0; r < rows; r++) {
    b.ensureSpace(cellH + 4);
    for (let c = 0; c < cols; c++) {
      const item = items[r * cols + c];
      if (!item) continue;
      const x = PAGE.MARGIN_X + c * (cellW + 8);
      const y = b.y - cellH;
      b.page.drawRectangle({ x, y, width: cellW, height: cellH, color: C.BLUE });
      b.page.drawRectangle({ x, y, width: 4,     height: cellH, color: C.BLUE_MED });
      b.page.drawText(safeTxt(item.label), { x: x + 12, y: y + cellH - 15, size: TYPO.CAPTION, font: b.font,     color: C.BLUE_LIGHT });
      b.page.drawText(safeTxt(item.value), { x: x + 12, y: y + cellH - 32, size: 14,           font: b.fontBold, color: C.WHITE });
      if (item.sub) b.page.drawText(safeTxt(item.sub), { x: x + 12, y: y + 6, size: TYPO.CAPTION, font: b.font, color: C.BLUE_LIGHT });
    }
    b.moveDown(cellH + 6);
  }
}

function drawInfoRow(b: PdfBuilder, label: string, value: string, alt: boolean): void {
  b.ensureSpace(22);
  if (alt) b.page.drawRectangle({ x: PAGE.MARGIN_X, y: b.y - 6, width: PAGE.TEXT_WIDTH, height: 20, color: C.BG_SUBTLE });
  b.page.drawText(safeTxt(label), { x: PAGE.MARGIN_X + 8,  y: b.y, size: TYPO.BODY, font: b.font,     color: C.GRAY_500 });
  b.page.drawText(safeTxt(value), { x: PAGE.MARGIN_X + 200, y: b.y, size: TYPO.BODY, font: b.fontBold, color: C.DARK });
  b.moveDown(22);
}

// ══════════════════════════════════════════════════════════════════════════════
// GÉNÉRATION DU RAPPORT FAÇADE
// ══════════════════════════════════════════════════════════════════════════════

export async function downloadFacadeRapportPdf(
  result: FacadeAnalysisResult,
  lang: string,
  options: FacadeRapportOptions
): Promise<void> {
  const l       = lang as Lang;
  const dateStr = fmtDate(options.date);
  const elements = result.elements ?? [];
  const ppm      = result.pixels_per_meter ?? null;

  // Groupes par type
  const byType = elements.reduce<Record<string, FacadeElement[]>>((acc, el) => {
    if (!acc[el.type]) acc[el.type] = [];
    acc[el.type].push(el);
    return acc;
  }, {});

  // Par étage
  const floorLevels = [...new Set(elements.map(e => e.floor_level ?? 0))].sort((a, b) => b - a);

  // Surfaces
  const wallArea = result.facade_area_m2 != null && result.openings_area_m2 != null
    ? result.facade_area_m2 - result.openings_area_m2
    : null;

  const b = await PdfBuilder.create({
    docType:     "RAPPORT DE FACADE",
    docSubtitle: "Analyse IA de facade — FloorScan AI",
    dateStr,
    rightMeta:   options.projectName || undefined,
    lang: l,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 1 — COUVERTURE
  // ═══════════════════════════════════════════════════════════════════════

  b.drawCoverPage({
    title:    "RAPPORT D'ANALYSE DE FACADE",
    subtitle: "Detection et mesure des elements architecturaux — FloorScan AI",
    infoLines: [
      ["Projet",     options.projectName    || "—"],
      ["Adresse",    options.projectAddress || "—"],
      ["Client",     options.clientName     || "—"],
      ["Entreprise", options.companyName    || "—"],
      ["Date",       dateStr],
      ["Echelle",    ppm ? `${ppm.toFixed(2)} px/m` : "Non calibree"],
    ],
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 2 — SYNTHÈSE EXÉCUTIVE
  // ═══════════════════════════════════════════════════════════════════════

  b.newPage();
  b.drawSectionTitle("SYNTHESE EXECUTIVE");
  b.moveDown(8);

  drawKpiGrid(b, [
    { label: "Fenetres detectees",  value: String(result.windows_count),   sub: "nb total" },
    { label: "Portes detectees",    value: String(result.doors_count),     sub: "nb total" },
    { label: "Balcons detectes",    value: String(result.balconies_count), sub: "nb total" },
    { label: "Niveaux detectes",    value: String(result.floors_count),    sub: "etages" },
    { label: "Surface facade",      value: fmt2(result.facade_area_m2, " m2"),   sub: "brut" },
    { label: "Surface ouvertures",  value: fmt2(result.openings_area_m2, " m2"), sub: "portes+fenetres+balcons" },
    { label: "Surface murale nette",value: fmt2(wallArea, " m2"),                sub: "plein de mur" },
    { label: "Ratio ouvertures",    value: result.ratio_openings != null ? `${(result.ratio_openings * 100).toFixed(1)}%` : "—", sub: "% de la facade" },
    { label: "Elements detectes",   value: String(elements.length),        sub: "nb total" },
    { label: "Calibration",         value: ppm ? `${ppm.toFixed(1)} px/m` : "N/A", sub: "echelle" },
  ]);

  b.moveDown(16);
  b.drawSectionTitle("INFORMATIONS PROJET");
  b.moveDown(4);

  const infoRows: [string, string][] = [
    ["Projet",            options.projectName    || "—"],
    ["Adresse",           options.projectAddress || "—"],
    ["Client",            options.clientName     || "—"],
    ["Entreprise",        options.companyName    || "—"],
    ["Date du rapport",   dateStr],
    ["Echelle",           ppm ? `${ppm.toFixed(2)} px/m` : "Non calibree"],
    ["Surface facade",    fmt2(result.facade_area_m2, " m2")],
    ["Surface ouv.",      fmt2(result.openings_area_m2, " m2")],
    ["Surface murale",    fmt2(wallArea, " m2")],
    ["Ratio ouvertures",  result.ratio_openings != null ? `${(result.ratio_openings * 100).toFixed(1)}%` : "—"],
    ["ROI analyse",       result.building_roi ? `x=${result.building_roi.x.toFixed(2)} y=${result.building_roi.y.toFixed(2)} w=${result.building_roi.w.toFixed(2)} h=${result.building_roi.h.toFixed(2)}` : "Image entiere"],
    ["Session",           result.session_id ? result.session_id.slice(0, 16) + "..." : "—"],
  ];
  infoRows.forEach(([label, value], i) => drawInfoRow(b, label, value, i % 2 === 0));

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 3 — PLAN ANNOTÉ IA
  // ═══════════════════════════════════════════════════════════════════════

  b.newPage();
  b.drawSectionTitle("PLAN ANNOTE — DETECTION IA DES ELEMENTS");
  b.moveDown(6);

  // Légende couleurs
  const legendItems: [string, string][] = [
    ["Fenetre",     "#60a5fa"],
    ["Porte",       "#f472b6"],
    ["Balcon",      "#34d399"],
    ["Toiture",     "#a78bfa"],
    ["Colonne",     "#94a3b8"],
    ["Ligne etage", "#fb923c"],
  ];
  let lx = PAGE.MARGIN_X;
  for (const [lbl, hex] of legendItems) {
    if (lx + 80 > PAGE.W - PAGE.MARGIN_X) { b.moveDown(14); lx = PAGE.MARGIN_X; }
    const rv = parseInt(hex.slice(1,3),16)/255;
    const gv = parseInt(hex.slice(3,5),16)/255;
    const bv = parseInt(hex.slice(5,7),16)/255;
    b.page.drawRectangle({ x: lx, y: b.y - 2, width: 12, height: 8, color: { type: "RGB" as any, red: rv, green: gv, blue: bv } as any });
    b.page.drawText(safeTxt(lbl), { x: lx + 16, y: b.y, size: TYPO.CAPTION, font: b.font, color: C.DARK });
    lx += b.font.widthOfTextAtSize(lbl, TYPO.CAPTION) + 36;
  }
  b.moveDown(18);
  await embedImg(b, result.overlay_b64);

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 4 — PLAN BRUT (si différent de l'overlay)
  // ═══════════════════════════════════════════════════════════════════════

  if (result.plan_b64 && result.plan_b64 !== result.overlay_b64) {
    b.newPage();
    b.drawSectionTitle("PLAN BRUT — FACADE ORIGINALE");
    b.moveDown(6);
    await embedImg(b, result.plan_b64);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 5 — RÉCAPITULATIF PAR TYPE D'ÉLÉMENT
  // ═══════════════════════════════════════════════════════════════════════

  b.newPage();
  b.drawLotHeader("LOT 1 -- RECAPITULATIF PAR TYPE D'ELEMENT");
  b.moveDown(4);
  b.drawTableHeader(TYPE_SUMMARY_COLS, l);

  const typeOrder = ["window", "door", "balcony", "floor_line", "roof", "column", "other"];
  let grandCount = 0;
  let grandArea  = 0;

  for (const type of typeOrder) {
    const els = byType[type];
    if (!els || els.length === 0) continue;
    const totalArea = els.reduce((s, e) => s + (e.area_m2 ?? 0), 0);
    const pctFacade = result.facade_area_m2 && totalArea > 0
      ? `${((totalArea / result.facade_area_m2) * 100).toFixed(1)}%`
      : "—";
    grandCount += els.length;
    grandArea  += totalArea;
    b.drawTableRow(TYPE_SUMMARY_COLS, {
      type:  typeLabel(type),
      count: String(els.length),
      area:  totalArea > 0 ? totalArea.toFixed(2) : "—",
      pct:   pctFacade,
    });
  }

  b.drawTableTotalRow(TYPE_SUMMARY_COLS, {
    type:  "TOTAL",
    count: String(grandCount),
    area:  grandArea.toFixed(2),
    pct:   result.facade_area_m2 && grandArea > 0
      ? `${((grandArea / result.facade_area_m2) * 100).toFixed(1)}%`
      : "—",
  }, { bg: C.BLUE_PALE, color: C.BLUE });

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 6 — RÉPARTITION PAR ÉTAGE
  // ═══════════════════════════════════════════════════════════════════════

  if (floorLevels.length > 0) {
    b.newPage();
    b.drawLotHeader(`LOT 2 -- REPARTITION PAR ETAGE (${result.floors_count} niveau${result.floors_count > 1 ? "x" : ""})`);
    b.moveDown(4);
    b.drawTableHeader(FLOOR_COLS, l);

    let totWin = 0, totDoor = 0, totBal = 0, totFloorArea = 0;

    for (const level of floorLevels) {
      const els     = elements.filter(e => (e.floor_level ?? 0) === level);
      const winEls  = els.filter(e => e.type === "window");
      const dorEls  = els.filter(e => e.type === "door");
      const balEls  = els.filter(e => e.type === "balcony");
      const flArea  = [...winEls, ...dorEls, ...balEls].reduce((s, e) => s + (e.area_m2 ?? 0), 0);
      const label   = level === 0 ? "RDC" : `Etage ${level}`;

      totWin  += winEls.length;
      totDoor += dorEls.length;
      totBal  += balEls.length;
      totFloorArea += flArea;

      b.drawTableRow(FLOOR_COLS, {
        level:     label,
        windows:   String(winEls.length),
        doors:     String(dorEls.length),
        balconies: String(balEls.length),
        area:      flArea > 0 ? flArea.toFixed(2) : "—",
      });
    }

    b.drawTableTotalRow(FLOOR_COLS, {
      level:     "TOTAL",
      windows:   String(totWin),
      doors:     String(totDoor),
      balconies: String(totBal),
      area:      totFloorArea.toFixed(2),
    }, { bg: C.BLUE_PALE, color: C.BLUE });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 7 — DÉTAIL DE TOUS LES ÉLÉMENTS
  // ═══════════════════════════════════════════════════════════════════════

  if (elements.length > 0) {
    b.newPage();
    b.drawLotHeader(`LOT 3 -- DETAIL DES ELEMENTS (${elements.length} elements detectes)`);
    b.moveDown(4);
    b.drawTableHeader(ELEMENT_COLS, l);

    // Trier : par étage décroissant, puis par type
    const sorted = [...elements].sort((a, b) => {
      const la = a.floor_level ?? 0;
      const lb = b.floor_level ?? 0;
      if (lb !== la) return lb - la;
      return a.type.localeCompare(b.type);
    });

    for (const el of sorted) {
      const W = 1; // normalized
      const larg = ppm ? (el.bbox_norm.w / W).toFixed(3) : "—";
      const haut = ppm ? (el.bbox_norm.h / W).toFixed(3) : "—";
      b.drawTableRow(ELEMENT_COLS, {
        num:   String(el.id + 1),
        type:  typeLabel(el.type),
        etage: el.floor_level != null ? (el.floor_level === 0 ? "RDC" : `Etage ${el.floor_level}`) : "—",
        conf:  el.confidence != null ? `${(el.confidence * 100).toFixed(0)}%` : "—",
        larg,
        haut,
        area:  el.area_m2 != null ? el.area_m2.toFixed(3) : "—",
      });
    }

    // Total surface éléments
    const totalElArea = elements.reduce((s, e) => s + (e.area_m2 ?? 0), 0);
    b.drawTableTotalRow(ELEMENT_COLS, {
      num: "", type: "TOTAL", etage: "", conf: "",
      larg: "", haut: "",
      area: totalElArea.toFixed(2),
    }, { bg: C.BLUE_PALE, color: C.BLUE });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 8 — SURFACES DÉTAILLÉES
  // ═══════════════════════════════════════════════════════════════════════

  b.newPage();
  b.drawLotHeader("LOT 4 -- BILAN DES SURFACES");
  b.moveDown(6);

  const surfaceItems: [string, string, string][] = [
    ["Surface facade totale",  fmt2(result.facade_area_m2, " m2"), "ROI analyse"],
    ["Surface ouvertures",     fmt2(result.openings_area_m2, " m2"), "portes + fenetres + balcons"],
    ["Surface murale nette",   fmt2(wallArea, " m2"), "plein de mur"],
    ["Ratio ouvertures",       result.ratio_openings != null ? `${(result.ratio_openings * 100).toFixed(1)}%` : "—", "% surface facade"],
    ["Ratio mur plein",        result.ratio_openings != null ? `${((1 - result.ratio_openings) * 100).toFixed(1)}%` : "—", "% surface facade"],
    ["Fenetres — surface tot.", fmt2((byType["window"] ?? []).reduce((s, e) => s + (e.area_m2 ?? 0), 0), " m2"), `${result.windows_count} elements`],
    ["Portes — surface tot.",   fmt2((byType["door"]   ?? []).reduce((s, e) => s + (e.area_m2 ?? 0), 0), " m2"), `${result.doors_count} elements`],
    ["Balcons — surface tot.",  fmt2((byType["balcony"] ?? []).reduce((s, e) => s + (e.area_m2 ?? 0), 0), " m2"), `${result.balconies_count} elements`],
  ];

  for (let i = 0; i < surfaceItems.length; i++) {
    const [label, value, note] = surfaceItems[i];
    b.ensureSpace(26);
    if (i % 2 === 0) b.page.drawRectangle({ x: PAGE.MARGIN_X, y: b.y - 6, width: PAGE.TEXT_WIDTH, height: 22, color: C.BG_SUBTLE });
    b.page.drawText(safeTxt(label), { x: PAGE.MARGIN_X + 8,  y: b.y, size: TYPO.BODY, font: b.fontBold, color: C.DARK });
    b.page.drawText(safeTxt(value), { x: PAGE.MARGIN_X + 220, y: b.y, size: TYPO.BODY, font: b.fontBold, color: C.BLUE });
    b.page.drawText(safeTxt(note),  { x: PAGE.MARGIN_X + 310, y: b.y, size: TYPO.CAPTION, font: b.font,  color: C.GRAY_400 });
    b.moveDown(24);
  }

  // ── Sauvegarde ────────────────────────────────────────────────────────────

  const safeName = safeTxt((options.projectName || "facade").replace(/\s+/g, "_"));
  await b.saveAndDownload(`floorscan_facade_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
