"use client";

import { useRef, useState, useMemo, useEffect } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Text, ContactShadows, Environment, PerspectiveCamera } from "@react-three/drei";
import type { Room, Opening } from "@/lib/types";
import { getRoomColor } from "@/lib/room-colors";

// ── Constants ─────────────────────────────────────────────────────────────────

const WALL_THICKNESS = 0.15;
const WALL_COLOR = "#d1d5db";
const DOOR_COLOR = "#92400e";
const DOOR_FRAME_COLOR = "#78350f";
const WINDOW_COLOR = "#7dd3fc";
const WINDOW_FRAME_COLOR = "#e5e7eb";
const FLOOR_OPACITY = 0.55;
const FLOOR_HOVER_OPACITY = 0.85;
const SLAB_DEPTH = 0.04;
const CONCRETE_SLAB_THICKNESS = 0.20; // dalle béton entre étages (20 cm)
const FRAME_THICK = 0.04;
const DOOR_PANEL_THICK = 0.04;
const DOOR_OPEN_ANGLE = Math.PI / 6; // 30°
const FRENCH_DOOR_COLOR = "#F97316";         // orange
const FRENCH_DOOR_FRAME_COLOR = "#e5e7eb";   // light gray (like window)

// ROOM_COLORS & getRoomColor imported from @/lib/room-colors

// ── Coordinate helpers ────────────────────────────────────────────────────────

interface SceneBounds {
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  maxDim: number;
}

function computeSceneBounds(
  rooms: Room[],
  imgW: number,
  imgH: number,
  ppm: number
): SceneBounds {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

  for (const room of rooms) {
    const pts = room.polygon_norm ?? [
      { x: room.bbox_norm.x, y: room.bbox_norm.y },
      { x: room.bbox_norm.x + room.bbox_norm.w, y: room.bbox_norm.y },
      { x: room.bbox_norm.x + room.bbox_norm.w, y: room.bbox_norm.y + room.bbox_norm.h },
      { x: room.bbox_norm.x, y: room.bbox_norm.y + room.bbox_norm.h },
    ];
    for (const p of pts) {
      const xm = (p.x * imgW) / ppm;
      const zm = (p.y * imgH) / ppm;
      if (xm < minX) minX = xm;
      if (xm > maxX) maxX = xm;
      if (zm < minZ) minZ = zm;
      if (zm > maxZ) maxZ = zm;
    }
  }

  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  return { centerX, centerZ, width, depth, maxDim: Math.max(width, depth) };
}

// ── Wall deduplication ────────────────────────────────────────────────────────

