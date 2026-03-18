"use client";

import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFPage,
  PDFFont,
  type RGB,
} from "pdf-lib";
import { dt, DTKey } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS — Single source of truth for all FloorScan PDF exports
// ══════════════════════════════════════════════════════════════════════════════

// ── Page geometry (A4 portrait, professional margins ~17 mm) ─────────────────

export const PAGE = {
  W: 595.28,
  H: 841.89,
  MARGIN_X: 48,
  MARGIN_BOTTOM: 50,
  TEXT_WIDTH: 595.28 - 2 * 48, // 499.28
} as const;

// ── Header / footer heights ──────────────────────────────────────────────────

export const HEADER = {
  HEIGHT: 56,
  LOGO_SIZE: 18,
  SUBTITLE_SIZE: 9,
  DATE_SIZE: 8,
} as const;

export const COVER = {
  HEIGHT: 180,
  LOGO_SIZE: 32,
  TITLE_SIZE: 14,
  INFO_LABEL_W: 130,
} as const;

export const FOOTER = {
  HEIGHT: 30,
  LINE_Y: 30,
  TEXT_Y: 12,
  SIZE: 7,
} as const;

// ── Typography scale ─────────────────────────────────────────────────────────

export const TYPO = {
  SECTION_TITLE: 13,
  LOT_TITLE: 11,
  BODY: 9,
  TABLE_HEADER: 7.5,
  TABLE_CELL: 8,
  TABLE_TOTAL: 8.5,
  CAPTION: 7,
  STAMP: 10,
  COVER_BRAND: 32,
  COVER_SUBTITLE: 14,
  COVER_INFO_LABEL: 10,
  COVER_INFO_VALUE: 11,
} as const;

// ── Table row heights ────────────────────────────────────────────────────────

export const TABLE = {
  ROW_HEIGHT: 16,
  HEADER_ROW_HEIGHT: 18,
  TOTAL_ROW_HEIGHT: 20,
  BORDER_WIDTH: 0.5,
} as const;

// ── Colour palette ───────────────────────────────────────────────────────────

export const C = {
  // Brand — professional navy palette
  BLUE: rgb(0.09, 0.22, 0.44),        // Deep navy (headers, bars, main accents)
  BLUE_MED: rgb(0.22, 0.51, 0.78),    // Medium blue (column separators on dark bg)
  BLUE_LIGHT: rgb(0.72, 0.84, 0.96),  // Light blue (text/subtle elements on dark bg)
  BLUE_PALE: rgb(0.93, 0.96, 1.00),   // Very light blue (TTC box, alternating bg)

  // Neutrals
  WHITE: rgb(1, 1, 1),
  DARK: rgb(0.12, 0.15, 0.22),
  GRAY_700: rgb(0.39, 0.46, 0.54),
  GRAY_500: rgb(0.50, 0.55, 0.62),
  GRAY_400: rgb(0.60, 0.65, 0.72),
  GRAY_300: rgb(0.75, 0.78, 0.83),    // Medium border / separators
  GRAY_200: rgb(0.86, 0.88, 0.91),    // Light border / hairlines
  GRAY_100: rgb(0.94, 0.95, 0.97),    // Very light bg
  BG_SUBTLE: rgb(0.96, 0.97, 0.99),   // Alternating row background

  // Semantic
  GREEN: rgb(0.15, 0.68, 0.38),
  GREEN_PALE: rgb(0.90, 0.97, 0.92),
  RED: rgb(0.82, 0.22, 0.22),
  RED_PALE: rgb(0.98, 0.91, 0.91),
  AMBER: rgb(0.82, 0.52, 0.04),
  AMBER_PALE: rgb(0.99, 0.95, 0.86),

  // Accent
  VIOLET: rgb(0.55, 0.33, 0.97),
  VIOLET_PALE: rgb(0.93, 0.90, 1.00),
} as const;

// ── Column layout shared between dpgf-pdf & devis-pdf ────────────────────────

export interface ColDef {
  key: string;
  label: string;
  x: number;
  width: number;
  align?: "left" | "right";
  integer?: boolean;
}

