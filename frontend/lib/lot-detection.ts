/**
 * lot-detection.ts
 *
 * Detects copropriété lots (individual dwelling units) from detected rooms.
 * Groups rooms by spatial adjacency, identifies common areas, and calculates
 * tantièmes (ownership shares).
 *
 * 100% client-side, zero backend dependency.
 */

import type { Room } from "@/lib/types";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CoproLot {
  id: number;
  label: string;             // "Lot 1", "Lot 2"…
  rooms: Room[];
  area_m2: number;           // total habitable area
  area_px2: number;
  tantiemes: number;         // ownership share (out of 1000)
  color: string;
}

export interface CoproResult {
  lots: CoproLot[];
  common_areas: Room[];
  total_private_m2: number;
  total_common_m2: number;
  total_tantiemes: number;   // always 1000
}

// ── Constants ──────────────────────────────────────────────────────────────────

/** Room types considered as common areas in a copropriété */
const COMMON_AREA_TYPES = new Set([
  "hallway", "corridor", "staircase", "stairs", "elevator", "lift",
  "entrance", "lobby", "landing", "hall", "garage", "parking",
  "storage", "closet", "cellar", "technical",
]);

/** Palette for lot colors */
const LOT_COLORS = [
  "#818cf8", // indigo
  "#34d399", // emerald
  "#fb923c", // orange
  "#22d3ee", // cyan
  "#f472b6", // pink
  "#a78bfa", // violet
  "#fbbf24", // amber
  "#6ee7b7", // green
  "#f87171", // red
  "#38bdf8", // sky
];

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Check if a room type is a common area */
function isCommonArea(room: Room): boolean {
  return COMMON_AREA_TYPES.has(room.type?.toLowerCase() ?? "");
}

/**
 * Check if two rooms are spatially adjacent.
 * Two rooms are adjacent if their bounding boxes overlap or are within
 * a threshold distance (normalized coordinates).
 */
function areAdjacent(a: Room, b: Room, threshold = 0.02): boolean {
  const ax1 = a.bbox_norm.x - threshold;
  const ay1 = a.bbox_norm.y - threshold;
  const ax2 = a.bbox_norm.x + a.bbox_norm.w + threshold;
  const ay2 = a.bbox_norm.y + a.bbox_norm.h + threshold;

  const bx1 = b.bbox_norm.x;
  const by1 = b.bbox_norm.y;
  const bx2 = b.bbox_norm.x + b.bbox_norm.w;
  const by2 = b.bbox_norm.y + b.bbox_norm.h;

  // Check if expanded bbox of A overlaps with bbox of B
  return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
}

// ── Union-Find for connected components ────────────────────────────────────────

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
    if (this.rank[ra] < this.rank[rb]) { this.parent[ra] = rb; }
    else if (this.rank[ra] > this.rank[rb]) { this.parent[rb] = ra; }
    else { this.parent[rb] = ra; this.rank[ra]++; }
  }
}

// ── Main detection function ────────────────────────────────────────────────────

/**
 * Detect copropriété lots from detected rooms.
 *
 * Algorithm:
 * 1. Separate rooms into private and common areas (by type)
 * 2. Build adjacency graph between private rooms
 * 3. Find connected components using Union-Find
 * 4. Each component = one lot (apartment)
 * 5. Calculate tantièmes proportionally to surface area
 *
 * @param rooms - Array of Room objects from analysis
 * @param adjacencyThreshold - Max gap between bbox for adjacency (normalized, default 0.02)
 * @returns CoproResult with lots and common areas
 */
