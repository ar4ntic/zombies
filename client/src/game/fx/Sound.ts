import type { WeaponId } from "@zombies/shared";

/** Small synthesized sound set until recorded audio arrives. */
export class Sound {
  private ctx?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  volume = 0.6;

  /** Must be called from a user gesture. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const length = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    void this.ctx.resume();
  }

  shot(weapon: WeaponId, distanceGain = 1) {
    const heavy = weapon === "rifle";
    this.noiseBurst({ duration: heavy ? 0.16 : 0.12, filter: heavy ? 1800 : 2600, gain: 0.55 * distanceGain });
    this.tone({ from: heavy ? 140 : 200, to: 50, duration: 0.12, gain: 0.5 * distanceGain, type: "sine" });
  }

  hit(head: boolean) {
    this.tone({ from: head ? 1500 : 900, to: head ? 1900 : 700, duration: 0.06, gain: head ? 0.3 : 0.18, type: "triangle" });
  }

  kill() {
    this.tone({ from: 600, to: 1400, duration: 0.18, gain: 0.18, type: "sine" });
    this.noiseBurst({ duration: 0.35, filter: 900, gain: 0.15 });
  }

  hurt() {
    this.tone({ from: 120, to: 60, duration: 0.2, gain: 0.5, type: "sawtooth", lowpass: 400 });
  }

  knockedOut() {
    this.tone({ from: 440, to: 110, duration: 0.9, gain: 0.35, type: "triangle", lowpass: 1200 });
  }

  reload() {
    this.tone({ from: 300, to: 260, duration: 0.05, gain: 0.15, type: "square", lowpass: 1500 });
    setTimeout(() => this.tone({ from: 420, to: 380, duration: 0.05, gain: 0.15, type: "square", lowpass: 1500 }), 140);
  }

  waveStart() {
    this.tone({ from: 220, to: 110, duration: 1.2, gain: 0.35, type: "sawtooth", lowpass: 600 });
  }

  private noiseBurst(o: { duration: number; filter: number; gain: number }) {
    if (!this.ctx || !this.master || !this.noise) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = o.filter;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(o.gain, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + o.duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 0.5, o.duration);
  }

  private tone(o: { from: number; to: number; duration: number; gain: number; type: OscillatorType; lowpass?: number }) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.from, t);
    osc.frequency.exponentialRampToValueAtTime(o.to, t + o.duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(o.gain, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + o.duration);
    let node: AudioNode = osc;
    if (o.lowpass) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = o.lowpass;
      node = osc.connect(filter);
    }
    node.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + o.duration);
  }
}
