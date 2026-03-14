/**
 * Snap Intelligent — Multi-criteria snapping engine for the room polygon editor.
 *
 * Priority order:  vertex > wall > midpoint > alignment > grid
 */

import type { WallSegment, Room } from "@/lib/types";

// ── Types ────────────────────────────────────────────────────────────────────

export type SnapType =
  | "vertex"
  | "wall"
  | "midpoint"
  | "grid"
  | "align_h"
  | "align_v"
  | null;

export interface SnapGuide {
  type: "horizontal" | "vertical" | "point";
  /** Normalized coordinates (0-1) */
  x1: number; y1: number;
  x2: number; y2: number;
  color: string;
  label?: string;
}

export interface SnapResult {
  x: number;
  y: number;
  snapped: boolean;
  snapType: SnapType;
  guides: SnapGuide[];
  snapLabel?: string;
}

export interface SnapConfig {
  enableVertex: boolean;
  enableWall: boolean;
  enableMidpoint: boolean;
  enableGrid: boolean;
  enableAlignment: boolean;
  gridSpacingNorm: number;
  thresholdPx: number;
}

export const DEFAULT_SNAP_CONFIG: SnapConfig = {
  enableVertex: true,
  enableWall: true,
  enableMidpoint: true,
  enableGrid: true,
  enableAlignment: true,
  gridSpacingNorm: 0.025,
  thresholdPx: 10,
};

// ── Internal candidate type ──────────────────────────────────────────────────

interface SnapCandidate {
  x: number;
  y: number;
  distPx: number;
  priority: number; // lower = higher priority
  type: SnapType;
  guides: SnapGuide[];
  label: string;
}

// ── Helper: project point onto line segment ──────────────────────────────────

function projectOntoSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): { cx: number; cy: number; t: number; dist: number } {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const dist = Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
    return { cx: ax, cy: ay, t: 0, dist };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx, cy = ay + t * dy;
  const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
  return { cx, cy, t, dist };
}

// ── Collect all vertices from rooms (except current vertex) ──────────────────

function collectVertices(
  rooms: Room[] | undefined,
  currentRoomId: number,
  currentVertexIdx: number
): { x: number; y: number; roomId: number; idx: number }[] {
  if (!rooms) return [];
  const verts: { x: number; y: number; roomId: number; idx: number }[] = [];
  for (const room of rooms) {
    if (!room.polygon_norm) continue;
    for (let i = 0; i < room.polygon_norm.length; i++) {
      // Exclude the vertex being dragged
      if (room.id === currentRoomId && i === currentVertexIdx) continue;
      verts.push({ x: room.polygon_norm[i].x, y: room.polygon_norm[i].y, roomId: room.id, idx: i });
    }
  }
  return verts;
}

// ── Main snap function ───────────────────────────────────────────────────────