export function detectLots(
  rooms: Room[],
  adjacencyThreshold = 0.02,
): CoproResult {
  if (rooms.length === 0) {
    return { lots: [], common_areas: [], total_private_m2: 0, total_common_m2: 0, total_tantiemes: 1000 };
  }

  // 1. Separate common areas from private rooms
  const privateRooms: Room[] = [];
  const commonAreas: Room[] = [];

  for (const room of rooms) {
    if (isCommonArea(room)) {
      commonAreas.push(room);
    } else {
      privateRooms.push(room);
    }
  }

  // If no private rooms, everything is common
  if (privateRooms.length === 0) {
    return {
      lots: [],
      common_areas: rooms,
      total_private_m2: 0,
      total_common_m2: rooms.reduce((s, r) => s + (r.area_m2 ?? 0), 0),
      total_tantiemes: 1000,
    };
  }

  // 2. Build adjacency graph & union-find
  const uf = new UnionFind(privateRooms.length);

  for (let i = 0; i < privateRooms.length; i++) {
    for (let j = i + 1; j < privateRooms.length; j++) {
      if (areAdjacent(privateRooms[i], privateRooms[j], adjacencyThreshold)) {
        uf.union(i, j);
      }
    }
  }

  // 3. Group rooms by connected component
  const groups = new Map<number, Room[]>();
  for (let i = 0; i < privateRooms.length; i++) {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(privateRooms[i]);
  }

  // 4. Create lots
  const totalPrivateM2 = privateRooms.reduce((s, r) => s + (r.area_m2 ?? 0), 0);
  const totalCommonM2 = commonAreas.reduce((s, r) => s + (r.area_m2 ?? 0), 0);

  const lots: CoproLot[] = [];
  let lotIdx = 0;

  for (const [, roomGroup] of groups) {
    const areaM2 = roomGroup.reduce((s, r) => s + (r.area_m2 ?? 0), 0);
    const areaPx2 = roomGroup.reduce((s, r) => s + (r.area_px2 ?? 0), 0);

    // Tantièmes proportional to surface
    const tantiemes = totalPrivateM2 > 0
      ? Math.round((areaM2 / totalPrivateM2) * 1000)
      : Math.round(1000 / groups.size);

    lots.push({
      id: lotIdx + 1,
      label: `Lot ${lotIdx + 1}`,
      rooms: roomGroup,
      area_m2: parseFloat(areaM2.toFixed(2)),
      area_px2: areaPx2,
      tantiemes,
      color: LOT_COLORS[lotIdx % LOT_COLORS.length],
    });

    lotIdx++;
  }

  // Sort lots by area descending
  lots.sort((a, b) => b.area_m2 - a.area_m2);
  // Re-number after sort
  lots.forEach((lot, i) => {
    lot.id = i + 1;
    lot.label = `Lot ${i + 1}`;
    lot.color = LOT_COLORS[i % LOT_COLORS.length];
  });

  // Adjust tantièmes to sum exactly 1000
  const totalTant = lots.reduce((s, l) => s + l.tantiemes, 0);
  if (totalTant !== 1000 && lots.length > 0) {
    lots[0].tantiemes += 1000 - totalTant;
  }

  return {
    lots,
    common_areas: commonAreas,
    total_private_m2: parseFloat(totalPrivateM2.toFixed(2)),
    total_common_m2: parseFloat(totalCommonM2.toFixed(2)),
    total_tantiemes: 1000,
  };
}

// ── Manual lot editing helpers ─────────────────────────────────────────────────

/** Move a room from one lot to another */
export function moveRoomToLot(
  result: CoproResult,
  roomId: number,
  fromLotId: number,
  toLotId: number,
): CoproResult {
  const newLots = result.lots.map(l => ({ ...l, rooms: [...l.rooms] }));

  const fromLot = newLots.find(l => l.id === fromLotId);
  const toLot = newLots.find(l => l.id === toLotId);
  if (!fromLot || !toLot) return result;

  const roomIdx = fromLot.rooms.findIndex(r => r.id === roomId);
  if (roomIdx === -1) return result;

  const [room] = fromLot.rooms.splice(roomIdx, 1);
  toLot.rooms.push(room);

  // Recalculate areas and tantièmes
  return recalcLots({ ...result, lots: newLots.filter(l => l.rooms.length > 0) });
}

