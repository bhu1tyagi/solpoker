"use client";

import { useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, OrthographicCamera, RoundedBox } from "@react-three/drei";
import * as THREE from "three";

/**
 * The chairs: a green Chesterfield club chair as an actual 3D model.
 *
 * No marketplace has a licence-clean tufted Chesterfield to download, so the
 * chair is modelled here out of primitives — the low rolled back and arms as
 * capsules, the deep seat, the walnut bun feet — with the diamond tufting
 * drawn once into a procedural bump map, buttons and seams and all. At table
 * scale that reads as the real thing, and it costs no accounts, no rigs and
 * no megabytes.
 *
 * Every seat gets the same chair, yaw-rotated to face the table's centre, so
 * a chair's direction is geometry: the far rail faces you, the near rail
 * shows its back, and the hero's seat at the bottom centre is the big one
 * seen from directly behind — you are sitting in it.
 *
 * The canvas renders on demand and never takes a pointer event.
 */

/** Camera elevation. Steeper looks more top-down, shallower more cinematic. */
const TILT = (36 * Math.PI) / 180;

/** Extra canvas above and below the stage, so tall chair backs at the far
 * rail are never clipped by the stage box. Symmetric, so the world's centre
 * — and with it every chair's anchor — does not move. */
const OVERSCAN = 0.22;

const LEATHER = "#33523c";
const LEATHER_DEEP = "#2c4a35";
const WOOD = "#2e1d13";

/**
 * The tufting, drawn once: a diamond grid of seams with a button at every
 * crossing, used as a bump map so the light does the upholstery work.
 */
function makeTuftBump(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  // Mid-grey = flat; darker = pressed seam; lighter = swell.
  ctx.fillStyle = "#8a8a8a";
  ctx.fillRect(0, 0, S, S);
  const step = S / 4;
  // Gentle swells inside each diamond.
  for (let y = 0; y <= S; y += step) {
    for (let x = 0; x <= S; x += step) {
      const g = ctx.createRadialGradient(
        x + step / 2, y + step / 2, 4,
        x + step / 2, y + step / 2, step * 0.62,
      );
      g.addColorStop(0, "#b4b4b4");
      g.addColorStop(1, "#8a8a8a");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, step, step);
    }
  }
  // Diagonal seams.
  ctx.strokeStyle = "#4a4a4a";
  ctx.lineWidth = 5;
  for (let k = -4; k <= 4; k++) {
    ctx.beginPath();
    ctx.moveTo(k * step - S, -8);
    ctx.lineTo(k * step + S, S + 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(k * step + S, -8);
    ctx.lineTo(k * step - S, S + 8);
    ctx.stroke();
  }
  // Buttons at the crossings.
  ctx.fillStyle = "#3a3a3a";
  for (let y = 0; y <= S; y += step) {
    for (let x = 0; x <= S; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.5, 1);
  return tex;
}

function useMaterials() {
  return useMemo(() => {
    const bump = makeTuftBump();
    const tufted = new THREE.MeshStandardMaterial({
      color: LEATHER,
      roughness: 0.55,
      bumpMap: bump,
      bumpScale: 2.4,
    });
    const smooth = new THREE.MeshStandardMaterial({
      color: LEATHER,
      roughness: 0.52,
    });
    const cushion = new THREE.MeshStandardMaterial({
      color: LEATHER_DEEP,
      roughness: 0.48,
    });
    const wood = new THREE.MeshStandardMaterial({
      color: WOOD,
      roughness: 0.45,
    });
    return { tufted, smooth, cushion, wood };
  }, []);
}

/**
 * The chair, one unit wide at the arms, facing +Z. Proportions taken off the
 * reference render: low back, arms nearly as high as the back, deep cushion.
 */
function Chesterfield({ scale }: { scale: number }) {
  const m = useMaterials();
  return (
    <group scale={scale}>
      {/* Bun feet. */}
      {[
        [-0.36, 0.3],
        [0.36, 0.3],
        [-0.36, -0.3],
        [0.36, -0.3],
      ].map(([x, z], i) => (
        <mesh key={i} material={m.wood} position={[x, 0.055, z]} scale={[1, 0.75, 1]}>
          <sphereGeometry args={[0.075, 16, 12]} />
        </mesh>
      ))}

      {/* The body: smooth leather box between the arms. */}
      <RoundedBox material={m.smooth} position={[0, 0.4, 0.02]} args={[0.72, 0.56, 0.82]} radius={0.07} smoothness={3} />

      {/* Seat cushion, deeper green, sitting proud between the arms. */}
      <RoundedBox material={m.cushion} position={[0, 0.7, 0.1]} args={[0.68, 0.16, 0.6]} radius={0.06} smoothness={3} />

      {/* Arms: fat rolled capsules riding OUTSIDE the body, the scroll on
          their front ends. */}
      {[-0.45, 0.45].map((x) => (
        <group key={x}>
          <mesh material={m.smooth} position={[x, 0.42, 0]}>
            <boxGeometry args={[0.24, 0.55, 0.78]} />
          </mesh>
          <mesh material={m.tufted} position={[x, 0.72, -0.02]} rotation={[Math.PI / 2, 0, 0]}>
            <capsuleGeometry args={[0.16, 0.52, 8, 20]} />
          </mesh>
          <mesh material={m.tufted} position={[x, 0.68, 0.36]}>
            <sphereGeometry args={[0.155, 18, 14]} />
          </mesh>
        </group>
      ))}

      {/* The low back: the tufted panel is the chair's face, with the rolled
          top edge meeting the arm rolls at the corners. */}
      <RoundedBox material={m.tufted} position={[0, 0.74, -0.34]} args={[1.06, 0.68, 0.24]} radius={0.08} smoothness={3} />
      <mesh material={m.tufted} position={[0, 1.06, -0.33]} rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[0.12, 0.8, 8, 20]} />
      </mesh>
    </group>
  );
}

