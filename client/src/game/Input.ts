export type Action =
  | "forward"
  | "back"
  | "left"
  | "right"
  | "sprint"
  | "jump"
  | "crouch"
  | "reload"
  | "interact"
  | "weapon1"
  | "weapon2"
  | "fire"
  | "aim";

const DEFAULT_BINDINGS: Record<string, Action> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  ShiftLeft: "sprint",
  ShiftRight: "sprint",
  Space: "jump",
  KeyC: "crouch",
  KeyR: "reload",
  KeyE: "interact",
  Digit1: "weapon1",
  Digit2: "weapon2",
  Mouse0: "fire",
  Mouse2: "aim",
};

const MAX_MOUSE_JUMP = 400;

export class Input {
  private readonly held = new Set<string>();
  private readonly justPressed = new Set<Action>();
  private readonly bindings = { ...DEFAULT_BINDINGS };
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener("keydown", (e) => {
      if (!this.locked) return;
      if (e.code in this.bindings) e.preventDefault();
      if (!e.repeat) this.press(e.code);
    });
    window.addEventListener("keyup", (e) => this.held.delete(e.code));
    window.addEventListener("blur", () => this.held.clear());
    document.addEventListener("mousedown", (e) => {
      if (this.locked) this.press(`Mouse${e.button}`);
    });
    document.addEventListener("mouseup", (e) => this.held.delete(`Mouse${e.button}`));
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener(
      "wheel",
      (e) => {
        if (this.locked) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      // Some browsers report a bogus jump on the first event after locking.
      if (Math.abs(e.movementX) > MAX_MOUSE_JUMP || Math.abs(e.movementY) > MAX_MOUSE_JUMP) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener("pointerlockchange", () => {
      this.held.clear();
      this.justPressed.clear();
      this.consumeMouse();
    });
  }

  private press(code: string) {
    this.held.add(code);
    const action = this.bindings[code];
    if (action) this.justPressed.add(action);
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  /** Resolves to whether the pointer ended up locked. */
  lock(): Promise<boolean> {
    return this.target
      .requestPointerLock({ unadjustedMovement: true })
      .catch(() => this.target.requestPointerLock())
      .then(
        () => this.locked,
        () => false,
      );
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  isDown(action: Action): boolean {
    for (const code of this.held) {
      if (this.bindings[code] === action) return true;
    }
    return false;
  }

  /** True once per key press. */
  pressed(action: Action): boolean {
    return this.justPressed.has(action);
  }

  /** Call at the end of each frame. */
  endFrame() {
    this.justPressed.clear();
  }

  /** Mouse movement since the last call, in pixels. */
  consumeMouse(): { dx: number; dy: number } {
    const delta = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return delta;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }
}