/** Toggle a room between common area and a lot */
export function toggleCommonArea(
  result: CoproResult,
  roomId: number,
): CoproResult {
  // Check if room is in common areas
  const commonIdx = result.common_areas.findIndex(r => r.id === roomId);
  if (commonIdx !== -1) {
    // Move from common to new lot
    const room = result.common_areas[commonIdx];
    const newCommon = result.common_areas.filter((_, i) => i !== commonIdx);
    const newLotId = result.lots.length > 0 ? Math.max(...result.lots.map(l => l.id)) + 1 : 1;
    const newLot: CoproLot = {
      id: newLotId,
      label: `Lot ${newLotId}`,
      rooms: [room],
      area_m2: room.area_m2 ?? 0,
      area_px2: room.area_px2,
      tantiemes: 0,
      color: LOT_COLORS[(newLotId - 1) % LOT_COLORS.length],
    };
    return recalcLots({ ...result, lots: [...result.lots, newLot], common_areas: newCommon });
  }

  // Check if room is in a lot
  for (const lot of result.lots) {
    const roomIdx = lot.rooms.findIndex(r => r.id === roomId);
    if (roomIdx !== -1) {
      const room = lot.rooms[roomIdx];
      const newLots = result.lots.map(l =>
        l.id === lot.id ? { ...l, rooms: l.rooms.filter((_, i) => i !== roomIdx) } : l
      ).filter(l => l.rooms.length > 0);
      return recalcLots({ ...result, lots: newLots, common_areas: [...result.common_areas, room] });
    }
  }

  return result;
}

/** Recalculate areas and tantièmes after manual edits */
function recalcLots(result: CoproResult): CoproResult {
  const totalPrivateM2 = result.lots.reduce(
    (s, l) => s + l.rooms.reduce((rs, r) => rs + (r.area_m2 ?? 0), 0), 0
  );
  const totalCommonM2 = result.common_areas.reduce((s, r) => s + (r.area_m2 ?? 0), 0);

  const lots = result.lots.map((l, i) => {
    const areaM2 = l.rooms.reduce((s, r) => s + (r.area_m2 ?? 0), 0);
    const areaPx2 = l.rooms.reduce((s, r) => s + (r.area_px2 ?? 0), 0);
    const tantiemes = totalPrivateM2 > 0
      ? Math.round((areaM2 / totalPrivateM2) * 1000)
      : Math.round(1000 / result.lots.length);

    return { ...l, id: i + 1, label: `Lot ${i + 1}`, area_m2: parseFloat(areaM2.toFixed(2)), area_px2: areaPx2, tantiemes, color: LOT_COLORS[i % LOT_COLORS.length] };
  });

  // Adjust tantièmes to sum to 1000
  const totalTant = lots.reduce((s, l) => s + l.tantiemes, 0);
  if (totalTant !== 1000 && lots.length > 0) {
    lots[0].tantiemes += 1000 - totalTant;
  }

  return {
    lots,
    common_areas: result.common_areas,
    total_private_m2: parseFloat(totalPrivateM2.toFixed(2)),
    total_common_m2: parseFloat(totalCommonM2.toFixed(2)),
    total_tantiemes: 1000,
  };
}

/** Merge two lots into one */
export function mergeLots(result: CoproResult, lotId1: number, lotId2: number): CoproResult {
  const lot1 = result.lots.find(l => l.id === lotId1);
  const lot2 = result.lots.find(l => l.id === lotId2);
  if (!lot1 || !lot2 || lotId1 === lotId2) return result;

  const mergedRooms = [...lot1.rooms, ...lot2.rooms];
  const remaining = result.lots.filter(l => l.id !== lotId1 && l.id !== lotId2);

  const mergedLot: CoproLot = {
    id: 0,
    label: "",
    rooms: mergedRooms,
    area_m2: 0,
    area_px2: 0,
    tantiemes: 0,
    color: lot1.color,
  };

  return recalcLots({ ...result, lots: [...remaining, mergedLot] });
}

/** Split a lot: move specified rooms to a new lot */
export function splitLot(result: CoproResult, lotId: number, roomIds: number[]): CoproResult {
  const lot = result.lots.find(l => l.id === lotId);
  if (!lot) return result;

  const movedRooms = lot.rooms.filter(r => roomIds.includes(r.id));
  const keptRooms = lot.rooms.filter(r => !roomIds.includes(r.id));

  if (movedRooms.length === 0 || keptRooms.length === 0) return result;

  const updatedLot = { ...lot, rooms: keptRooms };
  const newLot: CoproLot = {
    id: 0, label: "", rooms: movedRooms,
    area_m2: 0, area_px2: 0, tantiemes: 0, color: "",
  };

  const others = result.lots.filter(l => l.id !== lotId);
  return recalcLots({ ...result, lots: [...others, updatedLot, newLot] });
}
