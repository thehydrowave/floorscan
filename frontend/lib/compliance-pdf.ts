"use client";

import { PDFDocument, StandardFonts, rgb, PDFPage } from "pdf-lib";
import type {
  ComplianceResult,
  ComplianceCheck,
  CheckStatus,
  ComplianceCategory,
} from "@/lib/compliance-checker";
import { dt, DTKey } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";

// ── Constants ────────────────────────────────────────────────────────────────

const W = 595.28;
const H = 841.89;
const HEADER_HEIGHT = 70;
const FOOTER_HEIGHT = 36;
const MARGIN_X = 50;
const MARGIN_BOTTOM = 60;
const ROW_HEIGHT = 18;

const BLUE = rgb(0.055, 0.647, 0.914);
const WHITE = rgb(1, 1, 1);
const DARK = rgb(0.18, 0.22, 0.3);
const GRAY = rgb(0.6, 0.65, 0.72);
const LIGHT_GRAY = rgb(0.39, 0.46, 0.54);
const BG_SUBTLE = rgb(0.97, 0.99, 1);
const GREEN = rgb(0.15, 0.68, 0.38);
const RED = rgb(0.85, 0.25, 0.25);
const AMBER = rgb(0.85, 0.55, 0.05);

// Category label keys
const CAT_LABELS: Record<ComplianceCategory, string> = {
  pmr: "compliance_cat_pmr",
  carrez: "compliance_cat_carrez",
  rt2012: "compliance_cat_rt2012",
  ventilation: "compliance_cat_ventilation",
  nfc15100: "compliance_cat_nfc15100",
};

