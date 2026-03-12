/**
 * Helpers de données locales pour le mode prototype UI.
 * Aucun backend, aucun appel réseau, aucune dépendance externe.
 */

import type { AnalysisResult } from "./types";

// ─── Session ID ───────────────────────────────────────────────────────────────

export function makeMockSessionId(): string {
  return "fs-" + Math.random().toString(36).slice(2, 10).toUpperCase();
}

// ─── Image placeholder ────────────────────────────────────────────────────────

/**
 * Génère un plan de sol illustratif en Canvas et retourne un base64 PNG.
 * SSR-safe : retourne un PNG transparent 1×1 si document est undefined.
 */
export async function createPlaceholderPngB64(opts?: {
  title?: string;
  subtitle?: string;
}): Promise<string> {
  const title = opts?.title ?? "Plan d'appartement — Type T3";
  const subtitle = opts?.subtitle ?? "Prêt pour l'analyse";

  if (typeof document === "undefined") {
    return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  }

  const W = 900;
  const H = 640;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Background
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, W, H);

  // Grid léger
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 0.5;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // Outer walls
  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 8;
  ctx.strokeRect(60, 60, W - 120, H - 120);

  // Interior walls
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#334155";
  ctx.beginPath(); ctx.moveTo(380, 60); ctx.lineTo(380, 400); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(380, 430); ctx.lineTo(380, H - 60); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(60, 280); ctx.lineTo(380, 280); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(380, 200); ctx.lineTo(W - 60, 200); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(380, 430); ctx.lineTo(W - 60, 430); ctx.stroke();

  // Room fills
  const rooms = [
    { x: 65, y: 65, w: 310, h: 210, color: "rgba(14,165,233,0.04)" },
    { x: 65, y: 285, w: 310, h: 230, color: "rgba(139,92,246,0.04)" },
    { x: 385, y: 65, w: 390, h: 130, color: "rgba(16,185,129,0.04)" },
    { x: 385, y: 205, w: 390, h: 220, color: "rgba(245,158,11,0.04)" },
    { x: 385, y: 435, w: 390, h: 145, color: "rgba(59,130,246,0.04)" },
  ];
  rooms.forEach(r => { ctx.fillStyle = r.color; ctx.fillRect(r.x, r.y, r.w, r.h); });

  // Room labels
  ctx.fillStyle = "#94a3b8";
  ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "center";
  [
    { x: 220, y: 175, label: "Chambre 1", area: "18,5 m²" },
    { x: 220, y: 365, label: "Chambre 2", area: "15,8 m²" },
    { x: 580, y: 128, label: "Séjour", area: "28,2 m²" },
    { x: 580, y: 315, label: "Cuisine", area: "14,5 m²" },
    { x: 580, y: 498, label: "Salle de bain", area: "7,2 m²" },
  ].forEach(r => {
    ctx.fillStyle = "#64748b";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText(r.label, r.x, r.y);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px sans-serif";
    ctx.fillText(r.area, r.x, r.y + 18);
  });

  // Doors — arcs architecturaux
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 2;
  const doors = [
    { cx: 380, cy: 350, r: 40, startA: Math.PI * 1.5, endA: 0, lx1: 380, ly1: 310, lx2: 380, ly2: 350, lx3: 420, ly3: 350 },
    { cx: 60, cy: 200, r: 35, startA: 0, endA: Math.PI * 0.5, lx1: 60, ly1: 165, lx2: 60, ly2: 200, lx3: 95, ly3: 200 },
    { cx: 380, cy: 160, r: 38, startA: 0, endA: Math.PI * 0.5, lx1: 380, ly1: 122, lx2: 380, ly2: 160, lx3: 418, ly3: 160 },
  ];
  doors.forEach(d => {
    ctx.beginPath(); ctx.arc(d.cx, d.cy, d.r, d.startA, d.endA); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(d.lx1, d.ly1); ctx.lineTo(d.lx2, d.ly2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(d.lx2, d.ly2); ctx.lineTo(d.lx3, d.ly3); ctx.stroke();
    // Label
    ctx.fillStyle = "#ef4444";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.fillText("PORTE", d.lx2 + 10, d.ly1 - 6);
  });

  // Detection bounding boxes — doors
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 1.5;
  ctx.fillStyle = "rgba(239,68,68,0.08)";
  [[350, 310, 80, 45], [45, 163, 55, 42], [370, 121, 55, 42]].forEach(([x, y, w, h]) => {
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  });

  // Windows — lignes doubles
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 2.5;
  ctx.fillStyle = "rgba(59,130,246,0.1)";
  const windows = [
    { x: 150, y: 57, w: 90, h: 6 },
    { x: W - 63, y: 260, w: 6, h: 80 },
    { x: 480, y: 57, w: 110, h: 6 },
  ];
  windows.forEach(w => {
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.strokeRect(w.x, w.y, w.w, w.h);
    // inner line
    ctx.lineWidth = 1;
    const inner = w.w > w.h
      ? { x: w.x + 2, y: w.y + 2, w: w.w - 4, h: Math.max(2, w.h - 4) }
      : { x: w.x + 2, y: w.y + 2, w: Math.max(2, w.w - 4), h: w.h - 4 };
    ctx.strokeRect(inner.x, inner.y, inner.w, inner.h);
    ctx.lineWidth = 2.5;
    // label
    ctx.fillStyle = "#2563eb";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.fillText("FENÊTRE", w.x + w.w / 2, w.y - 5);
  });

  // Detection bounding boxes — windows
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 1.5;
  ctx.fillStyle = "rgba(59,130,246,0.08)";
  [[145, 52, 100, 16], [W - 68, 254, 16, 92], [475, 52, 120, 16]].forEach(([x, y, w, h]) => {
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  });

  // Footer
  ctx.fillStyle = "rgba(248,250,252,0.95)";
  ctx.fillRect(0, H - 70, W, 70);
  ctx.fillStyle = "#0ea5e9";
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(title, 20, H - 42);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px sans-serif";
  ctx.fillText(subtitle, 20, H - 22);
  ctx.fillStyle = "#10b981";
  ctx.font = "bold 10px monospace";
  ctx.textAlign = "right";
  ctx.fillText("● FloorScan IA", W - 20, H - 32);

  return canvas.toDataURL("image/png").split(",")[1];
}

