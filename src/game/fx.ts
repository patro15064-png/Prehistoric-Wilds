import * as THREE from 'three'
import { assets } from '../engine/assets'

/**
 * Combat & world VFX.
 * Particles: GPU point sprites with per-particle rotation, growth and fade, drawn from
 * painted sprite textures (spark / flame / smoke) streamed by `assets` (soft procedural
 * fallback until they arrive). Plus mesh effects: weapon swing ribbons, impact starbursts,
 * slash arcs, ground cracks, shockwave rings and arcing projectiles.
 */
type TexName = 'spark' | 'flame' | 'smoke'

class Pool {
  readonly points: THREE.Points
  private readonly pos: Float32Array
  private readonly vel: Float32Array
  private readonly col: Float32Array
  private readonly size: Float32Array
  private readonly age: Float32Array
  private readonly life: Float32Array
  private readonly grav: Float32Array
  private readonly drag: Float32Array
  private readonly fade: Float32Array
  private readonly rot: Float32Array
  private readonly spin: Float32Array
  private readonly grow: Float32Array
  private readonly cur: Float32Array
  private next = 0
  alive = 0
  private readonly mat: THREE.ShaderMaterial

  constructor(private readonly max: number, additive: boolean, private readonly tex: TexName, opacity = 1) {
    this.pos = new Float32Array(max * 3).fill(-9999)
    this.vel = new Float32Array(max * 3)
    this.col = new Float32Array(max * 3)
    this.size = new Float32Array(max)
    this.cur = new Float32Array(max)
    this.age = new Float32Array(max).fill(1e9)
    this.life = new Float32Array(max).fill(1)
    this.grav = new Float32Array(max)
    this.drag = new Float32Array(max)
    this.fade = new Float32Array(max)
    this.rot = new Float32Array(max)
    this.spin = new Float32Array(max)
    this.grow = new Float32Array(max)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aSize', new THREE.BufferAttribute(this.cur, 1).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aFade', new THREE.BufferAttribute(this.fade, 1).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 500 }, uMap: { value: null }, uHas: { value: 0 }, uOpacity: { value: opacity } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aFade; attribute float aRot;
        uniform float uScale; varying vec3 vC; varying float vF; varying float vR;
        void main(){ vC = aColor; vR = aRot; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float z = -mv.z;
          // Fade out and cap size close to the camera so puffs never blanket the screen.
          vF = aFade * smoothstep(1.2, 4.5, z);
          // Dead particles (fade 0) get zero size so the pool never rasterises invisible points.
          gl_PointSize = vF > 0.003 ? min(aSize * uScale / max(0.5, z), uScale * 0.35) : 0.0;
          gl_Position = vF > 0.003 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform float uHas; uniform float uOpacity;
        varying vec3 vC; varying float vF; varying float vR;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float s = sin(vR), co = cos(vR);
          vec2 uv = vec2(co * c.x - s * c.y, s * c.x + co * c.y) + 0.5;
          float d = dot(c, c) * 4.0;
          vec4 t = uHas > 0.5 ? texture2D(uMap, uv) : vec4(1.0, 1.0, 1.0, max(0.0, 1.0 - d));
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
          ${additive
            ? 'vec3 rgb = vC * t.rgb * t.a * vF * 1.5 * uOpacity; gl_FragColor = vec4(rgb, 1.0);'
            : 'float lum = dot(t.rgb, vec3(0.333)); gl_FragColor = vec4(vC * mix(0.75, 1.1, lum), t.a * vF * uOpacity);'}
        }`,
    })
    this.points = new THREE.Points(g, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = additive ? 10 : 9
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, c: THREE.Color, size: number, life: number, grav: number, drag: number, grow = 0, spin = 0): void {
    const i = this.next
    this.next = (i + 1) % this.max
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b
    this.size[i] = size
    this.age[i] = 0
    this.life[i] = life
    this.grav[i] = grav
    this.drag[i] = drag
    this.grow[i] = grow
    this.rot[i] = Math.random() * Math.PI * 2
    this.spin[i] = spin || (Math.random() - 0.5) * 2
  }

  update(dt: number, scale: number): void {
    this.mat.uniforms.uScale.value = scale
    if (!this.mat.uniforms.uHas.value) {
      const t = assets.texture(this.tex)
      if (t) { this.mat.uniforms.uMap.value = t; this.mat.uniforms.uHas.value = 1 }
    }
    let alive = 0
    for (let i = 0; i < this.max; i += 1) {
      if (this.age[i] >= this.life[i]) {
        this.fade[i] = 0
        continue
      }
      alive += 1
      this.age[i] += dt
      const k = i * 3
      const dr = Math.exp(-this.drag[i] * dt)
      this.vel[k] *= dr
      this.vel[k + 1] = this.vel[k + 1] * dr - this.grav[i] * dt
      this.vel[k + 2] *= dr
      this.pos[k] += this.vel[k] * dt
      this.pos[k + 1] += this.vel[k + 1] * dt
      this.pos[k + 2] += this.vel[k + 2] * dt
      this.rot[i] += this.spin[i] * dt
      const t = this.age[i] / this.life[i]
      this.cur[i] = this.size[i] * (1 + this.grow[i] * t)
      this.fade[i] = Math.max(0, 1 - t) * Math.min(1, t * 10)
    }
    this.alive = alive
    const g = this.points.geometry
    g.getAttribute('position').needsUpdate = true
    g.getAttribute('aColor').needsUpdate = true
    g.getAttribute('aSize').needsUpdate = true
    g.getAttribute('aFade').needsUpdate = true
    g.getAttribute('aRot').needsUpdate = true
  }
}

/** Weapon swing ribbon: a fading triangle strip between the grip and the weapon tip. */
class Trail {
  readonly mesh: THREE.Mesh
  private readonly N = 18
  private readonly base: THREE.Vector3[] = []
  private readonly tip: THREE.Vector3[] = []
  private readonly pos: Float32Array
  private readonly alpha: Float32Array
  private strength = 0
  private readonly mat: THREE.ShaderMaterial
  constructor() {
    const g = new THREE.BufferGeometry()
    this.pos = new Float32Array(this.N * 2 * 3)
    this.alpha = new Float32Array(this.N * 2)
    const uv = new Float32Array(this.N * 2 * 2)
    const idx: number[] = []
    for (let i = 0; i < this.N; i += 1) {
      uv.set([i / (this.N - 1), 0, i / (this.N - 1), 1], i * 4)
      if (i < this.N - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.setIndex(idx)
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color('#ffe7b0') }, uStrength: { value: 0 } },
      vertexShader: 'attribute float aAlpha; varying float vA; varying vec2 vUv; void main(){ vA = aAlpha; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uStrength; varying float vA; varying vec2 vUv; void main(){ float edge = smoothstep(0.0, 0.35, vUv.y) * (0.35 + 0.65 * smoothstep(1.0, 0.7, vUv.y)); float core = pow(vUv.y, 3.0); vec3 c = mix(uColor, vec3(1.0), core * 0.6); gl_FragColor = vec4(c * vA * edge * uStrength * 1.2, 1.0); }',
    })
    this.mesh = new THREE.Mesh(g, this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 11
    for (let i = 0; i < this.N; i += 1) { this.base.push(new THREE.Vector3()); this.tip.push(new THREE.Vector3()) }
  }
  push(base: THREE.Vector3, tip: THREE.Vector3, on: boolean, color?: THREE.ColorRepresentation): void {
    if (color) this.mat.uniforms.uColor.value.set(color)
    this.strength = on ? Math.min(1, this.strength + 0.5) : this.strength * 0.8
    const b = this.base.pop()!.copy(base)
    const t = this.tip.pop()!.copy(tip)
    this.base.unshift(b)
    this.tip.unshift(t)
    for (let i = 0; i < this.N; i += 1) {
      this.pos.set([this.base[i].x, this.base[i].y, this.base[i].z], i * 6)
      this.pos.set([this.tip[i].x, this.tip[i].y, this.tip[i].z], i * 6 + 3)
      const a = Math.pow(1 - i / (this.N - 1), 1.6)
      this.alpha[i * 2] = a
      this.alpha[i * 2 + 1] = a
    }
    this.mat.uniforms.uStrength.value = this.strength
    this.mesh.visible = this.strength > 0.02
    this.mesh.geometry.getAttribute('position').needsUpdate = true
    this.mesh.geometry.getAttribute('aAlpha').needsUpdate = true
  }
}

type Ring = { mesh: THREE.Mesh; t: number; life: number; r0: number; r1: number }
type Flash = { mesh: THREE.Mesh | THREE.Sprite; t: number; life: number; s0: number; s1: number; o0: number }
export type Projectile = {
  mesh: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; arc: number
  kind: 'magma' | 'rubble' | 'fire'; onLand: () => void; done: boolean
}

const C = (hex: string) => new THREE.Color(hex)
const _c = new THREE.Color()

export class Fx {
  readonly group = new THREE.Group()
  private readonly glow = new Pool(1600, true, 'spark')
  private readonly fire = new Pool(900, true, 'flame', 0.9)
  private readonly smokeP = new Pool(700, false, 'smoke', 0.6)
  private readonly dust = new Pool(900, false, 'smoke', 0.45)
  private readonly rings: Ring[] = []
  private readonly flashes: Flash[] = []
  private readonly projectiles: Projectile[] = []
  private readonly ringGeo = new THREE.RingGeometry(0.82, 1, 64).rotateX(-Math.PI / 2)
  private readonly quad = new THREE.PlaneGeometry(1, 1)
  readonly trail = new Trail()
  shakeAmount = 0
  hitstopLeft = 0
  reducedMotion = false

  constructor() {
    this.group.add(this.dust.points, this.smokeP.points, this.fire.points, this.glow.points, this.trail.mesh)
  }

  /** Live particle count (drives the background-loading busy signal). */
  get activeCount(): number {
    return this.glow.alive + this.fire.alive + this.smokeP.alive + this.dust.alive + this.projectiles.length * 20
  }

  shake(amount: number): void {
    if (this.reducedMotion) amount *= 0.3
    this.shakeAmount = Math.min(1.2, Math.max(this.shakeAmount, amount))
  }

  hitstop(seconds: number): void {
    this.hitstopLeft = Math.max(this.hitstopLeft, seconds)
  }

  /** Impact sparks at a hit point: streaking hot sparks with gravity. */
  sparks(p: THREE.Vector3, color = '#ffe08a', n = 14, speed = 7): void {
    const c = C(color)
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2
      const u = Math.random() * 2 - 1
      const s = speed * (0.4 + Math.random() * 0.8)
      const r = Math.sqrt(1 - u * u)
      _c.copy(c).lerp(C('#ffffff'), Math.random() * 0.4)
      this.glow.emit(p.x, p.y, p.z, Math.cos(a) * r * s, Math.abs(u) * s * 0.8 + 1.5, Math.sin(a) * r * s, _c, 0.14 + Math.random() * 0.14, 0.3 + Math.random() * 0.35, 16, 3, -0.5, 6)
    }
  }

  /** Big billboard starburst that pops and fades at an impact. */
  impactFlash(p: THREE.Vector3, color = '#fff2c8', size = 1.6, life = 0.16): void {
    const tex = assets.texture('spark')
    const mat = new THREE.SpriteMaterial({ map: tex ?? null, color, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, opacity: 1 })
    mat.rotation = Math.random() * Math.PI
    const s = new THREE.Sprite(mat)
    s.position.copy(p)
    s.scale.setScalar(size * 0.4)
    s.renderOrder = 12
    this.group.add(s)
    this.flashes.push({ mesh: s, t: 0, life, s0: size * 0.4, s1: size, o0: 1 })
  }

  /** Painted slash arc billboard across the target, oriented by the swing. */
  slash(p: THREE.Vector3, camera: THREE.Camera, tilt: number, color = '#fff0c8', size = 2.4): void {
    const tex = assets.texture('slash')
    if (!tex) return
    const mat = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    const m = new THREE.Mesh(this.quad, mat)
    m.position.copy(p)
    m.quaternion.copy(camera.quaternion)
    m.rotateZ(tilt)
    m.scale.setScalar(size * 0.7)
    m.renderOrder = 12
    this.group.add(m)
    this.flashes.push({ mesh: m, t: 0, life: 0.18, s0: size * 0.7, s1: size * 1.1, o0: 1 })
  }

  /** Cracked-earth decal for heavy slams. */
  crack(x: number, y: number, z: number, r = 1.6, life = 1.6): void {
    const tex = assets.texture('crack')
    if (!tex) return
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -4 })
    const m = new THREE.Mesh(this.quad, mat)
    m.rotation.x = -Math.PI / 2
    m.rotation.z = Math.random() * Math.PI * 2
    m.position.set(x, y + 0.06, z)
    m.scale.setScalar(r * 2)
    m.renderOrder = 2
    this.group.add(m)
    this.flashes.push({ mesh: m, t: 0, life, s0: r * 1.7, s1: r * 2, o0: 0.85 })
  }

  /** Full layered hit: starburst + sparks + chunky debris + a puff of smoke. */
  hitBurst(p: THREE.Vector3, color: string, big: boolean): void {
    this.impactFlash(p, big ? '#fff4d0' : '#ffe6b0', big ? 2.6 : 1.5, big ? 0.2 : 0.13)
    this.sparks(p, big ? '#fff2b0' : '#ffd88a', big ? 30 : 14, big ? 11 : 7)
    const c = C(color)
    for (let i = 0; i < (big ? 14 : 6); i += 1) {
      this.dust.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 5, Math.random() * 4 + 1, (Math.random() - 0.5) * 5, c, 0.2 + Math.random() * 0.15, 0.55, 12, 2, 0.2)
    }
    this.smoke(p.x, p.y - 0.2, p.z, big ? 6 : 3, '#d9ccb4', 0.8)
  }

  /** Soft rising smoke/dust clouds. */
  smoke(x: number, y: number, z: number, n = 6, color = '#b9aea0', spread = 1, rise = 1): void {
    const c = C(color)
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2
      const s = (0.3 + Math.random()) * spread
      this.smokeP.emit(x + Math.cos(a) * 0.3 * spread, y + 0.2, z + Math.sin(a) * 0.3 * spread, Math.cos(a) * s, (0.6 + Math.random() * 0.8) * rise, Math.sin(a) * s, c, 0.9 + Math.random() * 0.8, 1.1 + Math.random() * 0.9, -0.3, 1.6, 1.6, 0.6)
    }
  }

  dustPuff(x: number, y: number, z: number, n = 8, color = '#d8c6a0', spread = 1, rise = 1): void {
    const c = C(color)
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2
      const s = (1 + Math.random() * 2) * spread
      this.dust.emit(x + Math.cos(a) * 0.3, y + 0.2, z + Math.sin(a) * 0.3, Math.cos(a) * s, (0.8 + Math.random()) * rise, Math.sin(a) * s, c, 0.55 + Math.random() * 0.55, 0.8 + Math.random() * 0.6, -0.4, 2.5, 1.4)
    }
  }

  embers(x: number, y: number, z: number, n = 10, spread = 1.5): void {
    for (let i = 0; i < n; i += 1) {
      const c = Math.random() < 0.5 ? C('#ff8a2a') : C('#ffd24a')
      this.glow.emit(x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread, (Math.random() - 0.5) * 2, 2 + Math.random() * 4, (Math.random() - 0.5) * 2, c, 0.12 + Math.random() * 0.12, 0.8 + Math.random() * 0.8, -1, 1)
    }
  }

  /** Stream of flame along a direction (breath attacks): licking flame sprites + embers + smoke. */
  flame(origin: THREE.Vector3, dir: THREE.Vector3, spread: number, speed: number, n = 6): void {
    for (let i = 0; i < n; i += 1) {
      const c = Math.random() < 0.35 ? C('#ffd27a') : Math.random() < 0.5 ? C('#ff8a2f') : C('#ff5a1a')
      const jx = (Math.random() - 0.5) * spread
      const jy = (Math.random() - 0.5) * spread * 0.5
      const jz = (Math.random() - 0.5) * spread
      this.fire.emit(origin.x, origin.y, origin.z, (dir.x + jx) * speed, (dir.y + jy) * speed, (dir.z + jz) * speed, c, 0.6 + Math.random() * 0.6, 0.5 + Math.random() * 0.3, -2, 1.2, 1.8, 3)
      if (Math.random() < 0.3) this.glow.emit(origin.x, origin.y, origin.z, (dir.x + jx) * speed * 0.8, (dir.y + jy) * speed * 0.8 + 1, (dir.z + jz) * speed * 0.8, C('#ffc04a'), 0.1, 0.7, -1, 1)
    }
    if (Math.random() < 0.4) {
      const d = dir.clone().multiplyScalar(speed * 0.55)
      this.smokeP.emit(origin.x + d.x, origin.y + d.y + 0.6, origin.z + d.z, d.x * 0.3, 1.2, d.z * 0.3, C('#4a3a34'), 1.2, 1.4, -0.4, 1, 1.5)
    }
  }

  /** Burst of fire (landing magma, explosions). */
  fireBurst(p: THREE.Vector3, r = 1.5, n = 22): void {
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2
      const s = r * (1 + Math.random() * 2)
      const c = Math.random() < 0.4 ? C('#ffd27a') : C('#ff7a26')
      this.fire.emit(p.x, p.y + 0.2, p.z, Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s, c, 0.7 + Math.random() * 0.7, 0.45 + Math.random() * 0.35, 2, 3, 1.4, 3)
    }
    this.smoke(p.x, p.y, p.z, 5, '#3f3530', r * 0.8, 1.4)
    this.impactFlash(p.clone().setY(p.y + 0.4), '#ffb45a', r * 2.4, 0.22)
  }

  healGlow(p: THREE.Vector3): void {
    const c = C('#9dff9a')
    for (let i = 0; i < 28; i += 1) {
      const a = (i / 28) * Math.PI * 2
      this.glow.emit(p.x + Math.cos(a) * 0.6, p.y + Math.random() * 1.5, p.z + Math.sin(a) * 0.6, 0, 1.5 + Math.random(), 0, c, 0.16, 1.1, -0.5, 1)
    }
    this.ring(p.x, p.y, p.z, 0.3, 1.6, '#9dff9a', 0.6)
  }

  /** Celebration fountain (camp upgrades, tower). */
  fountain(p: THREE.Vector3, color = '#ffd26a', n = 60, height = 9): void {
    const c = C(color)
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2
      const s = 1 + Math.random() * 4
      this.glow.emit(p.x, p.y, p.z, Math.cos(a) * s, height * (0.6 + Math.random() * 0.6), Math.sin(a) * s, c, 0.2 + Math.random() * 0.16, 1.4 + Math.random(), 9, 0.5)
    }
    this.impactFlash(p.clone().setY(p.y + 1.5), color, 5, 0.4)
  }

  ring(x: number, y: number, z: number, r0: number, r1: number, color = '#ffe0a0', life = 0.45): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(this.ringGeo, mat)
    mesh.position.set(x, y + 0.2, z)
    mesh.scale.setScalar(r0)
    this.group.add(mesh)
    this.rings.push({ mesh, t: 0, life, r0, r1 })
  }

  /** Weapon ribbon; call every frame with grip + tip positions. */
  swingTrail(base: THREE.Vector3, tip: THREE.Vector3, on: boolean, color?: THREE.ColorRepresentation): void {
    this.trail.push(base, tip, on, color)
  }

  /** Arcing projectile (magma glob, rubble, fireball). `onLand` fires on arrival. */
  lob(from: THREE.Vector3, to: THREE.Vector3, dur: number, arc: number, kind: 'magma' | 'rubble' | 'fire', onLand: () => void): void {
    let obj: THREE.Object3D
    if (kind === 'rubble') {
      const geo = new THREE.DodecahedronGeometry(0.8, 1)
      const p = geo.getAttribute('position')
      for (let i = 0; i < p.count; i += 1) { const k = 0.8 + Math.random() * 0.35; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k) }
      geo.computeVertexNormals()
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#8a8272', roughness: 0.95 }))
      m.castShadow = true
      obj = m
    } else {
      const g = new THREE.Group()
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(kind === 'fire' ? 0.45 : 0.38, 2), new THREE.MeshBasicMaterial({ color: kind === 'fire' ? '#ffd58a' : '#ffb060' }))
      const crust = new THREE.Mesh(new THREE.IcosahedronGeometry(kind === 'fire' ? 0.55 : 0.48, 1), new THREE.MeshStandardMaterial({ color: '#2a1a14', roughness: 0.9, emissive: '#ff4a10', emissiveIntensity: 0.5, transparent: true, opacity: 0.8 }))
      g.add(core, crust)
      const tex = assets.texture('flame')
      if (tex) {
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#ff9a3a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
        halo.scale.setScalar(kind === 'fire' ? 2.4 : 1.8)
        g.add(halo)
      }
      obj = g
    }
    obj.position.copy(from)
    this.group.add(obj)
    this.projectiles.push({ mesh: obj, from: from.clone(), to: to.clone(), t: 0, dur, arc, kind, onLand, done: false })
  }

  update(dt: number, pixelScale: number): void {
    this.glow.update(dt, pixelScale)
    this.fire.update(dt, pixelScale)
    this.smokeP.update(dt, pixelScale)
    this.dust.update(dt, pixelScale)
    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      const r = this.rings[i]
      r.t += dt
      const k = Math.min(1, r.t / r.life)
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k)))
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k)
      if (k >= 1) {
        r.mesh.removeFromParent()
        ;(r.mesh.material as THREE.Material).dispose()
        this.rings.splice(i, 1)
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i -= 1) {
      const f = this.flashes[i]
      f.t += dt
      const k = Math.min(1, f.t / f.life)
      const e = 1 - (1 - k) * (1 - k)
      const s = f.s0 + (f.s1 - f.s0) * e
      f.mesh.scale.set(s, s, s)
      const mat = f.mesh.material as THREE.Material & { opacity: number }
      mat.opacity = f.o0 * (f.life > 1 ? Math.min(1, (1 - k) * 3) : 1 - k)
      if (k >= 1) {
        f.mesh.removeFromParent()
        mat.dispose()
        this.flashes.splice(i, 1)
      }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const p = this.projectiles[i]
      p.t += dt
      const k = Math.min(1, p.t / p.dur)
      p.mesh.position.lerpVectors(p.from, p.to, k)
      p.mesh.position.y += Math.sin(k * Math.PI) * p.arc
      p.mesh.rotation.x += dt * 6
      p.mesh.rotation.z += dt * 4
      const m = p.mesh.position
      if (p.kind === 'rubble') {
        if (Math.random() < 0.5) this.dust.emit(m.x, m.y, m.z, 0, 0.3, 0, C('#bfb49a'), 0.5, 0.6, 0, 1, 1.2)
      } else {
        this.fire.emit(m.x, m.y, m.z, (Math.random() - 0.5), 0.8, (Math.random() - 0.5), Math.random() < 0.5 ? C('#ff9a3a') : C('#ffcf6a'), 0.55, 0.35, 0, 1, 0.6, 4)
        if (Math.random() < 0.35) this.smokeP.emit(m.x, m.y, m.z, 0, 0.6, 0, C('#3d302a'), 0.6, 0.9, -0.2, 1, 1.4)
      }
      if (k >= 1) {
        p.done = true
        p.onLand()
        if (p.kind !== 'rubble') this.fireBurst(p.to, 1.2, 16)
        else this.smoke(p.to.x, p.to.y, p.to.z, 6, '#b9ad94', 1.2)
        p.mesh.removeFromParent()
        p.mesh.traverse(o => {
          const mm = o as THREE.Mesh
          if (mm.isMesh) mm.geometry.dispose()
          if (mm.isMesh || (o as THREE.Sprite).isSprite) (mm.material as THREE.Material).dispose()
        })
        this.projectiles.splice(i, 1)
      }
    }
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 2.8)
  }

  clearTransient(): void {
    for (const p of this.projectiles) p.mesh.removeFromParent()
    this.projectiles.length = 0
  }
}
