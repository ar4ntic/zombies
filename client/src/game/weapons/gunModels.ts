import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { WeaponId } from "@zombies/shared";

/** Materials of the first-person arms; one pair is shared by all weapons so a skin change recolors them at once. */
export interface ArmMaterials {
  sleeve: MeshStandardMaterial;
  glove: MeshStandardMaterial;
}

export function armMaterials(): ArmMaterials {
  return {
    sleeve: new MeshStandardMaterial({ color: "#4f6b3a", roughness: 0.85 }),
    glove: new MeshStandardMaterial({ color: "#3a2c1f", roughness: 0.6 }),
  };
}

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
  /** The supporting arm, which fetches the new capsule while reloading. Missing on weapons built without arms. */
  supportArm?: Group;
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

const UP = new Vector3(0, 1, 0);

/** Tapered tube from one point to another. */
function limb(group: Group, material: Material, from: Vector3, to: Vector3, fromRadius: number, toRadius: number) {
  const axis = to.clone().sub(from);
  const length = axis.length();
  const mesh = new Mesh(new CylinderGeometry(toRadius, fromRadius, length, 14), material);
  mesh.position.copy(from).addScaledVector(axis, 0.5);
  mesh.quaternion.copy(new Quaternion().setFromUnitVectors(UP, axis.divideScalar(length)));
  group.add(mesh);
}

const FINGERS = 4;

/**
 * A gloved hand at `hand` with a sleeved forearm running back to `elbow`, which lies outside the view.
 * `grip` is the size of the fist around whatever it holds and `tilt` its rotation about X; with `fingers`
 * they curl around the front of it.
 */
function arm(materials: ArmMaterials, hand: Vector3, elbow: Vector3, grip: Vector3, tilt: number, fingers: boolean): Group {
  const group = new Group();
  const fist = new Group();
  fist.position.copy(hand);
  fist.rotation.x = tilt;
  group.add(fist);
  part(fist, rbox(grip.x, grip.y, grip.z, Math.min(grip.x, grip.y, grip.z) * 0.35), materials.glove, 0, 0, 0);
  if (fingers) {
    const height = grip.y / FINGERS;
    const finger = rbox(grip.x * 1.12, height * 0.84, grip.z * 0.5, height * 0.3);
    for (let i = 0; i < FINGERS; i++) part(fist, finger, materials.glove, 0, grip.y / 2 - height * (i + 0.5), -grip.z * 0.34);
    part(fist, rbox(grip.x * 0.34, grip.y * 0.3, grip.z * 0.8, grip.x * 0.12), materials.glove, -grip.x * 0.55, grip.y * 0.34, -grip.z * 0.08);
  }
  const towardsElbow = elbow.clone().sub(hand).normalize();
  const wrist = hand.clone().addScaledVector(towardsElbow, grip.z * 0.4);
  const cuff = wrist.clone().addScaledVector(towardsElbow, 0.035);
  limb(group, materials.glove, wrist, cuff, 0.03, 0.033);
  limb(group, materials.sleeve, cuff, cuff.clone().addScaledVector(towardsElbow, 0.012), 0.043, 0.043);
  limb(group, materials.sleeve, cuff, elbow, 0.038, 0.052);
  return group;
}

function pistol(arms?: ArmMaterials): GunModel {
  const g = new Group();
  let supportArm: Group | undefined;
  if (arms) {
    g.add(arm(arms, new Vector3(0.004, -0.058, 0.026), new Vector3(0.3, -0.32, 0.36), new Vector3(0.05, 0.085, 0.07), 0.25, true));
    supportArm = arm(arms, new Vector3(-0.03, -0.078, 0.02), new Vector3(-0.36, -0.3, 0.3), new Vector3(0.05, 0.06, 0.075), 0.25, false);
    g.add(supportArm);
  }
  const color = "#3fffe8";
  const accent = glow(color, 1.4);
  part(g, rbox(0.034, 0.042, 0.2, 0.007), gunmetal, 0, 0.03, -0.06);
  part(g, rbox(0.03, 0.026, 0.17), polymer, 0, 0.002, -0.05);
  part(g, rbox(0.03, 0.105, 0.046, 0.008), polymer, 0, -0.055, 0.02, 0.25);
  part(g, rbox(0.01, 0.025, 0.035, 0.003), polymer, 0, -0.022, -0.035);
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
    ...capsule(g, color, 0.011, 0.05, 0, -0.112, 0.034, 0.25),
    color,
    supportArm,
  };
}

function rifle(arms?: ArmMaterials): GunModel {
  const g = new Group();
  let supportArm: Group | undefined;
  if (arms) {
    g.add(arm(arms, new Vector3(0.004, -0.075, 0.005), new Vector3(0.24, -0.34, 0.42), new Vector3(0.052, 0.085, 0.07), 0.3, true));
    supportArm = arm(arms, new Vector3(0, -0.038, -0.3), new Vector3(-0.36, -0.3, 0.2), new Vector3(0.066, 0.05, 0.09), 0, false);
    g.add(supportArm);
  }
  const color = "#ffa33d";
  const accent = glow(color, 1.6);
  part(g, rbox(0.05, 0.07, 0.32, 0.008), gunmetal, 0, 0, -0.08);
  part(g, rbox(0.042, 0.048, 0.22, 0.008), polymer, 0, 0.004, -0.33);
  part(g, barrel(0.009, 0.08), trim, 0, 0.004, -0.48);
  part(g, barrel(0.016, 0.03), gunmetal, 0, 0.004, -0.52);
  part(g, barrel(0.019, 0.01), glow(color, 2.4), 0, 0.004, -0.538);
  part(g, rbox(0.04, 0.065, 0.16, 0.01), polymer, 0, -0.012, 0.15);
  part(g, rbox(0.032, 0.09, 0.04, 0.008), polymer, 0, -0.07, 0.0, 0.3);
  part(g, rbox(0.036, 0.03, 0.06, 0.006), gunmetal, 0, -0.04, -0.12);
  part(g, new BoxGeometry(0.024, 0.008, 0.22), trim, 0, 0.039, -0.08);
  part(g, new BoxGeometry(0.002, 0.01, 0.26), accent, 0.0255, 0.012, -0.1);
  part(g, new BoxGeometry(0.002, 0.01, 0.26), accent, -0.0255, 0.012, -0.1);
  part(g, new BoxGeometry(0.03, 0.012, 0.05), gunmetal, 0, 0.049, -0.05);
  part(g, new BoxGeometry(0.004, 0.03, 0.006), gunmetal, 0.016, 0.068, -0.05);
  part(g, new BoxGeometry(0.004, 0.03, 0.006), gunmetal, -0.016, 0.068, -0.05);
  part(g, new BoxGeometry(0.036, 0.004, 0.006), gunmetal, 0, 0.084, -0.05);
  part(g, new SphereGeometry(0.0018, 8, 6), glow("#ff3b3b", 10), 0, 0.07, -0.05);
  return {
    group: g,
    muzzle: new Vector3(0, 0.004, -0.54),
    hip: new Vector3(0.14, -0.15, -0.36),
    ads: new Vector3(0, -0.07, -0.24),
    ...capsule(g, color, 0.02, 0.1, 0, -0.1, -0.12, -0.15),
    color,
    supportArm,
  };
}

/** With `arms` the weapon comes with the hands holding it, as the player sees their own. */
export function buildGun(id: WeaponId, arms?: ArmMaterials): GunModel {
  const gun = id === "rifle" ? rifle(arms) : pistol(arms);
  gun.group.traverse((c) => {
    c.castShadow = false;
    c.receiveShadow = false;
  });
  return gun;
}
