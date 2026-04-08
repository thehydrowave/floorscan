// lib/chantier-types.ts — Types complets pour le module de suivi de chantier

// ── Catégories de travaux ─────────────────────────────────────────────────────

export type TravauxCategorie =
  | "gros_oeuvre" | "sol" | "murs" | "plafond"
  | "menuiseries_int" | "menuiseries_ext"
  | "electricite" | "plomberie" | "chauffage"
  | "peinture" | "carrelage" | "parquet"
  | "isolation" | "placo" | "autre";

import { dt, DTKey } from "@/lib/i18n";
type Lang = "fr" | "en" | "es" | "de" | "it";

const CAT_KEYS: Record<TravauxCategorie, DTKey> = {
  gros_oeuvre: "ch_cat_gros_oeuvre" as DTKey, sol: "ch_cat_sol" as DTKey, murs: "ch_cat_murs" as DTKey, plafond: "ch_cat_plafond" as DTKey,
  menuiseries_int: "ch_cat_menuiseries_int" as DTKey, menuiseries_ext: "ch_cat_menuiseries_ext" as DTKey,
  electricite: "ch_cat_electricite" as DTKey, plomberie: "ch_cat_plomberie" as DTKey, chauffage: "ch_cat_chauffage" as DTKey,
  peinture: "ch_cat_peinture" as DTKey, carrelage: "ch_cat_carrelage" as DTKey, parquet: "ch_cat_parquet" as DTKey,
  isolation: "ch_cat_isolation" as DTKey, placo: "ch_cat_placo" as DTKey, autre: "ch_cat_autre" as DTKey,
};
export const getCategorieLabels = (lang: Lang): Record<TravauxCategorie, string> => {
  const r = {} as Record<TravauxCategorie, string>;
  for (const [k, v] of Object.entries(CAT_KEYS)) r[k as TravauxCategorie] = dt(v, lang);
  return r;
};
/** @deprecated Use getCategorieLabels(lang) — kept for backward compat */
export const CATEGORIE_LABELS: Record<TravauxCategorie, string> = {
  gros_oeuvre: "Gros œuvre", sol: "Sol", murs: "Murs / Cloisons", plafond: "Plafond",
  menuiseries_int: "Menuiseries int.", menuiseries_ext: "Menuiseries ext.",
  electricite: "Électricité", plomberie: "Plomberie", chauffage: "Chauffage / VMC",
  peinture: "Peinture", carrelage: "Carrelage", parquet: "Parquet",
  isolation: "Isolation", placo: "Plâtrerie / Placo", autre: "Autre",
};

export const CATEGORIE_ICONS: Record<TravauxCategorie, string> = {
  gros_oeuvre: "🏗️", sol: "▭", murs: "🧱", plafond: "⬆️",
  menuiseries_int: "🚪", menuiseries_ext: "🪟", electricite: "⚡", plomberie: "💧",
  chauffage: "🔥", peinture: "🖌️", carrelage: "🔲", parquet: "🪵",
  isolation: "🧊", placo: "🔨", autre: "📋",
};

export const CATEGORIE_COLORS: Record<TravauxCategorie, string> = {
  gros_oeuvre: "#6B7280", sol: "#8B5CF6", murs: "#3B82F6", plafond: "#94A3B8",
  menuiseries_int: "#F59E0B", menuiseries_ext: "#06B6D4", electricite: "#EAB308",
  plomberie: "#22D3EE", chauffage: "#F97316", peinture: "#EC4899",
  carrelage: "#14B8A6", parquet: "#D97706", isolation: "#64748B",
  placo: "#A78BFA", autre: "#94A3B8",
};

// ── Statuts tâches ────────────────────────────────────────────────────────────

export type TacheStatut = "a_faire" | "en_cours" | "termine" | "bloque";

