import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { WeaponId } from "@zombies/shared";
import type { GripPose, Solid } from "./Arms.ts";

export interface GunModel {
  group: Group;
  muzzle: Vector3;
  hip: Vector3;
  ads: Vector3;
  /** The energy capsule, which drops out and slides back in while reloading. */
  capsule: Group;
  capsuleRest: Vector3;
  /** Glows with the charge left in the capsule. */
  capsuleGlow: MeshStandardMaterial;
  /** Color of the bolt and the muzzle glow. */
  color: string;
  /** How the hands hold the weapon. A left one supports it and fetches the new capsule while reloading. */
  grips: { R: GripPose; L?: GripPose };
  /** The boxes the weapon is made of, which the fingers close around. */
  solids: Solid[];
}

const gunmetal = new MeshPhysicalMaterial({ color: "#2b2f36", metalness: 0.85, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.25 });
const polymer = new MeshStandardMaterial({ color: "#1a1b1e", metalness: 0.1, roughness: 0.65 });
const trim = new MeshStandardMaterial({ color: "#c7cbd2", metalness: 1, roughness: 0.22 });

function glow(color: string, intensity = 4): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: "#111", emissive: new Color(color), emissiveIntensity: intensity, roughness: 0.4 });
}

function part(group: Group, geometry: BufferGeometry, material: Material, x: number, y: number, z: number, rx = 0) {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.x = rx;
  group.add(mesh);
  return mesh;
}

const rbox = (w: number, h: number, d: number, r = 0.005) => new RoundedBoxGeometry(w, h, d, 3, r);
const barrel = (r: number, l: number) => new CylinderGeometry(r, r, l, 16).rotateX(Math.PI / 2);

function capsule(group: Group, color: string, radius: number, length: number, x: number, y: number, z: number, rx: number) {
  const holder = new Group();
  const glass = glow(color, 3);
  const cap = new CylinderGeometry(radius * 1.12, radius * 1.12, length * 0.14, 16);
  part(holder, new CylinderGeometry(radius, radius, length, 16), glass, 0, 0, 0);
  part(holder, cap, trim, 0, length * 0.5, 0);
  part(holder, cap, trim, 0, -length * 0.5, 0);
  holder.position.set(x, y, z);
  holder.rotation.x = rx;
  group.add(holder);
  return { capsule: holder, capsuleRest: holder.position.clone(), capsuleGlow: glass };
}

function pistol(): Omit<GunModel, "solids"> {
  const g = new Group();
  const color = "#3fffe8";
  const accent = glow(color, 1.4);
  part(g, rbox(0.034, 0.042, 0.2, 0.007), gunmetal, 0, 0.03, -0.06);
  part(g, rbox(0.03, 0.026, 0.17), polymer, 0, 0.002, -0.05);
  part(g, rbox(0.03, 0.105, 0.046, 0.008), polymer, 0, -0.055, 0.018, -0.22);
  // The trigger guard is a loop: the index finger reaches through it to the trigger.
  part(g, rbox(0.008, 0.028, 0.005, 0.002), polymer, 0, -0.0235, -0.064);
  part(g, rbox(0.008, 0.005, 0.058, 0.002), polymer, 0, -0.036, -0.038);
  part(g, rbox(0.004, 0.016, 0.004, 0.0015), trim, 0, -0.019, -0.03, 0.25);
  part(g, barrel(0.009, 0.035), trim, 0, 0.03, -0.17);
  part(g, barrel(0.013, 0.012), glow(color, 2.2), 0, 0.03, -0.184);
  part(g, new BoxGeometry(0.002, 0.008, 0.13), accent, 0.0175, 0.034, -0.07);
  part(g, new BoxGeometry(0.002, 0.008, 0.13), accent, -0.0175, 0.034, -0.07);
  part(g, barrel(0.011, 0.02), glow(color, 0.6), 0, 0.03, 0.045);
  part(g, new BoxGeometry(0.004, 0.009, 0.006), trim, 0, 0.055, -0.15);
  part(g, new BoxGeometry(0.014, 0.008, 0.006), trim, 0, 0.055, 0.02);
  part(g, new SphereGeometry(0.0016, 8, 6), glow("#7dff6a", 8), 0, 0.0605, -0.15);
  return {
    group: g,
    muzzle: new Vector3(0, 0.03, -0.19),
    hip: new Vector3(0.14, -0.13, -0.34),
    ads: new Vector3(0, -0.06, -0.26),
    ...capsule(g, color, 0.011, 0.05, 0, -0.116, 0.032, -0.22),
    color,
    grips: {
      // Held in one hand: a second one around the same grip only covers the first. The hand stands upright against
      // the right side, turned a little so that the wrist is behind the grip and the thumb can cross to the left side.
      R: {
        at: new Vector3(0.01, -0.0805, 0.028),
        palm: new Vector3(-0.989, 0, -0.149),
        knuckles: new Vector3(0, -1, 0),
        curl: [1.4, 1.6, 1.2],
        thumb: [0.8, 1.2],
      },
    },
  };
}

