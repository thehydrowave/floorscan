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
// Scale calibration info (from backend cross-check)
export interface ScaleInfo {
  ppm: number | null;
  confidence: number;
  method: string;
  sources: { ppm: number; confidence: number; source: string; detail: string }[];
  agreement: boolean;
  agreements?: { a: string; b: string; ratio: number; agree: boolean }[];
}

export interface AnalysisResult {
  session_id: string;
  doors_count: number;
  windows_count: number;
  pixels_per_meter: number | null;
  scale_info?: ScaleInfo;
  openings: Opening[];
  surfaces: Surfaces;
  overlay_openings_b64: string;
  overlay_interior_b64: string | null;
  mask_doors_b64: string;
  mask_windows_b64: string;
  mask_walls_b64: string;
  mask_walls_ai_b64?: string | null;       // Direct Roboflow wall predictions
  mask_walls_pixel_b64?: string | null;    // OTSU pixel-based wall detection
  mask_cloisons_b64?: string | null;        // Cloisons intérieures (IA − Pixel − périmètre)
  mask_rooms_b64?: string;
  plan_b64?: string;   // raw plan without annotations
  stats?: { pass1: any; pass2: any };
  // Nouvelles données structurées
  rooms?: Room[];
  walls?: WallSegment[];
  // Mask edit undo/redo lengths
  edit_history_len?: number;
  edit_future_len?: number;
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

// ── Facade analysis types ────────────────────────────────────────────────────

export type FacadeElementType = "window" | "door" | "balcony" | "floor_line" | "roof" | "column" | "other";

// Élément détecté sur une façade
export interface FacadeElement {
  id: number;
  type: FacadeElementType;
  label_fr: string;
  bbox_norm: { x: number; y: number; w: number; h: number };
  polygon_norm?: { x: number; y: number }[];
  area_m2: number | null;
  floor_level?: number;       // étage (0 = RDC, 1, 2, ...)
  confidence?: number;
}

// Résultat d'analyse de façade
export interface FacadeAnalysisResult {
  session_id: string;
  // Comptages
  windows_count: number;
  doors_count: number;
  balconies_count: number;
  floors_count: number;
  // Éléments détectés
  elements: FacadeElement[];
  // Surfaces
  facade_area_m2: number | null;
  openings_area_m2: number | null;  // surface totale ouvertures
  ratio_openings: number | null;    // % ouvertures / façade
  pixels_per_meter: number | null;
  // Images
  overlay_b64: string;              // façade annotée
  plan_b64: string;                 // image brute
  mask_windows_b64?: string;
  mask_doors_b64?: string;
  mask_balconies_b64?: string;
  // WIP: mock data flag
  is_mock?: boolean;
}

// ── Plan Diff types ──────────────────────────────────────────────────────────

export interface DiffResult {
  session_id_v1: string;
  session_id_v2: string;
  aligned_v1_b64: string;
  aligned_v2_b64: string;
  diff_overlay_b64: string;     // rouge=supprimé, vert=ajouté
  diff_stats: {
    changed_pixels_pct: number;
    added_area_pct: number;
    removed_area_pct: number;
  };
}

// ── Cartouche / Legend extraction types ───────────────────────────────────────

export interface CartoucheField {
  key: string;           // "project_name" | "architect" | "scale" | "date" | "plan_number" | "revision"
  label_fr: string;
  value: string;
  confidence: number;
}

export interface CartoucheResult {
  session_id: string;
  cartouche_bbox_norm: { x: number; y: number; w: number; h: number } | null;
  cartouche_b64: string | null;
  fields: CartoucheField[];
  raw_text: string;
  plan_b64: string;
}

// ── Materials estimation types ───────────────────────────────────────────────

export interface MaterialEstimateParams {
  ceiling_height_m: number;
  waste_pct: number;
  paint_coverage_m2_per_l: number;
  paint_pot_size_l: number;
}

export interface MaterialLine {
  material: string;
  quantity: number;
  unit: string;
  detail?: string;
}

// ── DPGF (Décomposition du Prix Global Forfaitaire) ─────────────────────────

export type DpgfUnit = "m2" | "ml" | "U" | "forfait" | "ens";

export interface DpgfLineItem {
  id: string;
  description_key: string;
  quantity: number;
  unit: DpgfUnit;
  unit_price: number;
  total_ht: number;
}

export interface DpgfLot {
  lot_number: number;
  title_key: string;
  icon: string;
  color: string;
  items: DpgfLineItem[];
  subtotal_ht: number;
}

export interface DpgfState {
  lots: DpgfLot[];
  total_ht: number;
  tva_rate: number;
  tva_amount: number;
  total_ttc: number;
  project_name: string;
  project_address: string;
  date: string;
}

// ── Devis (Formal Quote) ────────────────────────────────────────────────────

export interface DevisCompanyInfo {
  name: string;
  address: string;
  siret: string;
  rcs: string;
  phone: string;
  email: string;
  rge: string;
  assurance: string;
}

export interface DevisClientInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
}

export interface DevisOptions {
  quote_number: string;
  validity_days: number;
  payment_terms: string;
  execution_delay: string;
  company: DevisCompanyInfo;
  client: DevisClientInfo;
  notes: string;
  date: string;
}

// ── Multi-model comparison (admin only) ──────────────────────────────────────

export interface PipelineResult {
  id: string;
  name: string;
  description: string;
  color: string;
  doors_count: number;
  windows_count: number;
  mask_doors_b64: string | null;
  mask_windows_b64: string | null;
  mask_walls_b64: string | null;
  footprint_area_m2: number | null;
  rooms_count: number;
  rooms: Room[];
  mask_rooms_b64: string | null;
  timing_seconds: number;
  error: string | null;
}

export interface ComparisonTableRow {
  id: string;
  name: string;
  color: string;
  doors: number;
  windows: number;
  footprint_m2: number | null;
  rooms: number;
  time_s: number;
  error: string | null;
}

export interface ComparisonResult {
  pipelines: Record<string, PipelineResult>;
  comparison_table: ComparisonTableRow[];
  total_time_seconds: number;
}
