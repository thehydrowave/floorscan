export interface SurfaceType {
  id: string;
  name: string;
  color: string; // hex
  pricePerM2?: number;   // €/m²
  wastePercent?: number; // % chute (ex: 10 = 10%)
  boxSizeM2?: number;    // m² par boîte/rouleau (0 = non défini)
}

export interface MeasureZone {
  id: string;
  typeId: string;
  name?: string;                       // nom personnalisé optionnel
  note?: string;                       // remarque libre (ex: "attention dénivelé")
  points: { x: number; y: number }[]; // normalized 0-1 relative to image
  isDeduction?: boolean;               // si true, zone soustraite du total
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
  { id: "carrelage", name: "Carrelage",  color: "#3B82F6", wastePercent: 10 },
  { id: "parquet",   name: "Parquet",    color: "#F97316", wastePercent: 10 },
  { id: "peinture",  name: "Peinture",   color: "#8B5CF6", wastePercent: 15 },
  { id: "beton",     name: "Béton",      color: "#6B7280", wastePercent: 10 },
  { id: "moquette",  name: "Moquette",   color: "#EC4899", wastePercent: 10 },
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

/** Périmètre en mètres */
export function polygonPerimeterM(
  points: { x: number; y: number }[],
  imageW: number,
  imageH: number,
  ppm: number
): number {
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
