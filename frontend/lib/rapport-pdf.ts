"use client";

import type { AnalysisResult, CustomDetection } from "@/lib/types";
import { computeMetre } from "@/lib/metre-calculator";
import { buildDefaultDpgf } from "@/lib/dpgf-defaults";
import { runComplianceChecks } from "@/lib/compliance-checker";
import type { Lang } from "@/lib/i18n";
import {
  PdfBuilder,
  PAGE,
  TABLE,
  TYPO,
  C,
  d,
  fmtDate,
  fmtPrice,
  safeTxt,
  truncateText,
  type ColDef,
} from "@/lib/pdf-theme";

// ── Types ────────────────────────────────────────────────────────────────────

export interface RapportOptions {
  projectName: string;
  projectAddress: string;
  clientName: string;
  companyName: string;
  date: string;
  ceilingHeight: number;
}

// ── Room table columns ───────────────────────────────────────────────────────

const ROOM_COLS: ColDef[] = [
  { key: "room", label: "metre_room", x: 50, width: 120, align: "left" },
  { key: "floor", label: "metre_floor", x: 178, width: 60, align: "right" },
  { key: "perim", label: "metre_perim", x: 244, width: 60, align: "right" },
  { key: "walls", label: "metre_walls_net", x: 310, width: 60, align: "right" },
  { key: "ceiling", label: "metre_ceiling", x: 376, width: 60, align: "right" },
  { key: "doors", label: "metre_doors", x: 442, width: 40, align: "right" },
  { key: "windows", label: "metre_windows", x: 488, width: 40, align: "right" },
];

// ── DPGF summary columns ────────────────────────────────────────────────────

const DPGF_SUM_COLS: ColDef[] = [
  { key: "lot", label: "dpgf_desc", x: 50, width: 360, align: "left" },
  { key: "total", label: "dpgf_total_ht", x: 420, width: 120, align: "right" },
];

// ── PDF Generation ───────────────────────────────────────────────────────────

