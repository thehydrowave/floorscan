/* eslint-disable @typescript-eslint/no-explicit-any */

// Type declarations for @react-three/fiber and @react-three/drei
// The bundled .d.ts files have broken declaration paths with bundler moduleResolution.

declare module "@react-three/fiber" {
  import { FC, ReactNode } from "react";
  import * as THREE from "three";

  export interface CanvasProps {
    children?: ReactNode;
    shadows?: boolean;
    gl?: Partial<THREE.WebGLRendererParameters> & { alpha?: boolean; powerPreference?: string };
    style?: React.CSSProperties;
    camera?: Partial<THREE.PerspectiveCamera> & { position?: [number, number, number]; fov?: number };
    onPointerMissed?: () => void;
    [key: string]: any;
  }

  export const Canvas: FC<CanvasProps>;

  export function useFrame(callback: (state: any, delta: number) => void): void;
  export function useThree(): { camera: THREE.Camera; scene: THREE.Scene; gl: THREE.WebGLRenderer; [key: string]: any };
}

declare module "@react-three/drei" {
  import { FC, ReactNode, Ref } from "react";
  import * as THREE from "three";

  export interface OrbitControlsProps {
    autoRotate?: boolean;
    autoRotateSpeed?: number;
    enableDamping?: boolean;
    dampingFactor?: number;
    target?: [number, number, number] | THREE.Vector3;
    maxPolarAngle?: number;
    minDistance?: number;
    maxDistance?: number;
    onStart?: () => void;
    makeDefault?: boolean;
    ref?: Ref<any>;
    [key: string]: any;
  }
  export const OrbitControls: FC<OrbitControlsProps>;

  export interface TextProps {
    children?: ReactNode;
    position?: [number, number, number];
    fontSize?: number;
    color?: string;
    anchorX?: "left" | "center" | "right";
    anchorY?: "top" | "middle" | "bottom";
    outlineWidth?: number;
    outlineColor?: string;
    font?: string | undefined;
    [key: string]: any;
  }
  export const Text: FC<TextProps>;

  export interface ContactShadowsProps {
    position?: [number, number, number];
    opacity?: number;
    scale?: number;
    blur?: number;
    far?: number;
    [key: string]: any;
  }
  export const ContactShadows: FC<ContactShadowsProps>;

  export interface EnvironmentProps {
    preset?: "apartment" | "city" | "dawn" | "forest" | "lobby" | "night" | "park" | "studio" | "sunset" | "warehouse";
    [key: string]: any;
  }
  export const Environment: FC<EnvironmentProps>;

  export interface PerspectiveCameraProps {
    makeDefault?: boolean;
    position?: [number, number, number];
    fov?: number;
    near?: number;
    far?: number;
    [key: string]: any;
  }
  export const PerspectiveCamera: FC<PerspectiveCameraProps>;
}

// ── Three.js JSX elements for React Three Fiber ──────────────────────────────
// R3F extends JSX.IntrinsicElements with Three.js object types.

declare namespace JSX {
  interface IntrinsicElements {
    // Lights
    ambientLight: any;
    directionalLight: any;
    hemisphereLight: any;
    pointLight: any;
    spotLight: any;

    // Objects
    mesh: any;
    group: any;
    line: any;
    points: any;
    instancedMesh: any;

    // Geometries
    boxGeometry: any;
    planeGeometry: any;
    sphereGeometry: any;
    cylinderGeometry: any;
    extrudeGeometry: any;
    bufferGeometry: any;

    // Materials
    meshStandardMaterial: any;
    meshBasicMaterial: any;
    meshPhongMaterial: any;
    meshLambertMaterial: any;
    shadowMaterial: any;
    lineBasicMaterial: any;

    // Helpers
    gridHelper: any;
    axesHelper: any;
  }
}
