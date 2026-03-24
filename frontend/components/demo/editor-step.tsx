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
