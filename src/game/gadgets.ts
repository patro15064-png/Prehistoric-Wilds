import * as THREE from 'three'
import { GADGET_TUNING as GT, SLING_RANGE } from './data'
import type { Creature, CreatureCtx, HitOut, HoldKind } from './creatures'
import type { Fx } from './fx'
import type { Audio } from '../engine/audio'
import type { Ground } from './telegraphs'

export type TrapKind = 'snare' | 'pitfall'
type Trap = {
  kind: TrapKind
  x: number
  z: number
  y: number
  arm: number
  life: number
  mesh: THREE.Group
  ring: THREE.Mesh
  /** Set once sprung: seconds until the sprung trap is cleared. */
  sprung: number
  victim: Creature | null
}
type Pod = { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; mesh: THREE.Mesh }
type Shot = {
  pos: THREE.Vector3
  vel: THREE.Vector3
  left: number
  attack: number
  motion: number
  charged: boolean
  from: { x: number; z: number }
  mesh: THREE.Mesh
}
export type GadgetHooks = {
  onSpring?(c: Creature, kind: TrapKind, res: HoldKind | 'resisted'): void
  onFlash?(x: number, y: number, z: number, hits: { c: Creature; r: 'interrupt' | 'blind' | 'resisted' }[]): void
  onShotHit?(c: Creature, r: HitOut, point: THREE.Vector3, charged: boolean): void
}

const VINE = new THREE.MeshStandardMaterial({ color: '#5d6b2a', roughness: 0.95 })
const WOOD = new THREE.MeshStandardMaterial({ color: '#7a5634', roughness: 0.95 })
const LEAF = new THREE.MeshStandardMaterial({ color: '#6f8f32', roughness: 0.9, side: THREE.DoubleSide })
const HOLE = new THREE.MeshBasicMaterial({ color: '#1d140c' })
const STONE = new THREE.MeshStandardMaterial({ color: '#9a938a', roughness: 0.9 })
const POD = new THREE.MeshStandardMaterial({ color: '#d9e36a', roughness: 0.6, emissive: '#6d7a10', emissiveIntensity: 0.35 })

const ringMat = () => new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide })

function snareModel(): THREE.Group {
  const g = new THREE.Group()
  const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, 0.9, 6), WOOD)
  stake.position.set(0.9, 0.35, 0)
  stake.rotation.z = 0.25
  g.add(stake)
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.035, 5, 28), VINE)
  loop.rotation.x = Math.PI / 2
  loop.position.y = 0.05
  g.add(loop)
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.55, 4), VINE)
  cord.position.set(0.82, 0.3, 0)
  cord.rotation.z = 1.1
  g.add(cord)
  for (let i = 0; i < 5; i += 1) {
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.12), LEAF)
    const a = (i / 5) * Math.PI * 2 + 0.4
    leaf.position.set(Math.cos(a) * 0.7, 0.06, Math.sin(a) * 0.7)
    leaf.rotation.set(-Math.PI / 2 + 0.2, 0, a)
    g.add(leaf)
  }
  return g
}

function pitModel(): THREE.Group {
  const g = new THREE.Group()
  const hole = new THREE.Mesh(new THREE.CircleGeometry(GT.pitRadius * 0.9, 24), HOLE)
  hole.rotation.x = -Math.PI / 2
  hole.position.y = 0.04
  g.add(hole)
  for (let i = 0; i < 6; i += 1) {
    const twig = new THREE.Mesh(new THREE.BoxGeometry(GT.pitRadius * 1.9, 0.05, 0.06), WOOD)
    twig.position.y = 0.09 + (i % 2) * 0.03
    twig.rotation.y = (i / 6) * Math.PI + (Math.random() - 0.5) * 0.2
    g.add(twig)
  }
  for (let i = 0; i < 14; i += 1) {
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), LEAF)
    const a = Math.random() * Math.PI * 2
    const r = Math.random() * GT.pitRadius * 0.85
    leaf.position.set(Math.cos(a) * r, 0.13, Math.sin(a) * r)
    leaf.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.4, 0, Math.random() * 6)
    g.add(leaf)
  }
  return g
}

/** Placed traps, thrown flash pods and slung stones. */
export class Gadgets {
  readonly root = new THREE.Group()
  readonly traps: Trap[] = []
  private pods: Pod[] = []
  private shots: Shot[] = []
  private stoneGeo = new THREE.DodecahedronGeometry(0.1, 0)
  private podGeo = new THREE.SphereGeometry(0.16, 10, 8)
  private time = 0

  constructor(scene: THREE.Scene, private readonly ground: Ground, private readonly fx: Fx, private readonly audio: Audio) {
    this.root.name = 'gadgets'
    scene.add(this.root)
  }

