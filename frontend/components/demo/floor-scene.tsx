"use client";

import { useRef, useState, useMemo, useEffect } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Text, ContactShadows, Environment, PerspectiveCamera } from "@react-three/drei";
import type { Room, Opening } from "@/lib/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const WALL_THICKNESS = 0.15;
const WALL_COLOR = "#d1d5db";
const DOOR_COLOR = "#92400e";
const WINDOW_COLOR = "#7dd3fc";
const FLOOR_OPACITY = 0.55;
const FLOOR_HOVER_OPACITY = 0.85;
const SLAB_DEPTH = 0.04;

const ROOM_COLORS: Record<string, string> = {
  "bedroom": "#818cf8", "living room": "#34d399", "living": "#34d399",
  "kitchen": "#fb923c", "bathroom": "#22d3ee", "hallway": "#94a3b8",
  "corridor": "#94a3b8", "office": "#a78bfa", "study": "#a78bfa",
  "wc": "#fbbf24", "toilet": "#fbbf24", "dining room": "#f472b6",
  "storage": "#78716c", "closet": "#78716c", "garage": "#6b7280",
  "balcony": "#86efac", "laundry": "#67e8f9",
};

function getRoomColor(type: string): string {
  return ROOM_COLORS[type?.toLowerCase()] ?? "#94a3b8";
}

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
  // Round to 3 decimals and sort endpoints for dedup
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

// ── Find closest wall for an opening ──────────────────────────────────────────

function findClosestWall(
  ox: number,
  oz: number,
  walls: WallEdge[]
): WallEdge | null {
  let best: WallEdge | null = null;
  let bestDist = 2.0; // max 2m threshold

  for (const w of walls) {
    // Project point onto the wall segment
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
      best = w;
    }
  }
  return best;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RoomFloor({
  room,
  imgW,
  imgH,
  ppm,
  bounds,
  wireframe,
  hovered,
  onHover,
}: {
  room: Room;
  imgW: number;
  imgH: number;
  ppm: number;
  bounds: SceneBounds;
  wireframe: boolean;
  hovered: boolean;
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
    const fx = (first.x * imgW) / ppm - bounds.centerX;
    const fz = (first.y * imgH) / ppm - bounds.centerZ;
    shape.moveTo(fx, fz);

    for (let i = 1; i < pts.length; i++) {
      const px = (pts[i].x * imgW) / ppm - bounds.centerX;
      const pz = (pts[i].y * imgH) / ppm - bounds.centerZ;
      shape.lineTo(px, pz);
    }
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: SLAB_DEPTH,
      bevelEnabled: false,
    });
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [room, imgW, imgH, ppm, bounds]);

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      receiveShadow
      onPointerEnter={(e: any) => { e.stopPropagation(); onHover(room.id); }}
      onPointerLeave={() => onHover(null)}
    >
      <meshStandardMaterial
        color={color}
        transparent
        opacity={hovered ? FLOOR_HOVER_OPACITY : FLOOR_OPACITY}
        emissive={color}
        emissiveIntensity={hovered ? 0.35 : 0.05}
        wireframe={wireframe}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function WallMesh({
  wall,
  height,
  wireframe,
}: {
  wall: WallEdge;
  height: number;
  wireframe: boolean;
}) {
  return (
    <mesh
      position={[wall.cx, height / 2, wall.cz]}
      rotation={[0, -wall.angle, 0]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[wall.length, height, WALL_THICKNESS]} />
      <meshStandardMaterial
        color={WALL_COLOR}
        roughness={0.85}
        metalness={0.02}
        wireframe={wireframe}
      />
    </mesh>
  );
}

function OpeningMesh({
  opening,
  imgW,
  imgH,
  ppm,
  bounds,
  walls,
}: {
  opening: Opening;
  imgW: number;
  imgH: number;
  ppm: number;
  bounds: SceneBounds;
  walls: WallEdge[];
}) {
  const ox = (opening.x_px / ppm) - bounds.centerX;
  const oz = (opening.y_px / ppm) - bounds.centerZ;
  const closest = findClosestWall(ox, oz, walls);
  if (!closest) return null;

  const isDoor = opening.class === "door";
  const w = opening.width_m ?? opening.length_m ?? (isDoor ? 0.9 : 1.2);
  const h = opening.height_m ?? (isDoor ? 2.1 : 1.2);
  const sill = isDoor ? 0 : 0.9;
  const color = isDoor ? DOOR_COLOR : WINDOW_COLOR;
  const opacity = isDoor ? 0.85 : 0.4;

  // Offset slightly from wall face
  const normalX = Math.sin(closest.angle) * (WALL_THICKNESS * 0.6);
  const normalZ = -Math.cos(closest.angle) * (WALL_THICKNESS * 0.6);

  return (
    <mesh
      position={[ox + normalX, sill + h / 2, oz + normalZ]}
      rotation={[0, -closest.angle, 0]}
    >
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial
        color={color}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        emissive={color}
        emissiveIntensity={isDoor ? 0.1 : 0.2}
      />
    </mesh>
  );
}

