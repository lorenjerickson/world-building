"use client";

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { buildIndexedMeshBuffers, subdivideMesh, type FaceName, type Triangle, type Vec3 } from "@world-building/common";

export type EncounterEditMode = "place" | "shape" | "texture";
export type EncounterSurfaceHit = {
  cellKey: string;
  faceName: FaceName;
  point: Vec3;
  vertex: Vec3;
  vertexPosition: Vec3;
};
export type EncounterSurfaceAction = "primary" | "drag" | "remove";

const MATERIALS: Record<string, { color: string; water?: boolean }> = {
  grass: { color: "#5f7f3b" }, dirt: { color: "#75543a" }, stone: { color: "#777b7d" }, road: { color: "#9a835f" },
  wood: { color: "#805a37" }, water: { color: "#2f89ad", water: true }, "material/top": { color: "#718f4b" },
  "material/bottom": { color: "#5a4432" }, "material/north": { color: "#80684b" }, "material/south": { color: "#80684b" },
  "material/east": { color: "#725b42" }, "material/west": { color: "#725b42" },
};

function materialDefinition(id: string) { return MATERIALS[id] ?? { color: "#b15f52" }; }

function makePrototypeTexture(colorValue: string) {
  const color = new THREE.Color(colorValue);
  const pixels = new Uint8Array(4 * 4 * 4);
  for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) {
    const offset = (y * 4 + x) * 4;
    const factor = (x + y) % 2 === 0 ? 1 : 0.82;
    pixels[offset] = Math.round(color.r * factor * 255);
    pixels[offset + 1] = Math.round(color.g * factor * 255);
    pixels[offset + 2] = Math.round(color.b * factor * 255);
    pixels[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, 4, 4, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function hitFromEvent(event: ThreeEvent<PointerEvent | MouseEvent>, triangles: Triangle[]): EncounterSurfaceHit | null {
  const triangle = triangles[event.faceIndex ?? -1];
  if (!triangle) return null;
  const point: Vec3 = [event.point.x, event.point.y, event.point.z];
  const vertices = [triangle.a, triangle.b, triangle.c];
  const highestZ = Math.max(...vertices.map((candidate) => candidate[2]));
  const editableVertices = triangle.faceName === "top" ? vertices : vertices.filter((candidate) => candidate[2] === highestZ);
  const vertexPosition = editableVertices.reduce((nearest, candidate) => {
    const distance = (candidate[0] - point[0]) ** 2 + (candidate[1] - point[1]) ** 2 + (candidate[2] - point[2]) ** 2;
    const nearestDistance = (nearest[0] - point[0]) ** 2 + (nearest[1] - point[1]) ** 2 + (nearest[2] - point[2]) ** 2;
    return distance < nearestDistance ? candidate : nearest;
  });
  const cellZ = Number(triangle.cellKey.split(",")[2]);
  const vertex: Vec3 = [Math.round(vertexPosition[0]), Math.round(vertexPosition[1]), cellZ + 1];
  return { cellKey: triangle.cellKey, faceName: triangle.faceName, point, vertex, vertexPosition };
}

function VisualMaterialMesh({ materialId, smoothNormals, triangles }: {
  materialId: string;
  smoothNormals: boolean;
  triangles: Triangle[];
}) {
  const geometry = useMemo(() => {
    const buffers = buildIndexedMeshBuffers({ triangles, warnings: [] }, { smoothNormals });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(buffers.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(buffers.normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(buffers.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
    geometry.computeBoundingSphere();
    return geometry;
  }, [smoothNormals, triangles]);
  const definition = materialDefinition(materialId);
  const texture = useMemo(() => makePrototypeTexture(definition.color), [definition.color]);
  return <mesh geometry={geometry} raycast={() => null} castShadow receiveShadow>
    <meshStandardMaterial color="#ffffff" map={texture} roughness={definition.water ? 0.22 : 0.9} metalness={definition.water ? 0.08 : 0} transparent={definition.water} opacity={definition.water ? 0.68 : 1} side={THREE.FrontSide} />
  </mesh>;
}

function LogicalMaterialMesh({ triangles, onAction, onEnd, onHover, onSelect }: {
  triangles: Triangle[];
  onAction: (hit: EncounterSurfaceHit, action: EncounterSurfaceAction) => void;
  onEnd: () => void;
  onHover: (hit: EncounterSurfaceHit | null) => void;
  onSelect: (cellKey: string) => void;
}) {
  const geometry = useMemo(() => {
    const buffers = buildIndexedMeshBuffers({ triangles, warnings: [] });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(buffers.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(buffers.normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(buffers.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
    geometry.computeBoundingSphere();
    return geometry;
  }, [triangles]);
  return <mesh geometry={geometry}
    onContextMenu={(event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      event.nativeEvent.preventDefault();
      const hit = hitFromEvent(event, triangles);
      if (hit) { onSelect(hit.cellKey); onAction(hit, "remove"); }
    }}
    onPointerDown={(event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      const hit = hitFromEvent(event, triangles);
      if (hit) { onSelect(hit.cellKey); onAction(hit, event.button === 2 ? "remove" : "primary"); }
    }}
    onPointerMove={(event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      const hit = hitFromEvent(event, triangles);
      onHover(hit);
      if (hit && event.buttons === 1) onAction(hit, "drag");
    }}
    onPointerOut={() => onHover(null)}
    onPointerUp={onEnd}
  >
    <meshBasicMaterial colorWrite={false} depthWrite={false} transparent opacity={0} side={THREE.FrontSide} />
  </mesh>;
}

function SurfaceHighlight({ hit, mode, triangles }: { hit: EncounterSurfaceHit; mode: EncounterEditMode; triangles: Triangle[] }) {
  if (mode === "shape") return <mesh position={hit.vertexPosition as [number, number, number]} renderOrder={20}><sphereGeometry args={[0.1, 16, 12]} /><meshBasicMaterial color="#ffcc4d" depthTest={false} /></mesh>;
  const faceTriangles = triangles.filter((triangle) => triangle.cellKey === hit.cellKey && triangle.faceName === hit.faceName);
  const positions = new Float32Array(faceTriangles.flatMap((triangle) => [triangle.a, triangle.b, triangle.b, triangle.c, triangle.c, triangle.a]).flat());
  return <lineSegments renderOrder={20}><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><lineBasicMaterial color={mode === "place" ? "#67e8a5" : "#ffcc4d"} depthTest={false} linewidth={2} /></lineSegments>;
}

function Terrain({ editMode, onAction, onEnd, subdivisionLevel, triangles, selectedCell, onSelect }: {
  editMode?: EncounterEditMode;
  onAction?: (hit: EncounterSurfaceHit, action: EncounterSurfaceAction) => void;
  onEnd?: () => void;
  triangles: Triangle[];
  subdivisionLevel: number;
  selectedCell: string | null;
  onSelect: (cellKey: string) => void;
}) {
  const [hovered, setHovered] = useState<EncounterSurfaceHit | null>(null);
  const visualTriangles = useMemo(
    () => subdivideMesh({ triangles, warnings: [] }, subdivisionLevel).triangles,
    [subdivisionLevel, triangles],
  );
  const visualGroups = useMemo(() => {
    const byMaterial = new Map<string, Triangle[]>();
    for (const triangle of visualTriangles) byMaterial.set(triangle.materialId, [...(byMaterial.get(triangle.materialId) ?? []), triangle]);
    return [...byMaterial.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [visualTriangles]);
  const logicalGroups = useMemo(() => {
    const byMaterial = new Map<string, Triangle[]>();
    for (const triangle of triangles) byMaterial.set(triangle.materialId, [...(byMaterial.get(triangle.materialId) ?? []), triangle]);
    return [...byMaterial.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [triangles]);
  return <group>
    {visualGroups.map(([materialId, materialTriangles]) => <VisualMaterialMesh key={`visual-${materialId}`} materialId={materialId} smoothNormals={subdivisionLevel > 0} triangles={materialTriangles} />)}
    {logicalGroups.map(([materialId, materialTriangles]) => <LogicalMaterialMesh key={`logical-${materialId}`} triangles={materialTriangles} onAction={(hit, action) => onAction?.(hit, action)} onEnd={() => onEnd?.()} onHover={setHovered} onSelect={onSelect} />)}
    {editMode && hovered && <SurfaceHighlight hit={hovered} mode={editMode} triangles={triangles} />}
    {!editMode && selectedCell && (() => {
      const [x, y, z] = selectedCell.split(",").map(Number);
      return <lineSegments position={[x + 0.5, y + 0.5, z + 0.5]}><edgesGeometry args={[new THREE.BoxGeometry(1.03, 1.03, 1.03)]} /><lineBasicMaterial color="#ffcc4d" depthTest={false} /></lineSegments>;
    })()}
  </group>;
}

function PerformanceProbe({ onFirstFrame, onStats }: { onFirstFrame: () => void; onStats: WebGLSceneProps["onStats"] }) {
  const gl = useThree((state) => state.gl);
  const sample = useRef({ elapsed: 0, frames: 0, started: false });
  useFrame((_, delta) => {
    if (!sample.current.started) { sample.current.started = true; onFirstFrame(); }
    sample.current.elapsed += delta;
    sample.current.frames += 1;
    if (sample.current.elapsed >= 1) {
      onStats({ fps: sample.current.frames / sample.current.elapsed, frameMs: sample.current.elapsed / sample.current.frames * 1000, drawCalls: gl.info.render.calls, triangles: gl.info.render.triangles, dpr: gl.getPixelRatio(), webgl2: gl.capabilities.isWebGL2 });
      sample.current.elapsed = 0;
      sample.current.frames = 0;
    }
  });
  return null;
}

type WebGLSceneProps = {
  editMode?: EncounterEditMode;
  mode: "perspective" | "overhead";
  subdivisionLevel: number;
  triangles: Triangle[];
  selectedCell: string | null;
  onSelect: (cellKey: string | null) => void;
  onFailure: (message: string) => void;
  onFirstFrame: () => void;
  onSurfaceAction?: (hit: EncounterSurfaceHit, action: EncounterSurfaceAction) => void;
  onSurfaceActionEnd?: () => void;
  onStats: (stats: { fps: number; frameMs: number; drawCalls: number; triangles: number; dpr: number; webgl2: boolean }) => void;
};

export function WebGLScene({ editMode, mode, subdivisionLevel, triangles, selectedCell, onSelect, onFailure, onFirstFrame, onStats, onSurfaceAction, onSurfaceActionEnd }: WebGLSceneProps) {
  const perspective = mode === "perspective";
  return <Canvas
    key={mode}
    orthographic={!perspective}
    camera={perspective ? { position: [10, -12, 9], fov: 45, near: 0.1, far: 250 } : { position: [8, 4, 30], zoom: 42, near: 0.1, far: 250 }}
    shadows="basic" dpr={[1, 1.5]}
    gl={{ antialias: false, failIfMajorPerformanceCaveat: false, powerPreference: "high-performance" }}
    fallback={<span>HTML canvas elements are not supported by this browser.</span>}
    onCreated={({ gl }) => gl.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      onFailure("The browser reported that the WebGL context was lost.");
    }, { once: true })}
    onPointerMissed={() => onSelect(null)}
  >
    <color attach="background" args={["#c9d3d8"]} />
    <ambientLight intensity={1.3} />
    <directionalLight position={[7, -5, 14]} intensity={2.2} castShadow />
    <Terrain editMode={editMode} subdivisionLevel={subdivisionLevel} triangles={triangles} selectedCell={selectedCell} onAction={onSurfaceAction} onEnd={onSurfaceActionEnd} onSelect={onSelect} />
    <gridHelper args={[40, 40, "#51636c", "#87979d"]} rotation={[Math.PI / 2, 0, 0]} />
    <OrbitControls
      makeDefault
      target={[7.5, 1.5, 0.5]}
      enablePan
      enableRotate={perspective}
      minDistance={2}
      maxDistance={80}
      mouseButtons={editMode ? { LEFT: -1 as THREE.MOUSE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: -1 as THREE.MOUSE } : undefined}
      touches={editMode ? { ONE: -1 as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE } : undefined}
    />
    <PerformanceProbe onFirstFrame={onFirstFrame} onStats={onStats} />
  </Canvas>;
}