export const getStatutLabels = (lang: Lang): Record<TacheStatut, string> => ({
  a_faire: dt("ch_st_a_faire" as DTKey, lang), en_cours: dt("ch_st_en_cours" as DTKey, lang), termine: dt("ch_st_termine" as DTKey, lang), bloque: dt("ch_st_bloque" as DTKey, lang),
});
/** @deprecated Use getStatutLabels(lang) */
export const STATUT_LABELS: Record<TacheStatut, string> = {
  a_faire: "À faire", en_cours: "En cours", termine: "Terminé", bloque: "Bloqué",
};
export const STATUT_COLORS: Record<TacheStatut, string> = {
  a_faire: "#64748B", en_cours: "#F59E0B", termine: "#10B981", bloque: "#EF4444",
};

// ── Tâche ─────────────────────────────────────────────────────────────────────

export interface ChantierTache {
  id: string;
  categorie: TravauxCategorie;
  label: string;
  statut: TacheStatut;
  note?: string;
  dateDebut?: string;
  dateFin?: string;
  entreprise?: string;
  quantite?: number;
  unite?: string;
  sourceDetection?: {
    type: "door" | "window" | "french_door";
    index: number;
    width_m?: number;
    height_m?: number;
    confidence?: number;
    openingRef?: OpeningRef;
  };
  updatedAt: string;
}

export interface OpeningRef {
  class: "door" | "window" | "french_door";
  x_px: number; y_px: number; width_px: number; height_px: number;
  width_m?: number; height_m?: number; confidence?: number;
}

// ── Pièce ─────────────────────────────────────────────────────────────────────

