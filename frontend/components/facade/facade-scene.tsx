"use client";

/**
 * FacadeScene — React Three Fiber 3D scene for facade analysis.
 * Each facade delimitation zone = a separate wall panel placed side by side.
 * Windows are yellow cutout boxes on the wall panels.
 */

import { useEffect, useRef, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { FacadeElement } from "@/lib/types";

/* ── Color constants ── */
const WINDOW_COLOR = "#fbbf24";
const WALL_COLOR = "#3b82f6";

function hexToThree(hex: string): THREE.Color {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return new THREE.Color(r, g, b);
}

interface FacadeZone {
  id: number;
  pts: Array<{ x: number; y: number }>;
}

interface FacadeSceneProps {
  elements: FacadeElement[];
  facadeAreaM2: number | null;
  floorsCount: number;
  floorHeight: number;
  wireframe: boolean;
  resetSignal: number;
  facadeZones?: FacadeZone[];
}

/** Check if a point is inside a polygon (ray casting) */
function pointInPoly(pt: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if ((poly[i].y > pt.y) !== (poly[j].y > pt.y) &&
      pt.x < (poly[j].x - poly[i].x) * (pt.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Polygon bounding box */
function polyBbox(pts: { x: number; y: number }[]) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/* ── Single facade panel with its windows ── */
function FacadePanel({ zone, elements, panelWidth, panelHeight, xOffset, wireframe }: {
  zone: FacadeZone;
  elements: FacadeElement[];
  panelWidth: number;
  panelHeight: number;
  xOffset: number;
  wireframe: boolean;
}) {
  const wallDepth = 0.25;
  const bbox = polyBbox(zone.pts);

  return (
    <group position={[xOffset, 0, 0]}>
      {/* Wall panel */}
      <mesh position={[0, panelHeight / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[panelWidth, panelHeight, wallDepth]} />
        <meshStandardMaterial
          color={hexToThree(WALL_COLOR)}
          roughness={0.7}
          metalness={0.05}
          wireframe={wireframe}
          transparent
          opacity={wireframe ? 0.4 : 0.85}
        />
      </mesh>

      {/* Window elements on this panel */}
      {elements.map(el => {
        // Map element bbox from zone-local normalized coords to panel coords
        const relX = bbox.w > 0 ? (el.bbox_norm.x + el.bbox_norm.w / 2 - bbox.x) / bbox.w : 0.5;
        const relY = bbox.h > 0 ? (el.bbox_norm.y + el.bbox_norm.h / 2 - bbox.y) / bbox.h : 0.5;
        const relW = bbox.w > 0 ? el.bbox_norm.w / bbox.w : 0.1;
        const relH = bbox.h > 0 ? el.bbox_norm.h / bbox.h : 0.1;

        const bx = (relX - 0.5) * panelWidth;
        const by = (1 - relY) * panelHeight;
        const bw = Math.min(relW * panelWidth, panelWidth * 0.4);
        const bh = Math.min(relH * panelHeight, panelHeight * 0.3);

        if (bw < 0.05 || bh < 0.05) return null;

        const zOffset = wallDepth / 2 + 0.03;
        const winColor = hexToThree(WINDOW_COLOR);

        return (
          <group key={el.id}>
            {/* Window glass */}
            <mesh position={[bx, by, zOffset]} castShadow>
              <boxGeometry args={[bw, bh, 0.04]} />
              <meshStandardMaterial
                color={winColor}
                roughness={0.1}
                metalness={0.3}
                transparent
                opacity={0.7}
                wireframe={wireframe}
              />
            </mesh>
            {/* Window frame */}
            {!wireframe && (
              <group position={[bx, by, zOffset + 0.025]}>
                <mesh position={[0, bh / 2 + 0.015, 0]}>
                  <boxGeometry args={[bw + 0.04, 0.03, 0.015]} />
                  <meshStandardMaterial color={winColor} roughness={0.3} />
                </mesh>
                <mesh position={[0, -(bh / 2 + 0.015), 0]}>
                  <boxGeometry args={[bw + 0.04, 0.03, 0.015]} />
                  <meshStandardMaterial color={winColor} roughness={0.3} />
                </mesh>
                <mesh position={[-(bw / 2 + 0.015), 0, 0]}>
                  <boxGeometry args={[0.03, bh, 0.015]} />
                  <meshStandardMaterial color={winColor} roughness={0.3} />
                </mesh>
                <mesh position={[bw / 2 + 0.015, 0, 0]}>
                  <boxGeometry args={[0.03, bh, 0.015]} />
                  <meshStandardMaterial color={winColor} roughness={0.3} />
                </mesh>
              </group>
            )}
          </group>
        );
      })}
    </group>
  );
}

/* ── Fallback: single wall when no facade zones defined ── */
function SingleFacade({ elements, floorsCount, floorHeight, wireframe }: {
  elements: FacadeElement[];
  floorsCount: number;
  floorHeight: number;
  wireframe: boolean;
}) {
  const facadeW = 10;
  const facadeH = floorsCount * floorHeight;
  const wallDepth = 0.25;

  return (
    <group>
      <mesh position={[0, facadeH / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[facadeW, facadeH, wallDepth]} />
        <meshStandardMaterial color={hexToThree(WALL_COLOR)} roughness={0.7} wireframe={wireframe} transparent opacity={wireframe ? 0.4 : 0.85} />
      </mesh>

      {elements
        .filter(e => ["window", "other"].includes(e.type))
        .map(el => {
          const bx = (el.bbox_norm.x + el.bbox_norm.w / 2 - 0.5) * facadeW;
          const by = (1 - el.bbox_norm.y - el.bbox_norm.h / 2) * facadeH;
          const bw = el.bbox_norm.w * facadeW;
          const bh = el.bbox_norm.h * facadeH;
          if (bw < 0.05 || bh < 0.05) return null;
          const zOffset = wallDepth / 2 + 0.03;
          const winColor = hexToThree(WINDOW_COLOR);
          return (
            <group key={el.id}>
              <mesh position={[bx, by, zOffset]} castShadow>
                <boxGeometry args={[bw, bh, 0.04]} />
                <meshStandardMaterial color={winColor} roughness={0.1} metalness={0.3} transparent opacity={0.7} wireframe={wireframe} />
              </mesh>
              {!wireframe && (
                <group position={[bx, by, zOffset + 0.025]}>
                  <mesh position={[0, bh / 2 + 0.015, 0]}><boxGeometry args={[bw + 0.04, 0.03, 0.015]} /><meshStandardMaterial color={winColor} roughness={0.3} /></mesh>
                  <mesh position={[0, -(bh / 2 + 0.015), 0]}><boxGeometry args={[bw + 0.04, 0.03, 0.015]} /><meshStandardMaterial color={winColor} roughness={0.3} /></mesh>
                  <mesh position={[-(bw / 2 + 0.015), 0, 0]}><boxGeometry args={[0.03, bh, 0.015]} /><meshStandardMaterial color={winColor} roughness={0.3} /></mesh>
                  <mesh position={[bw / 2 + 0.015, 0, 0]}><boxGeometry args={[0.03, bh, 0.015]} /><meshStandardMaterial color={winColor} roughness={0.3} /></mesh>
                </group>
              )}
            </group>
          );
        })}

      {/* Ground plane */}
      <mesh position={[0, -0.02, 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[facadeW + 4, 6]} />
        <meshStandardMaterial color="#1e293b" roughness={1} />
      </mesh>
    </group>
  );
}

/* ── Camera controller ── */
function CameraController({ resetSignal, centerY, cameraZ }: { resetSignal: number; centerY: number; cameraZ: number }) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    camera.position.set(0, centerY, cameraZ);
    camera.lookAt(0, centerY, 0);
    if (controlsRef.current) {
      controlsRef.current.target.set(0, centerY, 0);
      controlsRef.current.update();
    }
  }, [resetSignal, centerY, cameraZ, camera]);

  return <OrbitControls ref={controlsRef} target={[0, centerY, 0]} enableDamping dampingFactor={0.08} />;
}

/* ── Main exported component ── */
export default function FacadeScene({
  elements, facadeAreaM2, floorsCount, floorHeight, wireframe, resetSignal, facadeZones,
}: FacadeSceneProps) {
  const facadeH = floorsCount * floorHeight;
  const GAP = 1.5;

  // Assign elements to their respective facade zones
  const zoneData = useMemo(() => {
    if (!facadeZones || facadeZones.length === 0) return null;

    return facadeZones.map(zone => {
      const bbox = polyBbox(zone.pts);
      // Width proportional to zone bbox width (relative to total)
      const panelWidth = Math.max(3, bbox.w * 15); // Scale for visual clarity
      // Find elements whose centroid is inside this zone
      const zoneElements = elements.filter(el => {
        const cx = el.bbox_norm.x + el.bbox_norm.w / 2;
        const cy = el.bbox_norm.y + el.bbox_norm.h / 2;
        return (["window", "other"].includes(el.type)) && pointInPoly({ x: cx, y: cy }, zone.pts);
      });
      return { zone, panelWidth, elements: zoneElements };
    });
  }, [facadeZones, elements]);

  // Calculate total width and offsets
  const { totalWidth, offsets } = useMemo(() => {
    if (!zoneData) return { totalWidth: 10, offsets: [0] };
    const widths = zoneData.map(z => z.panelWidth);
    const total = widths.reduce((s, w) => s + w, 0) + GAP * (widths.length - 1);
    const offs: number[] = [];
    let x = -total / 2;
    for (const w of widths) {
      offs.push(x + w / 2);
      x += w + GAP;
    }
    return { totalWidth: total, offsets: offs };
  }, [zoneData]);

  const cameraZ = Math.max(facadeH * 1.5, totalWidth * 0.8);

  return (
    <Canvas
      shadows
      camera={{ position: [0, facadeH * 0.5, cameraZ] as any, fov: 45, near: 0.1, far: 1000 }}
      gl={{ antialias: true, alpha: false }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, facadeH * 2, 8]} intensity={1.4} castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[-6, facadeH, 4]} intensity={0.4} color="#e0e8ff" />
      <pointLight position={[0, facadeH + 2, facadeH]} intensity={0.5} color="#fbbf24" decay={2} />

      <CameraController resetSignal={resetSignal} centerY={facadeH * 0.5} cameraZ={cameraZ} />

      {zoneData ? (
        <>
          {zoneData.map((zd, i) => (
            <FacadePanel
              key={zd.zone.id}
              zone={zd.zone}
              elements={zd.elements}
              panelWidth={zd.panelWidth}
              panelHeight={facadeH}
              xOffset={offsets[i]}
              wireframe={wireframe}
            />
          ))}
          {/* Ground plane */}
          <mesh position={[0, -0.02, 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[totalWidth + 4, 6]} />
            <meshStandardMaterial color="#1e293b" roughness={1} />
          </mesh>
        </>
      ) : (
        <SingleFacade elements={elements} floorsCount={floorsCount} floorHeight={floorHeight} wireframe={wireframe} />
      )}
    </Canvas>
  );
}
