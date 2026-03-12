/**
 * gantt-builder.ts
 *
 * Computes a Gantt schedule from a DpgfState using productivity rates
 * and a dependency graph between lots.
 */

import type { DpgfState } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GanttTask {
  lot_number: number;
  title_key: string;
  color: string;
  icon: string;
  start_day: number;
  duration_days: number;
  depends_on: number[];
}

// ── Productivity rates (units per day per person) ─────────────────────────────

const PRODUCTIVITY: Record<number, { rate: number; unit: string }> = {
  1: { rate: 10, unit: "m2" },      // Démolition : 10 m²/day
  2: { rate: 15, unit: "m2" },      // Cloisons : 15 m²/day
  3: { rate: 2, unit: "U" },        // Menuiseries int. : 2 doors/day
  4: { rate: 2, unit: "U" },        // Menuiseries ext. : 2 windows/day
  5: { rate: 12, unit: "m2" },      // Revêtements sol : 12 m²/day
  6: { rate: 25, unit: "m2" },      // Peinture : 25 m²/day
  7: { rate: 8, unit: "U" },        // Électricité : 8 points/day
  8: { rate: 1, unit: "forfait" },  // Plomberie : forfait (fixed 5 days)
  9: { rate: 20, unit: "ml" },      // Plinthes : 20 ml/day
};

// Fixed durations for forfait lots
const FIXED_DURATIONS: Record<number, number> = {
  8: 5, // Plomberie : 5 days
};

// ── Dependency graph ──────────────────────────────────────────────────────────
// Key = lot_number, value = lots that must finish before this lot can start

const DEPENDENCIES: Record<number, number[]> = {
  1: [],
  2: [1],
  3: [2],
  4: [1],
  5: [6],     // Sol after peinture (clean floors last)
  6: [2, 3, 7, 8],
  7: [2],
  8: [2],
  9: [5],
};

// Topological order for scheduling
const TOPO_ORDER = [1, 4, 2, 3, 7, 8, 6, 5, 9];

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Compute the main quantity for a lot from its DPGF items.
 * For most lots this is the sum of all item quantities.
 */
function lotQuantity(dpgf: DpgfState, lotNumber: number): number {
  const lot = dpgf.lots.find((l) => l.lot_number === lotNumber);
  if (!lot || lot.items.length === 0) return 0;
  return lot.items.reduce((s, item) => s + item.quantity, 0);
}

export function buildGanttTasks(
  dpgf: DpgfState,
  params: { teamSize: number }
): GanttTask[] {
  const { teamSize } = params;
  const tasks: GanttTask[] = [];
  const endDays: Record<number, number> = {};

  for (const lotNum of TOPO_ORDER) {
    const lot = dpgf.lots.find((l) => l.lot_number === lotNum);
    if (!lot) continue;

    // Compute duration
    let duration: number;
    if (FIXED_DURATIONS[lotNum]) {
      duration = FIXED_DURATIONS[lotNum];
    } else {
      const qty = lotQuantity(dpgf, lotNum);
      const prod = PRODUCTIVITY[lotNum];
      if (!prod || qty <= 0) {
        duration = 0;
      } else {
        duration = Math.max(1, Math.ceil(qty / (prod.rate * teamSize)));
      }
    }

    // Skip lots with 0 duration (no items)
    if (duration === 0) {
      endDays[lotNum] = 0;
      continue;
    }

    // Compute start day from dependencies
    const deps = DEPENDENCIES[lotNum] ?? [];
    let startDay = 0;
    for (const dep of deps) {
      const depEnd = endDays[dep] ?? 0;
      if (depEnd > startDay) startDay = depEnd;
    }

    endDays[lotNum] = startDay + duration;

    tasks.push({
      lot_number: lotNum,
      title_key: lot.title_key,
      color: lot.color,
      icon: lot.icon,
      start_day: startDay,
      duration_days: duration,
      depends_on: deps.filter((d) => (endDays[d] ?? 0) > 0),
    });
  }

  // Sort tasks by start_day then lot_number for display
  tasks.sort((a, b) => a.start_day - b.start_day || a.lot_number - b.lot_number);

  return tasks;
}

/**
 * Compute total project duration in days.
 */
export function totalDuration(tasks: GanttTask[]): number {
  let max = 0;
  for (const t of tasks) {
    const end = t.start_day + t.duration_days;
    if (end > max) max = end;
  }
  return max;
}
