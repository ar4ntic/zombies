import { MathUtils } from "three";
import { GRAPHICS_SETTINGS, isGraphicsSetting, type GraphicsSetting } from "../engine/Renderer.ts";
import { segmented, selectSegment } from "./segmented.ts";

const GRAPHICS_KEY = "zombies.graphics";
const SENSITIVITY_KEY = "zombies.sensitivity";

const GRAPHICS_LABELS: Record<GraphicsSetting, string> = { auto: "Auto", low: "Low", medium: "Medium", high: "High", ultra: "Ultra" };

/** Mouse sensitivity is a multiplier on the default look speed. */
const SENSITIVITY = { min: 0.2, max: 3, step: 0.1, default: 1 };

/** Trackpads send a burst of wheel events per gesture; only one sensitivity step is taken per interval. */
const WHEEL_STEP_MS = 60;

export interface SettingsTarget {
  readonly graphics: GraphicsSetting;
  setGraphics(setting: GraphicsSetting): void;
  readonly sensitivity: number;
  setSensitivity(scale: number): void;
  /** Lets the player look around with the pointer locked; `onEnd` runs when the pointer is released. */
  startLookTest(onEnd: () => void): void;
  stopLookTest(): void;
}

export function loadGraphics(): GraphicsSetting {
  const stored = localStorage.getItem(GRAPHICS_KEY);
  return isGraphicsSetting(stored) ? stored : "auto";
}

export function loadSensitivity(): number {
  const stored = Number(localStorage.getItem(SENSITIVITY_KEY));
  return stored ? MathUtils.clamp(stored, SENSITIVITY.min, SENSITIVITY.max) : SENSITIVITY.default;
}

function sensitivityLabel(scale: number): string {
  return `${scale.toFixed(1)}x`;
}

/** Device settings (graphics quality, mouse sensitivity) that apply live and are remembered per browser. */
export function settingsControls(target: SettingsTarget): HTMLElement {
  const el = document.createElement("div");
  el.className = "device-settings";
  el.innerHTML = `
    <div class="setting">
      <span class="setting-label">Graphics quality</span>
      ${segmented("graphics", GRAPHICS_SETTINGS.map((g) => [g, GRAPHICS_LABELS[g]]), target.graphics)}
    </div>
    <div class="setting">
      <span class="setting-label">Mouse sensitivity <output>${sensitivityLabel(target.sensitivity)}</output></span>
      <input type="range" name="sensitivity" aria-label="Mouse sensitivity" min="${SENSITIVITY.min}" max="${SENSITIVITY.max}" step="${SENSITIVITY.step}" value="${target.sensitivity}" />
      <div class="range-ends"><span>Slower</span><button type="button" data-action="resetSensitivity">Reset</button><span>Faster</span></div>
      <button type="button" data-action="testSensitivity">Try it out</button>
    </div>`;
  const slider = el.querySelector<HTMLInputElement>('input[name="sensitivity"]')!;
  const output = el.querySelector("output")!;

  const test = document.createElement("div");
  test.className = "look-test";
  test.innerHTML = `
    <i class="look-test-dot"></i>
    <div class="look-test-card">
      <strong>Mouse sensitivity <output></output></strong>
      <span>Move the mouse to look around</span>
      <span><kbd>Scroll</kbd> or <kbd>&uarr;</kbd> <kbd>&darr;</kbd> to adjust &middot; <kbd>Click</kbd> or <kbd>Esc</kbd> when it feels right</span>
    </div>`;
  const testOutput = test.querySelector("output")!;

  const setSensitivity = (value: number) => {
    const stepsPerUnit = Math.round(1 / SENSITIVITY.step);
    const scale = MathUtils.clamp(Math.round(value * stepsPerUnit) / stepsPerUnit, SENSITIVITY.min, SENSITIVITY.max);
    target.setSensitivity(scale);
    localStorage.setItem(SENSITIVITY_KEY, String(scale));
    slider.value = String(scale);
    output.textContent = testOutput.textContent = sensitivityLabel(scale);
  };
  slider.addEventListener("input", () => setSensitivity(slider.valueAsNumber));

  let lastWheelStep = 0;
  const onWheel = (event: WheelEvent) => {
    if (event.deltaY === 0 || event.timeStamp - lastWheelStep < WHEEL_STEP_MS) return;
    lastWheelStep = event.timeStamp;
    setSensitivity(target.sensitivity - Math.sign(event.deltaY) * SENSITIVITY.step);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.code === "ArrowUp") setSensitivity(target.sensitivity + SENSITIVITY.step);
    else if (event.code === "ArrowDown") setSensitivity(target.sensitivity - SENSITIVITY.step);
  };
  const onMouseDown = () => {
    if (document.pointerLockElement) target.stopLookTest();
  };
  const startTest = () => {
    testOutput.textContent = sensitivityLabel(target.sensitivity);
    document.body.append(test);
    document.body.classList.add("look-testing");
    document.addEventListener("wheel", onWheel, { passive: true });
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    target.startLookTest(() => {
      test.remove();
      document.body.classList.remove("look-testing");
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    });
  };

  el.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button) return;
    if (button.dataset.action === "resetSensitivity") return setSensitivity(SENSITIVITY.default);
    if (button.dataset.action === "testSensitivity") return startTest();
    const value = button.dataset.value;
    if (!isGraphicsSetting(value)) return;
    selectSegment(button.parentElement!, value);
    target.setGraphics(value);
    localStorage.setItem(GRAPHICS_KEY, value);
  });
  return el;
}
