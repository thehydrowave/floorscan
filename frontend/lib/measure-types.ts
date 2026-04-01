export interface AssemblyItem {
  ref: string;       // référence article / SKU
  label: string;     // description
  unitLabel: string; // "m²", "ml", "U", "kg"…
  qtyPerM2: number;  // quantité par m² de surface
  pricePerUnit?: number; // €/unité
}

export interface SurfaceType {
  id: string;
  name: string;
  color: string; // hex
  pricePerM2?: number;   // €/m²
  wastePercent?: number; // % chute (ex: 10 = 10%)
  boxSizeM2?: number;    // m² par boîte/rouleau (0 = non défini)
  assembly?: AssemblyItem[]; // template matériaux par m²
  defaultDepthM?: number;  // profondeur par défaut du type (m) pour calcul volume
}

// ── Outil linéaire (longueur / ml) ───────────────────────────────────────────

export interface LinearCategory {
  id: string;
  name: string;
  color: string;       // hex
  pricePerM?: number;  // €/ml
}

export interface LinearMeasure {
  id: string;
  categoryId: string;
  points: { x: number; y: number }[]; // normalized 0-1, open polyline
}

export const DEFAULT_LINEAR_CATEGORIES: LinearCategory[] = [
  { id: "lin_plinthe",    name: "Plinthe",              color: "#F97316" },
  { id: "lin_joint",      name: "Joint de dilatation",  color: "#8B5CF6" },
  { id: "lin_cimaise",    name: "Cimaise",              color: "#10B981" },
  { id: "lin_baguette",   name: "Baguette d'angle",     color: "#06B6D4" },
];

/** Longueur en mètres d'une mesure linéaire */
export function linearLengthM(
  points: { x: number; y: number }[],
  imageW: number,
  imageH: number,
  ppm: number
): number {
  if (points.length < 2 || ppm <= 0) return 0;
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = (points[i + 1].x - points[i].x) * imageW;
    const dy = (points[i + 1].y - points[i].y) * imageH;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len / ppm;
}

/** Longueur totale en mètres pour toutes les mesures d'une catégorie */
export function aggregateLinearByCategory(
  measures: LinearMeasure[],
  imageW: number,
  imageH: number,
  ppm: number | null
): Record<string, number> {
  if (!ppm) return {};
  const result: Record<string, number> = {};
  for (const m of measures) {
    result[m.categoryId] = (result[m.categoryId] ?? 0) + linearLengthM(m.points, imageW, imageH, ppm);
  }
  return result;
}

// ── Outil comptage (count tool) ───────────────────────────────────────────────

export interface CountGroup {
  id: string;
  name: string;
  color: string;        // hex
  pricePerUnit?: number; // €/unité
}

export interface CountPoint {
  id: string;
  groupId: string;
  x: number; // normalized 0-1
  y: number; // normalized 0-1
}

export const DEFAULT_COUNT_GROUPS: CountGroup[] = [
  { id: "cnt_prise",        name: "Prise électrique", color: "#F59E0B" },
  { id: "cnt_interrupteur", name: "Interrupteur",      color: "#06B6D4" },
  { id: "cnt_luminaire",    name: "Luminaire",         color: "#EC4899" },
  { id: "cnt_siphon",       name: "Siphon",            color: "#10B981" },
];

export interface MeasureZone {
  id: string;
  typeId: string;
  name?: string;                       // nom personnalisé optionnel
  note?: string;                       // remarque libre (ex: "attention dénivelé")
  points: { x: number; y: number }[]; // normalized 0-1 relative to image
  isDeduction?: boolean;               // si true, zone soustraite du total
  depthM?: number;                     // profondeur en mètres (pour volume)
  slopeDeg?: number;                   // angle de pente en degrés (pour surface corrigée)
}

export interface PlanSnapshot {
  id: string;
  name: string;
  imageB64: string;
  imageMime: string;
  zones: MeasureZone[];
  ppm: number | null;
}

