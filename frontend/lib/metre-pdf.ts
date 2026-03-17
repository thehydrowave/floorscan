"use client";

import type { MetreResult, RoomMetre } from "@/lib/metre-calculator";
import type { Lang } from "@/lib/i18n";
import {
  PdfBuilder,
  PAGE,
  TABLE,
  TYPO,
  C,
  d,
  fmtDate,
  truncateText,
  type ColDef,
} from "@/lib/pdf-theme";

// ── Column layout (9 data columns, tighter for wide table) ───────────────────

const COL_ROOM_X = 50;

const METRE_COLS: ColDef[] = [
  { key: "floor_area_m2",     label: "metre_floor",        x: 148, width: 46, align: "right" }, // ends 194
  { key: "perimeter_m",       label: "metre_perim",        x: 196, width: 44, align: "right" }, // ends 240
  { key: "wall_area_gross_m2",label: "metre_walls_gross",  x: 242, width: 47, align: "right" }, // ends 289
  { key: "openings_area_m2",  label: "metre_openings",     x: 291, width: 43, align: "right" }, // ends 334
  { key: "wall_area_net_m2",  label: "metre_walls_net",    x: 336, width: 45, align: "right" }, // ends 381
  { key: "ceiling_area_m2",   label: "metre_ceiling",      x: 383, width: 45, align: "right" }, // ends 428
  { key: "plinth_length_m",   label: "metre_plinth",       x: 430, width: 43, align: "right" }, // ends 473
  { key: "doors_count",       label: "metre_doors",        x: 475, width: 35, align: "right", integer: true }, // ends 510
  { key: "windows_count",     label: "metre_windows",      x: 512, width: 35, align: "right", integer: true }, // ends 547 ✓
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, integer?: boolean): string {
  return integer ? String(Math.round(n)) : n.toFixed(2);
}

function rowValues(row: RoomMetre): Record<string, string> {
  const vals: Record<string, string> = {};
  for (const col of METRE_COLS) {
    const v = (row as unknown as Record<string, number>)[col.key] ?? 0;
    vals[col.key] = fmt(v, col.integer);
  }
  return vals;
}

// ── PDF Generation ───────────────────────────────────────────────────────────

export async function downloadMetrePdf(
  metre: MetreResult,
  lang: string,
  ceilingHeight: number,
  filename?: string
): Promise<void> {
  const l = lang as Lang;
  const dateStr = fmtDate();

  const b = await PdfBuilder.create({
    docType: d("metre_title", l),
    docSubtitle: d("metre_title", l),
    dateStr,
    rightMeta: `H = ${ceilingHeight.toFixed(2)} m`,
    lang: l,
  });

  // ── Page 1 ──────────────────────────────────────────────────────────────

  b.newPage();

  // Subtitle
  b.drawText(d("metre_subtitle", l), { size: 10, color: C.GRAY_700 });
  b.moveDown(22);

  // ── Table header ────────────────────────────────────────────────────────

  // Custom header because we have a "Room" column + 9 data columns
  b.page.drawRectangle({
    x: PAGE.MARGIN_X,
    y: b.y - 4,
    width: PAGE.TEXT_WIDTH,
    height: TABLE.HEADER_ROW_HEIGHT,
    color: C.BLUE,
  });

  // Room column header
  b.page.drawText(d("metre_room", l), {
    x: COL_ROOM_X + 4,
    y: b.y,
    size: TYPO.TABLE_HEADER,
    font: b.fontBold,
    color: C.WHITE,
  });

  // Data column headers
  for (const col of METRE_COLS) {
    const label = d(col.label, l);
    const displayLabel = truncateText(label, col.width - 4, b.fontBold, TYPO.TABLE_HEADER);
    const textX = col.x + col.width - b.fontBold.widthOfTextAtSize(displayLabel, TYPO.TABLE_HEADER);
    b.page.drawText(displayLabel, {
      x: textX,
      y: b.y,
      size: TYPO.TABLE_HEADER,
      font: b.fontBold,
      color: C.WHITE,
    });
  }
  b.moveDown(TABLE.HEADER_ROW_HEIGHT + 4);

  // ── Data rows ───────────────────────────────────────────────────────────

  for (let i = 0; i < metre.rooms.length; i++) {
    b.ensureSpace(TABLE.ROW_HEIGHT + 10);

    const room = metre.rooms[i];

    // Alternating background
    if (i % 2 === 0) {
      b.page.drawRectangle({
        x: PAGE.MARGIN_X,
        y: b.y - 4,
        width: PAGE.TEXT_WIDTH,
        height: TABLE.ROW_HEIGHT,
        color: C.BG_SUBTLE,
      });
    }

    // Room name
    const roomLabel = truncateText(room.room_label, 90, b.font, TYPO.TABLE_CELL);
    b.page.drawText(roomLabel, {
      x: COL_ROOM_X + 4,
      y: b.y,
      size: TYPO.TABLE_CELL,
      font: b.font,
      color: C.DARK,
    });

    // Data cells
    const vals = rowValues(room);
    for (const col of METRE_COLS) {
      const v = vals[col.key] ?? "";
      const textX = col.x + col.width - b.font.widthOfTextAtSize(v, TYPO.TABLE_CELL);
      b.page.drawText(v, {
        x: textX,
        y: b.y,
        size: TYPO.TABLE_CELL,
        font: b.font,
        color: C.DARK,
      });
    }

    b.moveDown(TABLE.ROW_HEIGHT);
  }

  // ── Totals row ──────────────────────────────────────────────────────────

  b.moveDown(2);
  b.ensureSpace(TABLE.TOTAL_ROW_HEIGHT + 20);

  b.page.drawRectangle({
    x: PAGE.MARGIN_X,
    y: b.y - 5,
    width: PAGE.TEXT_WIDTH,
    height: TABLE.TOTAL_ROW_HEIGHT,
    color: C.VIOLET_PALE,
  });

  // Total label
  const totalLabel = "TOTAL";
  b.page.drawText(totalLabel, {
    x: COL_ROOM_X + 4,
    y: b.y,
    size: TYPO.TABLE_TOTAL,
    font: b.fontBold,
    color: C.VIOLET,
  });

  // Total values
  const totVals = rowValues(metre.totals);
  for (const col of METRE_COLS) {
    const v = totVals[col.key] ?? "";
    const textX = col.x + col.width - b.fontBold.widthOfTextAtSize(v, TYPO.TABLE_TOTAL);
    b.page.drawText(v, {
      x: textX,
      y: b.y,
      size: TYPO.TABLE_TOTAL,
      font: b.fontBold,
      color: C.VIOLET,
    });
  }

  // ── Save ────────────────────────────────────────────────────────────────

  await b.saveAndDownload(filename || "floorscan_metre.pdf");
}
