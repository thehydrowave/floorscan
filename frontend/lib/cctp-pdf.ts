"use client";

import type { DpgfState } from "@/lib/types";
import type { CctpLotTemplate } from "@/lib/cctp-templates";
import type { Lang } from "@/lib/i18n";
import {
  PdfBuilder,
  PAGE,
  TYPO,
  C,
  d,
  fmtDate,
  safeTxt,
} from "@/lib/pdf-theme";

// ── PDF Generation ───────────────────────────────────────────────────────────

export async function downloadCctpPdf(
  dpgf: DpgfState,
  cctpLots: (CctpLotTemplate & { hasContent: boolean })[],
  lang: string,
  filename?: string
): Promise<void> {
  const l = lang as Lang;
  const dateStr = fmtDate(dpgf.date);

  const b = await PdfBuilder.create({
    docType: "CCTP",
    docSubtitle: d("cctp_title", l),
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
  b.moveDown(4);

  // WIP stamp
  const stampText = d("cctp_wip", l) + " -- " + d("cctp_subtitle", l);
  b.drawStamp(stampText);

  // ── Lot sections ────────────────────────────────────────────────────────

  for (const lot of cctpLots) {
    const dpgfLot = dpgf.lots.find((lo) => lo.lot_number === lot.lot_number);
    const lotTitle = `LOT ${lot.lot_number} -- ${d(dpgfLot?.title_key ?? "dpgf_lot" + lot.lot_number, l)}`;

    // Lot header bar
    b.drawLotHeader(lotTitle);

    // Intro paragraph (oblique)
    b.drawWrappedText(d(lot.intro_key, l), {
      font: b.fontOblique,
      color: C.GRAY_700,
    });
    b.moveDown(8);

    // Items
    for (const item of lot.items) {
      const dpgfItem = dpgfLot?.items.find(
        (i) => i.description_key === item.dpgf_key
      );

      b.ensureSpace(50);

      // Item title + quantity
      let itemHeader = d(item.title_key, l);
      if (dpgfItem) {
        itemHeader += ` -- ${dpgfItem.quantity.toFixed(2)} ${dpgfItem.unit}`;
      }

      // Bullet + title
      b.page.drawText(safeTxt("> " + itemHeader), {
        x: PAGE.MARGIN_X + 10,
        y: b.y,
        size: 10,
        font: b.fontBold,
        color: C.DARK,
      });
      b.moveDown(14);

      // DTU reference
      b.page.drawText(safeTxt("Ref. : " + item.dtu_ref), {
        x: PAGE.MARGIN_X + 16,
        y: b.y,
        size: TYPO.TABLE_CELL,
        font: b.font,
        color: C.BLUE,
      });
      b.moveDown(12);

      // Prescriptive text (wrapped)
      b.drawWrappedText(d(item.template_key, l), {
        indent: 16,
      });
      b.moveDown(8);
    }

    b.moveDown(10);
  }

  // ── Save ────────────────────────────────────────────────────────────────

  await b.saveAndDownload(filename || "floorscan_cctp.pdf");
}
