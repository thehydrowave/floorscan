"use client";

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "pdf-lib";
import type { AnalysisResult, CustomDetection } from "@/lib/types";
import { computeMetre } from "@/lib/metre-calculator";
import { buildDefaultDpgf } from "@/lib/dpgf-defaults";
import { runComplianceChecks } from "@/lib/compliance-checker";
import { dt, DTKey } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";

// ── Constants ──────────────────────────────────────────────────────────────────

const W = 595.28;
const H = 841.89;
const MX = 40;
const BLUE = rgb(0.055, 0.647, 0.914);
const WHITE = rgb(1, 1, 1);
const DARK = rgb(0.18, 0.22, 0.3);
const GRAY = rgb(0.5, 0.55, 0.62);
const GREEN = rgb(0.204, 0.827, 0.600);
const RED = rgb(0.973, 0.443, 0.443);
const AMBER = rgb(0.984, 0.749, 0.141);
const BG = rgb(0.96, 0.97, 0.99);

export interface RapportOptions {
  projectName: string;
  projectAddress: string;
  clientName: string;
  companyName: string;
  date: string;
  ceilingHeight: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function d(key: string, lang: Lang): string {
  try { return dt(key as DTKey, lang); } catch { return key; }
}

function safeTxt(s: string): string {
  // pdf-lib StandardFonts only support WinAnsi; strip unsupported chars
  return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

// ── Main ───────────────────────────────────────────────────────────────────────

export async function downloadRapportPdf(
  result: AnalysisResult,
  customDetections: CustomDetection[],
  lang: string,
  options: RapportOptions,
): Promise<void> {
  const l = lang as Lang;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  const dateStr = options.date || new Date().toLocaleDateString("fr-FR");
  const sf = result.surfaces ?? {};
  const rooms = result.rooms ?? [];

  // Compute derived data
  const metre = computeMetre(result, { ceilingHeight: options.ceilingHeight });
  const dpgf = buildDefaultDpgf(result, customDetections, { ceilingHeight: options.ceilingHeight });
  const compliance = runComplianceChecks(result, { ceilingHeight: options.ceilingHeight });

  let pageNum = 0;

  // ── Page utilities ──────────────────────────────────────────────────────────

  function newPage(): PDFPage {
    const p = pdf.addPage([W, H]);
    pageNum++;
    // White bg
    p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: WHITE });
    return p;
  }

  function drawFooter(p: PDFPage) {
    const footY = 25;
    p.drawText(safeTxt(d("rap_disclaimer", l)), {
      x: MX, y: footY, size: 6, font, color: GRAY,
    });
    p.drawText(`${pageNum}`, {
      x: W - MX - 10, y: footY, size: 7, font, color: GRAY,
    });
  }

