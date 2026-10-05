import {
  Bone,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Matrix3,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  type BufferGeometry,
  type Mesh,
  type Object3D,
} from "three";

/** The legs by position: front or hind, left or right. */
export const LEGS = ["FL", "FR", "HL", "HR"] as const;
export type Leg = (typeof LEGS)[number];

/** Bones of a rigged animal by name: `body`, `head`, `tail`, and per leg `leg<Leg>` with its lower part `shin<Leg>`. */
export const BONE_NAMES = ["body", "head", "tail", ...LEGS.flatMap((leg) => [`leg${leg}`, `shin${leg}`])];

const smooth = MathUtils.smoothstep;

/** Where the parts of an animal are, found from its shape. It stands on y = 0 and faces +Z. */
interface Landmarks {
  height: number;
  length: number;
  /** Underside of the body; everything below belongs to the legs. */
  belly: number;
  knee: number;
  /** Z between the front and the hind legs. */
  legSplit: number;
  frontLegsEnd: number;
  hindLegsEnd: number;
  hips: Record<Leg, Vector3>;
  neck: Vector3;
  tailBase: Vector3;
}

function legOf(x: number, z: number, marks: Landmarks): Leg {
  return `${z > marks.legSplit ? "F" : "H"}${x > 0 ? "L" : "R"}` as Leg;
}

function findLandmarks(points: Float32Array): Landmarks {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const p = new Vector3();
  const each = (visit: (x: number, y: number, z: number) => void) => {
    for (let i = 0; i < points.length; i += 3) visit(points[i]!, points[i + 1]!, points[i + 2]!);
  };
  each((x, y, z) => {
    min.min(p.set(x, y, z));
    max.max(p);
  });
  const height = max.y;
  const length = max.z - min.z;
  const width = max.x - min.x;
  const middle = (min.z + max.z) / 2;

  // The lowest point of the trunk, in the column between the four legs.
  let belly = Infinity;
  each((x, y, z) => {
    if (Math.abs(x) < width * 0.12 && Math.abs(z - middle) < length * 0.12) belly = Math.min(belly, y);
  });
  belly = MathUtils.clamp(Number.isFinite(belly) ? belly : height * 0.4, height * 0.2, height * 0.6);

  // The feet form a front and a hind group along Z.
  let front = max.z;
  let hind = min.z;
  for (let pass = 0; pass < 8; pass++) {
    let frontSum = 0;
    let frontCount = 0;
    let hindSum = 0;
    let hindCount = 0;
    each((_x, y, z) => {
      if (y > belly * 0.6) return;
      if (Math.abs(z - front) < Math.abs(z - hind)) {
        frontSum += z;
        frontCount++;
      } else {
        hindSum += z;
        hindCount++;
      }
    });
    if (frontCount) front = frontSum / frontCount;
    if (hindCount) hind = hindSum / hindCount;
  }
  const marks: Landmarks = {
    height,
    length,
    belly,
    knee: belly * 0.5,
    legSplit: (front + hind) / 2,
    frontLegsEnd: -Infinity,
    hindLegsEnd: Infinity,
    hips: { FL: new Vector3(), FR: new Vector3(), HL: new Vector3(), HR: new Vector3() },
    neck: new Vector3(),
    tailBase: new Vector3(),
  };

  const counts: Record<Leg, number> = { FL: 0, FR: 0, HL: 0, HR: 0 };
  each((x, y, z) => {
    if (y > belly * 0.6) return;
    const leg = legOf(x, z, marks);
    marks.hips[leg].add(p.set(x, 0, z));
    counts[leg]++;
    if (Math.abs(z - front) < length * 0.12) marks.frontLegsEnd = Math.max(marks.frontLegsEnd, z);
    if (Math.abs(z - hind) < length * 0.12) marks.hindLegsEnd = Math.min(marks.hindLegsEnd, z);
  });
  for (const leg of LEGS) {
    const side = leg.endsWith("L") ? 1 : -1;
    if (counts[leg]) marks.hips[leg].divideScalar(counts[leg]);
    else marks.hips[leg].set(side * width * 0.2, 0, leg.startsWith("F") ? front : hind);
    marks.hips[leg].y = belly;
  }
  if (!Number.isFinite(marks.frontLegsEnd)) marks.frontLegsEnd = front;
  if (!Number.isFinite(marks.hindLegsEnd)) marks.hindLegsEnd = hind;

  const back = belly + (height - belly) * 0.45;
  marks.neck.set(0, back, marks.frontLegsEnd);
  marks.tailBase.set(0, back, marks.hindLegsEnd);
  return marks;
}

