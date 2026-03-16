// ── Shared room color palette ────────────────────────────────────────────────
// Single source of truth for room-type → color mapping used across
// results-step, editor-step, dashboard-panel, floor-scene, etc.

export const ROOM_COLORS: Record<string, string> = {
  bedroom:       "#818cf8",
  "living room": "#34d399",
  living:        "#34d399",
  kitchen:       "#fb923c",
  bathroom:      "#22d3ee",
  hallway:       "#94a3b8",
  corridor:      "#94a3b8",
  office:        "#a78bfa",
  study:         "#a78bfa",
  wc:            "#fbbf24",
  toilet:        "#fbbf24",
  "dining room": "#f472b6",
  storage:       "#78716c",
  closet:        "#78716c",
  garage:        "#6b7280",
  balcony:       "#86efac",
  laundry:       "#67e8f9",
};

export const DEFAULT_ROOM_COLOR = "#94a3b8";

export function getRoomColor(type: string): string {
  return ROOM_COLORS[type?.toLowerCase()] ?? DEFAULT_ROOM_COLOR;
}
