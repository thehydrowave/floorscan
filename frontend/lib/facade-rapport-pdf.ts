"use client";

import { PdfBuilder, safeTxt, fmtQty, fmtPrice, PAGE, C, TYPO, TABLE, type ColDef } from "./pdf-theme";
import type { FacadeAnalysisResult, FacadeElement } from "./types";
import type { Lang } from "./i18n";

interface FacadeExportOpts {
  result: FacadeAnalysisResult;
  elements: FacadeElement[];
  facadeAreaM2: number;
  wallNetArea: number;
  windowCount: number;
  windowsAreaM2: number;
  windowsPerimeterM: number;
  perZoneStats?: Array<{
    idx: number;
    fenetresCount: number;
    fenetresArea: number;
    zoneArea: number;
    nette: number | null;
  }> | null;
  imgNat: { w: number; h: number };
  lang: Lang;
}

function computeRetours(elements: FacadeElement[], ppm: number | undefined | null, imgNat: { w: number; h: number }) {
  const epT = 0.14, epL = 0.14, epA = 0.14;
  const openings = elements.filter(e => !["floor_line", "roof", "column", "wall_opaque"].includes(e.type));
  const lines = openings.map(e => {
    const w = e.w_m ?? (ppm && imgNat.w > 0 ? (e.bbox_norm.w * imgNat.w / ppm) : null);
    const h = e.h_m ?? (ppm && imgNat.h > 0 ? (e.bbox_norm.h * imgNat.h / ppm) : null);
    const lL = w, lA = w, lT = h != null ? h * 2 : null;
    const sL = lL != null ? lL * epL : null, sA = lA != null ? lA * epA : null, sT = lT != null ? lT * epT : null;
    const tot = sL != null && sA != null && sT != null ? sL + sA + sT : null;
    return { e, w, h, lL, lA, lT, sL, sA, sT, tot };
  });
  const totLT = lines.reduce((s, l) => s + (l.lT ?? 0), 0);
  const totLL = lines.reduce((s, l) => s + (l.lL ?? 0), 0);
  const totLA = lines.reduce((s, l) => s + (l.lA ?? 0), 0);
  const totST = lines.reduce((s, l) => s + (l.sT ?? 0), 0);
  const totSL = lines.reduce((s, l) => s + (l.sL ?? 0), 0);
  const totSA = lines.reduce((s, l) => s + (l.sA ?? 0), 0);
  return { lines, totLT, totLL, totLA, totST, totSL, totSA, totSurfRetours: totST + totSL + totSA };
}

