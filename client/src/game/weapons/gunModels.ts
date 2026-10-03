import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
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

export interface GunModel {
  group: Group;
  muzzle: Vector3;
  hip: Vector3;
  ads: Vector3;
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

function pistol(): GunModel {
  const g = new Group();
  const accent = glow("#3fffe8", 1.4);
  part(g, rbox(0.034, 0.042, 0.2, 0.007), gunmetal, 0, 0.03, -0.06);
  part(g, rbox(0.03, 0.026, 0.17), polymer, 0, 0.002, -0.05);
  part(g, rbox(0.03, 0.105, 0.046, 0.008), polymer, 0, -0.055, 0.02, 0.25);
  part(g, rbox(0.01, 0.025, 0.035, 0.003), polymer, 0, -0.022, -0.035);
  part(g, barrel(0.009, 0.035), trim, 0, 0.03, -0.17);
  part(g, new BoxGeometry(0.002, 0.008, 0.13), accent, 0.0175, 0.034, -0.07);
  part(g, new BoxGeometry(0.002, 0.008, 0.13), accent, -0.0175, 0.034, -0.07);
  part(g, barrel(0.011, 0.02), glow("#3fffe8", 0.6), 0, 0.03, 0.045);
  part(g, new BoxGeometry(0.004, 0.009, 0.006), trim, 0, 0.055, -0.15);
  part(g, new BoxGeometry(0.014, 0.008, 0.006), trim, 0, 0.055, 0.02);
  part(g, new SphereGeometry(0.0016, 8, 6), glow("#7dff6a", 8), 0, 0.0605, -0.15);
  return {
    group: g,
    muzzle: new Vector3(0, 0.03, -0.19),
    hip: new Vector3(0.15, -0.15, -0.34),
    ads: new Vector3(0, -0.06, -0.26),
  };
}

function rifle(): GunModel {
  const g = new Group();
  const accent = glow("#ffa33d", 1.6);
  part(g, rbox(0.05, 0.07, 0.32, 0.008), gunmetal, 0, 0, -0.08);
  part(g, rbox(0.042, 0.048, 0.22, 0.008), polymer, 0, 0.004, -0.33);
  part(g, barrel(0.009, 0.08), trim, 0, 0.004, -0.48);
  part(g, barrel(0.016, 0.03), gunmetal, 0, 0.004, -0.52);
  part(g, rbox(0.04, 0.065, 0.16, 0.01), polymer, 0, -0.012, 0.15);
  part(g, rbox(0.032, 0.09, 0.04, 0.008), polymer, 0, -0.07, 0.0, 0.3);
  part(g, rbox(0.03, 0.11, 0.055, 0.006), gunmetal, 0, -0.085, -0.12, -0.15);
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
  };
}

export function buildGun(id: WeaponId): GunModel {
  const gun = id === "rifle" ? rifle() : pistol();
  gun.group.traverse((c) => {
    c.castShadow = false;
    c.receiveShadow = false;
  });
  return gun;
}
