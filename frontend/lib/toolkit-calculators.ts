/**
 * toolkit-calculators.ts
 *
 * Pure calculation functions for BTP toolkit modules.
 * 100% client-side, zero backend dependency.
 *
 * Tier 1 – linked to analysis data (pre-filled from AnalysisResult)
 *   1. Carrelage (Tile calculator)
 *   2. Peinture  (Paint calculator)
 *   3. Escalier  (Staircase / Blondel)
 *   4. R thermique (Thermal resistance)
 *   5. Électrique NFC 15-100 (Electrical planner)
 *
 * Tier 2 – standalone utilities
 *   6. Convertisseur d'unités
 *   7. Convertisseur d'échelle
 *   8. Calculateur TVA BTP
 *   9. Estimateur budget réno/m²
 *  10. Répartition budget par lot
 */

// ─── 1. Tile Calculator ──────────────────────────────────────────────────────

export type TileLayout = "straight" | "diagonal" | "chevron";

export interface TileInput {
  surface_m2: number;
  tile_w_cm: number;
  tile_h_cm: number;
  joint_mm: number;       // joint width in mm
  waste_pct: number;      // 5-15%
  layout: TileLayout;
}

export interface TileResult {
  tiles_count: number;
  boxes_count: number;      // assuming ~1m² per box
  glue_kg: number;          // ~3 kg/m²
  joint_kg: number;         // ~0.3 kg/m² (approximate)
  surface_with_waste_m2: number;
}

export function calcTiles(input: TileInput): TileResult {
  const layoutMultiplier: Record<TileLayout, number> = {
    straight: 1,
    diagonal: 1.1,
    chevron: 1.15,
  };
  const wasteFactor = 1 + input.waste_pct / 100;
  const surfaceNeeded = input.surface_m2 * wasteFactor * layoutMultiplier[input.layout];

  const tileArea_m2 =
    ((input.tile_w_cm + input.joint_mm / 10) / 100) *
    ((input.tile_h_cm + input.joint_mm / 10) / 100);

  const tilesCount = Math.ceil(surfaceNeeded / tileArea_m2);
  const tilesPerBox = Math.max(1, Math.floor(1 / (input.tile_w_cm * input.tile_h_cm / 10000)));
  const boxesCount = Math.ceil(tilesCount / tilesPerBox);

  return {
    tiles_count: tilesCount,
    boxes_count: boxesCount,
    glue_kg: Math.ceil(surfaceNeeded * 3),
    joint_kg: Math.ceil(surfaceNeeded * 0.3),
    surface_with_waste_m2: parseFloat(surfaceNeeded.toFixed(2)),
  };
}

// ─── 2. Paint Calculator ─────────────────────────────────────────────────────

export interface PaintInput {
  wall_surface_m2: number;      // net wall area (minus openings)
  coats: number;                 // 1-3
  coverage_m2_per_l: number;     // ~10-12 m²/L
  pot_size_l: number;            // 2.5, 5, 10, 15
  primer: boolean;               // sous-couche
}

export interface PaintResult {
  total_surface_m2: number;    // wall * coats
  liters_needed: number;
  pots_needed: number;
  primer_liters: number;
  primer_pots: number;
}

export function calcPaint(input: PaintInput): PaintResult {
  const totalSurface = input.wall_surface_m2 * input.coats;
  const liters = totalSurface / input.coverage_m2_per_l;
  const pots = Math.ceil(liters / input.pot_size_l);

  const primerLiters = input.primer ? input.wall_surface_m2 / 12 : 0;
  const primerPots = input.primer ? Math.ceil(primerLiters / input.pot_size_l) : 0;

  return {
    total_surface_m2: parseFloat(totalSurface.toFixed(2)),
    liters_needed: parseFloat(liters.toFixed(1)),
    pots_needed: pots,
    primer_liters: parseFloat(primerLiters.toFixed(1)),
    primer_pots: primerPots,
  };
}

