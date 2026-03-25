"use client";

import type { MetreResult, RoomMetre } from "@/lib/metre-calculator";
import type { Lang } from "@/lib/i18n";
import type { PDFPage } from "pdf-lib";
import {
  PdfBuilder,
  PAGE,
  TABLE,
  TYPO,
  C,
  d,
  fmtDate,
  fmtQty,
  truncateText,
  safeTxt,
  type ColDef,
} from "@/lib/pdf-theme";

// ── Column layout ─────────────────────────────────────────────────────────────

const COL_ROOM_X = 52;

const METRE_COLS: ColDef[] = [
  { key: "floor_area_m2",      label: "metre_floor",       x: 150, width: 46, align: "right" },
  { key: "perimeter_m",        label: "metre_perim",       x: 198, width: 44, align: "right" },
  { key: "wall_area_gross_m2", label: "metre_walls_gross", x: 244, width: 47, align: "right" },
  { key: "openings_area_m2",   label: "metre_openings",    x: 293, width: 43, align: "right" },
  { key: "wall_area_net_m2",   label: "metre_walls_net",   x: 338, width: 45, align: "right" },
  { key: "ceiling_area_m2",    label: "metre_ceiling",     x: 385, width: 45, align: "right" },
  { key: "plinth_length_m",    label: "metre_plinth",      x: 432, width: 43, align: "right" },
  { key: "doors_count",        label: "metre_doors",       x: 477, width: 35, align: "right", integer: true },
  { key: "windows_count",      label: "metre_windows",     x: 514, width: 33, align: "right", integer: true },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, integer?: boolean): string {
  return integer ? String(Math.round(n)) : fmtQty(n);
}

function rowValues(row: RoomMetre): Record<string, string> {
  const vals: Record<string, string> = {};
  for (const col of METRE_COLS) {
    const v = (row as unknown as Record<string, number>)[col.key] ?? 0;
    vals[col.key] = fmt(v, col.integer);
  }
  return vals;
}

function drawColSeparators(page: PDFPage, rowY: number, rowH: number): void {
  page.drawRectangle({ x: PAGE.MARGIN_X, y: rowY, width: 0.75, height: rowH, color: C.GRAY_300 });
  page.drawRectangle({ x: PAGE.W - PAGE.MARGIN_X - 0.75, y: rowY, width: 0.75, height: rowH, color: C.GRAY_300 });
  const roomSepX = Math.round((COL_ROOM_X + 96 + METRE_COLS[0].x) / 2);
  page.drawRectangle({ x: roomSepX, y: rowY, width: 0.4, height: rowH, color: C.GRAY_200 });
  for (let i = 1; i < METRE_COLS.length; i++) {
    const prev = METRE_COLS[i - 1];
    const curr = METRE_COLS[i];
    page.drawRectangle({ x: Math.round((prev.x + prev.width + curr.x) / 2), y: rowY, width: 0.4, height: rowH, color: C.GRAY_200 });
  }
}

// ── PDF Generation ────────────────────────────────────────────────────────────