function rifle(): Omit<GunModel, "solids"> {
  const g = new Group();
  const color = "#ffa33d";
  const accent = glow(color, 1.6);
  part(g, rbox(0.05, 0.07, 0.32, 0.008), gunmetal, 0, 0, -0.08);
  part(g, rbox(0.042, 0.048, 0.22, 0.008), polymer, 0, 0.004, -0.33);
  part(g, barrel(0.009, 0.08), trim, 0, 0.004, -0.48);
  part(g, barrel(0.016, 0.03), gunmetal, 0, 0.004, -0.52);
  part(g, barrel(0.019, 0.01), glow(color, 2.4), 0, 0.004, -0.538);
  part(g, rbox(0.04, 0.065, 0.16, 0.01), polymer, 0, -0.012, 0.15);
  part(g, rbox(0.032, 0.112, 0.04, 0.008), polymer, 0, -0.08, 0.003, -0.3);
  part(g, rbox(0.036, 0.03, 0.06, 0.006), gunmetal, 0, -0.04, -0.12);
  part(g, new BoxGeometry(0.024, 0.008, 0.22), trim, 0, 0.039, -0.08);
  part(g, new BoxGeometry(0.002, 0.01, 0.26), accent, 0.0255, 0.012, -0.1);
  part(g, new BoxGeometry(0.002, 0.01, 0.26), accent, -0.0255, 0.012, -0.1);
  part(g, new BoxGeometry(0.03, 0.012, 0.05), gunmetal, 0, 0.049, -0.05);
  part(g, new BoxGeometry(0.004, 0.03, 0.006), gunmetal, 0.016, 0.068, -0.05);
  part(g, new BoxGeometry(0.004, 0.03, 0.006), gunmetal, -0.016, 0.068, -0.05);
  part(g, new BoxGeometry(0.036, 0.004, 0.006), gunmetal, 0, 0.084, -0.05);
  part(g, new SphereGeometry(0.0018, 8, 6), glow("#ff3b3b", 10), 0, 0.07, -0.05);
  // The trigger guard runs from the capsule's housing back to the grip.
  part(g, rbox(0.01, 0.005, 0.068, 0.002), polymer, 0, -0.058, -0.057);
  part(g, rbox(0.004, 0.016, 0.004, 0.0015), trim, 0, -0.043, -0.05, 0.25);
  return {
    group: g,
    muzzle: new Vector3(0, 0.004, -0.54),
    hip: new Vector3(0.14, -0.15, -0.36),
    ads: new Vector3(0, -0.07, -0.24),
    ...capsule(g, color, 0.02, 0.1, 0, -0.1, -0.12, -0.15),
    color,
    grips: {
      R: {
        at: new Vector3(0.011, -0.1027, 0.0142),
        palm: new Vector3(-0.989, 0, -0.149),
        knuckles: new Vector3(0, -1, 0),
        curl: [1.4, 1.6, 1.2],
        thumb: [0.8, 1.2],
      },
      // The supporting hand cups the fore-end from below: the fingers reach under it and up its right side, the
      // thumb lies against the left one. The wrist is bent so that the arm comes up from the lower left.
      L: {
        at: new Vector3(-0.012, -0.017, -0.31),
        palm: new Vector3(0, 1, 0),
        knuckles: new Vector3(0.5, 0, 0.87),
        curl: [1.3, 1.5, 1.2],
        thumb: [0.3, 0.6],
        forearm: new Vector3(0.5, 0.45, -0.74),
      },
    },
  };
}

export function buildGun(id: WeaponId): GunModel {
  const gun = id === "rifle" ? rifle() : pistol();
  const solids: Solid[] = [];
  gun.group.updateMatrixWorld(true);
  const toWeapon = gun.group.matrixWorld.clone().invert();
  gun.group.traverse((c) => {
    c.castShadow = false;
    c.receiveShadow = false;
    const mesh = c as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox();
    const { min, max } = mesh.geometry.boundingBox!;
    solids.push({ min, max, inverse: new Matrix4().multiplyMatrices(toWeapon, mesh.matrixWorld).invert() });
  });
  return { ...gun, solids };
}
