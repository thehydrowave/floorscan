"use client";

import type {
  ComplianceResult,
  CheckStatus,
  ComplianceCategory,
} from "@/lib/compliance-checker";
import type { Lang } from "@/lib/i18n";
import {
  PdfBuilder,
  PAGE,
  TABLE,
  TYPO,
  C,
  d,
  fmtDate,
  truncateText,
  safeTxt,
  type ColDef,
} from "@/lib/pdf-theme";

// ── Category ordering ────────────────────────────────────────────────────────

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

// ── Compliance table columns ─────────────────────────────────────────────────

const COMPLIANCE_COLS: ColDef[] = [
  { key: "status", label: "compliance_status_col", x: 52, width: 36, align: "left" },
  { key: "rule", label: "compliance_rule_col", x: 96, width: 250, align: "left" },
  { key: "target", label: "compliance_target", x: 354, width: 96, align: "left" },
  { key: "actual", label: "compliance_actual", x: 456, width: 91, align: "left" }, // ends at 547 ✓
];

// ── Status helpers ───────────────────────────────────────────────────────────

function statusLabel(s: CheckStatus): string {
  switch (s) {
    case "pass": return "OK";
    case "fail": return "KO";
    case "warning": return "ATT";
    case "na": return "N/A";
  }
}

function statusColor(s: CheckStatus) {
  switch (s) {
    case "pass": return C.GREEN;
    case "fail": return C.RED;
    case "warning": return C.AMBER;
    case "na": return C.GRAY_400;
  }
}

// ── PDF Generation ───────────────────────────────────────────────────────────

