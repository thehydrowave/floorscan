export type DetectionType = "door" | "window" | "wall" | "surface";

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Detection {
  id: string;
  type: DetectionType;
  bbox: BBox;
  confidence: number;
  area?: number;
  label?: string;
}

export interface RoboflowConfig {
  apiKey: string;
  modelName: string; // model_id complet ex: "cubicasa-xmyt3-d4s04/3"
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Segment de mur vectorisé
export interface WallSegment {
  x1_norm: number;
  y1_norm: number;
  x2_norm: number;
  y2_norm: number;
  length_m: number | null;
}

// Pièce détectée avec type et surface
export interface Room {
  id: number;
  type: string;           // clé anglaise ("bedroom", "kitchen"…)
  label_fr: string;       // libellé français ("Chambre", "Cuisine"…)
  centroid_norm: { x: number; y: number };
  bbox_norm: { x: number; y: number; w: number; h: number };
  area_m2: number | null;
  area_px2: number;
  polygon_norm?: { x: number; y: number }[];
  perimeter_m?: number;
}

// Résultat complet de l'analyse V1
export interface AnalysisResult {
  session_id: string;
  doors_count: number;
  windows_count: number;
  pixels_per_meter: number | null;
  openings: Opening[];
  surfaces: Surfaces;
  overlay_openings_b64: string;
  overlay_interior_b64: string | null;
  mask_doors_b64: string;
  mask_windows_b64: string;
  mask_walls_b64: string;
  mask_rooms_b64?: string;
  stats?: { pass1: any; pass2: any };
  // Nouvelles données structurées
  rooms?: Room[];
  walls?: WallSegment[];
}

export interface Opening {
  class: "door" | "window";
  x_px: number;
  y_px: number;
  width_px: number;
  height_px: number;
  length_px: number;
  area_px2: number;
  length_m?: number;
  width_m?: number;
  height_m?: number;
}

export interface Surfaces {
  area_building_m2?: number;
  area_walls_m2?: number;
  area_hab_m2?: number;
  perim_building_m?: number;
  perim_interior_m?: number;
  area_building_px2?: number;
  area_interior_px2?: number;
}

export interface ExportSummary {
  doors: number;
  windows: number;
  walls: number;
  surfaces: number;
  totalArea: number;
}

// Visual search match result
export interface VisualSearchMatch {
  x_norm: number;
  y_norm: number;
  w_norm: number;
  h_norm: number;
  score: number;
}

// Custom detection group saved from visual search
export interface CustomDetection {
  id: string;
  label: string;
  color: string;
  matches: VisualSearchMatch[];
  count: number;
  total_area_m2: number | null;   // null if no scale calibration
  total_area_px2: number;
}
