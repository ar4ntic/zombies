import type { WeaponId } from "@zombies/shared";

/** Small synthesized sound set. */
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

  /** A laser bolt: two detuned tones sweeping down, with a short hiss on top. */
  shot(weapon: WeaponId, distanceGain = 1) {
    const rifle = weapon === "rifle";
    const duration = rifle ? 0.11 : 0.17;
    this.tone({ from: rifle ? 1500 : 2200, to: rifle ? 240 : 420, duration, gain: 0.26 * distanceGain, type: "sawtooth", lowpass: 5200 });
    this.tone({ from: rifle ? 760 : 1120, to: rifle ? 120 : 210, duration, gain: 0.2 * distanceGain, type: "square", lowpass: 2800 });
    this.noiseBurst({ duration: 0.05, filter: 7000, gain: 0.1 * distanceGain });
  }

  /** The trigger with no energy left. */
  empty() {
    this.tone({ from: 190, to: 130, duration: 0.09, gain: 0.16, type: "square", lowpass: 700 });
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

  /** The spent energy capsule powers down and drops out. */
  reload() {
    this.tone({ from: 720, to: 170, duration: 0.22, gain: 0.16, type: "triangle", lowpass: 2000 });
    this.tone({ from: 260, to: 220, duration: 0.05, gain: 0.14, type: "square", lowpass: 1400, delay: 0.24 });
  }

  /** The fresh capsule clicks in and charges up. */
  reloadDone() {
    this.tone({ from: 420, to: 380, duration: 0.05, gain: 0.15, type: "square", lowpass: 1500 });
    this.tone({ from: 240, to: 1100, duration: 0.22, gain: 0.14, type: "sine", delay: 0.04 });
  }

  pickup(health: boolean) {
    this.tone({ from: health ? 520 : 660, to: health ? 660 : 990, duration: 0.1, gain: 0.2, type: "sine" });
    this.tone({ from: health ? 780 : 990, to: health ? 1040 : 1480, duration: 0.14, gain: 0.2, type: "sine", delay: 0.09 });
  }

  countdownTick() {
    this.tone({ from: 700, to: 690, duration: 0.14, gain: 0.22, type: "sine" });
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

  private tone(o: { from: number; to: number; duration: number; gain: number; type: OscillatorType; lowpass?: number; delay?: number }) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + (o.delay ?? 0);
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
