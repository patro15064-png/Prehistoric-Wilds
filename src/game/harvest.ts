import * as THREE from 'three'
import { HARVEST_POWER, HEAVY_HARVEST, RESOURCES, RESOURCE_RESPAWN, type HeldId, type ItemId, type ResourceKind } from './data'
import type { Scenery, HarvestRec } from './scenery'
import type { Colliders } from './colliders'
import type { Fx } from './fx'
import type { Audio } from '../engine/audio'

type Ground = { heightAt(x: number, z: number): number }

/** Result of a swing that connected with a tree or boulder. */
export type HarvestHit = {
  rec: HarvestRec
  kind: ResourceKind
  /** Remaining health fraction after the hit (0 = broken). */
  frac: number
  broke: boolean
  /** Rough effectiveness, for UI feedback ("slow" when using the wrong tool). */
  power: number
  point: THREE.Vector3
}

const LIVE = 0
const FALLING = 1
const GONE = 2
const REGROW = 3

type Fall = {
  rec: HarvestRec; group: THREE.Group; meshes: THREE.InstancedMesh[]; t: number
  dir: THREE.Vector3; axis: THREE.Vector3; base: THREE.Matrix4; landed: boolean; loot: () => void
}

/** Pooled physical debris chunks (rock shards, wood chips). */
class Debris {
  readonly mesh: THREE.InstancedMesh
  private readonly n: number
  private readonly pos: Float32Array
  private readonly vel: Float32Array
  private readonly rot: Float32Array
  private readonly spin: Float32Array
  private readonly size: Float32Array
  private readonly life: Float32Array
  private readonly age: Float32Array
  private next = 0
  private live = 0
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly e = new THREE.Euler()
  private readonly v = new THREE.Vector3()
  private readonly sc = new THREE.Vector3()
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0)

  constructor(geo: THREE.BufferGeometry, n: number, private readonly flat: number) {
    this.n = n
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), n)
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
    this.mesh.receiveShadow = true
    for (let i = 0; i < n; i += 1) {
      this.mesh.setMatrixAt(i, this.zero)
      this.mesh.setColorAt(i, new THREE.Color(1, 1, 1))
    }
    this.pos = new Float32Array(n * 3)
    this.vel = new Float32Array(n * 3)
    this.rot = new Float32Array(n * 3)
    this.spin = new Float32Array(n * 3)
    this.size = new Float32Array(n)
    this.life = new Float32Array(n)
    this.age = new Float32Array(n).fill(1e9)
  }

  get active(): number { return this.live }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, color: THREE.Color, life = 1.8): void {
    const i = this.next
    this.next = (this.next + 1) % this.n
    this.pos.set([x, y, z], i * 3)
    this.vel.set([vx, vy, vz], i * 3)
    this.rot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3)
    this.spin.set([(Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16], i * 3)
    this.size[i] = size
    this.life[i] = life * (0.75 + Math.random() * 0.5)
    this.age[i] = 0
    this.mesh.setColorAt(i, color)
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  update(dt: number, ground: Ground): void {
    let live = 0
    let dirty = false
    for (let i = 0; i < this.n; i += 1) {
      if (this.age[i] > this.life[i]) continue
      this.age[i] += dt
      dirty = true
      if (this.age[i] > this.life[i]) {
        this.mesh.setMatrixAt(i, this.zero)
        continue
      }
      live += 1
      const k = i * 3
      this.vel[k + 1] -= 20 * dt
      this.pos[k] += this.vel[k] * dt
      this.pos[k + 1] += this.vel[k + 1] * dt
      this.pos[k + 2] += this.vel[k + 2] * dt
      const gy = ground.heightAt(this.pos[k], this.pos[k + 2]) + this.size[i] * 0.4
      if (this.pos[k + 1] < gy) {
        this.pos[k + 1] = gy
        // Bounce, then settle with friction.
        this.vel[k + 1] = Math.abs(this.vel[k + 1]) * 0.32
        if (this.vel[k + 1] < 0.8) this.vel[k + 1] = 0
        this.vel[k] *= 0.55
        this.vel[k + 2] *= 0.55
        for (let c = 0; c < 3; c += 1) this.spin[k + c] *= 0.5
      }
      for (let c = 0; c < 3; c += 1) this.rot[k + c] += this.spin[k + c] * dt
      const fade = 1 - Math.max(0, (this.age[i] - this.life[i] * 0.7) / (this.life[i] * 0.3))
      const s = this.size[i] * fade
      this.e.set(this.rot[k], this.rot[k + 1], this.rot[k + 2])
      this.q.setFromEuler(this.e)
      this.v.set(this.pos[k], this.pos[k + 1], this.pos[k + 2])
      this.sc.set(s, s * this.flat, s)
      this.m.compose(this.v, this.q, this.sc)
      this.mesh.setMatrixAt(i, this.m)
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true
    this.live = live
  }

  clear(): void {
    for (let i = 0; i < this.n; i += 1) {
      this.age[i] = 1e9
      this.mesh.setMatrixAt(i, this.zero)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.live = 0
  }
}

const WOOD = [new THREE.Color('#c99a62'), new THREE.Color('#8a5a34'), new THREE.Color('#e8c89a')]
const LEAF = ['#4f9a3a', '#6fb84a', '#3d7a2e']

/**
 * Minecraft-style harvesting: every scenery tree and boulder has hit points. Swings chip at
 * it (hatchet for trees, pick for rocks is fastest; anything else works, just slower). Trees
 * topple and sink, boulders shatter into bouncing shards, and both regrow when out of sight.
 */
export class Harvest {
  readonly group = new THREE.Group()
  readonly recs: HarvestRec[]
  private readonly hp: Float32Array
  private readonly state: Uint8Array
  private readonly timer: Float32Array
  private readonly grid = new Map<number, number[]>()
  private readonly cell = 10
  private readonly shakes = new Map<number, { t: number; dir: THREE.Vector3; amp: number }>()
  private readonly falls: Fall[] = []
  private readonly regrowing = new Set<number>()
  private readonly gone: number[] = []
  private readonly rocks: Debris
  private readonly chips: Debris
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0)
  /** Called when a resource breaks, with its yields. */
  onLoot: (items: [ItemId, number][], at: THREE.Vector3, kind: ResourceKind) => void = () => {}

  constructor(
    private readonly scenery: Scenery,
    private readonly ground: Ground,
    private readonly colliders: Colliders,
    private readonly fx: Fx,
    private readonly audio: Audio,
  ) {
    this.recs = scenery.harvestables
    const n = this.recs.length
    this.hp = new Float32Array(n)
    this.state = new Uint8Array(n)
    this.timer = new Float32Array(n)
    for (const r of this.recs) {
      this.hp[r.id] = this.maxHp(r)
      const k = this.key(Math.floor(r.x / this.cell), Math.floor(r.z / this.cell))
      let l = this.grid.get(k)
      if (!l) this.grid.set(k, (l = []))
      l.push(r.id)
    }
    this.rocks = new Debris(new THREE.DodecahedronGeometry(1, 0), 160, 0.75)
    this.chips = new Debris(new THREE.BoxGeometry(1, 0.28, 0.55), 120, 1)
    this.group.add(this.rocks.mesh, this.chips.mesh)
    this.group.name = 'harvest'
  }

  private key(i: number, j: number): number {
    return (i + 512) * 4096 + (j + 512)
  }

  maxHp(r: HarvestRec): number {
    return RESOURCES[r.kind].hp * Math.min(1.6, Math.max(0.7, r.s))
  }

  isLive(id: number): boolean {
    return this.state[id] === LIVE
  }

  fraction(id: number): number {
    return this.hp[id] / this.maxHp(this.recs[id])
  }

  /** Live harvestables within `range` of (x, z) (edge distance). */
  private *around(x: number, z: number, range: number): Generator<HarvestRec> {
    const i0 = Math.floor((x - range - 3) / this.cell)
    const i1 = Math.floor((x + range + 3) / this.cell)
    const j0 = Math.floor((z - range - 3) / this.cell)
    const j1 = Math.floor((z + range + 3) / this.cell)
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const l = this.grid.get(this.key(i, j))
        if (!l) continue
        for (const id of l) if (this.state[id] === LIVE) yield this.recs[id]
      }
    }
  }

  /**
   * Best target for a swing from (x, z) facing `yaw`: nearest live tree/boulder whose edge is
   * within `reach` and roughly in front. Returns null when nothing is there.
   */
  target(x: number, z: number, yaw: number, reach: number, arc = 1.15): HarvestRec | null {
    let best: HarvestRec | null = null
    let bs = Infinity
    for (const r of this.around(x, z, reach)) {
      const dx = r.x - x
      const dz = r.z - z
      const d = Math.hypot(dx, dz)
      const edge = d - r.radius
      if (edge > reach) continue
      let rel = Math.atan2(dx, dz) - yaw
      rel = Math.atan2(Math.sin(rel), Math.cos(rel))
      const half = arc + Math.atan2(r.radius, Math.max(d, 0.5))
      if (edge > 0.35 && Math.abs(rel) > half) continue
      const score = edge + Math.abs(rel) * 0.8
      if (score < bs) {
        bs = score
        best = r
      }
    }
    return best
  }

  /** Nearest live resource of `kind` (for the objective marker). */
  nearest(kind: ResourceKind, x: number, z: number, maxR = 140): HarvestRec | null {
    let best: HarvestRec | null = null
    let bd = Infinity
    for (const r of this.around(x, z, maxR)) {
      if (r.kind !== kind) continue
      const d = (r.x - x) ** 2 + (r.z - z) ** 2
      if (d < bd) {
        bd = d
        best = r
      }
    }
    if (best) return best
    // Fall back to a global scan (e.g. standing far away in the caldera).
    for (const r of this.recs) {
      if (r.kind !== kind || this.state[r.id] !== LIVE) continue
      const d = (r.x - x) ** 2 + (r.z - z) ** 2
      if (d < bd) {
        bd = d
        best = r
      }
    }
    return best
  }

  /** Apply one swing. `from` is the hunter position (debris flies away from it). */
  hit(rec: HarvestRec, held: HeldId, heavy: boolean, charge: number, from: { x: number; z: number }, swingY: number): HarvestHit | null {
    if (this.state[rec.id] !== LIVE) return null
    const power = HARVEST_POWER[held][rec.kind] * (heavy ? HEAVY_HARVEST[Math.max(0, Math.min(2, charge))] : 1)
    this.hp[rec.id] = Math.max(0, this.hp[rec.id] - power)
    const dir = new THREE.Vector3(rec.x - from.x, 0, rec.z - from.z)
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1)
    dir.normalize()
    const py = rec.kind === 'tree' ? rec.y + Math.min(1.2, rec.height * 0.25) : Math.max(swingY, rec.y + Math.min(rec.height * 0.55, 1.1))
    const point = new THREE.Vector3(rec.x - dir.x * rec.radius * 0.9, py, rec.z - dir.z * rec.radius * 0.9)
    const good = power >= 2
    // Feedback: chips/shards burst toward the hunter and sideways.
    const n = Math.round((good ? 7 : 4) * (heavy ? 1.6 : 1))
    const side = new THREE.Vector3(-dir.z, 0, dir.x)
    if (rec.kind === 'tree') {
      for (let i = 0; i < n; i += 1) {
        const s = (Math.random() - 0.5) * 2
        this.chips.emit(point.x, point.y, point.z, -dir.x * (2 + Math.random() * 3) + side.x * s * 3, 2.5 + Math.random() * 3.5, -dir.z * (2 + Math.random() * 3) + side.z * s * 3, 0.07 + Math.random() * 0.07, WOOD[i % 3], 1.4)
      }
      // Leaves shaken loose from the canopy.
      const top = rec.y + rec.height * 0.8
      this.fx.dustPuff(rec.x, top, rec.z, heavy ? 10 : 6, LEAF[Math.floor(Math.random() * 3)], 1.2 + rec.s * 0.6, -0.4)
      this.fx.dustPuff(point.x, point.y, point.z, 3, '#d9b98a', 0.35, 0.4)
      this.audio.play(held === 'flintHatchet' ? 'chop' : 'gatherWood', heavy ? 1 : 0.85)
    } else {
      const col = this.rockColor(rec)
      for (let i = 0; i < n; i += 1) {
        const s = (Math.random() - 0.5) * 2
        this.rocks.emit(point.x, point.y, point.z, -dir.x * (2 + Math.random() * 3) + side.x * s * 3, 2.5 + Math.random() * 4, -dir.z * (2 + Math.random() * 3) + side.z * s * 3, 0.06 + Math.random() * 0.08, col, 1.3)
      }
      this.fx.sparks(point, '#fff0c8', good ? 10 : 5, good ? 6 : 4)
      this.fx.dustPuff(point.x, point.y, point.z, heavy ? 8 : 5, '#cfc3ae', 0.6, 0.5)
      this.audio.play(held === 'flintPick' ? 'mine' : 'gatherRock', heavy ? 1 : 0.85)
    }
    this.fx.impactFlash(point, '#fff4d8', good ? 1.1 : 0.7, 0.1)
    this.shakes.set(rec.id, { t: 0, dir, amp: (good ? 1 : 0.6) * (heavy ? 1.5 : 1) })
    const broke = this.hp[rec.id] <= 0
    if (broke) this.breakRec(rec, dir)
    return { rec, kind: rec.kind, frac: this.hp[rec.id] / this.maxHp(rec), broke, power, point }
  }

  private rockColor(rec: HarvestRec): THREE.Color {
    const parts = this.scenery.harvestParts(rec)
    const c = new THREE.Color(rec.def === 'rockH' ? '#c98a55' : rec.def === 'rockK' ? '#4a403b' : '#8b8274')
    if (parts[0]) c.multiply(parts[0].color)
    return c
  }

  private rollLoot(rec: HarvestRec): [ItemId, number][] {
    const d = RESOURCES[rec.kind]
    const [id, lo, hi] = d.yields
    const scale = Math.min(1.5, Math.max(0.75, rec.s))
    const k = Math.max(1, Math.round((lo + Math.random() * (hi - lo)) * scale))
    const out: [ItemId, number][] = [[id, k]]
    if (d.bonus && Math.random() < d.bonus[1]) out.push([d.bonus[0], 1])
    return out
  }

  private breakRec(rec: HarvestRec, dir: THREE.Vector3): void {
    this.shakes.delete(rec.id)
    this.colliders.disable(rec.col)
    const loot = this.rollLoot(rec)
    if (rec.kind === 'rock') {
      this.state[rec.id] = GONE
      this.timer[rec.id] = 0
      this.gone.push(rec.id)
      this.scenery.setHarvestMatrix(rec, this.zero)
      const col = this.rockColor(rec)
      const c2 = col.clone().multiplyScalar(0.75)
      const r0 = Math.max(0.5, rec.radius * 0.7)
      const cy = rec.y + Math.min(rec.height * 0.45, 1.2)
      const count = Math.min(26, Math.round(12 + rec.s * 8))
      for (let i = 0; i < count; i += 1) {
        const a = Math.random() * Math.PI * 2
        const sp = 3 + Math.random() * 5
        this.rocks.emit(rec.x + Math.cos(a) * r0 * 0.5, cy + Math.random() * 0.5, rec.z + Math.sin(a) * r0 * 0.5,
          Math.cos(a) * sp, 4 + Math.random() * 5, Math.sin(a) * sp, (0.12 + Math.random() * 0.2) * Math.min(1.6, rec.s), i % 2 ? col : c2, 2.2)
      }
      this.fx.dustPuff(rec.x, rec.y + 0.4, rec.z, 18, '#cfc3ae', 1.4 + rec.s * 0.5, 0.8)
      this.fx.ring(rec.x, rec.y + 0.1, rec.z, 0.5, 2.5 + rec.s, '#f2e2c0', 0.45)
      this.fx.sparks(new THREE.Vector3(rec.x, cy, rec.z), '#ffe8b0', 16, 7)
      this.fx.shake(0.18)
      this.audio.play('rockBreak')
      this.onLoot(loot, new THREE.Vector3(rec.x, cy + 0.6, rec.z), 'rock')
      return
    }
    // Tree: build a temporary copy of its parts and topple it away from the hunter.
    this.state[rec.id] = FALLING
    const group = new THREE.Group()
    group.matrixAutoUpdate = false
    const meshes: THREE.InstancedMesh[] = []
    for (const p of this.scenery.harvestParts(rec)) {
      const m = new THREE.InstancedMesh(p.geo, p.mat, 1)
      m.setMatrixAt(0, new THREE.Matrix4())
      m.setColorAt(0, p.color)
      m.frustumCulled = false
      m.castShadow = true
      m.receiveShadow = true
      group.add(m)
      meshes.push(m)
    }
    this.scenery.setHarvestMatrix(rec, this.zero)
    const base = rec.matrix.clone()
    base.setPosition(0, 0, 0)
    this.group.add(group)
    const axis = new THREE.Vector3(dir.z, 0, -dir.x)
    this.falls.push({
      rec, group, meshes, t: 0, dir: dir.clone(), axis, base, landed: false,
      loot: () => this.onLoot(loot, new THREE.Vector3(rec.x + dir.x * rec.height * 0.35, rec.y + 1, rec.z + dir.z * rec.height * 0.35), 'tree'),
    })
    this.audio.play('treeFall')
    this.fx.dustPuff(rec.x, rec.y + 0.6, rec.z, 8, '#d9b98a', 0.6, 0.6)
  }

  update(dt: number, px: number, pz: number): void {
    // Hit wobble: a quick damped sway away from the swing.
    for (const [id, s] of this.shakes) {
      s.t += dt
      const rec = this.recs[id]
      const dur = rec.kind === 'tree' ? 0.55 : 0.28
      if (s.t >= dur || this.state[id] !== LIVE) {
        this.shakes.delete(id)
        if (this.state[id] === LIVE) this.scenery.setHarvestMatrix(rec, rec.matrix)
        continue
      }
      const k = 1 - s.t / dur
      const amp = (rec.kind === 'tree' ? 0.07 : 0.035) * s.amp
      const ang = Math.sin(s.t * (rec.kind === 'tree' ? 22 : 48)) * amp * k * k
      this.q.setFromAxisAngle(new THREE.Vector3(s.dir.z, 0, -s.dir.x), ang)
      this.compose(rec, this.q, 1, 0)
      this.scenery.setHarvestMatrix(rec, this.m)
    }
    // Falling trees.
    for (let i = this.falls.length - 1; i >= 0; i -= 1) {
      const f = this.falls[i]
      f.t += dt
      const creak = 0.28
      const fallDur = 1.05
      let ang: number
      if (f.t < creak) ang = 0.05 * (f.t / creak)
      else {
        const u = Math.min(1, (f.t - creak) / fallDur)
        ang = 0.05 + (Math.PI / 2 - 0.13) * u * u
        if (u >= 1) {
          if (!f.landed) {
            f.landed = true
            this.land(f)
          }
          // Small rebound after the crash.
          const b = f.t - creak - fallDur
          ang = Math.PI / 2 - 0.08 - Math.abs(Math.sin(b * 9)) * 0.1 * Math.exp(-b * 5)
        }
      }
      let sink = 0
      let scale = 1
      const settle = creak + fallDur + 0.9
      if (f.t > settle) {
        const u = Math.min(1, (f.t - settle) / 0.8)
        sink = u * 1.2
        scale = 1 - u * 0.85
        if (u >= 1) {
          this.group.remove(f.group)
          for (const m of f.meshes) m.dispose()
          this.falls.splice(i, 1)
          this.state[f.rec.id] = GONE
          this.timer[f.rec.id] = 0
          this.gone.push(f.rec.id)
          continue
        }
      }
      this.q.setFromAxisAngle(f.axis, ang)
      const pos = new THREE.Vector3(f.rec.x, f.rec.y - sink, f.rec.z)
      const rs = new THREE.Matrix4().makeRotationFromQuaternion(this.q).multiply(f.base)
      if (scale !== 1) rs.multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
      f.group.matrix.copy(rs).setPosition(pos)
      f.group.matrixWorldNeedsUpdate = true
    }
    // Regrowth once the hunter has moved on.
    for (let i = this.gone.length - 1; i >= 0; i -= 1) {
      const id = this.gone[i]
      this.timer[id] += dt
      const r = this.recs[id]
      if (this.timer[id] < RESOURCE_RESPAWN) continue
      if ((r.x - px) ** 2 + (r.z - pz) ** 2 < 32 * 32) continue
      this.gone.splice(i, 1)
      this.state[id] = REGROW
      this.timer[id] = 0
      this.regrowing.add(id)
    }
    for (const id of this.regrowing) {
      const r = this.recs[id]
      this.timer[id] += dt
      const u = Math.min(1, this.timer[id] / 1.4)
      // Ease-out-back pop.
      const c = 1.6
      const e = 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2)
      this.q.identity()
      this.compose(r, this.q, Math.max(0.01, e), 0)
      this.scenery.setHarvestMatrix(r, this.m)
      if (u >= 1) {
        this.regrowing.delete(id)
        this.scenery.setHarvestMatrix(r, r.matrix)
        this.state[id] = LIVE
        this.hp[id] = this.maxHp(r)
        this.colliders.enable(r.col, r.colR)
      }
    }
    this.rocks.update(dt, this.ground)
    this.chips.update(dt, this.ground)
  }

  /** rec.matrix rotated about its base by `q`, uniformly scaled by `s`, lowered by `sink`. */
  private compose(rec: HarvestRec, q: THREE.Quaternion, s: number, sink: number): void {
    const base = rec.matrix.clone().setPosition(0, 0, 0)
    this.m.makeRotationFromQuaternion(q).multiply(base)
    if (s !== 1) this.m.multiply(new THREE.Matrix4().makeScale(s, s, s))
    this.m.setPosition(rec.x, rec.y - sink, rec.z)
  }

  private land(f: Fall): void {
    const r = f.rec
    const len = Math.max(3, r.height * 0.9)
    for (let d = 1.5; d < len; d += 1.6) {
      const x = r.x + f.dir.x * d
      const z = r.z + f.dir.z * d
      this.fx.dustPuff(x, this.ground.heightAt(x, z) + 0.2, z, 5, '#d9c6a0', 1, 0.6)
    }
    const tx = r.x + f.dir.x * len * 0.8
    const tz = r.z + f.dir.z * len * 0.8
    this.fx.dustPuff(tx, this.ground.heightAt(tx, tz) + 0.5, tz, 14, LEAF[1], 2.2, 0.5)
    for (let i = 0; i < 10; i += 1) {
      const a = Math.random() * Math.PI * 2
      this.chips.emit(tx, this.ground.heightAt(tx, tz) + 0.5, tz, Math.cos(a) * 3, 3 + Math.random() * 3, Math.sin(a) * 3, 0.08 + Math.random() * 0.06, WOOD[i % 3], 1.6)
    }
    this.fx.shake(0.22)
    this.audio.play('stomp', 0.55)
    f.loot()
  }

  /** Visible transient effect count (for the prefetch/perf governor). */
  get activeCount(): number {
    return this.rocks.active + this.chips.active + this.falls.length * 20
  }

  /** Restore everything (new expedition). */
  reset(): void {
    for (const f of this.falls) {
      this.group.remove(f.group)
      for (const m of f.meshes) m.dispose()
    }
    this.falls.length = 0
    this.shakes.clear()
    this.regrowing.clear()
    this.gone.length = 0
    for (const r of this.recs) {
      if (this.state[r.id] !== LIVE) {
        this.scenery.setHarvestMatrix(r, r.matrix)
        this.colliders.enable(r.col, r.colR)
      }
      this.state[r.id] = LIVE
      this.hp[r.id] = this.maxHp(r)
    }
    this.rocks.clear()
    this.chips.clear()
  }
}