// ─── Résultat d'analyse ───────────────────────────────────────────────────────

export function makeMockAnalysisResult(sessionId: string, overlayB64: string): AnalysisResult {
  const openings = [
    { class: "door" as const, x_px: 350, y_px: 310, width_px: 80, height_px: 45, length_px: 80, area_px2: 3600, length_m: 0.90, width_m: 0.10, height_m: 2.10 },
    { class: "door" as const, x_px: 45, y_px: 163, width_px: 55, height_px: 42, length_px: 75, area_px2: 2310, length_m: 0.85, width_m: 0.10, height_m: 2.10 },
    { class: "door" as const, x_px: 370, y_px: 121, width_px: 55, height_px: 42, length_px: 80, area_px2: 2310, length_m: 0.90, width_m: 0.10, height_m: 2.10 },
    { class: "window" as const, x_px: 145, y_px: 52, width_px: 100, height_px: 16, length_px: 90, area_px2: 1600, length_m: 1.20, width_m: 0.12, height_m: 1.20 },
    { class: "window" as const, x_px: 772, y_px: 254, width_px: 16, height_px: 92, length_px: 80, area_px2: 1472, length_m: 1.10, width_m: 0.12, height_m: 1.20 },
    { class: "window" as const, x_px: 475, y_px: 52, width_px: 120, height_px: 16, length_px: 100, area_px2: 1920, length_m: 1.35, width_m: 0.12, height_m: 1.20 },
  ];

  // ── Mock rooms matching the canvas layout (W=900, H=640, ppm=75.5) ──
  const rooms = [
    {
      id: 0, type: "living room", label_fr: "Séjour",
      centroid_norm: { x: 0.244, y: 0.266 },
      bbox_norm: { x: 0.072, y: 0.102, w: 0.345, h: 0.328 },
      area_m2: 25.8, area_px2: 64500, perimeter_m: 20.6,
      polygon_norm: [
        { x: 0.072, y: 0.102 }, { x: 0.417, y: 0.102 },
        { x: 0.417, y: 0.430 }, { x: 0.072, y: 0.430 },
      ],
    },
    {
      id: 1, type: "bedroom", label_fr: "Chambre",
      centroid_norm: { x: 0.244, y: 0.625 },
      bbox_norm: { x: 0.072, y: 0.445, w: 0.345, h: 0.360 },
      area_m2: 22.4, area_px2: 56000, perimeter_m: 19.2,
      polygon_norm: [
        { x: 0.072, y: 0.445 }, { x: 0.417, y: 0.445 },
        { x: 0.417, y: 0.805 }, { x: 0.072, y: 0.805 },
      ],
    },
    {
      id: 2, type: "kitchen", label_fr: "Cuisine",
      centroid_norm: { x: 0.644, y: 0.203 },
      bbox_norm: { x: 0.428, y: 0.102, w: 0.433, h: 0.203 },
      area_m2: 14.8, area_px2: 37000, perimeter_m: 15.8,
      polygon_norm: [
        { x: 0.428, y: 0.102 }, { x: 0.861, y: 0.102 },
        { x: 0.861, y: 0.305 }, { x: 0.428, y: 0.305 },
      ],
    },
    {
      id: 3, type: "bathroom", label_fr: "Salle de bain",
      centroid_norm: { x: 0.644, y: 0.492 },
      bbox_norm: { x: 0.428, y: 0.320, w: 0.433, h: 0.344 },
      area_m2: 15.2, area_px2: 38000, perimeter_m: 16.4,
      polygon_norm: [
        { x: 0.428, y: 0.320 }, { x: 0.861, y: 0.320 },
        { x: 0.861, y: 0.664 }, { x: 0.428, y: 0.664 },
      ],
    },
    {
      id: 4, type: "hallway", label_fr: "Couloir",
      centroid_norm: { x: 0.644, y: 0.793 },
      bbox_norm: { x: 0.428, y: 0.680, w: 0.433, h: 0.226 },
      area_m2: 6.0, area_px2: 15000, perimeter_m: 11.8,
      polygon_norm: [
        { x: 0.428, y: 0.680 }, { x: 0.861, y: 0.680 },
        { x: 0.861, y: 0.906 }, { x: 0.428, y: 0.906 },
      ],
    },
  ];

  return {
    session_id: sessionId,
    doors_count: 3,
    windows_count: 3,
    pixels_per_meter: 75.5,
    openings,
    rooms,
    surfaces: {
      area_building_m2: 98.4,
      area_walls_m2: 14.2,
      area_hab_m2: 84.2,
      perim_building_m: 39.8,
      perim_interior_m: 36.2,
      area_building_px2: 561060,
      area_interior_px2: 480430,
    },
    overlay_openings_b64: overlayB64,
    overlay_interior_b64: overlayB64,
    mask_doors_b64: overlayB64,
    mask_windows_b64: overlayB64,
    mask_walls_b64: overlayB64,
  };
}
