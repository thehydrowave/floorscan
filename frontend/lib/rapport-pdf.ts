"use client";

import type { AnalysisResult, CustomDetection, Opening } from "@/lib/types";
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
  { key: "room",    label: "metre_room",       x: 50,  width: 120, align: "left" },
  { key: "floor",   label: "metre_floor",      x: 178, width: 60,  align: "right" },
  { key: "perim",   label: "metre_perim",      x: 244, width: 60,  align: "right" },
  { key: "walls",   label: "metre_walls_net",  x: 310, width: 60,  align: "right" },
  { key: "ceiling", label: "metre_ceiling",    x: 376, width: 60,  align: "right" },
  { key: "doors",   label: "metre_doors",      x: 442, width: 40,  align: "right" },
  { key: "windows", label: "metre_windows",    x: 488, width: 40,  align: "right" },
];

const OPENING_COLS: ColDef[] = [
  { key: "num",    label: "N°",         x: 50,  width: 30,  align: "left" },
  { key: "type",   label: "Type",       x: 86,  width: 100, align: "left" },
  { key: "larg",   label: "Larg. (m)",  x: 190, width: 70,  align: "right" },
  { key: "haut",   label: "Haut. (m)",  x: 264, width: 70,  align: "right" },
  { key: "long",   label: "Long. (m)",  x: 338, width: 70,  align: "right" },
  { key: "area",   label: "Surface (m²)", x: 410, width: 80, align: "right" },
];

const WALL_COLS: ColDef[] = [
  { key: "num",    label: "N°",         x: 50,  width: 30,  align: "left" },
  { key: "length", label: "Longueur (m)", x: 86, width: 100, align: "right" },
];

const DETECT_COLS: ColDef[] = [
  { key: "label",  label: "Détection",     x: 50,  width: 180, align: "left" },
  { key: "count",  label: "Nb",            x: 234, width: 50,  align: "right" },
  { key: "area",   label: "Surface (m²)",  x: 288, width: 90,  align: "right" },
];