export async function downloadCompliancePdf(
  compliance: ComplianceResult,
  lang: string,
  filename?: string
): Promise<void> {
  const l = lang as Lang;
  const dateStr = fmtDate();

  const b = await PdfBuilder.create({
    docType: d("compliance_title", l),
    docSubtitle: d("compliance_title", l),
    dateStr,
    lang: l,
  });

  // ── Page 1 ──────────────────────────────────────────────────────────────

  b.newPage();

  // Score badge
  const scoreText = d("compliance_score", l).replace(
    "{n}",
    String(compliance.score_pct)
  );
  b.drawScoreBadge(scoreText, compliance.score_pct);

  // Summary line
  const summaryText = `${d("compliance_pass", l)}: ${compliance.pass_count}  |  ${d("compliance_fail", l)}: ${compliance.fail_count}  |  ${d("compliance_warn", l)}: ${compliance.warn_count}  |  ${d("compliance_na", l)}: ${compliance.na_count}`;
  b.drawText(summaryText, { size: 10, color: C.GRAY_700 });
  b.moveDown(24);

  // ── Category sections ───────────────────────────────────────────────────

  for (const catKey of CAT_ORDER) {
    const catChecks = compliance.checks.filter((c) => c.category === catKey);
    if (catChecks.length === 0) continue;

    // Category title with blue accent bar
    const catTitle = d(CAT_LABELS[catKey], l);
    b.drawSectionTitle(catTitle);

    // Table header (navy background)
    const hdrY = b.y - 4;
    const hdrH = TABLE.HEADER_ROW_HEIGHT;
    b.page.drawRectangle({ x: PAGE.MARGIN_X, y: hdrY + hdrH, width: PAGE.TEXT_WIDTH, height: 0.75, color: C.BLUE });
    b.page.drawRectangle({ x: PAGE.MARGIN_X, y: hdrY, width: PAGE.TEXT_WIDTH, height: hdrH, color: C.BLUE });
    // Header column separators
    for (let i = 1; i < COMPLIANCE_COLS.length; i++) {
      const prev = COMPLIANCE_COLS[i - 1];
      const curr = COMPLIANCE_COLS[i];
      b.page.drawRectangle({ x: Math.round((prev.x + prev.width + curr.x) / 2), y: hdrY, width: 0.5, height: hdrH, color: C.BLUE_MED });
    }
    for (const col of COMPLIANCE_COLS) {
      const label = col.label.startsWith("compliance_") ? d(col.label, l) : col.label;
      b.page.drawText(truncateText(label, col.width - 4, b.fontBold, TYPO.TABLE_HEADER), {
        x: col.x + 2,
        y: b.y,
        size: TYPO.TABLE_HEADER,
        font: b.fontBold,
        color: C.WHITE,
      });
    }
    b.moveDown(hdrH + 2);

    // Check rows
    for (const check of catChecks) {
      b.ensureSpace(TABLE.ROW_HEIGHT + 20);

      const sLabel = statusLabel(check.status);
      const sColor = statusColor(check.status);
      const rowY = b.y - 4;
      const rowH = TABLE.ROW_HEIGHT;

      // Color-coded row background (very pale tint by status)
      const rowBg = check.status === "pass" ? C.GREEN_PALE
        : check.status === "fail" ? C.RED_PALE
        : check.status === "warning" ? C.AMBER_PALE
        : C.BG_SUBTLE;
      b.page.drawRectangle({ x: PAGE.MARGIN_X, y: rowY, width: PAGE.TEXT_WIDTH, height: rowH, color: rowBg });

      // Left outer border (colored by status)
      b.page.drawRectangle({ x: PAGE.MARGIN_X, y: rowY, width: 3, height: rowH, color: sColor });
      // Right outer border
      b.page.drawRectangle({ x: PAGE.W - PAGE.MARGIN_X - 0.75, y: rowY, width: 0.75, height: rowH, color: C.GRAY_300 });

      // Column separators
      for (let i = 1; i < COMPLIANCE_COLS.length; i++) {
        const prev = COMPLIANCE_COLS[i - 1];
        const curr = COMPLIANCE_COLS[i];
        b.page.drawRectangle({ x: Math.round((prev.x + prev.width + curr.x) / 2), y: rowY, width: 0.4, height: rowH, color: C.GRAY_200 });
      }

      // Status label (bold, coloured)
      b.page.drawText(sLabel, {
        x: COMPLIANCE_COLS[0].x + 6,
        y: b.y,
        size: TYPO.TABLE_CELL,
        font: b.fontBold,
        color: sColor,
      });

      // Rule description
      const ruleText = truncateText(d(check.rule_key, l), COMPLIANCE_COLS[1].width - 4, b.font, TYPO.BODY);
      b.page.drawText(ruleText, {
        x: COMPLIANCE_COLS[1].x + 2,
        y: b.y,
        size: TYPO.BODY,
        font: b.font,
        color: C.DARK,
      });

      // Target
      b.page.drawText(safeTxt(check.target), {
        x: COMPLIANCE_COLS[2].x + 2,
        y: b.y,
        size: TYPO.TABLE_CELL,
        font: b.font,
        color: C.DARK,
      });

      // Actual (coloured by status)
      b.page.drawText(safeTxt(check.actual), {
        x: COMPLIANCE_COLS[3].x + 2,
        y: b.y,
        size: TYPO.TABLE_CELL,
        font: b.font,
        color: sColor,
      });

      // Hairline at bottom
      b.page.drawRectangle({ x: PAGE.MARGIN_X, y: rowY, width: PAGE.TEXT_WIDTH, height: 0.3, color: C.GRAY_200 });

      b.moveDown(rowH);

      // Affected elements (indented, red)
      if (check.affected && check.affected.length > 0) {
        for (const item of check.affected) {
          b.ensureSpace(14 + 10);
          const itemText = truncateText(item, PAGE.TEXT_WIDTH - 70, b.font, TYPO.TABLE_CELL);
          b.page.drawText("-> " + itemText, {
            x: COMPLIANCE_COLS[1].x + 8,
            y: b.y,
            size: TYPO.TABLE_CELL,
            font: b.font,
            color: C.RED,
          });
          b.moveDown(14);
        }
      }
    }

    b.moveDown(10);
  }

  // ── Save ────────────────────────────────────────────────────────────────

  await b.saveAndDownload(filename || "floorscan_conformite.pdf");
}
