"use client";

import type { AnalysisResult, CustomDetection } from "@/lib/types";
import { computeMetre } from "@/lib/metre-calculator";
import { buildDefaultDpgf } from "@/lib/dpgf-defaults";
import { runComplianceChecks } from "@/lib/compliance-checker";
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

export interface RapportOptions {
  projectName: string;
  projectAddress: string;
  clientName: string;
  companyName: string;
  date: string;
  ceilingHeight: number;
}

// ── Column definitions ───────────────────────────────────────────────────────

const ROOM_COLS: ColDef[] = [
  { key: "room",    label: "metre_room",      x: 52,  width: 130, align: "left" },
  { key: "floor",   label: "metre_floor",     x: 188, width: 58,  align: "right" },
  { key: "perim",   label: "metre_perim",     x: 250, width: 58,  align: "right" },
  { key: "walls",   label: "metre_walls_net", x: 312, width: 60,  align: "right" },
  { key: "ceiling", label: "metre_ceiling",   x: 376, width: 58,  align: "right" },
  { key: "doors",   label: "metre_doors",     x: 438, width: 44,  align: "right" },
  { key: "windows", label: "metre_windows",   x: 486, width: 44,  align: "right" },
];

const OPENING_COLS: ColDef[] = [
  { key: "num",  label: "N°",         x: 52,  width: 28,  align: "left" },
  { key: "type", label: "Type",       x: 84,  width: 110, align: "left" },
  { key: "larg", label: "Larg. (m)",  x: 198, width: 72,  align: "right" },
  { key: "haut", label: "Haut. (m)",  x: 274, width: 72,  align: "right" },
  { key: "long", label: "Long. (m)",  x: 350, width: 72,  align: "right" },
  { key: "area", label: "Surf. (m²)", x: 426, width: 72,  align: "right" },
];

const DETECT_COLS: ColDef[] = [
  { key: "label", label: "Detection",    x: 52,  width: 220, align: "left" },
  { key: "count", label: "Nb",           x: 276, width: 60,  align: "right" },
  { key: "area",  label: "Surface (m2)", x: 340, width: 90,  align: "right" },
];

const DPGF_SUM_COLS: ColDef[] = [
  { key: "lot",   label: "dpgf_desc",     x: 52,  width: 360, align: "left" },
  { key: "total", label: "dpgf_total_ht", x: 420, width: 118, align: "right" },
];