const DPGF_SUM_COLS: ColDef[] = [
  { key: "lot",   label: "dpgf_desc",     x: 50,  width: 360, align: "left" },
  { key: "total", label: "dpgf_total_ht", x: 420, width: 120, align: "right" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt2(v: number | null | undefined, suffix = "") {
  if (v == null) return "—";
  return v.toFixed(2) + suffix;
}

function openingTypeLabel(cls: string): string {
  if (cls === "french_door") return "Porte-fenêtre";
  if (cls === "door") return "Porte";
  return "Fenêtre";
}

// ── PDF Generation ───────────────────────────────────────────────────────────

export async function downloadRapportPdf(
  result: AnalysisResult,
  customDetections: CustomDetection[],
  lang: string,
  options: RapportOptions
): Promise<void> {
  const l = lang as Lang;
  const dateStr = fmtDate(options.date);
  const sf = result.surfaces ?? {};
  const rooms = result.rooms ?? [];
  const openings = result.openings ?? [];
  const walls = result.walls ?? [];

  const metre = computeMetre(result, { ceilingHeight: options.ceilingHeight });
  const dpgf = buildDefaultDpgf(result, customDetections, { ceilingHeight: options.ceilingHeight });
  const compliance = runComplianceChecks(result, { ceilingHeight: options.ceilingHeight });

  const b = await PdfBuilder.create({
    docType: d("rap_cover_title", l),
    docSubtitle: d("rap_cover_title", l),
    dateStr,
    rightMeta: options.projectName || undefined,
    lang: l,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 1 : Couverture
  // ═══════════════════════════════════════════════════════════════════════

  b.drawCoverPage({
    title: d("rap_cover_title", l),
    subtitle: safeTxt(options.projectName || ""),
    infoLines: [
      [d("rap_project", l),  options.projectName  || "--"],
      [d("rap_address", l),  options.projectAddress || "--"],
      [d("rap_client", l),   options.clientName   || "--"],
      [d("rap_company", l),  options.companyName  || "--"],
      [d("rap_date", l),     dateStr],
    ],
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 2 : KPIs récapitulatifs
  // ═══════════════════════════════════════════════════════════════════════

  b.newPage();
  b.drawSectionTitle(d("rap_summary", l));

  const kpis: [string, string][] = [
    ["Portes détectées",          String(result.doors_count ?? 0)],
    ["Fenêtres détectées",        String(result.windows_count ?? 0)],
    ...(result.french_doors_count ? [["Portes-fenêtres détectées", String(result.french_doors_count)] as [string, string]] : []),
    ["Pièces détectées",          String(rooms.length)],
    ["Ouvertures détaillées",     String(openings.length)],
    ["Segments de murs",          String(walls.length)],
    ["Surface habitable",         fmt2(sf.area_hab_m2, " m²")],
    ["Surface murs",              fmt2(sf.area_walls_m2, " m²")],
    ["Emprise bâtiment",          fmt2(sf.area_building_m2, " m²")],
    ["Périmètre bâtiment",        fmt2(sf.perim_building_m, " m")],
    ["Périmètre intérieur",       fmt2(sf.perim_interior_m, " m")],
    ["Échelle (px/m)",            result.pixels_per_meter ? result.pixels_per_meter.toFixed(2) : "N/A"],
    ...(result.img_w && result.img_h ? [["Dimensions image", `${result.img_w} × ${result.img_h} px`] as [string, string]] : []),
    ["Score conformité",          `${compliance.score_pct.toFixed(0)}% (${compliance.pass_count}P / ${compliance.fail_count}F / ${compliance.warn_count}W)`],
    ["Estimation coût TTC",       dpgf.total_ttc != null ? `${dpgf.total_ttc.toFixed(0)} EUR` : "N/A"],
    ...(customDetections.length > 0 ? [["Détections custom", String(customDetections.length)] as [string, string]] : []),
  ];

  for (let i = 0; i < kpis.length; i++) {
    const [label, value] = kpis[i];
    if (i % 2 === 0) {
      b.page.drawRectangle({ x: PAGE.MARGIN_X, y: b.y - 8, width: PAGE.TEXT_WIDTH, height: 26, color: C.BG_SUBTLE });
    }
    b.page.drawText(safeTxt(label), { x: PAGE.MARGIN_X + 8, y: b.y, size: 10, font: b.font, color: C.DARK });
    b.page.drawText(safeTxt(value), {
      x: PAGE.W - PAGE.MARGIN_X - b.fontBold.widthOfTextAtSize(safeTxt(value), 11) - 8,
      y: b.y, size: 11, font: b.fontBold, color: C.BLUE,
    });
    b.moveDown(28);
    b.ensureSpace(28);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 3 : Plan annoté — overlay ouvertures
  // ═══════════════════════════════════════════════════════════════════════

  const overlayB64 = result.overlay_openings_b64 || result.plan_b64;
  if (overlayB64) {
    b.newPage();
    b.drawSectionTitle("Plan annoté — Ouvertures détectées");
    await _embedImage(b, overlayB64);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 4 : Plan annoté — overlay intérieur (si disponible)
  // ═══════════════════════════════════════════════════════════════════════

  if (result.overlay_interior_b64) {
    b.newPage();
    b.drawSectionTitle("Plan annoté — Surface intérieure");
    await _embedImage(b, result.overlay_interior_b64);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 5 : Plan annoté — masque des pièces colorées (si disponible)
  // ═══════════════════════════════════════════════════════════════════════

  if (result.mask_rooms_b64) {
    b.newPage();
    b.drawSectionTitle("Plan annoté — Pièces colorées");
    await _embedImage(b, result.mask_rooms_b64);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 6 : Tableau des pièces (métré)
  // ═══════════════════════════════════════════════════════════════════════

  if (metre.rooms.length > 0) {
    b.newPage();
    b.drawSectionTitle(d("rap_rooms_table", l));
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

    const t = metre.totals;
    b.drawTableTotalRow(ROOM_COLS, {
      room:    "TOTAL",
      floor:   t.floor_area_m2.toFixed(2),
      perim:   t.perimeter_m.toFixed(2),
      walls:   t.wall_area_net_m2.toFixed(2),
      ceiling: t.ceiling_area_m2.toFixed(2),
      doors:   String(t.doors_count),
      windows: String(t.windows_count),
    }, { bg: C.VIOLET_PALE, color: C.VIOLET });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 7 : Détail des ouvertures (portes, fenêtres, portes-fenêtres)
  // ═══════════════════════════════════════════════════════════════════════

  if (openings.length > 0) {
    b.newPage();
    b.drawSectionTitle("Détail des ouvertures");

    // Sous-totaux par type
    const doors       = openings.filter(o => o.class === "door");
    const windows     = openings.filter(o => o.class === "window");
    const frenchDoors = openings.filter(o => o.class === "french_door");

    const summaryLines: [string, string][] = [
      [`Portes (${doors.length})`,           fmt2(doors.reduce((s, o) => s + (o.area_px2 / Math.pow(result.pixels_per_meter ?? 1, 2)), 0), " m²")],
      [`Fenêtres (${windows.length})`,        fmt2(windows.reduce((s, o) => s + (o.area_px2 / Math.pow(result.pixels_per_meter ?? 1, 2)), 0), " m²")],
      ...(frenchDoors.length > 0 ? [[`Portes-fenêtres (${frenchDoors.length})`, fmt2(frenchDoors.reduce((s, o) => s + (o.area_px2 / Math.pow(result.pixels_per_meter ?? 1, 2)), 0), " m²")] as [string, string]] : []),
    ];

    for (const [label, value] of summaryLines) {
      b.page.drawText(safeTxt(label), { x: PAGE.MARGIN_X + 8, y: b.y, size: 10, font: b.font, color: C.DARK });
      b.page.drawText(safeTxt(value), {
        x: PAGE.W - PAGE.MARGIN_X - b.fontBold.widthOfTextAtSize(safeTxt(value), 10) - 8,
        y: b.y, size: 10, font: b.fontBold, color: C.BLUE,
      });
      b.moveDown(22);
    }
    b.moveDown(8);

    b.drawTableHeader(OPENING_COLS, l);
    openings.forEach((o, i) => {
      const ppm = result.pixels_per_meter ?? 1;
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
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 8 : Segments de murs (si disponibles et calibrés)
  // ═══════════════════════════════════════════════════════════════════════

  if (walls.length > 0 && result.pixels_per_meter) {
    b.newPage();
    b.drawSectionTitle("Segments de murs détectés");

    const totalWallLength = walls.reduce((s, w) => s + (w.length_m ?? 0), 0);
    b.page.drawText(`${walls.length} segments · Longueur totale : ${totalWallLength.toFixed(2)} m`, {
      x: PAGE.MARGIN_X, y: b.y, size: TYPO.BODY, font: b.font, color: C.GRAY_500,
    });
    b.moveDown(24);

    b.drawTableHeader(WALL_COLS, l);
    walls.slice(0, 80).forEach((w, i) => {
      b.drawTableRow(WALL_COLS, {
        num:    String(i + 1),
        length: w.length_m != null ? w.length_m.toFixed(2) + " m" : "—",
      });
    });
    if (walls.length > 80) {
      b.moveDown(8);
      b.drawText(`… et ${walls.length - 80} segments supplémentaires`, { color: C.GRAY_400, size: TYPO.CAPTION });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 9 : Masques additionnels (cloisons, murs pixel) si disponibles
  // ═══════════════════════════════════════════════════════════════════════

  if (result.mask_cloisons_b64 || result.mask_walls_pixel_b64) {
    b.newPage();
    b.drawSectionTitle("Masques — Cloisons & Murs");

    if (result.mask_walls_pixel_b64) {
      b.drawText("Murs (édités)", { size: TYPO.BODY, color: C.GRAY_500 });
      b.moveDown(10);
      await _embedImage(b, result.mask_walls_pixel_b64, 0.45);
      b.moveDown(16);
    }
    if (result.mask_cloisons_b64) {
      b.drawText("Cloisons", { size: TYPO.BODY, color: C.GRAY_500 });
      b.moveDown(10);
      await _embedImage(b, result.mask_cloisons_b64, 0.45);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 10 : Détections custom (Visual Search)
  // ═══════════════════════════════════════════════════════════════════════

  if (customDetections.length > 0) {
    b.newPage();
    b.drawSectionTitle("Détections personnalisées (Visual Search)");

    b.drawTableHeader(DETECT_COLS, l);
    let grandTotal = 0;
    for (const det of customDetections) {
      const area = det.total_area_m2 ?? 0;
      grandTotal += area;
      b.drawTableRow(DETECT_COLS, {
        label: det.label,
        count: String(det.count),
        area:  det.total_area_m2 != null ? det.total_area_m2.toFixed(2) : "—",
      });
    }
    b.drawTableTotalRow(DETECT_COLS, {
      label: "TOTAL",
      count: String(customDetections.reduce((s, d) => s + d.count, 0)),
      area:  grandTotal.toFixed(2),
    }, { bg: C.BG_SUBTLE, color: C.BLUE });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 11 : Calibration / Échelle
  // ═══════════════════════════════════════════════════════════════════════

  if (result.scale_info) {
    const si = result.scale_info;
    b.newPage();
    b.drawSectionTitle("Calibration de l'échelle");

    const scaleLines: [string, string][] = [
      ["Pixels/mètre",    si.ppm != null ? si.ppm.toFixed(2) : "N/A"],
      ["Méthode",         si.method],
      ["Confiance",       `${(si.confidence * 100).toFixed(0)}%`],
      ["Accord sources",  si.agreement ? "Oui" : "Non"],
      ["Nb sources",      String(si.sources?.length ?? 0)],
    ];
    for (let i = 0; i < scaleLines.length; i++) {
      const [label, value] = scaleLines[i];
      if (i % 2 === 0) {
        b.page.drawRectangle({ x: PAGE.MARGIN_X, y: b.y - 8, width: PAGE.TEXT_WIDTH, height: 26, color: C.BG_SUBTLE });
      }
      b.page.drawText(safeTxt(label), { x: PAGE.MARGIN_X + 8, y: b.y, size: 10, font: b.font, color: C.DARK });
      b.page.drawText(safeTxt(value), {
        x: PAGE.W - PAGE.MARGIN_X - b.fontBold.widthOfTextAtSize(safeTxt(value), 11) - 8,
        y: b.y, size: 11, font: b.fontBold, color: C.BLUE,
      });
      b.moveDown(28);
    }

    if (si.sources?.length) {
      b.moveDown(8);
      b.drawText("Sources de calibration :", { size: TYPO.BODY, color: C.DARK });
      b.moveDown(18);
      for (const src of si.sources) {
        b.drawText(`• ${src.source} — ${src.ppm.toFixed(1)} px/m (conf. ${(src.confidence * 100).toFixed(0)}%) — ${src.detail}`, {
          size: TYPO.CAPTION, color: C.GRAY_500,
        });
        b.moveDown(16);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 12 : DPGF récapitulatif
  // ═══════════════════════════════════════════════════════════════════════

  if (dpgf.lots.length > 0) {
    b.newPage();
    b.drawSectionTitle(d("rap_dpgf_summary", l));
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
  // PAGE 13 : Conformité
  // ═══════════════════════════════════════════════════════════════════════

  b.newPage();
  b.drawSectionTitle(d("rap_compliance", l));
  b.drawScoreBadge(`Score: ${compliance.score_pct.toFixed(0)}%`, compliance.score_pct);
  b.drawText(`${compliance.pass_count} pass | ${compliance.fail_count} fail | ${compliance.warn_count} warning | ${compliance.na_count} N/A`, {
    size: TYPO.BODY, color: C.GRAY_500,
  });
  b.moveDown(20);

  for (const check of compliance.checks) {
    b.ensureSpace(TABLE.ROW_HEIGHT + 10);
    const statusColor = check.status === "pass" ? C.GREEN : check.status === "fail" ? C.RED : check.status === "warning" ? C.AMBER : C.GRAY_400;
    const statusLabel = check.status === "pass" ? "OK" : check.status === "fail" ? "KO" : check.status === "warning" ? "ATT" : "N/A";

    b.page.drawText(statusLabel, { x: PAGE.MARGIN_X + 4, y: b.y, size: TYPO.TABLE_CELL, font: b.fontBold, color: statusColor });
    b.page.drawText(truncateText(d(check.rule_key, l), 300, b.font, TYPO.TABLE_CELL), {
      x: PAGE.MARGIN_X + 40, y: b.y, size: TYPO.TABLE_CELL, font: b.font, color: C.DARK,
    });
    b.page.drawText(safeTxt(`${check.target} | ${check.actual}`), {
      x: PAGE.W - PAGE.MARGIN_X - 140, y: b.y, size: TYPO.CAPTION, font: b.font, color: C.GRAY_500,
    });
    b.moveDown(TABLE.ROW_HEIGHT);
  }

  // ── Sauvegarde & téléchargement ──────────────────────────────────────

  const safeName = safeTxt(options.projectName?.replace(/\s+/g, "_") || "projet");
  await b.saveAndDownload(`floorscan_rapport_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ── Embed PNG image helper ────────────────────────────────────────────────────

async function _embedImage(b: PdfBuilder, b64: string, heightRatio = 0.85): Promise<void> {
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const img = await b.pdf.embedPng(bytes);
    const maxW = PAGE.TEXT_WIDTH;
    const maxH = (PAGE.H - 160) * heightRatio;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const iw = img.width * scale;
    const ih = img.height * scale;
    b.page.drawImage(img, {
      x: (PAGE.W - iw) / 2,
      y: b.y - ih,
      width: iw,
      height: ih,
    });
    b.moveDown(ih + 12);
  } catch {
    b.drawText("(Image non disponible)", { color: C.GRAY_400 });
    b.moveDown(20);
  }
}