export const DEFAULT_SURFACE_TYPES: SurfaceType[] = [
  { id: "carrelage", name: "Carrelage",  color: "#3B82F6", wastePercent: 10, pricePerM2: 35 },
  { id: "parquet",   name: "Parquet",    color: "#F97316", wastePercent: 10, pricePerM2: 50 },
  { id: "peinture",  name: "Peinture",   color: "#8B5CF6", wastePercent: 15, pricePerM2: 12 },
  { id: "beton",     name: "Béton",      color: "#6B7280", wastePercent: 10, pricePerM2: 80 },
  { id: "moquette",  name: "Moquette",   color: "#EC4899", wastePercent: 10, pricePerM2: 25 },
];

/** Shoelace formula — points en coords normalisées (0-1), imageW/H en px */
export function polygonAreaPx(
  points: { x: number; y: number }[],
  imageW: number,
  imageH: number
): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * imageW * points[j].y * imageH;
    area -= points[j].x * imageW * points[i].y * imageH;
  }
  return Math.abs(area) / 2;
}

/** Alias for polygonAreaPx — polygon area in pixels from normalized coords */
export const polygonAreaNorm = polygonAreaPx;

/** Périmètre en mètres */
export function polygonPerimeterM(
  points: { x: number; y: number }[],
  imageW: number,
  imageH: number,
  ppm: number
): number {
  if (!ppm || ppm <= 0) return 0;
  if (points.length < 2) return 0;
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const dx = (points[j].x - points[i].x) * imageW;
    const dy = (points[j].y - points[i].y) * imageH;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  return perimeter / ppm;
}

/** Agrégation surfaces par type — déductions soustraites */
export function aggregateByType(
  zones: MeasureZone[],
  imageW: number,
  imageH: number,
  ppm: number | null
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const zone of zones) {
    const areaPx = polygonAreaPx(zone.points, imageW, imageH);
    const area = ppm ? areaPx / ppm ** 2 : areaPx;
    const sign = zone.isDeduction ? -1 : 1;
    result[zone.typeId] = (result[zone.typeId] ?? 0) + sign * area;
  }
  // Pas de valeurs négatives (déduction > zone)
  for (const k in result) if (result[k] < 0) result[k] = 0;
  return result;
}

/** Agrégation périmètres par type (zones positives uniquement) */
export function aggregatePerimeterByType(
  zones: MeasureZone[],
  imageW: number,
  imageH: number,
  ppm: number
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const zone of zones) {
    if (zone.isDeduction) continue;
    const p = polygonPerimeterM(zone.points, imageW, imageH, ppm);
    result[zone.typeId] = (result[zone.typeId] ?? 0) + p;
  }
  return result;
}

// ── Split helpers ─────────────────────────────────────────────────────────────

