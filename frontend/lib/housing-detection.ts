/**
 * housing-detection.ts
 *
 * Détecte les logements individuels (T1, T2, T3…) à partir des pièces segmentées.
 * Regroupe les pièces par adjacence spatiale puis classifie chaque logement
 * selon la typologie française (nombre de pièces principales).
 *
 * Règles de classification :
 * - Pièce principale = surface ≥ 9 m² ET type non-service (excl. sdb, wc, cuisine, couloir, dégagement)
 * - T1 / Studio : 1 pièce principale (≤ 30 m² total → Studio, sinon T1)
 * - T2 : 2 pièces principales
 * - T3 : 3 pièces principales
 * - T4 : 4 pièces principales
 * - T5+ : 5+ pièces principales
 *
 * Critères d'habitabilité vérifiés :
 * - Surface habitable minimale (9 m² + hauteur 2.20 m implicite)
 * - Présence d'une pièce d'eau (sdb / wc)
 * - Présence d'une cuisine ou coin cuisine
 * - Surface minimale pièce principale ≥ 9 m²
 *
 * 100% client-side, zero backend dependency.
 */

import type { Room } from "@/lib/types";

// ── Types ──────────────────────────────────────────────────────────────────────

export type HousingTypology = "studio" | "T1" | "T1bis" | "T2" | "T2bis" | "T3" | "T3bis" | "T4" | "T4bis" | "T5+";

export interface HabitabilityCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export interface Housing {
  id: number;
  label: string;                 // "Logement 1", "Logement 2"…
  typology: HousingTypology;
  rooms: Room[];
  main_rooms: Room[];            // pièces principales (≥9m², type principal)
  service_rooms: Room[];         // pièces de service (sdb, wc, cuisine, couloir…)
  area_hab_m2: number;           // surface habitable totale
  area_px2: number;
  main_rooms_count: number;
  has_bathroom: boolean;
  has_kitchen: boolean;
  habitability: HabitabilityCheck[];
  is_habitable: boolean;         // toutes les checks passent
  color: string;
}

export interface HousingResult {
  housings: Housing[];
  circulation: Room[];           // circulations communes (couloir, escalier…)
  total_hab_m2: number;
  total_housings: number;
  typology_distribution: Record<string, number>;  // { "T2": 3, "T3": 2, … }
  avg_area_m2: number;
  habitability_rate: number;     // % de logements habitables
}

// ── Constants ──────────────────────────────────────────────────────────────────

/** Room types considered as service rooms (not main rooms) */
const SERVICE_TYPES = new Set([
  "bathroom", "wc", "toilet", "shower", "kitchen", "kitchenette",
  "hallway", "corridor", "entrance", "lobby", "landing", "hall",
  "storage", "closet", "cellar", "laundry", "utility", "dressing",
  "technical", "balcony", "terrace", "loggia",
]);

/** Room types that are common circulation (not part of any dwelling) */
const CIRCULATION_TYPES = new Set([
  "staircase", "stairs", "elevator", "lift", "parking", "garage",
]);

/** Room types that count as "wet room" (pièce d'eau) */
const WET_ROOM_TYPES = new Set([
  "bathroom", "wc", "toilet", "shower",
]);

/** Room types that count as kitchen */
const KITCHEN_TYPES = new Set([
  "kitchen", "kitchenette",
]);

/** Minimum area in m² for a room to count as a main room */
const MIN_MAIN_ROOM_M2 = 9;

/** Minimum total area for a habitable dwelling (French regulation) */
const MIN_DWELLING_M2 = 9;