function RoomLabel({
  room,
  imgW,
  imgH,
  ppm,
  bounds,
  ceilingHeight,
}: {
  room: Room;
  imgW: number;
  imgH: number;
  ppm: number;
  bounds: SceneBounds;
  ceilingHeight: number;
}) {
  const cx = (room.centroid_norm.x * imgW) / ppm - bounds.centerX;
  const cz = (room.centroid_norm.y * imgH) / ppm - bounds.centerZ;
  const label = room.label_fr || room.type;
  const areaStr = room.area_m2 != null ? `${room.area_m2.toFixed(1)} m²` : "";

  return (
    <group position={[cx, ceilingHeight + 0.4, cz]}>
      <Text
        fontSize={0.3}
        color="white"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.025}
        outlineColor="#000000"
        font={undefined}
      >
        {label}
      </Text>
      {areaStr && (
        <Text
          position={[0, -0.35, 0]}
          fontSize={0.22}
          color={getRoomColor(room.type)}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#000000"
          font={undefined}
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
        // Smooth ease-out cubic
        const t = 1 - Math.pow(1 - next, 3);
        groupRef.current.position.y = (1 - t) * -0.5;
        groupRef.current.scale.setScalar(0.5 + t * 0.5);
        groupRef.current.children.forEach((c: THREE.Object3D) => {
          if ((c as THREE.Mesh).material) {
            const mat = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
            if (mat.opacity !== undefined) {
              mat.needsUpdate = true;
            }
          }
        });
      }
    }
  });

  return <group ref={groupRef}>{children}</group>;
}

// ── Camera controller ─────────────────────────────────────────────────────────

function CameraRig({
  bounds,
  ceilingHeight,
  resetSignal,
  autoRotate,
  onInteract,
}: {
  bounds: SceneBounds;
  ceilingHeight: number;
  resetSignal: number;
  autoRotate: boolean;
  onInteract: () => void;
}) {
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();
  const camDist = bounds.maxDim * 1.2 + 2;

  // Reset camera on signal change
  useEffect(() => {
    if (controlsRef.current) {
      camera.position.set(camDist * 0.7, camDist * 0.55, camDist * 0.7);
      controlsRef.current.target.set(0, ceilingHeight * 0.3, 0);
      controlsRef.current.update();
    }
  }, [resetSignal, camDist, ceilingHeight, camera]);

  return (
    <OrbitControls
      ref={controlsRef}
      autoRotate={autoRotate}
      autoRotateSpeed={1.2}
      enableDamping
      dampingFactor={0.06}
      target={[0, ceilingHeight * 0.3, 0]}
      maxPolarAngle={Math.PI * 0.48}
      minDistance={2}
      maxDistance={camDist * 3}
      onStart={onInteract}
      makeDefault
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
  wireframe: boolean;
  resetSignal: number;
}

export default function FloorScene({
  rooms,
  openings,
  ppm,
  imgW,
  imgH,
  ceilingHeight,
  wireframe,
  resetSignal,
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
        fov={50}
        near={0.1}
        far={200}
      />

      <CameraRig
        bounds={bounds}
        ceilingHeight={ceilingHeight}
        resetSignal={resetSignal}
        autoRotate={autoRotate}
        onInteract={() => setAutoRotate(false)}
      />

      {/* Lighting */}
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[bounds.maxDim, bounds.maxDim * 1.8, bounds.maxDim * 0.8]}
        intensity={0.7}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={50}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      <hemisphereLight args={["#b4d4ff", "#2d2d3d", 0.35]} />

      {/* Environment for subtle reflections */}
      <Environment preset="city" />

      <AnimatedGroup>
        {/* Room floor slabs */}
        {rooms.map((room) => (
          <RoomFloor
            key={`floor-${room.id}`}
            room={room}
            imgW={imgW}
            imgH={imgH}
            ppm={ppm}
            bounds={bounds}
            wireframe={wireframe}
            hovered={hoveredRoom === room.id}
            onHover={setHoveredRoom}
          />
        ))}

        {/* Walls */}
        {walls.map((wall, i) => (
          <WallMesh
            key={`wall-${i}`}
            wall={wall}
            height={ceilingHeight}
            wireframe={wireframe}
          />
        ))}

        {/* Openings */}
        {openings.map((opening, i) => (
          <OpeningMesh
            key={`opening-${i}`}
            opening={opening}
            imgW={imgW}
            imgH={imgH}
            ppm={ppm}
            bounds={bounds}
            walls={walls}
          />
        ))}

        {/* Room labels */}
        {rooms.map((room) => (
          <RoomLabel
            key={`label-${room.id}`}
            room={room}
            imgW={imgW}
            imgH={imgH}
            ppm={ppm}
            bounds={bounds}
            ceilingHeight={ceilingHeight}
          />
        ))}
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

      {/* Contact shadows for premium look */}
      <ContactShadows
        position={[0, -0.01, 0]}
        opacity={0.25}
        scale={bounds.maxDim * 2}
        blur={2}
        far={5}
      />
    </Canvas>
  );
}