// ─── 3. Staircase Calculator (Blondel) ───────────────────────────────────────

export interface StairInput {
  floor_height_cm: number;   // hauteur d'étage (250-350 cm)
  opening_length_cm: number; // longueur trémie disponible
  step_depth_cm: number;     // giron souhaité (22-30 cm)
}

export interface StairResult {
  step_count: number;
  riser_height_cm: number;     // hauteur de marche
  tread_depth_cm: number;      // giron
  blondel: number;             // 2h + g (norm: 58-64cm)
  blondel_ok: boolean;
  angle_deg: number;
  total_run_cm: number;        // encombrement horizontal
}

export function calcStaircase(input: StairInput): StairResult {
  // Try to find step count that makes Blondel optimal (~63cm)
  let bestSteps = Math.round(input.floor_height_cm / 18); // typical riser ~18cm
  if (bestSteps < 3) bestSteps = 3;

  const riser = input.floor_height_cm / bestSteps;
  const tread = input.step_depth_cm;
  const blondel = 2 * riser + tread;

  // Adjust step count if Blondel is way off
  let finalSteps = bestSteps;
  if (blondel > 66) finalSteps = bestSteps + 1;
  else if (blondel < 56) finalSteps = bestSteps - 1;
  if (finalSteps < 3) finalSteps = 3;

  const finalRiser = input.floor_height_cm / finalSteps;
  const finalBlondel = 2 * finalRiser + tread;
  const totalRun = (finalSteps - 1) * tread;
  const angleDeg = Math.atan(input.floor_height_cm / totalRun) * (180 / Math.PI);

  return {
    step_count: finalSteps,
    riser_height_cm: parseFloat(finalRiser.toFixed(1)),
    tread_depth_cm: tread,
    blondel: parseFloat(finalBlondel.toFixed(1)),
    blondel_ok: finalBlondel >= 58 && finalBlondel <= 64,
    angle_deg: parseFloat(angleDeg.toFixed(1)),
    total_run_cm: parseFloat(totalRun.toFixed(0)),
  };
}

// ─── 4. Thermal Resistance Calculator ────────────────────────────────────────

export interface WallLayer {
  name: string;
  thickness_cm: number;
  lambda: number;           // W/(m·K)
}

export const COMMON_MATERIALS: { name: string; lambda: number }[] = [
  { name: "Béton",           lambda: 1.75 },
  { name: "Brique",          lambda: 0.84 },
  { name: "Parpaing",        lambda: 1.05 },
  { name: "Plâtre",          lambda: 0.35 },
  { name: "Laine de verre",  lambda: 0.035 },
  { name: "Laine de roche",  lambda: 0.038 },
  { name: "Polystyrène XPS", lambda: 0.034 },
  { name: "Polyuréthane",    lambda: 0.025 },
  { name: "Bois massif",     lambda: 0.15 },
  { name: "Pierre",          lambda: 2.0 },
  { name: "BA13",            lambda: 0.25 },
  { name: "Air (lame)",      lambda: 0.025 },
];

export interface ThermalResult {
  r_total: number;           // m²·K/W
  u_value: number;           // W/(m²·K)
  dpe_class: string;         // A-G indicatif
  layers_detail: { name: string; r: number }[];
}

export function calcThermal(layers: WallLayer[]): ThermalResult {
  // Rsi + Rse resistances (intérieur + extérieur)
  const Rsi = 0.13;
  const Rse = 0.04;

  const details = layers.map(l => ({
    name: l.name,
    r: l.lambda > 0 ? (l.thickness_cm / 100) / l.lambda : 0,
  }));

  const rLayers = details.reduce((s, d) => s + d.r, 0);
  const rTotal = Rsi + rLayers + Rse;
  const uValue = 1 / rTotal;

  // DPE class approximation based on U-value
  let dpe = "G";
  if (uValue <= 0.15) dpe = "A";
  else if (uValue <= 0.25) dpe = "B";
  else if (uValue <= 0.40) dpe = "C";
  else if (uValue <= 0.60) dpe = "D";
  else if (uValue <= 0.80) dpe = "E";
  else if (uValue <= 1.2) dpe = "F";

  return {
    r_total: parseFloat(rTotal.toFixed(3)),
    u_value: parseFloat(uValue.toFixed(3)),
    dpe_class: dpe,
    layers_detail: details.map(d => ({ ...d, r: parseFloat(d.r.toFixed(3)) })),
  };
}

