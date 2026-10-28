/**
 * HUD VFX layer: a full-screen 2D canvas above the DOM HUD that renders additive
 * glow particles for UI feedback (clicks, hovers, crafting, damage, loot, objectives),
 * plus DOM "flying" icons that travel from a world point into the loot feed.
 */
type P = { x: number; y: number; vx: number; vy: number; life: number; t: number; size: number; color: string; grav: number; drag: number; kind: 'dot' | 'star' | 'shard' | 'ring'; rot: number; spin: number }

export type BurstOpts = { color?: string | string[]; n?: number; speed?: number; size?: number; life?: number; grav?: number; kind?: P['kind']; spread?: number; dir?: number }

const spriteCache = new Map<string, HTMLCanvasElement>()
let parseCtx: CanvasRenderingContext2D | null = null
/**
 * Normalise any CSS colour ('#fff', '#ffaa33', '#ffaa3380', 'rgb()', names) to [r, g, b] using the
 * browser's own parser, so gradient alpha stops never depend on the caller's hex format.
 */
export function cssRgb(color: string): [number, number, number] {
  parseCtx ??= document.createElement('canvas').getContext('2d')!
  parseCtx.fillStyle = '#ffffff'
  parseCtx.fillStyle = color // an unparseable colour is ignored and leaves white
  const v = String(parseCtx.fillStyle)
  if (v.startsWith('#')) {
    const n = parseInt(v.slice(1, 7), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const m = v.match(/[\d.]+/g)
  return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : [255, 255, 255]
}
function glowSprite(color: string): HTMLCanvasElement {
  let c = spriteCache.get(color)
  if (c) return c
  c = document.createElement('canvas')
  c.width = c.height = 64
  const x = c.getContext('2d')!
  const [r, gr, b] = cssRgb(color)
  const rgba = (a: number) => `rgba(${r}, ${gr}, ${b}, ${a})`
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.18, rgba(1))
  g.addColorStop(0.5, rgba(0.33))
  g.addColorStop(1, rgba(0))
  x.fillStyle = g
  x.fillRect(0, 0, 64, 64)
  spriteCache.set(color, c)
  return c
}

export class UiFx {
  readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private parts: P[] = []
  private dpr = 1
  private hoverT = 0
  private warned = false
  enabled = true

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'uifx'
    parent.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    this.resize()
    addEventListener('resize', () => this.resize())
    // Global micro-feedback: every button click sparkles; hovering a button emits motes.
    parent.addEventListener('pointerdown', e => {
      const b = (e.target as HTMLElement).closest('.btn, [data-tab], .x')
      if (!b || (b as HTMLButtonElement).disabled) return
      const primary = b.classList.contains('primary')
      this.burst(e.clientX, e.clientY, { color: primary ? ['#ffd27a', '#ff9a3a', '#fff2c0'] : ['#f3e2c0', '#ffd27a'], n: primary ? 22 : 12, speed: primary ? 260 : 170, kind: 'star' })
      this.ring(e.clientX, e.clientY, primary ? '#ffc062' : '#f3e2c0', primary ? 60 : 36)
    })
    parent.addEventListener('pointermove', e => {
      const b = (e.target as HTMLElement).closest('.btn:not([disabled]), [data-tab]')
      if (!b) return
      const now = performance.now()
      if (now - this.hoverT < 55) return
      this.hoverT = now
      const r = b.getBoundingClientRect()
      const edge = Math.random()
      const x = r.left + edge * r.width
      const y = Math.random() < 0.5 ? r.top + 2 : r.bottom - 2
      this.burst(x, y, { color: ['#ffd27a', '#fff0c8'], n: 1, speed: 30, size: 7, life: 0.7, grav: -60, kind: 'dot' })
    })
  }

  private resize(): void {
    this.dpr = Math.min(2, devicePixelRatio || 1)
    this.canvas.width = Math.round(innerWidth * this.dpr)
    this.canvas.height = Math.round(innerHeight * this.dpr)
  }

  burst(x: number, y: number, o: BurstOpts = {}): void {
    if (!this.enabled) return
    const colors = Array.isArray(o.color) ? o.color : [o.color ?? '#ffd27a']
    const n = o.n ?? 14
    for (let i = 0; i < n; i += 1) {
      const a = o.dir !== undefined ? o.dir + (Math.random() - 0.5) * (o.spread ?? 1.2) : Math.random() * Math.PI * 2
      const s = (o.speed ?? 180) * (0.35 + Math.random() * 0.8)
      this.parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0,
        life: (o.life ?? 0.6) * (0.6 + Math.random() * 0.6), size: (o.size ?? 10) * (0.6 + Math.random() * 0.8),
        color: colors[i % colors.length], grav: o.grav ?? 280, drag: 2.4, kind: o.kind ?? 'dot', rot: Math.random() * 6, spin: (Math.random() - 0.5) * 10,
      })
    }
    if (this.parts.length > 900) this.parts.splice(0, this.parts.length - 900)
  }

  ring(x: number, y: number, color = '#ffd27a', r = 40, life = 0.4): void {
    if (!this.enabled) return
    this.parts.push({ x, y, vx: 0, vy: 0, t: 0, life, size: r, color, grav: 0, drag: 0, kind: 'ring', rot: 0, spin: 0 })
  }

  /** Burst along the rim of an element (panels, objective, medallions). */
  outline(el: Element, o: BurstOpts = {}): void {
    const r = el.getBoundingClientRect()
    if (!r.width) return
    const n = o.n ?? 30
    for (let i = 0; i < n; i += 1) {
      const t = Math.random() * 2 * (r.width + r.height)
      let x: number, y: number
      if (t < r.width) { x = r.left + t; y = r.top } else if (t < r.width + r.height) { x = r.right; y = r.top + t - r.width } else if (t < 2 * r.width + r.height) { x = r.right - (t - r.width - r.height); y = r.bottom } else { x = r.left; y = r.bottom - (t - 2 * r.width - r.height) }
      this.burst(x, y, { ...o, n: 1 })
    }
  }

  at(el: Element, fx = 0.5, fy = 0.5): [number, number] {
    const r = el.getBoundingClientRect()
    return [r.left + r.width * fx, r.top + r.height * fy]
  }

  /** Fly a DOM icon from a screen point to a target element, bursting on arrival. */
  fly(html: string, from: [number, number], to: Element, color = '#ffd27a', delay = 0): void {
    if (!this.enabled) return
    const el = document.createElement('div')
    el.className = 'flyicon'
    el.innerHTML = html
    document.body.appendChild(el)
    const [tx, ty] = this.at(to, 0.12, 0.5)
    const [fx, fy] = from
    const mx = (fx + tx) / 2 + (Math.random() - 0.5) * 160
    const my = Math.min(fy, ty) - 120 - Math.random() * 80
    const dur = 0.75 + Math.random() * 0.2
    let t = -delay
    let last = performance.now()
    const step = (now: number) => {
      t += (now - last) / 1000
      last = now
      const k = Math.max(0, Math.min(1, t / dur))
      const e = k * k * (3 - 2 * k)
      const x = (1 - e) * (1 - e) * fx + 2 * (1 - e) * e * mx + e * e * tx
      const y = (1 - e) * (1 - e) * fy + 2 * (1 - e) * e * my + e * e * ty
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${1.25 - e * 0.55}) rotate(${(1 - e) * 20}deg)`
      el.style.opacity = t < 0 ? '0' : '1'
      if (t > 0 && Math.random() < 0.8) this.burst(x, y, { color, n: 1, speed: 40, size: 9, life: 0.45, grav: 0, kind: 'dot' })
      if (k < 1) requestAnimationFrame(step)
      else {
        el.remove()
        this.burst(tx, ty, { color: [color, '#fff2c8'], n: 14, speed: 200, kind: 'star' })
        this.ring(tx, ty, color, 30)
      }
    }
    requestAnimationFrame(step)
  }

  update(dt: number): void {
    const c = this.ctx
    const W = this.canvas.width
    const H = this.canvas.height
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, W, H)
    if (!this.parts.length) return
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    c.globalCompositeOperation = 'lighter'
    const keep: P[] = []
    for (const p of this.parts) {
      p.t += dt
      if (p.t >= p.life) continue
      try {
        this.draw(c, p, dt)
        keep.push(p)
      } catch (err) {
        // HUD juice must never break the frame loop: drop the particle, report once.
        if (!this.warned) { this.warned = true; console.warn('[uifx] dropped particle', p.color, err) }
      }
    }
    this.parts = keep
    c.globalAlpha = 1
    c.globalCompositeOperation = 'source-over'
  }

  private draw(c: CanvasRenderingContext2D, p: P, dt: number): void {
    {
      const k = p.t / p.life
      const dr = Math.exp(-p.drag * dt)
      p.vx *= dr
      p.vy = p.vy * dr + p.grav * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.spin * dt
      const a = Math.min(1, (1 - k) * 2.2) * Math.min(1, k * 14 + 0.2)
      c.globalAlpha = a
      if (p.kind === 'ring') {
        const r = p.size * (0.3 + 0.9 * (1 - (1 - k) * (1 - k)))
        c.strokeStyle = p.color
        c.lineWidth = 3 * (1 - k) + 0.5
        c.beginPath()
        c.arc(p.x, p.y, r, 0, Math.PI * 2)
        c.stroke()
        return
      }
      const s = p.size * (p.kind === 'dot' ? 1 - k * 0.5 : 1 - k * 0.3)
      c.drawImage(glowSprite(p.color), p.x - s, p.y - s, s * 2, s * 2)
      if (p.kind === 'star' || p.kind === 'shard') {
        c.save()
        c.translate(p.x, p.y)
        c.rotate(p.kind === 'shard' ? Math.atan2(p.vy, p.vx) : p.rot)
        c.fillStyle = '#fff6e0'
        const L = s * (p.kind === 'shard' ? 1.4 : 1.1)
        const w = s * 0.14
        c.beginPath()
        c.moveTo(-L, 0); c.lineTo(0, -w); c.lineTo(L, 0); c.lineTo(0, w); c.closePath()
        if (p.kind === 'star') { c.moveTo(0, -L); c.lineTo(w, 0); c.lineTo(0, L); c.lineTo(-w, 0); c.closePath() }
        c.fill()
        c.restore()
      }
    }
  }
}
