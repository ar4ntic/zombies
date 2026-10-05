import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  CustomBlending,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  OneFactor,
  OneMinusSrcColorFactor,
  PlaneGeometry,
  Quaternion,
  Vector3,
  ZeroFactor,
  type Scene,
} from "three";

const CAPACITY = 96;
/** Seconds a burn mark stays, the last part of it fading. */
const LIFE = 22;
const FADE = 6;
/** Seconds the fresh mark keeps glowing in the bolt's color. */
const GLOW = 0.7;
const SURFACE_OFFSET = 0.012;
const FORWARD = new Vector3(0, 0, 1);

/** Soft-edged blotch, white where the surface is burnt most. */
function burnTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  const blot = (x: number, y: number, radius: number, strength: number) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(255,255,255,${strength})`);
    gradient.addColorStop(0.55, `rgba(255,255,255,${strength * 0.55})`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  };
  blot(size / 2, size / 2, size * 0.42, 0.9);
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2 + Math.random();
    const reach = size * (0.16 + Math.random() * 0.14);
    blot(size / 2 + Math.cos(angle) * reach, size / 2 + Math.sin(angle) * reach, size * (0.1 + Math.random() * 0.1), 0.5);
  }
  return new CanvasTexture(canvas);
}

interface Mark {
  age: number;
  color: Color;
}

/** Burn marks that laser bolts leave on the ground, walls and objects. */
export class Scorches {
  /** Darkens what is behind it by the texture times the instance color, so a mark fades by its color alone. */
  private readonly burns: InstancedMesh;
  private readonly glows: InstancedMesh;
  private readonly marks: Array<Mark | undefined> = new Array(CAPACITY).fill(undefined);
  private cursor = 0;
  private readonly matrix = new Matrix4();
  private readonly quat = new Quaternion();
  private readonly spin = new Quaternion();
  private readonly position = new Vector3();
  private readonly scale = new Vector3();
  private readonly tint = new Color();

  constructor(scene: Scene) {
    const geometry = new PlaneGeometry(1, 1);
    const map = burnTexture();
    const flat = { map, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false };
    this.burns = new InstancedMesh(
      geometry,
      new MeshBasicMaterial({
        ...flat,
        transparent: true,
        blending: CustomBlending,
        blendSrc: ZeroFactor,
        blendDst: OneMinusSrcColorFactor,
        // The frame's alpha has to stay as it is, or the marks punch holes into the picture.
        blendSrcAlpha: ZeroFactor,
        blendDstAlpha: OneFactor,
        fog: false,
      }),
      CAPACITY,
    );
    this.glows = new InstancedMesh(geometry, new MeshBasicMaterial({ ...flat, transparent: true, blending: AdditiveBlending, fog: false }), CAPACITY);
    const hidden = new Matrix4().makeScale(0, 0, 0);
    for (const mesh of [this.burns, this.glows]) {
      for (let i = 0; i < CAPACITY; i++) {
        mesh.setMatrixAt(i, hidden);
        mesh.setColorAt(i, this.tint.setScalar(0));
      }
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      scene.add(mesh);
    }
  }

  /** Leaves a mark of `size` meters at a point on a surface facing `normal`, glowing in `color` at first. */
  add(point: Vector3, normal: Vector3, color: string, size: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % CAPACITY;
    this.quat.setFromUnitVectors(FORWARD, normal).multiply(this.spin.setFromAxisAngle(FORWARD, Math.random() * Math.PI * 2));
    this.position.copy(point).addScaledVector(normal, SURFACE_OFFSET);
    this.matrix.compose(this.position, this.quat, this.scale.setScalar(size * (0.85 + Math.random() * 0.3)));
    this.burns.setMatrixAt(i, this.matrix);
    this.glows.setMatrixAt(i, this.matrix.compose(this.position, this.quat, this.scale.multiplyScalar(0.6)));
    this.burns.instanceMatrix.needsUpdate = true;
    this.glows.instanceMatrix.needsUpdate = true;
    this.marks[i] = { age: 0, color: new Color(color) };
  }

  clear() {
    for (let i = 0; i < CAPACITY; i++) {
      if (!this.marks[i]) continue;
      this.marks[i] = undefined;
      this.burns.setColorAt(i, this.tint.setScalar(0));
      this.glows.setColorAt(i, this.tint);
    }
    this.burns.instanceColor!.needsUpdate = true;
    this.glows.instanceColor!.needsUpdate = true;
  }

  update(dt: number) {
    let active = false;
    for (let i = 0; i < CAPACITY; i++) {
      const mark = this.marks[i];
      if (!mark) continue;
      active = true;
      mark.age += dt;
      const strength = Math.min(1, Math.max(0, (LIFE - mark.age) / FADE)) * 0.85;
      const glow = Math.max(0, 1 - mark.age / GLOW);
      this.burns.setColorAt(i, this.tint.setScalar(strength));
      this.glows.setColorAt(i, this.tint.copy(mark.color).multiplyScalar(glow * glow * 3));
      if (mark.age >= LIFE) this.marks[i] = undefined;
    }
    if (!active) return;
    this.burns.instanceColor!.needsUpdate = true;
    this.glows.instanceColor!.needsUpdate = true;
  }
}