/** Palette for housing colors (distinct from lot-detection palette) */
const HOUSING_COLORS = [
  "#60a5fa", // blue-400
  "#f97316", // orange-500
  "#a78bfa", // violet-400
  "#10b981", // emerald-500
  "#f472b6", // pink-400
  "#fbbf24", // amber-400
  "#06b6d4", // cyan-500
  "#ef4444", // red-500
  "#84cc16", // lime-500
  "#8b5cf6", // violet-500
  "#ec4899", // pink-500
  "#14b8a6", // teal-500
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function isCirculation(room: Room): boolean {
  return CIRCULATION_TYPES.has(room.type?.toLowerCase() ?? "");
}

function isServiceRoom(room: Room): boolean {
  const t = room.type?.toLowerCase() ?? "";
  return SERVICE_TYPES.has(t) || CIRCULATION_TYPES.has(t);
}

function isWetRoom(room: Room): boolean {
  const t = room.type?.toLowerCase() ?? "";
  // Also check label_fr for sdb, wc, salle d'eau
  const lbl = room.label_fr?.toLowerCase() ?? "";
  return WET_ROOM_TYPES.has(t) || lbl.includes("sdb") || lbl.includes("salle de bain")
    || lbl.includes("salle d'eau") || lbl.includes("wc") || lbl.includes("douche");
}

function isKitchenRoom(room: Room): boolean {
  const t = room.type?.toLowerCase() ?? "";
  const lbl = room.label_fr?.toLowerCase() ?? "";
  return KITCHEN_TYPES.has(t) || lbl.includes("cuisine") || lbl.includes("kitchenette");
}

function isMainRoom(room: Room): boolean {
  if (isServiceRoom(room)) return false;
  // A main room must have ≥9m² (if we have calibration)
  if (room.area_m2 !== null && room.area_m2 !== undefined && room.area_m2 < MIN_MAIN_ROOM_M2) return false;
  return true;
}

/** Check if two rooms are spatially adjacent (bbox overlap with threshold) */
function areAdjacent(a: Room, b: Room, threshold: number): boolean {
  const ax1 = a.bbox_norm.x - threshold;
  const ay1 = a.bbox_norm.y - threshold;
  const ax2 = a.bbox_norm.x + a.bbox_norm.w + threshold;
  const ay2 = a.bbox_norm.y + a.bbox_norm.h + threshold;

  const bx1 = b.bbox_norm.x;
  const by1 = b.bbox_norm.y;
  const bx2 = b.bbox_norm.x + b.bbox_norm.w;
  const by2 = b.bbox_norm.y + b.bbox_norm.h;

  return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
}

// ── Union-Find ─────────────────────────────────────────────────────────────────

class UnionFind {
  parent: number[];
  rank: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }
  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) this.parent[ra] = rb;
    else if (this.rank[ra] > this.rank[rb]) this.parent[rb] = ra;
    else { this.parent[rb] = ra; this.rank[ra]++; }
  }
}

// ── Typology classification ────────────────────────────────────────────────────

function classifyTypology(mainRooms: Room[], totalArea: number): HousingTypology {
  const n = mainRooms.length;
  if (n === 0) return "studio";

  if (n === 1) {
    // Studio if very small (<30m²), T1 otherwise
    if (totalArea <= 30) return "studio";
    return "T1";
  }

  // "bis" = quand une pièce supplémentaire est petite (9-14m²)
  // Trier par surface pour détecter les "bis"
  const sorted = [...mainRooms].sort((a, b) => (a.area_m2 ?? 0) - (b.area_m2 ?? 0));
  const smallestArea = sorted[0]?.area_m2 ?? 0;
  const hasBis = smallestArea >= MIN_MAIN_ROOM_M2 && smallestArea < 14;

  if (n === 2) return hasBis ? "T1bis" : "T2";
  if (n === 3) return hasBis ? "T2bis" : "T3";
  if (n === 4) return hasBis ? "T3bis" : "T4";
  if (n === 5) return hasBis ? "T4bis" : "T5+";
  return "T5+";
}

// ── Habitability checks ────────────────────────────────────────────────────────

