import {
  HalfFloatType,
  NoToneMapping,
  PCFShadowMap,
  SRGBColorSpace,
  WebGLRenderer,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderTarget,
} from "three";
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  FXAAEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  type Effect,
} from "postprocessing";
import { N8AOPostPass } from "n8ao";
import { AutoScaler } from "./AutoScaler.ts";
import { GpuTimer } from "./GpuTimer.ts";

export type Quality = "low" | "medium" | "high" | "ultra";
export type GraphicsSetting = Quality | "auto";
export const GRAPHICS_SETTINGS: GraphicsSetting[] = ["auto", "low", "medium", "high", "ultra"];

export function isGraphicsSetting(value: unknown): value is GraphicsSetting {
  return GRAPHICS_SETTINGS.includes(value as GraphicsSetting);
}

/** Settings the auto scaler may change at runtime without recompiling shaders. */
export interface DynamicEffects {
  ao: boolean;
  bloom: boolean;
  shadowMapSize: number;
}

export interface QualitySettings extends DynamicEffects {
  maxPixelRatio: number;
  /** Cap on rendered pixels, so Retina and 5K displays don't render 6-15 MP per frame. */
  maxMegapixels: number;
  shadows: boolean;
  aoFullRes: boolean;
  smaa: boolean;
  /** Real point lights on the street lamps; otherwise baked-looking light pools. */
  lampLights: boolean;
}

const QUALITY: Record<GraphicsSetting, QualitySettings> = {
  low: { maxPixelRatio: 0.75, maxMegapixels: 0.9, shadows: false, shadowMapSize: 1024, ao: false, aoFullRes: false, bloom: false, smaa: false, lampLights: false },
  medium: { maxPixelRatio: 1, maxMegapixels: 1.6, shadows: true, shadowMapSize: 1024, ao: false, aoFullRes: false, bloom: true, smaa: false, lampLights: false },
  high: { maxPixelRatio: 1.5, maxMegapixels: 2.6, shadows: true, shadowMapSize: 2048, ao: true, aoFullRes: false, bloom: true, smaa: false, lampLights: false },
  ultra: { maxPixelRatio: 2, maxMegapixels: 6, shadows: true, shadowMapSize: 4096, ao: true, aoFullRes: true, bloom: true, smaa: true, lampLights: true },
  auto: { maxPixelRatio: 2, maxMegapixels: 2.4, shadows: true, shadowMapSize: 2048, ao: true, aoFullRes: false, bloom: true, smaa: false, lampLights: false },
};

/** Bloom whose blur passes can be skipped without changing the merged shader. */
class ToggleBloom extends BloomEffect {
  active = true;

  override update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, deltaTime?: number) {
    if (this.active) super.update(renderer, inputBuffer, deltaTime);
  }
}

export interface FrameStats {
  calls: number;
  triangles: number;
}

