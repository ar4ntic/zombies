import { Color, Vector3, type Material, type MeshStandardMaterial } from "three";

export interface DissolveUniforms {
  uDissolve: { value: number };
  uFlash: { value: number };
  uOrigin: { value: Vector3 };
  uEdgeColor: { value: Color };
  uFlashColor: { value: Color };
}

const NOISE = /* glsl */ `
  uniform float uDissolve;
  uniform float uFlash;
  uniform vec3 uOrigin;
  uniform vec3 uEdgeColor;
  uniform vec3 uFlashColor;
  varying vec3 vDissolvePos;

  float dHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float dNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(dHash(i), dHash(i + vec3(1, 0, 0)), f.x), mix(dHash(i + vec3(0, 1, 0)), dHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(dHash(i + vec3(0, 0, 1)), dHash(i + vec3(1, 0, 1)), f.x), mix(dHash(i + vec3(0, 1, 1)), dHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
`;

/**
 * Adds a glowing dissolve-away effect and a hit flash to a standard material.
 * Each zombie needs its own material instance so the uniforms are per zombie.
 */
export function applyDissolve(material: MeshStandardMaterial): DissolveUniforms {
  const uniforms: DissolveUniforms = {
    uDissolve: { value: 0 },
    uFlash: { value: 0 },
    uOrigin: { value: new Vector3() },
    uEdgeColor: { value: new Color("#7dff6a") },
    uFlashColor: { value: new Color("#d8ffcf") },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vDissolvePos;")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvDissolvePos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${NOISE}`)
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
        if (uDissolve > 0.0) {
          vec3 local = vDissolvePos - uOrigin;
          float n = dNoise(local * 5.0) * 0.75 + clamp(local.y / 1.9, 0.0, 1.0) * 0.25;
          if (n < uDissolve) discard;
          float edge = 1.0 - smoothstep(uDissolve, uDissolve + 0.07, n);
          totalEmissiveRadiance += uEdgeColor * edge * 8.0;
        }
        totalEmissiveRadiance += uFlashColor * uFlash;`,
      );
  };
  material.customProgramCacheKey = () => "dissolve";
  return uniforms;
}

export function isStandardMaterial(material: Material): material is MeshStandardMaterial {
  return (material as MeshStandardMaterial).isMeshStandardMaterial === true;
}