/** How much of a vertex belongs to each bone, in the order of `BONE_NAMES`. */
function weigh(x: number, y: number, z: number, marks: Landmarks, out: number[]) {
  out.fill(0);
  const { belly, length } = marks;
  const ahead = smooth(z, marks.neck.z, marks.neck.z + length * 0.14);
  const behind = smooth(-z, -marks.tailBase.z, -marks.tailBase.z + length * 0.14);
  // What hangs low in front of the front legs or behind the hind legs is head or tail, not leg.
  const leg = smooth(-y, -belly * 1.06, -belly * 0.82) * (1 - smooth(z, marks.frontLegsEnd + length * 0.03, marks.frontLegsEnd + length * 0.08)) * (1 - smooth(-z, -marks.hindLegsEnd + length * 0.03, -marks.hindLegsEnd + length * 0.08));
  const head = ahead * (1 - leg) * smooth(y, belly * 0.7, belly + (marks.height - belly) * 0.2);
  const tail = behind * (1 - leg);
  const shin = smooth(-y, -marks.knee * 1.25, -marks.knee * 0.75);

  const index = BONE_NAMES.indexOf(`leg${legOf(x, z, marks)}`);
  out[0] = Math.max(0, 1 - leg - head - tail);
  out[1] = head;
  out[2] = tail;
  out[index] = leg * (1 - shin);
  out[index + 1] = leg * shin;
}

/**
 * Turns a static animal model into a skinned one with a simple skeleton, so its legs, head and tail can move.
 * Generated animals come without bones; which vertex follows which bone is worked out from where it sits on
 * the body. The model must stand on the ground and face +Z. Returns a group holding the skinned meshes and the
 * bones named in `BONE_NAMES`.
 */
export function rigAnimal(model: Object3D): Group {
  model.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  model.traverse((child) => {
    if ((child as Mesh).isMesh) meshes.push(child as Mesh);
  });

  // Bake every mesh into the animal's own space with plain float positions; the files store them quantized.
  const v = new Vector3();
  const baked = meshes.map((mesh) => {
    const geometry: BufferGeometry = mesh.geometry.clone();
    const source = geometry.getAttribute("position");
    const positions = new Float32Array(source.count * 3);
    for (let i = 0; i < source.count; i++) v.fromBufferAttribute(source, i).applyMatrix4(mesh.matrixWorld).toArray(positions, i * 3);
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const normal = geometry.getAttribute("normal");
    if (normal) {
      const matrix = new Matrix3().getNormalMatrix(mesh.matrixWorld);
      const normals = new Float32Array(normal.count * 3);
      for (let i = 0; i < normal.count; i++) v.fromBufferAttribute(normal, i).applyMatrix3(matrix).normalize().toArray(normals, i * 3);
      geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    }
    geometry.deleteAttribute("tangent");
    return { mesh, geometry, positions };
  });

  const all = new Float32Array(baked.reduce((n, b) => n + b.positions.length, 0));
  let offset = 0;
  for (const { positions } of baked) {
    all.set(positions, offset);
    offset += positions.length;
  }
  const marks = findLandmarks(all);

  const bones = new Map<string, Bone>();
  const bone = (name: string, at: Vector3, parent?: Bone) => {
    const created = new Bone();
    created.name = name;
    created.position.copy(at);
    if (parent) {
      created.position.sub(parent.getWorldPosition(v));
      parent.add(created);
    }
    created.updateMatrixWorld(true);
    bones.set(name, created);
    return created;
  };
  const body = bone("body", new Vector3(0, marks.neck.y, marks.legSplit));
  bone("head", marks.neck, body);
  bone("tail", marks.tailBase, body);
  for (const leg of LEGS) {
    const hip = marks.hips[leg];
    const upper = bone(`leg${leg}`, hip, body);
    bone(`shin${leg}`, new Vector3(hip.x, marks.knee, hip.z), upper);
  }
  const skeleton = new Skeleton(BONE_NAMES.map((name) => bones.get(name)!));

  const rig = new Group();
  rig.add(body);
  const weights = new Array<number>(BONE_NAMES.length);
  for (const { mesh, geometry, positions } of baked) {
    const count = positions.length / 3;
    const skinIndex = new Uint16Array(count * 4);
    const skinWeight = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      weigh(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!, marks, weights);
      // The four strongest bones; no vertex is pulled by more.
      const order = weights.map((w, b) => [w, b] as const).sort((a, b) => b[0] - a[0]).slice(0, 4);
      const total = order.reduce((sum, [w]) => sum + w, 0) || 1;
      order.forEach(([w, b], slot) => {
        skinIndex[i * 4 + slot] = b;
        skinWeight[i * 4 + slot] = w / total;
      });
    }
    geometry.setAttribute("skinIndex", new Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute("skinWeight", new Float32BufferAttribute(skinWeight, 4));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const skinned = new SkinnedMesh(geometry, mesh.material);
    skinned.name = mesh.name;
    rig.add(skinned);
    skinned.bind(skeleton);
  }
  return rig;
}