// ─── 5. Electrical Planner NFC 15-100 ────────────────────────────────────────

export type RoomType =
  | "bedroom" | "living" | "kitchen" | "bathroom"
  | "wc" | "hallway" | "office" | "garage" | "laundry";

interface NfcRule {
  min_outlets: number;      // prises courant
  min_lights: number;       // points lumineux
  dedicated: string[];      // circuits spécialisés
  rj45: number;            // prises RJ45
  extra_per_4m2?: number;  // prise supplémentaire par 4m²
}

const NFC_RULES: Record<RoomType, NfcRule> = {
  bedroom:  { min_outlets: 3, min_lights: 1, dedicated: [],                    rj45: 1, extra_per_4m2: 1 },
  living:   { min_outlets: 5, min_lights: 1, dedicated: [],                    rj45: 2, extra_per_4m2: 1 },
  kitchen:  { min_outlets: 6, min_lights: 1, dedicated: ["Four", "Plaques", "Lave-vaisselle", "Réfrigérateur"], rj45: 1 },
  bathroom: { min_outlets: 1, min_lights: 1, dedicated: ["Lave-linge"],        rj45: 0 },
  wc:       { min_outlets: 0, min_lights: 1, dedicated: [],                    rj45: 0 },
  hallway:  { min_outlets: 1, min_lights: 1, dedicated: [],                    rj45: 0 },
  office:   { min_outlets: 4, min_lights: 1, dedicated: [],                    rj45: 2, extra_per_4m2: 1 },
  garage:   { min_outlets: 1, min_lights: 1, dedicated: [],                    rj45: 0 },
  laundry:  { min_outlets: 1, min_lights: 1, dedicated: ["Sèche-linge"],      rj45: 0 },
};

export interface ElecRoomInput {
  type: RoomType;
  area_m2: number;
  label: string;
}

export interface ElecRoomResult {
  label: string;
  type: RoomType;
  outlets: number;
  lights: number;
  rj45: number;
  dedicated: string[];
}

export interface ElecResult {
  rooms: ElecRoomResult[];
  total_outlets: number;
  total_lights: number;
  total_rj45: number;
  total_dedicated: number;
  min_breaker_16a: number;  // disjoncteurs 16A (prises)
  min_breaker_10a: number;  // disjoncteurs 10A (éclairage)
  min_breaker_20a: number;  // disjoncteurs 20A (spécialisés)
}

export function calcElectrical(rooms: ElecRoomInput[]): ElecResult {
  const results: ElecRoomResult[] = rooms.map(room => {
    const rule = NFC_RULES[room.type] ?? NFC_RULES.bedroom;
    let outlets = rule.min_outlets;
    if (rule.extra_per_4m2 && room.area_m2 > 0) {
      outlets = Math.max(outlets, Math.ceil(room.area_m2 / 4) * rule.extra_per_4m2);
    }
    return {
      label: room.label,
      type: room.type,
      outlets,
      lights: rule.min_lights,
      rj45: rule.rj45,
      dedicated: rule.dedicated,
    };
  });

  const totalOutlets = results.reduce((s, r) => s + r.outlets, 0);
  const totalLights = results.reduce((s, r) => s + r.lights, 0);
  const totalRj45 = results.reduce((s, r) => s + r.rj45, 0);
  const totalDedicated = results.reduce((s, r) => s + r.dedicated.length, 0);

  return {
    rooms: results,
    total_outlets: totalOutlets,
    total_lights: totalLights,
    total_rj45: totalRj45,
    total_dedicated: totalDedicated,
    min_breaker_16a: Math.ceil(totalOutlets / 8),  // max 8 prises par disj 16A
    min_breaker_10a: Math.ceil(totalLights / 8),    // max 8 points par disj 10A
    min_breaker_20a: totalDedicated,
  };
}

