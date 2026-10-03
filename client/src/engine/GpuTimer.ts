interface TimerQueryExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

const MAX_PENDING = 4;

/** GPU frame time via EXT_disjoint_timer_query_webgl2 (Chrome/Firefox on most desktops; not Safari). */
export class GpuTimer {
  /** Smoothed GPU milliseconds per frame, or -1 when unavailable. */
  ms = -1;
  readonly supported: boolean;
  private readonly ext: TimerQueryExt | null;
  private readonly pending: WebGLQuery[] = [];
  private readonly free: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerQueryExt | null;
    this.supported = !!this.ext;
  }

  begin() {
    if (!this.ext) return;
    this.poll();
    if (this.pending.length >= MAX_PENDING) return;
    this.active = this.free.pop() ?? this.gl.createQuery();
    if (this.active) this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.active);
  }

  end() {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  private poll() {
    const { gl, ext } = this;
    if (!ext) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length) {
      const query = this.pending[0]!;
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      this.free.push(query);
      if (disjoint) continue;
      const ms = (gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6;
      this.ms = this.ms < 0 ? ms : this.ms + (ms - this.ms) * 0.1;
    }
  }
}
