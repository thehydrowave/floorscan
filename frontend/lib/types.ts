export type DetectionType = "door" | "window" | "wall" | "surface";

export interface BBox { x: number; y: number; width: number; height: number; }
export interface Detection { id: string; type: DetectionType; bbox: BBox; confidence: number; area?: number; label?: string; }
export interface RoboflowConfig { apiKey: string; modelName: string; }
export interface CropRect { x: number; y: number; width: number; height: number; }

export interface WallSegment { x1_norm: number; y1_norm: number; x2_norm: number; y2_norm: number; length_m: number | null; }

export interface Room {
  id: number;
  type: string;
  label_fr: string;
  centroid_norm: { x: number; y: number };
  bbox_norm: { x: number; y: number; w: number; h: number };
  area_m2: number | null;
  area_px2: number;
  polygon_norm?: { x: number; y: number }[];
  perimeter_m?: number;
  /** Type de revêtement de sol lié (ex: "carrelage", "parquet") — ID d'un SurfaceType */
  surfaceTypeId?: string;
  /** ID de la MeasureZone auto-générée depuis le polygone de la pièce */
  linkedZoneId?: string;
}

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
  img_w?: number;
  img_h?: number;
  doors_count: number;
  windows_count: number;
  french_doors_count?: number;
  pixels_per_meter: number | null;
  scale_info?: ScaleInfo;
  openings: Opening[];
  surfaces: Surfaces;
  overlay_openings_b64: string;
  overlay_interior_b64: string | null;
  mask_doors_b64: string;
  mask_windows_b64: string;
  mask_french_doors_b64?: string | null;
  mask_walls_b64: string;
  mask_walls_ai_b64?: string | null;
  mask_walls_pixel_b64?: string | null;
  mask_cloisons_b64?: string | null;
  mask_rooms_b64?: string;
  mask_footprint_b64?: string | null;
  plan_b64?: string;
  stats?: { pass1: any; pass2: any };
  rooms?: Room[];
  walls?: WallSegment[];
  edit_history_len?: number;
  edit_future_len?: number;
}

export interface Opening {
  class: "door" | "window" | "french_door";
  x_px: number; y_px: number; width_px: number; height_px: number;
  length_px: number; area_px2: number;
  length_m?: number; width_m?: number; height_m?: number;
}

export interface Surfaces {
  area_building_m2?: number; area_walls_m2?: number; area_hab_m2?: number;
  perim_building_m?: number; perim_interior_m?: number;
  area_building_px2?: number; area_interior_px2?: number;
}

export interface ExportSummary { doors: number; windows: number; walls: number; surfaces: number; totalArea: number; }

export interface VisualSearchMatch { x_norm: number; y_norm: number; w_norm: number; h_norm: number; score: number; }

export interface CustomDetection {
  id: string; label: string; color: string;
  matches: VisualSearchMatch[]; count: number;
  total_area_m2: number | null; total_area_px2: number;
}

export type FacadeElementType = "window" | "door" | "balcony" | "floor_line" | "roof" | "column" | "other" | "wall_opaque";

export interface FacadeElement {
  id: number; type: FacadeElementType; label_fr: string;
  bbox_norm: { x: number; y: number; w: number; h: number };
  polygon_norm?: { x: number; y: number }[];
  area_m2: number | null;
  perimeter_m?: number | null;
  /** Dimensions réelles en mètres (disponibles si ppm connu) */
  w_m?: number | null;
  h_m?: number | null;
  floor_level?: number; confidence?: number;
  raw_class?: string;
}

