import {
  HalfFloatType,
  NoToneMapping,
  PCFShadowMap,
  SRGBColorSpace,
  WebGLRenderer,
  type PerspectiveCamera,
  type Scene,
} from "three";
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from "postprocessing";
import { N8AOPostPass } from "n8ao";

export type Quality = "low" | "medium" | "high" | "ultra";

interface QualitySettings {
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  ambientOcclusion: boolean;
  bloom: boolean;
}

const QUALITY: Record<Quality, QualitySettings> = {
  low: { maxPixelRatio: 0.75, shadows: false, shadowMapSize: 1024, ambientOcclusion: false, bloom: false },
  medium: { maxPixelRatio: 1, shadows: true, shadowMapSize: 1024, ambientOcclusion: false, bloom: true },
  high: { maxPixelRatio: 1.5, shadows: true, shadowMapSize: 2048, ambientOcclusion: true, bloom: true },
  ultra: { maxPixelRatio: 2, shadows: true, shadowMapSize: 4096, ambientOcclusion: true, bloom: true },
};

export class Renderer {
  readonly webgl: WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly ao: N8AOPostPass;
  private readonly bloom: BloomEffect;
  private settings: QualitySettings;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    quality: Quality,
  ) {
    this.settings = QUALITY[quality];

    this.webgl = new WebGLRenderer({
      canvas,
      powerPreference: "high-performance",
      antialias: false,
      stencil: false,
      depth: false,
    });
    this.webgl.outputColorSpace = SRGBColorSpace;
    this.webgl.toneMapping = NoToneMapping;
    this.webgl.shadowMap.type = PCFShadowMap;

    this.composer = new EffectComposer(this.webgl, { frameBufferType: HalfFloatType });
    this.composer.addPass(new RenderPass(scene, camera));

    this.ao = new N8AOPostPass(scene, camera);
    this.ao.configuration.aoRadius = 1.5;
    this.ao.configuration.distanceFalloff = 0.6;
    this.ao.configuration.intensity = 2.5;
    this.ao.configuration.gammaCorrection = false;
    this.ao.setQualityMode("Medium");
    this.composer.addPass(this.ao);

    this.bloom = new BloomEffect({
      intensity: 1.1,
      luminanceThreshold: 0.9,
      luminanceSmoothing: 0.2,
      mipmapBlur: true,
      radius: 0.7,
    });
    this.composer.addPass(
      new EffectPass(
        camera,
        this.bloom,
        new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
        new VignetteEffect({ offset: 0.3, darkness: 0.55 }),
      ),
    );
    this.composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));

    this.applyQuality();
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  get shadowMapSize(): number {
    return this.settings.shadowMapSize;
  }

  setQuality(quality: Quality) {
    this.settings = QUALITY[quality];
    this.applyQuality();
    this.resize();
  }

  private applyQuality() {
    this.webgl.shadowMap.enabled = this.settings.shadows;
    this.webgl.shadowMap.needsUpdate = true;
    this.ao.enabled = this.settings.ambientOcclusion;
    this.bloom.blendMode.opacity.value = this.settings.bloom ? 1 : 0;
  }

  private resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, this.settings.maxPixelRatio));
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render(delta: number) {
    this.composer.render(delta);
  }
}
