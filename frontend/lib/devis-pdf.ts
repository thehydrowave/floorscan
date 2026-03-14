"use client";

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "pdf-lib";
import { DpgfState, DevisOptions } from "@/lib/types";
import { dt, DTKey } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";

// ── Constants ────────────────────────────────────────────────────────────────

const W = 595.28;
const H = 841.89;
const MARGIN_X = 50;
const MARGIN_BOTTOM = 60;
const ROW_HEIGHT = 16;

const BLUE = rgb(0.055, 0.647, 0.914);
const WHITE = rgb(1, 1, 1);
const DARK = rgb(0.18, 0.22, 0.3);
const GRAY = rgb(0.6, 0.65, 0.72);
const LIGHT_GRAY = rgb(0.39, 0.46, 0.54);
const BG_SUBTLE = rgb(0.97, 0.99, 1);
const GREEN = rgb(0.06, 0.6, 0.35);

const COL_DESC = 50;
const COL_QTY = 340;
const COL_UNIT = 395;
const COL_PU = 435;
const COL_TOTAL = 505;

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtQty(n: number): string {
  return n.toFixed(2);
}

function fmtPrice(n: number): string {
  return n.toFixed(2) + " \u20AC";
}

/**
 * Replace accented characters with ASCII equivalents for WinAnsi safety.
 */
function safeTxt(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2014/g, "--")
    .replace(/\u2013/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x20-\x7E\u00C0-\u00FF]/g, "");
}

function d(key: string, lang: Lang): string {
  try {
    return safeTxt(dt(key as DTKey, lang));
  } catch {
    return safeTxt(key);
  }
}

function truncateText(text: string, maxWidth: number, f: PDFFont, size: number): string {
  let t = text;
  while (t.length > 0 && f.widthOfTextAtSize(t, size) > maxWidth) {
    t = t.slice(0, -1);
  }
  if (t.length < text.length && t.length > 3) {
    t = t.slice(0, -3) + "...";
  }
  return t;
}

// ── PDF Generation ───────────────────────────────────────────────────────────