export interface ChantierPiece {
  id: string;
  nom: string;
  typeRoom?: string;
  aireM2?: number;
  polygonNorm?: { x: number; y: number }[];
  openings?: { doors: number; windows: number; french_doors: number };
  taches: ChantierTache[];
  note?: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTAIRE
// ─────────────────────────────────────────────────────────────────────────────

export type InventaireStatut = "commande" | "livre" | "pose" | "retour";
export const getInventaireStatutLabels = (lang: Lang): Record<InventaireStatut, string> => ({
  commande: dt("ch_inv_commande" as DTKey, lang), livre: dt("ch_inv_livre" as DTKey, lang), pose: dt("ch_inv_pose" as DTKey, lang), retour: dt("ch_inv_retour" as DTKey, lang),
});
/** @deprecated Use getInventaireStatutLabels(lang) */
export const INVENTAIRE_STATUT_LABELS: Record<InventaireStatut, string> = {
  commande: "Commandé", livre: "Livré", pose: "Posé", retour: "Retour / SAV",
};
export const INVENTAIRE_STATUT_COLORS: Record<InventaireStatut, string> = {
  commande: "#6366F1", livre: "#F59E0B", pose: "#10B981", retour: "#EF4444",
};
export const INVENTAIRE_STATUT_ICONS: Record<InventaireStatut, string> = {
  commande: "📦", livre: "🚛", pose: "✅", retour: "↩️",
};

export type InventaireCategorie =
  | "gros_oeuvre" | "menuiseries" | "electricite" | "plomberie"
  | "chauffage" | "revetements" | "isolation" | "finitions" | "equipements" | "autre";

export const getInventaireCatLabels = (lang: Lang): Record<InventaireCategorie, string> => ({
  gros_oeuvre: dt("ch_icat_gros_oeuvre" as DTKey, lang), menuiseries: dt("ch_icat_menuiseries" as DTKey, lang), electricite: dt("ch_icat_electricite" as DTKey, lang),
  plomberie: dt("ch_icat_plomberie" as DTKey, lang), chauffage: dt("ch_icat_chauffage" as DTKey, lang), revetements: dt("ch_icat_revetements" as DTKey, lang),
  isolation: dt("ch_icat_isolation" as DTKey, lang), finitions: dt("ch_icat_finitions" as DTKey, lang), equipements: dt("ch_icat_equipements" as DTKey, lang),
  autre: dt("ch_icat_autre" as DTKey, lang),
});
/** @deprecated Use getInventaireCatLabels(lang) */
export const INVENTAIRE_CAT_LABELS: Record<InventaireCategorie, string> = {
  gros_oeuvre: "Gros œuvre / Béton", menuiseries: "Menuiseries", electricite: "Électricité",
  plomberie: "Plomberie", chauffage: "Chauffage / VMC", revetements: "Revêtements",
  isolation: "Isolation", finitions: "Finitions / Peinture", equipements: "Équipements",
  autre: "Autre",
};
export const INVENTAIRE_CAT_ICONS: Record<InventaireCategorie, string> = {
  gros_oeuvre: "🏗️", menuiseries: "🚪", electricite: "⚡", plomberie: "💧",
  chauffage: "🔥", revetements: "🔲", isolation: "🧊", finitions: "🖌️",
  equipements: "🔧", autre: "📋",
};

export interface InventaireArticle {
  id: string;
  categorie: InventaireCategorie;
  designation: string;
  reference?: string;
  fournisseur?: string;
  quantiteCommandee: number;
  quantiteLivree: number;
  quantitePosee: number;
  unite: string;
  prixUnitaireHT?: number;
  statut: InventaireStatut;
  pieceIds?: string[];
  dateLivraisonPrevue?: string;
  dateLivraisonReelle?: string;
  note?: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// RÉSERVES
// ─────────────────────────────────────────────────────────────────────────────

export type ReserveStatut  = "ouverte" | "en_cours" | "levee" | "rejetee";
export type ReserveNiveau  = "bloquante" | "majeure" | "mineure" | "observation";

export const getReserveStatutLabels = (lang: Lang): Record<ReserveStatut, string> => ({
  ouverte: dt("ch_rs_ouverte" as DTKey, lang), en_cours: dt("ch_rs_en_cours" as DTKey, lang), levee: dt("ch_rs_levee" as DTKey, lang), rejetee: dt("ch_rs_rejetee" as DTKey, lang),
});
/** @deprecated Use getReserveStatutLabels(lang) */
export const RESERVE_STATUT_LABELS: Record<ReserveStatut, string> = {
  ouverte: "Ouverte", en_cours: "En cours", levee: "Levée", rejetee: "Rejetée",
};
export const RESERVE_STATUT_COLORS: Record<ReserveStatut, string> = {
  ouverte: "#EF4444", en_cours: "#F59E0B", levee: "#10B981", rejetee: "#6B7280",
};
export const getReserveNiveauLabels = (lang: Lang): Record<ReserveNiveau, string> => ({
  bloquante: dt("ch_rn_bloquante" as DTKey, lang), majeure: dt("ch_rn_majeure" as DTKey, lang), mineure: dt("ch_rn_mineure" as DTKey, lang), observation: dt("ch_rn_observation" as DTKey, lang),
});
/** @deprecated Use getReserveNiveauLabels(lang) */
export const RESERVE_NIVEAU_LABELS: Record<ReserveNiveau, string> = {
  bloquante: "Bloquante", majeure: "Majeure", mineure: "Mineure", observation: "Observation",
};
export const RESERVE_NIVEAU_COLORS: Record<ReserveNiveau, string> = {
  bloquante: "#EF4444", majeure: "#F97316", mineure: "#F59E0B", observation: "#6366F1",
};

export interface ReserveCommentaire {
  id: string;
  auteur?: string;
  texte: string;
  date: string;
}

export interface Reserve {
  id: string;
  numero: number;
  titre: string;
  description?: string;
  niveau: ReserveNiveau;
  statut: ReserveStatut;
  categorie: TravauxCategorie;
  entrepriseResponsable?: string;
  pieceId?: string;
  position?: { x: number; y: number };
  dateConstatee: string;
  dateLimiteLevee?: string;
  dateLevee?: string;
  commentaires: ReserveCommentaire[];
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERVENANTS
// ─────────────────────────────────────────────────────────────────────────────

export interface Intervenant {
  id: string;
  nom: string;
  contact?: string;
  telephone?: string;
  email?: string;
  lots: TravauxCategorie[];
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANNING / GANTT
// ─────────────────────────────────────────────────────────────────────────────

export interface LotPlanning {
  id: string;
  categorie: TravauxCategorie;
  label: string;                // ex: "Gros œuvre", "Électricité"
  intervenantId?: string;
  dateDebutPrevue: string;      // ISO date
  dateFinPrevue: string;
  dateDebutReelle?: string;
  dateFinReelle?: string;
  avancementPct: number;        // 0-100
  statut: "planifie" | "en_cours" | "termine" | "retard";
  note?: string;
  updatedAt: string;
}

export const LOT_STATUT_LABELS: Record<LotPlanning["statut"], string> = {
  planifie: "Planifié", en_cours: "En cours", termine: "Terminé", retard: "En retard",
};
export const LOT_STATUT_COLORS: Record<LotPlanning["statut"], string> = {
  planifie: "#6366F1", en_cours: "#F59E0B", termine: "#10B981", retard: "#EF4444",
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPTE-RENDU DE VISITE
// ─────────────────────────────────────────────────────────────────────────────

export type MeteoVisite = "soleil" | "nuageux" | "pluie" | "vent" | "neige";

export interface EffectifVisite {
  intervenantId?: string;
  entreprise: string;
  nombrePersonnes: number;
}

export interface CompteRenduVisite {
  id: string;
  numero: number;
  date: string;                 // ISO date
  meteo: MeteoVisite;
  temperatureC?: number;
  effectifs: EffectifVisite[];
  avancementGeneral?: string;   // texte libre
  pointsPositifs?: string;
  pointsNegatifs?: string;
  decisionsActions?: string;
  prochaineVisite?: string;     // ISO date
  reservesCreees: string[];     // IDs des réserves créées lors de cette visite
  updatedAt: string;
}

export const METEO_ICONS: Record<MeteoVisite, string> = {
  soleil: "☀️", nuageux: "⛅", pluie: "🌧️", vent: "💨", neige: "❄️",
};

// ─────────────────────────────────────────────────────────────────────────────
// SITUATIONS DE TRAVAUX / ACOMPTES
// ─────────────────────────────────────────────────────────────────────────────

export type SituationStatut = "en_cours" | "soumise" | "validee" | "payee" | "litige";

export const SITUATION_STATUT_LABELS: Record<SituationStatut, string> = {
  en_cours: "En cours", soumise: "Soumise", validee: "Validée", payee: "Payée", litige: "Litige",
};
export const SITUATION_STATUT_COLORS: Record<SituationStatut, string> = {
  en_cours: "#6366F1", soumise: "#F59E0B", validee: "#3B82F6", payee: "#10B981", litige: "#EF4444",
};

export interface SituationLigne {
  lotCategorie: TravauxCategorie;
  description: string;
  montantMarcheHT: number;      // montant du marché
  avancementPct: number;        // % validé ce mois
  avancementCumulPct: number;   // % cumulé
  montantCumulHT: number;       // calculé
}

export interface SituationTravaux {
  id: string;
  numero: number;               // n° de situation (1, 2, 3…)
  intervenantId?: string;
  entreprise: string;
  periode: string;              // ex: "Avril 2025"
  statut: SituationStatut;
  lignes: SituationLigne[];
  totalHTBrut: number;          // calculé
  retenuGarantiePct: number;    // % retenue de garantie (défaut 5%)
  netAPayer: number;            // calculé
  dateEmission?: string;
  dateValidation?: string;
  datePaiement?: string;
  note?: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUDGET / SUIVI DES COÛTS
// ─────────────────────────────────────────────────────────────────────────────

export interface BudgetLot {
  id: string;
  categorie: TravauxCategorie;
  label: string;
  intervenantId?: string;
  budgetInitialHT: number;
  budgetReviseHT?: number;       // avenants inclus
  montantEngageHT: number;       // marchés signés
  montantFactureHT: number;      // factures reçues
  montantPayeHT: number;         // paiements effectués
  note?: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENTS
// ─────────────────────────────────────────────────────────────────────────────

export type DocumentType =
  | "plan" | "permis" | "dict" | "pv_reception" | "doe"
  | "contrat" | "facture" | "assurance" | "rapport" | "autre";

export type DocumentStatut = "en_attente" | "recu" | "approuve" | "obsolete";

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  plan: "Plan", permis: "Permis / Autorisation", dict: "DICT",
  pv_reception: "PV de réception", doe: "DOE / Dossier ouvrages exécutés",
  contrat: "Contrat / Marché", facture: "Facture", assurance: "Assurance / Garantie",
  rapport: "Rapport / Étude", autre: "Autre",
};
export const DOCUMENT_TYPE_ICONS: Record<DocumentType, string> = {
  plan: "📐", permis: "📋", dict: "⚠️", pv_reception: "✅", doe: "📁",
  contrat: "📄", facture: "🧾", assurance: "🛡️", rapport: "📊", autre: "📎",
};
export const DOCUMENT_STATUT_LABELS: Record<DocumentStatut, string> = {
  en_attente: "En attente", recu: "Reçu", approuve: "Approuvé", obsolete: "Obsolète",
};
export const DOCUMENT_STATUT_COLORS: Record<DocumentStatut, string> = {
  en_attente: "#F59E0B", recu: "#3B82F6", approuve: "#10B981", obsolete: "#6B7280",
};

export interface Document {
  id: string;
  type: DocumentType;
  titre: string;
  indice?: string;               // ex: "B", "C", "v3"
  emetteur?: string;
  dateDocument?: string;
  dateReception?: string;
  statut: DocumentStatut;
  url?: string;                  // lien externe optionnel
  note?: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROJET COMPLET
// ─────────────────────────────────────────────────────────────────────────────

export interface ChantierProjet {
  id: string;
  nom: string;
  adresse?: string;
  dateDebut?: string;
  dateLivraison?: string;
  conducteur?: string;
  // Onglet Avancement
  pieces: ChantierPiece[];
  // Onglet Inventaire
  inventaire: InventaireArticle[];
  // Onglet Réserves
  reserves: Reserve[];
  // Onglet Planning
  planning: LotPlanning[];
  // Onglet Compte-rendus
  comptesRendus: CompteRenduVisite[];
  // Onglet Situations
  situations: SituationTravaux[];
  // Onglet Budget
  budget: BudgetLot[];
  // Onglet Documents
  documents: Document[];
  // Intervenants (partagé)
  intervenants: Intervenant[];
  // Référence plan
  planImageB64?: string;
  planImageMime?: string;
  sessionId?: string;
  pixelsPerMeter?: number;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────

export const TACHES_TEMPLATES: Record<string, { categorie: TravauxCategorie; label: string }[]> = {
  bathroom: [
    { categorie: "gros_oeuvre", label: "Démolition / saignées" },
    { categorie: "plomberie",   label: "Plomberie brute (arrivées/évacuations)" },
    { categorie: "electricite", label: "Électricité (DCL, prises étanches)" },
    { categorie: "isolation",   label: "Doublage / isolation phonique" },
    { categorie: "placo",       label: "Plâtrerie / Placo hydro" },
    { categorie: "carrelage",   label: "Carrelage murs" },
    { categorie: "carrelage",   label: "Carrelage sol" },
    { categorie: "plomberie",   label: "Pose sanitaires" },
    { categorie: "peinture",    label: "Finitions / peinture" },
  ],
  bedroom: [
    { categorie: "gros_oeuvre", label: "Démolition" },
    { categorie: "electricite", label: "Électricité (prises, DCL, interrupteurs)" },
    { categorie: "isolation",   label: "Isolation thermique / phonique" },
    { categorie: "placo",       label: "Plâtrerie / Placo" },
    { categorie: "parquet",     label: "Pose sol (parquet / moquette)" },
    { categorie: "peinture",    label: "Peinture murs" },
    { categorie: "peinture",    label: "Peinture plafond" },
  ],
  "living room": [
    { categorie: "gros_oeuvre", label: "Démolition" },
    { categorie: "electricite", label: "Électricité (prises, DCL, TV)" },
    { categorie: "chauffage",   label: "Radiateur / plancher chauffant" },
    { categorie: "isolation",   label: "Isolation" },
    { categorie: "placo",       label: "Plâtrerie / Placo" },
    { categorie: "parquet",     label: "Pose sol (parquet / carrelage)" },
    { categorie: "peinture",    label: "Peinture murs" },
    { categorie: "peinture",    label: "Peinture plafond" },
  ],
  kitchen: [
    { categorie: "gros_oeuvre", label: "Démolition" },
    { categorie: "plomberie",   label: "Plomberie brute" },
    { categorie: "electricite", label: "Électricité (prises, hotte, four)" },
    { categorie: "isolation",   label: "Doublage" },
    { categorie: "placo",       label: "Plâtrerie" },
    { categorie: "carrelage",   label: "Carrelage sol" },
    { categorie: "carrelage",   label: "Crédence" },
    { categorie: "peinture",    label: "Peinture murs / plafond" },
    { categorie: "plomberie",   label: "Pose meubles cuisine / évier" },
  ],
  hallway: [
    { categorie: "electricite", label: "Électricité (interrupteur, DCL)" },
    { categorie: "placo",       label: "Plâtrerie" },
    { categorie: "carrelage",   label: "Pose sol" },
    { categorie: "peinture",    label: "Peinture" },
  ],
  office: [
    { categorie: "electricite", label: "Électricité (prises RJ45, DCL)" },
    { categorie: "placo",       label: "Plâtrerie" },
    { categorie: "parquet",     label: "Pose sol" },
    { categorie: "peinture",    label: "Peinture" },
  ],
  default: [
    { categorie: "gros_oeuvre", label: "Démolition / préparation" },
    { categorie: "electricite", label: "Électricité" },
    { categorie: "placo",       label: "Plâtrerie" },
    { categorie: "sol",         label: "Revêtement de sol" },
    { categorie: "peinture",    label: "Peinture" },
  ],
};

/** Lots de planning par défaut pour un chantier de rénovation */
export const PLANNING_TEMPLATES: { categorie: TravauxCategorie; label: string; dureeSemaines: number }[] = [
  { categorie: "gros_oeuvre",    label: "Gros œuvre / Démolition",    dureeSemaines: 2 },
  { categorie: "plomberie",      label: "Plomberie brute",            dureeSemaines: 1 },
  { categorie: "electricite",    label: "Électricité brute",          dureeSemaines: 1 },
  { categorie: "isolation",      label: "Isolation / Doublage",       dureeSemaines: 1 },
  { categorie: "placo",          label: "Plâtrerie / Placo",          dureeSemaines: 2 },
  { categorie: "menuiseries_ext",label: "Menuiseries extérieures",    dureeSemaines: 1 },
  { categorie: "menuiseries_int",label: "Menuiseries intérieures",    dureeSemaines: 1 },
  { categorie: "carrelage",      label: "Carrelage",                  dureeSemaines: 2 },
  { categorie: "parquet",        label: "Parquet",                    dureeSemaines: 1 },
  { categorie: "plomberie",      label: "Plomberie finition",         dureeSemaines: 1 },
  { categorie: "electricite",    label: "Électricité finition",       dureeSemaines: 1 },
  { categorie: "peinture",       label: "Peinture",                   dureeSemaines: 2 },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function getTemplatesForRoom(roomType: string) {
  return TACHES_TEMPLATES[roomType] ?? TACHES_TEMPLATES.default;
}

export function progressionPiece(piece: ChantierPiece): number {
  if (!piece.taches.length) return 0;
  return Math.round(piece.taches.filter(t => t.statut === "termine").length / piece.taches.length * 100);
}

export function progressionGlobale(projet: ChantierProjet): number {
  const all = projet.pieces.flatMap(p => p.taches);
  if (!all.length) return 0;
  return Math.round(all.filter(t => t.statut === "termine").length / all.length * 100);
}

export function inventaireStats(inventaire: InventaireArticle[]) {
  return {
    total:   inventaire.length,
    livre:   inventaire.filter(a => a.statut === "livre" || a.statut === "pose").length,
    pose:    inventaire.filter(a => a.statut === "pose").length,
    retard:  inventaire.filter(a => a.dateLivraisonPrevue && a.statut === "commande" && new Date(a.dateLivraisonPrevue) < new Date()).length,
    totalHT: inventaire.reduce((s, a) => s + (a.prixUnitaireHT ?? 0) * a.quantiteCommandee, 0),
  };
}

export function reservesStats(reserves: Reserve[]) {
  return {
    total:      reserves.length,
    ouvertes:   reserves.filter(r => r.statut === "ouverte").length,
    en_cours:   reserves.filter(r => r.statut === "en_cours").length,
    levees:     reserves.filter(r => r.statut === "levee").length,
    bloquantes: reserves.filter(r => r.niveau === "bloquante" && r.statut !== "levee").length,
  };
}

export function budgetStats(budget: BudgetLot[]) {
  const totalInitial  = budget.reduce((s, l) => s + l.budgetInitialHT, 0);
  const totalRevise   = budget.reduce((s, l) => s + (l.budgetReviseHT ?? l.budgetInitialHT), 0);
  const totalEngage   = budget.reduce((s, l) => s + l.montantEngageHT, 0);
  const totalFacture  = budget.reduce((s, l) => s + l.montantFactureHT, 0);
  const totalPaye     = budget.reduce((s, l) => s + l.montantPayeHT, 0);
  const depassement   = totalEngage > totalRevise;
  const depassementPct = totalRevise > 0 ? Math.round((totalEngage - totalRevise) / totalRevise * 100) : 0;
  return { totalInitial, totalRevise, totalEngage, totalFacture, totalPaye, depassement, depassementPct };
}

export function situationsStats(situations: SituationTravaux[]) {
  return {
    total:    situations.length,
    validees: situations.filter(s => s.statut === "validee" || s.statut === "payee").length,
    totalNetAPayer: situations.filter(s => s.statut !== "litige").reduce((s, x) => s + x.netAPayer, 0),
    totalPaye:      situations.filter(s => s.statut === "payee").reduce((s, x) => s + x.netAPayer, 0),
  };
}

export function createProjet(nom: string): ChantierProjet {
  return {
    id: crypto.randomUUID(), nom,
    pieces: [], inventaire: [], reserves: [], planning: [],
    comptesRendus: [], situations: [], budget: [], documents: [],
    intervenants: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

/** Génère un planning initial depuis la date de début du projet */
export function generatePlanning(dateDebut: string): LotPlanning[] {
  let cursor = new Date(dateDebut);
  return PLANNING_TEMPLATES.map((t, i) => {
    const start = new Date(cursor);
    const end = new Date(cursor);
    end.setDate(end.getDate() + t.dureeSemaines * 7);
    cursor = new Date(end);
    return {
      id: crypto.randomUUID(),
      categorie: t.categorie,
      label: t.label,
      dateDebutPrevue: start.toISOString().slice(0, 10),
      dateFinPrevue: end.toISOString().slice(0, 10),
      avancementPct: 0,
      statut: "planifie" as const,
      updatedAt: new Date().toISOString(),
    };
  });
}

export function openingsInRoom(
  openings: OpeningRef[],
  roomBboxNorm: { x: number; y: number; w: number; h: number },
  imgW: number, imgH: number, paddingFactor = 0.15,
): OpeningRef[] {
  if (!openings?.length || imgW <= 0 || imgH <= 0) return [];
  const { x, y, w, h } = roomBboxNorm;
  const px = w * paddingFactor, py = h * paddingFactor;
  return openings.filter(o => {
    const cx = (o.x_px + o.width_px / 2) / imgW;
    const cy = (o.y_px + o.height_px / 2) / imgH;
    return cx >= x - px && cx <= x + w + px && cy >= y - py && cy <= y + h + py;
  });
}

export function tachesFromOpenings(openings: OpeningRef[]): ChantierTache[] {
  const taches: ChantierTache[] = [];
  let di = 0, wi = 0, fi = 0;
  for (const o of openings) {
    const dim = o.width_m ? ` (${o.width_m.toFixed(2)}×${o.height_m?.toFixed(2) ?? "?"}m)` : "";
    let categorie: TravauxCategorie, label: string;
    if (o.class === "door") { di++; categorie = "menuiseries_int"; label = `Pose porte n°${di}${dim}`; }
    else if (o.class === "french_door") { fi++; categorie = "menuiseries_ext"; label = `Pose porte-fenêtre n°${fi}${dim}`; }
    else { wi++; categorie = "menuiseries_ext"; label = `Pose fenêtre n°${wi}${dim}`; }
    taches.push({
      id: crypto.randomUUID(), categorie, label, statut: "a_faire",
      quantite: 1, unite: "U",
      sourceDetection: { type: o.class, index: o.class === "door" ? di : o.class === "french_door" ? fi : wi, width_m: o.width_m, height_m: o.height_m, confidence: o.confidence, openingRef: o },
      updatedAt: new Date().toISOString(),
    });
  }
  return taches;
}

export function createPieceFromRoom(
  room: { id: number; label_fr: string; type: string; area_m2?: number | null; bbox_norm?: { x: number; y: number; w: number; h: number }; polygon_norm?: { x: number; y: number }[] },
  allOpenings: OpeningRef[] = [], imgW = 0, imgH = 0,
): ChantierPiece {
  const templates = getTemplatesForRoom(room.type);
  const tachesTemplate: ChantierTache[] = templates.map(t => ({
    id: crypto.randomUUID(), categorie: t.categorie, label: t.label, statut: "a_faire", updatedAt: new Date().toISOString(),
  }));
  let tachesMenuiseries: ChantierTache[] = [];
  let openingsCount = { doors: 0, windows: 0, french_doors: 0 };
  if (allOpenings.length > 0 && room.bbox_norm && imgW > 0 && imgH > 0) {
    const roomOpenings = openingsInRoom(allOpenings, room.bbox_norm, imgW, imgH);
    openingsCount = { doors: roomOpenings.filter(o => o.class === "door").length, windows: roomOpenings.filter(o => o.class === "window").length, french_doors: roomOpenings.filter(o => o.class === "french_door").length };
    tachesMenuiseries = tachesFromOpenings(roomOpenings);
  }
  let tachesFinal: ChantierTache[];
  if (tachesMenuiseries.length > 0) {
    const sans = tachesTemplate.filter(t => t.categorie !== "menuiseries_int" && t.categorie !== "menuiseries_ext");
    const idx = sans.findIndex(t => t.categorie === "peinture");
    tachesFinal = idx >= 0 ? [...sans.slice(0, idx), ...tachesMenuiseries, ...sans.slice(idx)] : [...sans, ...tachesMenuiseries];
  } else { tachesFinal = tachesTemplate; }
  return {
    id: `room_${room.id}`, nom: room.label_fr, typeRoom: room.type,
    aireM2: room.area_m2 ?? undefined, polygonNorm: room.polygon_norm,
    openings: tachesMenuiseries.length > 0 ? openingsCount : undefined,
    note: "", taches: tachesFinal, updatedAt: new Date().toISOString(),
  };
}

export function createPieceManuelle(nom: string, type = "default"): ChantierPiece {
  const templates = getTemplatesForRoom(type);
  return {
    id: crypto.randomUUID(), nom,
    taches: templates.map(t => ({ id: crypto.randomUUID(), categorie: t.categorie, label: t.label, statut: "a_faire", updatedAt: new Date().toISOString() })),
    updatedAt: new Date().toISOString(),
  };
}

export const CHANTIER_STORAGE_KEY = "floorscan_chantier_v1";
