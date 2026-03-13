/**
 * dpgf-scenarios.ts
 *
 * Scenario presets and comparison engine for the DPGF module.
 * Generates multiple DpgfState variants (Économique, Standard, Premium, Luxe)
 * from the same AnalysisResult by applying price multipliers per line item.
 */

import type {
  AnalysisResult,
  CustomDetection,
  DpgfState,
} from "@/lib/types";
import { buildDefaultDpgf } from "@/lib/dpgf-defaults";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ScenarioPreset {
  id: string;
  label_key: string;
  description_key: string;
  icon: string;
  color: string;
  /** Multiplier per description_key (missing = 1.0) */
  priceMultipliers: Record<string, number>;
  /** Optional alternative material label per description_key */
  materialLabels: Record<string, string>;
  tvaRate: number;
}

export interface ScenarioResult {
  preset: ScenarioPreset;
  dpgf: DpgfState;
}

export interface LotDelta {
  lotNumber: number;
  titleKey: string;
  values: number[];          // subtotal per scenario (same order as input)
  min: number;
  max: number;
}

export interface ComparisonResult {
  lotDeltas: LotDelta[];
  totals: number[];          // total_ht per scenario
  totalsTtc: number[];       // total_ttc per scenario
  totalRange: { min: number; max: number };
}

