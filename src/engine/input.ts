import { GamepadBrand } from '../types';

export type GamepadButtonKey =
  | 'south'
  | 'east'
  | 'west'
  | 'north'
  | 'lb'
  | 'rb'
  | 'lt'
  | 'rt'
  | 'select'
  | 'start'
  | 'l3'
  | 'r3'
  | 'dpad_up'
  | 'dpad_down'
  | 'dpad_left'
  | 'dpad_right';

export type GamepadUIAction =
  | 'nav_up'
  | 'nav_down'
  | 'nav_left'
  | 'nav_right'
  | 'ui_confirm'
  | 'ui_cancel'
  | 'ui_west'
  | 'ui_north'
  | 'ui_lb'
  | 'ui_rb'
  | 'ui_select'
  | 'ui_start';

export interface GamepadGlyphSet {
  south: string;
  east: string;
  west: string;
  north: string;
  lb: string;
  rb: string;
  lt: string;
  rt: string;
  select: string;
  start: string;
  l3: string;
  r3: string;
}

export const GAMEPAD_UI_EVENT = 'ln-gamepad-ui';

export function getGamepadGlyphs(brand: GamepadBrand): GamepadGlyphSet {
  if (brand === 'playstation') {
    return {
      south: '✕',
      east: '○',
      west: '□',
      north: '△',
      lb: 'L1',
      rb: 'R1',
      lt: 'L2',
      rt: 'R2',
      select: 'Share',
      start: 'Options',
      l3: 'L3',
      r3: 'R3',
    };
  }
  if (brand === 'nintendo') {
    return {
      south: 'B',
      east: 'A',
      west: 'Y',
      north: 'X',
      lb: 'L',
      rb: 'R',
      lt: 'ZL',
      rt: 'ZR',
      select: '−',
      start: '+',
      l3: 'L3',
      r3: 'R3',
    };
  }
  return {
    south: 'A',
    east: 'B',
    west: 'X',
    north: 'Y',
    lb: 'LB',
    rb: 'RB',
    lt: 'LT',
    rt: 'RT',
    select: 'View',
    start: 'Menu',
    l3: 'L3',
    r3: 'R3',
  };
}

export function subscribeGamepadUI(
  handler: (action: GamepadUIAction) => void
): () => void {
  const listener = (e: Event) => {
    const ce = e as CustomEvent<{ action: GamepadUIAction }>;
    if (ce.detail?.action) {
      handler(ce.detail.action);
    }
  };
  window.addEventListener(GAMEPAD_UI_EVENT, listener);
  return () => window.removeEventListener(GAMEPAD_UI_EVENT, listener);
}

function detectGamepadInfo(rawId: string): {
  brand: GamepadBrand;
  friendlyName: string;
} {
  const lower = rawId.toLowerCase();
  if (
    lower.includes('dualsense') ||
    lower.includes('dualshock') ||
    lower.includes('playstation') ||
    lower.includes('054c')
  ) {
    return {
      brand: 'playstation',
      friendlyName: lower.includes('dualsense')
        ? 'DualSense Wireless Controller'
        : 'PlayStation Controller',
    };
  }
  if (
    lower.includes('nintendo') ||
    lower.includes('pro controller') ||
    lower.includes('joy-con') ||
    lower.includes('057e')
  ) {
    return {
      brand: 'nintendo',
      friendlyName: 'Switch Controller',
    };
  }
  if (lower.includes('xbox') || lower.includes('xinput') || lower.includes('045e')) {
    return {
      brand: 'xbox',
      friendlyName: 'Xbox Wireless Controller',
    };
  }
  if (lower.includes('steam')) {
    return {
      brand: 'xbox',
      friendlyName: 'Steam Controller',
    };
  }
  const trimmed = rawId.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  return {
    brand: 'xbox',
    friendlyName: trimmed ? trimmed.slice(0, 32) : 'Wireless Controller',
  };
}

function applyRadialDeadzone(
  rawX: number,
  rawY: number,
  deadzone: number
): { x: number; y: number; mag: number } {
  const rawMag = Math.hypot(rawX, rawY);
  if (rawMag <= deadzone) {
    return { x: 0, y: 0, mag: 0 };
  }
  const clampedMag = Math.min(1, (rawMag - deadzone) / (1 - deadzone));
  const scale = clampedMag / rawMag;
  return {
    x: rawX * scale,
    y: rawY * scale,
    mag: clampedMag,
  };
}

