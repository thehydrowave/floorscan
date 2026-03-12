"use client";

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "pdf-lib";
import type { MetreResult, RoomMetre } from "@/lib/metre-calculator";
import { dt, DTKey } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";

// ── Constants ────────────────────────────────────────────────────────────────

const W = 595.28;
const H = 841.89;
const HEADER_HEIGHT = 70;
const FOOTER_HEIGHT = 36;
const MARGIN_X = 30; // Tighter margins for wide table
const MARGIN_BOTTOM = 60;
const ROW_HEIGHT = 15;

const BLUE = rgb(0.055, 0.647, 0.914);
const WHITE = rgb(1, 1, 1);
const DARK = rgb(0.18, 0.22, 0.3);
const GRAY = rgb(0.6, 0.65, 0.72);
const LIGHT_GRAY = rgb(0.39, 0.46, 0.54);
const BG_SUBTLE = rgb(0.97, 0.99, 1);
const VIOLET = rgb(0.55, 0.33, 0.97);

// ── Column layout ───────────────────────────────────────────────────────────

interface ColDef {
  key: string;
  label: string;
  x: number;
  width: number;
  integer?: boolean;
}

const COL_ROOM_X = 30;
const COLS: ColDef[] = [
  { key: "floor_area_m2", label: "metre_floor", x: 135, width: 48 },
  { key: "perimeter_m", label: "metre_perim", x: 183, width: 44 },
  { key: "wall_area_gross_m2", label: "metre_walls_gross", x: 227, width: 54 },
  { key: "openings_area_m2", label: "metre_openings", x: 281, width: 52 },
  { key: "wall_area_net_m2", label: "metre_walls_net", x: 333, width: 52 },
  { key: "ceiling_area_m2", label: "metre_ceiling", x: 385, width: 50 },
  { key: "plinth_length_m", label: "metre_plinth", x: 435, width: 50 },
  { key: "doors_count", label: "metre_doors", x: 490, width: 35, integer: true },
  { key: "windows_count", label: "metre_windows", x: 530, width: 35, integer: true },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function d(key: string, lang: Lang): string {
  try {
    return dt(key as DTKey, lang);
  } catch {
    console.warn(`[i18n] Missing key: ${key}`);
    return key;
  }
}

function fmt(n: number, integer?: boolean): string {
  return integer ? String(n) : n.toFixed(2);
}

function truncate(text: string, f: PDFFont, size: number, maxW: number): string {
  let t = text;
  while (t.length > 0 && f.widthOfTextAtSize(t, size) > maxW) {
    t = t.slice(0, -1);
  }
  if (t.length < text.length && t.length > 3) {
    t = t.slice(0, -3) + "...";
  }
  return t;
}

// ── PDF Generation ───────────────────────────────────────────────────────────

export async function downloadMetrePdf(
  metre: MetreResult,
  lang: string,
  ceilingHeight: number,
  filename?: string
): Promise<void> {
  const l = lang as Lang;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdfDoc.addPage([W, H]);
  let y = H;
  let pageNum = 1;

  // ── Drawing helpers ─────────────────────────────────────────────────────────

  function drawWhiteBg(p: PDFPage) {
    p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE });
  }

  function drawHeader(p: PDFPage) {
    p.drawRectangle({
      x: 0,
      y: H - HEADER_HEIGHT,
      width: W,
      height: HEADER_HEIGHT,
      color: BLUE,
    });
    p.drawText("FloorScan", {
      x: 30,
      y: H - 42,
      size: 22,
      font: fontBold,
      color: WHITE,
    });
    p.drawText(d("metre_title", l), {
      x: 30,
      y: H - 60,
      size: 10,
      font,
      color: rgb(0.9, 0.97, 1),
    });
    const dateStr = new Date().toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    p.drawText(dateStr, {
      x: W - 160,
      y: H - 42,
      size: 9,
      font,
      color: WHITE,
    });
    p.drawText(`H = ${ceilingHeight.toFixed(2)} m`, {
      x: W - 160,
      y: H - 56,
      size: 8,
      font,
      color: rgb(0.85, 0.95, 1),
    });
  }

  function drawFooter(p: PDFPage, num: number) {
    p.drawRectangle({
      x: 0,
      y: 0,
      width: W,
      height: FOOTER_HEIGHT,
      color: BG_SUBTLE,
    });
    const footerText = "FloorScan \u00B7 " + d("metre_pdf_footer", l);
    p.drawText(footerText, {
      x: 30,
      y: 13,
      size: 8,
      font,
      color: GRAY,
    });
    p.drawText(`Page ${num}`, {
      x: W - 60,
      y: 13,
      size: 8,
      font,
      color: GRAY,
    });
  }

  function ensureSpace(needed: number) {
    if (y < needed + MARGIN_BOTTOM) {
      drawFooter(page, pageNum);
      pageNum++;
      page = pdfDoc.addPage([W, H]);
      drawWhiteBg(page);
      drawHeader(page);
      y = H - HEADER_HEIGHT - 20;
    }
  }

  // ── Page 1 setup ──────────────────────────────────────────────────────────

  drawWhiteBg(page);
  drawHeader(page);
  y = H - HEADER_HEIGHT - 25;

  // Subtitle
  page.drawText(d("metre_subtitle", l), {
    x: MARGIN_X,
    y,
    size: 10,
    font,
    color: LIGHT_GRAY,
  });
  y -= 22;

  // ── Table header ──────────────────────────────────────────────────────────

  page.drawRectangle({
    x: MARGIN_X,
    y: y - 3,
    width: W - 2 * MARGIN_X,
    height: ROW_HEIGHT + 2,
    color: BLUE,
  });

  // Room column header
  page.drawText(d("metre_room", l), {
    x: COL_ROOM_X + 4,
    y,
    size: 7,
    font: fontBold,
    color: WHITE,
  });

  // Data column headers
  for (const col of COLS) {
    const label = d(col.label, l);
    const displayLabel = truncate(label, fontBold, 7, col.width - 4);
    page.drawText(displayLabel, {
      x: col.x,
      y,
      size: 7,
      font: fontBold,
      color: WHITE,
    });
  }
  y -= ROW_HEIGHT + 4;

  // ── Table rows ────────────────────────────────────────────────────────────

  function drawRow(row: RoomMetre, isBold: boolean) {
    ensureSpace(ROW_HEIGHT + 10);

    const f = isBold ? fontBold : font;
    const textColor = isBold ? VIOLET : DARK;

    // Room name
    const roomLabel = truncate(row.room_label, f, 8, 95);
    page.drawText(roomLabel, {
      x: COL_ROOM_X + 4,
      y,
      size: 8,
      font: f,
      color: textColor,
    });

    // Data cells
    for (const col of COLS) {
      const v = (row as unknown as Record<string, number>)[col.key] ?? 0;
      page.drawText(fmt(v, col.integer), {
        x: col.x,
        y,
        size: 8,
        font: f,
        color: isBold ? textColor : DARK,
      });
    }

    y -= ROW_HEIGHT;
  }

  // Data rows
  for (let i = 0; i < metre.rooms.length; i++) {
    // Alternating background
    if (i % 2 === 0) {
      page.drawRectangle({
        x: MARGIN_X,
        y: y - 3,
        width: W - 2 * MARGIN_X,
        height: ROW_HEIGHT,
        color: BG_SUBTLE,
      });
    }
    drawRow(metre.rooms[i], false);
  }

  // Totals row
  y -= 2;
  ensureSpace(ROW_HEIGHT + 20);
  page.drawRectangle({
    x: MARGIN_X,
    y: y - 3,
    width: W - 2 * MARGIN_X,
    height: ROW_HEIGHT + 2,
    color: rgb(0.93, 0.9, 1),
  });
  drawRow(metre.totals, true);

  // ── Finalize ──────────────────────────────────────────────────────────────

  drawFooter(page, pageNum);

  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes as unknown as ArrayBuffer], {
    type: "application/pdf",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "floorscan_metre.pdf";
  a.click();
  URL.revokeObjectURL(url);
}