function checkHabitability(
  rooms: Room[],
  mainRooms: Room[],
  hasBathroom: boolean,
  hasKitchen: boolean,
  totalArea: number,
): HabitabilityCheck[] {
  const checks: HabitabilityCheck[] = [];

  // 1. Surface minimale habitable (≥ 9m²)
  checks.push({
    label: "surface_min",
    passed: totalArea >= MIN_DWELLING_M2,
    detail: totalArea >= MIN_DWELLING_M2
      ? `${totalArea.toFixed(1)} m² ≥ ${MIN_DWELLING_M2} m²`
      : `${totalArea.toFixed(1)} m² < ${MIN_DWELLING_M2} m² (min. réglementaire)`,
  });

  // 2. Pièce d'eau
  checks.push({
    label: "wet_room",
    passed: hasBathroom,
    detail: hasBathroom
      ? "Pièce d'eau présente"
      : "Aucune pièce d'eau détectée (SdB / WC)",
  });

  // 3. Cuisine
  checks.push({
    label: "kitchen",
    passed: hasKitchen,
    detail: hasKitchen
      ? "Cuisine / coin cuisine présent"
      : "Aucune cuisine détectée",
  });

  // 4. Au moins 1 pièce principale
  checks.push({
    label: "main_room",
    passed: mainRooms.length >= 1,
    detail: mainRooms.length >= 1
      ? `${mainRooms.length} pièce(s) principale(s)`
      : "Aucune pièce principale (≥ 9 m²)",
  });

  // 5. Pièces principales ≥ 9m² chacune (if calibrated)
  const undersized = mainRooms.filter(r => r.area_m2 !== null && r.area_m2 < MIN_MAIN_ROOM_M2);
  if (mainRooms.length > 0 && mainRooms.some(r => r.area_m2 !== null)) {
    checks.push({
      label: "room_size",
      passed: undersized.length === 0,
      detail: undersized.length === 0
        ? "Toutes les pièces principales ≥ 9 m²"
        : `${undersized.length} pièce(s) < 9 m²`,
    });
  }

  return checks;
}

// ── Main detection function ────────────────────────────────────────────────────

/**
 * Detect individual housing units (logements) from detected rooms.
 *
 * Algorithm:
 * 1. Separate circulation rooms (stairs, elevator, parking) from dwelling rooms
 * 2. Build adjacency graph between dwelling rooms
 * 3. Find connected components using Union-Find → each group = one dwelling
 * 4. For each dwelling, classify main/service rooms and determine typology
 * 5. Run habitability checks
 *
 * @param rooms - Array of Room objects from analysis
 * @param adjacencyThreshold - Max gap between bbox for adjacency (normalized, default 0.02)
 * @returns HousingResult with detected housings
 */
