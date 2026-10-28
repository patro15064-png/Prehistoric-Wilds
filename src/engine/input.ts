/**
 * Unified input: keyboard + mouse (pointer lock) and gamepad feed one action state.
 * Gameplay reads `move`, `look` and `pressed()/held()/consume()`; it never checks raw keys.
 *
 * Call `endFrame()` once per rendered frame after gameplay consumed edge-triggered presses.
 */
export type Action =
  | 'light' | 'heavy' | 'dodge' | 'sprint' | 'interact' | 'lock' | 'heal'
  | 'satchel' | 'map' | 'help' | 'pause' | 'confirm'
  | 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'cycle'
  | 'gadget' | 'gadgetCycle' | 'journal' | 'skills'
export type InputMethod = 'keyboard' | 'gamepad'

const KEY_BINDINGS: Record<Action, string[]> = {
  light: ['KeyJ'],
  heavy: ['KeyK'],
  dodge: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  interact: ['KeyE'],
  lock: ['KeyQ'],
  heal: ['KeyR'],
  satchel: ['Tab', 'KeyI'],
  map: ['KeyM'],
  help: ['KeyH'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'NumpadEnter'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  slot4: ['Digit4'],
  cycle: ['KeyF'],
  gadget: ['KeyG'],
  gadgetCycle: ['KeyC'],
  journal: ['KeyB'],
  skills: ['KeyV'],
}
/** Mouse buttons: 0 left = light, 2 right = heavy (hold to charge), 1 middle = lock-on. */
const MOUSE_BINDINGS: Record<number, Action> = { 0: 'light', 2: 'heavy', 1: 'lock' }
const MOVE_KEYS = { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'] }
// Standard gamepad: A=0 dodge, B=1 interact, X=2 light, Y=3 heavy, LB=4 heal, RB=5 lock, L3=10 sprint, Back=8 satchel, Start=9 pause.
const PAD_BINDINGS: Partial<Record<Action, number[]>> = { dodge: [0], interact: [1], light: [2], heavy: [3, 7], heal: [4], lock: [5], sprint: [10, 6], satchel: [8], pause: [9], confirm: [0], cycle: [15, 14], gadget: [13], gadgetCycle: [12] }

export class Input {
  /** Movement intent in [-1, 1]: x = strafe right, y = forward. */
  readonly move = { x: 0, y: 0 }
  /** Camera look delta accumulated since the last `takeLook()`. */
  readonly look = { x: 0, y: 0 }
  method: InputMethod = 'keyboard'
  sensitivity = 1
  invertY = false
  /** When false (menus open), mouse buttons do not trigger attacks. */
  gameplayMouse = true
  private keys = new Set<string>()
  private mouse = new Set<number>()
  private held_ = new Set<Action>()
  private pressed_ = new Set<Action>()
  private padPrev = new Set<Action>()
  private listeners: Array<() => void> = []

  constructor(private readonly canvas: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.listeners.push(() => target.removeEventListener(type, fn as EventListener, opts))
    }
    on(window, 'keydown', e => {
      const typing = (e.target as HTMLElement | null)?.matches?.('input, textarea, select')
      if (typing) return
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
      if (e.repeat) return
      this.keys.add(e.code)
      this.method = 'keyboard'
      for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) {
        if (codes.includes(e.code)) this.pressed_.add(action)
      }
    })
    on(window, 'keyup', e => this.keys.delete(e.code))
    on(window, 'blur', () => {
      this.keys.clear()
      this.mouse.clear()
    })
    on(window, 'mousedown', e => {
      if (document.pointerLockElement !== canvas || !this.gameplayMouse) return
      this.mouse.add(e.button)
      const a = MOUSE_BINDINGS[e.button]
      if (a) this.pressed_.add(a)
      e.preventDefault()
    })
    on(window, 'mouseup', e => this.mouse.delete(e.button))
    on(window, 'contextmenu', e => {
      if (document.pointerLockElement === canvas) e.preventDefault()
    })
    on(window, 'mousemove', e => {
      if (document.pointerLockElement !== canvas) return
      this.look.x += e.movementX * 0.0022
      this.look.y += e.movementY * 0.0022
    })
  }

  /** Request pointer lock for mouse look (must be called from a user gesture). */
  lockPointer(): void {
    if (document.pointerLockElement !== this.canvas) {
      try {
        const p = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined
        p?.catch?.(() => undefined)
      } catch {
        /* pointer lock unavailable (e.g. headless) */
      }
    }
  }

  unlockPointer(): void {
    this.mouse.clear()
    if (document.pointerLockElement) document.exitPointerLock()
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas
  }

  /** Sample continuous sources. Call once per rendered frame before gameplay reads input. */
  update(): void {
    const k = (codes: string[]) => codes.some(code => this.keys.has(code))
    let x = (k(MOVE_KEYS.right) ? 1 : 0) - (k(MOVE_KEYS.left) ? 1 : 0)
    let y = (k(MOVE_KEYS.up) ? 1 : 0) - (k(MOVE_KEYS.down) ? 1 : 0)
    this.held_.clear()
    for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) {
      if (k(codes)) this.held_.add(action)
    }
    if (this.gameplayMouse) for (const b of this.mouse) if (MOUSE_BINDINGS[b]) this.held_.add(MOUSE_BINDINGS[b])
    const pad = navigator.getGamepads?.().find(p => p && p.connected)
    if (pad) {
      const dead = (v: number) => (Math.abs(v) < 0.18 ? 0 : v)
      const lx = dead(pad.axes[0] ?? 0)
      const ly = dead(pad.axes[1] ?? 0)
      const rx = dead(pad.axes[2] ?? 0)
      const ry = dead(pad.axes[3] ?? 0)
      if (lx !== 0 || ly !== 0 || rx !== 0 || ry !== 0 || pad.buttons.some(b => b.pressed)) this.method = 'gamepad'
      if (lx !== 0 || ly !== 0) {
        x = lx
        y = -ly
      }
      this.look.x += rx * 0.045
      this.look.y += ry * 0.045
      const now = new Set<Action>()
      for (const [action, buttons] of Object.entries(PAD_BINDINGS) as [Action, number[]][]) {
        if (buttons.some(i => pad.buttons[i]?.pressed)) now.add(action)
      }
      for (const action of now) {
        this.held_.add(action)
        if (!this.padPrev.has(action)) this.pressed_.add(action)
      }
      this.padPrev = now
    }
    const len = Math.hypot(x, y)
    this.move.x = len > 1 ? x / len : x
    this.move.y = len > 1 ? y / len : y
  }

  held(action: Action): boolean {
    return this.held_.has(action)
  }

  pressed(action: Action): boolean {
    return this.pressed_.has(action)
  }

  /** Read and clear a press (use inside fixed simulation steps). */
  consume(action: Action): boolean {
    return this.pressed_.delete(action)
  }

  /** Inject a press (tests, UI buttons). */
  press(action: Action): void {
    this.pressed_.add(action)
  }

  takeLook(): { x: number; y: number } {
    const out = { x: this.look.x * this.sensitivity, y: this.look.y * this.sensitivity * (this.invertY ? -1 : 1) }
    this.look.x = 0
    this.look.y = 0
    return out
  }

  endFrame(): void {
    this.pressed_.clear()
  }

  dispose(): void {
    for (const off of this.listeners) off()
    this.listeners = []
  }
}