/** Point-in-polygon test (ray-casting algorithm) */
export function pointInPolygon(
  point: { x: number; y: number },
  polygon: { x: number; y: number }[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (
      ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Intersection of a polygon edge (p1→p2) with an infinite line through (p3, p4).
 *  Returns the intersection point and parameter t ∈ (0,1) on the edge, or null. */
function edgeLineIntersection(
  p1: { x: number; y: number }, p2: { x: number; y: number },
  p3: { x: number; y: number }, p4: { x: number; y: number }
): { point: { x: number; y: number }; t: number } | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return null; // parallel
  const dx = p3.x - p1.x, dy = p3.y - p1.y;
  const t = (dx * d2y - dy * d2x) / cross;
  if (t <= 1e-9 || t >= 1 - 1e-9) return null; // must be strictly inside edge
  return { point: { x: p1.x + t * d1x, y: p1.y + t * d1y }, t };
}

/** Split a polygon into 2 parts along the infinite line through lineA→lineB.
 *  Returns [poly1, poly2] or null if the line doesn't cross the polygon in ≥ 2 edges. */
export function splitPolygonByLine(
  polygon: { x: number; y: number }[],
  lineA: { x: number; y: number },
  lineB: { x: number; y: number }
): [{ x: number; y: number }[], { x: number; y: number }[]] | null {
  if (polygon.length < 3) return null;

  // Find intersections of the infinite line with each polygon edge
  const hits: { point: { x: number; y: number }; edgeIndex: number; t: number }[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const inter = edgeLineIntersection(polygon[i], polygon[j], lineA, lineB);
    if (inter) hits.push({ point: inter.point, edgeIndex: i, t: inter.t });
  }

  if (hits.length < 2) return null;

  // Sort by edge index, then by t within same edge
  hits.sort((a, b) => a.edgeIndex - b.edgeIndex || a.t - b.t);

  // Use only first 2 intersections (handles convex & simple concave cases)
  const usedHits = hits.slice(0, 2);

  // Walk around the polygon, alternating between poly1 and poly2 at each intersection
  const poly1: { x: number; y: number }[] = [];
  const poly2: { x: number; y: number }[] = [];
  let current = poly1;

  for (let i = 0; i < polygon.length; i++) {
    current.push(polygon[i]);
    // Check if an intersection falls on edge i → (i+1)
    const edgeHits = usedHits
      .filter(h => h.edgeIndex === i)
      .sort((a, b) => a.t - b.t);
    for (const h of edgeHits) {
      current.push(h.point);
      current = current === poly1 ? poly2 : poly1;
      current.push(h.point);
    }
  }

  if (poly1.length < 3 || poly2.length < 3) return null;
  return [poly1, poly2];
}

// ── Room types (pièces) + Emprise au sol ─────────────────────────────────────

export const ROOM_SURFACE_TYPES: SurfaceType[] = [
  { id: "room_bedroom",  name: "Chambre",        color: "#818cf8" },
  { id: "room_living",   name: "Séjour",         color: "#34d399" },
  { id: "room_kitchen",  name: "Cuisine",        color: "#fb923c" },
  { id: "room_bathroom", name: "Salle de bain",  color: "#22d3ee" },
  { id: "room_hallway",  name: "Couloir",        color: "#94a3b8" },
  { id: "room_office",   name: "Bureau",         color: "#a78bfa" },
  { id: "room_wc",       name: "WC",             color: "#fbbf24" },
  { id: "room_dining",   name: "Salle à manger", color: "#f472b6" },
  { id: "room_storage",  name: "Rangement",      color: "#78716c" },
  { id: "room_garage",   name: "Garage",         color: "#6b7280" },
  { id: "room_balcony",  name: "Balcon",         color: "#86efac" },
  { id: "room_laundry",  name: "Buanderie",      color: "#67e8f9" },
];

export const EMPRISE_TYPE: SurfaceType = {
  id: "room_emprise", name: "Emprise au sol", color: "#60A5FA",
};

/** All room types including emprise */
export const ALL_ROOM_TYPES: SurfaceType[] = [...ROOM_SURFACE_TYPES, EMPRISE_TYPE];

/** Check if a typeId belongs to a room (or emprise) */
export const isRoomTypeId = (id: string) => id.startsWith("room_");

/** Check if a typeId is the building footprint */
export const isEmpriseTypeId = (id: string) => id === "room_emprise";

// ── Angle measurement (lifted from canvas for persistence) ──────────────────

export interface AngleMeasurement {
  id: string;
  a: { x: number; y: number };  // premier bras (normalized)
  v: { x: number; y: number };  // sommet (normalized)
  b: { x: number; y: number };  // deuxième bras (normalized)
  label?: string;
}

/** Calcule l'angle en degrés d'un AngleMeasurement */
export function angleDeg(am: AngleMeasurement): number {
  const dA = { x: am.a.x - am.v.x, y: am.a.y - am.v.y };
  const dB = { x: am.b.x - am.v.x, y: am.b.y - am.v.y };
  const dot = dA.x * dB.x + dA.y * dB.y;
  const magA = Math.hypot(dA.x, dA.y), magB = Math.hypot(dB.x, dB.y);
  if (magA < 1e-9 || magB < 1e-9) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot / (magA * magB)))) * 180 / Math.PI;
}

// ── Circle measurement ──────────────────────────────────────────────────────

export interface CircleMeasure {
  id: string;
  categoryId: string;                     // réutilise LinearCategory
  center: { x: number; y: number };       // normalized 0-1
  edgePoint: { x: number; y: number };    // normalized 0-1
}