export function detectHousings(
  rooms: Room[],
  adjacencyThreshold = 0.02,
): HousingResult {
  if (rooms.length === 0) {
    return {
      housings: [], circulation: [], total_hab_m2: 0, total_housings: 0,
      typology_distribution: {}, avg_area_m2: 0, habitability_rate: 0,
    };
  }

  // 1. Separate circulation from dwelling rooms
  const dwellingRooms: Room[] = [];
  const circulation: Room[] = [];

  for (const room of rooms) {
    if (isCirculation(room)) {
      circulation.push(room);
    } else {
      dwellingRooms.push(room);
    }
  }

  if (dwellingRooms.length === 0) {
    return {
      housings: [], circulation, total_hab_m2: 0, total_housings: 0,
      typology_distribution: {}, avg_area_m2: 0, habitability_rate: 0,
    };
  }

  // 2. Build adjacency graph & union-find
  const uf = new UnionFind(dwellingRooms.length);
  for (let i = 0; i < dwellingRooms.length; i++) {
    for (let j = i + 1; j < dwellingRooms.length; j++) {
      if (areAdjacent(dwellingRooms[i], dwellingRooms[j], adjacencyThreshold)) {
        uf.union(i, j);
      }
    }
  }

  // 3. Group rooms by connected component
  const groups = new Map<number, Room[]>();
  for (let i = 0; i < dwellingRooms.length; i++) {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(dwellingRooms[i]);
  }

  // 4. Create housing units
  const housings: Housing[] = [];
  let idx = 0;

  for (const [, roomGroup] of groups) {
    const main: Room[] = [];
    const service: Room[] = [];

    for (const r of roomGroup) {
      if (isMainRoom(r)) main.push(r);
      else service.push(r);
    }

    const areaHab = roomGroup.reduce((s, r) => s + (r.area_m2 ?? 0), 0);
    const areaPx2 = roomGroup.reduce((s, r) => s + (r.area_px2 ?? 0), 0);
    const hasBathroom = roomGroup.some(r => isWetRoom(r));
    const hasKitchen = roomGroup.some(r => isKitchenRoom(r));

    const typology = classifyTypology(main, areaHab);
    const habitability = checkHabitability(roomGroup, main, hasBathroom, hasKitchen, areaHab);
    const isHabitable = habitability.every(c => c.passed);

    housings.push({
      id: idx + 1,
      label: `Logement ${idx + 1}`,
      typology,
      rooms: roomGroup,
      main_rooms: main,
      service_rooms: service,
      area_hab_m2: parseFloat(areaHab.toFixed(2)),
      area_px2: areaPx2,
      main_rooms_count: main.length,
      has_bathroom: hasBathroom,
      has_kitchen: hasKitchen,
      habitability,
      is_habitable: isHabitable,
      color: HOUSING_COLORS[idx % HOUSING_COLORS.length],
    });
    idx++;
  }

  // Sort by area descending
  housings.sort((a, b) => b.area_hab_m2 - a.area_hab_m2);
  // Re-number
  housings.forEach((h, i) => {
    h.id = i + 1;
    h.label = `Logement ${i + 1}`;
    h.color = HOUSING_COLORS[i % HOUSING_COLORS.length];
  });

  // 5. Compute stats
  const totalHab = housings.reduce((s, h) => s + h.area_hab_m2, 0);
  const avgArea = housings.length > 0 ? totalHab / housings.length : 0;
  const habitableCount = housings.filter(h => h.is_habitable).length;
  const habitabilityRate = housings.length > 0 ? (habitableCount / housings.length) * 100 : 0;

  // Typology distribution
  const dist: Record<string, number> = {};
  for (const h of housings) {
    dist[h.typology] = (dist[h.typology] ?? 0) + 1;
  }

  return {
    housings,
    circulation,
    total_hab_m2: parseFloat(totalHab.toFixed(2)),
    total_housings: housings.length,
    typology_distribution: dist,
    avg_area_m2: parseFloat(avgArea.toFixed(1)),
    habitability_rate: parseFloat(habitabilityRate.toFixed(0)),
  };
}

// ── Manual editing helpers ─────────────────────────────────────────────────────

/** Move a room from one housing to another */
export function moveRoomToHousing(
  result: HousingResult,
  roomId: number,
  fromHousingId: number,
  toHousingId: number,
): HousingResult {
  const newHousings = result.housings.map(h => ({ ...h, rooms: [...h.rooms] }));
  const from = newHousings.find(h => h.id === fromHousingId);
  const to = newHousings.find(h => h.id === toHousingId);
  if (!from || !to) return result;
  const roomIdx = from.rooms.findIndex(r => r.id === roomId);
  if (roomIdx === -1) return result;
  const [room] = from.rooms.splice(roomIdx, 1);
  to.rooms.push(room);
  return recalcHousings({ ...result, housings: newHousings.filter(h => h.rooms.length > 0) });
}

/** Merge two housings into one */
export function mergeHousings(result: HousingResult, id1: number, id2: number): HousingResult {
  const h1 = result.housings.find(h => h.id === id1);
  const h2 = result.housings.find(h => h.id === id2);
  if (!h1 || !h2 || id1 === id2) return result;
  const merged: Housing = {
    ...h1,
    rooms: [...h1.rooms, ...h2.rooms],
    main_rooms: [], service_rooms: [],
    area_hab_m2: 0, area_px2: 0, main_rooms_count: 0,
    has_bathroom: false, has_kitchen: false,
    habitability: [], is_habitable: false,
    typology: "studio",
  };
  const remaining = result.housings.filter(h => h.id !== id1 && h.id !== id2);
  return recalcHousings({ ...result, housings: [...remaining, merged] });
}

