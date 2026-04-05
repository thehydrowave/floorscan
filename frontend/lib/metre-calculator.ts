/**
 * metre-calculator.ts
 *
 * Computes detailed per-room quantity take-off from AnalysisResult.
 * Produces floor, wall (gross/net), ceiling, baseboard and opening
 * quantities for each detected room.
 */

import type { AnalysisResult, Room, Opening } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RoomMetre {
  room_label: string;
  room_type: string;
  floor_area_m2: number;
  perimeter_m: number;
  wall_area_gross_m2: number;
  openings_area_m2: number;
  wall_area_net_m2: number;
  ceiling_area_m2: number;
  doors_count: number;
  windows_count: number;
  plinth_length_m: number;
}

export interface MetreResult {
  rooms: RoomMetre[];
  totals: RoomMetre;
  has_scale: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Estimate image extent from opening pixel coordinates.
 * Used to normalise opening positions for bbox overlap checks.
 */
function estimateImageExtent(openings: Opening[]): { w: number; h: number } {
  let maxX = 1;
  let maxY = 1;
  for (const o of openings) {
    const ex = o.x_px + o.width_px;
    const ey = o.y_px + o.height_px;
    if (ex > maxX) maxX = ex;
    if (ey > maxY) maxY = ey;
  }
  return { w: maxX, h: maxY };
}

/**
 * Check if an opening's centre falls within a room's bbox (normalised).
 */
function openingInRoom(
  op: Opening,
  room: Room,
  imgW: number,
  imgH: number
): boolean {
  if (!room.bbox_norm) return false;
  const cx = (op.x_px + op.width_px / 2) / imgW;
  const cy = (op.y_px + op.height_px / 2) / imgH;
  const b = room.bbox_norm;
  return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
}

function emptyMetre(label: string, type: string): RoomMetre {
  return {
    room_label: label,
    room_type: type,
    floor_area_m2: 0,
    perimeter_m: 0,
    wall_area_gross_m2: 0,
    openings_area_m2: 0,
    wall_area_net_m2: 0,
    ceiling_area_m2: 0,
    doors_count: 0,
    windows_count: 0,
    plinth_length_m: 0,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function computeMetre(
  result: AnalysisResult,
  params: { ceilingHeight: number }
): MetreResult {
  const { ceilingHeight } = params;
  const rooms = result.rooms ?? [];
  const openings = result.openings ?? [];
  const hasScale = !!result.pixels_per_meter;

  // If no rooms detected, produce a single global line
  if (rooms.length === 0) {
    const areaHab = result.surfaces?.area_hab_m2 ?? 0;
    const perim = result.surfaces?.perim_interior_m ?? 0;
    const wallGross = round2(perim * ceilingHeight);
    const totalOpeningArea = openings
      .filter((o) => o.width_m && o.height_m)
      .reduce((s, o) => s + o.width_m! * o.height_m!, 0);
    const totalOpeningWidth = openings.reduce(
      (s, o) => s + (o.width_m ?? o.length_m ?? 0),
      0
    );
    const wallNet = round2(Math.max(0, wallGross - totalOpeningArea));
    const plinth = round2(Math.max(0, perim - totalOpeningWidth));

    const global: RoomMetre = {
      room_label: "Global",
      room_type: "global",
      floor_area_m2: round2(areaHab),
      perimeter_m: round2(perim),
      wall_area_gross_m2: wallGross,
      openings_area_m2: round2(totalOpeningArea),
      wall_area_net_m2: wallNet,
      ceiling_area_m2: round2(areaHab),
      doors_count: result.doors_count ?? 0,
      windows_count: result.windows_count ?? 0,
      plinth_length_m: plinth,
    };

    return { rooms: [global], totals: global, has_scale: hasScale };
  }

  // Image extent for normalising opening positions
  const imgExt = estimateImageExtent(openings);

  // Build per-room metre
  const metreRooms: RoomMetre[] = [];

  for (const room of rooms) {
    const floor = round2(room.area_m2 ?? 0);
    let perim = round2(room.perimeter_m ?? 0);
    if (perim === 0 && room.polygon_norm && room.polygon_norm.length >= 3 && result.pixels_per_meter) {
      const ppm = result.pixels_per_meter;
      const imgW = result.img_w ?? 1024;
      const imgH = result.img_h ?? 1024;
      let p = 0;
      for (let i = 0; i < room.polygon_norm.length; i++) {
        const a = room.polygon_norm[i];
        const b = room.polygon_norm[(i + 1) % room.polygon_norm.length];
        const dx = (b.x - a.x) * imgW / ppm;
        const dy = (b.y - a.y) * imgH / ppm;
        p += Math.sqrt(dx * dx + dy * dy);
      }
      perim = round2(p);
    }
    const wallGross = round2(perim * ceilingHeight);

    // Find openings in this room
    const roomOpenings = openings.filter((o) =>
      openingInRoom(o, room, imgExt.w, imgExt.h)
    );

    const doorsInRoom = roomOpenings.filter((o) => o.class === "door");
    const windowsInRoom = roomOpenings.filter((o) => o.class === "window");

    // Opening area deduction (only if we have metric dimensions)
    const openingArea = round2(
      roomOpenings
        .filter((o) => o.width_m && o.height_m)
        .reduce((s, o) => s + o.width_m! * o.height_m!, 0)
    );

    // Opening width deduction (for plinth)
    const openingWidth = roomOpenings.reduce(
      (s, o) => s + (o.width_m ?? o.length_m ?? 0),
      0
    );

    const wallNet = round2(Math.max(0, wallGross - openingArea));
    const plinth = round2(Math.max(0, perim - openingWidth));

    metreRooms.push({
      room_label: room.label_fr || room.type || `Pièce ${room.id}`,
      room_type: room.type || "other",
      floor_area_m2: floor,
      perimeter_m: perim,
      wall_area_gross_m2: wallGross,
      openings_area_m2: openingArea,
      wall_area_net_m2: wallNet,
      ceiling_area_m2: floor, // ceiling ≈ floor area
      doors_count: doorsInRoom.length,
      windows_count: windowsInRoom.length,
      plinth_length_m: plinth,
    });
  }

  // Totals row
  const totals = emptyMetre("TOTAL", "total");
  for (const r of metreRooms) {
    totals.floor_area_m2 += r.floor_area_m2;
    totals.perimeter_m += r.perimeter_m;
    totals.wall_area_gross_m2 += r.wall_area_gross_m2;
    totals.openings_area_m2 += r.openings_area_m2;
    totals.wall_area_net_m2 += r.wall_area_net_m2;
    totals.ceiling_area_m2 += r.ceiling_area_m2;
    totals.doors_count += r.doors_count;
    totals.windows_count += r.windows_count;
    totals.plinth_length_m += r.plinth_length_m;
  }
  // Round totals
  totals.floor_area_m2 = round2(totals.floor_area_m2);
  totals.perimeter_m = round2(totals.perimeter_m);
  totals.wall_area_gross_m2 = round2(totals.wall_area_gross_m2);
  totals.openings_area_m2 = round2(totals.openings_area_m2);
  totals.wall_area_net_m2 = round2(totals.wall_area_net_m2);
  totals.ceiling_area_m2 = round2(totals.ceiling_area_m2);
  totals.plinth_length_m = round2(totals.plinth_length_m);

  return { rooms: metreRooms, totals, has_scale: hasScale };
}
