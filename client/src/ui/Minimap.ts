import { ZOMBIES, skinDef, type Box, type GameState, type ZombieType } from "@zombies/shared";

/** Edge length of the map in CSS pixels. */
const SIZE = 176;
/** Meters from the player to the rim of the map. */
const RANGE = 32;
const REDRAW_SECONDS = 1 / 20;
const ZOMBIE_COLOR = "#ffae3d";
const ENERGY_COLOR = "#ffc46b";
const HEALTH_COLOR = "#5dff7a";
const SELF_COLOR = "#ffffff";

export interface MinimapView {
  x: number;
  z: number;
  /** The player's view direction; it points up on the map. */
  yaw: number;
}

/**
 * Round bird's-eye map around the player, turned so that up is where the player looks. It shows the walls and
 * objects, the zombies, the teammates and the pickups; zombies further away than the map reaches sit on its rim.
 */
export class Minimap {
  readonly el = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private readonly pixels: number;
  private timer = 0;

  constructor(
    private readonly colliders: Box[],
    private readonly arenaHalfSize: number,
  ) {
    this.pixels = Math.min(2, window.devicePixelRatio || 1);
    this.el.className = "minimap";
    this.el.width = this.el.height = SIZE * this.pixels;
    this.el.setAttribute("aria-hidden", "true");
    this.ctx = this.el.getContext("2d")!;
  }

  update(dt: number, view: MinimapView, state: GameState, selfId: string) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = REDRAW_SECONDS;

    const { ctx } = this;
    const half = (SIZE * this.pixels) / 2;
    const radius = half - 2 * this.pixels;
    const scale = radius / RANGE;
    const cos = Math.cos(view.yaw);
    const sin = Math.sin(view.yaw);
    /** World position to map pixels, relative to the center. */
    const project = (x: number, z: number): [number, number] => {
      const dx = (x - view.x) * scale;
      const dz = (z - view.z) * scale;
      return [dx * cos - dz * sin, dx * sin + dz * cos];
    };

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, half * 2, half * 2);
    ctx.save();
    ctx.translate(half, half);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(10, 14, 12, 0.62)";
    ctx.fill();
    ctx.clip();

    // Ground of the arena and everything standing on it, drawn in world coordinates.
    ctx.save();
    ctx.transform(cos * scale, sin * scale, -sin * scale, cos * scale, 0, 0);
    ctx.translate(-view.x, -view.z);
    const size = this.arenaHalfSize * 2;
    ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
    ctx.fillRect(-this.arenaHalfSize, -this.arenaHalfSize, size, size);
    ctx.fillStyle = "rgba(255, 255, 255, 0.34)";
    for (const box of this.colliders) {
      ctx.save();
      ctx.translate(box.x, box.z);
      ctx.rotate(-box.rot);
      ctx.fillRect(-box.hx, -box.hz, box.hx * 2, box.hz * 2);
      ctx.restore();
    }
    ctx.restore();

    for (const pickup of state.pickups.values()) {
      const [x, y] = project(pickup.x, pickup.z);
      const r = 3 * this.pixels;
      ctx.fillStyle = pickup.kind === "health" ? HEALTH_COLOR : ENERGY_COLOR;
      if (pickup.kind === "health") {
        ctx.fillRect(x - r, y - r / 3, r * 2, (r * 2) / 3);
        ctx.fillRect(x - r / 3, y - r, (r * 2) / 3, r * 2);
      } else {
        ctx.fillRect(x - r * 0.55, y - r, r * 1.1, r * 2);
      }
    }

    ctx.fillStyle = ZOMBIE_COLOR;
    const rim = radius - 3 * this.pixels;
    for (const zombie of state.zombies.values()) {
      let [x, y] = project(zombie.x, zombie.z);
      const distance = Math.hypot(x, y);
      const beyond = distance > rim;
      if (beyond) {
        x *= rim / distance;
        y *= rim / distance;
      }
      const def = ZOMBIES[zombie.type as ZombieType];
      const r = (beyond ? 1.8 : 1.4 + (def?.radius ?? 0.4) * 4) * this.pixels;
      ctx.globalAlpha = beyond ? 0.7 : 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const [id, player] of state.players) {
      if (id === selfId) continue;
      const [x, y] = project(player.x, player.z);
      const distance = Math.hypot(x, y);
      const k = distance > rim ? rim / distance : 1;
      this.arrow(x * k, y * k, view.yaw - player.yaw, skinDef(player.skin).sleeve, player.dead);
    }
    this.arrow(0, 0, 0, SELF_COLOR, false);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(half, half, radius, 0, Math.PI * 2);
    ctx.lineWidth = 2 * this.pixels;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.stroke();
  }

  /** A player marker pointing where they look; knocked-out players are drawn hollow. */
  private arrow(x: number, y: number, turn: number, color: string, hollow: boolean) {
    const { ctx } = this;
    const r = 5.5 * this.pixels;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(turn);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.72, r * 0.8);
    ctx.lineTo(0, r * 0.38);
    ctx.lineTo(-r * 0.72, r * 0.8);
    ctx.closePath();
    ctx.lineWidth = 1.5 * this.pixels;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
    ctx.stroke();
    if (hollow) {
      ctx.strokeStyle = color;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.restore();
  }
}
