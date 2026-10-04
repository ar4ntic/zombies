import { AdditiveBlending, CylinderGeometry, Mesh, MeshBasicMaterial, Quaternion, Vector3, type Scene } from "three";

const POOL = 48;
/** Meters per second. Fast enough to feel instant up close, slow enough to see the bolt travel across the lot. */
const SPEED = 90;
const UP = new Vector3(0, 1, 0);

interface Bolt {
  mesh: Mesh;
  material: MeshBasicMaterial;
  from: Vector3;
  dir: Vector3;
  distance: number;
  length: number;
  travelled: number;
  active: boolean;
  onArrive?: () => void;
}

/** Glowing laser bolts that fly from the muzzle to a point the shot has already hit. */
export class Bolts {
  private readonly items: Bolt[] = [];
  private cursor = 0;
  private readonly quat = new Quaternion();

  constructor(scene: Scene) {
    const geometry = new CylinderGeometry(1, 1, 1, 6, 1, false);
    geometry.translate(0, 0.5, 0);
    for (let i = 0; i < POOL; i++) {
      const material = new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false });
      const mesh = new Mesh(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.items.push({ mesh, material, from: new Vector3(), dir: new Vector3(), distance: 0, length: 0, travelled: 0, active: false });
    }
  }

  /** `onArrive` runs when the head of the bolt reaches `to`. */
  spawn(from: Vector3, to: Vector3, color: string, width: number, length: number, onArrive?: () => void) {
    const bolt = this.items[this.cursor]!;
    this.cursor = (this.cursor + 1) % POOL;
    if (bolt.active) bolt.onArrive?.();
    bolt.dir.subVectors(to, from);
    bolt.distance = bolt.dir.length();
    if (bolt.distance < 0.01) {
      bolt.active = false;
      bolt.mesh.visible = false;
      onArrive?.();
      return;
    }
    bolt.dir.divideScalar(bolt.distance);
    bolt.from.copy(from);
    bolt.length = length;
    bolt.travelled = length * 0.5;
    bolt.onArrive = onArrive;
    bolt.active = true;
    bolt.material.color.set(color).multiplyScalar(4);
    bolt.mesh.quaternion.copy(this.quat.setFromUnitVectors(UP, bolt.dir));
    bolt.mesh.scale.x = bolt.mesh.scale.z = width;
    bolt.mesh.visible = true;
    this.place(bolt);
  }

  update(dt: number) {
    for (const bolt of this.items) {
      if (!bolt.active) continue;
      bolt.travelled += SPEED * dt;
      if (bolt.onArrive && bolt.travelled >= bolt.distance) {
        bolt.onArrive();
        bolt.onArrive = undefined;
      }
      if (bolt.travelled - bolt.length >= bolt.distance) {
        bolt.active = false;
        bolt.mesh.visible = false;
      } else {
        this.place(bolt);
      }
    }
  }

  private place(bolt: Bolt) {
    const tail = Math.max(0, bolt.travelled - bolt.length);
    const head = Math.min(bolt.travelled, bolt.distance);
    bolt.mesh.position.copy(bolt.from).addScaledVector(bolt.dir, tail);
    bolt.mesh.scale.y = Math.max(0.001, head - tail);
  }
}