  function drawSmallHeader(p: PDFPage, title: string) {
    p.drawRectangle({ x: 0, y: H - 50, width: W, height: 50, color: BLUE });
    p.drawText("FloorScan", { x: MX, y: H - 32, size: 16, font: fontB, color: WHITE });
    p.drawText(safeTxt(title), { x: MX, y: H - 46, size: 8, font, color: rgb(0.85, 0.95, 1) });
    p.drawText(safeTxt(dateStr), { x: W - MX - 80, y: H - 32, size: 8, font, color: WHITE });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 1 : Cover page
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const p = newPage();
    // Large blue header bar
    p.drawRectangle({ x: 0, y: H - 220, width: W, height: 220, color: BLUE });
    p.drawText("FloorScan", { x: MX, y: H - 80, size: 36, font: fontB, color: WHITE });
    p.drawText(safeTxt(d("rap_cover_title", l)), {
      x: MX, y: H - 115, size: 16, font, color: rgb(0.85, 0.95, 1),
    });
    // Project info
    let cy = H - 260;
    const infoLines: [string, string][] = [
      [d("rap_project", l), options.projectName || "—"],
      [d("rap_address", l), options.projectAddress || "—"],
      [d("rap_client", l), options.clientName || "—"],
      [d("rap_company", l), options.companyName || "—"],
      [d("rap_date", l), dateStr],
    ];
    for (const [label, value] of infoLines) {
      p.drawText(safeTxt(label + " :"), { x: MX, y: cy, size: 10, font, color: GRAY });
      p.drawText(safeTxt(value), { x: MX + 120, y: cy, size: 11, font: fontB, color: DARK });
      cy -= 22;
    }
    drawFooter(p);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 2 : Summary KPIs
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const p = newPage();
    drawSmallHeader(p, d("rap_summary", l));

    let y = H - 80;
    const kpis: [string, string][] = [
      ["Portes detectees", String(result.doors_count ?? 0)],
      ["Fenetres detectees", String(result.windows_count ?? 0)],
      ["Pieces detectees", String(rooms.length)],
      ["Surface habitable", `${(sf.area_hab_m2 ?? 0).toFixed(2)} m2`],
      ["Surface murs", `${(sf.area_walls_m2 ?? 0).toFixed(2)} m2`],
      ["Perimetre interieur", `${(sf.perim_interior_m ?? 0).toFixed(2)} m`],
      ["Emprise batiment", `${(sf.area_building_m2 ?? 0).toFixed(2)} m2`],
      ["Score conformite", `${compliance.score_pct.toFixed(0)}% (${compliance.pass_count}P / ${compliance.fail_count}F / ${compliance.warn_count}W)`],
      ["Estimation cout TTC", dpgf.total_ttc != null ? `${dpgf.total_ttc.toFixed(0)} EUR` : "N/A"],
      ["Pixels/metre", result.pixels_per_meter ? result.pixels_per_meter.toFixed(2) : "N/A"],
    ];

    for (let i = 0; i < kpis.length; i++) {
      const [label, value] = kpis[i];
      const rowY = y - i * 28;
      // Alternating bg
      if (i % 2 === 0) {
        p.drawRectangle({ x: MX - 5, y: rowY - 8, width: W - 2 * MX + 10, height: 24, color: BG });
      }
      p.drawText(safeTxt(label), { x: MX, y: rowY, size: 10, font, color: DARK });
      p.drawText(safeTxt(value), { x: W - MX - 180, y: rowY, size: 11, font: fontB, color: BLUE });
    }

    drawFooter(p);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 3 : Plan image (if available)
  // ═══════════════════════════════════════════════════════════════════════════
  const planB64 = result.overlay_openings_b64 || result.plan_b64;
  if (planB64) {
    const p = newPage();
    drawSmallHeader(p, d("rap_plan", l));

    try {
      const bytes = Uint8Array.from(atob(planB64), c => c.charCodeAt(0));
      const img = await pdf.embedPng(bytes);
      const maxW = W - 2 * MX;
      const maxH = H - 140;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const iw = img.width * scale;
      const ih = img.height * scale;
      p.drawImage(img, {
        x: (W - iw) / 2,
        y: H - 70 - ih,
        width: iw,
        height: ih,
      });
    } catch (e) {
      p.drawText("(Image could not be embedded)", { x: MX, y: H - 100, size: 10, font, color: GRAY });
    }

    drawFooter(p);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 4+ : Room details table
  // ═══════════════════════════════════════════════════════════════════════════
  if (metre.rooms.length > 0) {
    let p = newPage();
    drawSmallHeader(p, d("rap_rooms_table", l));
    let y = H - 80;

    // Table header
    const headers = ["Piece", "Sol m2", "Perim m", "Murs m2", "Plafond m2", "Portes", "Fenetres"];
    const colX = [MX, MX + 130, MX + 200, MX + 270, MX + 350, MX + 430, MX + 475];

    const drawTableHeader = (page: PDFPage, yy: number) => {
      page.drawRectangle({ x: MX - 5, y: yy - 6, width: W - 2 * MX + 10, height: 18, color: BLUE });
      headers.forEach((h, i) => {
        page.drawText(h, { x: colX[i], y: yy, size: 7.5, font: fontB, color: WHITE });
      });
    };

    drawTableHeader(p, y);
    y -= 24;

    for (let i = 0; i < metre.rooms.length; i++) {
      if (y < 60) {
        drawFooter(p);
        p = newPage();
        drawSmallHeader(p, d("rap_rooms_table", l));
        y = H - 80;
        drawTableHeader(p, y);
        y -= 24;
      }

      const r = metre.rooms[i];
      if (i % 2 === 0) {
        p.drawRectangle({ x: MX - 5, y: y - 6, width: W - 2 * MX + 10, height: 16, color: BG });
      }

      const vals = [
        safeTxt(r.room_label).substring(0, 22),
        r.floor_area_m2.toFixed(2),
        r.perimeter_m.toFixed(2),
        r.wall_area_net_m2.toFixed(2),
        r.ceiling_area_m2.toFixed(2),
        String(r.doors_count),
        String(r.windows_count),
      ];
      vals.forEach((v, ci) => {
        p.drawText(v, { x: colX[ci], y: y, size: 8, font: ci === 0 ? fontB : font, color: DARK });
      });
      y -= 18;
    }

    // Totals row
    if (y < 60) {
      drawFooter(p);
      p = newPage();
      drawSmallHeader(p, d("rap_rooms_table", l));
      y = H - 80;
    }
    p.drawRectangle({ x: MX - 5, y: y - 8, width: W - 2 * MX + 10, height: 20, color: rgb(0.9, 0.95, 1) });
    const t = metre.totals;
    const totVals = ["TOTAL", t.floor_area_m2.toFixed(2), t.perimeter_m.toFixed(2),
      t.wall_area_net_m2.toFixed(2), t.ceiling_area_m2.toFixed(2),
      String(t.doors_count), String(t.windows_count)];
    totVals.forEach((v, ci) => {
      p.drawText(v, { x: colX[ci], y: y - 2, size: 8.5, font: fontB, color: BLUE });
    });

    drawFooter(p);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE : DPGF summary
  // ═══════════════════════════════════════════════════════════════════════════
  if (dpgf.lots.length > 0) {
    let p = newPage();
    drawSmallHeader(p, d("rap_dpgf_summary", l));
    let y = H - 80;

    // Header row
    p.drawRectangle({ x: MX - 5, y: y - 6, width: W - 2 * MX + 10, height: 18, color: BLUE });
    p.drawText("Lot", { x: MX, y: y, size: 8, font: fontB, color: WHITE });
    p.drawText("Total HT", { x: W - MX - 80, y: y, size: 8, font: fontB, color: WHITE });
    y -= 24;

    for (const lot of dpgf.lots) {
      if (y < 80) {
        drawFooter(p);
        p = newPage();
        drawSmallHeader(p, d("rap_dpgf_summary", l));
        y = H - 80;
      }
      const lotLabel = safeTxt(d(lot.title_key, l)).substring(0, 50);
      p.drawText(`${lot.lot_number}. ${lotLabel}`, { x: MX, y: y, size: 9, font, color: DARK });
      p.drawText(`${lot.subtotal_ht.toFixed(2)} EUR`, { x: W - MX - 100, y: y, size: 9, font: fontB, color: DARK });
      y -= 20;
    }

    // Totals
    y -= 5;
    p.drawRectangle({ x: MX - 5, y: y - 10, width: W - 2 * MX + 10, height: 50, color: rgb(0.93, 0.96, 1) });
    p.drawText("Total HT", { x: MX, y: y + 20, size: 10, font, color: DARK });
    p.drawText(`${dpgf.total_ht.toFixed(2)} EUR`, { x: W - MX - 120, y: y + 20, size: 11, font: fontB, color: DARK });
    p.drawText(`TVA ${(dpgf.tva_rate * 100).toFixed(0)}%`, { x: MX, y: y + 4, size: 10, font, color: GRAY });
    p.drawText(`${dpgf.tva_amount.toFixed(2)} EUR`, { x: W - MX - 120, y: y + 4, size: 10, font, color: GRAY });
    p.drawText("Total TTC", { x: MX, y: y - 12, size: 11, font: fontB, color: BLUE });
    p.drawText(`${dpgf.total_ttc.toFixed(2)} EUR`, { x: W - MX - 120, y: y - 12, size: 12, font: fontB, color: BLUE });

    drawFooter(p);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE : Compliance summary
  // ═══════════════════════════════════════════════════════════════════════════
  {
    let p = newPage();
    drawSmallHeader(p, d("rap_compliance", l));
    let y = H - 80;

    // Score bar
    p.drawText(`Score: ${compliance.score_pct.toFixed(0)}%`, {
      x: MX, y: y, size: 14, font: fontB,
      color: compliance.score_pct >= 80 ? GREEN : compliance.score_pct >= 50 ? AMBER : RED,
    });
    p.drawText(
      `${compliance.pass_count} pass | ${compliance.fail_count} fail | ${compliance.warn_count} warning | ${compliance.na_count} N/A`,
      { x: MX, y: y - 18, size: 9, font, color: GRAY },
    );
    y -= 45;

    // List checks
    for (const check of compliance.checks) {
      if (y < 60) {
        drawFooter(p);
        p = newPage();
        drawSmallHeader(p, d("rap_compliance", l));
        y = H - 80;
      }
      const statusColor = check.status === "pass" ? GREEN
        : check.status === "fail" ? RED
        : check.status === "warning" ? AMBER : GRAY;
      const statusLabel = check.status.toUpperCase();

      p.drawText(statusLabel, { x: MX, y: y, size: 7, font: fontB, color: statusColor });
      const ruleText = safeTxt(d(check.rule_key, l)).substring(0, 70);
      p.drawText(ruleText, { x: MX + 50, y: y, size: 8, font, color: DARK });
      p.drawText(safeTxt(`${check.target} | ${check.actual}`), {
        x: W - MX - 140, y: y, size: 7, font, color: GRAY,
      });
      y -= 16;
    }

    drawFooter(p);
  }

  // ── Save & download ──────────────────────────────────────────────────────────

  const pdfBytes = await pdf.save();
  const blob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `floorscan_rapport_${options.projectName?.replace(/\s+/g, "_") || "projet"}_${new Date().toISOString().slice(0, 10)}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
