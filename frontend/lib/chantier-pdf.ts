"use client";

import type {
  ChantierProjet, ChantierPiece, InventaireArticle, Reserve, BudgetLot,
  TacheStatut, ReserveNiveau, ReserveStatut,
} from "@/lib/chantier-types";
import {
  progressionPiece, progressionGlobale,
  inventaireStats, reservesStats, budgetStats,
  CATEGORIE_LABELS, STATUT_LABELS, STATUT_COLORS,
  INVENTAIRE_STATUT_LABELS, INVENTAIRE_CAT_LABELS,
  RESERVE_STATUT_LABELS, RESERVE_NIVEAU_LABELS, RESERVE_NIVEAU_COLORS,
} from "@/lib/chantier-types";
import type { Lang } from "@/lib/i18n";
import {
  PdfBuilder,
  PAGE,
  TABLE,
  TYPO,
  C,
  fmtDate,
  fmtPrice,
  safeTxt,
  type ColDef,
} from "@/lib/pdf-theme";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChantierRapportOptions {
  date?: string;
  includeInventaire?: boolean;
  includeReserves?: boolean;
  includeBudget?: boolean;
}

// ── Colonnes tableaux ─────────────────────────────────────────────────────────

const AVANCEMENT_COLS: ColDef[] = [
  { key: "piece",    label: "Piece",          x: 52,  width: 140, align: "left" },
  { key: "aire",     label: "Surf. (m2)",      x: 196, width: 60,  align: "right" },
  { key: "total",    label: "Taches",          x: 260, width: 50,  align: "right" },
  { key: "termine",  label: "Terminees",       x: 314, width: 60,  align: "right" },
  { key: "encours",  label: "En cours",        x: 378, width: 60,  align: "right" },
  { key: "bloque",   label: "Bloquees",        x: 442, width: 55,  align: "right" },
  { key: "pct",      label: "Avancement",      x: 500, width: 48,  align: "right" },
];

const TACHE_COLS: ColDef[] = [
  { key: "cat",      label: "Categorie",       x: 52,  width: 110, align: "left" },
  { key: "label",    label: "Tache",           x: 166, width: 210, align: "left" },
  { key: "statut",   label: "Statut",          x: 380, width: 80,  align: "left" },
  { key: "entreprise",label: "Entreprise",     x: 464, width: 84,  align: "left" },
];

const INVENTAIRE_COLS: ColDef[] = [
  { key: "designation", label: "Designation",  x: 52,  width: 140, align: "left" },
  { key: "categorie",   label: "Categorie",    x: 196, width: 90,  align: "left" },
  { key: "qteCmd",      label: "Cmd",          x: 290, width: 44,  align: "right" },
  { key: "qteLiv",      label: "Livr.",        x: 338, width: 44,  align: "right" },
  { key: "qtePose",     label: "Pose",         x: 386, width: 44,  align: "right" },
  { key: "unite",       label: "Unite",        x: 434, width: 34,  align: "left" },
  { key: "montant",     label: "Montant HT",   x: 472, width: 76,  align: "right" },
];

const RESERVE_COLS: ColDef[] = [
  { key: "num",      label: "N°",              x: 52,  width: 28,  align: "left" },
  { key: "titre",    label: "Titre",           x: 84,  width: 180, align: "left" },
  { key: "niveau",   label: "Niveau",          x: 268, width: 70,  align: "left" },
  { key: "statut",   label: "Statut",          x: 342, width: 70,  align: "left" },
  { key: "piece",    label: "Piece",           x: 416, width: 80,  align: "left" },
  { key: "date",     label: "Date",            x: 500, width: 48,  align: "left" },
];

const BUDGET_COLS: ColDef[] = [
  { key: "lot",      label: "Lot",             x: 52,  width: 120, align: "left" },
  { key: "initial",  label: "Budget init. HT", x: 176, width: 90,  align: "right" },
  { key: "revise",   label: "Budget rev. HT",  x: 270, width: 90,  align: "right" },
  { key: "engage",   label: "Engage HT",       x: 364, width: 80,  align: "right" },
  { key: "facture",  label: "Facture HT",      x: 448, width: 80,  align: "right" },
  { key: "ecart",    label: "Ecart",           x: 530, width: 60,  align: "right" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt2(v: number | null | undefined, suffix = ""): string {
  if (v == null) return "—";
  return v.toFixed(2) + suffix;
}

function fmtDate2(iso?: string): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("fr-FR"); } catch { return iso; }
}

