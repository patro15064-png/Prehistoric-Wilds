// FIX: Full mobile touch support — Virtual Joystick, Multi-touch Action Buttons, Camera Touch-Look, Top Quick Bar, Fullscreen, and Device Rotation handling
import type { Input } from '../engine/input'
import type { Game } from '../game/game'
import type { SaveStore } from '../engine/save'
import { count } from '../game/rules'
import type { Ui } from './ui'

export type TouchActionsCallback = {
  openSatchel: () => void
  openJournal: () => void
  openMap: () => void
  openSkills: () => void
  pause: () => void
  resume: () => void
}

export class TouchControls {
  readonly root: HTMLElement
  private joyZone: HTMLElement
  private joyBase: HTMLElement
  private joyKnob: HTMLElement
  private lookZone: HTMLElement
  private actionsCluster: HTMLElement
  private topBar: HTMLElement
  private portraitPrompt: HTMLElement

  private joystickPointerId: number | null = null
  private joyBaseCenter = { x: 0, y: 0 }
  private readonly joyMaxRadius = 52
  private readonly joyDeadzone = 7

  private lookPointerId: number | null = null
  private lastLookPos = { x: 0, y: 0 }

  private activeButtons = new Map<number, string>()
  private sprintLocked = false
  private rotateDismissed = false
  private touchDetected = false

  constructor(
    private readonly input: Input,
    private readonly save: SaveStore,
    private readonly ui: Ui,
    private readonly actions: TouchActionsCallback
  ) {
    this.root = document.createElement('div')
    this.root.className = 'touch-layer'
    this.root.innerHTML = this.template()
    document.body.appendChild(this.root)

    this.joyZone = this.root.querySelector('.touch-joystick-zone')!
    this.joyBase = this.root.querySelector('.touch-joystick-base')!
    this.joyKnob = this.root.querySelector('.touch-joystick-knob')!
    this.lookZone = this.root.querySelector('.touch-look-zone')!
    this.actionsCluster = this.root.querySelector('.touch-actions-cluster')!
    this.topBar = this.root.querySelector('.touch-top-bar')!
    this.portraitPrompt = this.root.querySelector('.touch-portrait-prompt')!

    this.initDeviceDetection()
    this.initJoystick()
    this.initTouchLook()
    this.initActionButtons()
    this.initTopBar()
    this.initOrientation()
  }

