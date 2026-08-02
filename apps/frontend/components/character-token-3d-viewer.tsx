"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useState } from "react";
import * as THREE from "three";

type ViewerState = "loading" | "ready" | "error";

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    });
  });
}

function normalizeModel(object: THREE.Object3D, zUp: boolean) {
  if (zUp) object.rotateX(-Math.PI / 2);
  object.updateMatrixWorld(true);
  const initialBounds = new THREE.Box3().setFromObject(object);
  const initialSize = initialBounds.getSize(new THREE.Vector3());
  const largestDimension = Math.max(initialSize.x, initialSize.y, initialSize.z);
  if (!Number.isFinite(largestDimension) || largestDimension <= 0) {
    throw new Error("The model does not contain renderable geometry.");
  }

  const scale = 2.8 / largestDimension;
  object.scale.multiplyScalar(scale);
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  const center = bounds.getCenter(new THREE.Vector3());
  object.position.set(-center.x, -bounds.min.y, -center.z);
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
  return object;
}

async function loadModel(url: string): Promise<THREE.Object3D> {
  const extension = url.split("?")[0].split(".").at(-1)?.toLowerCase();
  if (extension === "glb" || extension === "gltf") {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const gltf = await new GLTFLoader().loadAsync(url);
    return normalizeModel(gltf.scene, false);
  }
  if (extension === "obj") {
    const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
    return normalizeModel(await new OBJLoader().loadAsync(url), true);
  }
  if (extension === "ply") {
    const { PLYLoader } = await import("three/examples/jsm/loaders/PLYLoader.js");
    const geometry = await new PLYLoader().loadAsync(url);
    geometry.computeVertexNormals();
    const hasVertexColors = Boolean(geometry.getAttribute("color"));
    return normalizeModel(new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: hasVertexColors ? "#ffffff" : "#b99a70",
        metalness: 0.02,
        roughness: 0.78,
        vertexColors: hasVertexColors,
      }),
    ), true);
  }
  if (extension === "stl") {
    const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
    const geometry = await new STLLoader().loadAsync(url);
    geometry.computeVertexNormals();
    return normalizeModel(new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: "#b99a70",
        metalness: 0.02,
        roughness: 0.78,
      }),
    ), true);
  }
  throw new Error("This model format is not supported.");
}

function ModelAsset({
  onStateChange,
  url,
}: {
  onStateChange: (state: ViewerState) => void;
  url: string;
}) {
  const [object, setObject] = useState<THREE.Object3D>();

  useEffect(() => {
    let active = true;
    let loaded: THREE.Object3D | undefined;
    onStateChange("loading");
    void loadModel(url)
      .then((model) => {
        loaded = model;
        if (!active) {
          disposeObject(model);
          return;
        }
        setObject(model);
        onStateChange("ready");
      })
      .catch(() => {
        if (active) onStateChange("error");
      });
    return () => {
      active = false;
      setObject(undefined);
      if (loaded) disposeObject(loaded);
    };
  }, [onStateChange, url]);

  return object ? <primitive object={object} /> : null;
}

export function CharacterToken3DViewer({ url }: { url: string }) {
  const [state, setState] = useState<ViewerState>("loading");

  return (
    <div
      aria-label="Interactive 3D character token preview"
      className="character-token-3d-canvas"
      role="region"
    >
      <Canvas
        camera={{ far: 100, fov: 38, near: 0.1, position: [4.2, 3.7, 4.2] }}
        dpr={[1, 1.5]}
        frameloop="demand"
        gl={{ antialias: true, powerPreference: "high-performance" }}
        shadows="basic"
      >
        <color attach="background" args={["#0b0910"]} />
        <hemisphereLight args={["#efe6ff", "#241a14", 1.6]} />
        <directionalLight castShadow intensity={2.4} position={[4, 7, 5]} />
        <ModelAsset onStateChange={setState} url={url} />
        <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[2.15, 64]} />
          <meshStandardMaterial color="#17121e" metalness={0} roughness={0.94} />
        </mesh>
        <gridHelper args={[5, 10, "#5b4829", "#2c2532"]} position={[0, 0.006, 0]} />
        <OrbitControls
          enableDamping={false}
          enablePan={false}
          enableZoom={false}
          makeDefault
          maxPolarAngle={Math.PI / 3}
          minPolarAngle={Math.PI / 3}
          target={[0, 1.15, 0]}
        />
      </Canvas>
      {state !== "ready" ? (
        <div className={`character-token-3d-status ${state}`} role="status">
          {state === "loading" ? "Loading 3D token…" : "This 3D token could not be rendered."}
        </div>
      ) : null}
      <span className="character-token-3d-hint">Drag to rotate around the model</span>
    </div>
  );
}
