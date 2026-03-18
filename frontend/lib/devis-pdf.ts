"use client";

import { DpgfState, DevisOptions } from "@/lib/types";
import type { Lang } from "@/lib/i18n";
import type { RGB } from "pdf-lib";
import {
  PdfBuilder,
  DPGF_COLS,
  PAGE,
  TYPO,
  C,
  d,
  fmtDate,
  fmtQty,
  fmtPrice,
  safeTxt,
} from "@/lib/pdf-theme";

// ── Local helper: two-column party block (company / client) ───────────────────

function drawParty(
  b: PdfBuilder,
  title: string,
  lines: string[],
  extras: { text: string; color: RGB }[],
  x: number,
  startY: number
): number {
  b.page.drawText(title.toUpperCase(), {
    x, y: startY, size: TYPO.BODY, font: b.fontBold, color: C.BLUE,
  });
  let y = startY - 14;
  for (const line of lines) {
    b.page.drawText(safeTxt(line), { x, y, size: TYPO.BODY, font: b.font, color: C.DARK });
    y -= 13;
  }
  for (const { text, color } of extras) {
    b.page.drawText(safeTxt(text), { x, y, size: TYPO.TABLE_CELL, font: b.font, color });
    y -= 13;
  }
  return y;
}

// ── PDF Generation ────────────────────────────────────────────────────────────

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
  // Page 1 — Custom cover (no standard header)
  // ═══════════════════════════════════════════════════════════════════════

  b.pageNum++;
  const cover = b.pdf.addPage([PAGE.W, PAGE.H]);
  b.pages.push(cover);
  b.page = cover;

  // White bg + title bar
  cover.drawRectangle({ x: 0, y: 0, width: PAGE.W, height: PAGE.H, color: C.WHITE });
  cover.drawRectangle({ x: 0, y: PAGE.H - 80, width: PAGE.W, height: 80, color: C.BLUE });
  cover.drawText("DEVIS", {
    x: PAGE.MARGIN_X, y: PAGE.H - 48, size: 28, font: b.fontBold, color: C.WHITE,
  });
  cover.drawText(d("devis_title", l), {
    x: PAGE.MARGIN_X, y: PAGE.H - 68, size: 10, font: b.font, color: C.BLUE_LIGHT,
  });
  if (options.quote_number) {
    const qn = safeTxt(options.quote_number);
    cover.drawText(qn, {
      x: PAGE.W - PAGE.MARGIN_X - b.fontBold.widthOfTextAtSize(qn, 12),
      y: PAGE.H - 48, size: 12, font: b.fontBold, color: C.WHITE,
    });
  }

  b.y = PAGE.H - 100;

  // ── Company (left) + Client (right) ────────────────────────────────────

  const comp = options.company;
  const blockStartY = b.y;

  const compLines = [comp.name, comp.address, comp.siret ? `SIRET: ${comp.siret}` : "", comp.rcs || "", comp.phone ? `Tel: ${comp.phone}` : "", comp.email || ""].filter(Boolean);
  const compExtras: { text: string; color: RGB }[] = [
    ...(comp.rge ? [{ text: `RGE: ${comp.rge}`, color: C.GREEN as RGB }] : []),
    ...(comp.assurance ? [{ text: `Assurance: ${comp.assurance}`, color: C.GRAY_700 as RGB }] : []),
  ];
  const compEndY = drawParty(b, d("devis_company", l), compLines, compExtras, PAGE.MARGIN_X, blockStartY);

  const clientLines = [options.client.name, options.client.address, options.client.phone ? `Tel: ${options.client.phone}` : "", options.client.email || ""].filter(Boolean);
  const clientEndY = drawParty(b, d("devis_client", l), clientLines, [], 340, blockStartY);

  b.y = Math.min(compEndY, clientEndY) - 10;

  // ── Quote metadata ──────────────────────────────────────────────────────

  b.drawSectionSeparator();
  b.moveDown(6);

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + (options.validity_days || 30));

  cover.drawText(safeTxt(`Date: ${dateStr}`), { x: PAGE.MARGIN_X, y: b.y, size: TYPO.BODY, font: b.font, color: C.DARK });
  cover.drawText(safeTxt(`${d("devis_valid_until", l)}: ${validUntil.toLocaleDateString("fr-FR")}`), { x: 300, y: b.y, size: TYPO.BODY, font: b.font, color: C.DARK });
  b.moveDown(16);

  if (dpgf.project_name) {
    cover.drawText(safeTxt(`${d("devis_project", l)}: ${dpgf.project_name}`), { x: PAGE.MARGIN_X, y: b.y, size: TYPO.BODY, font: b.fontBold, color: C.DARK });
    b.moveDown(14);
  }
  if (dpgf.project_address) {
    cover.drawText(safeTxt(dpgf.project_address), { x: PAGE.MARGIN_X, y: b.y, size: TYPO.BODY, font: b.font, color: C.GRAY_700 });
    b.moveDown(14);
  }
  b.moveDown(10);

  // ═══════════════════════════════════════════════════════════════════════
  // Lot tables (may span multiple pages)
  // ═══════════════════════════════════════════════════════════════════════

  for (const lot of dpgf.lots) {
    if (!lot.items || lot.items.length === 0) continue;
    if (b.y < 120) b.newPage();

    b.drawLotHeader(`LOT ${lot.lot_number} -- ${d(lot.title_key, l)}`);
    b.drawTableHeader(DPGF_COLS, l);

    for (const item of lot.items) {
      b.drawTableRow(DPGF_COLS, {
        description: d(item.description_key, l),
        quantity: fmtQty(item.quantity),
        unit: item.unit,
        unit_price: fmtPrice(item.unit_price),
        total_ht: fmtPrice(item.total_ht),
      });
    }
    b.drawTableTotalRow(DPGF_COLS, { description: d("dpgf_subtotal", l), total_ht: fmtPrice(lot.subtotal_ht) });
  }

  // ── Grand totals ─────────────────────────────────────────────────────────

  b.drawGrandTotals(dpgf.total_ht, dpgf.tva_rate, dpgf.tva_amount, dpgf.total_ttc, l);

  // ── Conditions ────────────────────────────────────────────────────────────

  b.ensureSpace(160);
  b.drawSectionSeparator();
  b.moveDown(4);
  b.drawSectionTitle("CONDITIONS");

  b.drawConditionsBlock([
    [d("devis_payment_label", l), options.payment_terms || "30% a la commande, solde a la reception des travaux"],
    [d("devis_execution_label", l), options.execution_delay || "A convenir"],
    [d("devis_valid_until", l), `${options.validity_days || 30} jours`],
  ]);

  if (options.notes) {
    b.moveDown(4);
    b.drawText("Notes:", { font: b.fontBold });
    b.moveDown(13);
    b.drawWrappedText(options.notes, { size: TYPO.TABLE_CELL, color: C.GRAY_700 });
  }

  // ── Signatures ────────────────────────────────────────────────────────────

  b.ensureSpace(120);
  b.moveDown(10);
  b.drawSignaturePair(d("devis_signature_client", l), d("devis_signature_company", l), comp.name || undefined);

  // ── Save ──────────────────────────────────────────────────────────────────

  await b.saveAndDownload(filename || `devis_${safeTxt(options.quote_number || "floorscan")}.pdf`);
}
