"use client";

import { useRef, useState, useEffect, useCallback, useLayoutEffect, useMemo, type ElementType } from "react";
import { motion } from "framer-motion";
import { Download, RotateCcw, Loader2, AlertTriangle, PenLine, Layers, Undo2, Redo2, FileDown, MousePointer2, Trash2, Eye, EyeOff, LayoutGrid, Scissors, Merge, Search, X, Save, Plus, ZoomIn, ZoomOut, Magnet, ChevronDown, Square, Eraser, DoorOpen, AppWindow, Maximize2, Sparkles, Check, Columns2, BrickWall, SeparatorVertical, Home, Hash, PenOff, PaintBucket, Wrench, Ruler, Minus, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalysisResult, Room, VisualSearchMatch, CustomDetection } from "@/lib/types";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";
import MeasureCanvas from "@/components/measure/measure-canvas";
import SurfacePanel from "@/components/measure/surface-panel";
import { SurfaceType, MeasureZone, DEFAULT_SURFACE_TYPES, ROOM_SURFACE_TYPES, EMPRISE_TYPE, aggregateByType, aggregatePerimeterByType, polygonPerimeterM, pointInPolygon as pointInPolygonObj, polygonAreaNorm } from "@/lib/measure-types";
import type { WallSegment } from "@/lib/types";
import { snapIntelligent, SnapResult, SnapConfig, DEFAULT_SNAP_CONFIG } from "@/lib/snap-engine";

import { BACKEND } from "@/lib/backend";
import { getRoomColor } from "@/lib/room-colors";
type Layer = "door" | "window" | "french_door" | "interior" | "rooms" | "wall" | "cloison" | "surface" | "utilities" | null;
type EditorTool = "add_rect" | "erase_rect" | "add_poly" | "erase_poly" | "sam" | "select" | "split" | "visual_search" | "deduct_rect" | "linear" | "angle" | "count" | "rescale";
// ── Constantes pièces ──────────────────────────────────────────────────────────
const ROOM_TYPES: { type: string; i18nKey: DTKey }[] = [
  { type: "bedroom",      i18nKey: "rt_bedroom" },
  { type: "living room",  i18nKey: "rt_living" },
  { type: "kitchen",      i18nKey: "rt_kitchen" },
  { type: "bathroom",     i18nKey: "rt_bathroom" },
  { type: "hallway",      i18nKey: "rt_hallway" },
  { type: "office",       i18nKey: "rt_office" },
  { type: "wc",           i18nKey: "rt_wc" },
  { type: "dining room",  i18nKey: "rt_dining" },
  { type: "storage",      i18nKey: "rt_storage" },
  { type: "garage",       i18nKey: "rt_garage" },
  { type: "balcony",      i18nKey: "rt_balcony" },
  { type: "laundry",      i18nKey: "rt_laundry" },
];

// ROOM_COLORS & getRoomColor imported from @/lib/room-colors

/** Ray-casting point-in-polygon test (normalized coords) — thin wrapper around shared impl */
function pointInPolygon(x: number, y: number, polygon: { x: number; y: number }[]): boolean {
  return pointInPolygonObj({ x, y }, polygon);
}

/* polygonAreaNorm is now imported from @/lib/measure-types */

/** Snap a normalized point to the nearest wall segment if within threshold (screen px) */