export const DPGF_COLS: ColDef[] = [
  { key: "description", label: "dpgf_desc", x: 52, width: 285, align: "left" },   // ends at 337
  { key: "quantity", label: "dpgf_qty", x: 345, width: 42, align: "right" },       // ends at 387
  { key: "unit", label: "dpgf_unit", x: 393, width: 32, align: "left" },           // ends at 425
  { key: "unit_price", label: "dpgf_pu_ht", x: 431, width: 58, align: "right" },  // ends at 489
  { key: "total_ht", label: "dpgf_total_line", x: 492, width: 55, align: "right" }, // ends at 547 ✓
];

// ══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Replace WinAnsi-incompatible chars so pdf-lib's StandardFonts don't throw.
 */
export function safeTxt(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2014/g, "--")
    .replace(/\u2013/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/\u20AC/g, "EUR")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

/**
 * Translate an i18n key, returning safeTxt-cleaned text.
 */
export function d(key: string, lang: Lang): string {
  try {
    return safeTxt(dt(key as DTKey, lang));
  } catch {
    return safeTxt(key);
  }
}

/**
 * Truncate text to fit within maxWidth pixels using the given font/size.
 */
export function truncateText(
  text: string,
  maxWidth: number,
  f: PDFFont,
  size: number
): string {
  if (f.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && f.widthOfTextAtSize(t + "...", size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "...";
}

/**
 * Word-wrap text to fit within maxWidth. Returns array of lines.
 */
export function wrapText(
  text: string,
  f: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? current + " " + word : word;
    if (f.widthOfTextAtSize(test, size) > maxWidth) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Format quantity with 2 decimals — French locale (e.g. "12,34").
 */
export function fmtQty(n: number): string {
  const s = n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return s.replace(/[\u202F\u00A0]/g, " ");
}

/**
 * Format price with 2 decimals + EUR — French locale (e.g. "1 234,56 EUR").
 */
export function fmtPrice(n: number): string {
  const s = n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return s.replace(/[\u202F\u00A0]/g, " ") + " EUR";
}

/**
 * Format integer (doors, windows counts).
 */
export function fmtInt(n: number): string {
  return String(Math.round(n));
}

/**
 * Format a date string using fr-FR locale.
 */
export function fmtDate(date?: string): string {
  if (date) return date;
  return new Date().toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// PdfBuilder — Fluent page manager with deferred footers for "Page N / M"
// ══════════════════════════════════════════════════════════════════════════════

export interface PdfBuilderOpts {
  docType: string;       // e.g. "DPGF", "DEVIS", "RAPPORT"
  docSubtitle: string;   // e.g. translated title line
  dateStr: string;       // pre-formatted date
  rightMeta?: string;    // optional second line in header (project name, etc.)
  lang: Lang;
}

export class PdfBuilder {
  pdf: PDFDocument;
  font!: PDFFont;
  fontBold!: PDFFont;
  fontOblique!: PDFFont;

  page!: PDFPage;
  y = 0;
  pageNum = 0;
  pages: PDFPage[] = [];

  private opts: PdfBuilderOpts;
  private rowIndex = 0; // for alternating row colors

  private constructor(pdf: PDFDocument, opts: PdfBuilderOpts) {
    this.pdf = pdf;
    this.opts = opts;
  }

  /**
   * Factory: create a PdfBuilder with embedded fonts.
   */
  static async create(opts: PdfBuilderOpts): Promise<PdfBuilder> {
    const pdf = await PDFDocument.create();
    const builder = new PdfBuilder(pdf, opts);
    builder.font = await pdf.embedFont(StandardFonts.Helvetica);
    builder.fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    builder.fontOblique = await pdf.embedFont(StandardFonts.HelveticaOblique);
    return builder;
  }

  // ── Page management ──────────────────────────────────────────────────────

  /**
   * Create a new page with white background and standard header.
   * Footer is deferred until finalize() to support "Page N / M".
   */
  newPage(): PDFPage {
    this.pageNum++;
    const p = this.pdf.addPage([PAGE.W, PAGE.H]);
    this.pages.push(p);
    this.page = p;

    // White background
    p.drawRectangle({ x: 0, y: 0, width: PAGE.W, height: PAGE.H, color: C.WHITE });

    // Header band
    p.drawRectangle({
      x: 0,
      y: PAGE.H - HEADER.HEIGHT,
      width: PAGE.W,
      height: HEADER.HEIGHT,
      color: C.BLUE,
    });

    // Brand name
    p.drawText("FloorScan", {
      x: PAGE.MARGIN_X,
      y: PAGE.H - 34,
      size: HEADER.LOGO_SIZE,
      font: this.fontBold,
      color: C.WHITE,
    });

    // Doc subtitle
    p.drawText(this.opts.docSubtitle, {
      x: PAGE.MARGIN_X,
      y: PAGE.H - 50,
      size: HEADER.SUBTITLE_SIZE,
      font: this.font,
      color: C.BLUE_LIGHT,
    });

    // Date (right side)
    p.drawText(this.opts.dateStr, {
      x: PAGE.W - PAGE.MARGIN_X - this.font.widthOfTextAtSize(this.opts.dateStr, HEADER.DATE_SIZE),
      y: PAGE.H - 34,
      size: HEADER.DATE_SIZE,
      font: this.font,
      color: C.WHITE,
    });

    // Optional right meta (project name)
    if (this.opts.rightMeta) {
      const meta = this.opts.rightMeta.length > 35
        ? this.opts.rightMeta.slice(0, 35) + "..."
        : this.opts.rightMeta;
      p.drawText(meta, {
        x: PAGE.W - PAGE.MARGIN_X - this.font.widthOfTextAtSize(meta, 7.5),
        y: PAGE.H - 48,
        size: 7.5,
        font: this.font,
        color: C.BLUE_LIGHT,
      });
    }

    // Thin separator line below header
    p.drawRectangle({
      x: 0,
      y: PAGE.H - HEADER.HEIGHT - 0.75,
      width: PAGE.W,
      height: 0.75,
      color: C.BLUE_PALE,
    });

    this.y = PAGE.H - HEADER.HEIGHT - 20;
    this.rowIndex = 0;
    return p;
  }

  /**
   * Ensure at least `needed` pts of vertical space remain.
   * If not, start a new page.
   */
  ensureSpace(needed: number): void {
    if (this.y < needed + PAGE.MARGIN_BOTTOM) {
      this.newPage();
    }
  }

  /**
   * Get current Y and advance cursor down.
   */
  moveDown(pts: number): void {
    this.y -= pts;
  }

  // ── Cover page ───────────────────────────────────────────────────────────

  /**
   * Draw a large cover page (rapport, devis).
   * Returns the Y cursor position after the info block.
   */
  drawCoverPage(opts: {
    title: string;
    subtitle?: string;
    infoLines: [string, string][];
  }): void {
    this.pageNum++;
    const p = this.pdf.addPage([PAGE.W, PAGE.H]);
    this.pages.push(p);
    this.page = p;

    // White bg
    p.drawRectangle({ x: 0, y: 0, width: PAGE.W, height: PAGE.H, color: C.WHITE });

    // Large blue band
    p.drawRectangle({
      x: 0,
      y: PAGE.H - COVER.HEIGHT,
      width: PAGE.W,
      height: COVER.HEIGHT,
      color: C.BLUE,
    });

    // Brand
    p.drawText("FloorScan", {
      x: PAGE.MARGIN_X,
      y: PAGE.H - 70,
      size: COVER.LOGO_SIZE,
      font: this.fontBold,
      color: C.WHITE,
    });

    // Title
    p.drawText(opts.title, {
      x: PAGE.MARGIN_X,
      y: PAGE.H - 105,
      size: COVER.TITLE_SIZE,
      font: this.font,
      color: C.BLUE_LIGHT,
    });

    // Subtitle
    if (opts.subtitle) {
      p.drawText(opts.subtitle, {
        x: PAGE.MARGIN_X,
        y: PAGE.H - 125,
        size: TYPO.BODY,
        font: this.font,
        color: C.BLUE_LIGHT,
      });
    }

    // Date in header right
    p.drawText(this.opts.dateStr, {
      x: PAGE.W - PAGE.MARGIN_X - this.font.widthOfTextAtSize(this.opts.dateStr, HEADER.DATE_SIZE),
      y: PAGE.H - 50,
      size: HEADER.DATE_SIZE,
      font: this.font,
      color: C.BLUE_LIGHT,
    });

    // Info block below blue band
    this.y = PAGE.H - COVER.HEIGHT - 30;

    for (const [label, value] of opts.infoLines) {
      p.drawText(safeTxt(label + " :"), {
        x: PAGE.MARGIN_X,
        y: this.y,
        size: TYPO.COVER_INFO_LABEL,
        font: this.font,
        color: C.GRAY_500,
      });
      p.drawText(safeTxt(value), {
        x: PAGE.MARGIN_X + COVER.INFO_LABEL_W,
        y: this.y,
        size: TYPO.COVER_INFO_VALUE,
        font: this.fontBold,
        color: C.DARK,
      });
      this.y -= 22;
    }
  }

  // ── Section helpers ──────────────────────────────────────────────────────

  /**
   * Draw a section title with a thick blue vertical bar.
   */
  drawSectionTitle(title: string): void {
    this.ensureSpace(30);

    // Vertical accent bar (3pt wide, 18pt tall)
    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: this.y - 4,
      width: 3,
      height: 18,
      color: C.BLUE,
    });

    this.page.drawText(title, {
      x: PAGE.MARGIN_X + 10,
      y: this.y,
      size: TYPO.SECTION_TITLE,
      font: this.fontBold,
      color: C.DARK,
    });

    this.y -= 26;
  }

  /**
   * Draw a horizontal separator line.
   */
  drawSectionSeparator(): void {
    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: this.y + 4,
      width: PAGE.TEXT_WIDTH,
      height: 0.75,
      color: C.GRAY_200,
    });
    this.y -= 8;
  }

  /**
   * Draw a "lot" header bar — navy band with left accent stripe.
   */
  drawLotHeader(title: string): void {
    this.ensureSpace(65);

    const barH = 26;

    // Navy main bar
    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: this.y - 5,
      width: PAGE.TEXT_WIDTH,
      height: barH,
      color: C.BLUE,
    });

    // Left accent stripe (medium blue, 5pt wide)
    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: this.y - 5,
      width: 5,
      height: barH,
      color: C.BLUE_MED,
    });

    this.page.drawText(title, {
      x: PAGE.MARGIN_X + 14,
      y: this.y + 3,
      size: TYPO.LOT_TITLE,
      font: this.fontBold,
      color: C.WHITE,
    });
    this.y -= barH + 6;
  }

  /**
   * Draw a WIP/estimatif stamp badge.
   */
  drawStamp(text: string): void {
    const stampW = this.fontBold.widthOfTextAtSize(text, TYPO.STAMP) + 24;
    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: this.y - 4,
      width: stampW,
      height: 20,
      color: C.AMBER_PALE,
      borderColor: C.AMBER,
      borderWidth: 1,
    });
    this.page.drawText(text, {
      x: PAGE.MARGIN_X + 12,
      y: this.y + 2,
      size: TYPO.STAMP,
      font: this.fontBold,
      color: C.AMBER,
    });
    this.y -= 32;
  }

  // ── Table helpers ────────────────────────────────────────────────────────

  /**
   * Draw a table header row with navy background, white text, and column separators.
   */
  drawTableHeader(cols: ColDef[], lang: Lang): void {
    const rowY = this.y - 4;
    const rowH = TABLE.HEADER_ROW_HEIGHT;

    // Top outer border
    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: rowY + rowH,
      width: PAGE.TEXT_WIDTH,
      height: 0.75,
      color: C.BLUE,
    });

    // Header background (full width)
    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: rowY,
      width: PAGE.TEXT_WIDTH,
      height: rowH,
      color: C.BLUE,
    });

    // Vertical column separators (medium blue, subtle on navy)
    for (let i = 1; i < cols.length; i++) {
      const prev = cols[i - 1];
      const curr = cols[i];
      const sepX = Math.round((prev.x + prev.width + curr.x) / 2);
      this.page.drawRectangle({
        x: sepX,
        y: rowY,
        width: 0.5,
        height: rowH,
        color: C.BLUE_MED,
      });
    }

    // Column labels
    for (const col of cols) {
      const label = d(col.label, lang);
      const displayLabel = truncateText(label, col.width - 4, this.fontBold, TYPO.TABLE_HEADER);
      const textX = col.align === "right"
        ? col.x + col.width - this.fontBold.widthOfTextAtSize(displayLabel, TYPO.TABLE_HEADER)
        : col.x + 2;
      this.page.drawText(displayLabel, {
        x: textX,
        y: this.y,
        size: TYPO.TABLE_HEADER,
        font: this.fontBold,
        color: C.WHITE,
      });
    }

    this.y -= rowH + 2;
    this.rowIndex = 0;
  }

  /**
   * Draw a single table data row with alternating bg, outer borders, and column separators.
   */
  drawTableRow(
    cols: ColDef[],
    values: Record<string, string>,
    opts?: {
      font?: PDFFont;
      color?: RGB;
      skipAlternate?: boolean;
    }
  ): void {
    this.ensureSpace(TABLE.ROW_HEIGHT + 10);

    const rowY = this.y - 4;
    const rowH = TABLE.ROW_HEIGHT;

    // Alternating subtle background
    if (!opts?.skipAlternate && this.rowIndex % 2 === 0) {
      this.page.drawRectangle({
        x: PAGE.MARGIN_X,
        y: rowY,
        width: PAGE.TEXT_WIDTH,
        height: rowH,
        color: C.BG_SUBTLE,
      });
    }

    // Left outer border
    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: rowY,
      width: 0.75,
      height: rowH,
      color: C.GRAY_300,
    });

    // Right outer border
    this.page.drawRectangle({
      x: PAGE.W - PAGE.MARGIN_X - 0.75,
      y: rowY,
      width: 0.75,
      height: rowH,
      color: C.GRAY_300,
    });

    // Vertical column separators
    for (let i = 1; i < cols.length; i++) {
      const prev = cols[i - 1];
      const curr = cols[i];
      const sepX = Math.round((prev.x + prev.width + curr.x) / 2);
      this.page.drawRectangle({
        x: sepX,
        y: rowY,
        width: 0.4,
        height: rowH,
        color: C.GRAY_200,
      });
    }

    const f = opts?.font ?? this.font;
    const color = opts?.color ?? C.DARK;

    for (const col of cols) {
      const val = values[col.key] ?? "";
      const displayVal = truncateText(val, col.width - 4, f, TYPO.TABLE_CELL);
      const textX = col.align === "right"
        ? col.x + col.width - f.widthOfTextAtSize(displayVal, TYPO.TABLE_CELL)
        : col.x + 2;
      this.page.drawText(displayVal, {
        x: textX,
        y: this.y,
        size: TYPO.TABLE_CELL,
        font: f,
        color,
      });
    }

    // Hairline separator at bottom of row
    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: rowY,
      width: PAGE.TEXT_WIDTH,
      height: 0.3,
      color: C.GRAY_200,
    });

    this.y -= rowH;
    this.rowIndex++;
  }

  /**
   * Draw a total/subtotal row with pale background, outer borders, and column separators.
   */
  drawTableTotalRow(
    cols: ColDef[],
    values: Record<string, string>,
    opts?: { bg?: RGB; color?: RGB; label?: string }
  ): void {
    this.ensureSpace(TABLE.TOTAL_ROW_HEIGHT + 10);

    const bg = opts?.bg ?? C.BLUE_PALE;
    const color = opts?.color ?? C.BLUE;

    this.y -= 2;
    const rowY = this.y - 5;
    const rowH = TABLE.TOTAL_ROW_HEIGHT;

    // Background
    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: rowY,
      width: PAGE.TEXT_WIDTH,
      height: rowH,
      color: bg,
    });

    // Left outer border
    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: rowY,
      width: 0.75,
      height: rowH,
      color: C.GRAY_300,
    });

    // Right outer border
    this.page.drawRectangle({
      x: PAGE.W - PAGE.MARGIN_X - 0.75,
      y: rowY,
      width: 0.75,
      height: rowH,
      color: C.GRAY_300,
    });

    // Vertical column separators
    for (let i = 1; i < cols.length; i++) {
      const prev = cols[i - 1];
      const curr = cols[i];
      const sepX = Math.round((prev.x + prev.width + curr.x) / 2);
      this.page.drawRectangle({
        x: sepX,
        y: rowY,
        width: 0.4,
        height: rowH,
        color: C.GRAY_300,
      });
    }

    for (const col of cols) {
      const val = values[col.key] ?? "";
      const f = this.fontBold;
      const displayVal = truncateText(val, col.width - 4, f, TYPO.TABLE_TOTAL);
      const textX = col.align === "right"
        ? col.x + col.width - f.widthOfTextAtSize(displayVal, TYPO.TABLE_TOTAL)
        : col.x + 2;
      this.page.drawText(displayVal, {
        x: textX,
        y: this.y,
        size: TYPO.TABLE_TOTAL,
        font: f,
        color,
      });
    }

    // Bottom border for total row
    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: rowY,
      width: PAGE.TEXT_WIDTH,
      height: 0.75,
      color: C.GRAY_300,
    });

    this.y -= rowH + 8;
    this.rowIndex = 0;
  }

  // ── Text helpers ─────────────────────────────────────────────────────────

  /**
   * Draw a single line of text at current Y position.
   */
  drawText(
    text: string,
    opts?: { x?: number; size?: number; font?: PDFFont; color?: RGB; indent?: number }
  ): void {
    const x = (opts?.x ?? PAGE.MARGIN_X) + (opts?.indent ?? 0);
    this.page.drawText(safeTxt(text), {
      x,
      y: this.y,
      size: opts?.size ?? TYPO.BODY,
      font: opts?.font ?? this.font,
      color: opts?.color ?? C.DARK,
    });
  }

  /**
   * Draw wrapped (multi-line) text and advance Y.
   */
  drawWrappedText(
    text: string,
    opts?: { indent?: number; size?: number; font?: PDFFont; color?: RGB; lineHeight?: number }
  ): void {
    const indent = opts?.indent ?? 0;
    const size = opts?.size ?? TYPO.BODY;
    const f = opts?.font ?? this.font;
    const color = opts?.color ?? C.DARK;
    const lh = opts?.lineHeight ?? 13;
    const maxW = PAGE.TEXT_WIDTH - indent;

    const lines = wrapText(safeTxt(text), f, size, maxW);
    for (const ln of lines) {
      this.ensureSpace(lh + 20);
      this.page.drawText(ln, {
        x: PAGE.MARGIN_X + indent,
        y: this.y,
        size,
        font: f,
        color,
      });
      this.y -= lh;
    }
  }

  /**
   * Draw an info line: "Label : Value" with fixed label width.
   */
  drawInfoLine(
    label: string,
    value: string,
    opts?: { labelWidth?: number; size?: number }
  ): void {
    const labelW = opts?.labelWidth ?? COVER.INFO_LABEL_W;
    const size = opts?.size ?? TYPO.BODY;
    this.page.drawText(safeTxt(label + " :"), {
      x: PAGE.MARGIN_X,
      y: this.y,
      size,
      font: this.font,
      color: C.GRAY_700,
    });
    this.page.drawText(safeTxt(value), {
      x: PAGE.MARGIN_X + labelW,
      y: this.y,
      size,
      font: this.fontBold,
      color: C.DARK,
    });
    this.y -= 18;
  }

  // ── Score badge (compliance) ─────────────────────────────────────────────

  /**
   * Draw a coloured score badge.
   */
  drawScoreBadge(text: string, score: number): void {
    const badgeColor = score >= 80 ? C.GREEN : score >= 50 ? C.AMBER : C.RED;
    const paleBg = score >= 80 ? C.GREEN_PALE : score >= 50 ? C.AMBER_PALE : C.RED_PALE;
    const badgeW = this.fontBold.widthOfTextAtSize(text, 16) + 30;

    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: this.y - 6,
      width: badgeW,
      height: 28,
      color: paleBg,
      borderColor: badgeColor,
      borderWidth: 1.5,
    });
    this.page.drawText(text, {
      x: PAGE.MARGIN_X + 15,
      y: this.y + 2,
      size: 16,
      font: this.fontBold,
      color: badgeColor,
    });
    this.y -= 40;
  }

  // ── Grand totals block (DPGF/Devis) ─────────────────────────────────────

  /**
   * Draw the HT / TVA / TTC totals block with professional bordered box.
   */
  drawGrandTotals(totalHt: number, tvaRate: number, tvaAmount: number, totalTtc: number, lang: Lang): void {
    this.ensureSpace(110);

    const labelX = 360;
    const rightEdge = PAGE.W - PAGE.MARGIN_X; // 547.28
    const boxX = labelX - 16;
    const boxW = rightEdge - boxX;

    // Outer box (light gray background, medium border)
    this.page.drawRectangle({
      x: boxX,
      y: this.y - 90,
      width: boxW,
      height: 96,
      color: C.GRAY_100,
      borderColor: C.GRAY_300,
      borderWidth: 0.75,
    });

    // Navy top bar of the totals box
    this.page.drawRectangle({
      x: boxX,
      y: this.y - 90 + 96 - 4,
      width: boxW,
      height: 4,
      color: C.BLUE,
    });

    this.y -= 14;

    // Total HT
    this.page.drawText(d("dpgf_total_ht", lang), {
      x: labelX,
      y: this.y,
      size: 10,
      font: this.fontBold,
      color: C.DARK,
    });
    const htText = fmtPrice(totalHt);
    this.page.drawText(htText, {
      x: rightEdge - this.fontBold.widthOfTextAtSize(htText, 10),
      y: this.y,
      size: 10,
      font: this.fontBold,
      color: C.DARK,
    });
    this.y -= 20;

    // TVA
    const tvaLabel = `${d("dpgf_tva", lang)} (${tvaRate}%)`;
    this.page.drawText(tvaLabel, {
      x: labelX,
      y: this.y,
      size: 10,
      font: this.font,
      color: C.GRAY_500,
    });
    const tvaText = fmtPrice(tvaAmount);
    this.page.drawText(tvaText, {
      x: rightEdge - this.font.widthOfTextAtSize(tvaText, 10),
      y: this.y,
      size: 10,
      font: this.font,
      color: C.GRAY_500,
    });
    this.y -= 8;

    // Separator before TTC
    this.page.drawRectangle({
      x: boxX + 8,
      y: this.y,
      width: boxW - 16,
      height: 0.5,
      color: C.GRAY_300,
    });
    this.y -= 14;

    // Total TTC (highlighted row inside the box)
    this.page.drawRectangle({
      x: boxX,
      y: this.y - 8,
      width: boxW,
      height: 32,
      color: C.BLUE_PALE,
    });
    this.page.drawText(d("dpgf_total_ttc", lang), {
      x: labelX,
      y: this.y + 2,
      size: 13,
      font: this.fontBold,
      color: C.BLUE,
    });
    const ttcText = fmtPrice(totalTtc);
    this.page.drawText(ttcText, {
      x: rightEdge - this.fontBold.widthOfTextAtSize(ttcText, 13),
      y: this.y + 2,
      size: 13,
      font: this.fontBold,
      color: C.BLUE,
    });
    this.y -= 40;
  }

  // ── Conditions block (Devis) ─────────────────────────────────────────────

  /**
   * Draw a list of label/value condition rows (payment terms, validity, etc.).
   */
  drawConditionsBlock(rows: [string, string][]): void {
    const labelW = 155;
    for (const [label, value] of rows) {
      this.page.drawText(safeTxt(`${label} :`), {
        x: PAGE.MARGIN_X,
        y: this.y,
        size: TYPO.BODY,
        font: this.fontBold,
        color: C.DARK,
      });
      this.page.drawText(safeTxt(value), {
        x: PAGE.MARGIN_X + labelW,
        y: this.y,
        size: TYPO.BODY,
        font: this.font,
        color: C.DARK,
      });
      this.y -= 14;
    }
  }

  // ── Signature pair (Devis) ───────────────────────────────────────────────

  /**
   * Draw two side-by-side signature boxes (client left, company right).
   */
  drawSignaturePair(leftLabel: string, rightLabel: string, rightSubLabel?: string): void {
    const sigW = (PAGE.TEXT_WIDTH - 30) / 2;
    const entries: [number, string, string | undefined][] = [
      [PAGE.MARGIN_X, leftLabel, undefined],
      [PAGE.MARGIN_X + sigW + 30, rightLabel, rightSubLabel],
    ];

    for (const [x, label, sub] of entries) {
      this.page.drawRectangle({
        x,
        y: this.y - 80,
        width: sigW,
        height: 90,
        color: C.WHITE,
        borderColor: C.GRAY_200,
        borderWidth: TABLE.BORDER_WIDTH,
      });
      this.page.drawText(safeTxt(label), {
        x: x + 10, y: this.y - 2, size: TYPO.BODY, font: this.fontBold, color: C.DARK,
      });
      if (sub) {
        this.page.drawText(safeTxt(sub), {
          x: x + 10, y: this.y - 16, size: TYPO.TABLE_CELL, font: this.font, color: C.GRAY_700,
        });
      }
      this.page.drawText("Date:", {
        x: x + 10, y: this.y - 40, size: TYPO.TABLE_CELL, font: this.font, color: C.GRAY_700,
      });
      this.page.drawText("Signature:", {
        x: x + 10, y: this.y - 55, size: TYPO.TABLE_CELL, font: this.font, color: C.GRAY_700,
      });
    }
    this.y -= 90;
  }

  // ── Finalize ─────────────────────────────────────────────────────────────

  /**
   * Draw footers on ALL pages with "Page N / M" and save.
   */
  finalize(): void {
    const total = this.pages.length;
    const { lang } = this.opts;

    for (let i = 0; i < total; i++) {
      const p = this.pages[i];
      const num = i + 1;

      // Footer separator line
      p.drawRectangle({
        x: PAGE.MARGIN_X,
        y: FOOTER.LINE_Y,
        width: PAGE.TEXT_WIDTH,
        height: 0.5,
        color: C.GRAY_200,
      });

      // Left: "FloorScan -- DocType"
      const leftText = `FloorScan -- ${this.opts.docType}`;
      p.drawText(leftText, {
        x: PAGE.MARGIN_X,
        y: FOOTER.TEXT_Y,
        size: FOOTER.SIZE,
        font: this.font,
        color: C.GRAY_400,
      });

      // Center: date
      const dateW = this.font.widthOfTextAtSize(this.opts.dateStr, FOOTER.SIZE);
      p.drawText(this.opts.dateStr, {
        x: (PAGE.W - dateW) / 2,
        y: FOOTER.TEXT_Y,
        size: FOOTER.SIZE,
        font: this.font,
        color: C.GRAY_400,
      });

      // Right: "Page N / M"
      const pageText = `Page ${num} / ${total}`;
      const pageW = this.font.widthOfTextAtSize(pageText, FOOTER.SIZE);
      p.drawText(pageText, {
        x: PAGE.W - PAGE.MARGIN_X - pageW,
        y: FOOTER.TEXT_Y,
        size: FOOTER.SIZE,
        font: this.font,
        color: C.GRAY_400,
      });
    }
  }

  /**
   * Finalize, save to blob, and trigger browser download.
   */
  async saveAndDownload(filename: string): Promise<void> {
    this.finalize();
    const bytes = await this.pdf.save();
    const blob = new Blob([bytes as unknown as ArrayBuffer], {
      type: "application/pdf",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
