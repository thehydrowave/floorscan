"use client";

import { DpgfState, DevisOptions } from "@/lib/types";
import type { Lang } from "@/lib/i18n";
import {
  PdfBuilder,
  DPGF_COLS,
  PAGE,
  COVER,
  TABLE,
  TYPO,
  C,
  d,
  fmtDate,
  fmtQty,
  fmtPrice,
  safeTxt,
} from "@/lib/pdf-theme";

// ── PDF Generation ───────────────────────────────────────────────────────────

export async function downloadDevisPdf(
  dpgf: DpgfState,
  options: DevisOptions,
  lang: string,
  filename?: string
): Promise<void> {
  const l = lang as Lang;
  const dateStr = fmtDate(options.date);

  const b = await PdfBuilder.create({
    docType: "DEVIS",
    docSubtitle: d("devis_title", l),
    dateStr,
    rightMeta: dpgf.project_name || undefined,
    lang: l,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Page 1 — Cover / Header (custom layout, not standard header)
  // ═══════════════════════════════════════════════════════════════════════

  b.pageNum++;
  const cover = b.pdf.addPage([PAGE.W, PAGE.H]);
  b.pages.push(cover);
  b.page = cover;

  // White bg
  cover.drawRectangle({ x: 0, y: 0, width: PAGE.W, height: PAGE.H, color: C.WHITE });

  // Large title bar
  cover.drawRectangle({ x: 0, y: PAGE.H - 80, width: PAGE.W, height: 80, color: C.BLUE });
  cover.drawText("DEVIS", {
    x: PAGE.MARGIN_X,
    y: PAGE.H - 48,
    size: 28,
    font: b.fontBold,
    color: C.WHITE,
  });
  cover.drawText(d("devis_title", l), {
    x: PAGE.MARGIN_X,
    y: PAGE.H - 68,
    size: 10,
    font: b.font,
    color: C.BLUE_LIGHT,
  });
  if (options.quote_number) {
    cover.drawText(safeTxt(options.quote_number), {
      x: PAGE.W - PAGE.MARGIN_X - b.fontBold.widthOfTextAtSize(safeTxt(options.quote_number), 12),
      y: PAGE.H - 48,
      size: 12,
      font: b.fontBold,
      color: C.WHITE,
    });
  }

  b.y = PAGE.H - 100;

  // ── Company info block (left) ──────────────────────────────────────────

  const comp = options.company;
  const blockStartY = b.y;

  cover.drawText(d("devis_company", l).toUpperCase(), {
    x: PAGE.MARGIN_X,
    y: b.y,
    size: TYPO.BODY,
    font: b.fontBold,
    color: C.BLUE,
  });
  b.y -= 14;

  const compLines = [
    comp.name,
    comp.address,
    comp.siret ? `SIRET: ${comp.siret}` : "",
    comp.rcs || "",
    comp.phone ? `Tel: ${comp.phone}` : "",
    comp.email || "",
  ].filter(Boolean);

  for (const line of compLines) {
    cover.drawText(safeTxt(line), {
      x: PAGE.MARGIN_X,
      y: b.y,
      size: TYPO.BODY,
      font: b.font,
      color: C.DARK,
    });
    b.y -= 13;
  }

  if (comp.rge) {
    cover.drawText(safeTxt(`RGE: ${comp.rge}`), {
      x: PAGE.MARGIN_X,
      y: b.y,
      size: TYPO.TABLE_CELL,
      font: b.font,
      color: C.GREEN,
    });
    b.y -= 13;
  }
  if (comp.assurance) {
    cover.drawText(safeTxt(`Assurance: ${comp.assurance}`), {
      x: PAGE.MARGIN_X,
      y: b.y,
      size: TYPO.TABLE_CELL,
      font: b.font,
      color: C.GRAY_700,
    });
    b.y -= 13;
  }

  // ── Client info block (right) ──────────────────────────────────────────

  let cy2 = blockStartY;
  const rightX = 340;

  cover.drawText(d("devis_client", l).toUpperCase(), {
    x: rightX,
    y: cy2,
    size: TYPO.BODY,
    font: b.fontBold,
    color: C.BLUE,
  });
  cy2 -= 14;

  const clientLines = [
    options.client.name,
    options.client.address,
    options.client.phone ? `Tel: ${options.client.phone}` : "",
    options.client.email || "",
  ].filter(Boolean);

  for (const line of clientLines) {
    cover.drawText(safeTxt(line), {
      x: rightX,
      y: cy2,
      size: TYPO.BODY,
      font: b.font,
      color: C.DARK,
    });
    cy2 -= 13;
  }

  // Take the lower y
  b.y = Math.min(b.y, cy2) - 10;

  // ── Quote metadata ─────────────────────────────────────────────────────

  b.drawSectionSeparator();
  b.moveDown(6);

  // Date + validity
  cover.drawText(safeTxt(`Date: ${dateStr}`), {
    x: PAGE.MARGIN_X,
    y: b.y,
    size: TYPO.BODY,
    font: b.font,
    color: C.DARK,
  });

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + (options.validity_days || 30));
  const validStr = validUntil.toLocaleDateString("fr-FR");
  cover.drawText(safeTxt(`${d("devis_valid_until", l)}: ${validStr}`), {
    x: 300,
    y: b.y,
    size: TYPO.BODY,
    font: b.font,
    color: C.DARK,
  });
  b.moveDown(16);

  // Project info
  if (dpgf.project_name) {
    cover.drawText(safeTxt(`${d("devis_project", l)}: ${dpgf.project_name}`), {
      x: PAGE.MARGIN_X,
      y: b.y,
      size: TYPO.BODY,
      font: b.fontBold,
      color: C.DARK,
    });
    b.moveDown(14);
  }
  if (dpgf.project_address) {
    cover.drawText(safeTxt(dpgf.project_address), {
      x: PAGE.MARGIN_X,
      y: b.y,
      size: TYPO.BODY,
      font: b.font,
      color: C.GRAY_700,
    });
    b.moveDown(14);
  }

  b.moveDown(10);

  // ═══════════════════════════════════════════════════════════════════════
  // Lot tables (may span multiple pages)
  // ═══════════════════════════════════════════════════════════════════════

  for (const lot of dpgf.lots) {
    if (!lot.items || lot.items.length === 0) continue;

    // Check if we need a new page — if near bottom, start fresh
    if (b.y < 120) {
      b.newPage();
    }

    // Lot header
    const lotTitle = `LOT ${lot.lot_number} -- ${d(lot.title_key, l)}`;
    b.drawLotHeader(lotTitle);

    // Table column headers
    b.drawTableHeader(DPGF_COLS, l);

    // Item rows
    for (const item of lot.items) {
      b.drawTableRow(DPGF_COLS, {
        description: d(item.description_key, l),
        quantity: fmtQty(item.quantity),
        unit: item.unit,
        unit_price: fmtPrice(item.unit_price),
        total_ht: fmtPrice(item.total_ht),
      });
    }

    // Subtotal row
    b.drawTableTotalRow(DPGF_COLS, {
      description: d("dpgf_subtotal", l),
      total_ht: fmtPrice(lot.subtotal_ht),
    });
  }

  // ── Grand totals ────────────────────────────────────────────────────────

  b.drawGrandTotals(dpgf.total_ht, dpgf.tva_rate, dpgf.tva_amount, dpgf.total_ttc, l);

  // ── Conditions section ──────────────────────────────────────────────────

  b.ensureSpace(160);
  b.drawSectionSeparator();
  b.moveDown(4);

  b.drawSectionTitle("CONDITIONS");

  const conditions = [
    [d("devis_payment_label", l), options.payment_terms || "30% a la commande, solde a la reception des travaux"],
    [d("devis_execution_label", l), options.execution_delay || "A convenir"],
    [d("devis_valid_until", l), `${options.validity_days || 30} jours`],
  ];

  for (const [label, value] of conditions) {
    b.page.drawText(safeTxt(`${label}: `), {
      x: PAGE.MARGIN_X,
      y: b.y,
      size: TYPO.BODY,
      font: b.fontBold,
      color: C.DARK,
    });
    b.page.drawText(safeTxt(value), {
      x: PAGE.MARGIN_X + 160,
      y: b.y,
      size: TYPO.BODY,
      font: b.font,
      color: C.DARK,
    });
    b.moveDown(14);
  }

  if (options.notes) {
    b.moveDown(4);
    b.drawText("Notes:", { font: b.fontBold });
    b.moveDown(13);
    b.drawWrappedText(options.notes, { size: TYPO.TABLE_CELL, color: C.GRAY_700 });
  }

  // ── Signature blocks ────────────────────────────────────────────────────

  b.ensureSpace(120);
  b.moveDown(10);

  const sigW = (PAGE.TEXT_WIDTH - 30) / 2;

  // Left: Client signature
  b.page.drawRectangle({
    x: PAGE.MARGIN_X,
    y: b.y - 80,
    width: sigW,
    height: 90,
    color: C.WHITE,
    borderColor: C.GRAY_200,
    borderWidth: TABLE.BORDER_WIDTH,
  });
  b.page.drawText(d("devis_signature_client", l), {
    x: PAGE.MARGIN_X + 10,
    y: b.y - 2,
    size: TYPO.BODY,
    font: b.fontBold,
    color: C.DARK,
  });
  b.page.drawText("Date:", {
    x: PAGE.MARGIN_X + 10,
    y: b.y - 40,
    size: TYPO.TABLE_CELL,
    font: b.font,
    color: C.GRAY_700,
  });
  b.page.drawText("Signature:", {
    x: PAGE.MARGIN_X + 10,
    y: b.y - 55,
    size: TYPO.TABLE_CELL,
    font: b.font,
    color: C.GRAY_700,
  });

  // Right: Company signature
  const rightSigX = PAGE.MARGIN_X + sigW + 30;
  b.page.drawRectangle({
    x: rightSigX,
    y: b.y - 80,
    width: sigW,
    height: 90,
    color: C.WHITE,
    borderColor: C.GRAY_200,
    borderWidth: TABLE.BORDER_WIDTH,
  });
  b.page.drawText(d("devis_signature_company", l), {
    x: rightSigX + 10,
    y: b.y - 2,
    size: TYPO.BODY,
    font: b.fontBold,
    color: C.DARK,
  });
  if (comp.name) {
    b.page.drawText(safeTxt(comp.name), {
      x: rightSigX + 10,
      y: b.y - 16,
      size: TYPO.TABLE_CELL,
      font: b.font,
      color: C.GRAY_700,
    });
  }

  // ── Save ────────────────────────────────────────────────────────────────

  await b.saveAndDownload(filename || `devis_${safeTxt(options.quote_number || "floorscan")}.pdf`);
}
