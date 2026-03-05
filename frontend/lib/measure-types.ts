export interface SurfaceType {
  id: string;
  name: string;
  color: string; // hex
}

export interface MeasureZone {
  id: string;
  typeId: string;
  points: { x: number; y: number }[]; // normalized 0-1 relative to image
}

export const DEFAULT_SURFACE_TYPES: SurfaceType[] = [
  { id: "carrelage", name: "Carrelage",  color: "#3B82F6" },
  { id: "parquet",   name: "Parquet",    color: "#F97316" },
  { id: "peinture",  name: "Peinture",   color: "#8B5CF6" },
  { id: "beton",     name: "Béton",      color: "#6B7280" },
  { id: "moquette",  name: "Moquette",   color: "#EC4899" },
];

/** Shoelace formula — points in normalized coords (0-1), imageW/H in px */
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

/** Aggregate zones by type — returns map typeId → total m² (or px² if no ppm) */
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
    result[zone.typeId] = (result[zone.typeId] ?? 0) + area;
  }
  return result;
}