  get isTouchActive(): boolean {
    const pref = this.save.data.touchControls
    if (pref === 'off') return false
    if (pref === 'on') return true
    return this.touchDetected || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)
  }

  private initDeviceDetection(): void {
    const check = () => {
      if (('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || this.save.data.touchControls === 'on') {
        this.touchDetected = true
        this.root.classList.add('touch-capable')
      }
    }
    check()

    // Detect first real touch event
    const onTouch = () => {
      this.touchDetected = true
      this.root.classList.add('touch-capable')
      this.input.method = 'touch'
      window.removeEventListener('touchstart', onTouch)
      window.removeEventListener('pointerdown', onPointerTouch)
    }
    const onPointerTouch = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        onTouch()
      }
    }
    window.addEventListener('touchstart', onTouch, { passive: true })
    window.addEventListener('pointerdown', onPointerTouch, { passive: true })
  }

  private template(): string {
    return `
      <!-- Top Quick Actions (Mobile HUD shortcuts) -->
      <div class="touch-top-bar">
        <button class="touch-btn-top" data-touch-act="pause" aria-label="Pause game">
          <svg viewBox="0 0 24 24" width="20" height="20"><rect x="6" y="4" width="4" height="16" rx="1.5" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1.5" fill="currentColor"/></svg>
        </button>
        <button class="touch-btn-top" data-touch-act="satchel" aria-label="Open Satchel">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 8h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 8V5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 12v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <small>BAG</small>
        </button>
        <button class="touch-btn-top" data-touch-act="journal" aria-label="Open Codex">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" fill="none" stroke="currentColor" stroke-width="2"/><line x1="8" y1="6" x2="16" y2="6" stroke="currentColor" stroke-width="1.8"/><line x1="8" y1="10" x2="14" y2="10" stroke="currentColor" stroke-width="1.8"/></svg>
          <small>CODEX</small>
        </button>
        <button class="touch-btn-top" data-touch-act="map" aria-label="Open Map">
          <svg viewBox="0 0 24 24" width="20" height="20"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" fill="none" stroke="currentColor" stroke-width="2"/><line x1="8" y1="2" x2="8" y2="18" stroke="currentColor" stroke-width="2"/><line x1="16" y1="6" x2="16" y2="22" stroke="currentColor" stroke-width="2"/></svg>
          <small>MAP</small>
        </button>
        <button class="touch-btn-top" data-touch-act="skills" aria-label="Open Skills">
          <svg viewBox="0 0 24 24" width="20" height="20"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="none" stroke="currentColor" stroke-width="2"/></svg>
          <small>SKILLS</small>
        </button>
        <button class="touch-btn-top" data-touch-act="fullscreen" aria-label="Toggle Fullscreen">
          <svg viewBox="0 0 24 24" width="20" height="20" class="fs-enter"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>

      <!-- Left Touch Zone for Virtual Joystick -->
      <div class="touch-joystick-zone">
        <div class="touch-joystick-base">
          <div class="touch-joystick-ring"></div>
          <div class="touch-joystick-knob"></div>
        </div>
      </div>

      <!-- Right Touch-Look Area (Camera dragging) -->
      <div class="touch-look-zone"></div>

      <!-- Right Thumb Action Buttons Cluster -->
      <div class="touch-actions-cluster">
        <!-- Sub-actions arc -->
        <button class="touch-btn touch-btn-heal" data-touch-act="heal" aria-label="Heal (R)">
          <img src="./ui/icons/poultice.webp" alt="" draggable="false">
          <b class="touch-badge pot-count">0</b>
          <span>HEAL</span>
        </button>
        <button class="touch-btn touch-btn-lock" data-touch-act="lock" aria-label="Lock-on Target (Q)">
          <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="2" x2="12" y2="6" stroke="currentColor" stroke-width="2"/><line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" stroke-width="2"/><line x1="2" y1="12" x2="6" y2="12" stroke="currentColor" stroke-width="2"/><line x1="18" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>
          <span>LOCK</span>
        </button>
        <button class="touch-btn touch-btn-gadget" data-touch-act="gadget" aria-label="Use Gadget (G)">
          <img class="gadget-img" src="./ui/icons/snare.webp" alt="" draggable="false">
          <b class="touch-badge gadget-count">0</b>
          <span>TRAP</span>
        </button>
        <button class="touch-btn touch-btn-cycle-gadget" data-touch-act="gadgetCycle" aria-label="Cycle Gadget (C)">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M21.5 2v6h-6M2.5 22v-6h6M21.5 8A10 10 0 0 0 4.1 6.3L2.5 8M2.5 16a10 10 0 0 0 17.4 1.7l1.6-1.7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
          <small>CYCLE</small>
        </button>
        <button class="touch-btn touch-btn-cycle-weapon" data-touch-act="cycle" aria-label="Cycle Weapon/Tool (F)">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
          <small>TOOL</small>
        </button>

        <!-- Main primary combat controls -->
        <button class="touch-btn touch-btn-interact" data-touch-act="interact" aria-label="Interact/Gather (E)">
          <svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 2a3 3 0 0 1 3 3v6a1 1 0 0 0 2 0V7a2 2 0 1 1 4 0v8a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7v-5a2 2 0 1 1 4 0v4a1 1 0 0 0 2 0V5a3 3 0 0 1 3-3z" fill="none" stroke="currentColor" stroke-width="2"/></svg>
          <span>GATHER</span>
        </button>
        <button class="touch-btn touch-btn-sprint" data-touch-act="sprint" aria-label="Sprint (Shift)">
          <svg viewBox="0 0 24 24" width="24" height="24"><path d="M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 13l4-2 2.5 3.5 4-2M10 17l-3 5M12.5 16.5l3.5 5.5M10 11l-4-3 5-3 3 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>SPRINT</span>
        </button>
        <button class="touch-btn touch-btn-heavy" data-touch-act="heavy" aria-label="Heavy Attack (Hold to Charge) (K)">
          <svg viewBox="0 0 24 24" width="26" height="26"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>
          <span>HEAVY</span>
        </button>
        <button class="touch-btn touch-btn-dodge" data-touch-act="dodge" aria-label="Dodge Roll (Space)">
          <svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 16c2-4 6-8 12-8s6 4 6 4M7 19l-4-3 4-3M17 13l4 3-4 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>DODGE</span>
        </button>
        <button class="touch-btn touch-btn-light touch-btn-primary" data-touch-act="light" aria-label="Attack (J)">
          <svg viewBox="0 0 24 24" width="34" height="34"><path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l2 2 6-6-2-2M19 13l2-2-4-4-2 2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>ATTACK</span>
        </button>
      </div>

      <!-- Device Rotate Suggestion Prompt -->
      <div class="touch-portrait-prompt" hidden>
        <div class="touch-portrait-card">
          <div class="touch-rotate-icon">
            <svg viewBox="0 0 48 48" width="60" height="60"><rect x="14" y="6" width="20" height="36" rx="4" fill="none" stroke="#ffb23e" stroke-width="3"/><circle cx="24" cy="36" r="2" fill="#ffb23e"/><path d="M8 20 A 16 16 0 0 1 20 8" fill="none" stroke="#ffd27a" stroke-width="3" stroke-dasharray="4 2"/><polygon points="22 6 22 12 16 10" fill="#ffd27a"/></svg>
          </div>
          <h3>Rotate Your Device</h3>
          <p>Prehistoric Wilds is built for <strong>Landscape</strong> orientation for wider vision and thumb reach.</p>
          <button class="btn primary sm" data-touch-act="dismiss-rotate">Continue in portrait</button>
        </div>
      </div>
    `
  }

  // ─── Virtual Joystick ────────────────────────────────────────────────────────

  private initJoystick(): void {
    const zone = this.joyZone
    const base = this.joyBase
    const knob = this.joyKnob

    const start = (clientX: number, clientY: number, pointerId: number) => {
      if (this.joystickPointerId !== null) return
      this.joystickPointerId = pointerId
      this.touchDetected = true
      this.root.classList.add('touch-capable')
      this.input.method = 'touch'

      // Clamp center to safe area within left touch zone
      const margin = 55
      const cx = Math.max(margin, Math.min(clientX, window.innerWidth * 0.48 - margin))
      const cy = Math.max(margin, Math.min(clientY, window.innerHeight - margin))
      this.joyBaseCenter = { x: cx, y: cy }

      base.style.left = `${cx}px`
      base.style.top = `${cy}px`
      base.classList.add('active')
      knob.style.transform = 'translate(-50%, -50%)'
    }

    const move = (clientX: number, clientY: number, pointerId: number) => {
      if (this.joystickPointerId !== pointerId) return
      const dx = clientX - this.joyBaseCenter.x
      const dy = clientY - this.joyBaseCenter.y
      const dist = Math.hypot(dx, dy)

      // Visual knob clamping
      const visualDist = Math.min(dist, this.joyMaxRadius)
      const angle = Math.atan2(dy, dx)
      const kx = Math.cos(angle) * visualDist
      const ky = Math.sin(angle) * visualDist
      knob.style.transform = `translate(calc(-50% + ${kx.toFixed(1)}px), calc(-50% + ${ky.toFixed(1)}px))`

      // Analog dead zone & normalized input
      if (dist < this.joyDeadzone) {
        this.input.setTouchMove(0, 0)
      } else {
        const mag = Math.min(1.0, (dist - this.joyDeadzone) / (this.joyMaxRadius - this.joyDeadzone))
        const normX = dx / dist
        const normY = dy / dist
        // Game coords: forward is +y (-dy on screen), strafe right is +x (+dx on screen)
        this.input.setTouchMove(normX * mag, -normY * mag)
      }
    }

    const stop = (pointerId: number) => {
      if (this.joystickPointerId !== pointerId) return
      this.joystickPointerId = null
      this.input.setTouchMove(0, 0)
      base.classList.remove('active')
      knob.style.transform = 'translate(-50%, -50%)'
    }

    zone.addEventListener('pointerdown', e => {
      e.preventDefault()
      try { zone.setPointerCapture(e.pointerId) } catch {}
      start(e.clientX, e.clientY, e.pointerId)
    })

    window.addEventListener('pointermove', e => {
      if (this.joystickPointerId === e.pointerId) {
        e.preventDefault()
        move(e.clientX, e.clientY, e.pointerId)
      }
    }, { passive: false })

    window.addEventListener('pointerup', e => {
      if (this.joystickPointerId === e.pointerId) {
        e.preventDefault()
        stop(e.pointerId)
      }
    })

    window.addEventListener('pointercancel', e => {
      if (this.joystickPointerId === e.pointerId) {
        e.preventDefault()
        stop(e.pointerId)
      }
    })
  }

  // ─── Camera Touch Look ───────────────────────────────────────────────────────

  private initTouchLook(): void {
    const zone = this.lookZone

    zone.addEventListener('pointerdown', e => {
      if (this.lookPointerId !== null) return
      // If clicking directly on an action button, let the action button take it
      if ((e.target as HTMLElement).closest('.touch-btn, .touch-btn-top')) return

      this.lookPointerId = e.pointerId
      try { zone.setPointerCapture(e.pointerId) } catch {}
      this.lastLookPos = { x: e.clientX, y: e.clientY }
      this.touchDetected = true
      this.root.classList.add('touch-capable')
      this.input.method = 'touch'
      e.preventDefault()
    })

    window.addEventListener('pointermove', e => {
      if (this.lookPointerId !== e.pointerId) return
      const dx = e.clientX - this.lastLookPos.x
      const dy = e.clientY - this.lastLookPos.y
      this.lastLookPos = { x: e.clientX, y: e.clientY }

      // Smooth camera orbit scaling
      this.input.addTouchLook(dx * 0.0035, dy * 0.0035)
      e.preventDefault()
    }, { passive: false })

    const endLook = (e: PointerEvent) => {
      if (this.lookPointerId === e.pointerId) {
        this.lookPointerId = null
        e.preventDefault()
      }
    }
    window.addEventListener('pointerup', endLook)
    window.addEventListener('pointercancel', endLook)
  }

  // ─── Action Buttons ─────────────────────────────────────────────────────────

  private initActionButtons(): void {
    const cluster = this.actionsCluster

    const press = (act: string, pointerId: number, btn: HTMLElement) => {
      this.activeButtons.set(pointerId, act)
      btn.classList.add('active')
      this.touchDetected = true
      this.root.classList.add('touch-capable')
      this.input.method = 'touch'

      if (act === 'light') {
        this.input.setTouchHeld('light', true)
      } else if (act === 'heavy') {
        this.input.setTouchHeld('heavy', true) // hold to charge!
      } else if (act === 'dodge') {
        this.input.touchPress('dodge')
      } else if (act === 'sprint') {
        this.sprintLocked = !this.sprintLocked
        btn.classList.toggle('locked-on', this.sprintLocked)
        this.input.setTouchHeld('sprint', true)
      } else if (act === 'interact') {
        this.input.touchPress('interact')
      } else if (act === 'lock') {
        this.input.touchPress('lock')
      } else if (act === 'heal') {
        this.input.touchPress('heal')
      } else if (act === 'gadget') {
        this.input.touchPress('gadget')
      } else if (act === 'gadgetCycle') {
        this.input.touchPress('gadgetCycle')
      } else if (act === 'cycle') {
        this.input.touchPress('cycle')
      }
    }

    const release = (pointerId: number) => {
      const act = this.activeButtons.get(pointerId)
      if (!act) return
      this.activeButtons.delete(pointerId)

      const btn = cluster.querySelector<HTMLElement>(`[data-touch-act="${act}"]`)
      if (btn) btn.classList.remove('active')

      if (act === 'light') {
        this.input.setTouchHeld('light', false)
      } else if (act === 'heavy') {
        this.input.setTouchHeld('heavy', false) // releases charged heavy!
      } else if (act === 'sprint' && !this.sprintLocked) {
        this.input.setTouchHeld('sprint', false)
      }
    }

    cluster.addEventListener('pointerdown', e => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.touch-btn[data-touch-act]')
      if (!btn) return
      const act = btn.dataset.touchAct!
      try { btn.setPointerCapture(e.pointerId) } catch {}
      press(act, e.pointerId, btn)
      e.preventDefault()
      e.stopPropagation()
    })

    window.addEventListener('pointerup', e => {
      if (this.activeButtons.has(e.pointerId)) {
        release(e.pointerId)
        e.preventDefault()
      }
    })

    window.addEventListener('pointercancel', e => {
      if (this.activeButtons.has(e.pointerId)) {
        release(e.pointerId)
        e.preventDefault()
      }
    })
  }

  // ─── Top Bar & Fullscreen ───────────────────────────────────────────────────

  private initTopBar(): void {
    const bar = this.topBar

    bar.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-touch-act]')
      if (!btn) return
      const act = btn.dataset.touchAct!
      e.preventDefault()
      e.stopPropagation()

      switch (act) {
        case 'pause':
          this.actions.pause()
          break
        case 'satchel':
          this.actions.openSatchel()
          break
        case 'journal':
          this.actions.openJournal()
          break
        case 'map':
          this.actions.openMap()
          break
        case 'skills':
          this.actions.openSkills()
          break
        case 'fullscreen':
          this.toggleFullscreen()
          break
      }
    })

    document.addEventListener('fullscreenchange', () => {
      const isFs = !!document.fullscreenElement
      const fsBtn = bar.querySelector('[data-touch-act="fullscreen"]')
      if (fsBtn) {
        fsBtn.classList.toggle('is-fs', isFs)
      }
    })
  }

  toggleFullscreen(): void {
    try {
      if (!document.fullscreenElement) {
        const el = document.documentElement as unknown as { requestFullscreen?: () => Promise<void>; webkitRequestFullscreen?: () => Promise<void> }
        if (el.requestFullscreen) void el.requestFullscreen().catch(() => {})
        else if (el.webkitRequestFullscreen) void el.webkitRequestFullscreen()
      } else {
        const doc = document as unknown as { exitFullscreen?: () => Promise<void>; webkitExitFullscreen?: () => Promise<void> }
        if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => {})
        else if (doc.webkitExitFullscreen) void doc.webkitExitFullscreen()
      }
    } catch {}
  }

  // ─── Orientation & Prompt ───────────────────────────────────────────────────

  private initOrientation(): void {
    const checkOrientation = () => {
      const isPortrait = window.innerHeight > window.innerWidth
      const show = isPortrait && this.isTouchActive && !this.rotateDismissed
      this.portraitPrompt.hidden = !show
      this.root.classList.toggle('has-portrait-prompt', show)
    }

    window.addEventListener('resize', checkOrientation)
    window.addEventListener('orientationchange', checkOrientation)
    setTimeout(checkOrientation, 300)

    this.portraitPrompt.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest('[data-touch-act="dismiss-rotate"]')
      if (btn) {
        this.rotateDismissed = true
        this.portraitPrompt.hidden = true
        this.root.classList.remove('has-portrait-prompt')
      }
    })
  }

  // ─── Per-Frame HUD Sync ─────────────────────────────────────────────────────

  update(g: Game): void {
    const active = this.isTouchActive
    const playing = g.mode === 'playing' && this.ui.screen === 'hud' && !this.ui.mapOpen && !this.ui.helpOpen

    const shouldShow = active && playing
    if (active) this.root.classList.add('touch-capable')
    this.root.classList.toggle('visible', shouldShow)

    if (!shouldShow) {
      if (this.joystickPointerId !== null || this.activeButtons.size > 0 || this.lookPointerId !== null) {
        this.reset()
      }
      return
    }

    // Sync button state & counts with game
    const p = g.progress

    // Poultice count
    const potBadge = this.root.querySelector('.pot-count')
    if (potBadge) {
      potBadge.textContent = String(count(p, 'poultice'))
    }

    // Gadget icon & count
    const gadgetBadge = this.root.querySelector('.gadget-count')
    const gadgetImg = this.root.querySelector<HTMLImageElement>('.gadget-img')
    if (gadgetBadge && gadgetImg) {
      const gId = p.gadget ?? 'snare'
      gadgetBadge.textContent = String(count(p, gId))
      gadgetImg.src = `./ui/icons/${gId}.webp`
    }

    // Interact button pulse/glow when prompt is nearby
    const interactBtn = this.root.querySelector('.touch-btn-interact')
    if (interactBtn) {
      const hasPrompt = !!g.interact?.enabled && !g.player.busy
      interactBtn.classList.toggle('has-target', hasPrompt)
    }

    // Target lock button active state
    const lockBtn = this.root.querySelector('.touch-btn-lock')
    if (lockBtn) {
      lockBtn.classList.toggle('locked', !!g.lockTarget)
    }
  }

  reset(): void {
    this.joystickPointerId = null
    this.lookPointerId = null
    this.joyBase.classList.remove('active')
    this.joyKnob.style.transform = 'translate(-50%, -50%)'
    this.activeButtons.clear()
    this.sprintLocked = false
    for (const b of this.root.querySelectorAll('.touch-btn.active, .touch-btn.locked-on')) {
      b.classList.remove('active', 'locked-on')
    }
    this.input.resetTouch()
  }

  dispose(): void {
    this.reset()
    this.root.remove()
  }
}