export async function downloadDevisPdf(
  dpgf: DpgfState,
  options: DevisOptions,
  lang: string,
  filename?: string
): Promise<void> {
  const l = lang as Lang;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdfDoc.addPage([W, H]);
  let y = H;
  let pageNum = 1;

  // ── Draw helpers ─────────────────────────────────────────────────────────

  const drawWhiteBg = (p: PDFPage) => {
    p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE });
  };

  const drawFooter = (p: PDFPage, num: number) => {
    p.drawRectangle({ x: 0, y: 0, width: W, height: 36, color: BG_SUBTLE });
    p.drawText(safeTxt(d("devis_pdf_footer", l)), {
      x: 40, y: 13, size: 7, font, color: GRAY,
    });
    p.drawText(`Page ${num}`, {
      x: W - 70, y: 13, size: 8, font, color: GRAY,
    });
  };

  const drawSmallHeader = (p: PDFPage) => {
    p.drawRectangle({ x: 0, y: H - 50, width: W, height: 50, color: BLUE });
    p.drawText("DEVIS", { x: 40, y: H - 32, size: 16, font: fontBold, color: WHITE });
    const numTxt = safeTxt(options.quote_number || "");
    if (numTxt) {
      p.drawText(numTxt, { x: W - 200, y: H - 32, size: 10, font, color: WHITE });
    }
  };

  const ensureSpace = (needed: number) => {
    if (y < needed + MARGIN_BOTTOM) {
      drawFooter(page, pageNum);
      pageNum++;
      page = pdfDoc.addPage([W, H]);
      drawWhiteBg(page);
      drawSmallHeader(page);
      y = H - 70;
    }
  };

  // ── Page 1 — Cover / Header ──────────────────────────────────────────────

  drawWhiteBg(page);

  // Large title bar
  page.drawRectangle({ x: 0, y: H - 80, width: W, height: 80, color: BLUE });
  page.drawText("DEVIS", { x: 40, y: H - 48, size: 28, font: fontBold, color: WHITE });
  page.drawText(d("devis_title", l), { x: 40, y: H - 68, size: 10, font, color: rgb(0.85, 0.95, 1) });
  if (options.quote_number) {
    page.drawText(safeTxt(options.quote_number), {
      x: W - 200, y: H - 48, size: 12, font: fontBold, color: WHITE,
    });
  }

  y = H - 100;

  // ── Company info block (left) ────────────────────────────────────────────

  const comp = options.company;
  const blockStartY = y;

  page.drawText(d("devis_company", l).toUpperCase(), {
    x: MARGIN_X, y, size: 9, font: fontBold, color: BLUE,
  });
  y -= 14;

  const compLines = [
    comp.name,
    comp.address,
    comp.siret ? `SIRET: ${comp.siret}` : "",
    comp.rcs || "",
    comp.phone ? `Tel: ${comp.phone}` : "",
    comp.email || "",
  ].filter(Boolean);

  for (const line of compLines) {
    page.drawText(safeTxt(line), { x: MARGIN_X, y, size: 9, font, color: DARK });
    y -= 13;
  }

  if (comp.rge) {
    page.drawText(safeTxt(`RGE: ${comp.rge}`), { x: MARGIN_X, y, size: 8, font, color: GREEN });
    y -= 13;
  }
  if (comp.assurance) {
    page.drawText(safeTxt(`Assurance: ${comp.assurance}`), { x: MARGIN_X, y, size: 8, font, color: LIGHT_GRAY });
    y -= 13;
  }

  // ── Client info block (right) ────────────────────────────────────────────

  let cy2 = blockStartY;
  const rightX = 340;

  page.drawText(d("devis_client", l).toUpperCase(), {
    x: rightX, y: cy2, size: 9, font: fontBold, color: BLUE,
  });
  cy2 -= 14;

  const clientLines = [
    options.client.name,
    options.client.address,
    options.client.phone ? `Tel: ${options.client.phone}` : "",
    options.client.email || "",
  ].filter(Boolean);

  for (const line of clientLines) {
    page.drawText(safeTxt(line), { x: rightX, y: cy2, size: 9, font, color: DARK });
    cy2 -= 13;
  }

  // Take the lower y
  y = Math.min(y, cy2) - 10;

  // ── Quote metadata ───────────────────────────────────────────────────────

  page.drawRectangle({
    x: MARGIN_X, y: y - 4, width: W - 2 * MARGIN_X, height: 1, color: BLUE,
  });
  y -= 18;

  // Date + validity
  const dateStr = options.date || new Date().toLocaleDateString("fr-FR");
  page.drawText(`Date: ${safeTxt(dateStr)}`, {
    x: MARGIN_X, y, size: 9, font, color: DARK,
  });

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + (options.validity_days || 30));
  const validStr = validUntil.toLocaleDateString("fr-FR");
  page.drawText(`${d("devis_valid_until", l)}: ${validStr}`, {
    x: 300, y, size: 9, font, color: DARK,
  });
  y -= 16;

  // Project info
  if (dpgf.project_name) {
    page.drawText(`${d("devis_project", l)}: ${safeTxt(dpgf.project_name)}`, {
      x: MARGIN_X, y, size: 9, font: fontBold, color: DARK,
    });
    y -= 14;
  }
  if (dpgf.project_address) {
    page.drawText(safeTxt(dpgf.project_address), {
      x: MARGIN_X, y, size: 9, font, color: LIGHT_GRAY,
    });
    y -= 14;
  }

  y -= 10;

  // ── Lot tables ───────────────────────────────────────────────────────────

  for (const lot of dpgf.lots) {
    if (!lot.items || lot.items.length === 0) continue;

    ensureSpace(80);

    // Lot header
    page.drawRectangle({
      x: MARGIN_X, y: y - 4, width: W - 2 * MARGIN_X, height: 22, color: BLUE,
    });
    const lotTitle = `LOT ${lot.lot_number} -- ${d(lot.title_key, l)}`;
    page.drawText(lotTitle, {
      x: MARGIN_X + 8, y: y + 3, size: 11, font: fontBold, color: WHITE,
    });
    y -= 28;

    // Table header
    page.drawRectangle({
      x: MARGIN_X, y: y - 3, width: W - 2 * MARGIN_X, height: ROW_HEIGHT, color: BG_SUBTLE,
    });
    page.drawText(d("dpgf_desc", l), { x: COL_DESC + 4, y, size: 8, font: fontBold, color: LIGHT_GRAY });
    page.drawText(d("dpgf_qty", l), { x: COL_QTY, y, size: 8, font: fontBold, color: LIGHT_GRAY });
    page.drawText(d("dpgf_unit", l), { x: COL_UNIT, y, size: 8, font: fontBold, color: LIGHT_GRAY });
    page.drawText(d("dpgf_pu_ht", l), { x: COL_PU, y, size: 8, font: fontBold, color: LIGHT_GRAY });
    page.drawText("Total HT", { x: COL_TOTAL, y, size: 8, font: fontBold, color: LIGHT_GRAY });
    y -= ROW_HEIGHT + 2;

    // Items
    for (const item of lot.items) {
      ensureSpace(ROW_HEIGHT + 20);
      const descText = truncateText(d(item.description_key, l), COL_QTY - COL_DESC - 10, font, 9);
      page.drawText(descText, { x: COL_DESC + 4, y, size: 9, font, color: DARK });
      page.drawText(fmtQty(item.quantity), { x: COL_QTY, y, size: 9, font, color: DARK });
      page.drawText(item.unit, { x: COL_UNIT, y, size: 9, font, color: DARK });
      page.drawText(fmtPrice(item.unit_price), { x: COL_PU, y, size: 9, font, color: DARK });
      page.drawText(fmtPrice(item.total_ht), { x: COL_TOTAL, y, size: 9, font, color: DARK });
      y -= ROW_HEIGHT;
    }

    // Subtotal
    y -= 2;
    page.drawRectangle({
      x: MARGIN_X, y: y - 3, width: W - 2 * MARGIN_X, height: ROW_HEIGHT, color: rgb(0.93, 0.96, 1),
    });
    page.drawText(d("dpgf_subtotal", l), { x: COL_DESC + 4, y, size: 9, font: fontBold, color: BLUE });
    page.drawText(fmtPrice(lot.subtotal_ht), { x: COL_TOTAL, y, size: 9, font: fontBold, color: BLUE });
    y -= ROW_HEIGHT + 12;
  }

  // ── Totals ───────────────────────────────────────────────────────────────

  ensureSpace(120);

  page.drawRectangle({ x: MARGIN_X, y: y + 4, width: W - 2 * MARGIN_X, height: 1.5, color: BLUE });
  y -= 8;

  page.drawText(d("dpgf_total_ht", l), { x: COL_PU - 50, y, size: 10, font: fontBold, color: DARK });
  page.drawText(fmtPrice(dpgf.total_ht), { x: COL_TOTAL, y, size: 10, font: fontBold, color: DARK });
  y -= 20;

  const tvaLabel = `${d("dpgf_tva", l)} (${dpgf.tva_rate}%)`;
  page.drawText(tvaLabel, { x: COL_PU - 50, y, size: 10, font, color: LIGHT_GRAY });
  page.drawText(fmtPrice(dpgf.tva_amount), { x: COL_TOTAL, y, size: 10, font, color: LIGHT_GRAY });
  y -= 22;

  page.drawRectangle({
    x: COL_PU - 60, y: y - 6, width: W - MARGIN_X - (COL_PU - 60), height: 26, color: rgb(0.93, 0.96, 1),
  });
  page.drawText(d("dpgf_total_ttc", l), { x: COL_PU - 50, y, size: 13, font: fontBold, color: BLUE });
  page.drawText(fmtPrice(dpgf.total_ttc), { x: COL_TOTAL, y, size: 13, font: fontBold, color: BLUE });
  y -= 40;

  // ── Conditions section ───────────────────────────────────────────────────

  ensureSpace(160);

  page.drawRectangle({ x: MARGIN_X, y: y + 4, width: W - 2 * MARGIN_X, height: 1, color: GRAY });
  y -= 12;

  page.drawText("CONDITIONS", { x: MARGIN_X, y, size: 10, font: fontBold, color: DARK });
  y -= 16;

  const conditions = [
    [d("devis_payment_label", l), options.payment_terms || "30% a la commande, solde a la reception des travaux"],
    [d("devis_execution_label", l), options.execution_delay || "A convenir"],
    [d("devis_valid_until", l), `${options.validity_days || 30} jours`],
  ];

  for (const [label, value] of conditions) {
    page.drawText(safeTxt(`${label}: `), { x: MARGIN_X, y, size: 9, font: fontBold, color: DARK });
    page.drawText(safeTxt(value), { x: MARGIN_X + 160, y, size: 9, font, color: DARK });
    y -= 14;
  }

  if (options.notes) {
    y -= 4;
    page.drawText("Notes:", { x: MARGIN_X, y, size: 9, font: fontBold, color: DARK });
    y -= 13;
    const noteLines = safeTxt(options.notes).match(/.{1,80}/g) || [];
    for (const nl of noteLines.slice(0, 5)) {
      page.drawText(nl, { x: MARGIN_X, y, size: 8, font, color: LIGHT_GRAY });
      y -= 12;
    }
  }

  // ── Signature blocks ─────────────────────────────────────────────────────

  ensureSpace(120);
  y -= 10;

  const sigW = (W - 2 * MARGIN_X - 30) / 2;

  // Left: Client signature
  page.drawRectangle({
    x: MARGIN_X, y: y - 80, width: sigW, height: 90,
    color: WHITE, borderColor: GRAY, borderWidth: 0.5,
  });
  page.drawText(d("devis_signature_client", l), {
    x: MARGIN_X + 10, y: y - 2, size: 9, font: fontBold, color: DARK,
  });
  page.drawText("Date:", { x: MARGIN_X + 10, y: y - 40, size: 8, font, color: LIGHT_GRAY });
  page.drawText("Signature:", { x: MARGIN_X + 10, y: y - 55, size: 8, font, color: LIGHT_GRAY });

  // Right: Company signature
  const rightSigX = MARGIN_X + sigW + 30;
  page.drawRectangle({
    x: rightSigX, y: y - 80, width: sigW, height: 90,
    color: WHITE, borderColor: GRAY, borderWidth: 0.5,
  });
  page.drawText(d("devis_signature_company", l), {
    x: rightSigX + 10, y: y - 2, size: 9, font: fontBold, color: DARK,
  });
  if (comp.name) {
    page.drawText(safeTxt(comp.name), {
      x: rightSigX + 10, y: y - 16, size: 8, font, color: LIGHT_GRAY,
    });
  }

  // ── Finalize ─────────────────────────────────────────────────────────────

  drawFooter(page, pageNum);

  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes as unknown as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `devis_${options.quote_number || "floorscan"}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