const CAT_ORDER: ComplianceCategory[] = [
  "pmr",
  "carrez",
  "rt2012",
  "ventilation",
  "nfc15100",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function d(key: string, lang: Lang): string {
  try {
    return dt(key as DTKey, lang);
  } catch {
    console.warn(`[i18n] Missing key: ${key}`);
    return key;
  }
}

function statusSymbol(s: CheckStatus): string {
  switch (s) {
    case "pass":
      return "✓";
    case "fail":
      return "✗";
    case "warning":
      return "⚠";
    case "na":
      return "—";
  }
}

function statusPdfColor(s: CheckStatus) {
  switch (s) {
    case "pass":
      return GREEN;
    case "fail":
      return RED;
    case "warning":
      return AMBER;
    case "na":
      return GRAY;
  }
}

// ── PDF Generation ───────────────────────────────────────────────────────────

export async function downloadCompliancePdf(
  compliance: ComplianceResult,
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
    p.drawText(d("compliance_title", l), {
      x: 40,
      y: H - 60,
      size: 10,
      font,
      color: rgb(0.9, 0.97, 1),
    });
    const dateStr = new Date().toLocaleDateString("fr-FR", {
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
  }

  function drawFooter(p: PDFPage, num: number) {
    p.drawRectangle({
      x: 0,
      y: 0,
      width: W,
      height: FOOTER_HEIGHT,
      color: BG_SUBTLE,
    });
    const footerText = "FloorScan \u00B7 " + d("compliance_pdf_footer", l);
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

  // ── Page 1 setup ──────────────────────────────────────────────────────────

  drawWhiteBg(page);
  drawHeader(page);
  y = H - HEADER_HEIGHT - 30;

  // ── Score badge ───────────────────────────────────────────────────────────

  {
    const scoreText = d("compliance_score", l).replace(
      "{n}",
      String(compliance.score_pct)
    );
    const badgeColor =
      compliance.score_pct >= 80
        ? GREEN
        : compliance.score_pct >= 50
        ? AMBER
        : RED;
    const badgeW = fontBold.widthOfTextAtSize(scoreText, 16) + 30;
    page.drawRectangle({
      x: MARGIN_X,
      y: y - 6,
      width: badgeW,
      height: 28,
      color: rgb(
        Math.min(1, badgeColor.red + 0.7),
        Math.min(1, badgeColor.green + 0.7),
        Math.min(1, badgeColor.blue + 0.7)
      ),
      borderColor: badgeColor,
      borderWidth: 1.5,
    });
    page.drawText(scoreText, {
      x: MARGIN_X + 15,
      y: y + 2,
      size: 16,
      font: fontBold,
      color: badgeColor,
    });
    y -= 40;
  }

  // Summary line
  {
    const summaryText = `${d("compliance_pass", l)}: ${compliance.pass_count}  |  ${d("compliance_fail", l)}: ${compliance.fail_count}  |  ${d("compliance_warn", l)}: ${compliance.warn_count}  |  ${d("compliance_na", l)}: ${compliance.na_count}`;
    page.drawText(summaryText, {
      x: MARGIN_X,
      y,
      size: 10,
      font,
      color: LIGHT_GRAY,
    });
    y -= 28;
  }

  // ── Category tables ───────────────────────────────────────────────────────

  for (const catKey of CAT_ORDER) {
    const catChecks = compliance.checks.filter((c) => c.category === catKey);
    if (catChecks.length === 0) continue;

    ensureSpace(60);

    // Category header
    const catTitle = d(CAT_LABELS[catKey], l);
    page.drawRectangle({
      x: MARGIN_X,
      y: y - 4,
      width: W - 2 * MARGIN_X,
      height: 22,
      color: BLUE,
    });
    page.drawText(catTitle, {
      x: MARGIN_X + 8,
      y: y + 3,
      size: 11,
      font: fontBold,
      color: WHITE,
    });
    y -= 28;

    // Table header
    page.drawRectangle({
      x: MARGIN_X,
      y: y - 3,
      width: W - 2 * MARGIN_X,
      height: ROW_HEIGHT,
      color: BG_SUBTLE,
    });
    page.drawText("Statut", {
      x: MARGIN_X + 4,
      y,
      size: 8,
      font: fontBold,
      color: LIGHT_GRAY,
    });
    page.drawText("Règle", {
      x: MARGIN_X + 50,
      y,
      size: 8,
      font: fontBold,
      color: LIGHT_GRAY,
    });
    page.drawText(d("compliance_target", l), {
      x: 360,
      y,
      size: 8,
      font: fontBold,
      color: LIGHT_GRAY,
    });
    page.drawText(d("compliance_actual", l), {
      x: 460,
      y,
      size: 8,
      font: fontBold,
      color: LIGHT_GRAY,
    });
    y -= ROW_HEIGHT + 2;

    // Rows
    for (const check of catChecks) {
      ensureSpace(ROW_HEIGHT + 20);

      // Status symbol
      page.drawText(statusSymbol(check.status), {
        x: MARGIN_X + 12,
        y,
        size: 11,
        font: fontBold,
        color: statusPdfColor(check.status),
      });

      // Rule description
      const ruleText = d(check.rule_key, l);
      const maxRuleW = 300;
      const displayRule =
        font.widthOfTextAtSize(ruleText, 9) > maxRuleW
          ? ruleText.slice(0, 45) + "..."
          : ruleText;
      page.drawText(displayRule, {
        x: MARGIN_X + 50,
        y,
        size: 9,
        font,
        color: DARK,
      });

      // Target
      page.drawText(check.target, {
        x: 360,
        y,
        size: 9,
        font,
        color: DARK,
      });

      // Actual
      page.drawText(check.actual, {
        x: 460,
        y,
        size: 9,
        font,
        color: statusPdfColor(check.status),
      });

      y -= ROW_HEIGHT;

      // Affected elements (if any)
      if (check.affected && check.affected.length > 0) {
        for (const item of check.affected) {
          ensureSpace(ROW_HEIGHT + 10);
          const itemText =
            item.length > 55 ? item.slice(0, 55) + "..." : item;
          page.drawText("  → " + itemText, {
            x: MARGIN_X + 55,
            y,
            size: 8,
            font,
            color: RED,
          });
          y -= 14;
        }
      }
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
  a.download = filename || "floorscan_conformite.pdf";
  a.click();
  URL.revokeObjectURL(url);
}
