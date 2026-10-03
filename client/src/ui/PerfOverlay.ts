import type { Renderer } from "../engine/Renderer.ts";

const REFRESH_MS = 250;

function count(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(0)}k` : String(n);
}

/** Frame statistics, toggled with F3 (on by default with ?debug). */
export class PerfOverlay {
  readonly el = document.createElement("pre");
  private frameMs = 16.7;
  private cpuMs = 0;
  private min = Infinity;
  private max = 0;
  private frames = 0;
  private elapsed = 0;
  private fps = 0;
  private lastText = 0;
  private windowMin = 0;
  private windowMax = 0;

  constructor(
    root: HTMLElement,
    private readonly renderer: Renderer,
    visible: boolean,
  ) {
    this.el.className = "perf-overlay";
    this.el.hidden = !visible;
    root.append(this.el);
    window.addEventListener("keydown", (e) => {
      if (e.code !== "F3") return;
      e.preventDefault();
      this.el.hidden = !this.el.hidden;
    });
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  /** @param interval ms since the previous frame; @param cpuMs JavaScript time of the previous frame */
  update(interval: number, cpuMs: number) {
    if (interval <= 0 || interval > 1000) return;
    this.frameMs += (interval - this.frameMs) * 0.05;
    this.cpuMs += (cpuMs - this.cpuMs) * 0.05;
    this.min = Math.min(this.min, interval);
    this.max = Math.max(this.max, interval);
    this.frames++;
    this.elapsed += interval;
    if (this.elapsed >= 1000) {
      this.fps = (this.frames * 1000) / this.elapsed;
      this.windowMin = this.min;
      this.windowMax = this.max;
      this.frames = 0;
      this.elapsed = 0;
      this.min = Infinity;
      this.max = 0;
    }
    const now = performance.now();
    if (this.el.hidden || now - this.lastText < REFRESH_MS) return;
    this.lastText = now;
    this.el.textContent = this.text();
  }

  private text(): string {
    const r = this.renderer;
    const gl = r.webgl;
    const ctx = gl.getContext();
    const w = ctx.drawingBufferWidth;
    const h = ctx.drawingBufferHeight;
    const q = r.quality;
    const gpu = r.gpuTimer.supported ? (r.gpuTimer.ms >= 0 ? `${r.gpuTimer.ms.toFixed(1)} ms` : "...") : "n/a";
    const auto = r.setting === "auto" ? ` · level ${r.auto.level + 1}/${r.auto.levels} · ${r.auto.refreshHz} Hz → ${r.auto.targetFps} fps` : "";
    const effects = [
      q.ao ? (q.aoFullRes ? "AO" : "AO ½") : "",
      q.bloom ? "bloom" : "",
      q.shadows ? `shadows ${q.shadowMapSize}` : "no shadows",
      q.smaa ? "SMAA" : "FXAA",
      q.lampLights ? "lamp lights" : "",
    ].filter(Boolean);
    return [
      `${this.fps.toFixed(0)} fps  ${this.frameMs.toFixed(1)} ms (min ${this.windowMin.toFixed(1)} / max ${this.windowMax.toFixed(1)})`,
      `CPU ${this.cpuMs.toFixed(1)} ms  GPU ${gpu}`,
      `${w}×${h} (${((w * h) / 1e6).toFixed(2)} MP) · pixel ratio ${r.currentPixelRatio.toFixed(2)} of ${devicePixelRatio}`,
      `${r.setting}${auto}`,
      effects.join(" · "),
      `draw calls ${r.stats.calls} · triangles ${count(r.stats.triangles)}`,
      `geometries ${gl.info.memory.geometries} · textures ${gl.info.memory.textures} · programs ${gl.info.programs?.length ?? 0}`,
    ].join("\n");
  }
}
