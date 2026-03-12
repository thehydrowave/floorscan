"use client";

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "pdf-lib";
import type { DpgfState } from "@/lib/types";
import type { CctpLotTemplate } from "@/lib/cctp-templates";
import { dt, DTKey } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";

// ── Constants ────────────────────────────────────────────────────────────────

const W = 595.28;
const H = 841.89;
const HEADER_HEIGHT = 70;
const FOOTER_HEIGHT = 36;
const MARGIN_X = 50;
const MARGIN_BOTTOM = 60;
const TEXT_WIDTH = W - 2 * MARGIN_X;
const LINE_HEIGHT = 13;

const BLUE = rgb(0.055, 0.647, 0.914);
const WHITE = rgb(1, 1, 1);
const DARK = rgb(0.18, 0.22, 0.3);
const GRAY = rgb(0.6, 0.65, 0.72);
const LIGHT_GRAY = rgb(0.39, 0.46, 0.54);
const BG_SUBTLE = rgb(0.97, 0.99, 1);
const AMBER = rgb(0.85, 0.55, 0.05);
const SKY = rgb(0.14, 0.56, 0.85);

// ── Helpers ──────────────────────────────────────────────────────────────────

function d(key: string, lang: Lang): string {
  try {
    return dt(key as DTKey, lang);
  } catch {
    console.warn(`[i18n] Missing key: ${key}`);
    return key;
  }
}

/**
 * Word-wrap text to fit within maxWidth using the given font & size.
 * Returns an array of lines.
 */
function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? current + " " + word : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ── PDF Generation ───────────────────────────────────────────────────────────

export async function downloadCctpPdf(
  dpgf: DpgfState,
  cctpLots: (CctpLotTemplate & { hasContent: boolean })[],
  lang: string,
  filename?: string
): Promise<void> {
  const l = lang as Lang;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

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
      x: 40,
      y: H - 42,
      size: 22,
      font: fontBold,
      color: WHITE,
    });
    p.drawText(d("cctp_title", l), {
      x: 40,
      y: H - 60,
      size: 10,
      font,
      color: rgb(0.9, 0.97, 1),
    });
    const dateStr =
      dpgf.date ||
      new Date().toLocaleDateString("fr-FR", {
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
    const footerText = "FloorScan \u00B7 " + d("cctp_pdf_footer", l);
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

  /**
   * Draw wrapped text lines and advance Y.
   */
  function drawWrapped(
    text: string,
    f: PDFFont,
    size: number,
    color: ReturnType<typeof rgb>,
    indent: number = 0
  ) {
    const lines = wrapText(text, f, size, TEXT_WIDTH - indent);
    for (const ln of lines) {
      ensureSpace(LINE_HEIGHT + 20);
      page.drawText(ln, {
        x: MARGIN_X + indent,
        y,
        size,
        font: f,
        color,
      });
      y -= LINE_HEIGHT;
    }
  }

  // ── Page 1 setup ──────────────────────────────────────────────────────────

  drawWhiteBg(page);
  drawHeader(page);
  y = H - HEADER_HEIGHT - 30;

  // Project info
  if (dpgf.project_name) {
    page.drawText("Projet : " + dpgf.project_name, {
      x: MARGIN_X,
      y,
      size: 10,
      font: fontBold,
      color: DARK,
    });
    y -= 18;
  }
  if (dpgf.project_address) {
    page.drawText("Adresse : " + dpgf.project_address, {
      x: MARGIN_X,
      y,
      size: 10,
      font,
      color: DARK,
    });
    y -= 18;
  }

  // WIP stamp
  {
    const stampText = d("cctp_wip", l) + " — " + d("cctp_subtitle", l);
    const stampWidth = fontBold.widthOfTextAtSize(stampText, 10) + 20;
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
      size: 10,
      font: fontBold,
      color: AMBER,
    });
    y -= 36;
  }

  // ── Lot sections ──────────────────────────────────────────────────────────

  for (const lot of cctpLots) {
    const dpgfLot = dpgf.lots.find((l) => l.lot_number === lot.lot_number);
    const lotTitle = `LOT ${lot.lot_number} \u2014 ${d(dpgfLot?.title_key ?? "dpgf_lot" + lot.lot_number, l)}`;

    // Lot header bar
    ensureSpace(80);
    page.drawRectangle({
      x: MARGIN_X,
      y: y - 4,
      width: TEXT_WIDTH,
      height: 22,
      color: SKY,
    });
    page.drawText(lotTitle, {
      x: MARGIN_X + 8,
      y: y + 3,
      size: 11,
      font: fontBold,
      color: WHITE,
    });
    y -= 30;

    // Intro paragraph (italic)
    drawWrapped(d(lot.intro_key, l), fontOblique, 9, LIGHT_GRAY, 0);
    y -= 8;

    // Items
    for (const item of lot.items) {
      const dpgfItem = dpgfLot?.items.find(
        (i) => i.description_key === item.dpgf_key
      );

      ensureSpace(50);

      // Item title + quantity
      let itemHeader = d(item.title_key, l);
      if (dpgfItem) {
        itemHeader += ` — ${dpgfItem.quantity.toFixed(2)} ${dpgfItem.unit}`;
      }

      page.drawText("\u25B8 " + itemHeader, {
        x: MARGIN_X + 10,
        y,
        size: 10,
        font: fontBold,
        color: DARK,
      });
      y -= 14;

      // DTU ref
      page.drawText("Réf. : " + item.dtu_ref, {
        x: MARGIN_X + 16,
        y,
        size: 8,
        font,
        color: SKY,
      });
      y -= 12;

      // Prescriptive text
      drawWrapped(d(item.template_key, l), font, 9, DARK, 16);
      y -= 8;
    }

    y -= 10;
  }

  // ── Finalize ──────────────────────────────────────────────────────────────

  drawFooter(page, pageNum);

  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes as unknown as ArrayBuffer], {
    type: "application/pdf",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "floorscan_cctp.pdf";
  a.click();
  URL.revokeObjectURL(url);
}