function fmtPct(v: number): string { return `${v}%`; }

function drawKpiGrid(b: PdfBuilder, items: { label: string; value: string; sub?: string }[]): void {
  const cols  = 3;
  const cellW = (PAGE.TEXT_WIDTH - 16) / cols;
  const cellH = 50;
  const rows  = Math.ceil(items.length / cols);
  for (let r = 0; r < rows; r++) {
    b.ensureSpace(cellH + 4);
    for (let c = 0; c < cols; c++) {
      const item = items[r * cols + c];
      if (!item) continue;
      const x = PAGE.MARGIN_X + c * (cellW + 8);
      const y = b.y - cellH;
      b.page.drawRectangle({ x, y, width: cellW, height: cellH, color: C.BLUE });
      b.page.drawRectangle({ x, y, width: 4,     height: cellH, color: C.BLUE_MED });
      b.page.drawText(safeTxt(item.label), { x: x + 10, y: y + cellH - 15, size: TYPO.CAPTION, font: b.font,     color: C.BLUE_LIGHT });
      b.page.drawText(safeTxt(item.value), { x: x + 10, y: y + cellH - 32, size: 13,           font: b.fontBold, color: C.WHITE });
      if (item.sub) b.page.drawText(safeTxt(item.sub), { x: x + 10, y: y + 6, size: TYPO.CAPTION, font: b.font, color: C.BLUE_LIGHT });
    }
    b.moveDown(cellH + 6);
  }
}

function drawInfoRow(b: PdfBuilder, label: string, value: string, alt: boolean): void {
  b.ensureSpace(22);
  if (alt) b.page.drawRectangle({ x: PAGE.MARGIN_X, y: b.y - 6, width: PAGE.TEXT_WIDTH, height: 20, color: C.BG_SUBTLE });
  b.page.drawText(safeTxt(label), { x: PAGE.MARGIN_X + 8,  y: b.y, size: TYPO.BODY, font: b.font,     color: C.GRAY_500 });
  b.page.drawText(safeTxt(value), { x: PAGE.MARGIN_X + 200, y: b.y, size: TYPO.BODY, font: b.fontBold, color: C.DARK });
  b.moveDown(22);
}

// ── Barre d'avancement inline (texte) ─────────────────────────────────────────
function pctBar(pct: number): string {
  const filled = Math.round(pct / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled) + ` ${pct}%`;
}

// ══════════════════════════════════════════════════════════════════════════════
// GÉNÉRATION DU RAPPORT CHANTIER
// ══════════════════════════════════════════════════════════════════════════════

