"use client";

/**
 * FacadeScene — React Three Fiber 3D scene for facade analysis.
 * Shows a flat building front wall with colored boxes for each detected element
 * (windows=blue, doors=pink, balconies=green), floor separator lines, and orbit controls.
 * Camera starts at a slight angle for depth perception.
 */

import { useEffect, useRef } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { FacadeElement } from "@/lib/types";

/* ── Color constants matching TYPE_COLORS ── */
const ELEMENT_COLORS: Record<string, string> = {
  window:     "#60a5fa",
  door:       "#f472b6",
  balcony:    "#34d399",
  floor_line: "#fb923c",
  roof:       "#a78bfa",
  column:     "#94a3b8",
  other:      "#fbbf24",
};

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

interface FacadeSceneProps {
  elements: FacadeElement[];
  facadeAreaM2: number | null;
  floorsCount: number;
  floorHeight: number;
  wireframe: boolean;
  resetSignal: number;
}

/* ── Building facade geometry ── */
function FacadeGeometry({ elements, floorsCount, floorHeight, wireframe }: {
  elements: FacadeElement[];
  floorsCount: number;
  floorHeight: number;
  wireframe: boolean;
}) {
  // Estimate facade dimensions from element bounding boxes or use defaults
  // Normalize: building width = 10 units, height based on floor count
  const facadeW = 10;
  const facadeH = floorsCount * floorHeight;
  const wallDepth = 0.3;

  return (
    <group>
      {/* ── Main wall ── */}
      <mesh position={[0, facadeH / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[facadeW, facadeH, wallDepth]} />
        <meshStandardMaterial
          color="#475569"
          roughness={0.8}
          metalness={0.05}
          wireframe={wireframe}
          transparent
          opacity={wireframe ? 0.5 : 0.9}
        />
      </mesh>

      {/* ── Floor separator lines ── */}
      {Array.from({ length: floorsCount - 1 }, (_, i) => {
        const y = (i + 1) * floorHeight;
        return (
          <mesh key={`floor-${i}`} position={[0, y, wallDepth / 2 + 0.01]}>
            <boxGeometry args={[facadeW, 0.06, 0.02]} />
            <meshStandardMaterial color="#fb923c" roughness={0.5} />
          </mesh>
        );
      })}

      {/* ── Elements (windows, doors, balconies) ── */}
      {elements
        .filter(e => ["window", "door", "balcony"].includes(e.type))
        .map(el => {
          const color = ELEMENT_COLORS[el.type] ?? "#94a3b8";
          const [r, g, b] = hexToRgb(color);
          const threeColor = new THREE.Color(r, g, b);

          // Map normalized bbox to 3D coords
          // bbox_norm: x/y are top-left corner, w/h are size, all 0-1
          const bx = (el.bbox_norm.x + el.bbox_norm.w / 2 - 0.5) * facadeW;
          // Flip Y: bbox_norm.y=0 is top, in 3D y increases upward
          const by = (1 - el.bbox_norm.y - el.bbox_norm.h / 2) * facadeH;
          const bw = el.bbox_norm.w * facadeW;
          const bh = el.bbox_norm.h * facadeH;

          // Only render if reasonable size
          if (bw < 0.05 || bh < 0.05) return null;

          const depth = el.type === "balcony" ? 0.6 : 0.05;
          const zOffset = wallDepth / 2 + depth / 2 + 0.01;

          return (
            <group key={el.id}>
              {/* Element box */}
              <mesh position={[bx, by, zOffset]} castShadow>
                <boxGeometry args={[bw, bh, depth]} />
                <meshStandardMaterial
                  color={threeColor}
                  roughness={el.type === "window" ? 0.1 : 0.6}
                  metalness={el.type === "window" ? 0.4 : 0.1}
                  transparent
                  opacity={el.type === "window" ? 0.65 : 0.85}
                  wireframe={wireframe}
                />
              </mesh>

              {/* Window frame: thin border boxes (top, bottom, left, right) */}
              {el.type === "window" && !wireframe && (
                <group position={[bx, by, zOffset + depth / 2 + 0.005]}>
                  {/* top */}
                  <mesh position={[0, bh / 2 + 0.02, 0]}>
                    <boxGeometry args={[bw + 0.06, 0.04, 0.02]} />
                    <meshStandardMaterial color={threeColor} roughness={0.3} />
                  </mesh>
                  {/* bottom */}
                  <mesh position={[0, -(bh / 2 + 0.02), 0]}>
                    <boxGeometry args={[bw + 0.06, 0.04, 0.02]} />
                    <meshStandardMaterial color={threeColor} roughness={0.3} />
                  </mesh>
                  {/* left */}
                  <mesh position={[-(bw / 2 + 0.02), 0, 0]}>
                    <boxGeometry args={[0.04, bh, 0.02]} />
                    <meshStandardMaterial color={threeColor} roughness={0.3} />
                  </mesh>
                  {/* right */}
                  <mesh position={[bw / 2 + 0.02, 0, 0]}>
                    <boxGeometry args={[0.04, bh, 0.02]} />
                    <meshStandardMaterial color={threeColor} roughness={0.3} />
                  </mesh>
                </group>
              )}
            </group>
          );
        })}

      {/* ── Column elements ── */}
      {elements
        .filter(e => e.type === "column")
        .map(el => {
          const bx = (el.bbox_norm.x + el.bbox_norm.w / 2 - 0.5) * facadeW;
          const by = (1 - el.bbox_norm.y - el.bbox_norm.h / 2) * facadeH;
          const bw = el.bbox_norm.w * facadeW;
          const bh = el.bbox_norm.h * facadeH;
          if (bw < 0.02 || bh < 0.02) return null;
          return (
            <mesh key={el.id} position={[bx, by, wallDepth / 2 + 0.06]}>
              <boxGeometry args={[Math.max(bw, 0.1), bh, 0.1]} />
              <meshStandardMaterial color="#94a3b8" roughness={0.7} wireframe={wireframe} />
            </mesh>
          );
        })}

      {/* ── Roof line ── */}
      {elements
        .filter(e => e.type === "roof")
        .slice(0, 1)
        .map(el => {
          const by = (1 - el.bbox_norm.y) * facadeH;
          return (
            <mesh key={`roof-${el.id}`} position={[0, by, wallDepth / 2 + 0.01]}>
              <boxGeometry args={[facadeW + 0.4, 0.1, 0.05]} />
              <meshStandardMaterial color="#a78bfa" roughness={0.6} wireframe={wireframe} />
            </mesh>
          );
        })}

      {/* ── Ground plane ── */}
      <mesh position={[0, -0.02, 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[facadeW + 4, 6]} />
        <meshStandardMaterial color="#1e293b" roughness={1} />
      </mesh>
    </group>
  );
}

/* ── Camera controller ── */
function CameraController({ resetSignal, facadeH }: { resetSignal: number; facadeH: number }) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    camera.position.set(0, facadeH * 0.5, facadeH * 1.6);
    camera.lookAt(0, facadeH * 0.5, 0);
    if (controlsRef.current) {
      controlsRef.current.target.set(0, facadeH * 0.5, 0);
      controlsRef.current.update();
    }
  }, [resetSignal, facadeH, camera]);

  return <OrbitControls ref={controlsRef} target={[0, facadeH * 0.5, 0]} enableDamping dampingFactor={0.08} />;
}

/* ── Main exported component ── */
export default function FacadeScene({
  elements, facadeAreaM2, floorsCount, floorHeight, wireframe, resetSignal,
}: FacadeSceneProps) {
  const facadeH = floorsCount * floorHeight;

  return (
    <Canvas
      shadows
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      camera={{ position: [0, facadeH * 0.5, facadeH * 1.6] as any, fov: 45, near: 0.1, far: 1000 }}
      gl={{ antialias: true, alpha: false }}
      style={{ background: "transparent" }}
    >
      {/* Lighting */}
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[10, facadeH * 2, 8]}
        intensity={1.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <directionalLight position={[-6, facadeH, 4]} intensity={0.4} color="#e0e8ff" />
      <pointLight position={[0, facadeH + 2, facadeH]} intensity={0.5} color="#fbbf24" decay={2} />

      {/* Camera controls with reset */}
      <CameraController resetSignal={resetSignal} facadeH={facadeH} />

      {/* Facade geometry */}
      <FacadeGeometry
        elements={elements}
        floorsCount={floorsCount}
        floorHeight={floorHeight}
        wireframe={wireframe}
      />
    </Canvas>
  );
}