/** Métriques d'un cercle (rayon, diamètre, périmètre, surface) */
export function circleMetrics(
  circle: CircleMeasure,
  imageW: number,
  imageH: number,
  ppm: number | null
): { radiusM: number; diameterM: number; circumferenceM: number; areaM2: number } | null {
  if (!ppm || ppm <= 0) return null;
  const dx = (circle.edgePoint.x - circle.center.x) * imageW;
  const dy = (circle.edgePoint.y - circle.center.y) * imageH;
  const radiusM = Math.sqrt(dx * dx + dy * dy) / ppm;
  return {
    radiusM,
    diameterM: radiusM * 2,
    circumferenceM: 2 * Math.PI * radiusM,
    areaM2: Math.PI * radiusM * radiusM,
  };
}

// ── Volume & pente ──────────────────────────────────────────────────────────

/** Surface corrigée par la pente */
export function slopeCorrectedArea(baseAreaM2: number, slopeDeg?: number): number {
  if (!slopeDeg || slopeDeg <= 0 || slopeDeg >= 90) return baseAreaM2;
  return baseAreaM2 / Math.cos((slopeDeg * Math.PI) / 180);
}

/** Volume d'une zone (area × depth), avec pente optionnelle */
export function zoneVolumeM3(
  areaM2: number,
  depthM?: number,
  slopeDeg?: number
): number | null {
  const depth = depthM;
  if (!depth || depth <= 0) return null;
  const corrected = slopeCorrectedArea(areaM2, slopeDeg);
  return corrected * depth;
}

// ── Système d'unités ────────────────────────────────────────────────────────

export type DisplayUnit = "m" | "cm" | "mm" | "ft" | "in";

export const UNIT_LABELS: Record<DisplayUnit, string> = { m: "m", cm: "cm", mm: "mm", ft: "ft", in: "in" };
export const UNIT_LABELS_AREA: Record<DisplayUnit, string> = { m: "m²", cm: "cm²", mm: "mm²", ft: "ft²", in: "in²" };
export const UNIT_LABELS_VOLUME: Record<DisplayUnit, string> = { m: "m³", cm: "cm³", mm: "mm³", ft: "ft³", in: "in³" };

export const UNIT_FACTOR_LINEAR: Record<DisplayUnit, number> = { m: 1, cm: 100, mm: 1000, ft: 3.28084, in: 39.3701 };
export const UNIT_FACTOR_AREA: Record<DisplayUnit, number> = { m: 1, cm: 10000, mm: 1e6, ft: 10.7639, in: 1550.0031 };
export const UNIT_FACTOR_VOLUME: Record<DisplayUnit, number> = { m: 1, cm: 1e6, mm: 1e9, ft: 35.3147, in: 61023.7 };

/** Format linéaire avec unité */
export function fmtLinear(meters: number, unit: DisplayUnit = "m"): string {
  const v = meters * UNIT_FACTOR_LINEAR[unit];
  if (unit === "mm") return `${Math.round(v)} mm`;
  if (unit === "cm") return `${v.toFixed(1)} cm`;
  return `${v.toFixed(2)} ${UNIT_LABELS[unit]}`;
}

/** Format surface avec unité */
export function fmtArea(m2: number, unit: DisplayUnit = "m"): string {
  const v = m2 * UNIT_FACTOR_AREA[unit];
  if (unit === "mm") return `${Math.round(v)} mm²`;
  if (unit === "cm") return `${v.toFixed(1)} cm²`;
  return `${v.toFixed(2)} ${UNIT_LABELS_AREA[unit]}`;
}

/** Format volume avec unité */
export function fmtVolume(m3: number, unit: DisplayUnit = "m"): string {
  const v = m3 * UNIT_FACTOR_VOLUME[unit];
  if (unit === "mm") return `${Math.round(v)} mm³`;
  if (unit === "cm") return `${v.toFixed(1)} cm³`;
  return `${v.toFixed(2)} ${UNIT_LABELS_VOLUME[unit]}`;
}

// ── Text annotations ────────────────────────────────────────────────────────

export interface TextAnnotation {
  id: string;
  x: number; y: number;  // normalized 0-1
  text: string;
  color: string;          // hex
  fontSize?: number;      // default 12
}