export async function downloadRapportPdf(
  result: AnalysisResult,
  customDetections: CustomDetection[],
  lang: string,
  options: RapportOptions
): Promise<void> {
  const l = lang as Lang;
  const dateStr = fmtDate(options.date);
  const sf = result.surfaces ?? {};
  const rooms = result.rooms ?? [];

  // Compute derived data
  const metre = computeMetre(result, { ceilingHeight: options.ceilingHeight });
  const dpgf = buildDefaultDpgf(result, customDetections, { ceilingHeight: options.ceilingHeight });
  const compliance = runComplianceChecks(result, { ceilingHeight: options.ceilingHeight });

  const b = await PdfBuilder.create({
    docType: d("rap_cover_title", l),
    docSubtitle: d("rap_cover_title", l),
    dateStr,
    rightMeta: options.projectName || undefined,
    lang: l,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 1 : Cover page
  // ═══════════════════════════════════════════════════════════════════════

  b.drawCoverPage({
    title: d("rap_cover_title", l),
    subtitle: safeTxt(options.projectName || ""),
    infoLines: [
      [d("rap_project", l), options.projectName || "--"],
      [d("rap_address", l), options.projectAddress || "--"],
      [d("rap_client", l), options.clientName || "--"],
      [d("rap_company", l), options.companyName || "--"],
      [d("rap_date", l), dateStr],
    ],
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 2 : Summary KPIs
  // ═══════════════════════════════════════════════════════════════════════

  b.newPage();
  b.drawSectionTitle(d("rap_summary", l));

  const kpis: [string, string][] = [
    [d("rap_kpi_doors", l) || "Portes detectees", String(result.doors_count ?? 0)],
    [d("rap_kpi_windows", l) || "Fenetres detectees", String(result.windows_count ?? 0)],
    [d("rap_kpi_rooms", l) || "Pieces detectees", String(rooms.length)],
    [d("rap_kpi_area_hab", l) || "Surface habitable", `${(sf.area_hab_m2 ?? 0).toFixed(2)} m2`],
    [d("rap_kpi_area_walls", l) || "Surface murs", `${(sf.area_walls_m2 ?? 0).toFixed(2)} m2`],
    [d("rap_kpi_perim", l) || "Perimetre interieur", `${(sf.perim_interior_m ?? 0).toFixed(2)} m`],
    [d("rap_kpi_area_building", l) || "Emprise batiment", `${(sf.area_building_m2 ?? 0).toFixed(2)} m2`],
    [d("rap_kpi_compliance", l) || "Score conformite", `${compliance.score_pct.toFixed(0)}% (${compliance.pass_count}P / ${compliance.fail_count}F / ${compliance.warn_count}W)`],
    [d("rap_kpi_cost", l) || "Estimation cout TTC", dpgf.total_ttc != null ? `${dpgf.total_ttc.toFixed(0)} EUR` : "N/A"],
    [d("rap_kpi_ppm", l) || "Pixels/metre", result.pixels_per_meter ? result.pixels_per_meter.toFixed(2) : "N/A"],
  ];

  for (let i = 0; i < kpis.length; i++) {
    const [label, value] = kpis[i];

    // Alternating bg
    if (i % 2 === 0) {
      b.page.drawRectangle({
        x: PAGE.MARGIN_X,
        y: b.y - 8,
        width: PAGE.TEXT_WIDTH,
        height: 26,
        color: C.BG_SUBTLE,
      });
    }

    b.page.drawText(safeTxt(label), {
      x: PAGE.MARGIN_X + 8,
      y: b.y,
      size: 10,
      font: b.font,
      color: C.DARK,
    });
    b.page.drawText(safeTxt(value), {
      x: PAGE.W - PAGE.MARGIN_X - b.fontBold.widthOfTextAtSize(safeTxt(value), 11) - 8,
      y: b.y,
      size: 11,
      font: b.fontBold,
      color: C.BLUE,
    });
    b.moveDown(28);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 3 : Plan image (if available)
  // ═══════════════════════════════════════════════════════════════════════

  const planB64 = result.overlay_openings_b64 || result.plan_b64;
  if (planB64) {
    b.newPage();
    b.drawSectionTitle(d("rap_plan", l));

    try {
      const bytes = Uint8Array.from(atob(planB64), (c) => c.charCodeAt(0));
      const img = await b.pdf.embedPng(bytes);
      const maxW = PAGE.TEXT_WIDTH;
      const maxH = PAGE.H - 160;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const iw = img.width * scale;
      const ih = img.height * scale;
      b.page.drawImage(img, {
        x: (PAGE.W - iw) / 2,
        y: b.y - ih,
        width: iw,
        height: ih,
      });
    } catch {
      b.drawText("(Image could not be embedded)", { color: C.GRAY_400 });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 4+ : Room details table
  // ═══════════════════════════════════════════════════════════════════════

  if (metre.rooms.length > 0) {
    b.newPage();
    b.drawSectionTitle(d("rap_rooms_table", l));

    // Table header
    b.drawTableHeader(ROOM_COLS, l);

    // Data rows
    for (const r of metre.rooms) {
      b.drawTableRow(ROOM_COLS, {
        room: r.room_label,
        floor: r.floor_area_m2.toFixed(2),
        perim: r.perimeter_m.toFixed(2),
        walls: r.wall_area_net_m2.toFixed(2),
        ceiling: r.ceiling_area_m2.toFixed(2),
        doors: String(r.doors_count),
        windows: String(r.windows_count),
      });
    }

    // Totals row
    const t = metre.totals;
    b.drawTableTotalRow(
      ROOM_COLS,
      {
        room: "TOTAL",
        floor: t.floor_area_m2.toFixed(2),
        perim: t.perimeter_m.toFixed(2),
        walls: t.wall_area_net_m2.toFixed(2),
        ceiling: t.ceiling_area_m2.toFixed(2),
        doors: String(t.doors_count),
        windows: String(t.windows_count),
      },
      { bg: C.VIOLET_PALE, color: C.VIOLET }
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DPGF summary page
  // ═══════════════════════════════════════════════════════════════════════

  if (dpgf.lots.length > 0) {
    b.newPage();
    b.drawSectionTitle(d("rap_dpgf_summary", l));

    // Table header
    b.drawTableHeader(DPGF_SUM_COLS, l);

    // Lot rows
    for (const lot of dpgf.lots) {
      b.drawTableRow(DPGF_SUM_COLS, {
        lot: `${lot.lot_number}. ${d(lot.title_key, l)}`,
        total: fmtPrice(lot.subtotal_ht),
      });
    }

    // Grand totals
    b.drawGrandTotals(dpgf.total_ht, dpgf.tva_rate, dpgf.tva_amount, dpgf.total_ttc, l);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Compliance summary page
  // ═══════════════════════════════════════════════════════════════════════

  b.newPage();
  b.drawSectionTitle(d("rap_compliance", l));

  // Score badge
  const scoreText = `Score: ${compliance.score_pct.toFixed(0)}%`;
  b.drawScoreBadge(scoreText, compliance.score_pct);

  // Summary line
  const compSummary = `${compliance.pass_count} pass | ${compliance.fail_count} fail | ${compliance.warn_count} warning | ${compliance.na_count} N/A`;
  b.drawText(compSummary, { size: TYPO.BODY, color: C.GRAY_500 });
  b.moveDown(20);

  // List checks
  for (const check of compliance.checks) {
    b.ensureSpace(TABLE.ROW_HEIGHT + 10);

    const statusColor =
      check.status === "pass" ? C.GREEN
        : check.status === "fail" ? C.RED
          : check.status === "warning" ? C.AMBER
            : C.GRAY_400;
    const statusLabel = check.status === "pass" ? "OK"
      : check.status === "fail" ? "KO"
        : check.status === "warning" ? "ATT"
          : "N/A";

    b.page.drawText(statusLabel, {
      x: PAGE.MARGIN_X + 4,
      y: b.y,
      size: TYPO.TABLE_CELL,
      font: b.fontBold,
      color: statusColor,
    });

    const ruleText = truncateText(d(check.rule_key, l), 300, b.font, TYPO.TABLE_CELL);
    b.page.drawText(ruleText, {
      x: PAGE.MARGIN_X + 40,
      y: b.y,
      size: TYPO.TABLE_CELL,
      font: b.font,
      color: C.DARK,
    });

    b.page.drawText(safeTxt(`${check.target} | ${check.actual}`), {
      x: PAGE.W - PAGE.MARGIN_X - 140,
      y: b.y,
      size: TYPO.CAPTION,
      font: b.font,
      color: C.GRAY_500,
    });

    b.moveDown(TABLE.ROW_HEIGHT);
  }

  // ── Save & download ────────────────────────────────────────────────────

  const safeName = safeTxt(options.projectName?.replace(/\s+/g, "_") || "projet");
  await b.saveAndDownload(
    `floorscan_rapport_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`
  );
}