/** Toggle a room between circulation and nearest housing */
export function toggleCirculation(result: HousingResult, roomId: number): HousingResult {
  const circIdx = result.circulation.findIndex(r => r.id === roomId);
  if (circIdx !== -1) {
    // Move from circulation to a new housing
    const room = result.circulation[circIdx];
    const newCirc = result.circulation.filter((_, i) => i !== circIdx);
    const newId = result.housings.length > 0 ? Math.max(...result.housings.map(h => h.id)) + 1 : 1;
    const newH: Housing = {
      id: newId, label: `Logement ${newId}`, typology: "studio",
      rooms: [room], main_rooms: [], service_rooms: [],
      area_hab_m2: room.area_m2 ?? 0, area_px2: room.area_px2,
      main_rooms_count: 0, has_bathroom: false, has_kitchen: false,
      habitability: [], is_habitable: false,
      color: HOUSING_COLORS[(newId - 1) % HOUSING_COLORS.length],
    };
    return recalcHousings({ ...result, housings: [...result.housings, newH], circulation: newCirc });
  }

  // Move from a housing to circulation
  for (const h of result.housings) {
    const ri = h.rooms.findIndex(r => r.id === roomId);
    if (ri !== -1) {
      const room = h.rooms[ri];
      const newHousings = result.housings.map(hh =>
        hh.id === h.id ? { ...hh, rooms: hh.rooms.filter((_, i) => i !== ri) } : hh
      ).filter(hh => hh.rooms.length > 0);
      return recalcHousings({
        ...result,
        housings: newHousings,
        circulation: [...result.circulation, room],
      });
    }
  }

  return result;
}

/** Recalculate all housing metrics after manual edits */
function recalcHousings(result: HousingResult): HousingResult {
  const housings = result.housings.map((h, i) => {
    const main: Room[] = [];
    const service: Room[] = [];
    for (const r of h.rooms) {
      if (isMainRoom(r)) main.push(r);
      else service.push(r);
    }
    const areaHab = h.rooms.reduce((s, r) => s + (r.area_m2 ?? 0), 0);
    const areaPx2 = h.rooms.reduce((s, r) => s + (r.area_px2 ?? 0), 0);
    const hasBathroom = h.rooms.some(r => isWetRoom(r));
    const hasKitchen = h.rooms.some(r => isKitchenRoom(r));
    const typology = classifyTypology(main, areaHab);
    const habitability = checkHabitability(h.rooms, main, hasBathroom, hasKitchen, areaHab);
    const isHabitable = habitability.every(c => c.passed);

    return {
      ...h,
      id: i + 1,
      label: `Logement ${i + 1}`,
      typology,
      main_rooms: main,
      service_rooms: service,
      area_hab_m2: parseFloat(areaHab.toFixed(2)),
      area_px2: areaPx2,
      main_rooms_count: main.length,
      has_bathroom: hasBathroom,
      has_kitchen: hasKitchen,
      habitability,
      is_habitable: isHabitable,
      color: HOUSING_COLORS[i % HOUSING_COLORS.length],
    };
  });

  const totalHab = housings.reduce((s, h) => s + h.area_hab_m2, 0);
  const avgArea = housings.length > 0 ? totalHab / housings.length : 0;
  const habitableCount = housings.filter(h => h.is_habitable).length;
  const habitabilityRate = housings.length > 0 ? (habitableCount / housings.length) * 100 : 0;

  const dist: Record<string, number> = {};
  for (const h of housings) dist[h.typology] = (dist[h.typology] ?? 0) + 1;

  return {
    housings,
    circulation: result.circulation,
    total_hab_m2: parseFloat(totalHab.toFixed(2)),
    total_housings: housings.length,
    typology_distribution: dist,
    avg_area_m2: parseFloat(avgArea.toFixed(1)),
    habitability_rate: parseFloat(habitabilityRate.toFixed(0)),
  };
}
