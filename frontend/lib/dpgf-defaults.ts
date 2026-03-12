/**
 * dpgf-defaults.ts
 *
 * Price database and quantity calculation engine for the DPGF module.
 * Builds a full DpgfState from an AnalysisResult using French renovation
 * market prices (2024-2025).
 */

import type {
  AnalysisResult,
  CustomDetection,
  DpgfState,
  DpgfLot,
  DpgfLineItem,
  DpgfUnit,
  Room,
} from "@/lib/types";

// ── Helpers ─────────────────────────────────────────────────────────────────

let _idCounter = 0;
function uid(): string {
  return `dpgf_${++_idCounter}_${Date.now().toString(36)}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function line(
  descKey: string,
  quantity: number,
  unit: DpgfUnit,
  unitPrice: number
): DpgfLineItem {
  const q = round2(quantity);
  return {
    id: uid(),
    description_key: descKey,
    quantity: q,
    unit,
    unit_price: unitPrice,
    total_ht: round2(q * unitPrice),
  };
}

function makeLot(
  lotNumber: number,
  titleKey: string,
  icon: string,
  color: string,
  items: DpgfLineItem[]
): DpgfLot {
  const filtered = items.filter((i) => i.quantity > 0);
  return {
    lot_number: lotNumber,
    title_key: titleKey,
    icon,
    color,
    items: filtered,
    subtotal_ht: round2(filtered.reduce((s, i) => s + i.total_ht, 0)),
  };
}

// ── Room categorisation (mirrors materials-panel.tsx) ────────────────────────

type RoomCategory =
  | "living"
  | "kitchen"
  | "bedroom"
  | "bathroom"
  | "wc"
  | "corridor"
  | "other";

function categorise(room: Room): RoomCategory {
  const t = room.type?.toLowerCase() ?? "";
  if (t.includes("living")) return "living";
  if (t.includes("kitchen") || t.includes("cuisine")) return "kitchen";
  if (t.includes("bedroom") || t.includes("chambre")) return "bedroom";
  if (t.includes("bathroom") || t.includes("salle")) return "bathroom";
  if (t.includes("wc") || t.includes("toilet")) return "wc";
  if (t.includes("corridor") || t.includes("hall")) return "corridor";
  return "other";
}

interface RoomBucket {
  living: Room[];
  kitchen: Room[];
  bedroom: Room[];
  bathroom: Room[];
  wc: Room[];
  corridor: Room[];
  other: Room[];
}

function bucketRooms(rooms: Room[]): RoomBucket {
  const b: RoomBucket = {
    living: [],
    kitchen: [],
    bedroom: [],
    bathroom: [],
    wc: [],
    corridor: [],
    other: [],
  };
  for (const r of rooms) {
    b[categorise(r)].push(r);
  }
  return b;
}

function sumArea(rooms: Room[]): number {
  return rooms.reduce((s, r) => s + (r.area_m2 ?? 0), 0);
}

// ── NFC 15-100 outlet counts per room category ──────────────────────────────

const PRISES_PER_CATEGORY: Record<RoomCategory, number> = {
  living: 5,
  kitchen: 6,
  bedroom: 3,
  bathroom: 2,
  wc: 1,
  corridor: 1,
  other: 1,
};

// ── Main builder ────────────────────────────────────────────────────────────

export function buildDefaultDpgf(
  result: AnalysisResult,
  customDetections: CustomDetection[],
  params: { ceilingHeight: number }
): DpgfState {
  // Reset id counter for deterministic IDs within a single call
  _idCounter = 0;

  const { ceilingHeight } = params;
  const rooms = result.rooms ?? [];
  const hasRooms = rooms.length > 0;
  const bucket = bucketRooms(rooms);

  // Global surfaces
  const areaHab = result.surfaces?.area_hab_m2 ?? 0;
  const perimInterior = result.surfaces?.perim_interior_m ?? 0;
  const wallArea = perimInterior * ceilingHeight;

  // Openings
  const doorsCount = result.doors_count ?? 0;
  const windowsCount = result.windows_count ?? 0;

  // Total opening widths (for plinth deduction)
  const openingWidths = (result.openings ?? []).reduce(
    (s, o) => s + (o.width_m ?? o.length_m ?? 0),
    0
  );

  // Total opening area (for paint deduction)
  const openingArea = (result.openings ?? [])
    .filter((o) => o.width_m && o.height_m)
    .reduce((s, o) => s + o.width_m! * o.height_m!, 0);

  // ── LOT 1 — Démolition / Préparation ──────────────────────────────────────

  const lot1 = makeLot(1, "dpgf_lot1", "Hammer", "#ef4444", [
    line("dpgf_depose", areaHab, "m2", 12),
    line("dpgf_gravats", areaHab > 0 ? 1 : 0, "forfait", 450),
    line("dpgf_nettoyage", areaHab > 0 ? 1 : 0, "forfait", round2(areaHab * 3.5)),
  ]);

  // ── LOT 2 — Plâtrerie / Cloisons ─────────────────────────────────────────

  const lot2 = makeLot(2, "dpgf_lot2", "Layers", "#f59e0b", [
    line("dpgf_ba13", wallArea, "m2", 45),
    line("dpgf_enduit", wallArea, "m2", 8),
    line("dpgf_bande", perimInterior, "ml", 4.5),
  ]);

  // ── LOT 3 — Menuiseries intérieures ───────────────────────────────────────

  const lot3 = makeLot(3, "dpgf_lot3", "DoorOpen", "#d946ef", [
    line("dpgf_bloc_porte", doorsCount, "U", 280),
    line("dpgf_pose_porte", doorsCount, "U", 120),
  ]);

  // ── LOT 4 — Menuiseries extérieures ───────────────────────────────────────

  const lot4 = makeLot(4, "dpgf_lot4", "LayoutGrid", "#22d3ee", [
    line("dpgf_fenetre", windowsCount, "U", 450),
    line("dpgf_pose_fen", windowsCount, "U", 180),
  ]);

  // ── LOT 5 — Revêtements de sol ────────────────────────────────────────────

  const WASTE = 1.10;
  const lot5Items: DpgfLineItem[] = [];

  if (hasRooms) {
    // Parquet stratifié for bedrooms
    const bedroomArea = sumArea(bucket.bedroom);
    if (bedroomArea > 0) {
      lot5Items.push(line("dpgf_parquet_ch", bedroomArea * WASTE, "m2", 35));
    }

    // Carrelage for bathroom + wc + kitchen
    const carrelageArea =
      sumArea(bucket.bathroom) + sumArea(bucket.wc) + sumArea(bucket.kitchen);
    if (carrelageArea > 0) {
      lot5Items.push(line("dpgf_carrelage", carrelageArea * WASTE, "m2", 55));
    }

    // Parquet contrecollé for living
    const livingArea = sumArea(bucket.living);
    if (livingArea > 0) {
      lot5Items.push(line("dpgf_parquet_sj", livingArea * WASTE, "m2", 45));
    }

    // Sol souple for corridor + other
    const soupleArea = sumArea(bucket.corridor) + sumArea(bucket.other);
    if (soupleArea > 0) {
      lot5Items.push(line("dpgf_sol_souple", soupleArea * WASTE, "m2", 25));
    }
  } else {
    // No rooms detail: single line for total hab area
    if (areaHab > 0) {
      lot5Items.push(line("dpgf_parquet_sj", areaHab * WASTE, "m2", 45));
    }
  }

  // Ragréage always on total hab area
  lot5Items.push(line("dpgf_ragerage", areaHab, "m2", 12));

  const lot5 = makeLot(5, "dpgf_lot5", "Grid3X3", "#10b981", lot5Items);

  // ── LOT 6 — Peinture ─────────────────────────────────────────────────────

  const paintableWalls = Math.max(0, wallArea - openingArea);
  const ceilingsArea = areaHab;
  const sousCoucheArea = paintableWalls + ceilingsArea;

  const lot6 = makeLot(6, "dpgf_lot6", "Paintbrush", "#818cf8", [
    line("dpgf_peint_mur", paintableWalls, "m2", 18),
    line("dpgf_peint_plaf", ceilingsArea, "m2", 15),
    line("dpgf_sous_couche", sousCoucheArea, "m2", 6),
  ]);

  // ── LOT 7 — Électricité ──────────────────────────────────────────────────

  const roomCount = hasRooms ? rooms.length : 1;
  let prisesTotal = 0;

  if (hasRooms) {
    for (const r of rooms) {
      prisesTotal += PRISES_PER_CATEGORY[categorise(r)];
    }
  } else {
    // Fallback: assume 1 room with minimum outlets
    prisesTotal = 1;
  }

  const lot7 = makeLot(7, "dpgf_lot7", "Zap", "#facc15", [
    line("dpgf_prises", prisesTotal, "U", 45),
    line("dpgf_inter", roomCount, "U", 35),
    line("dpgf_dcl", roomCount, "U", 55),
    line("dpgf_tableau", 1, "forfait", 650),
    line("dpgf_terre", 1, "forfait", 250),
  ]);

  // ── LOT 8 — Plomberie / Sanitaire ────────────────────────────────────────

  const sdbCount = bucket.bathroom.length;
  const wcCount = bucket.wc.length;
  const cuisineCount = bucket.kitchen.length;
  const needsWater = sdbCount + wcCount + cuisineCount > 0;

  const lot8 = makeLot(8, "dpgf_lot8", "Droplets", "#3b82f6", [
    line("dpgf_sdb", sdbCount, "forfait", 3500),
    line("dpgf_wc", wcCount, "forfait", 800),
    line("dpgf_cuisine", cuisineCount, "forfait", 1200),
    line("dpgf_alim_eau", needsWater ? 1 : 0, "forfait", 850),
  ]);

  // ── LOT 9 — Plinthes ─────────────────────────────────────────────────────

  const plinthLength = Math.max(0, perimInterior - openingWidths);

  const lot9 = makeLot(9, "dpgf_lot9", "Minus", "#94a3b8", [
    line("dpgf_plinthes", plinthLength, "ml", 8.5),
    line("dpgf_pose_plint", plinthLength, "ml", 4.5),
  ]);

  // ── Assemble all lots ─────────────────────────────────────────────────────

  const lots = [lot1, lot2, lot3, lot4, lot5, lot6, lot7, lot8, lot9];
  const totalHt = round2(lots.reduce((s, l) => s + l.subtotal_ht, 0));
  const tvaRate = 10; // Taux réduit rénovation
  const tvaAmount = round2(totalHt * (tvaRate / 100));
  const totalTtc = round2(totalHt + tvaAmount);

  return {
    lots,
    total_ht: totalHt,
    tva_rate: tvaRate,
    tva_amount: tvaAmount,
    total_ttc: totalTtc,
    project_name: "",
    project_address: "",
    date: new Date().toISOString().slice(0, 10),
  };
}