function wallKey(ax: number, az: number, bx: number, bz: number): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  const a = `${r(ax)},${r(az)}`;
  const b = `${r(bx)},${r(bz)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

interface WallEdge {
  x1: number; z1: number;
  x2: number; z2: number;
  length: number;
  angle: number;
  cx: number; cz: number;
}

function extractWalls(
  rooms: Room[],
  imgW: number,
  imgH: number,
  ppm: number,
  bounds: SceneBounds
): WallEdge[] {
  const seen = new Set<string>();
  const walls: WallEdge[] = [];

  for (const room of rooms) {
    const pts = room.polygon_norm ?? [
      { x: room.bbox_norm.x, y: room.bbox_norm.y },
      { x: room.bbox_norm.x + room.bbox_norm.w, y: room.bbox_norm.y },
      { x: room.bbox_norm.x + room.bbox_norm.w, y: room.bbox_norm.y + room.bbox_norm.h },
      { x: room.bbox_norm.x, y: room.bbox_norm.y + room.bbox_norm.h },
    ];

    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const x1 = (pts[i].x * imgW) / ppm - bounds.centerX;
      const z1 = (pts[i].y * imgH) / ppm - bounds.centerZ;
      const x2 = (pts[j].x * imgW) / ppm - bounds.centerX;
      const z2 = (pts[j].y * imgH) / ppm - bounds.centerZ;

      const key = wallKey(x1, z1, x2, z2);
      if (seen.has(key)) continue;
      seen.add(key);

      const dx = x2 - x1;
      const dz = z2 - z1;
      const length = Math.sqrt(dx * dx + dz * dz);
      if (length < 0.05) continue;

      walls.push({
        x1, z1, x2, z2,
        length,
        angle: Math.atan2(dz, dx),
        cx: (x1 + x2) / 2,
        cz: (z1 + z2) / 2,
      });
    }
  }

  return walls;
}

// ── Opening-to-wall mapping ──────────────────────────────────────────────────

interface WallOpeningInfo {
  opening: Opening;
  t: number;           // position along wall (0-1)
  widthM: number;      // opening width in meters
  heightM: number;     // opening height in meters
  sillM: number;       // sill height from floor
  isDoor: boolean;
  isFrenchDoor: boolean;
}

function mapOpeningsToWalls(
  openings: Opening[],
  walls: WallEdge[],
  ppm: number,
  bounds: SceneBounds,
): Map<number, WallOpeningInfo[]> {
  const result = new Map<number, WallOpeningInfo[]>();

  for (const opening of openings) {
    const ox = (opening.x_px / ppm) - bounds.centerX;
    const oz = (opening.y_px / ppm) - bounds.centerZ;

    let bestWallIdx = -1;
    let bestDist = 2.0;
    let bestT = 0;

    for (let wi = 0; wi < walls.length; wi++) {
      const w = walls[wi];
      const dx = w.x2 - w.x1;
      const dz = w.z2 - w.z1;
      const lenSq = dx * dx + dz * dz;
      if (lenSq < 0.001) continue;

      let t = ((ox - w.x1) * dx + (oz - w.z1) * dz) / lenSq;
      t = Math.max(0, Math.min(1, t));

      const px = w.x1 + t * dx;
      const pz = w.z1 + t * dz;
      const dist = Math.sqrt((ox - px) ** 2 + (oz - pz) ** 2);

      if (dist < bestDist) {
        bestDist = dist;
        bestWallIdx = wi;
        bestT = t;
      }
    }

    if (bestWallIdx === -1) continue;

    const isDoor = opening.class === "door" || opening.class === "french_door";
    const isFrenchDoor = opening.class === "french_door";
    const widthM = opening.length_m
      ?? (Math.max(opening.width_px, opening.height_px) / ppm);
    // French doors: full height (2.1m) like regular doors, start at floor
    const heightM = opening.height_m ?? (isDoor ? 2.1 : 1.2);
    const sillM = isDoor ? 0 : 0.9;

    // Cap opening width to 90% of wall length
    const cappedWidth = Math.min(widthM, walls[bestWallIdx].length * 0.9);

    if (!result.has(bestWallIdx)) result.set(bestWallIdx, []);
    result.get(bestWallIdx)!.push({
      opening,
      t: bestT,
      widthM: cappedWidth,
      heightM,
      sillM,
      isDoor,
      isFrenchDoor,
    });
  }

  return result;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RoomFloor({
  room, imgW, imgH, ppm, bounds, wireframe, hovered, onHover,
}: {
  room: Room; imgW: number; imgH: number; ppm: number;
  bounds: SceneBounds; wireframe: boolean; hovered: boolean;
  onHover: (id: number | null) => void;
}) {
  const color = getRoomColor(room.type);
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const pts = room.polygon_norm ?? [
      { x: room.bbox_norm.x, y: room.bbox_norm.y },
      { x: room.bbox_norm.x + room.bbox_norm.w, y: room.bbox_norm.y },
      { x: room.bbox_norm.x + room.bbox_norm.w, y: room.bbox_norm.y + room.bbox_norm.h },
      { x: room.bbox_norm.x, y: room.bbox_norm.y + room.bbox_norm.h },
    ];

    const shape = new THREE.Shape();
    const first = pts[0];
    shape.moveTo((first.x * imgW) / ppm - bounds.centerX, (first.y * imgH) / ppm - bounds.centerZ);

    for (let i = 1; i < pts.length; i++) {
      shape.lineTo((pts[i].x * imgW) / ppm - bounds.centerX, (pts[i].y * imgH) / ppm - bounds.centerZ);
    }
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: SLAB_DEPTH, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [room, imgW, imgH, ppm, bounds]);

  return (
    <mesh
      ref={meshRef} geometry={geometry} receiveShadow
      onPointerEnter={(e: any) => { e.stopPropagation(); onHover(room.id); }}
      onPointerLeave={() => onHover(null)}
    >
      <meshStandardMaterial
        color={color} transparent opacity={hovered ? FLOOR_HOVER_OPACITY : FLOOR_OPACITY}
        emissive={color} emissiveIntensity={hovered ? 0.35 : 0.05}
        wireframe={wireframe} side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ── Wall with holes cut for openings ─────────────────────────────────────────

function WallWithOpenings({
  wall, wallOpenings, height, wireframe,
}: {
  wall: WallEdge;
  wallOpenings: WallOpeningInfo[];
  height: number;
  wireframe: boolean;
}) {
  const geometry = useMemo(() => {
    // Wall face in local 2D: x along wall, y upward
    const shape = new THREE.Shape();
    shape.moveTo(-wall.length / 2, 0);
    shape.lineTo(wall.length / 2, 0);
    shape.lineTo(wall.length / 2, height);
    shape.lineTo(-wall.length / 2, height);
    shape.closePath();

    // Cut holes for each opening
    for (const op of wallOpenings) {
      const centerX = (op.t - 0.5) * wall.length;
      const halfW = op.widthM / 2;

      // Clamp to wall bounds with small margins
      const left = Math.max(-wall.length / 2 + 0.02, centerX - halfW);
      const right = Math.min(wall.length / 2 - 0.02, centerX + halfW);
      const bottom = Math.max(0, op.sillM);
      const top = Math.min(height - 0.01, op.sillM + op.heightM);

      if (right <= left || top <= bottom) continue;

      const hole = new THREE.Path();
      hole.moveTo(left, bottom);
      hole.lineTo(right, bottom);
      hole.lineTo(right, top);
      hole.lineTo(left, top);
      hole.closePath();
      shape.holes.push(hole);
    }

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: WALL_THICKNESS,
      bevelEnabled: false,
    });
    // Center on depth axis
    geo.translate(0, 0, -WALL_THICKNESS / 2);
    return geo;
  }, [wall, wallOpenings, height]);

  return (
    <mesh
      position={[wall.cx, 0, wall.cz]}
      rotation={[0, -wall.angle, 0]}
      geometry={geometry}
      castShadow receiveShadow
    >
      <meshStandardMaterial
        color={WALL_COLOR} roughness={0.85} metalness={0.02} wireframe={wireframe}
      />
    </mesh>
  );
}

// ── 3D Door ──────────────────────────────────────────────────────────────────

function DoorMesh3D({
  wall, info, wireframe,
}: {
  wall: WallEdge;
  info: WallOpeningInfo;
  wireframe: boolean;
}) {
  const centerX = (info.t - 0.5) * wall.length;
  const halfW = info.widthM / 2;
  const h = info.heightM;
  const w = info.widthM;

  // Arc geometry for door swing (created imperatively)
  const arcGeo = useMemo(
    () => new THREE.CircleGeometry(w, 16, 0, DOOR_OPEN_ANGLE + 0.05),
    [w]
  );

  return (
    <group position={[wall.cx, 0, wall.cz]} rotation={[0, -wall.angle, 0]}>
      {/* Frame — top */}
      <mesh position={[centerX, h, 0]}>
        <boxGeometry args={[w + FRAME_THICK * 2, FRAME_THICK, WALL_THICKNESS + 0.02]} />
        <meshStandardMaterial color={DOOR_FRAME_COLOR} roughness={0.7} wireframe={wireframe} />
      </mesh>
      {/* Frame — left */}
      <mesh position={[centerX - halfW - FRAME_THICK / 2, h / 2, 0]}>
        <boxGeometry args={[FRAME_THICK, h, WALL_THICKNESS + 0.02]} />
        <meshStandardMaterial color={DOOR_FRAME_COLOR} roughness={0.7} wireframe={wireframe} />
      </mesh>
      {/* Frame — right */}
      <mesh position={[centerX + halfW + FRAME_THICK / 2, h / 2, 0]}>
        <boxGeometry args={[FRAME_THICK, h, WALL_THICKNESS + 0.02]} />
        <meshStandardMaterial color={DOOR_FRAME_COLOR} roughness={0.7} wireframe={wireframe} />
      </mesh>

      {/* Door panel — hinged on left, partially open */}
      <group position={[centerX - halfW, 0, WALL_THICKNESS / 2]}>
        <group rotation={[0, DOOR_OPEN_ANGLE, 0]}>
          <mesh position={[w / 2, h / 2, DOOR_PANEL_THICK / 2]}>
            <boxGeometry args={[w - 0.02, h - 0.02, DOOR_PANEL_THICK]} />
            <meshStandardMaterial
              color={DOOR_COLOR} roughness={0.6} wireframe={wireframe}
            />
          </mesh>
          {/* Handle */}
          <mesh position={[w * 0.85, h * 0.45, DOOR_PANEL_THICK + 0.02]}>
            <cylinderGeometry args={[0.015, 0.015, 0.1, 8]} />
            <meshStandardMaterial color="#d4af37" metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[w * 0.85, h * 0.45, DOOR_PANEL_THICK + 0.07]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.015, 0.015, 0.06, 8]} />
            <meshStandardMaterial color="#d4af37" metalness={0.8} roughness={0.2} />
          </mesh>
        </group>
      </group>

      {/* Swing arc on floor */}
      <mesh
        position={[centerX - halfW, 0.005, WALL_THICKNESS / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        geometry={arcGeo}
      >
        <meshBasicMaterial color={DOOR_COLOR} transparent opacity={0.2} side={THREE.DoubleSide} />
      </mesh>

      {/* Threshold */}
      <mesh position={[centerX, 0.01, 0]}>
        <boxGeometry args={[w, 0.02, WALL_THICKNESS + 0.04]} />
        <meshStandardMaterial color="#78716c" roughness={0.8} wireframe={wireframe} />
      </mesh>
    </group>
  );
}

// ── 3D Window ────────────────────────────────────────────────────────────────

function WindowMesh3D({
  wall, info, wireframe,
}: {
  wall: WallEdge;
  info: WallOpeningInfo;
  wireframe: boolean;
}) {
  const centerX = (info.t - 0.5) * wall.length;
  const halfW = info.widthM / 2;
  const h = info.heightM;
  const w = info.widthM;
  const sill = info.sillM;

  return (
    <group position={[wall.cx, 0, wall.cz]} rotation={[0, -wall.angle, 0]}>
      {/* Frame — top */}
      <mesh position={[centerX, sill + h, 0]}>
        <boxGeometry args={[w + FRAME_THICK * 2, FRAME_THICK, WALL_THICKNESS + 0.02]} />
        <meshStandardMaterial color={WINDOW_FRAME_COLOR} roughness={0.5} wireframe={wireframe} />
      </mesh>
      {/* Frame — bottom (sill) */}
      <mesh position={[centerX, sill, 0]}>
        <boxGeometry args={[w + FRAME_THICK * 2, FRAME_THICK, WALL_THICKNESS + 0.04]} />
        <meshStandardMaterial color={WINDOW_FRAME_COLOR} roughness={0.5} wireframe={wireframe} />
      </mesh>
      {/* Frame — left */}
      <mesh position={[centerX - halfW - FRAME_THICK / 2, sill + h / 2, 0]}>
        <boxGeometry args={[FRAME_THICK, h, WALL_THICKNESS + 0.02]} />
        <meshStandardMaterial color={WINDOW_FRAME_COLOR} roughness={0.5} wireframe={wireframe} />
      </mesh>
      {/* Frame — right */}
      <mesh position={[centerX + halfW + FRAME_THICK / 2, sill + h / 2, 0]}>
        <boxGeometry args={[FRAME_THICK, h, WALL_THICKNESS + 0.02]} />
        <meshStandardMaterial color={WINDOW_FRAME_COLOR} roughness={0.5} wireframe={wireframe} />
      </mesh>

      {/* Central divider — vertical */}
      <mesh position={[centerX, sill + h / 2, 0]}>
        <boxGeometry args={[FRAME_THICK * 0.6, h - FRAME_THICK, WALL_THICKNESS * 0.6]} />
        <meshStandardMaterial color={WINDOW_FRAME_COLOR} roughness={0.5} wireframe={wireframe} />
      </mesh>
      {/* Central divider — horizontal */}
      <mesh position={[centerX, sill + h / 2, 0]}>
        <boxGeometry args={[w - FRAME_THICK, FRAME_THICK * 0.6, WALL_THICKNESS * 0.6]} />
        <meshStandardMaterial color={WINDOW_FRAME_COLOR} roughness={0.5} wireframe={wireframe} />
      </mesh>

      {/* Glass pane */}
      <mesh position={[centerX, sill + h / 2, 0]}>
        <boxGeometry args={[w - FRAME_THICK, h - FRAME_THICK, 0.008]} />
        <meshStandardMaterial
          color={WINDOW_COLOR}
          transparent opacity={0.25}
          roughness={0.05} metalness={0.1}
          side={THREE.DoubleSide}
          emissive={WINDOW_COLOR}
          emissiveIntensity={0.15}
        />
      </mesh>

      {/* External sill ledge */}
      <mesh position={[centerX, sill - FRAME_THICK / 2, -WALL_THICKNESS / 2 - 0.03]}>
        <boxGeometry args={[w + 0.06, 0.025, 0.08]} />
        <meshStandardMaterial color="#9ca3af" roughness={0.6} wireframe={wireframe} />
      </mesh>
    </group>
  );
}

// ── 3D French Door (porte-fenêtre) ────────────────────────────────────────────

function FrenchDoorMesh3D({
  wall, info, wireframe,
}: {
  wall: WallEdge;
  info: WallOpeningInfo;
  wireframe: boolean;
}) {
  const centerX = (info.t - 0.5) * wall.length;
  const halfW = info.widthM / 2;
  const h = info.heightM;
  const w = info.widthM;
  const panelW = (w - 0.03) / 2; // each panel width (minus central bar)
  const glassInset = 0.04; // inset from panel edges for glass

  return (
    <group position={[wall.cx, 0, wall.cz]} rotation={[0, -wall.angle, 0]}>
      {/* Frame — top */}
      <mesh position={[centerX, h, 0]}>
        <boxGeometry args={[w + FRAME_THICK * 2, FRAME_THICK, WALL_THICKNESS + 0.02]} />
        <meshStandardMaterial color={FRENCH_DOOR_FRAME_COLOR} roughness={0.5} wireframe={wireframe} />
      </mesh>
      {/* Frame — left */}
      <mesh position={[centerX - halfW - FRAME_THICK / 2, h / 2, 0]}>
        <boxGeometry args={[FRAME_THICK, h, WALL_THICKNESS + 0.02]} />
        <meshStandardMaterial color={FRENCH_DOOR_FRAME_COLOR} roughness={0.5} wireframe={wireframe} />
      </mesh>
      {/* Frame — right */}
      <mesh position={[centerX + halfW + FRAME_THICK / 2, h / 2, 0]}>
        <boxGeometry args={[FRAME_THICK, h, WALL_THICKNESS + 0.02]} />
        <meshStandardMaterial color={FRENCH_DOOR_FRAME_COLOR} roughness={0.5} wireframe={wireframe} />
      </mesh>

      {/* Central separation bar (thick) */}
      <mesh position={[centerX, h / 2, 0]}>
        <boxGeometry args={[0.03, h, WALL_THICKNESS * 0.7]} />
        <meshStandardMaterial color={FRENCH_DOOR_FRAME_COLOR} roughness={0.5} wireframe={wireframe} />
      </mesh>

      {/* ── Left panel ── */}
      <group position={[centerX - panelW / 2 - 0.015, 0, 0]}>
        {/* Left glass pane */}
        <mesh position={[0, h / 2, 0]}>
          <boxGeometry args={[panelW - glassInset * 2, h - FRAME_THICK * 2 - glassInset, 0.008]} />
          <meshStandardMaterial
            color={WINDOW_COLOR} transparent opacity={0.35}
            roughness={0.05} metalness={0.1} side={THREE.DoubleSide}
            emissive={WINDOW_COLOR} emissiveIntensity={0.15}
          />
        </mesh>
        {/* Left panel — horizontal crossbar */}
        <mesh position={[0, h * 0.45, 0]}>
          <boxGeometry args={[panelW - glassInset, FRAME_THICK * 0.5, WALL_THICKNESS * 0.5]} />
          <meshStandardMaterial color={FRENCH_DOOR_FRAME_COLOR} roughness={0.5} wireframe={wireframe} />
        </mesh>
        {/* Left panel — vertical crossbar */}
        <mesh position={[0, h / 2, 0]}>
          <boxGeometry args={[FRAME_THICK * 0.5, h - FRAME_THICK * 2, WALL_THICKNESS * 0.5]} />
          <meshStandardMaterial color={FRENCH_DOOR_FRAME_COLOR} roughness={0.5} wireframe={wireframe} />
        </mesh>
        {/* Left handle */}
        <mesh position={[panelW * 0.35, h * 0.45, WALL_THICKNESS * 0.35 + 0.01]}>
          <cylinderGeometry args={[0.012, 0.012, 0.1, 8]} />
          <meshStandardMaterial color="#d4af37" metalness={0.8} roughness={0.2} />
        </mesh>
      </group>

      {/* ── Right panel ── */}
      <group position={[centerX + panelW / 2 + 0.015, 0, 0]}>
        {/* Right glass pane */}
        <mesh position={[0, h / 2, 0]}>
          <boxGeometry args={[panelW - glassInset * 2, h - FRAME_THICK * 2 - glassInset, 0.008]} />
          <meshStandardMaterial
            color={WINDOW_COLOR} transparent opacity={0.35}
            roughness={0.05} metalness={0.1} side={THREE.DoubleSide}
            emissive={WINDOW_COLOR} emissiveIntensity={0.15}
          />
        </mesh>
        {/* Right panel — horizontal crossbar */}
        <mesh position={[0, h * 0.45, 0]}>
          <boxGeometry args={[panelW - glassInset, FRAME_THICK * 0.5, WALL_THICKNESS * 0.5]} />
          <meshStandardMaterial color={FRENCH_DOOR_FRAME_COLOR} roughness={0.5} wireframe={wireframe} />
        </mesh>
        {/* Right panel — vertical crossbar */}
        <mesh position={[0, h / 2, 0]}>
          <boxGeometry args={[FRAME_THICK * 0.5, h - FRAME_THICK * 2, WALL_THICKNESS * 0.5]} />
          <meshStandardMaterial color={FRENCH_DOOR_FRAME_COLOR} roughness={0.5} wireframe={wireframe} />
        </mesh>
        {/* Right handle */}
        <mesh position={[-panelW * 0.35, h * 0.45, WALL_THICKNESS * 0.35 + 0.01]}>
          <cylinderGeometry args={[0.012, 0.012, 0.1, 8]} />
          <meshStandardMaterial color="#d4af37" metalness={0.8} roughness={0.2} />
        </mesh>
      </group>

      {/* Threshold / rail at floor */}
      <mesh position={[centerX, 0.01, 0]}>
        <boxGeometry args={[w, 0.02, WALL_THICKNESS + 0.04]} />
        <meshStandardMaterial color="#78716c" roughness={0.8} wireframe={wireframe} />
      </mesh>
    </group>
  );
}

// ── Room label ────────────────────────────────────────────────────────────────

function RoomLabel({
  room, imgW, imgH, ppm, bounds, ceilingHeight,
}: {
  room: Room; imgW: number; imgH: number; ppm: number;
  bounds: SceneBounds; ceilingHeight: number;
}) {
  const cx = (room.centroid_norm.x * imgW) / ppm - bounds.centerX;
  const cz = (room.centroid_norm.y * imgH) / ppm - bounds.centerZ;
  const label = room.label_fr || room.type;
  const areaStr = room.area_m2 != null ? `${room.area_m2.toFixed(1)} m²` : "";

  return (
    <group position={[cx, ceilingHeight + 0.4, cz]}>
      <Text
        fontSize={0.3} color="white" anchorX="center" anchorY="middle"
        outlineWidth={0.025} outlineColor="#000000" font={undefined}
      >
        {label}
      </Text>
      {areaStr && (
        <Text
          position={[0, -0.35, 0]}
          fontSize={0.22} color={getRoomColor(room.type)}
          anchorX="center" anchorY="middle"
          outlineWidth={0.02} outlineColor="#000000" font={undefined}
        >
          {areaStr}
        </Text>
      )}
    </group>
  );
}

// ── Entry animation ───────────────────────────────────────────────────────────

function AnimatedGroup({ children }: { children: React.ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);
  const [progress, setProgress] = useState(0);

  useFrame((_, delta) => {
    if (progress < 1) {
      const next = Math.min(1, progress + delta * 1.8);
      setProgress(next);
      if (groupRef.current) {
        const t = 1 - Math.pow(1 - next, 3);
        groupRef.current.position.y = (1 - t) * -0.5;
        groupRef.current.scale.setScalar(0.5 + t * 0.5);
        groupRef.current.children.forEach((c: THREE.Object3D) => {
          if ((c as THREE.Mesh).material) {
            const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
            if (mat.opacity !== undefined) mat.needsUpdate = true;
          }
        });
      }
    }
  });

  return <group ref={groupRef}>{children}</group>;
}

// ── Camera controller ─────────────────────────────────────────────────────────

// ── Dalle béton inter-étages ──────────────────────────────────────────────────

function FloorSlab({
  bounds, y, thickness, wireframe,
}: {
  bounds: SceneBounds; y: number; thickness: number; wireframe: boolean;
}) {
  return (
    <mesh position={[0, y + thickness / 2, 0]} receiveShadow castShadow>
      <boxGeometry args={[bounds.width + 0.6, thickness, bounds.depth + 0.6]} />
      <meshStandardMaterial color="#6b7280" wireframe={wireframe} roughness={0.85} metalness={0.1} />
    </mesh>
  );
}

function CameraRig({
  bounds, ceilingHeight, numFloors, resetSignal, autoRotate, onInteract,
}: {
  bounds: SceneBounds; ceilingHeight: number; numFloors: number; resetSignal: number;
  autoRotate: boolean; onInteract: () => void;
}) {
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();
  const totalH = numFloors * (ceilingHeight + CONCRETE_SLAB_THICKNESS);
  const camDist = Math.max(bounds.maxDim * 1.2 + 2, totalH * 1.4);
  const targetY = totalH * 0.5;

  useEffect(() => {
    if (controlsRef.current) {
      camera.position.set(camDist * 0.7, Math.max(camDist * 0.55, totalH * 0.7), camDist * 0.7);
      controlsRef.current.target.set(0, targetY, 0);
      controlsRef.current.update();
    }
  }, [resetSignal, camDist, totalH, targetY, camera]);

  return (
    <OrbitControls
      ref={controlsRef}
      autoRotate={autoRotate} autoRotateSpeed={1.2}
      enableDamping dampingFactor={0.06}
      target={[0, targetY, 0]}
      maxPolarAngle={Math.PI * 0.48}
      minDistance={2} maxDistance={camDist * 3}
      onStart={onInteract} makeDefault
    />
  );
}

// ── Main scene component ──────────────────────────────────────────────────────

interface FloorSceneProps {
  rooms: Room[];
  openings: Opening[];
  ppm: number;
  imgW: number;
  imgH: number;
  ceilingHeight: number;
  numFloors?: number;
  showRoof?: boolean;
  wireframe: boolean;
  resetSignal: number;
}

export default function FloorScene({
  rooms, openings, ppm, imgW, imgH, ceilingHeight, numFloors = 1, showRoof = true, wireframe, resetSignal,
}: FloorSceneProps) {
  const [hoveredRoom, setHoveredRoom] = useState<number | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);

  const bounds = useMemo(
    () => computeSceneBounds(rooms, imgW, imgH, ppm),
    [rooms, imgW, imgH, ppm]
  );

  const walls = useMemo(
    () => extractWalls(rooms, imgW, imgH, ppm, bounds),
    [rooms, imgW, imgH, ppm, bounds]
  );

  // Map openings to walls for hole-cutting & 3D rendering
  const wallOpeningsMap = useMemo(
    () => mapOpeningsToWalls(openings, walls, ppm, bounds),
    [openings, walls, ppm, bounds]
  );

  const camDist = bounds.maxDim * 1.2 + 2;

  return (
    <Canvas
      shadows
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ background: "transparent" }}
      onPointerMissed={() => setHoveredRoom(null)}
    >
      <PerspectiveCamera
        makeDefault
        position={[camDist * 0.7, camDist * 0.55, camDist * 0.7]}
        fov={50} near={0.1} far={200}
      />

      <CameraRig
        bounds={bounds} ceilingHeight={ceilingHeight} numFloors={numFloors}
        resetSignal={resetSignal} autoRotate={autoRotate}
        onInteract={() => setAutoRotate(false)}
      />

      {/* Lighting */}
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[bounds.maxDim, bounds.maxDim * 1.8, bounds.maxDim * 0.8]}
        intensity={0.7} castShadow
        shadow-mapSize-width={1024} shadow-mapSize-height={1024}
        shadow-camera-far={50}
        shadow-camera-left={-20} shadow-camera-right={20}
        shadow-camera-top={20} shadow-camera-bottom={-20}
      />
      <hemisphereLight args={["#b4d4ff", "#2d2d3d", 0.35]} />
      <Environment preset="city" />

      <AnimatedGroup>
        {/* ── Dalle sol (sous le RDC) ── */}
        <FloorSlab bounds={bounds} y={-CONCRETE_SLAB_THICKNESS} thickness={CONCRETE_SLAB_THICKNESS} wireframe={wireframe} />

        {/* ── Boucle multi-étages ── */}
        {Array.from({ length: numFloors }, (_, floorIdx) => {
          const yOffset = floorIdx * (ceilingHeight + CONCRETE_SLAB_THICKNESS);
          return (
            <group key={`floor-${floorIdx}`} position={[0, yOffset, 0]}>
              {/* Room floor slabs */}
              {rooms.map((room) => (
                <RoomFloor
                  key={`floor-${floorIdx}-${room.id}`}
                  room={room} imgW={imgW} imgH={imgH} ppm={ppm}
                  bounds={bounds} wireframe={wireframe}
                  hovered={floorIdx === 0 && hoveredRoom === room.id}
                  onHover={floorIdx === 0 ? setHoveredRoom : () => {}}
                />
              ))}

              {/* Walls with opening holes */}
              {walls.map((wall, i) => (
                <WallWithOpenings
                  key={`wall-${floorIdx}-${i}`}
                  wall={wall}
                  wallOpenings={wallOpeningsMap.get(i) ?? []}
                  height={ceilingHeight}
                  wireframe={wireframe}
                />
              ))}

              {/* 3D Doors, French Doors & Windows */}
              {walls.map((wall, wi) =>
                (wallOpeningsMap.get(wi) ?? []).map((op, oi) =>
                  op.isFrenchDoor ? (
                    <FrenchDoorMesh3D
                      key={`fd-${floorIdx}-${wi}-${oi}`}
                      wall={wall} info={op} wireframe={wireframe}
                    />
                  ) : op.isDoor ? (
                    <DoorMesh3D
                      key={`door-${floorIdx}-${wi}-${oi}`}
                      wall={wall} info={op} wireframe={wireframe}
                    />
                  ) : (
                    <WindowMesh3D
                      key={`win-${floorIdx}-${wi}-${oi}`}
                      wall={wall} info={op} wireframe={wireframe}
                    />
                  )
                )
              )}

              {/* Labels uniquement au RDC */}
              {floorIdx === 0 && rooms.map((room) => (
                <RoomLabel
                  key={`label-${room.id}`}
                  room={room} imgW={imgW} imgH={imgH} ppm={ppm}
                  bounds={bounds} ceilingHeight={ceilingHeight}
                />
              ))}

              {/* Dalle béton au-dessus de cet étage — toit masquable sur le dernier étage */}
              {(floorIdx < numFloors - 1 || showRoof) && (
                <FloorSlab
                  bounds={bounds}
                  y={ceilingHeight}
                  thickness={CONCRETE_SLAB_THICKNESS}
                  wireframe={wireframe}
                />
              )}
            </group>
          );
        })}
      </AnimatedGroup>

      {/* Ground plane with grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[bounds.maxDim * 3, bounds.maxDim * 3]} />
        <shadowMaterial transparent opacity={0.12} />
      </mesh>
      <gridHelper
        args={[
          Math.ceil(bounds.maxDim * 2.5),
          Math.ceil(bounds.maxDim * 2.5),
          "#333344",
          "#222233",
        ]}
        position={[0, -0.015, 0]}
      />

      <ContactShadows
        position={[0, -0.01, 0]}
        opacity={0.25} scale={bounds.maxDim * 2} blur={2} far={5}
      />
    </Canvas>
  );
}