export class Renderer {
  readonly webgl: WebGLRenderer;
  readonly gpuTimer: GpuTimer;
  readonly auto = new AutoScaler();
  readonly stats: FrameStats = { calls: 0, triangles: 0 };
  /** Called when shadow map size or lamp lights change, so the world can follow. */
  onWorldSettings?: (settings: QualitySettings) => void;
  setting: GraphicsSetting;
  private settings: QualitySettings;
  private effects: DynamicEffects;
  private readonly composer: EffectComposer;
  private readonly ao: N8AOPostPass;
  private readonly bloom: ToggleBloom;
  private effectPass?: EffectPass;
  private effectPassSmaa?: boolean;
  private pixelRatio = 1;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    setting: GraphicsSetting,
  ) {
    this.setting = setting;
    this.settings = QUALITY[setting];
    this.effects = { ...this.settings };

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
    this.webgl.info.autoReset = false;
    this.gpuTimer = new GpuTimer(this.webgl.getContext() as WebGL2RenderingContext);

    this.composer = new EffectComposer(this.webgl, { frameBufferType: HalfFloatType });
    this.composer.addPass(new RenderPass(scene, camera));

    this.ao = new N8AOPostPass(scene, camera);
    this.ao.configuration.aoRadius = 1.5;
    this.ao.configuration.distanceFalloff = 0.6;
    this.ao.configuration.intensity = 2.5;
    this.ao.configuration.gammaCorrection = false;
    this.composer.addPass(this.ao);

    this.bloom = new ToggleBloom({
      intensity: 1.1,
      luminanceThreshold: 0.9,
      luminanceSmoothing: 0.2,
      mipmapBlur: true,
      radius: 0.7,
      levels: 6,
    });

    this.auto.onChange = (level, scaleChanged) => {
      this.effects = { ao: level.ao, bloom: level.bloom, shadowMapSize: level.shadowMapSize };
      this.applyEffects();
      if (scaleChanged) this.resize();
    };

    this.applyQuality();
    window.addEventListener("resize", () => this.resize());
  }

  get quality(): QualitySettings {
    return { ...this.settings, ...this.effects };
  }

  get currentPixelRatio(): number {
    return this.pixelRatio;
  }

  setGraphics(setting: GraphicsSetting) {
    if (setting === this.setting) return;
    this.setting = setting;
    this.settings = QUALITY[setting];
    this.effects = { ...this.settings };
    this.applyQuality();
  }

  private applyQuality() {
    const s = this.settings;
    this.webgl.shadowMap.enabled = s.shadows;
    this.webgl.shadowMap.needsUpdate = true;
    this.ao.configuration.halfRes = !s.aoFullRes;
    this.ao.setQualityMode(s.aoFullRes ? "Medium" : "Low");
    if (this.effectPassSmaa !== s.smaa) this.buildEffectPass();
    if (this.setting === "auto") {
      this.auto.start();
      const { ao, bloom, shadowMapSize } = this.auto.current;
      this.effects = { ao, bloom, shadowMapSize };
    } else {
      this.auto.stop();
    }
    this.applyEffects();
    this.resize();
  }

  private applyEffects() {
    this.ao.enabled = this.effects.ao;
    this.bloom.active = this.effects.bloom;
    this.bloom.intensity = this.effects.bloom ? 1.1 : 0;
    this.onWorldSettings?.(this.quality);
  }

  /** Anti-aliasing, bloom, tone mapping and vignette share one full-screen pass. */
  private buildEffectPass() {
    if (this.effectPass) {
      this.composer.removePass(this.effectPass);
      this.effectPass.dispose();
    }
    this.effectPassSmaa = this.settings.smaa;
    const aa: Effect = this.settings.smaa ? new SMAAEffect({ preset: SMAAPreset.HIGH }) : new FXAAEffect();
    this.effectPass = new EffectPass(
      this.camera,
      aa,
      this.bloom,
      new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
      new VignetteEffect({ offset: 0.3, darkness: 0.55 }),
    );
    this.composer.addPass(this.effectPass);
  }

  private resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const s = this.settings;
    const pixelCap = Math.sqrt((s.maxMegapixels * 1e6) / (width * height));
    let ratio = Math.min(window.devicePixelRatio, s.maxPixelRatio, pixelCap);
    if (this.setting === "auto") ratio *= this.auto.scale;
    this.pixelRatio = Math.max(0.25, ratio);
    this.webgl.setPixelRatio(this.pixelRatio);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** @param interval milliseconds since the previous frame started */
  render(delta: number, interval: number, cpuMs: number) {
    if (this.setting === "auto") this.auto.update(interval, this.gpuTimer.ms, cpuMs);
    const info = this.webgl.info;
    info.reset();
    this.gpuTimer.begin();
    this.composer.render(delta);
    this.gpuTimer.end();
    this.stats.calls = info.render.calls;
    this.stats.triangles = info.render.triangles;
  }
}
