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
  HEIGHT: 48,
  LOGO_SIZE: 16,
  SUBTITLE_SIZE: 8,
  DATE_SIZE: 7.5,
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
  // ── Dark theme backgrounds ──
  DARK_BG:     rgb(0.06, 0.07, 0.09),    // #0f1117 — main background
  DARK_CARD:   rgb(0.10, 0.12, 0.16),    // #1a1e28 — card/section background
  DARK_BORDER: rgb(0.18, 0.20, 0.26),    // #2e3342 — borders
  DARK_ROW:    rgb(0.08, 0.09, 0.12),    // #14171e — alternating row

  // ── Brand accents ──
  CYAN:        rgb(0.13, 0.83, 0.93),    // #22d3ee — primary accent
  ACCENT:      rgb(0.40, 0.55, 1.00),    // #668eff — secondary accent

  // ── Text ──
  WHITE:       rgb(1, 1, 1),
  GRAY_100:    rgb(0.90, 0.92, 0.95),    // light text
  GRAY_300:    rgb(0.58, 0.63, 0.70),    // secondary text
  GRAY_400:    rgb(0.48, 0.52, 0.58),    // labels
  GRAY_500:    rgb(0.38, 0.42, 0.48),    // muted
  GRAY_700:    rgb(0.25, 0.28, 0.33),    // very muted

  // ── Semantic ──
  GREEN:       rgb(0.15, 0.68, 0.38),
  GREEN_PALE:  rgb(0.10, 0.25, 0.18),    // dark green bg
  RED:         rgb(0.82, 0.22, 0.22),
  RED_PALE:    rgb(0.30, 0.12, 0.12),    // dark red bg
  AMBER:       rgb(0.82, 0.52, 0.04),
  AMBER_PALE:  rgb(0.28, 0.20, 0.08),   // dark amber bg
  VIOLET:      rgb(0.55, 0.33, 0.97),
  VIOLET_PALE: rgb(0.20, 0.15, 0.30),   // dark violet bg

  // ── Legacy aliases (for backward compat) ──
  BLUE:        rgb(0.06, 0.07, 0.09),    // was navy, now dark bg
  BLUE_MED:    rgb(0.13, 0.83, 0.93),    // was medium blue, now cyan
  BLUE_LIGHT:  rgb(0.58, 0.63, 0.70),    // was light blue, now gray
  BLUE_PALE:   rgb(0.10, 0.12, 0.16),    // was pale blue, now dark card
  DARK:        rgb(0.90, 0.92, 0.95),    // was dark text, now light (inverted for dark theme)
  BG_SUBTLE:   rgb(0.08, 0.09, 0.12),    // alternating rows
  GRAY_200:    rgb(0.18, 0.20, 0.26),    // remapped to dark border
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

    // Dark background (entire page)
    p.drawRectangle({ x: 0, y: 0, width: PAGE.W, height: PAGE.H, color: C.DARK_BG });

    // Header band
    p.drawRectangle({
      x: 0,
      y: PAGE.H - HEADER.HEIGHT,
      width: PAGE.W,
      height: HEADER.HEIGHT,
      color: C.DARK_BG,
    });

    // Brand name — "Floor" in white, "Scan" in cyan
    const floorW = this.fontBold.widthOfTextAtSize("Floor", HEADER.LOGO_SIZE);
    p.drawText("Floor", {
      x: PAGE.MARGIN_X,
      y: PAGE.H - 30,
      size: HEADER.LOGO_SIZE,
      font: this.fontBold,
      color: C.WHITE,
    });
    p.drawText("Scan", {
      x: PAGE.MARGIN_X + floorW,
      y: PAGE.H - 30,
      size: HEADER.LOGO_SIZE,
      font: this.fontBold,
      color: C.CYAN,
    });

    // Doc subtitle
    p.drawText(this.opts.docSubtitle, {
      x: PAGE.MARGIN_X,
      y: PAGE.H - 43,
      size: HEADER.SUBTITLE_SIZE,
      font: this.font,
      color: C.GRAY_300,
    });

    // Date (right side)
    p.drawText(this.opts.dateStr, {
      x: PAGE.W - PAGE.MARGIN_X - this.font.widthOfTextAtSize(this.opts.dateStr, HEADER.DATE_SIZE),
      y: PAGE.H - 30,
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
        y: PAGE.H - 43,
        size: 7.5,
        font: this.font,
        color: C.GRAY_300,
      });
    }

    // Cyan accent line below header
    p.drawRectangle({
      x: 0,
      y: PAGE.H - HEADER.HEIGHT - 1,
      width: PAGE.W,
      height: 1,
      color: C.CYAN,
    });

    this.y = PAGE.H - HEADER.HEIGHT - 16; // 16pt padding below header
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

    // Dark background (full page)
    p.drawRectangle({ x: 0, y: 0, width: PAGE.W, height: PAGE.H, color: C.DARK_BG });

    // Large dark card band
    p.drawRectangle({
      x: 0,
      y: PAGE.H - COVER.HEIGHT,
      width: PAGE.W,
      height: COVER.HEIGHT,
      color: C.DARK_CARD,
    });

    // Brand — "Floor" white, "Scan" cyan
    const coverFloorW = this.fontBold.widthOfTextAtSize("Floor", COVER.LOGO_SIZE);
    p.drawText("Floor", {
      x: PAGE.MARGIN_X,
      y: PAGE.H - 70,
      size: COVER.LOGO_SIZE,
      font: this.fontBold,
      color: C.WHITE,
    });
    p.drawText("Scan", {
      x: PAGE.MARGIN_X + coverFloorW,
      y: PAGE.H - 70,
      size: COVER.LOGO_SIZE,
      font: this.fontBold,
      color: C.CYAN,
    });

    // Title
    p.drawText(opts.title, {
      x: PAGE.MARGIN_X,
      y: PAGE.H - 105,
      size: COVER.TITLE_SIZE,
      font: this.font,
      color: C.GRAY_300,
    });

    // Subtitle
    if (opts.subtitle) {
      p.drawText(opts.subtitle, {
        x: PAGE.MARGIN_X,
        y: PAGE.H - 125,
        size: TYPO.BODY,
        font: this.font,
        color: C.GRAY_300,
      });
    }

    // Date in header right
    p.drawText(this.opts.dateStr, {
      x: PAGE.W - PAGE.MARGIN_X - this.font.widthOfTextAtSize(this.opts.dateStr, HEADER.DATE_SIZE),
      y: PAGE.H - 50,
      size: HEADER.DATE_SIZE,
      font: this.font,
      color: C.GRAY_300,
    });

    // Cyan accent line below cover band
    p.drawRectangle({
      x: 0,
      y: PAGE.H - COVER.HEIGHT - 1,
      width: PAGE.W,
      height: 1,
      color: C.CYAN,
    });

    // Info block below cover band
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
        color: C.GRAY_100,
      });
      this.y -= 22;
    }
  }

  // ── Section helpers ──────────────────────────────────────────────────────

  /**
   * Draw a section title with a cyan vertical bar and dark card background.
   */
  drawSectionTitle(title: string): void {
    this.ensureSpace(30);

    // Subtle dark card band behind title
    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: this.y - 6,
      width: PAGE.TEXT_WIDTH,
      height: 22,
      color: C.DARK_CARD,
    });

    // Vertical cyan accent bar (3pt wide, 22pt tall)
    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: this.y - 6,
      width: 3,
      height: 22,
      color: C.CYAN,
    });

    this.page.drawText(title, {
      x: PAGE.MARGIN_X + 10,
      y: this.y,
      size: TYPO.SECTION_TITLE,
      font: this.fontBold,
      color: C.WHITE,
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
      color: C.DARK_BORDER,
    });
    this.y -= 8;
  }

  /**
   * Draw a "lot" header bar — dark card band with left cyan accent stripe.
   */
  drawLotHeader(title: string): void {
    this.ensureSpace(65);

    const barH = 26;

    // Dark card main bar
    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: this.y - 5,
      width: PAGE.TEXT_WIDTH,
      height: barH,
      color: C.DARK_CARD,
    });

    // Left accent stripe (cyan, 5pt wide)
    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: this.y - 5,
      width: 5,
      height: barH,
      color: C.CYAN,
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
   * Draw a table header row with dark card background, cyan text, and column separators.
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
      color: C.DARK_BORDER,
    });

    // Header background (full width)
    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: rowY,
      width: PAGE.TEXT_WIDTH,
      height: rowH,
      color: C.DARK_CARD,
    });

    // Vertical column separators (dark border, subtle on dark card)
    for (let i = 1; i < cols.length; i++) {
      const prev = cols[i - 1];
      const curr = cols[i];
      const sepX = Math.round((prev.x + prev.width + curr.x) / 2);
      this.page.drawRectangle({
        x: sepX,
        y: rowY,
        width: 0.5,
        height: rowH,
        color: C.DARK_BORDER,
      });
    }

    // Column labels (cyan text)
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
        color: C.CYAN,
      });
    }

    this.y -= rowH + 2;
    this.rowIndex = 0;
  }

  /**
   * Draw a single table data row with alternating dark bg, outer borders, and column separators.
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

    // Alternating dark background
    if (!opts?.skipAlternate && this.rowIndex % 2 === 0) {
      this.page.drawRectangle({
        x: PAGE.MARGIN_X,
        y: rowY,
        width: PAGE.TEXT_WIDTH,
        height: rowH,
        color: C.DARK_ROW,
      });
    }

    // Left outer border
    this.page.drawRectangle({
      x: PAGE.MARGIN_X,
      y: rowY,
      width: 0.75,
      height: rowH,
      color: C.DARK_BORDER,
    });

    // Right outer border
    this.page.drawRectangle({
      x: PAGE.W - PAGE.MARGIN_X - 0.75,
      y: rowY,
      width: 0.75,
      height: rowH,
      color: C.DARK_BORDER,
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
        color: C.DARK_BORDER,
      });
    }

    const f = opts?.font ?? this.font;
    const color = opts?.color ?? C.GRAY_100;

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
      color: C.DARK_BORDER,
    });

    this.y -= rowH;
    this.rowIndex++;
  }

  /**
   * Draw a total/subtotal row with dark card background, outer borders, and column separators.
   */
  drawTableTotalRow(
    cols: ColDef[],
    values: Record<string, string>,
    opts?: { bg?: RGB; color?: RGB; label?: string }
  ): void {
    this.ensureSpace(TABLE.TOTAL_ROW_HEIGHT + 10);

    const bg = opts?.bg ?? C.DARK_CARD;
    const color = opts?.color ?? C.CYAN;

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
      color: C.DARK_BORDER,
    });

    // Right outer border
    this.page.drawRectangle({
      x: PAGE.W - PAGE.MARGIN_X - 0.75,
      y: rowY,
      width: 0.75,
      height: rowH,
      color: C.DARK_BORDER,
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
        color: C.DARK_BORDER,
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
      color: C.DARK_BORDER,
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

    // Outer box (dark card background, dark border)
    this.page.drawRectangle({
      x: boxX,
      y: this.y - 90,
      width: boxW,
      height: 96,
      color: C.DARK_CARD,
      borderColor: C.DARK_BORDER,
      borderWidth: 0.75,
    });

    // Cyan top bar of the totals box
    this.page.drawRectangle({
      x: boxX,
      y: this.y - 90 + 96 - 4,
      width: boxW,
      height: 4,
      color: C.CYAN,
    });

    this.y -= 14;

    // Total HT
    this.page.drawText(d("dpgf_total_ht", lang), {
      x: labelX,
      y: this.y,
      size: 10,
      font: this.fontBold,
      color: C.GRAY_100,
    });
    const htText = fmtPrice(totalHt);
    this.page.drawText(htText, {
      x: rightEdge - this.fontBold.widthOfTextAtSize(htText, 10),
      y: this.y,
      size: 10,
      font: this.fontBold,
      color: C.GRAY_100,
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
      color: C.DARK_BORDER,
    });
    this.y -= 14;

    // Total TTC (highlighted row inside the box)
    this.page.drawRectangle({
      x: boxX,
      y: this.y - 8,
      width: boxW,
      height: 32,
      color: C.DARK_ROW,
    });
    this.page.drawText(d("dpgf_total_ttc", lang), {
      x: labelX,
      y: this.y + 2,
      size: 13,
      font: this.fontBold,
      color: C.CYAN,
    });
    const ttcText = fmtPrice(totalTtc);
    this.page.drawText(ttcText, {
      x: rightEdge - this.fontBold.widthOfTextAtSize(ttcText, 13),
      y: this.y + 2,
      size: 13,
      font: this.fontBold,
      color: C.CYAN,
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
        color: C.DARK_CARD,
        borderColor: C.DARK_BORDER,
        borderWidth: TABLE.BORDER_WIDTH,
      });
      this.page.drawText(safeTxt(label), {
        x: x + 10, y: this.y - 2, size: TYPO.BODY, font: this.fontBold, color: C.GRAY_100,
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

      // Footer separator line (cyan accent)
      p.drawRectangle({
        x: PAGE.MARGIN_X,
        y: FOOTER.LINE_Y,
        width: PAGE.TEXT_WIDTH,
        height: 0.5,
        color: C.CYAN,
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