// ─── 6. Unit Converter ───────────────────────────────────────────────────────

export type UnitCategory = "length" | "area" | "volume" | "weight";

const UNIT_FACTORS: Record<UnitCategory, Record<string, number>> = {
  length: {
    mm: 0.001, cm: 0.01, m: 1, km: 1000,
    inch: 0.0254, ft: 0.3048, yd: 0.9144,
  },
  area: {
    "mm²": 1e-6, "cm²": 1e-4, "m²": 1, "ha": 10000,
    "are": 100, "km²": 1e6,
    "ft²": 0.0929, "yd²": 0.8361,
  },
  volume: {
    "mm³": 1e-9, "cm³": 1e-6, "m³": 1, L: 0.001,
    "gal": 0.003785, "ft³": 0.02832,
  },
  weight: {
    g: 0.001, kg: 1, t: 1000, lb: 0.4536, oz: 0.02835,
  },
};

export function getUnitsForCategory(cat: UnitCategory): string[] {
  return Object.keys(UNIT_FACTORS[cat]);
}

export function convertUnit(
  value: number,
  from: string,
  to: string,
  category: UnitCategory,
): number {
  const factors = UNIT_FACTORS[category];
  const fromFactor = factors[from] ?? 1;
  const toFactor = factors[to] ?? 1;
  return (value * fromFactor) / toFactor;
}

// ─── 7. Scale Converter ──────────────────────────────────────────────────────

export const COMMON_SCALES = [
  { label: "1:20", factor: 20 },
  { label: "1:50", factor: 50 },
  { label: "1:75", factor: 75 },
  { label: "1:100", factor: 100 },
  { label: "1:200", factor: 200 },
  { label: "1:500", factor: 500 },
  { label: "1:1000", factor: 1000 },
];

export function scaleToReal(plan_cm: number, scaleFactor: number): number {
  return plan_cm * scaleFactor / 100; // returns meters
}

export function realToScale(real_m: number, scaleFactor: number): number {
  return (real_m * 100) / scaleFactor; // returns cm on plan
}

// ─── 8. VAT Calculator BTP ───────────────────────────────────────────────────

export interface VatRate {
  rate: number;
  label_key: string;
  description_key: string;
}

export const BTP_VAT_RATES: VatRate[] = [
  { rate: 0.055, label_key: "tk_vat_55",  description_key: "tk_vat_55_desc" },
  { rate: 0.10,  label_key: "tk_vat_10",  description_key: "tk_vat_10_desc" },
  { rate: 0.20,  label_key: "tk_vat_20",  description_key: "tk_vat_20_desc" },
];

export interface VatResult {
  ht: number;
  vat_amount: number;
  ttc: number;
}

export function calcVat(amount: number, rate: number, mode: "ht_to_ttc" | "ttc_to_ht"): VatResult {
  if (mode === "ht_to_ttc") {
    const vatAmount = amount * rate;
    return { ht: amount, vat_amount: parseFloat(vatAmount.toFixed(2)), ttc: parseFloat((amount + vatAmount).toFixed(2)) };
  } else {
    const ht = amount / (1 + rate);
    const vatAmount = amount - ht;
    return { ht: parseFloat(ht.toFixed(2)), vat_amount: parseFloat(vatAmount.toFixed(2)), ttc: amount };
  }
}

// ─── 9. Renovation Budget Estimator ──────────────────────────────────────────

export type RenoLevel = "light" | "standard" | "heavy" | "luxury";

export interface RenoCoeffs {
  base_per_m2: number;
  label_key: string;
}