export async function generateFacadeRapportPDF(opts: FacadeExportOpts) {
  const { result, elements, facadeAreaM2, wallNetArea, windowCount, windowsAreaM2, windowsPerimeterM, perZoneStats, imgNat, lang } = opts;
  const ppm = result.pixels_per_meter;
  const ret = computeRetours(elements, ppm, imgNat);
  const pxITE = 120, pxRet = 45, pxEch = 25;
  const cITE = wallNetArea * pxITE;
  const cRet = (ret.totLT + ret.totLL + ret.totLA) * pxRet;
  const cEch = facadeAreaM2 * pxEch;
  const cTotal = cITE + cRet + cEch;

  const dateStr = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

  const b = await PdfBuilder.create({
    docType: "RAPPORT",
    docSubtitle: "Rapport Analyse Facade",
    dateStr,
    lang,
  });

  // ═══════════════════════════════════════════════════════════
  // PAGE 1: Cover
  // ═══════════════════════════════════════════════════════════
  b.drawCoverPage({
    title: "RAPPORT D'ANALYSE FACADE",
    subtitle: "Analyse IA -- Detection fenetres, surfaces et retours de tableau",
    infoLines: [
      ["Date", dateStr],
      ["Session", safeTxt(result.session_id ?? "-")],
      ["Echelle", ppm ? `${ppm.toFixed(1)} px/m` : "Non calibre"],
      ["Fenetres detectees", `${windowCount}`],
      ["Surface facade", `${facadeAreaM2.toFixed(2)} m2`],
      ["Surface nette", `${wallNetArea.toFixed(2)} m2`],
    ],
  });

  // ═══════════════════════════════════════════════════════════
  // PAGE 2: KPI Summary
  // ═══════════════════════════════════════════════════════════
  b.newPage();
  b.drawSectionTitle("Resume des surfaces");
  b.moveDown(8);

  const kpiCols: ColDef[] = [
    { key: "label", label: "", x: PAGE.MARGIN_X, width: 250, align: "left" },
    { key: "value", label: "", x: PAGE.MARGIN_X + 260, width: 200, align: "right" },
  ];

  b.drawTableHeader(kpiCols, lang);
  const kpiRows = [
    { label: "Fenetres (nombre)", value: `${windowCount}` },
    { label: "Fenetres (surface)", value: `${windowsAreaM2.toFixed(2)} m2` },
    { label: "Perimetre total fenetres", value: `${windowsPerimeterM.toFixed(2)} m` },
    { label: "Surface nette mur", value: `${wallNetArea.toFixed(2)} m2` },
    { label: "Surface totale delimitee", value: `${facadeAreaM2.toFixed(2)} m2` },
  ];
  if (result.ratio_openings != null) kpiRows.push({ label: "Ratio ouvertures", value: `${(result.ratio_openings * 100).toFixed(1)} %` });
  if (result.floors_count != null) kpiRows.push({ label: "Etages detectes", value: `${result.floors_count}` });

  for (const row of kpiRows) {
    b.drawTableRow(kpiCols, row);
  }

  // ═══════════════════════════════════════════════════════════
  // Retours de tableau
  // ═══════════════════════════════════════════════════════════
  b.moveDown(15);
  b.drawSectionTitle("Retours de tableau / linteau / appui");
  b.moveDown(8);

  const retCols: ColDef[] = [
    { key: "type", label: "", x: PAGE.MARGIN_X, width: 120, align: "left" },
    { key: "lineaire", label: "Lineaire (ml)", x: PAGE.MARGIN_X + 130, width: 100, align: "right" },
    { key: "surface", label: "Surface (m2)", x: PAGE.MARGIN_X + 240, width: 100, align: "right" },
  ];
  b.drawTableHeader(retCols, lang);
  b.drawTableRow(retCols, { type: "Tableau (cotes)", lineaire: fmtQty(ret.totLT), surface: fmtQty(ret.totST) });
  b.drawTableRow(retCols, { type: "Linteau (haut)", lineaire: fmtQty(ret.totLL), surface: fmtQty(ret.totSL) });
  b.drawTableRow(retCols, { type: "Appui (bas)", lineaire: fmtQty(ret.totLA), surface: fmtQty(ret.totSA) });
  b.drawTableTotalRow(retCols, {
    type: "TOTAL",
    lineaire: fmtQty(ret.totLT + ret.totLL + ret.totLA),
    surface: fmtQty(ret.totSurfRetours),
  });

  // ═══════════════════════════════════════════════════════════
  // Per-facade stats
  // ═══════════════════════════════════════════════════════════
  if (perZoneStats && perZoneStats.length > 0) {
    b.moveDown(15);
    b.drawSectionTitle("Detail par facade");
    b.moveDown(8);

    const zCols: ColDef[] = [
      { key: "facade", label: "Facade", x: PAGE.MARGIN_X, width: 80, align: "left" },
      { key: "fenNb", label: "Fen. (nb)", x: PAGE.MARGIN_X + 90, width: 60, align: "right" },
      { key: "fenM2", label: "Fen. (m2)", x: PAGE.MARGIN_X + 160, width: 80, align: "right" },
      { key: "nette", label: "Nette (m2)", x: PAGE.MARGIN_X + 250, width: 80, align: "right" },
      { key: "zone", label: "Zone (m2)", x: PAGE.MARGIN_X + 340, width: 80, align: "right" },
    ];
    b.drawTableHeader(zCols, lang);
    for (const zs of perZoneStats) {
      b.drawTableRow(zCols, {
        facade: `Facade ${zs.idx + 1}`,
        fenNb: `${zs.fenetresCount}`,
        fenM2: fmtQty(zs.fenetresArea),
        nette: zs.nette != null ? fmtQty(zs.nette) : "-",
        zone: fmtQty(zs.zoneArea),
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PAGE 3: Financial estimates
  // ═══════════════════════════════════════════════════════════
  b.newPage();
  b.drawSectionTitle("Estimations financieres (indicatives HT)");
  b.moveDown(8);

  const finCols: ColDef[] = [
    { key: "poste", label: "Poste", x: PAGE.MARGIN_X, width: 160, align: "left" },
    { key: "qty", label: "Quantite", x: PAGE.MARGIN_X + 170, width: 70, align: "right" },
    { key: "pu", label: "Prix unit.", x: PAGE.MARGIN_X + 250, width: 80, align: "right" },
    { key: "total", label: "Montant HT", x: PAGE.MARGIN_X + 340, width: 100, align: "right" },
  ];
  b.drawTableHeader(finCols, lang);
  b.drawTableRow(finCols, { poste: "ITE mur opaque", qty: `${wallNetArea.toFixed(1)} m2`, pu: `${pxITE} EUR/m2`, total: `${cITE.toFixed(0)} EUR` });
  b.drawTableRow(finCols, { poste: "Retours linteau", qty: `${ret.totLL.toFixed(1)} ml`, pu: `${pxRet} EUR/ml`, total: `${(ret.totLL * pxRet).toFixed(0)} EUR` });
  b.drawTableRow(finCols, { poste: "Retours appui", qty: `${ret.totLA.toFixed(1)} ml`, pu: `${pxRet} EUR/ml`, total: `${(ret.totLA * pxRet).toFixed(0)} EUR` });
  b.drawTableRow(finCols, { poste: "Retours tableau", qty: `${ret.totLT.toFixed(1)} ml`, pu: `${pxRet} EUR/ml`, total: `${(ret.totLT * pxRet).toFixed(0)} EUR` });
  b.drawTableRow(finCols, { poste: "Echafaudage", qty: `${facadeAreaM2.toFixed(1)} m2`, pu: `${pxEch} EUR/m2`, total: `${cEch.toFixed(0)} EUR` });
  b.drawTableTotalRow(finCols, { poste: "TOTAL HT", qty: "", pu: "", total: `${cTotal.toFixed(0)} EUR` });

  // Stamp
  b.moveDown(15);
  b.page.drawText(safeTxt("ESTIMATIF -- A titre indicatif uniquement"), {
    x: PAGE.MARGIN_X,
    y: b.y,
    size: TYPO.STAMP,
    font: b.fontOblique,
    color: C.GRAY_500,
  });

  // ═══════════════════════════════════════════════════════════
  // PAGE 4+: Elements table
  // ═══════════════════════════════════════════════════════════
  b.newPage();
  b.drawSectionTitle("Elements detectes");
  b.moveDown(8);

  const elCols: ColDef[] = [
    { key: "id", label: "ID", x: PAGE.MARGIN_X, width: 25, align: "left" },
    { key: "type", label: "Type", x: PAGE.MARGIN_X + 28, width: 55, align: "left" },
    { key: "etage", label: "Etage", x: PAGE.MARGIN_X + 86, width: 30, align: "right" },
    { key: "surface", label: "m2", x: PAGE.MARGIN_X + 120, width: 45, align: "right" },
    { key: "perim", label: "Perim.", x: PAGE.MARGIN_X + 170, width: 40, align: "right" },
    { key: "l", label: "L (m)", x: PAGE.MARGIN_X + 215, width: 38, align: "right" },
    { key: "h", label: "H (m)", x: PAGE.MARGIN_X + 258, width: 38, align: "right" },
    { key: "lint", label: "Lint.", x: PAGE.MARGIN_X + 300, width: 38, align: "right" },
    { key: "appui", label: "Appui", x: PAGE.MARGIN_X + 342, width: 38, align: "right" },
    { key: "tab", label: "Tab.", x: PAGE.MARGIN_X + 384, width: 38, align: "right" },
    { key: "retTot", label: "Ret.tot", x: PAGE.MARGIN_X + 426, width: 45, align: "right" },
  ];
  b.drawTableHeader(elCols, lang);

  for (const l of ret.lines) {
    b.ensureSpace(TABLE.ROW_HEIGHT + 10);
    const typeName = (l.e.type === "window" || l.e.type === "other") ? "Fenetre" : l.e.type === "door" ? "Porte" : l.e.type === "balcony" ? "Balcon" : l.e.type;
    b.drawTableRow(elCols, {
      id: `${l.e.id}`,
      type: safeTxt(typeName),
      etage: `${l.e.floor_level ?? 0}`,
      surface: l.e.area_m2 != null ? fmtQty(l.e.area_m2) : "-",
      perim: l.e.perimeter_m != null ? fmtQty(l.e.perimeter_m) : "-",
      l: l.w != null ? fmtQty(l.w) : "-",
      h: l.h != null ? fmtQty(l.h) : "-",
      lint: l.lL != null ? fmtQty(l.lL) : "-",
      appui: l.lA != null ? fmtQty(l.lA) : "-",
      tab: l.lT != null ? fmtQty(l.lT) : "-",
      retTot: l.tot != null ? fmtQty(l.tot) : "-",
    });
  }

  // ═══════════════════════════════════════════════════════════
  // Last page: Plan image
  // ═══════════════════════════════════════════════════════════
  if (result.plan_b64) {
    b.newPage();
    b.drawSectionTitle("Plan de facade");
    b.moveDown(8);
    try {
      const imgBytes = Uint8Array.from(atob(result.plan_b64), c => c.charCodeAt(0));
      const pdfImage = await b.pdf.embedPng(imgBytes);
      const maxW = PAGE.TEXT_WIDTH;
      const maxH = b.y - PAGE.MARGIN_BOTTOM - 20;
      const scale = Math.min(maxW / pdfImage.width, maxH / pdfImage.height, 1);
      const drawW = pdfImage.width * scale;
      const drawH = pdfImage.height * scale;
      b.page.drawImage(pdfImage, {
        x: PAGE.MARGIN_X,
        y: b.y - drawH,
        width: drawW,
        height: drawH,
      });
    } catch (err) {
      console.warn("Failed to embed plan image in PDF:", err);
    }
  }

  // Finalize and download
  await b.saveAndDownload("rapport_facade.pdf");
}