export class InputManager {
  private heldKeys = new Set<string>();
  private justPressedKeys = new Set<string>();
  public mouseScreenX = 0;
  public mouseScreenY = 0;
  public mouseDown = false;
  public mouseJustPressed = false;
  public hasMouseMoved = false;
  public isTouchDetected = false;

  // Mobile dual-joystick & button states
  public mobileMoveX = 0;
  public mobileMoveY = 0;
  public mobileAimX = 0;
  public mobileAimY = 0;
  public mobileAimActive = false;
  public mobileFireHeld = false;
  public mobileFireJustPressed = false;
  public mobileSprintToggled = false;
  public mobileCrouchToggled = false;

  // W3C Standard Gamepad / Controller states
  public isGamepadConnected = false;
  public isGamepadActive = false;
  public gamepadName = '';
  public gamepadBrand: GamepadBrand = 'xbox';
  private activeGamepadIndex: number | null = null;

  public gamepadMoveX = 0;
  public gamepadMoveY = 0;
  public gamepadAimX = 0;
  public gamepadAimY = 0;
  public gamepadAimActive = false;
  public gamepadAimMagnitude = 0;
  public gamepadFireHeld = false;
  public gamepadFireJustPressed = false;
  public gamepadSprintHeld = false;
  public gamepadSprintToggled = false;
  public gamepadCrouchToggled = false;

  private heldGamepadButtons = new Set<GamepadButtonKey>();
  private justPressedGamepadButtons = new Set<GamepadButtonKey>();
  private navHeldDir: 'up' | 'down' | 'left' | 'right' | null = null;
  private navRepeatTimer = 0;

  public onGamepadStatusChange?: (
    connected: boolean,
    active: boolean,
    name: string,
    brand: GamepadBrand,
    connectionChanged: boolean
  ) => void;