// ── Presets ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: "eco",
    label_key: "scn_eco",
    description_key: "scn_eco_desc",
    icon: "Leaf",
    color: "#22c55e",
    tvaRate: 10,
    priceMultipliers: {
      // Lot 1 — Démolition (même prix)
      dpgf_depose: 1.0,
      dpgf_gravats: 0.90,
      dpgf_nettoyage: 0.90,
      // Lot 2 — Plâtrerie
      dpgf_ba13: 0.75,
      dpgf_enduit: 0.70,
      dpgf_bande: 0.80,
      // Lot 3 — Menuiseries int
      dpgf_bloc_porte: 0.55,      // porte isoplane
      dpgf_pose_porte: 0.85,
      // Lot 4 — Menuiseries ext
      dpgf_fenetre: 0.75,         // PVC entrée de gamme
      dpgf_pose_fen: 0.85,
      // Lot 5 — Sols
      dpgf_parquet_ch: 0.50,      // stratifié basique
      dpgf_carrelage: 0.55,       // grès émaillé standard
      dpgf_parquet_sj: 0.50,      // stratifié
      dpgf_sol_souple: 0.70,
      dpgf_ragerage: 0.90,
      // Lot 6 — Peinture
      dpgf_peint_mur: 0.60,       // mono-couche
      dpgf_peint_plaf: 0.65,
      dpgf_sous_couche: 0.80,
      // Lot 7 — Électricité
      dpgf_prises: 0.75,          // appareillage basique
      dpgf_inter: 0.70,
      dpgf_dcl: 0.75,
      dpgf_tableau: 0.85,
      dpgf_terre: 1.0,
      // Lot 8 — Plomberie
      dpgf_sdb: 0.50,             // sanitaire entrée de gamme
      dpgf_wc: 0.60,
      dpgf_cuisine: 0.55,
      dpgf_alim_eau: 0.80,
      // Lot 9 — Plinthes
      dpgf_plinthes: 0.55,        // MDF blanc
      dpgf_pose_plint: 0.80,
    },
    materialLabels: {
      dpgf_bloc_porte: "Porte isoplane",
      dpgf_fenetre: "Fenêtre PVC éco",
      dpgf_parquet_ch: "Stratifié basique",
      dpgf_parquet_sj: "Stratifié basique",
      dpgf_carrelage: "Grès émaillé standard",
      dpgf_peint_mur: "Peinture mono-couche",
      dpgf_sdb: "SDB basique (céramique)",
      dpgf_plinthes: "Plinthe MDF blanc",
    },
  },
  {
    id: "standard",
    label_key: "scn_standard",
    description_key: "scn_standard_desc",
    icon: "Home",
    color: "#3b82f6",
    tvaRate: 10,
    priceMultipliers: {},       // all × 1.0 (default)
    materialLabels: {},
  },
  {
    id: "premium",
    label_key: "scn_premium",
    description_key: "scn_premium_desc",
    icon: "Star",
    color: "#f59e0b",
    tvaRate: 10,
    priceMultipliers: {
      // Lot 1
      dpgf_depose: 1.0,
      dpgf_gravats: 1.10,
      dpgf_nettoyage: 1.10,
      // Lot 2
      dpgf_ba13: 1.30,            // placo hydro / phonique
      dpgf_enduit: 1.25,
      dpgf_bande: 1.10,
      // Lot 3
      dpgf_bloc_porte: 1.50,      // porte âme pleine
      dpgf_pose_porte: 1.15,
      // Lot 4
      dpgf_fenetre: 1.45,         // alu double vitrage
      dpgf_pose_fen: 1.20,
      // Lot 5
      dpgf_parquet_ch: 1.60,      // parquet contrecollé chêne
      dpgf_carrelage: 1.55,       // grès cérame rectifié
      dpgf_parquet_sj: 1.50,      // contrecollé chêne
      dpgf_sol_souple: 1.40,
      dpgf_ragerage: 1.10,
      // Lot 6
      dpgf_peint_mur: 1.45,       // peinture Tollens / Sikkens
      dpgf_peint_plaf: 1.35,
      dpgf_sous_couche: 1.15,
      // Lot 7
      dpgf_prises: 1.40,          // Schneider / Legrand Céliane
      dpgf_inter: 1.45,
      dpgf_dcl: 1.30,
      dpgf_tableau: 1.20,
      dpgf_terre: 1.0,
      // Lot 8
      dpgf_sdb: 1.55,             // Grohe / Villeroy
      dpgf_wc: 1.50,
      dpgf_cuisine: 1.40,
      dpgf_alim_eau: 1.15,
      // Lot 9
      dpgf_plinthes: 1.50,        // plinthe chêne massif
      dpgf_pose_plint: 1.15,
    },
    materialLabels: {
      dpgf_bloc_porte: "Porte âme pleine",
      dpgf_fenetre: "Fenêtre alu double vitrage",
      dpgf_parquet_ch: "Parquet contrecollé chêne",
      dpgf_parquet_sj: "Parquet contrecollé chêne",
      dpgf_carrelage: "Grès cérame rectifié",
      dpgf_peint_mur: "Peinture Tollens/Sikkens",
      dpgf_prises: "Schneider Odace / Legrand",
      dpgf_sdb: "SDB Grohe / Villeroy",
      dpgf_plinthes: "Plinthe chêne massif",
    },
  },
  {
    id: "luxe",
    label_key: "scn_luxe",
    description_key: "scn_luxe_desc",
    icon: "Crown",
    color: "#a855f7",
    tvaRate: 10,
    priceMultipliers: {
      // Lot 1
      dpgf_depose: 1.10,
      dpgf_gravats: 1.20,
      dpgf_nettoyage: 1.25,
      // Lot 2
      dpgf_ba13: 1.65,            // placo haute performance
      dpgf_enduit: 1.50,
      dpgf_bande: 1.20,
      // Lot 3
      dpgf_bloc_porte: 2.20,      // porte bois massif
      dpgf_pose_porte: 1.35,
      // Lot 4
      dpgf_fenetre: 2.10,         // menuiseries bois / triple vitrage
      dpgf_pose_fen: 1.40,
      // Lot 5
      dpgf_parquet_ch: 2.50,      // parquet massif chêne
      dpgf_carrelage: 2.30,       // marbre / pierre naturelle
      dpgf_parquet_sj: 2.40,      // parquet massif point de Hongrie
      dpgf_sol_souple: 1.80,
      dpgf_ragerage: 1.20,
      // Lot 6
      dpgf_peint_mur: 2.00,       // Farrow & Ball / Little Greene
      dpgf_peint_plaf: 1.70,
      dpgf_sous_couche: 1.30,
      // Lot 7
      dpgf_prises: 1.90,          // Legrand Art / Bticino Axolute
      dpgf_inter: 2.00,
      dpgf_dcl: 1.60,
      dpgf_tableau: 1.40,
      dpgf_terre: 1.0,
      // Lot 8
      dpgf_sdb: 2.30,             // Duravit / Hansgrohe Axor
      dpgf_wc: 2.00,              // WC suspendu Geberit
      dpgf_cuisine: 1.80,
      dpgf_alim_eau: 1.30,
      // Lot 9
      dpgf_plinthes: 2.20,        // plinthe chêne massif profil haut
      dpgf_pose_plint: 1.30,
    },
    materialLabels: {
      dpgf_bloc_porte: "Porte bois massif",
      dpgf_fenetre: "Menuiserie bois triple vitrage",
      dpgf_parquet_ch: "Parquet massif chêne",
      dpgf_parquet_sj: "Parquet massif point de Hongrie",
      dpgf_carrelage: "Marbre / pierre naturelle",
      dpgf_peint_mur: "Peinture Farrow & Ball",
      dpgf_prises: "Legrand Art / Bticino Axolute",
      dpgf_sdb: "SDB Duravit / Hansgrohe Axor",
      dpgf_wc: "WC suspendu Geberit",
      dpgf_plinthes: "Plinthe chêne massif profil haut",
    },
  },
];

