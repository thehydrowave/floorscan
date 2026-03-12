"use client";

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "pdf-lib";
import { DpgfState } from "@/lib/types";
import { dt, DTKey } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";

// ── Constants ────────────────────────────────────────────────────────────────

const W = 595.28;
const H = 841.89;
const HEADER_HEIGHT = 70;
const FOOTER_HEIGHT = 36;
const MARGIN_X = 50;
const MARGIN_BOTTOM = 60;
const ROW_HEIGHT = 16;

// Brand blue (same as export-mock.ts)
const BLUE = rgb(0.055, 0.647, 0.914);
const WHITE = rgb(1, 1, 1);
const DARK = rgb(0.18, 0.22, 0.3);
const GRAY = rgb(0.6, 0.65, 0.72);
const LIGHT_GRAY = rgb(0.39, 0.46, 0.54);
const BG_SUBTLE = rgb(0.97, 0.99, 1);
const AMBER = rgb(0.85, 0.55, 0.05);
const LOT_HEADER_BG = rgb(0.055, 0.647, 0.914);

// Column positions for the table
const COL_DESC = 50;
const COL_QTY = 350;
const COL_UNIT = 400;
const COL_PU = 440;
const COL_TOTAL = 510;

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtQty(n: number): string {
  return n.toFixed(2);
}

function fmtPrice(n: number): string {
  return n.toFixed(2) + " \u20AC";
}

/**
 * Translate a key using the i18n dictionary.
 * Falls back to the raw key if no translation is found.
 */
function d(key: string, lang: Lang): string {
  try {
    return dt(key as DTKey, lang);
  } catch {
    return key;
  }
}

// ── PDF Generation ───────────────────────────────────────────────────────────