// Conformité : pas de colonne "status" dans drawTableRow — on la dessine manuellement
const COMPLIANCE_DATA_COLS: ColDef[] = [
  { key: "rule",   label: "Regle",   x: 108, width: 250, align: "left" },
  { key: "target", label: "Cible",   x: 362, width: 88,  align: "right" },
  { key: "actual", label: "Mesure",  x: 454, width: 84,  align: "right" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt2(v: number | null | undefined, suffix = ""): string {
  if (v == null) return "—";
  return v.toFixed(2) + suffix;
}

function openingTypeLabel(cls: string): string {
  if (cls === "french_door") return "Porte-fenetre";
  if (cls === "door")        return "Porte";
  return "Fenetre";
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

// ── Dessin d'une ligne de conformité (badge statut intégré proprement) ────────
function drawComplianceRow(b: PdfBuilder, check: {
  status: string; rule_key: string; target: string | number; actual: string | number;
}, l: Lang): void {
  b.ensureSpace(TABLE.ROW_HEIGHT + 10);

  const statusColor =
    check.status === "pass"    ? C.GREEN  :
    check.status === "fail"    ? C.RED    :
    check.status === "warning" ? C.AMBER  : C.GRAY_400;
  const statusPale =
    check.status === "pass"    ? C.GREEN_PALE  :
    check.status === "fail"    ? C.RED_PALE    :
    check.status === "warning" ? C.AMBER_PALE  : C.GRAY_100;
  const statusLabel =
    check.status === "pass"    ? "CONF." :
    check.status === "fail"    ? "FAIL"  :
    check.status === "warning" ? "ATTN"  : "N/A";

  const rowY = b.y - 4;
  const rowH = TABLE.ROW_HEIGHT;

  // Fond global alterné
  b.page.drawRectangle({ x: PAGE.MARGIN_X, y: rowY, width: PAGE.TEXT_WIDTH, height: rowH, color: C.BG_SUBTLE });

  // Badge statut — fond coloré pâle dans la cellule statut (x:52, width:52)
  b.page.drawRectangle({ x: 52, y: rowY, width: 52, height: rowH, color: statusPale });
  // Liseré gauche coloré
  b.page.drawRectangle({ x: PAGE.MARGIN_X, y: rowY, width: 3, height: rowH, color: statusColor });

  // Bordures extérieures
  b.page.drawRectangle({ x: PAGE.MARGIN_X, y: rowY, width: 0.75, height: rowH, color: C.GRAY_300 });
  b.page.drawRectangle({ x: PAGE.W - PAGE.MARGIN_X - 0.75, y: rowY, width: 0.75, height: rowH, color: C.GRAY_300 });

  // Séparateurs de colonnes
  const allCols = [{ x: 52, width: 52 }, ...COMPLIANCE_DATA_COLS];
  for (let i = 1; i < allCols.length; i++) {
    const prev = allCols[i - 1];
    const curr = allCols[i];
    b.page.drawRectangle({ x: Math.round((prev.x + prev.width + curr.x) / 2), y: rowY, width: 0.4, height: rowH, color: C.GRAY_200 });
  }

  // Texte badge statut
  b.page.drawText(statusLabel, {
    x: 57, y: b.y,
    size: TYPO.TABLE_CELL, font: b.fontBold, color: statusColor,
  });

  // Texte règle
  const ruleText = truncateText(d(check.rule_key, l), COMPLIANCE_DATA_COLS[0].width - 4, b.font, TYPO.TABLE_CELL);
  b.page.drawText(ruleText, {
    x: COMPLIANCE_DATA_COLS[0].x + 2, y: b.y,
    size: TYPO.TABLE_CELL, font: b.font, color: C.DARK,
  });

  // Cible
  const targetStr = safeTxt(String(check.target));
  b.page.drawText(targetStr, {
    x: COMPLIANCE_DATA_COLS[1].x + COMPLIANCE_DATA_COLS[1].width - b.font.widthOfTextAtSize(targetStr, TYPO.TABLE_CELL),
    y: b.y, size: TYPO.TABLE_CELL, font: b.font, color: C.GRAY_700,
  });

  // Mesuré (coloré par statut)
  const actualStr = safeTxt(String(check.actual));
  b.page.drawText(actualStr, {
    x: COMPLIANCE_DATA_COLS[2].x + COMPLIANCE_DATA_COLS[2].width - b.fontBold.widthOfTextAtSize(actualStr, TYPO.TABLE_CELL),
    y: b.y, size: TYPO.TABLE_CELL, font: b.fontBold, color: statusColor,
  });

  // Séparateur de rangée
  b.page.drawRectangle({ x: PAGE.MARGIN_X, y: rowY, width: PAGE.TEXT_WIDTH, height: 0.3, color: C.GRAY_200 });
  b.moveDown(rowH);
}

// ══════════════════════════════════════════════════════════════════════════════
// GÉNÉRATION DU RAPPORT
// ══════════════════════════════════════════════════════════════════════════════

export async function downloadRapportPdf(
  result: AnalysisResult,
  customDetections: CustomDetection[],
  lang: string,
  options: RapportOptions
): Promise<void> {
  const l        = lang as Lang;
  const dateStr  = fmtDate(options.date);
  const sf       = result.surfaces ?? {};
  const rooms    = result.rooms    ?? [];
  const openings = result.openings ?? [];
  const walls    = result.walls    ?? [];
  const ppm      = result.pixels_per_meter ?? 1;

  const metre      = computeMetre(result, { ceilingHeight: options.ceilingHeight });
  const dpgf       = buildDefaultDpgf(result, customDetections, { ceilingHeight: options.ceilingHeight });
  const compliance = runComplianceChecks(result, { ceilingHeight: options.ceilingHeight });

  const b = await PdfBuilder.create({
    docType:     "RAPPORT D'ANALYSE",
    docSubtitle: "Rapport d'analyse architecturale — FloorScan AI",
    dateStr,
    rightMeta:   options.projectName || undefined,
    lang: l,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 1 — COUVERTURE
  // ═══════════════════════════════════════════════════════════════════════

  b.drawCoverPage({
    title:    "RAPPORT D'ANALYSE ARCHITECTURALE",
    subtitle: "Analyse IA — Detection ouvertures, surfaces et conformite",
    infoLines: [
      ["Projet",       options.projectName    || "—"],
      ["Adresse",      options.projectAddress || "—"],
      ["Client",       options.clientName     || "—"],
      ["Entreprise",   options.companyName    || "—"],
      ["Date",         dateStr],
      ["Ref. session", result.session_id ? result.session_id.slice(0, 16) + "..." : "—"],
    ],
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 2 — SYNTHÈSE EXÉCUTIVE
  // ═══════════════════════════════════════════════════════════════════════

  b.newPage();
  b.drawSectionTitle("SYNTHESE EXECUTIVE");
  b.moveDown(8);

  drawKpiGrid(b, [
    { label: "Portes detectees",   value: String(result.doors_count ?? 0),   sub: "nb total" },
    { label: "Fenetres detectees", value: String(result.windows_count ?? 0), sub: "nb total" },
    ...(result.french_doors_count
      ? [{ label: "Portes-fenetres",  value: String(result.french_doors_count), sub: "nb total" }]
      : [{ label: "Pieces detectees", value: String(rooms.length),              sub: "nb total" }]),
    { label: "Surface habitable",  value: fmt2(sf.area_hab_m2, " m2"),        sub: "net" },
    { label: "Surface murs",       value: fmt2(sf.area_walls_m2, " m2"),      sub: "brut" },
    { label: "Emprise batiment",   value: fmt2(sf.area_building_m2, " m2"),   sub: "total" },
    { label: "Perimetre int.",     value: fmt2(sf.perim_interior_m, " m"),    sub: "lineaire" },
    { label: "Score conformite",   value: `${compliance.score_pct.toFixed(0)}%`, sub: `${compliance.pass_count}P / ${compliance.fail_count}F` },
    { label: "Estimation TTC",     value: dpgf.total_ttc != null ? `${Math.round(dpgf.total_ttc).toLocaleString("fr-FR")} EUR` : "N/A", sub: "estimation" },
  ]);

  b.moveDown(16);
  b.drawSectionTitle("INFORMATIONS PROJET");
  b.moveDown(4);

  const infoRows: [string, string][] = [
    ["Projet",               options.projectName    || "—"],
    ["Adresse",              options.projectAddress || "—"],
    ["Client",               options.clientName     || "—"],
    ["Entreprise",           options.companyName    || "—"],
    ["Date du rapport",      dateStr],
    ["Echelle (px/m)",       result.pixels_per_meter ? result.pixels_per_meter.toFixed(2) : "Non calibree"],
    ["Methode calibration",  result.scale_info?.method || "—"],
    ["Confiance echelle",    result.scale_info ? `${(result.scale_info.confidence * 100).toFixed(0)}%` : "—"],
    ["Accord sources",       result.scale_info?.agreement ? "Oui" : "Non"],
    ["Dimensions image",     result.img_w && result.img_h ? `${result.img_w} x ${result.img_h} px` : "—"],
    ["Ouvertures analysees", String(openings.length)],
    ["Segments de murs",     String(walls.length)],
  ];
  infoRows.forEach(([label, value], i) => drawInfoRow(b, label, value, i % 2 === 0));

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 3 — PLAN ANNOTÉ : OUVERTURES
  // ═══════════════════════════════════════════════════════════════════════

  const overlayB64 = result.overlay_openings_b64 || result.plan_b64;
  if (overlayB64) {
    b.newPage();
    b.drawSectionTitle("PLAN ANNOTE — OUVERTURES DETECTEES");
    b.moveDown(6);
    // Légende inline
    const legends: [string, string][] = [
      ["Portes",          "#CC00FF"],
      ["Fenetres",        "#00CCFF"],
      ...(result.mask_french_doors_b64 ? [["Portes-fenetres", "#FF7700"] as [string, string]] : []),
    ];
    let lx = PAGE.MARGIN_X;
    for (const [lbl, hex] of legends) {
      const rv = parseInt(hex.slice(1,3),16)/255;
      const gv = parseInt(hex.slice(3,5),16)/255;
      const bv = parseInt(hex.slice(5,7),16)/255;
      b.page.drawRectangle({ x: lx, y: b.y - 2, width: 12, height: 8, color: { type: "RGB" as any, red: rv, green: gv, blue: bv } as any });
      b.page.drawText(safeTxt(lbl), { x: lx + 16, y: b.y, size: TYPO.CAPTION, font: b.font, color: C.DARK });
      lx += b.font.widthOfTextAtSize(lbl, TYPO.CAPTION) + 36;
    }
    b.moveDown(18);
    await embedImg(b, overlayB64);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 4 — PLAN ANNOTÉ : PIÈCES COLORÉES
  // ═══════════════════════════════════════════════════════════════════════

  if (result.mask_rooms_b64) {
    b.newPage();
    b.drawSectionTitle("PLAN ANNOTE — PIECES ET SURFACES");
    b.moveDown(6);
    b.drawText(
      `${rooms.length} piece${rooms.length > 1 ? "s" : ""} detectee${rooms.length > 1 ? "s" : ""} — Surface totale : ${fmt2(sf.area_hab_m2, " m2")}`,
      { size: TYPO.BODY, color: C.GRAY_500 }
    );
    b.moveDown(14);
    await embedImg(b, result.mask_rooms_b64);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 5 — PLAN ANNOTÉ : SURFACE INTÉRIEURE
  // ═══════════════════════════════════════════════════════════════════════

  if (result.overlay_interior_b64) {
    b.newPage();
    b.drawSectionTitle("PLAN ANNOTE — SURFACE INTERIEURE");
    b.moveDown(6);
    await embedImg(b, result.overlay_interior_b64);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 6 — TABLEAU MÉTRÉ DES PIÈCES
  // ═══════════════════════════════════════════════════════════════════════

  if (metre.rooms.length > 0) {
    b.newPage();
    b.drawLotHeader(`LOT 1 -- METRE DES PIECES (${metre.rooms.length} pieces)`);
    b.moveDown(4);
    b.drawTableHeader(ROOM_COLS, l);

    for (const r of metre.rooms) {
      b.drawTableRow(ROOM_COLS, {
        room:    r.room_label,
        floor:   r.floor_area_m2.toFixed(2),
        perim:   r.perimeter_m.toFixed(2),
        walls:   r.wall_area_net_m2.toFixed(2),
        ceiling: r.ceiling_area_m2.toFixed(2),
        doors:   String(r.doors_count),
        windows: String(r.windows_count),
      });
    }

    b.drawTableTotalRow(ROOM_COLS, {
      room:    "TOTAL GENERAL",
      floor:   metre.totals.floor_area_m2.toFixed(2),
      perim:   metre.totals.perimeter_m.toFixed(2),
      walls:   metre.totals.wall_area_net_m2.toFixed(2),
      ceiling: metre.totals.ceiling_area_m2.toFixed(2),
      doors:   String(metre.totals.doors_count),
      windows: String(metre.totals.windows_count),
    }, { bg: C.BLUE_PALE, color: C.BLUE });

    b.moveDown(8);
    b.drawText(
      `Note : hauteur de plafond retenue = ${options.ceilingHeight} m. Surfaces nettes deduites des ouvertures.`,
      { size: TYPO.CAPTION, color: C.GRAY_400 }
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 7 — DÉTAIL DES OUVERTURES
  // ═══════════════════════════════════════════════════════════════════════

  if (openings.length > 0) {
    b.newPage();
    const doors       = openings.filter(o => o.class === "door");
    const windows     = openings.filter(o => o.class === "window");
    const frenchDoors = openings.filter(o => o.class === "french_door");
    b.drawLotHeader(`LOT 2 -- DETAIL DES OUVERTURES (${openings.length} elements)`);
    b.moveDown(4);

    const subItems: [string, string][] = [
      ["Portes",      `${doors.length} element${doors.length > 1 ? "s" : ""}`],
      ["Fenetres",    `${windows.length} element${windows.length > 1 ? "s" : ""}`],
      ...(frenchDoors.length > 0 ? [["Portes-fenetres", `${frenchDoors.length} element${frenchDoors.length > 1 ? "s" : ""}`] as [string, string]] : []),
    ];
    subItems.forEach(([lbl, val], i) => drawInfoRow(b, lbl, val, i % 2 === 0));
    b.moveDown(8);

    b.drawTableHeader(OPENING_COLS, l);
    openings.forEach((o, i) => {
      const area_m2 = o.area_px2 / (ppm * ppm);
      b.drawTableRow(OPENING_COLS, {
        num:  String(i + 1),
        type: openingTypeLabel(o.class),
        larg: o.width_m  != null ? o.width_m.toFixed(2)  : fmt2(o.width_px  / ppm),
        haut: o.height_m != null ? o.height_m.toFixed(2) : fmt2(o.height_px / ppm),
        long: o.length_m != null ? o.length_m.toFixed(2) : fmt2(o.length_px / ppm),
        area: area_m2.toFixed(3),
      });
    });

    b.drawTableTotalRow(OPENING_COLS, {
      num: "", type: "TOTAL", larg: "", haut: "", long: "",
      area: openings.reduce((s, o) => s + o.area_px2 / (ppm * ppm), 0).toFixed(2),
    }, { bg: C.BLUE_PALE, color: C.BLUE });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 8 — SEGMENTS DE MURS
  // ═══════════════════════════════════════════════════════════════════════

  if (walls.length > 0 && result.pixels_per_meter) {
    b.newPage();
    const totalLen = walls.reduce((s, w) => s + (w.length_m ?? 0), 0);
    b.drawLotHeader(`LOT 3 -- SEGMENTS DE MURS (${walls.length} segments — ${totalLen.toFixed(1)} m lin.)`);
    b.moveDown(4);

    const SEG_COLS: ColDef[] = [
      { key: "n1", label: "N°", x: 52,  width: 28, align: "left" }, { key: "l1", label: "Long.", x: 82,  width: 60, align: "right" },
      { key: "n2", label: "N°", x: 160, width: 28, align: "left" }, { key: "l2", label: "Long.", x: 190, width: 60, align: "right" },
      { key: "n3", label: "N°", x: 268, width: 28, align: "left" }, { key: "l3", label: "Long.", x: 298, width: 60, align: "right" },
      { key: "n4", label: "N°", x: 376, width: 28, align: "left" }, { key: "l4", label: "Long.", x: 406, width: 60, align: "right" },
    ];
    b.drawTableHeader(SEG_COLS, l);

    for (let ci = 0; ci < Math.min(Math.ceil(walls.length / 4), 60); ci++) {
      const chunk = walls.slice(ci * 4, ci * 4 + 4);
      const row: Record<string, string> = {};
      for (let j = 0; j < 4; j++) {
        const seg = chunk[j];
        row[`n${j+1}`] = seg ? String(ci * 4 + j + 1) : "";
        row[`l${j+1}`] = seg ? (seg.length_m != null ? seg.length_m.toFixed(2) + " m" : "—") : "";
      }
      b.drawTableRow(SEG_COLS, row);
    }
    if (walls.length > 240) {
      b.moveDown(6);
      b.drawText(`... et ${walls.length - 240} segments supplementaires non affiches.`, { size: TYPO.CAPTION, color: C.GRAY_400 });
    }
    b.drawTableTotalRow(SEG_COLS, {
      n1: "TOTAL", l1: `${totalLen.toFixed(2)} m`, n2: "", l2: "", n3: "", l3: "", n4: "", l4: "",
    }, { bg: C.BLUE_PALE, color: C.BLUE });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 9 — CLOISONS & MURS
  // ═══════════════════════════════════════════════════════════════════════

  if (result.mask_cloisons_b64 || result.mask_walls_pixel_b64) {
    b.newPage();
    b.drawLotHeader("LOT 4 -- CLOISONS ET MURS");
    b.moveDown(6);
    if (result.mask_walls_pixel_b64) {
      b.drawText("Murs detectes (apres edition)", { size: TYPO.BODY, font: b.fontBold, color: C.GRAY_700 });
      b.moveDown(10);
      await embedImg(b, result.mask_walls_pixel_b64, 0.38);
      b.moveDown(12);
    }
    if (result.mask_cloisons_b64) {
      b.drawText("Cloisons interieures", { size: TYPO.BODY, font: b.fontBold, color: C.GRAY_700 });
      b.moveDown(10);
      await embedImg(b, result.mask_cloisons_b64, 0.38);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 10 — DÉTECTIONS CUSTOM
  // ═══════════════════════════════════════════════════════════════════════

  if (customDetections.length > 0) {
    b.newPage();
    b.drawLotHeader(`LOT 5 -- DETECTIONS PERSONNALISEES (${customDetections.length} type${customDetections.length > 1 ? "s" : ""})`);
    b.moveDown(4);
    b.drawTableHeader(DETECT_COLS, l);

    let grandTotalCount = 0;
    let grandTotalArea  = 0;
    for (const det of customDetections) {
      grandTotalCount += det.count;
      grandTotalArea  += det.total_area_m2 ?? 0;
      b.drawTableRow(DETECT_COLS, {
        label: det.label,
        count: String(det.count),
        area:  det.total_area_m2 != null ? det.total_area_m2.toFixed(2) : "—",
      });
    }
    b.drawTableTotalRow(DETECT_COLS, {
      label: "TOTAL", count: String(grandTotalCount), area: grandTotalArea.toFixed(2),
    }, { bg: C.BLUE_PALE, color: C.BLUE });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 11 — ESTIMATION DPGF
  // ═══════════════════════════════════════════════════════════════════════

  if (dpgf.lots.length > 0) {
    b.newPage();
    b.drawLotHeader("LOT 6 -- ESTIMATION BUDGETAIRE (DPGF SIMPLIFIE)");
    b.moveDown(4);
    b.drawStamp("ESTIMATIF — A titre indicatif uniquement");
    b.moveDown(4);
    b.drawTableHeader(DPGF_SUM_COLS, l);
    for (const lot of dpgf.lots) {
      b.drawTableRow(DPGF_SUM_COLS, {
        lot:   `${lot.lot_number}. ${d(lot.title_key, l)}`,
        total: fmtPrice(lot.subtotal_ht),
      });
    }
    b.drawGrandTotals(dpgf.total_ht, dpgf.tva_rate, dpgf.tva_amount, dpgf.total_ttc, l);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 12 — VÉRIFICATION DE CONFORMITÉ (bug badge corrigé)
  // ═══════════════════════════════════════════════════════════════════════

  b.newPage();
  b.drawLotHeader("LOT 7 -- VERIFICATION DE CONFORMITE REGLEMENTAIRE");
  b.moveDown(8);

  b.drawScoreBadge(`Score : ${compliance.score_pct.toFixed(0)}%`, compliance.score_pct);

  // Mini-grille 4 résumés
  b.ensureSpace(46);
  const cw = (PAGE.TEXT_WIDTH - 18) / 4;
  [
    { label: "Conformes",       value: String(compliance.pass_count), col: C.GREEN  },
    { label: "Non conformes",   value: String(compliance.fail_count), col: C.RED    },
    { label: "Avertissements",  value: String(compliance.warn_count), col: C.AMBER  },
    { label: "Non applicables", value: String(compliance.na_count),   col: C.GRAY_500 },
  ].forEach((item, c) => {
    const cx = PAGE.MARGIN_X + c * (cw + 6);
    const cy = b.y - 40;
    b.page.drawRectangle({ x: cx, y: cy, width: cw, height: 40, color: C.GRAY_100, borderColor: item.col, borderWidth: 1.5 });
    b.page.drawText(safeTxt(item.value), { x: cx + 8, y: cy + 22, size: 14,          font: b.fontBold, color: item.col });
    b.page.drawText(safeTxt(item.label), { x: cx + 8, y: cy + 8,  size: TYPO.CAPTION, font: b.font,    color: C.GRAY_500 });
  });
  b.moveDown(52);

  // En-tête tableau conformité (dessiné manuellement pour 4 colonnes)
  const ALL_COLS = [{ x: 52, width: 52, label: "Statut" }, ...COMPLIANCE_DATA_COLS];
  const hdrY = b.y - 4;
  const hdrH = TABLE.HEADER_ROW_HEIGHT;
  b.page.drawRectangle({ x: PAGE.MARGIN_X, y: hdrY + hdrH, width: PAGE.TEXT_WIDTH, height: 0.75, color: C.BLUE });
  b.page.drawRectangle({ x: PAGE.MARGIN_X, y: hdrY,        width: PAGE.TEXT_WIDTH, height: hdrH,  color: C.BLUE });
  for (let i = 1; i < ALL_COLS.length; i++) {
    const prev = ALL_COLS[i - 1];
    const curr = ALL_COLS[i];
    b.page.drawRectangle({ x: Math.round((prev.x + prev.width + curr.x) / 2), y: hdrY, width: 0.5, height: hdrH, color: C.BLUE_MED });
  }
  for (const col of ALL_COLS) {
    b.page.drawText(safeTxt(col.label), { x: col.x + 2, y: b.y, size: TYPO.TABLE_HEADER, font: b.fontBold, color: C.WHITE });
  }
  b.moveDown(hdrH + 2);

  // Lignes de conformité avec badge intégré proprement
  for (const check of compliance.checks) {
    drawComplianceRow(b, check, l);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 13 — CALIBRATION
  // ═══════════════════════════════════════════════════════════════════════

  if (result.scale_info) {
    b.newPage();
    b.drawSectionTitle("CALIBRATION DE L'ECHELLE");
    b.moveDown(6);

    const si = result.scale_info;
    ([
      ["Pixels par metre",     si.ppm != null ? si.ppm.toFixed(2) + " px/m" : "Non calibree"],
      ["Methode principale",   si.method],
      ["Niveau de confiance",  `${(si.confidence * 100).toFixed(0)}%`],
      ["Accord multi-sources", si.agreement ? "Oui — sources coherentes" : "Non — ecart detecte"],
      ["Nombre de sources",    String(si.sources?.length ?? 0)],
    ] as [string, string][]).forEach(([lbl, val], i) => drawInfoRow(b, lbl, val, i % 2 === 0));

    if (si.sources?.length) {
      b.moveDown(12);
      b.drawSectionTitle("SOURCES DE CALIBRATION");
      b.moveDown(4);
      const SRC_COLS: ColDef[] = [
        { key: "src",    label: "Source",    x: 52,  width: 120, align: "left" },
        { key: "ppm",    label: "px/m",      x: 176, width: 80,  align: "right" },
        { key: "conf",   label: "Confiance", x: 260, width: 80,  align: "right" },
        { key: "detail", label: "Detail",    x: 344, width: 190, align: "left" },
      ];
      b.drawTableHeader(SRC_COLS, l);
      for (const src of si.sources) {
        b.drawTableRow(SRC_COLS, {
          src:    src.source,
          ppm:    src.ppm.toFixed(1),
          conf:   `${(src.confidence * 100).toFixed(0)}%`,
          detail: src.detail,
        });
      }
    }
  }

  // ── Sauvegarde ────────────────────────────────────────────────────────────

  const safeName = safeTxt(options.projectName?.replace(/\s+/g, "_") || "projet");
  await b.saveAndDownload(`floorscan_rapport_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