// ── Build a single scenario ─────────────────────────────────────────────────

export function buildScenario(
  result: AnalysisResult,
  customDetections: CustomDetection[],
  preset: ScenarioPreset,
  ceilingHeight: number
): ScenarioResult {
  // Start from default DPGF
  const base = buildDefaultDpgf(result, customDetections, { ceilingHeight });

  // Deep-clone and apply multipliers
  const lots = base.lots.map((lot) => {
    const items = lot.items.map((item) => {
      const mult = preset.priceMultipliers[item.description_key] ?? 1.0;
      const newPrice = round2(item.unit_price * mult);
      return {
        ...item,
        unit_price: newPrice,
        total_ht: round2(item.quantity * newPrice),
      };
    });
    return {
      ...lot,
      items,
      subtotal_ht: round2(items.reduce((s, i) => s + i.total_ht, 0)),
    };
  });

  const total_ht = round2(lots.reduce((s, l) => s + l.subtotal_ht, 0));
  const tva_amount = round2(total_ht * (preset.tvaRate / 100));

  return {
    preset,
    dpgf: {
      ...base,
      lots,
      total_ht,
      tva_rate: preset.tvaRate,
      tva_amount,
      total_ttc: round2(total_ht + tva_amount),
    },
  };
}

// ── Compare multiple scenarios ──────────────────────────────────────────────

export function compareScenarios(scenarios: ScenarioResult[]): ComparisonResult {
  // Lot deltas
  const lotMap = new Map<number, LotDelta>();
  for (const sc of scenarios) {
    for (const lot of sc.dpgf.lots) {
      if (!lotMap.has(lot.lot_number)) {
        lotMap.set(lot.lot_number, {
          lotNumber: lot.lot_number,
          titleKey: lot.title_key,
          values: [],
          min: Infinity,
          max: -Infinity,
        });
      }
      const d = lotMap.get(lot.lot_number)!;
      d.values.push(lot.subtotal_ht);
      d.min = Math.min(d.min, lot.subtotal_ht);
      d.max = Math.max(d.max, lot.subtotal_ht);
    }
  }

  const totals = scenarios.map((s) => s.dpgf.total_ht);
  const totalsTtc = scenarios.map((s) => s.dpgf.total_ttc);

  return {
    lotDeltas: Array.from(lotMap.values()).sort((a, b) => a.lotNumber - b.lotNumber),
    totals,
    totalsTtc,
    totalRange: {
      min: Math.min(...totals),
      max: Math.max(...totals),
    },
  };
}