export function snapIntelligent(
  normX: number,
  normY: number,
  config: SnapConfig,
  context: {
    walls: WallSegment[] | undefined;
    rooms: Room[] | undefined;
    currentRoomId: number;
    currentVertexIdx: number;
    dispW: number;
    dispH: number;
  }
): SnapResult {
  const { walls, rooms, currentRoomId, currentVertexIdx, dispW, dispH } = context;
  const threshold = config.thresholdPx;
  const px = normX * dispW;
  const py = normY * dispH;

  const candidates: SnapCandidate[] = [];

  // ── 1. Vertex snap (priority 0 — highest) ──
  if (config.enableVertex) {
    const verts = collectVertices(rooms, currentRoomId, currentVertexIdx);
    for (const v of verts) {
      const vx = v.x * dispW, vy = v.y * dispH;
      const dist = Math.sqrt((px - vx) ** 2 + (py - vy) ** 2);
      if (dist <= threshold) {
        candidates.push({
          x: v.x, y: v.y, distPx: dist, priority: 0,
          type: "vertex",
          guides: [{ type: "point", x1: v.x, y1: v.y, x2: v.x, y2: v.y, color: "#22d3ee" }],
          label: "Sommet",
        });
      }
    }
  }

  // ── 2. Wall snap (priority 1) ──
  if (config.enableWall && walls && walls.length > 0) {
    for (const w of walls) {
      const ax = w.x1_norm * dispW, ay = w.y1_norm * dispH;
      const bx = w.x2_norm * dispW, by = w.y2_norm * dispH;
      const proj = projectOntoSegment(px, py, ax, ay, bx, by);
      if (proj.dist <= threshold) {
        candidates.push({
          x: proj.cx / dispW, y: proj.cy / dispH, distPx: proj.dist, priority: 1,
          type: "wall",
          guides: [{
            type: "horizontal", // just a line
            x1: w.x1_norm, y1: w.y1_norm,
            x2: w.x2_norm, y2: w.y2_norm,
            color: "#f97316",
          }],
          label: "Mur",
        });
      }
    }
  }

  // ── 3. Wall midpoint snap (priority 2) ──
  if (config.enableMidpoint && walls && walls.length > 0) {
    for (const w of walls) {
      const mx = (w.x1_norm + w.x2_norm) / 2;
      const my = (w.y1_norm + w.y2_norm) / 2;
      const mpx = mx * dispW, mpy = my * dispH;
      const dist = Math.sqrt((px - mpx) ** 2 + (py - mpy) ** 2);
      if (dist <= threshold * 0.8) {
        candidates.push({
          x: mx, y: my, distPx: dist, priority: 2,
          type: "midpoint",
          guides: [{ type: "point", x1: mx, y1: my, x2: mx, y2: my, color: "#f59e0b" }],
          label: "Milieu",
        });
      }
    }
  }

  // ── 4. Alignment snap (priority 3) ──
  if (config.enableAlignment) {
    const verts = collectVertices(rooms, currentRoomId, currentVertexIdx);
    const alignThreshold = threshold * 0.6;

    // Horizontal alignment (same Y)
    let bestHDist = Infinity;
    let bestHVert: typeof verts[0] | null = null;
    for (const v of verts) {
      const dy = Math.abs(py - v.y * dispH);
      if (dy < alignThreshold && dy < bestHDist) {
        bestHDist = dy;
        bestHVert = v;
      }
    }
    if (bestHVert) {
      candidates.push({
        x: normX, y: bestHVert.y, distPx: bestHDist, priority: 3,
        type: "align_h",
        guides: [{
          type: "horizontal",
          x1: 0, y1: bestHVert.y, x2: 1, y2: bestHVert.y,
          color: "#a78bfa",
        }],
        label: "Align H",
      });
    }

    // Vertical alignment (same X)
    let bestVDist = Infinity;
    let bestVVert: typeof verts[0] | null = null;
    for (const v of verts) {
      const dx = Math.abs(px - v.x * dispW);
      if (dx < alignThreshold && dx < bestVDist) {
        bestVDist = dx;
        bestVVert = v;
      }
    }
    if (bestVVert) {
      candidates.push({
        x: bestVVert.x, y: normY, distPx: bestVDist, priority: 3,
        type: "align_v",
        guides: [{
          type: "vertical",
          x1: bestVVert.x, y1: 0, x2: bestVVert.x, y2: 1,
          color: "#a78bfa",
        }],
        label: "Align V",
      });
    }

    // If both alignments are active, create a cross-snap (snap to the intersection)
    if (bestHVert && bestVVert && bestHDist < alignThreshold && bestVDist < alignThreshold) {
      const combinedDist = Math.sqrt(bestHDist ** 2 + bestVDist ** 2);
      candidates.push({
        x: bestVVert.x, y: bestHVert.y, distPx: combinedDist, priority: 2,
        type: "align_v",
        guides: [
          { type: "horizontal", x1: 0, y1: bestHVert.y, x2: 1, y2: bestHVert.y, color: "#a78bfa" },
          { type: "vertical", x1: bestVVert.x, y1: 0, x2: bestVVert.x, y2: 1, color: "#a78bfa" },
        ],
        label: "Align +",
      });
    }
  }

  // ── 5. Grid snap (priority 4) ──
  if (config.enableGrid) {
    const gs = config.gridSpacingNorm;
    if (gs > 0) {
      const gx = Math.round(normX / gs) * gs;
      const gy = Math.round(normY / gs) * gs;
      const gpx = gx * dispW, gpy = gy * dispH;
      const dist = Math.sqrt((px - gpx) ** 2 + (py - gpy) ** 2);
      if (dist <= threshold * 0.8) {
        candidates.push({
          x: gx, y: gy, distPx: dist, priority: 4,
          type: "grid",
          guides: [{ type: "point", x1: gx, y1: gy, x2: gx, y2: gy, color: "#10b981" }],
          label: "Grille",
        });
      }
    }
  }

  // ── Select best candidate ──────────────────────────────────────────────

  if (candidates.length === 0) {
    return { x: normX, y: normY, snapped: false, snapType: null, guides: [] };
  }

  // Sort by priority first, then by distance
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.distPx - b.distPx;
  });

  const best = candidates[0];
  return {
    x: best.x,
    y: best.y,
    snapped: true,
    snapType: best.type,
    guides: best.guides,
    snapLabel: best.label,
  };
}
