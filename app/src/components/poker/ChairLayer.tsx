"use client";

import { useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Clone, OrthographicCamera, useGLTF } from "@react-three/drei";
import * as THREE from "three";

/** Extra canvas above and below the stage, so tall chair backs at the far
 * rail are never clipped by the stage box. Symmetric, so the world's centre
 * — and with it every chair's anchor — does not move. */
const OVERSCAN = 0.22;

/**
 * The chairs, as an actual 3D model rendered live.
 *
 * One CC0 model — Poly Haven's GreenChair_01, green velvet on dark carved
 * wood — cloned once per seat and ROTATED to face the table's centre, so a
 * chair's direction is geometry rather than a guess baked into a picture.
 * The camera is orthographic and tilted the way the CSS table itself is
 * implicitly drawn: everything is seen from the same front-on angle, chairs
 * at the far rail show their fronts, chairs at the near rail their backs —
 * which is exactly what makes the hero's seat read as "you are sitting here".
 *
 * The canvas never animates: `frameloop="demand"` renders a handful of
 * frames while the model loads and then holds the picture, costing nothing.
 * It also never takes a pointer event — sitting is still the DOM's job.
 */

const MODEL = "/seats/chair/GreenChair_01_1k.gltf";

/** Camera elevation. Steeper looks more top-down, shallower more cinematic. */
const TILT = (36 * Math.PI) / 180;

export interface ChairSpot {
  /** Seat anchor percentages, same numbers the DOM pods anchor to. */
  x: number;
  y: number;
  /** Rotated ring slot: 0 is the hero seat, which renders larger. */
  anchor: number;
}

function Chairs({ spots, aspect, compact }: { spots: ChairSpot[]; aspect: number; compact: boolean }) {
  const { scene } = useGLTF(MODEL);

  // Sink the upholstery toward the room's own green. Applied once to the
  // source scene; every Clone shares the tinted materials.
  useMemo(() => {
    const tint = new THREE.Color(0.6, 0.78, 0.65);
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (std.color && !std.userData.tinted) {
          std.color.multiply(tint);
          std.userData.tinted = true;
        }
      }
    });
  }, [scene]);

  // The model is authored in metres standing on the origin. Everything below
  // is in "percent of table width" world units.
  const base = compact ? 18 : 16;

  const items = useMemo(
    () =>
      spots.map((s) => {
        const x = s.x - 50;
        // Screen percent → ground distance, undoing the camera tilt so a
        // chair's feet land exactly on its DOM anchor.
        const z = (s.y - 50) / (aspect * Math.sin(TILT));
        // Face the middle of the table.
        const yaw = Math.atan2(-x, -z);
        const scale = s.anchor === 0 ? base * 1.3 : base;
        return { x, z, yaw, scale, key: `${s.anchor}` };
      }),
    [spots, aspect, base],
  );

  return (
    <>
      {items.map((c) => (
        <group key={c.key} position={[c.x, 0, c.z]} rotation={[0, c.yaw, 0]}>
          <Clone object={scene} scale={c.scale} />
        </group>
      ))}
    </>
  );
}

/** Keeps one world unit equal to one percent of the stage's width. */
function FittedCamera() {
  const width = useThree((s) => s.size.width);
  const r = 120;
  return (
    <OrthographicCamera
      makeDefault
      manual
      zoom={width / 100}
      position={[0, r * Math.sin(TILT), r * Math.cos(TILT)]}
      rotation={[-TILT, 0, 0]}
      near={1}
      far={400}
    />
  );
}

export function ChairLayer({
  spots,
  aspect,
  compact = false,
}: {
  spots: ChairSpot[];
  /** Stage width over height, so vertical placement undoes the squash. */
  aspect: number;
  compact?: boolean;
}) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: `${-OVERSCAN * 100}% 0`,
        zIndex: 6,
        pointerEvents: "none",
      }}
    >
      <Canvas
        frameloop="demand"
        gl={{ alpha: true, antialias: true }}
        style={{ background: "transparent" }}
      >
        <FittedCamera />
        {/* The room's light: a little of it everywhere, most of it falling
            from above the middle of the table, a cool wash from behind the
            camera so near-rail chair backs keep their shape. */}
        <ambientLight intensity={0.38} />
        <directionalLight position={[0, 55, 35]} intensity={1.9} color="#fff6e8" />
        <directionalLight position={[0, 20, 90]} intensity={0.35} color="#bcd8cb" />
        <Chairs spots={spots} aspect={aspect} compact={compact} />
      </Canvas>
    </div>
  );
}

useGLTF.preload(MODEL);