export async function downloadDpgfPdf(
  dpgf: DpgfState,
  lang: string,
  filename?: string
): Promise<void> {
  const l = lang as Lang;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // ── State ────────────────────────────────────────────────────────────────
  let page: PDFPage = pdfDoc.addPage([W, H]);
  let y = H;
  let pageNum = 1;
  const pages: PDFPage[] = [page];

  // ── Draw functions ───────────────────────────────────────────────────────

  function drawWhiteBg(p: PDFPage) {
    p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE });
  }

  function drawHeader(p: PDFPage) {
    // Blue band
    p.drawRectangle({
      x: 0,
      y: H - HEADER_HEIGHT,
      width: W,
      height: HEADER_HEIGHT,
      color: BLUE,
    });
    // Logo text
    p.drawText("FloorScan", {
      x: 40,
      y: H - 42,
      size: 22,
      font: fontBold,
      color: WHITE,
    });
    // Subtitle
    p.drawText(d("dpgf_title", l), {
      x: 40,
      y: H - 60,
      size: 10,
      font,
      color: rgb(0.9, 0.97, 1),
    });
    // Right side — date
    const dateStr = dpgf.date || new Date().toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    p.drawText(dateStr, {
      x: W - 200,
      y: H - 42,
      size: 9,
      font,
      color: WHITE,
    });
    // Right side — project name
    if (dpgf.project_name) {
      const nameText =
        dpgf.project_name.length > 30
          ? dpgf.project_name.slice(0, 30) + "..."
          : dpgf.project_name;
      p.drawText(nameText, {
        x: W - 200,
        y: H - 56,
        size: 8,
        font,
        color: rgb(0.85, 0.95, 1),
      });
    }
  }

  function drawFooter(p: PDFPage, num: number) {
    p.drawRectangle({
      x: 0,
      y: 0,
      width: W,
      height: FOOTER_HEIGHT,
      color: BG_SUBTLE,
    });
    const footerText = "FloorScan \u00B7 " + d("dpgf_pdf_footer", l);
    p.drawText(footerText, {
      x: 40,
      y: 13,
      size: 8,
      font,
      color: GRAY,
    });
    p.drawText(`Page ${num}`, {
      x: W - 70,
      y: 13,
      size: 8,
      font,
      color: GRAY,
    });
  }

  /**
   * Ensures there is enough vertical space left on the current page.
   * If not, draws the footer, creates a new page, draws the header,
   * and resets the y cursor.
   */
  function ensureSpace(needed: number) {
    if (y < needed + MARGIN_BOTTOM) {
      // Close current page
      drawFooter(page, pageNum);
      // New page
      pageNum++;
      page = pdfDoc.addPage([W, H]);
      pages.push(page);
      drawWhiteBg(page);
      drawHeader(page);
      y = H - HEADER_HEIGHT - 20;
    }
  }

  /**
   * Truncate text to fit within a given max width using the given font/size.
   */
  function truncateText(
    text: string,
    maxWidth: number,
    f: PDFFont,
    size: number
  ): string {
    let t = text;
    while (t.length > 0 && f.widthOfTextAtSize(t, size) > maxWidth) {
      t = t.slice(0, -1);
    }
    if (t.length < text.length && t.length > 3) {
      t = t.slice(0, -3) + "...";
    }
    return t;
  }

  // ── Page 1 setup ─────────────────────────────────────────────────────────

  drawWhiteBg(page);
  drawHeader(page);
  y = H - HEADER_HEIGHT - 30;

  // ── Project info section ─────────────────────────────────────────────────

  if (dpgf.project_name) {
    page.drawText(d("dpgf_project", l) + " :", {
      x: MARGIN_X,
      y,
      size: 10,
      font,
      color: LIGHT_GRAY,
    });
    page.drawText(dpgf.project_name, {
      x: MARGIN_X + 130,
      y,
      size: 10,
      font: fontBold,
      color: DARK,
    });
    y -= 18;
  }

  if (dpgf.project_address) {
    page.drawText(d("dpgf_address", l) + " :", {
      x: MARGIN_X,
      y,
      size: 10,
      font,
      color: LIGHT_GRAY,
    });
    page.drawText(dpgf.project_address, {
      x: MARGIN_X + 130,
      y,
      size: 10,
      font,
      color: DARK,
    });
    y -= 18;
  }

  // Date
  {
    const dateLabel = "Date :";
    const dateVal = dpgf.date || new Date().toLocaleDateString("fr-FR");
    page.drawText(dateLabel, {
      x: MARGIN_X,
      y,
      size: 10,
      font,
      color: LIGHT_GRAY,
    });
    page.drawText(dateVal, {
      x: MARGIN_X + 130,
      y,
      size: 10,
      font,
      color: DARK,
    });
    y -= 24;
  }

  // "Estimatif — prix indicatifs" stamp
  {
    const stampText = d("dpgf_wip", l);
    const stampWidth = fontBold.widthOfTextAtSize(stampText, 11) + 20;
    page.drawRectangle({
      x: MARGIN_X,
      y: y - 4,
      width: stampWidth,
      height: 20,
      color: rgb(1, 0.96, 0.88),
      borderColor: AMBER,
      borderWidth: 1,
    });
    page.drawText(stampText, {
      x: MARGIN_X + 10,
      y: y + 2,
      size: 11,
      font: fontBold,
      color: AMBER,
    });
    y -= 36;
  }

  // ── Lot tables ───────────────────────────────────────────────────────────

  for (const lot of dpgf.lots) {
    // Skip empty lots (no items)
    if (!lot.items || lot.items.length === 0) continue;

    // Space needed: lot header (24) + table header (20) + at least 1 row (16) + subtotal (20) = ~80
    ensureSpace(80);

    // Lot header rectangle
    page.drawRectangle({
      x: MARGIN_X,
      y: y - 4,
      width: W - 2 * MARGIN_X,
      height: 22,
      color: LOT_HEADER_BG,
    });
    const lotTitle = `LOT ${lot.lot_number} \u2014 ${d(lot.title_key, l)}`;
    page.drawText(lotTitle, {
      x: MARGIN_X + 8,
      y: y + 3,
      size: 11,
      font: fontBold,
      color: WHITE,
    });
    y -= 28;

    // Table header row
    page.drawRectangle({
      x: MARGIN_X,
      y: y - 3,
      width: W - 2 * MARGIN_X,
      height: ROW_HEIGHT,
      color: BG_SUBTLE,
    });
    page.drawText(d("dpgf_desc", l), {
      x: COL_DESC + 4,
      y,
      size: 8,
      font: fontBold,
      color: LIGHT_GRAY,
    });
    page.drawText(d("dpgf_qty", l), {
      x: COL_QTY,
      y,
      size: 8,
      font: fontBold,
      color: LIGHT_GRAY,
    });
    page.drawText(d("dpgf_unit", l), {
      x: COL_UNIT,
      y,
      size: 8,
      font: fontBold,
      color: LIGHT_GRAY,
    });
    page.drawText(d("dpgf_pu_ht", l), {
      x: COL_PU,
      y,
      size: 8,
      font: fontBold,
      color: LIGHT_GRAY,
    });
    page.drawText(d("dpgf_total_line", l), {
      x: COL_TOTAL,
      y,
      size: 8,
      font: fontBold,
      color: LIGHT_GRAY,
    });
    y -= ROW_HEIGHT + 2;

    // Item rows
    for (const item of lot.items) {
      ensureSpace(ROW_HEIGHT + 20);

      // Alternating subtle background for readability
      const descText = truncateText(
        d(item.description_key, l),
        COL_QTY - COL_DESC - 10,
        font,
        9
      );
      page.drawText(descText, {
        x: COL_DESC + 4,
        y,
        size: 9,
        font,
        color: DARK,
      });
      page.drawText(fmtQty(item.quantity), {
        x: COL_QTY,
        y,
        size: 9,
        font,
        color: DARK,
      });
      page.drawText(item.unit, {
        x: COL_UNIT,
        y,
        size: 9,
        font,
        color: DARK,
      });
      page.drawText(fmtPrice(item.unit_price), {
        x: COL_PU,
        y,
        size: 9,
        font,
        color: DARK,
      });
      page.drawText(fmtPrice(item.total_ht), {
        x: COL_TOTAL,
        y,
        size: 9,
        font,
        color: DARK,
      });
      y -= ROW_HEIGHT;
    }

    // Subtotal row
    y -= 2;
    page.drawRectangle({
      x: MARGIN_X,
      y: y - 3,
      width: W - 2 * MARGIN_X,
      height: ROW_HEIGHT,
      color: rgb(0.93, 0.96, 1),
    });
    page.drawText(d("dpgf_subtotal", l), {
      x: COL_DESC + 4,
      y,
      size: 9,
      font: fontBold,
      color: BLUE,
    });
    page.drawText(fmtPrice(lot.subtotal_ht), {
      x: COL_TOTAL,
      y,
      size: 9,
      font: fontBold,
      color: BLUE,
    });
    y -= ROW_HEIGHT + 12;
  }

  // ── Totals section ───────────────────────────────────────────────────────

  ensureSpace(80);

  // Separator line
  page.drawRectangle({
    x: MARGIN_X,
    y: y + 4,
    width: W - 2 * MARGIN_X,
    height: 1.5,
    color: BLUE,
  });
  y -= 8;

  // Total HT
  page.drawText(d("dpgf_total_ht", l), {
    x: COL_PU - 50,
    y,
    size: 10,
    font: fontBold,
    color: DARK,
  });
  page.drawText(fmtPrice(dpgf.total_ht), {
    x: COL_TOTAL,
    y,
    size: 10,
    font: fontBold,
    color: DARK,
  });
  y -= 20;

  // TVA
  const tvaLabel = `${d("dpgf_tva", l)} (${dpgf.tva_rate}%)`;
  page.drawText(tvaLabel, {
    x: COL_PU - 50,
    y,
    size: 10,
    font,
    color: LIGHT_GRAY,
  });
  page.drawText(fmtPrice(dpgf.tva_amount), {
    x: COL_TOTAL,
    y,
    size: 10,
    font,
    color: LIGHT_GRAY,
  });
  y -= 22;

  // Total TTC (bold, larger)
  page.drawRectangle({
    x: COL_PU - 60,
    y: y - 6,
    width: W - MARGIN_X - (COL_PU - 60),
    height: 26,
    color: rgb(0.93, 0.96, 1),
  });
  page.drawText(d("dpgf_total_ttc", l), {
    x: COL_PU - 50,
    y,
    size: 13,
    font: fontBold,
    color: BLUE,
  });
  page.drawText(fmtPrice(dpgf.total_ttc), {
    x: COL_TOTAL,
    y,
    size: 13,
    font: fontBold,
    color: BLUE,
  });

  // ── Finalize: draw footers on all pages ──────────────────────────────────

  // Draw footer on the last page (others were drawn in ensureSpace)
  drawFooter(page, pageNum);

  // Update page numbers on all pages now that we know total count
  // (footers already drawn show just "Page N", we keep it simple)

  // ── Generate blob & trigger download ─────────────────────────────────────

  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes as unknown as ArrayBuffer], {
    type: "application/pdf",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "floorscan_dpgf.pdf";
  a.click();
  URL.revokeObjectURL(url);
}
