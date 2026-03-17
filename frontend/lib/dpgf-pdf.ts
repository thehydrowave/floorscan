"use client";

import { DpgfState } from "@/lib/types";
import type { Lang } from "@/lib/i18n";
import {
  PdfBuilder,
  DPGF_COLS,
  TYPO,
  C,
  d,
  fmtDate,
  fmtQty,
  fmtPrice,
  safeTxt,
} from "@/lib/pdf-theme";

// ── PDF Generation ───────────────────────────────────────────────────────────

export async function downloadDpgfPdf(
  dpgf: DpgfState,
  lang: string,
  filename?: string
): Promise<void> {
  const l = lang as Lang;
  const dateStr = fmtDate(dpgf.date);

  const b = await PdfBuilder.create({
    docType: "DPGF",
    docSubtitle: d("dpgf_title", l),
    dateStr,
    rightMeta: dpgf.project_name || undefined,
    lang: l,
  });

  // ── Page 1 ──────────────────────────────────────────────────────────────

  b.newPage();

  // Project info
  if (dpgf.project_name) {
    b.drawInfoLine(d("dpgf_project", l), dpgf.project_name);
  }
  if (dpgf.project_address) {
    b.drawInfoLine(d("dpgf_address", l), dpgf.project_address);
  }
  b.drawInfoLine("Date", dateStr);
  b.moveDown(6);

  // WIP stamp
  b.drawStamp(d("dpgf_wip", l));

  // ── Lot tables ──────────────────────────────────────────────────────────

  for (const lot of dpgf.lots) {
    if (!lot.items || lot.items.length === 0) continue;

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

  // ── Save ────────────────────────────────────────────────────────────────

  await b.saveAndDownload(filename || "floorscan_dpgf.pdf");
}