export interface FacadeAnalysisResult {
  session_id: string;
  windows_count: number; doors_count: number; balconies_count: number; floors_count: number;
  elements: FacadeElement[];
  facade_area_m2: number | null;
  openings_area_m2: number | null;
  /** Surface murale opaque = facade_area_m2 - openings_area_m2 */
  surface_mur_net?: number | null;
  ratio_openings: number | null;
  pixels_per_meter: number | null;
  /** ROI used for inference, normalized 0-1. Full image when absent. */
  building_roi?: { x: number; y: number; w: number; h: number };
  overlay_b64: string; plan_b64: string;
  // Masques éditables par type (générés depuis les bounding boxes)
  mask_window_b64?: string;
  mask_door_b64?: string;
  mask_balcony_b64?: string;
  mask_roof_b64?: string;
  mask_column_b64?: string;
  mask_wall_opaque_b64?: string;
  overlay_openings_b64?: string;
  is_mock?: boolean;
  /** Custom element types created in the editor (persisted across editor↔results) */
  custom_types?: Array<{ id: string; name: string; color: string; replacesWall: boolean }>;
}

export interface DiffResult {
  session_id_v1: string; session_id_v2: string;
  aligned_v1_b64: string; aligned_v2_b64: string; diff_overlay_b64: string;
  diff_stats: { changed_pixels_pct: number; added_area_pct: number; removed_area_pct: number; };
}

export interface CartoucheField { key: string; label_fr: string; value: string; confidence: number; }

export interface CartoucheResult {
  session_id: string;
  cartouche_bbox_norm: { x: number; y: number; w: number; h: number } | null;
  cartouche_b64: string | null; fields: CartoucheField[]; raw_text: string; plan_b64: string;
}

export interface MaterialEstimateParams { ceiling_height_m: number; waste_pct: number; paint_coverage_m2_per_l: number; paint_pot_size_l: number; }
export interface MaterialLine { material: string; quantity: number; unit: string; detail?: string; }

export type DpgfUnit = "m2" | "ml" | "U" | "forfait" | "ens";
export interface DpgfLineItem { id: string; description_key: string; quantity: number; unit: DpgfUnit; unit_price: number; total_ht: number; }
export interface DpgfLot { lot_number: number; title_key: string; icon: string; color: string; items: DpgfLineItem[]; subtotal_ht: number; }
export interface DpgfState { lots: DpgfLot[]; total_ht: number; tva_rate: number; tva_amount: number; total_ttc: number; project_name: string; project_address: string; date: string; }

export interface DevisCompanyInfo { name: string; address: string; siret: string; rcs: string; phone: string; email: string; rge: string; assurance: string; }
export interface DevisClientInfo { name: string; address: string; phone: string; email: string; }
export interface DevisOptions { quote_number: string; validity_days: number; payment_terms: string; execution_delay: string; company: DevisCompanyInfo; client: DevisClientInfo; notes: string; date: string; }

export interface ConsensusDetectionDetail { centroid_norm: { x: number; y: number }; agreement_count: number; agreement_models: string[]; area_px: number; confirmed: boolean; }

export interface PipelineResult {
  id: string; name: string; description: string; color: string;
  doors_count: number; windows_count: number;
  mask_doors_b64: string | null; mask_windows_b64: string | null; mask_walls_b64: string | null;
  mask_footprint_b64: string | null; mask_hab_b64: string | null;
  footprint_area_m2: number | null; walls_area_m2: number | null; hab_area_m2: number | null;
  rooms_count: number; rooms: Room[]; mask_rooms_b64: string | null;
  timing_seconds: number; error: string | null;
  is_consensus?: boolean; agreement_heatmap_b64?: string | null;
  door_details?: ConsensusDetectionDetail[]; window_details?: ConsensusDetectionDetail[];
  uncertain_doors_count?: number; uncertain_windows_count?: number; models_fused_walls?: number;
  is_bestof?: boolean; source_models?: { walls: string; doors: string; windows: string };
  french_doors_count?: number; mask_french_doors_b64?: string | null;
}

export interface ComparisonTableRow { id: string; name: string; color: string; doors: number; windows: number; french_doors: number; footprint_m2: number | null; walls_m2: number | null; hab_m2: number | null; rooms: number; time_s: number; error: string | null; }
export interface ComparisonResult { pipelines: Record<string, PipelineResult>; comparison_table: ComparisonTableRow[]; total_time_seconds: number; }
