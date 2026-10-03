import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector3,
  type Scene,
} from "three";

const CAPACITY = 1500;

interface BurstOptions {
  count: number;
  color: Color | string;
  speed: number;
  /** Upward bias added to every particle's velocity. */
  lift?: number;
  gravity?: number;
  life: number;
  size: number;
  /** Cone direction; omit for a sphere. */
  direction?: Vector3;
  spread?: number;
  /** Random offset of the spawn positions. */
  jitter?: Vector3;
}

/** Pooled glowing point particles for sparks, impacts and dissolve motes. */
export class Particles {
  private readonly positions = new Float32Array(CAPACITY * 3);
  private readonly colors = new Float32Array(CAPACITY * 3);
  private readonly sizes = new Float32Array(CAPACITY);
  private readonly alphas = new Float32Array(CAPACITY);
  private readonly velocities = new Float32Array(CAPACITY * 3);
  private readonly life = new Float32Array(CAPACITY);
  private readonly maxLife = new Float32Array(CAPACITY);
  private readonly gravity = new Float32Array(CAPACITY);
  private readonly geometry = new BufferGeometry();
  private cursor = 0;
  private readonly tmpColor = new Color();
  private readonly tmpDir = new Vector3();

  constructor(scene: Scene) {
    this.geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new BufferAttribute(this.colors, 3));
    this.geometry.setAttribute("size", new BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute("alpha", new BufferAttribute(this.alphas, 1));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (600.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * a * vAlpha * 3.0, a * vAlpha);
        }`,
    });
    const points = new Points(this.geometry, material);
    points.frustumCulled = false;
    scene.add(points);
  }

  burst(origin: Vector3, options: BurstOptions) {
    this.tmpColor.set(options.color);
    for (let n = 0; n < options.count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % CAPACITY;
      const dir = this.tmpDir.randomDirection();
      if (options.direction) {
        dir.multiplyScalar(options.spread ?? 0.5).add(options.direction).normalize();
      }
      const speed = options.speed * (0.4 + Math.random() * 0.6);
      this.velocities[i * 3] = dir.x * speed;
      this.velocities[i * 3 + 1] = dir.y * speed + (options.lift ?? 0);
      this.velocities[i * 3 + 2] = dir.z * speed;
      const j = options.jitter;
      this.positions[i * 3] = origin.x + (j ? (Math.random() - 0.5) * j.x : 0);
      this.positions[i * 3 + 1] = origin.y + (j ? (Math.random() - 0.5) * j.y : 0);
      this.positions[i * 3 + 2] = origin.z + (j ? (Math.random() - 0.5) * j.z : 0);
      this.colors[i * 3] = this.tmpColor.r;
      this.colors[i * 3 + 1] = this.tmpColor.g;
      this.colors[i * 3 + 2] = this.tmpColor.b;
      this.sizes[i] = options.size * (0.6 + Math.random() * 0.8);
      this.maxLife[i] = this.life[i] = options.life * (0.6 + Math.random() * 0.4);
      this.gravity[i] = options.gravity ?? 0;
    }
  }

  update(dt: number) {
    for (let i = 0; i < CAPACITY; i++) {
      if (this.life[i]! <= 0) {
        this.alphas[i] = 0;
        continue;
      }
      this.life[i]! -= dt;
      this.velocities[i * 3 + 1]! -= this.gravity[i]! * dt;
      const drag = 1 - 2 * dt;
      this.velocities[i * 3]! *= drag;
      this.velocities[i * 3 + 2]! *= drag;
      this.positions[i * 3]! += this.velocities[i * 3]! * dt;
      this.positions[i * 3 + 1]! += this.velocities[i * 3 + 1]! * dt;
      this.positions[i * 3 + 2]! += this.velocities[i * 3 + 2]! * dt;
      this.alphas[i] = Math.max(0, this.life[i]! / this.maxLife[i]!);
    }
    for (const name of ["position", "alpha"] as const) this.geometry.getAttribute(name).needsUpdate = true;
    this.geometry.getAttribute("color").needsUpdate = true;
    this.geometry.getAttribute("size").needsUpdate = true;
  }
}
