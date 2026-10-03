import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from "three";

const POOL = 32;
const LIFE = 0.08;
const UP = new Vector3(0, 1, 0);

/** Short-lived glowing streaks from the muzzle to the impact point. */
export class Tracers {
  private readonly items: Array<{ mesh: Mesh; material: MeshBasicMaterial; life: number }> = [];
  private cursor = 0;
  private readonly dir = new Vector3();
  private readonly quat = new Quaternion();

  constructor(scene: Scene) {
    const geometry = new CylinderGeometry(1, 1, 1, 6, 1, true);
    geometry.translate(0, 0.5, 0);
    for (let i = 0; i < POOL; i++) {
      const material = new MeshBasicMaterial({
        color: new Color("#ffe6a8").multiplyScalar(4),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new Mesh(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.items.push({ mesh, material, life: 0 });
    }
  }

  spawn(from: Vector3, to: Vector3, color: string, width = 0.012) {
    const item = this.items[this.cursor]!;
    this.cursor = (this.cursor + 1) % POOL;
    this.dir.subVectors(to, from);
    const length = this.dir.length();
    if (length < 0.01) return;
    this.quat.setFromUnitVectors(UP, this.dir.divideScalar(length));
    item.mesh.position.copy(from);
    item.mesh.quaternion.copy(this.quat);
    item.mesh.scale.set(width, length, width);
    item.material.color.set(color).multiplyScalar(4);
    item.material.opacity = 1;
    item.mesh.visible = true;
    item.life = LIFE;
  }

  update(dt: number) {
    for (const item of this.items) {
      if (item.life <= 0) continue;
      item.life -= dt;
      item.material.opacity = Math.max(0, item.life / LIFE);
      if (item.life <= 0) item.mesh.visible = false;
    }
  }
}