export async function downloadMetrePdf(
  metre: MetreResult,
  lang: string,
  ceilingHeight: number,
  projectName?: string,
  filename?: string
): Promise<void> {
  const l = lang as Lang;
  const dateStr = fmtDate();

  const b = await PdfBuilder.create({
    docType: "METRE",
    docSubtitle: d("metre_title", l),
    dateStr,
    rightMeta: projectName || undefined,
    lang: l,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 1 — COUVERTURE
  // ═══════════════════════════════════════════════════════════════════════

  b.drawCoverPage({
    title:    "DOCUMENT DE METRE",
    subtitle: "Releve de surfaces, perimetres et ouvertures par piece",
    infoLines: [
      ["Projet",             projectName || "—"],
      ["Date",               dateStr],
      ["Hauteur de plafond", `${ceilingHeight.toFixed(2)} m`],
      ["Nombre de pieces",   String(metre.rooms.length)],
      ["Surface plancher",   `${metre.totals.floor_area_m2.toFixed(2)} m²`],
      ["Surface murs nets",  `${metre.totals.wall_area_net_m2.toFixed(2)} m²`],
      ["Surface plafonds",   `${metre.totals.ceiling_area_m2.toFixed(2)} m²`],
    ],
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 2 — TABLEAU DE MÉTRÉ
  // ═══════════════════════════════════════════════════════════════════════

  b.newPage();

  // Lot header navy
  b.drawLotHeader(`LOT UNIQUE -- METRE DES PIECES (${metre.rooms.length} pieces)`);
  b.moveDown(4);

  // Note méthodologique
  b.drawText(
    `Surfaces calculees avec H = ${ceilingHeight.toFixed(2)} m. Murs nets deduits des ouvertures. Surfaces en m², lineaires en m.`,
    { size: TYPO.CAPTION, color: C.GRAY_400 }
  );
  b.moveDown(12);

  // ── En-tête de tableau ───────────────────────────────────────────────────

  const headerY = b.y - 4;
  const headerH = TABLE.HEADER_ROW_HEIGHT;

  b.page.drawRectangle({ x: PAGE.MARGIN_X, y: headerY + headerH, width: PAGE.TEXT_WIDTH, height: 0.75, color: C.BLUE });
  b.page.drawRectangle({ x: PAGE.MARGIN_X, y: headerY, width: PAGE.TEXT_WIDTH, height: headerH, color: C.BLUE });

  drawColSeparators(b.page, headerY, headerH);

  // Colonne pièce
  b.page.drawText(d("metre_room", l), {
    x: COL_ROOM_X + 4, y: b.y,
    size: TYPO.TABLE_HEADER, font: b.fontBold, color: C.WHITE,
  });

  // Colonnes données
  for (const col of METRE_COLS) {
    const label = d(col.label, l);
    const displayLabel = truncateText(label, col.width - 4, b.fontBold, TYPO.TABLE_HEADER);
    b.page.drawText(displayLabel, {
      x: col.x + col.width - b.fontBold.widthOfTextAtSize(displayLabel, TYPO.TABLE_HEADER),
      y: b.y,
      size: TYPO.TABLE_HEADER, font: b.fontBold, color: C.WHITE,
    });
  }
  b.moveDown(headerH + 4);

  // ── Lignes de données ─────────────────────────────────────────────────────

  for (let i = 0; i < metre.rooms.length; i++) {
    b.ensureSpace(TABLE.ROW_HEIGHT + 10);

    const room  = metre.rooms[i];
    const rowY  = b.y - 4;
    const rowH  = TABLE.ROW_HEIGHT;

    if (i % 2 === 0) {
      b.page.drawRectangle({ x: PAGE.MARGIN_X, y: rowY, width: PAGE.TEXT_WIDTH, height: rowH, color: C.BG_SUBTLE });
    }

    drawColSeparators(b.page, rowY, rowH);

    b.page.drawText(truncateText(room.room_label, 90, b.font, TYPO.TABLE_CELL), {
      x: COL_ROOM_X + 4, y: b.y,
      size: TYPO.TABLE_CELL, font: b.font, color: C.DARK,
    });

    const vals = rowValues(room);
    for (const col of METRE_COLS) {
      const v = vals[col.key] ?? "";
      b.page.drawText(v, {
        x: col.x + col.width - b.font.widthOfTextAtSize(v, TYPO.TABLE_CELL),
        y: b.y,
        size: TYPO.TABLE_CELL, font: b.font, color: C.DARK,
      });
    }

    b.page.drawRectangle({ x: PAGE.MARGIN_X, y: rowY, width: PAGE.TEXT_WIDTH, height: 0.3, color: C.GRAY_200 });
    b.moveDown(rowH);
  }

  // ── Ligne totaux ──────────────────────────────────────────────────────────

  b.moveDown(2);
  b.ensureSpace(TABLE.TOTAL_ROW_HEIGHT + 20);

  const totRowY = b.y - 5;
  const totRowH = TABLE.TOTAL_ROW_HEIGHT;

  b.page.drawRectangle({ x: PAGE.MARGIN_X, y: totRowY, width: PAGE.TEXT_WIDTH, height: totRowH, color: C.BLUE_PALE });
  b.page.drawRectangle({ x: PAGE.MARGIN_X, y: totRowY, width: 4, height: totRowH, color: C.BLUE });
  drawColSeparators(b.page, totRowY, totRowH);
  b.page.drawRectangle({ x: PAGE.MARGIN_X, y: totRowY, width: PAGE.TEXT_WIDTH, height: 0.75, color: C.GRAY_300 });

  b.page.drawText("TOTAL GENERAL", {
    x: COL_ROOM_X + 8, y: b.y,
    size: TYPO.TABLE_TOTAL, font: b.fontBold, color: C.BLUE,
  });

  const totVals = rowValues(metre.totals);
  for (const col of METRE_COLS) {
    const v = totVals[col.key] ?? "";
    b.page.drawText(v, {
      x: col.x + col.width - b.fontBold.widthOfTextAtSize(v, TYPO.TABLE_TOTAL),
      y: b.y,
      size: TYPO.TABLE_TOTAL, font: b.fontBold, color: C.BLUE,
    });
  }
  b.moveDown(totRowH + 10);

  // ── Note de bas de page ───────────────────────────────────────────────────

  b.drawSectionSeparator();
  b.moveDown(6);
  b.drawText("Legende des colonnes :", { size: TYPO.CAPTION, font: b.fontBold, color: C.GRAY_700 });
  b.moveDown(12);

  const legend: [string, string][] = [
    ["Sol",       "Surface de plancher brute (m²)"],
    ["Perim.",    "Perimetre de la piece (m)"],
    ["Murs B.",   "Surface murs brute avant deduction ouvertures (m²)"],
    ["Ouv.",      "Surface des ouvertures (portes + fenetres) (m²)"],
    ["Murs N.",   "Surface murs nette — murs B. moins ouv. (m²)"],
    ["Plafond",   "Surface de plafond (m²)"],
    ["Plinthe",   "Lineaire de plinthe (m)"],
    ["P.",        "Nombre de portes"],
    ["F.",        "Nombre de fenetres"],
  ];

  const colW = (PAGE.TEXT_WIDTH - 8) / 3;
  for (let i = 0; i < legend.length; i += 3) {
    b.ensureSpace(14);
    for (let j = 0; j < 3; j++) {
      const item = legend[i + j];
      if (!item) continue;
      const lx = PAGE.MARGIN_X + j * (colW + 4);
      b.page.drawText(safeTxt(`${item[0]} : ${item[1]}`), {
        x: lx, y: b.y,
        size: TYPO.CAPTION, font: b.font, color: C.GRAY_500,
      });
    }
    b.moveDown(12);
  }

  // ── Sauvegarde ────────────────────────────────────────────────────────────

  await b.saveAndDownload(filename || "floorscan_metre.pdf");
}