  /** Why a trap cannot go here, or null when it can. */
  canPlace(x: number, z: number, safe: { x: number; z: number }): string | null {
    if (Math.hypot(x - safe.x, z - safe.z) < GT.campNoTrap) return 'Too close to camp — beasts never come here'
    if (this.ground.heightAt(x, z) < -0.3) return 'Cannot set a trap in water'
    if (this.traps.some(t => t.sprung <= 0 && Math.hypot(t.x - x, t.z - z) < 2.5)) return 'Another trap is already here'
    return null
  }

  place(kind: TrapKind, x: number, z: number, yaw: number): void {
    const y = this.ground.heightAt(x, z)
    const mesh = kind === 'snare' ? snareModel() : pitModel()
    mesh.position.set(x, y, z)
    mesh.rotation.y = yaw
    mesh.traverse(o => {
      if ((o as THREE.Mesh).isMesh) o.receiveShadow = true
    })
    const r = kind === 'snare' ? GT.snareRadius : GT.pitRadius
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.94, r, 40), ringMat())
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.08
    mesh.add(ring)
    this.root.add(mesh)
    this.traps.push({ kind, x, z, y, arm: kind === 'snare' ? GT.snareArm : 0, life: GT.trapLife, mesh, ring, sprung: 0, victim: null })
    this.fx.dustPuff(x, y, z, kind === 'pitfall' ? 14 : 6, '#b59a70', r * 0.7)
    this.audio.play(kind === 'snare' ? 'snare' : 'pitfall', 0.45)
  }

  /** Lob a flash pod toward `to`; it bursts on landing. */
  throwFlash(from: THREE.Vector3, to: THREE.Vector3): void {
    const d = from.distanceTo(to)
    const mesh = new THREE.Mesh(this.podGeo, POD)
    mesh.position.copy(from)
    this.root.add(mesh)
    this.pods.push({ from: from.clone(), to: to.clone(), t: 0, dur: Math.max(0.35, Math.min(GT.flashFuse, d / 16)), mesh })
    this.audio.play('swing', 0.6)
  }

  /** Fire a sling stone along `dir` (normalised). */
  shoot(from: THREE.Vector3, dir: THREE.Vector3, attack: number, motion: number, charged: boolean, shooter: { x: number; z: number }): void {
    const mesh = new THREE.Mesh(this.stoneGeo, STONE)
    mesh.position.copy(from)
    this.root.add(mesh)
    const speed = charged ? 56 : 44
    this.shots.push({ pos: from.clone(), vel: dir.clone().multiplyScalar(speed), left: SLING_RANGE * (charged ? 1.5 : 1), attack, motion, charged, from: shooter, mesh })
    this.audio.play('slingShot', charged ? 1.1 : 0.9)
    this.fx.dustPuff(from.x, from.y - 0.2, from.z, 2, '#d8c6a0', 0.2, 0.3)
  }

  get active(): number {
    return this.traps.length + this.pods.length + this.shots.length
  }

  update(dt: number, creatures: readonly Creature[], cctx: CreatureCtx, hooks: GadgetHooks): void {
    this.time += dt
    // Traps
    for (let i = this.traps.length - 1; i >= 0; i -= 1) {
      const T = this.traps[i]
      const mat = T.ring.material as THREE.MeshBasicMaterial
      if (T.sprung > 0) {
        T.sprung -= dt
        mat.opacity = 0
        if (T.kind === 'snare' && T.victim) {
          // The loop cinches around the beast's legs.
          T.mesh.position.set(T.victim.pos.x, T.victim.pos.y, T.victim.pos.z)
          const k = Math.max(0.35, T.victim.def.radius * 0.5)
          T.mesh.scale.setScalar(THREE.MathUtils.lerp(T.mesh.scale.x, k, 1 - Math.exp(-dt * 12)))
        }
        if (T.sprung <= 0 || (T.victim && T.victim.state !== 'held')) this.remove(i, true)
        continue
      }
      T.life -= dt
      if (T.life <= 0) {
        this.remove(i, true)
        continue
      }
      if (T.arm > 0) {
        T.arm -= dt
        mat.opacity = 0.12
        continue
      }
      // Armed: faint pulsing outline (kept dim to avoid glare).
      mat.opacity = 0.18 + Math.sin(this.time * 3 + i) * 0.08
      const r = T.kind === 'snare' ? GT.snareRadius : GT.pitRadius
      for (const c of creatures) {
        if (!c.alive || c.puppet) continue
        if (Math.hypot(c.pos.x - T.x, c.pos.z - T.z) > r + c.def.radius * 0.5) continue
        const res = c.trap(T.kind === 'snare' ? 'snare' : 'pit', cctx)
        if (!res) continue
        this.audio.play(T.kind === 'snare' ? 'snare' : 'pitfall')
        this.fx.dustPuff(T.x, T.y, T.z, 16, '#b59a70', r)
        this.fx.crack(T.x, T.y, T.z, r * 1.1, 1.2)
        hooks.onSpring?.(c, T.kind, res)
        if (res === 'resisted') {
          this.fx.sparks(new THREE.Vector3(T.x, T.y + 0.5, T.z), '#c8b890', 12, 5)
          this.remove(i, true)
        } else {
          T.sprung = GT.pitHold + 1
          T.victim = c
          if (T.kind === 'pitfall') T.mesh.children.forEach(o => {
            if (o !== T.ring && (o as THREE.Mesh).geometry?.type !== 'CircleGeometry') o.visible = false
          })
        }
        break
      }
    }
    // Flash pods
    for (let i = this.pods.length - 1; i >= 0; i -= 1) {
      const P = this.pods[i]
      P.t += dt
      const k = Math.min(1, P.t / P.dur)
      P.mesh.position.lerpVectors(P.from, P.to, k)
      P.mesh.position.y += Math.sin(k * Math.PI) * (1.2 + P.from.distanceTo(P.to) * 0.12)
      P.mesh.rotation.x += dt * 14
      if (Math.random() < dt * 30) this.fx.sparks(P.mesh.position, '#f4f7b0', 1, 1)
      if (k >= 1) {
        const p = P.to
        this.root.remove(P.mesh)
        this.pods.splice(i, 1)
        this.burst(p, creatures, cctx, hooks)
      }
    }
    // Sling stones: swept sphere test against every living beast.
    const prev = new THREE.Vector3()
    const seg = new THREE.Vector3()
    const cen = new THREE.Vector3()
    for (let i = this.shots.length - 1; i >= 0; i -= 1) {
      const S = this.shots[i]
      prev.copy(S.pos)
      S.vel.y -= 3 * dt
      S.pos.addScaledVector(S.vel, dt)
      S.left -= S.vel.length() * dt
      S.mesh.position.copy(S.pos)
      S.mesh.rotation.x += dt * 20
      if (Math.random() < dt * 25) this.fx.dustPuff(S.pos.x, S.pos.y, S.pos.z, 1, '#e6ddc8', 0.05, 0.1)
      let hit = false
      seg.subVectors(S.pos, prev)
      const L2 = Math.max(1e-6, seg.lengthSq())
      for (const c of creatures) {
        if (!c.alive) continue
        c.center(cen)
        const k = THREE.MathUtils.clamp(cen.clone().sub(prev).dot(seg) / L2, 0, 1)
        const closest = prev.clone().addScaledVector(seg, k)
        const rr = c.def.radius * 0.8 + 0.25
        const dy = Math.abs(closest.y - cen.y)
        if (Math.hypot(closest.x - cen.x, closest.z - cen.z) > rr || dy > c.def.height * 0.75 + 0.3) continue
        const res = c.takeHit(S.attack, S.motion, S.charged, S.from, cctx, { ranged: true, headStagger: S.charged && S.motion >= 2.35 })
        this.fx.dustPuff(closest.x, closest.y, closest.z, 5, '#cfc6b4', 0.4)
        hooks.onShotHit?.(c, res, closest, S.charged)
        hit = true
        break
      }
      const gy = this.ground.heightAt(S.pos.x, S.pos.z)
      if (!hit && S.pos.y <= gy) {
        this.fx.dustPuff(S.pos.x, gy, S.pos.z, 5, '#d8c6a0', 0.4)
        this.audio.play('stepStone', 0.5)
        hit = true
      }
      if (hit || S.left <= 0) {
        this.root.remove(S.mesh)
        this.shots.splice(i, 1)
      }
    }
  }

  private burst(p: THREE.Vector3, creatures: readonly Creature[], cctx: CreatureCtx, hooks: GadgetHooks): void {
    const y = this.ground.heightAt(p.x, p.z)
    const c0 = new THREE.Vector3(p.x, y + 1.2, p.z)
    this.fx.impactFlash(c0, '#fffbe0', 8, 0.3)
    this.fx.sparks(c0, '#fffbe0', 40, 11)
    this.fx.ring(p.x, y + 0.1, p.z, 0.5, GT.flashRadius, '#fffbe0', 0.5)
    this.fx.shake(0.15)
    this.audio.play('flash')
    const hits: { c: Creature; r: 'interrupt' | 'blind' | 'resisted' }[] = []
    for (const c of creatures) {
      const r = c.flashAt(p.x, p.z, cctx)
      if (r !== 'miss') hits.push({ c, r })
    }
    hooks.onFlash?.(p.x, y, p.z, hits)
  }

  private remove(i: number, puff: boolean): void {
    const T = this.traps[i]
    if (puff) this.fx.dustPuff(T.mesh.position.x, T.mesh.position.y, T.mesh.position.z, 6, '#b59a70', 0.8)
    this.root.remove(T.mesh)
    T.mesh.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh && m.geometry !== this.stoneGeo && m.geometry !== this.podGeo) m.geometry.dispose()
    })
    ;(T.ring.material as THREE.Material).dispose()
    this.traps.splice(i, 1)
  }

  clear(): void {
    while (this.traps.length) this.remove(this.traps.length - 1, false)
    for (const P of this.pods) this.root.remove(P.mesh)
    for (const S of this.shots) this.root.remove(S.mesh)
    this.pods = []
    this.shots = []
  }
}