  private canvas: HTMLCanvasElement | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.isTouchDetected =
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        window.matchMedia?.('(pointer: coarse)').matches === true;
    }
  }

  public attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('touchstart', this.onFirstTouch, { passive: true });
    window.addEventListener('gamepadconnected', this.onGamepadConnected);
    window.addEventListener('gamepaddisconnected', this.onGamepadDisconnected);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  public detach() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('touchstart', this.onFirstTouch);
    window.removeEventListener('gamepadconnected', this.onGamepadConnected);
    window.removeEventListener('gamepaddisconnected', this.onGamepadDisconnected);
    if (this.canvas) {
      this.canvas.removeEventListener('mousemove', this.onMouseMove);
      this.canvas.removeEventListener('mousedown', this.onMouseDown);
      this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    }
    window.removeEventListener('mouseup', this.onMouseUp);
  }

  private onGamepadConnected = (e: GamepadEvent) => {
    const gp = e.gamepad;
    if (!gp) return;
    this.activeGamepadIndex = gp.index;
    const info = detectGamepadInfo(gp.id);
    const wasConnected = this.isGamepadConnected;
    this.isGamepadConnected = true;
    this.isGamepadActive = true;
    this.gamepadName = info.friendlyName;
    this.gamepadBrand = info.brand;
    this.onGamepadStatusChange?.(
      true,
      true,
      this.gamepadName,
      this.gamepadBrand,
      !wasConnected
    );
  };

  private onGamepadDisconnected = (e: GamepadEvent) => {
    if (this.activeGamepadIndex === e.gamepad?.index) {
      this.activeGamepadIndex = null;
    }
    const pads = this.getConnectedGamepads();
    if (pads.length === 0) {
      const prevName = this.gamepadName || 'Controller';
      this.isGamepadConnected = false;
      this.isGamepadActive = false;
      this.resetGamepadRuntimeInputs();
      this.onGamepadStatusChange?.(false, false, prevName, this.gamepadBrand, true);
    } else {
      const next = pads[0];
      this.activeGamepadIndex = next.index;
      const info = detectGamepadInfo(next.id);
      this.gamepadName = info.friendlyName;
      this.gamepadBrand = info.brand;
      this.onGamepadStatusChange?.(
        true,
        this.isGamepadActive,
        this.gamepadName,
        this.gamepadBrand,
        false
      );
    }
  };

  private getConnectedGamepads(): Gamepad[] {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
    try {
      const raw = navigator.getGamepads();
      const list: Gamepad[] = [];
      for (let i = 0; i < raw.length; i++) {
        const gp = raw[i];
        if (gp && gp.connected) {
          list.push(gp);
        }
      }
      return list;
    } catch {
      return [];
    }
  }

  private resetGamepadRuntimeInputs() {
    this.gamepadMoveX = 0;
    this.gamepadMoveY = 0;
    this.gamepadAimX = 0;
    this.gamepadAimY = 0;
    this.gamepadAimActive = false;
    this.gamepadAimMagnitude = 0;
    this.gamepadFireHeld = false;
    this.gamepadFireJustPressed = false;
    this.gamepadSprintHeld = false;
    this.gamepadSprintToggled = false;
    this.heldGamepadButtons.clear();
    this.justPressedGamepadButtons.clear();
    this.navHeldDir = null;
    this.navRepeatTimer = 0;
  }

  private markNonGamepadInputActive() {
    if (this.isGamepadActive) {
      this.isGamepadActive = false;
      this.onGamepadStatusChange?.(
        this.isGamepadConnected,
        false,
        this.gamepadName,
        this.gamepadBrand,
        false
      );
    }
  }

  private onFirstTouch = () => {
    this.isTouchDetected = true;
    this.hasMouseMoved = false;
    this.markNonGamepadInputActive();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const code = e.code;
    if (
      code === 'Tab' ||
      code === 'Space' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    ) {
      if (code === 'Tab') e.preventDefault();
    }
    this.markNonGamepadInputActive();
    if (!this.heldKeys.has(code)) {
      this.justPressedKeys.add(code);
    }
    this.heldKeys.add(code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.heldKeys.delete(e.code);
  };

  private onBlur = () => {
    this.heldKeys.clear();
    this.justPressedKeys.clear();
    this.mouseDown = false;
    this.mouseJustPressed = false;
    this.mobileMoveX = 0;
    this.mobileMoveY = 0;
    this.mobileAimActive = false;
    this.mobileFireHeld = false;
    this.resetGamepadRuntimeInputs();
  };

  private onMouseMove = (e: MouseEvent) => {
    if (this.isTouchDetected) return;
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const nx = e.clientX - rect.left;
    const ny = e.clientY - rect.top;
    if (Math.hypot(nx - this.mouseScreenX, ny - this.mouseScreenY) >= 3) {
      this.markNonGamepadInputActive();
      this.hasMouseMoved = true;
    }
    this.mouseScreenX = nx;
    this.mouseScreenY = ny;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (this.isTouchDetected) return;
    if (e.button === 0) {
      this.markNonGamepadInputActive();
      this.mouseDown = true;
      this.mouseJustPressed = true;
      this.hasMouseMoved = true;
      if (this.canvas) {
        const rect = this.canvas.getBoundingClientRect();
        this.mouseScreenX = e.clientX - rect.left;
        this.mouseScreenY = e.clientY - rect.top;
      }
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) {
      this.mouseDown = false;
    }
  };

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

  private emitUIAction(action: GamepadUIAction) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent(GAMEPAD_UI_EVENT, {
        detail: { action },
      })
    );
  }

  public pollGamepad(dt: number) {
    const pads = this.getConnectedGamepads();
    if (pads.length === 0) {
      if (this.isGamepadConnected) {
        const prevName = this.gamepadName || 'Controller';
        this.isGamepadConnected = false;
        this.isGamepadActive = false;
        this.activeGamepadIndex = null;
        this.resetGamepadRuntimeInputs();
        this.onGamepadStatusChange?.(false, false, prevName, this.gamepadBrand, true);
      }
      return;
    }

    // Select active gamepad or detect which connected pad has input right now
    let selectedPad: Gamepad =
      pads.find((p) => p.index === this.activeGamepadIndex) ?? pads[0];

    for (const p of pads) {
      const anyInput =
        p.buttons.some((b) => b && (b.pressed || b.value > 0.35)) ||
        p.axes.some((ax) => Math.abs(ax) > 0.24);
      if (anyInput) {
        selectedPad = p;
        break;
      }
    }

    const wasConnected = this.isGamepadConnected;
    const prevActive = this.isGamepadActive;
    if (!wasConnected || this.activeGamepadIndex !== selectedPad.index) {
      this.activeGamepadIndex = selectedPad.index;
      const info = detectGamepadInfo(selectedPad.id);
      this.gamepadName = info.friendlyName;
      this.gamepadBrand = info.brand;
      this.isGamepadConnected = true;
    }

    const ax0 = selectedPad.axes[0] ?? 0;
    const ax1 = selectedPad.axes[1] ?? 0;
    const ax2 = selectedPad.axes[2] ?? 0;
    const ax3 = selectedPad.axes[3] ?? 0;

    const leftStick = applyRadialDeadzone(ax0, ax1, 0.16);
    const rightStick = applyRadialDeadzone(ax2, ax3, 0.18);

    const btnPressed = (idx: number, threshold = 0.5): boolean => {
      const b = selectedPad.buttons[idx];
      if (!b) return false;
      return Boolean(b.pressed || b.value >= threshold);
    };

    const buttonStates: Record<GamepadButtonKey, boolean> = {
      south: btnPressed(0),
      east: btnPressed(1),
      west: btnPressed(2),
      north: btnPressed(3),
      lb: btnPressed(4),
      rb: btnPressed(5),
      lt: btnPressed(6, 0.3),
      rt: btnPressed(7, 0.3),
      select: btnPressed(8),
      start: btnPressed(9),
      l3: btnPressed(10),
      r3: btnPressed(11),
      dpad_up: btnPressed(12),
      dpad_down: btnPressed(13),
      dpad_left: btnPressed(14),
      dpad_right: btnPressed(15),
    };

    const anyPadActivity =
      leftStick.mag > 0.05 ||
      rightStick.mag > 0.05 ||
      Object.values(buttonStates).some(Boolean);

    if (anyPadActivity && !this.isGamepadActive) {
      this.isGamepadActive = true;
    }

    if (!wasConnected || prevActive !== this.isGamepadActive) {
      this.onGamepadStatusChange?.(
        true,
        this.isGamepadActive,
        this.gamepadName,
        this.gamepadBrand,
        !wasConnected
      );
    }

    // Movement & Aim vectors
    this.gamepadMoveX = leftStick.x;
    this.gamepadMoveY = leftStick.y;

    if (leftStick.mag < 0.1) {
      this.gamepadSprintToggled = false;
    }

    if (rightStick.mag > 0.04) {
      this.gamepadAimX = rightStick.x / rightStick.mag;
      this.gamepadAimY = rightStick.y / rightStick.mag;
      this.gamepadAimMagnitude = rightStick.mag;
      this.gamepadAimActive = true;
    } else {
      this.gamepadAimActive = false;
      this.gamepadAimMagnitude = 0;
    }

    // Triggers (Fire = RT, Hold-Sprint = LT)
    if (buttonStates.rt && !this.gamepadFireHeld) {
      this.gamepadFireJustPressed = true;
    }
    this.gamepadFireHeld = buttonStates.rt;
    this.gamepadSprintHeld = buttonStates.lt;

    // Button rising edges & UI events
    const keys = Object.keys(buttonStates) as GamepadButtonKey[];
    for (const k of keys) {
      const down = buttonStates[k];
      const wasDown = this.heldGamepadButtons.has(k);
      if (down && !wasDown) {
        this.justPressedGamepadButtons.add(k);
        this.heldGamepadButtons.add(k);

        if (k === 'l3') {
          this.gamepadSprintToggled = !this.gamepadSprintToggled;
          if (this.gamepadSprintToggled) {
            this.gamepadCrouchToggled = false;
          }
        }

        // Dispatch semantic UI navigation actions for menus & modals
        switch (k) {
          case 'south':
            this.emitUIAction('ui_confirm');
            break;
          case 'east':
            this.emitUIAction('ui_cancel');
            break;
          case 'west':
            this.emitUIAction('ui_west');
            break;
          case 'north':
            this.emitUIAction('ui_north');
            break;
          case 'lb':
            this.emitUIAction('ui_lb');
            break;
          case 'rb':
            this.emitUIAction('ui_rb');
            break;
          case 'select':
            this.emitUIAction('ui_select');
            break;
          case 'start':
            this.emitUIAction('ui_start');
            break;
          default:
            break;
        }
      } else if (!down && wasDown) {
        this.heldGamepadButtons.delete(k);
      }
    }

    // Directional UI Navigation (D-Pad + Left Stick with tactile auto-repeat)
    let dirNow: 'up' | 'down' | 'left' | 'right' | null = null;
    if (buttonStates.dpad_up || leftStick.y < -0.54) {
      dirNow = 'up';
    } else if (buttonStates.dpad_down || leftStick.y > 0.54) {
      dirNow = 'down';
    } else if (buttonStates.dpad_left || leftStick.x < -0.54) {
      dirNow = 'left';
    } else if (buttonStates.dpad_right || leftStick.x > 0.54) {
      dirNow = 'right';
    }

    if (dirNow !== null) {
      if (this.navHeldDir !== dirNow) {
        this.navHeldDir = dirNow;
        this.navRepeatTimer = 0.32;
        this.emitUIAction(`nav_${dirNow}` as GamepadUIAction);
      } else {
        this.navRepeatTimer -= dt;
        if (this.navRepeatTimer <= 0) {
          this.navRepeatTimer = 0.135;
          this.emitUIAction(`nav_${dirNow}` as GamepadUIAction);
        }
      }
    } else {
      this.navHeldDir = null;
      this.navRepeatTimer = 0;
    }
  }

  public vibrate(
    durationMs: number,
    weakMagnitude: number,
    strongMagnitude: number,
    enabled = true
  ) {
    if (!enabled || !this.isGamepadActive) return;
    const pads = this.getConnectedGamepads();
    const gp = pads.find((p) => p.index === this.activeGamepadIndex) ?? pads[0];
    if (!gp) return;
    const actuator = (
      gp as Gamepad & {
        vibrationActuator?: {
          playEffect?: (
            type: string,
            params: {
              startDelay: number;
              duration: number;
              weakMagnitude: number;
              strongMagnitude: number;
            }
          ) => Promise<unknown>;
        };
      }
    ).vibrationActuator;

    if (actuator && typeof actuator.playEffect === 'function') {
      try {
        void actuator
          .playEffect('dual-rumble', {
            startDelay: 0,
            duration: Math.max(20, Math.min(800, Math.round(durationMs))),
            weakMagnitude: Math.max(0, Math.min(1, weakMagnitude)),
            strongMagnitude: Math.max(0, Math.min(1, strongMagnitude)),
          })
          .catch(() => {});
      } catch {
        // Ignore unsupported vibration implementations
      }
    }
  }

  public triggerVirtualKey(code: string) {
    this.justPressedKeys.add(code);
  }

  public isHeld(code: string): boolean {
    return this.heldKeys.has(code);
  }

  public consumeJustPressed(code: string): boolean {
    if (this.justPressedKeys.has(code)) {
      this.justPressedKeys.delete(code);
      return true;
    }
    return false;
  }

  public isGamepadButtonHeld(btn: GamepadButtonKey): boolean {
    return this.heldGamepadButtons.has(btn);
  }

  public consumeGamepadButton(btn: GamepadButtonKey): boolean {
    if (this.justPressedGamepadButtons.has(btn)) {
      this.justPressedGamepadButtons.delete(btn);
      return true;
    }
    return false;
  }

  public endFrame() {
    this.justPressedKeys.clear();
    this.justPressedGamepadButtons.clear();
    this.mouseJustPressed = false;
    this.mobileFireJustPressed = false;
    this.gamepadFireJustPressed = false;
  }

  public getMoveVector(): { x: number; y: number } {
    if (Math.hypot(this.gamepadMoveX, this.gamepadMoveY) > 0.04) {
      let dx = this.gamepadMoveX;
      let dy = this.gamepadMoveY;
      const mag = Math.hypot(dx, dy);
      if (mag > 1) {
        dx /= mag;
        dy /= mag;
      }
      return { x: dx, y: dy };
    }

    if (Math.hypot(this.mobileMoveX, this.mobileMoveY) > 0.08) {
      let dx = this.mobileMoveX;
      let dy = this.mobileMoveY;
      const mag = Math.hypot(dx, dy);
      if (mag > 1) {
        dx /= mag;
        dy /= mag;
      }
      return { x: dx, y: dy };
    }

    let dx = 0;
    let dy = 0;
    if (this.isHeld('KeyW') || this.isHeld('ArrowUp')) dy -= 1;
    if (this.isHeld('KeyS') || this.isHeld('ArrowDown')) dy += 1;
    if (this.isHeld('KeyA') || this.isHeld('ArrowLeft')) dx -= 1;
    if (this.isHeld('KeyD') || this.isHeld('ArrowRight')) dx += 1;

    const len = Math.hypot(dx, dy);
    if (len > 0) {
      dx /= len;
      dy /= len;
    }
    return { x: dx, y: dy };
  }
}