export async function downloadChantierRapportPdf(
  projet: ChantierProjet,
  opts: ChantierRapportOptions = {}
): Promise<void> {
  const {
    date,
    includeInventaire = true,
    includeReserves   = true,
    includeBudget     = true,
  } = opts;

  const dateStr = fmtDate(date);
  const pct     = progressionGlobale(projet);
  const invStats = inventaireStats(projet.inventaire ?? []);
  const resStats = reservesStats(projet.reserves ?? []);
  const budStats = budgetStats(projet.budget ?? []);

  const allTaches = projet.pieces.flatMap(p => p.taches);
  const tachesParStatut = {
    a_faire:  allTaches.filter(t => t.statut === "a_faire").length,
    en_cours: allTaches.filter(t => t.statut === "en_cours").length,
    termine:  allTaches.filter(t => t.statut === "termine").length,
    bloque:   allTaches.filter(t => t.statut === "bloque").length,
  };

  const b = await PdfBuilder.create({
    docType:     "RAPPORT DE CHANTIER",
    docSubtitle: `Suivi de chantier — ${safeTxt(projet.nom)}`,
    dateStr,
    rightMeta:   projet.nom,
    lang:        "fr" as Lang,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 1 — COUVERTURE
  // ═══════════════════════════════════════════════════════════════════════

  b.drawCoverPage({
    title:    "RAPPORT DE SUIVI DE CHANTIER",
    subtitle: "Avancement · Inventaire · Reserves · Budget",
    infoLines: [
      ["Chantier",          projet.nom],
      ["Adresse",           projet.adresse       || "—"],
      ["Conducteur",        projet.conducteur    || "—"],
      ["Date debut",        fmtDate2(projet.dateDebut)],
      ["Date livraison",    fmtDate2(projet.dateLivraison)],
      ["Date du rapport",   dateStr],
      ["Avancement global", fmtPct(pct)],
    ],
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 2 — SYNTHÈSE EXÉCUTIVE
  // ═══════════════════════════════════════════════════════════════════════

  b.newPage();
  b.drawSectionTitle("SYNTHESE EXECUTIVE");
  b.moveDown(8);

  drawKpiGrid(b, [
    { label: "Avancement global",  value: fmtPct(pct),                          sub: "taches terminees" },
    { label: "Pieces suivies",     value: String(projet.pieces.length),           sub: "nb total" },
    { label: "Taches total",       value: String(allTaches.length),               sub: "toutes pieces" },
    { label: "Terminees",          value: String(tachesParStatut.termine),        sub: "taches finies" },
    { label: "En cours",           value: String(tachesParStatut.en_cours),       sub: "en progression" },
    { label: "Bloquees",           value: String(tachesParStatut.bloque),         sub: "a debloquer" },
    { label: "Inventaire",         value: `${invStats.pose}/${invStats.total}`,   sub: "articles poses" },
    { label: "Retards livraison",  value: String(invStats.retard),               sub: "articles en retard" },
    { label: "Reserves ouvertes",  value: String(resStats.ouvertes),             sub: "a lever" },
    { label: "Reserves bloquantes",value: String(resStats.bloquantes),           sub: "urgentes" },
    { label: "Budget engage",      value: budStats.totalEngage > 0 ? `${Math.round(budStats.totalEngage).toLocaleString("fr-FR")} EUR` : "N/A", sub: "HT" },
    { label: "Budget paye",        value: budStats.totalPaye > 0 ? `${Math.round(budStats.totalPaye).toLocaleString("fr-FR")} EUR` : "N/A", sub: "HT" },
  ]);

  b.moveDown(16);
  b.drawSectionTitle("INFORMATIONS CHANTIER");
  b.moveDown(4);

  const infoRows: [string, string][] = [
    ["Nom du chantier",  projet.nom],
    ["Adresse",          projet.adresse       || "—"],
    ["Conducteur",       projet.conducteur    || "—"],
    ["Date de debut",    fmtDate2(projet.dateDebut)],
    ["Date de livraison",fmtDate2(projet.dateLivraison)],
    ["Date du rapport",  dateStr],
    ["Avancement global",fmtPct(pct)],
    ["Nb pieces",        String(projet.pieces.length)],
    ["Nb taches total",  String(allTaches.length)],
    ["Intervenants",     String((projet.intervenants ?? []).length)],
  ];
  infoRows.forEach(([label, value], i) => drawInfoRow(b, label, value, i % 2 === 0));

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 3 — AVANCEMENT PAR PIÈCE
  // ═══════════════════════════════════════════════════════════════════════

  b.newPage();
  b.drawLotHeader(`LOT 1 -- AVANCEMENT PAR PIECE (${projet.pieces.length} pieces)`);
  b.moveDown(4);
  b.drawTableHeader(AVANCEMENT_COLS, "fr" as Lang);

  let totalTaches = 0, totalTermine = 0, totalEnCours = 0, totalBloque = 0;

  for (const piece of projet.pieces) {
    const piecePct  = progressionPiece(piece);
    const termine   = piece.taches.filter(t => t.statut === "termine").length;
    const enCours   = piece.taches.filter(t => t.statut === "en_cours").length;
    const bloque    = piece.taches.filter(t => t.statut === "bloque").length;

    totalTaches  += piece.taches.length;
    totalTermine += termine;
    totalEnCours += enCours;
    totalBloque  += bloque;

    // Couleur fond selon avancement
    const rowColor =
      piecePct === 100 ? C.GREEN_PALE :
      bloque > 0       ? C.RED_PALE   :
      enCours > 0      ? C.AMBER_PALE : undefined;

    b.drawTableRow(AVANCEMENT_COLS, {
      piece:   piece.nom,
      aire:    piece.aireM2 != null ? piece.aireM2.toFixed(1) : "—",
      total:   String(piece.taches.length),
      termine: String(termine),
      encours: String(enCours),
      bloque:  String(bloque),
      pct:     fmtPct(piecePct),
    }, rowColor ? { skipAlternate: true } : undefined);

    // Si fond coloré, on le dessine après (au-dessus de la ligne)
    if (rowColor) {
      const rowY = b.y;
      b.page.drawRectangle({
        x: PAGE.MARGIN_X + 1, y: rowY,
        width: PAGE.TEXT_WIDTH - 2, height: TABLE.ROW_HEIGHT,
        color: rowColor,
      });
    }
  }

  // Total
  const totalPct = totalTaches > 0 ? Math.round(totalTermine / totalTaches * 100) : 0;
  b.drawTableTotalRow(AVANCEMENT_COLS, {
    piece:   "TOTAL CHANTIER",
    aire:    "—",
    total:   String(totalTaches),
    termine: String(totalTermine),
    encours: String(totalEnCours),
    bloque:  String(totalBloque),
    pct:     fmtPct(totalPct),
  }, { bg: C.BLUE_PALE, color: C.BLUE });

  // ═══════════════════════════════════════════════════════════════════════
  // PAGES 4+ — DÉTAIL TÂCHES PAR PIÈCE
  // ═══════════════════════════════════════════════════════════════════════

  for (const piece of projet.pieces) {
    if (piece.taches.length === 0) continue;
    b.newPage();
    b.drawLotHeader(`DETAIL — ${safeTxt(piece.nom).toUpperCase()} (${progressionPiece(piece)}% avancement)`);
    b.moveDown(4);

    // Infos pièce
    const infoP: [string, string][] = [
      ["Surface",    piece.aireM2 != null ? `${piece.aireM2.toFixed(1)} m2` : "—"],
      ["Taches",     String(piece.taches.length)],
      ["Avancement", fmtPct(progressionPiece(piece))],
    ];
    if (piece.openings) {
      infoP.push(["Portes IA",    String(piece.openings.doors)]);
      infoP.push(["Fenetres IA",  String(piece.openings.windows)]);
    }
    infoP.forEach(([lbl, val], i) => drawInfoRow(b, lbl, val, i % 2 === 0));
    b.moveDown(8);

    b.drawTableHeader(TACHE_COLS, "fr" as Lang);

    for (const tache of piece.taches) {
      const statusColor =
        tache.statut === "termine" ? C.GREEN  :
        tache.statut === "bloque"  ? C.RED    :
        tache.statut === "en_cours"? C.AMBER  : C.GRAY_400;

      b.drawTableRow(TACHE_COLS, {
        cat:        CATEGORIE_LABELS[tache.categorie] ?? tache.categorie,
        label:      tache.label,
        statut:     STATUT_LABELS[tache.statut],
        entreprise: tache.entreprise ?? "—",
      });

      // Colorier badge statut dans la colonne
      const rowY = b.y + TABLE.ROW_HEIGHT - 2;
      b.page.drawRectangle({
        x: TACHE_COLS[2].x - 1, y: rowY,
        width: TACHE_COLS[2].width + 2, height: TABLE.ROW_HEIGHT,
        color:
          tache.statut === "termine" ? C.GREEN_PALE :
          tache.statut === "bloque"  ? C.RED_PALE   :
          tache.statut === "en_cours"? C.AMBER_PALE : C.BG_SUBTLE,
      });
      b.page.drawText(safeTxt(STATUT_LABELS[tache.statut]), {
        x: TACHE_COLS[2].x + 2, y: rowY + TABLE.ROW_HEIGHT - 11,
        size: TYPO.TABLE_CELL, font: b.fontBold, color: statusColor,
      });

      // Note si présente
      if (tache.note) {
        b.ensureSpace(13);
        b.page.drawText(safeTxt(`  → ${tache.note}`), {
          x: TACHE_COLS[1].x + 4, y: b.y,
          size: TYPO.CAPTION, font: b.font, color: C.GRAY_400,
        });
        b.moveDown(13);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE — INVENTAIRE
  // ═══════════════════════════════════════════════════════════════════════

  if (includeInventaire && (projet.inventaire ?? []).length > 0) {
    b.newPage();
    b.drawLotHeader(`LOT 2 -- INVENTAIRE MATERIAUX (${projet.inventaire.length} articles)`);
    b.moveDown(4);

    // KPI inventaire
    const invKpis = [
      { label: "Articles total",   value: String(invStats.total),  sub: "references" },
      { label: "Livres",           value: String(invStats.livre),  sub: "articles livres" },
      { label: "Poses",            value: String(invStats.pose),   sub: "articles poses" },
      { label: "Retards livraison",value: String(invStats.retard), sub: "en retard" },
    ];
    // Mini grille 4 colonnes
    b.ensureSpace(46);
    const kw = (PAGE.TEXT_WIDTH - 18) / 4;
    invKpis.forEach((item, c) => {
      const cx = PAGE.MARGIN_X + c * (kw + 6);
      const cy = b.y - 40;
      const col = c === 3 && invStats.retard > 0 ? C.RED : C.BLUE;
      b.page.drawRectangle({ x: cx, y: cy, width: kw, height: 40, color: C.GRAY_100, borderColor: col, borderWidth: 1.5 });
      b.page.drawText(safeTxt(item.value), { x: cx + 8, y: cy + 22, size: 14,          font: b.fontBold, color: col });
      b.page.drawText(safeTxt(item.label), { x: cx + 8, y: cy + 8,  size: TYPO.CAPTION, font: b.font,    color: C.GRAY_500 });
    });
    b.moveDown(52);

    if (invStats.totalHT > 0) {
      drawInfoRow(b, "Total commande HT", fmtPrice(invStats.totalHT), false);
      b.moveDown(8);
    }

    b.drawTableHeader(INVENTAIRE_COLS, "fr" as Lang);

    for (const art of projet.inventaire) {
      const montant = art.prixUnitaireHT != null ? fmtPrice(art.prixUnitaireHT * art.quantiteCommandee) : "—";
      const enRetard = art.dateLivraisonPrevue && art.statut === "commande" && new Date(art.dateLivraisonPrevue) < new Date();
      b.drawTableRow(INVENTAIRE_COLS, {
        designation: art.designation,
        categorie:   INVENTAIRE_CAT_LABELS[art.categorie] ?? art.categorie,
        qteCmd:      String(art.quantiteCommandee),
        qteLiv:      String(art.quantiteLivree),
        qtePose:     String(art.quantitePosee),
        unite:       art.unite,
        montant,
      }, enRetard ? { color: C.RED } : undefined);
    }

    if (invStats.totalHT > 0) {
      b.drawTableTotalRow(INVENTAIRE_COLS, {
        designation: "TOTAL HT",
        categorie: "", qteCmd: "", qteLiv: "", qtePose: "", unite: "",
        montant: fmtPrice(invStats.totalHT),
      }, { bg: C.BLUE_PALE, color: C.BLUE });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE — RÉSERVES
  // ═══════════════════════════════════════════════════════════════════════

  if (includeReserves && (projet.reserves ?? []).length > 0) {
    b.newPage();
    b.drawLotHeader(`LOT 3 -- RESERVES (${projet.reserves.length} reserves)`);
    b.moveDown(4);

    // Mini-grille statuts
    b.ensureSpace(46);
    const rw = (PAGE.TEXT_WIDTH - 18) / 4;
    [
      { label: "Ouvertes",   value: String(resStats.ouvertes),   col: C.RED    },
      { label: "En cours",   value: String(resStats.en_cours),   col: C.AMBER  },
      { label: "Levees",     value: String(resStats.levees),     col: C.GREEN  },
      { label: "Bloquantes", value: String(resStats.bloquantes), col: C.RED    },
    ].forEach((item, c) => {
      const cx = PAGE.MARGIN_X + c * (rw + 6);
      const cy = b.y - 40;
      b.page.drawRectangle({ x: cx, y: cy, width: rw, height: 40, color: C.GRAY_100, borderColor: item.col, borderWidth: 1.5 });
      b.page.drawText(safeTxt(item.value), { x: cx + 8, y: cy + 22, size: 14,          font: b.fontBold, color: item.col });
      b.page.drawText(safeTxt(item.label), { x: cx + 8, y: cy + 8,  size: TYPO.CAPTION, font: b.font,    color: C.GRAY_500 });
    });
    b.moveDown(52);

    b.drawTableHeader(RESERVE_COLS, "fr" as Lang);

    // Trier : bloquantes d'abord, ouvertes ensuite, puis par numéro
    const sorted = [...projet.reserves].sort((a, b) => {
      const nA = a.niveau === "bloquante" ? 0 : a.niveau === "majeure" ? 1 : 2;
      const nB = b.niveau === "bloquante" ? 0 : b.niveau === "majeure" ? 1 : 2;
      if (nA !== nB) return nA - nB;
      return a.numero - b.numero;
    });

    for (const res of sorted) {
      const pieceNom = projet.pieces.find(p => p.id === res.pieceId)?.nom ?? "—";
      const niveauColor =
        res.niveau === "bloquante" ? C.RED   :
        res.niveau === "majeure"   ? C.AMBER :
        res.niveau === "mineure"   ? C.AMBER : C.GRAY_400;
      const statutColor =
        res.statut === "levee"    ? C.GREEN :
        res.statut === "en_cours" ? C.AMBER : C.RED;

      b.drawTableRow(RESERVE_COLS, {
        num:    String(res.numero),
        titre:  res.titre,
        niveau: RESERVE_NIVEAU_LABELS[res.niveau],
        statut: RESERVE_STATUT_LABELS[res.statut],
        piece:  pieceNom,
        date:   fmtDate2(res.dateConstatee),
      });

      // Colorier badge niveau
      const rowY = b.y + TABLE.ROW_HEIGHT - 2;
      b.page.drawText(safeTxt(RESERVE_NIVEAU_LABELS[res.niveau]), {
        x: RESERVE_COLS[2].x + 2, y: rowY + TABLE.ROW_HEIGHT - 11,
        size: TYPO.TABLE_CELL, font: b.fontBold, color: niveauColor,
      });

      // Description si présente
      if (res.description) {
        b.ensureSpace(13);
        b.page.drawText(safeTxt(`  ${res.description}`), {
          x: RESERVE_COLS[1].x + 4, y: b.y,
          size: TYPO.CAPTION, font: b.font, color: C.GRAY_400,
        });
        b.moveDown(13);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE — BUDGET
  // ═══════════════════════════════════════════════════════════════════════

  if (includeBudget && (projet.budget ?? []).length > 0) {
    b.newPage();
    b.drawLotHeader(`LOT 4 -- SUIVI BUDGETAIRE (${projet.budget.length} lots)`);
    b.moveDown(4);

    // Info dépassement éventuel
    if (budStats.depassement) {
      b.drawStamp(`DEPASSEMENT BUDGET : +${budStats.depassementPct}%`);
    }

    b.drawTableHeader(BUDGET_COLS, "fr" as Lang);

    for (const lot of projet.budget) {
      const revise  = lot.budgetReviseHT ?? lot.budgetInitialHT;
      const ecart   = lot.montantEngageHT - revise;
      const ecartStr = ecart > 0 ? `+${fmtPrice(ecart)}` : ecart < 0 ? fmtPrice(ecart) : "—";
      b.drawTableRow(BUDGET_COLS, {
        lot:     CATEGORIE_LABELS[lot.categorie] ?? lot.label,
        initial: fmtPrice(lot.budgetInitialHT),
        revise:  fmtPrice(revise),
        engage:  fmtPrice(lot.montantEngageHT),
        facture: fmtPrice(lot.montantFactureHT),
        ecart:   ecartStr,
      }, ecart > 0 ? { color: C.RED } : undefined);
    }

    b.drawTableTotalRow(BUDGET_COLS, {
      lot:     "TOTAL",
      initial: fmtPrice(budStats.totalInitial),
      revise:  fmtPrice(budStats.totalRevise),
      engage:  fmtPrice(budStats.totalEngage),
      facture: fmtPrice(budStats.totalFacture),
      ecart:   budStats.depassement ? `+${fmtPrice(budStats.totalEngage - budStats.totalRevise)}` : "—",
    }, { bg: budStats.depassement ? C.RED_PALE : C.BLUE_PALE, color: budStats.depassement ? C.RED : C.BLUE });

    // Bloc totaux financiers
    b.moveDown(16);
    b.drawGrandTotals(budStats.totalEngage, 0, 0, budStats.totalEngage, "fr" as Lang);
  }

  // ── Sauvegarde ────────────────────────────────────────────────────────────

  const safeName = safeTxt(projet.nom.replace(/\s+/g, "_"));
  await b.saveAndDownload(`floorscan_chantier_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