export interface ChairSpot {
  /** Seat anchor percentages, same numbers the DOM pods anchor to. */
  x: number;
  y: number;
  /** Rotated ring slot: 0 is the hero seat, which renders larger. */
  anchor: number;
}

function Chairs({ spots, aspect, compact }: { spots: ChairSpot[]; aspect: number; compact: boolean }) {
  // World units are "percent of table width"; the chair is one unit wide.
  const base = compact ? 11.5 : 9.5;

  const items = useMemo(
    () =>
      spots.map((s) => {
        const x = s.x - 50;
        // Screen percent → ground distance, undoing the camera tilt so a
        // chair's feet land exactly on its DOM anchor.
        const z = (s.y - 50) / (aspect * Math.sin(TILT));
        // Face the middle of the table.
        const yaw = Math.atan2(-x, -z);
        const scale = s.anchor === 0 ? base * 1.28 : base;
        // Step every chair a little back from its anchor along its own
        // facing line, so it straddles the rail instead of climbing onto
        // the cloth.
        const len = Math.hypot(x, z) || 1;
        const back = 1.6;
        return {
          x: x + (x / len) * back,
          z: z + (z / len) * back,
          yaw,
          scale,
          key: `${s.anchor}`,
        };
      }),
    [spots, aspect, base],
  );

  return (
    <>
      {items.map((c) => (
        <group key={c.key} position={[c.x, 0, c.z]} rotation={[0, c.yaw, 0]}>
          <Chesterfield scale={c.scale} />
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
        {/* The room's light: a little of it everywhere, a warm key from over
            the table, a cool wash from behind the camera so near-rail chair
            backs keep their shape. */}
        <ambientLight intensity={0.36} />
        <directionalLight position={[0, 55, 35]} intensity={1.55} color="#fff3e2" />
        <directionalLight position={[0, 20, 90]} intensity={0.35} color="#bcd8cb" />
        <Chairs spots={spots} aspect={aspect} compact={compact} />
        {/* The pool of shadow under each chair is what glues it to the
            room: without it every chair floats. Rendered once — the scene
            never moves. */}
        <ContactShadows
          position={[0, 0.01, 0]}
          opacity={0.6}
          scale={[180, 130]}
          blur={2.6}
          far={16}
          resolution={512}
          frames={1}
          color="#000000"
        />
      </Canvas>
    </div>
  );
}