export const RENO_LEVELS: Record<RenoLevel, RenoCoeffs> = {
  light:    { base_per_m2: 250,  label_key: "tk_reno_light" },
  standard: { base_per_m2: 700,  label_key: "tk_reno_standard" },
  heavy:    { base_per_m2: 1100, label_key: "tk_reno_heavy" },
  luxury:   { base_per_m2: 1800, label_key: "tk_reno_luxury" },
};

export interface RegionCoeff {
  region: string;
  coeff: number;
}

export const REGION_COEFFS: RegionCoeff[] = [
  { region: "Île-de-France",    coeff: 1.20 },
  { region: "PACA",             coeff: 1.10 },
  { region: "Auvergne-Rhône-Alpes", coeff: 1.05 },
  { region: "Nouvelle-Aquitaine", coeff: 0.95 },
  { region: "Occitanie",        coeff: 0.95 },
  { region: "Bretagne",         coeff: 0.90 },
  { region: "Hauts-de-France",  coeff: 0.90 },
  { region: "Grand Est",        coeff: 0.90 },
  { region: "Normandie",        coeff: 0.92 },
  { region: "Centre-Val de Loire", coeff: 0.88 },
  { region: "Pays de la Loire", coeff: 0.92 },
  { region: "Bourgogne-Franche-Comté", coeff: 0.88 },
  { region: "Corse",            coeff: 1.15 },
];

export interface RenoBudgetResult {
  surface_m2: number;
  base_per_m2: number;
  region_coeff: number;
  final_per_m2: number;
  total_ht: number;
  total_ttc_10: number;
  total_ttc_20: number;
}

export function calcRenoBudget(
  surface_m2: number,
  level: RenoLevel,
  regionCoeff: number,
): RenoBudgetResult {
  const base = RENO_LEVELS[level].base_per_m2;
  const finalPerM2 = base * regionCoeff;
  const totalHt = surface_m2 * finalPerM2;
  return {
    surface_m2,
    base_per_m2: base,
    region_coeff: regionCoeff,
    final_per_m2: parseFloat(finalPerM2.toFixed(0)),
    total_ht: parseFloat(totalHt.toFixed(0)),
    total_ttc_10: parseFloat((totalHt * 1.10).toFixed(0)),
    total_ttc_20: parseFloat((totalHt * 1.20).toFixed(0)),
  };
}

// ─── 10. Budget Breakdown by Trade ───────────────────────────────────────────

export interface LotBreakdown {
  lot_key: string;
  label_key: string;
  pct: number;
  amount: number;
}

export const LOT_PERCENTAGES: { lot_key: string; label_key: string; pct: number }[] = [
  { lot_key: "gros_oeuvre",    label_key: "tk_lot_gros",       pct: 25 },
  { lot_key: "charpente",      label_key: "tk_lot_charpente",  pct: 10 },
  { lot_key: "couverture",     label_key: "tk_lot_couverture", pct: 8 },
  { lot_key: "menuiseries",    label_key: "tk_lot_menuiseries",pct: 12 },
  { lot_key: "plomberie",      label_key: "tk_lot_plomberie",  pct: 10 },
  { lot_key: "electricite",    label_key: "tk_lot_elec",       pct: 10 },
  { lot_key: "platrerie",      label_key: "tk_lot_platrerie",  pct: 7 },
  { lot_key: "carrelage",      label_key: "tk_lot_carrelage",  pct: 6 },
  { lot_key: "peinture",       label_key: "tk_lot_peinture",   pct: 5 },
  { lot_key: "revetements_sol",label_key: "tk_lot_sols",       pct: 4 },
  { lot_key: "divers",         label_key: "tk_lot_divers",     pct: 3 },
];

export function calcBudgetBreakdown(totalBudget: number): LotBreakdown[] {
  return LOT_PERCENTAGES.map(lp => ({
    ...lp,
    amount: parseFloat((totalBudget * lp.pct / 100).toFixed(0)),
  }));
}
