import * as THREE from 'three'
import { CONFIG } from './config'
import { COUNTER_MULT, COUNTER_WINDOW, SPEAR_LUNGE, WEAPON_CLASSES, type GearId, type HeldId } from './data'
import { buildToolModel } from './toolModels'
import type { Creature, CreatureCtx, HitResult, PlayerLike } from './creatures'
import type { Colliders } from './colliders'
import type { Fx } from './fx'
import type { Audio } from '../engine/audio'
import type { Input } from '../engine/input'
import type { Ground } from './telegraphs'
import { takenDamage, type GearStats } from './rules'
import { GEAR } from './data'
import { HunterAvatar, type AnimDrive } from './hunterModel'

export type PState = 'move' | 'attack' | 'charge' | 'heavy' | 'dodge' | 'flinch' | 'down' | 'getup' | 'heal' | 'gather' | 'carve' | 'throw' | 'dead'

type V3 = [number, number, number]
const TAU = Math.PI * 2
const wrap = (a: number) => {
  a = (a + Math.PI) % TAU
  return (a < 0 ? a + TAU : a) - Math.PI
}
const approach = (a: number, b: number, rate: number) => a + (b - a) * (1 - Math.exp(-rate))
const smooth = (k: number) => k * k * (3 - 2 * k)

/** Light combo: windup → active (hit frames) → recovery. Chain the next hit during recovery. */
const LIGHT = [
  { windup: 0.17, active: 0.1, recovery: 0.3, motion: 1.0, lunge: 1.1 },
  { windup: 0.15, active: 0.1, recovery: 0.32, motion: 1.1, lunge: 0.9 },
  { windup: 0.27, active: 0.12, recovery: 0.52, motion: 1.5, lunge: 1.6 },
]
/** Spear: two quick narrow pokes, then a committed lunging finisher with a long recovery. */
const SPEAR_LIGHT = [
  { windup: 0.13, active: 0.08, recovery: 0.34, motion: 0.95, lunge: 0.9 },
  { windup: 0.12, active: 0.08, recovery: 0.36, motion: 1.0, lunge: 0.8 },
  { windup: 0.3, active: 0.11, recovery: 0.6, motion: 1.6, lunge: 2.3 },
]
/** Counter-thrust after a perfect dodge: near-instant, big, and short enough to dodge out of. */
const COUNTER_MOVE = { windup: 0.06, active: 0.12, recovery: 0.3, lunge: 2.6 }
/** Sling: a deliberate first flick, then a faster rhythm while you keep firing. */
const SLING_LIGHT = [
  { windup: 0.26, active: 0.06, recovery: 0.34, motion: 1.0, lunge: 0 },
  { windup: 0.18, active: 0.06, recovery: 0.32, motion: 1.0, lunge: 0 },
  { windup: 0.18, active: 0.06, recovery: 0.42, motion: 1.1, lunge: 0 },
]
const HEAVY_MOTION = [1.7, 2.25, 3.0]
const HEAVY_LEVEL_T = [0.45, 0.95]
/** Sling whirl builds faster than a club charge (it has to be released to do anything). */
const SLING_LEVEL_T = [0.38, 0.8]

type Bones = {
  hips: THREE.Group; torso: THREE.Group; head: THREE.Group
  shR: THREE.Group; elR: THREE.Group; handR: THREE.Group
  shL: THREE.Group; elL: THREE.Group
  legR: THREE.Group; kneeR: THREE.Group; legL: THREE.Group; kneeL: THREE.Group
  outfit: THREE.Group; weapon: THREE.Group
}
type Pose = {
  hipY: number; hipPitch: number; hipRoll: number; lean: number; twist: number; headPitch: number
  shRx: number; shRz: number; elR: number; shLx: number; shLz: number; elL: number
  legR: number; legL: number; kneeR: number; kneeL: number
}
const rest = (): Pose => ({ hipY: 0, hipPitch: 0, hipRoll: 0, lean: 0, twist: 0, headPitch: 0, shRx: 0, shRz: -0.12, elR: 0.2, shLx: 0, shLz: 0.12, elL: 0.2, legR: 0, legL: 0, kneeR: 0, kneeL: 0 })

const std = (color: string, rough = 0.85, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true, ...extra })
const ico = new THREE.IcosahedronGeometry(1, 1)
function put(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 | number = 1): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(...pos)
  m.rotation.set(...rot)
  if (typeof scale === 'number') m.scale.setScalar(scale)
  else m.scale.set(...scale)
  m.castShadow = true
  parent.add(m)
  return m
}
const limb = (rt: number, rb: number, h: number) => new THREE.CylinderGeometry(rt, rb, h, 7).translate(0, -h / 2, 0)
const grp = (parent: THREE.Object3D, pos: V3 = [0, 0, 0]) => {
  const g = new THREE.Group()
  g.position.set(...pos)
  parent.add(g)
  return g
}

const SKIN = std('#c98a5e')
const SKIN_D = std('#a86c46')
const HAIR = std('#3a2418', 0.95)

export function buildCaveman(): { root: THREE.Group; bones: Bones } {
  const root = new THREE.Group()
  root.name = 'caveman'
  const hips = grp(root, [0, 0.98, 0])
  put(hips, ico, SKIN_D, [0, 0.02, 0], [0, 0, 0], [0.26, 0.16, 0.18])
  const torso = grp(hips, [0, 0.08, 0])
  put(torso, ico, SKIN, [0, 0.32, 0], [0, 0, 0], [0.33, 0.36, 0.23])
  put(torso, ico, SKIN, [0, 0.5, 0.02], [0, 0, 0], [0.4, 0.2, 0.25])
  const head = grp(torso, [0, 0.72, 0.02])
  put(head, ico, SKIN, [0, 0.14, 0.02], [0, 0, 0], [0.19, 0.22, 0.2])
  put(head, ico, HAIR, [0, 0.24, -0.05], [0, 0, 0], [0.23, 0.2, 0.23])
  put(head, ico, HAIR, [0, 0.12, -0.12], [0, 0, 0], [0.2, 0.2, 0.14])
  put(head, ico, HAIR, [0, 0.0, 0.12], [0.3, 0, 0], [0.15, 0.14, 0.1])
  put(head, new THREE.BoxGeometry(0.3, 0.06, 0.08), SKIN_D, [0, 0.2, 0.17])
  put(head, ico, SKIN_D, [0, 0.12, 0.22], [0, 0, 0], [0.045, 0.06, 0.05])
  for (const s of [-1, 1]) put(head, ico, std('#1a120c', 0.4), [s * 0.07, 0.16, 0.19], [0, 0, 0], 0.022)
  const arm = (side: number) => {
    const sh = grp(torso, [side * 0.38, 0.55, 0])
    put(sh, ico, SKIN, [0, -0.02, 0], [0, 0, 0], 0.12)
    put(sh, limb(0.085, 0.07, 0.32), SKIN)
    const el = grp(sh, [0, -0.32, 0])
    put(el, limb(0.07, 0.06, 0.28), SKIN)
    const hand = grp(el, [0, -0.3, 0])
    put(hand, ico, SKIN_D, [0, 0, 0], [0, 0, 0], 0.075)
    return { sh, el, hand }
  }
  const R = arm(-1)
  const L = arm(1)
  const leg = (side: number) => {
    const hip = grp(hips, [side * 0.14, -0.04, 0])
    put(hip, limb(0.1, 0.08, 0.46), SKIN)
    const knee = grp(hip, [0, -0.46, 0])
    put(knee, limb(0.08, 0.065, 0.44), SKIN)
    put(knee, new THREE.BoxGeometry(0.13, 0.07, 0.24), SKIN_D, [0, -0.46, 0.05])
    return { hip, knee }
  }
  const LR = leg(-1)
  const LL = leg(1)
  const outfit = grp(root)
  const weapon = grp(R.hand)
  const bones: Bones = { hips, torso, head, shR: R.sh, elR: R.el, handR: R.hand, shL: L.sh, elL: L.el, legR: LR.hip, kneeR: LR.knee, legL: LL.hip, kneeL: LL.knee, outfit, weapon }
  return { root, bones }
}

/** Replace the outfit meshes to match the equipped armour tier. */
export function dressCaveman(b: Bones, armor: GearId): void {
  for (const g of [b.hips, b.torso, b.shL, b.shR]) {
    for (const c of [...g.children]) if (c.userData.outfit) g.remove(c)
  }
  const tag = (m: THREE.Mesh) => {
    m.userData.outfit = true
    return m
  }
  const skirt = (color: string, len: number, flare: number) => tag(put(b.hips, new THREE.CylinderGeometry(0.27, 0.27 + flare, len, 9, 1, true).translate(0, -len / 2 + 0.08, 0), std(color, 0.9, { side: THREE.DoubleSide })))
  if (armor === 'leafWraps') {
    const leaf = std('#5aa83a', 0.8, { side: THREE.DoubleSide })
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * TAU
      tag(put(b.hips, new THREE.ConeGeometry(0.09, 0.34, 4).translate(0, -0.17, 0), leaf, [Math.sin(a) * 0.25, 0.02, Math.cos(a) * 0.2], [Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25]))
    }
    tag(put(b.torso, new THREE.TorusGeometry(0.3, 0.035, 4, 12), std('#7a5a2a'), [0, 0.3, 0], [0.4, 0, 0.5], [1, 1.25, 1]))
  } else if (armor === 'hideGarb') {
    skirt('#8a5a38', 0.36, 0.08)
    tag(put(b.torso, ico, std('#9a6440', 0.95), [0, 0.34, 0], [0, 0, 0], [0.35, 0.3, 0.25]))
    for (const s of [-1, 1]) tag(put(s < 0 ? b.shR : b.shL, ico, std('#5fae8d', 0.5), [0, 0.03, 0], [0, 0, 0], [0.16, 0.09, 0.15]))
    tag(put(b.torso, new THREE.TorusGeometry(0.34, 0.04, 4, 12), std('#c9b27a'), [0, 0.12, 0], [Math.PI / 2, 0, 0]))
  } else if (armor === 'stalkerPlate') {
    skirt('#d99a4a', 0.4, 0.1)
    for (let i = 0; i < 3; i += 1) tag(put(b.hips, new THREE.BoxGeometry(0.62, 0.035, 0.02), std('#8a4d2a'), [0, -0.05 - i * 0.1, 0.28]))
    tag(put(b.torso, ico, std('#c98a4a', 0.9), [0, 0.34, 0], [0, 0, 0], [0.35, 0.31, 0.25]))
    for (let i = 0; i < 3; i += 1) tag(put(b.torso, new THREE.BoxGeometry(0.42 - i * 0.06, 0.08, 0.06), std('#f1e6cc', 0.5), [0, 0.46 - i * 0.12, 0.22]))
    for (const s of [-1, 1]) {
      const sh = s < 0 ? b.shR : b.shL
      tag(put(sh, ico, std('#f1e6cc', 0.5), [0, 0.04, 0], [0, 0, 0], [0.17, 0.08, 0.16]))
      tag(put(sh, new THREE.ConeGeometry(0.04, 0.18, 4), std('#f1e6cc', 0.5), [s * 0.08, 0.1, 0], [0, 0, -s * 0.6]))
    }
  } else {
    skirt('#4a3f3c', 0.44, 0.12)
    tag(put(b.torso, ico, std('#6b5a58', 0.95), [0, 0.36, 0], [0, 0, 0], [0.37, 0.33, 0.27]))
    const cloak = tag(put(b.torso, new THREE.ConeGeometry(0.55, 1.05, 10, 1, true, Math.PI * 0.2, Math.PI * 1.6).translate(0, -0.35, 0), std('#3a302e', 0.95, { side: THREE.DoubleSide }), [0, 0.62, -0.06], [0.12, Math.PI, 0]))
    cloak.scale.set(1, 1, 0.6)
    tag(put(b.torso, new THREE.TorusGeometry(0.36, 0.04, 4, 14), std('#ff7a2e', 0.4, { emissive: '#ff5a1a', emissiveIntensity: 0.9 }), [0, 0.6, 0], [Math.PI / 2, 0, 0]))
    for (const s of [-1, 1]) tag(put(s < 0 ? b.shR : b.shL, new THREE.BoxGeometry(0.28, 0.1, 0.26), std('#8f8a7a'), [s * 0.02, 0.06, 0], [0, 0, -s * 0.3]))
  }
}

/** Replace the weapon model. Returns its visual reach (metres). */
export function armCaveman(b: Bones, weapon: GearId | HeldId): void {
  b.weapon.clear()
  if (weapon === 'hands') return
  const w = grp(b.weapon)
  // Weapon extends forward-down from the fist.
  w.rotation.x = 1.25
  if (weapon === 'flintHatchet' || weapon === 'flintPick') {
    w.add(buildToolModel(weapon, weapon === 'flintPick' ? 0.95 : 0.85))
    return
  }
  const wood = std('#7a4e2c')
  const lash = std('#c9b27a')
  if (weapon === 'boneSpear' || weapon === 'stalkerLance') {
    const L = weapon === 'boneSpear' ? 1.7 : 1.85
    put(w, new THREE.CylinderGeometry(0.03, 0.028, L, 7).translate(0, L * 0.38, 0), weapon === 'boneSpear' ? std('#e4d8b8', 0.7) : wood)
    put(w, new THREE.ConeGeometry(0.06, 0.3, 4), weapon === 'boneSpear' ? std('#6d7f96', 0.5) : std('#f0e6cc', 0.5), [0, L * 0.88 + 0.12, 0])
    put(w, new THREE.TorusGeometry(0.04, 0.018, 4, 8), lash, [0, L * 0.85, 0], [Math.PI / 2, 0, 0])
    return
  }
  if (weapon === 'reedSling' || weapon === 'sinewSling') {
    put(w, new THREE.CylinderGeometry(0.035, 0.03, 0.2, 6).translate(0, 0.05, 0), weapon === 'reedSling' ? std('#c9b27a') : std('#e4d8b8', 0.7))
    put(w, new THREE.CylinderGeometry(0.008, 0.008, 0.5, 4).translate(0, 0.4, 0), std('#8a6a44'))
    put(w, ico, std('#6b4a2c'), [0, 0.68, 0], [0, 0, 0], [0.09, 0.05, 0.09])
    return
  }
  if (weapon === 'club') {
    put(w, new THREE.CylinderGeometry(0.05, 0.035, 0.8, 7).translate(0, 0.3, 0), wood)
    put(w, ico, std('#8a5a34'), [0, 0.72, 0], [0, 0, 0], [0.13, 0.2, 0.13])
    put(w, ico, std('#6a4424'), [0.06, 0.62, 0.05], [0, 0, 0], 0.07)
  } else if (weapon === 'flintMaul') {
    put(w, new THREE.CylinderGeometry(0.045, 0.04, 0.95, 7).translate(0, 0.35, 0), wood)
    put(w, new THREE.DodecahedronGeometry(0.2, 0), std('#6d7f96', 0.5), [0, 0.86, 0], [0.3, 0.4, 0], [1.3, 0.9, 1])
    put(w, new THREE.TorusGeometry(0.07, 0.025, 4, 8), lash, [0, 0.72, 0], [Math.PI / 2, 0, 0])
    put(w, new THREE.ConeGeometry(0.05, 0.2, 4), std('#f4ead2'), [0, 1.06, 0])
  } else if (weapon === 'amberHammer') {
    put(w, new THREE.CylinderGeometry(0.05, 0.045, 1.05, 7).translate(0, 0.38, 0), wood)
    put(w, new THREE.OctahedronGeometry(0.2, 0), std('#ffb23e', 0.3, { emissive: '#ff8a1a', emissiveIntensity: 1.2 }), [0, 0.95, 0], [0, 0.5, 0], [1.2, 1.1, 1.2])
    for (const s of [-1, 1]) put(w, new THREE.ConeGeometry(0.06, 0.45, 5), std('#f4ead2', 0.5), [s * 0.2, 0.9, 0], [0, 0, s * 1.3])
    put(w, new THREE.TorusGeometry(0.08, 0.025, 4, 8), lash, [0, 0.76, 0], [Math.PI / 2, 0, 0])
  } else {
    put(w, new THREE.CylinderGeometry(0.06, 0.05, 1.15, 7).translate(0, 0.42, 0), std('#d7c9a0', 0.6))
    put(w, ico, std('#3a2d4a', 0.3), [0, 1.0, 0], [0, 0, 0], [0.2, 0.3, 0.2])
    const glass = std('#5b4b8a', 0.15, { emissive: '#7a3aff', emissiveIntensity: 0.7, metalness: 0.2 })
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * TAU
      put(w, new THREE.ConeGeometry(0.06, 0.34, 4), glass, [Math.cos(a) * 0.17, 0.95 + (i % 2) * 0.14, Math.sin(a) * 0.17], [Math.sin(a) * 1.4, 0, -Math.cos(a) * 1.4])
    }
    put(w, new THREE.ConeGeometry(0.08, 0.35, 4), glass, [0, 1.35, 0])
  }
  w.traverse(o => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true
  })
}

export type PlayerCtx = {
  input: Input
  camYaw: number
  ground: Ground
  colliders: Colliders
  creatures: Creature[]
  aim: Creature | null
  locked: boolean
  fx: Fx
  audio: Audio
  cctx: CreatureCtx
  onHit(c: Creature, r: ReturnType<Creature['takeHit']>, point: THREE.Vector3, heavy: boolean): void
  poultices(): number
  consumePoultice(): void
  onDodge?(): void
  onError?(msg: string): void
  /** Yaw toward a tree/boulder roughly in front of `yaw` (soft aim for chopping), or null. */
  harvestAim?(yaw: number): number | null
  /** Active-frame hit test against trees/boulders. Returns true if something was struck. */
  harvestStrike?(heavy: boolean, charge: number): boolean
  // ANIMAL SYSTEM HOOK
  animalStrike?(attack: number, motion: number, heavy: boolean, reach: number, arcMult: number): boolean
  /** Sling: fire a stone. Returns false when out of ammo. */
  shoot?(from: THREE.Vector3, yaw: number, motion: number, charged: boolean): boolean
  /** Spear counter-thrust landed its opening (UI callout). */
  onCounter?(): void
}

export class Player implements PlayerLike {
  readonly root: THREE.Group
  readonly bones: Bones
  readonly pos = new THREE.Vector3()
  readonly vel = new THREE.Vector3()
  readonly radius = CONFIG.player.radius
  yaw = 0
  hp = 100
  maxHp = 100
  stamina = 100
  state: PState = 'move'
  t = 0
  step = 0
  chargeLevel = 0
  stats: GearStats = { attack: 12, defense: 0, maxHp: 100, heatProof: false, carves: 0, canMine: false, cls: 'club', maxStamina: 100, staRegen: 1, dodgeCost: 1, heatRate: 1 }
  tier = 0
  lastDamageT = 99
  /** Recent damage for the HUD's white "lost" chunk. */
  recentHp = 100
  staminaFlash = 0
  sprinting = false
  private exhausted = false
  private staminaT = 0
  private buffer: 'light' | 'heavy' | 'dodge' | null = null
  private bufferT = 0
  private hitSet = new Set<number>()
  private harvestDone = false
  /** What is in hand; affects reach, attack (via stats) and the visible model. */
  held: HeldId = 'weapon'
  private pose: Pose = rest()
  private gait = 0
  private lastStep = 0
  private dodgeDir = new THREE.Vector3()
  private knock = new THREE.Vector3()
  private graceT = 0
  private healed = false
  private task: { dur: number; done: () => void; cancel?: () => void } | null = null
  private moveSpeed = 0
  private impactDone = false
  /** Realistic rigged hunter (procedural caveman stays as placeholder until it streams in). */
  readonly avatar = new HunterAvatar()
  private hurtFlash = 0
  /** Seconds left to launch a spear counter-thrust after a perfect dodge. */
  counterT = 0
  /** The current light attack is a counter-thrust. */
  countering = false
  private throwDone: (() => void) | null = null
  private throwCancel: (() => void) | null = null

  constructor() {
    const c = buildCaveman()
    this.root = c.root
    this.bones = c.bones
    this.root.rotation.order = 'YXZ'
    this.root.add(this.avatar.holder)
    this.avatar.onReady = () => { this.bones.hips.visible = false }
  }

  /** World-space weapon tip (realistic model when loaded, else an estimate). */
  get weaponTip(): THREE.Vector3 {
    return this.avatar.ready ? this.avatar.tip : this.tipPoint()
  }

  get alive(): boolean {
    return this.state !== 'dead'
  }
  get iframes(): boolean {
    if (this.state === 'dodge') return this.t >= CONFIG.player.iframeStart && this.t <= CONFIG.player.iframeEnd
    return this.state === 'getup' || this.graceT > 0
  }
  get busy(): boolean {
    return this.state !== 'move'
  }
  get healing(): boolean {
    return this.state === 'heal'
  }
  get maxStamina(): number {
    return this.stats.maxStamina
  }
  /** Moveset of the thing in hand. */
  get cls() {
    // Tools and bare fists swing like a club, whatever weapon is stowed.
    return WEAPON_CLASSES[this.held === 'weapon' ? this.stats.cls : 'club']
  }
  /** Light attack timings scaled by weapon class speed (sling shots are quick flicks). */
  private light(step: number) {
    const armed = this.held === 'weapon'
    const cls = armed ? this.stats.cls : 'club'
    const A = cls === 'spear' ? SPEAR_LIGHT[step] : cls === 'sling' ? SLING_LIGHT[step] : LIGHT[step]
    const sp = this.cls.speed
    if (this.countering) {
      return { windup: COUNTER_MOVE.windup, active: COUNTER_MOVE.active, recovery: COUNTER_MOVE.recovery, motion: A.motion * this.cls.motion * COUNTER_MULT, lunge: COUNTER_MOVE.lunge }
    }
    return { windup: A.windup / sp, active: A.active, recovery: A.recovery / sp, motion: A.motion * this.cls.motion, lunge: A.lunge }
  }
  /** Begin a short throw (flash pod); `done` fires at release. */
  startThrow(done: () => void, cancel?: () => void): boolean {
    if (this.state !== 'move') return false
    this.setState('throw')
    this.throwDone = done
    this.throwCancel = cancel ?? null
    return true
  }

  /** Abandon an in-progress task or throw (hit, faint or dodge-cancel); fires its cancel hook. */
  private interruptTask(): void {
    const c = this.task?.cancel ?? null
    const tc = this.throwDone ? this.throwCancel : null
    this.task = null
    this.throwDone = null
    this.throwCancel = null
    c?.()
    tc?.()
  }
  setGear(stats: GearStats, weapon: GearId, armor: GearId, tier: number, held: HeldId = 'weapon'): void {
    this.held = held
    const ratio = this.hp / this.maxHp
    this.stats = stats
    this.stamina = Math.min(this.stamina, stats.maxStamina)
    this.maxHp = stats.maxHp
    this.hp = Math.max(1, Math.round(ratio * this.maxHp))
    this.recentHp = this.hp
    this.tier = tier
    dressCaveman(this.bones, armor)
    armCaveman(this.bones, held === 'weapon' ? weapon : held)
    this.avatar.setTier(GEAR[armor]?.tier ?? 0)
    this.avatar.setWeapon(held === 'weapon' ? weapon : held)
  }

  place(x: number, z: number, ground: Ground, yaw = 0): void {
    this.pos.set(x, ground.heightAt(x, z), z)
    this.yaw = yaw
    this.vel.set(0, 0, 0)
    this.sync()
  }

  revive(): void {
    this.hp = this.maxHp
    this.recentHp = this.hp
    this.stamina = this.maxStamina
    this.state = 'move'
    this.t = 0
    this.pose = rest()
    this.task = null
  }

  restore(): void {
    this.hp = this.maxHp
    this.recentHp = this.hp
    this.stamina = this.maxStamina
  }

  /** Begin a timed interaction (gather/carve). */
  startTask(kind: 'gather' | 'carve', dur: number, done: () => void, cancel?: () => void): boolean {
    if (this.state !== 'move') return false
    this.state = kind
    this.t = 0
    this.task = { dur, done, cancel }
    this.vel.set(0, 0, 0)
    return true
  }

  private setState(s: PState): void {
    this.state = s
    this.t = 0
  }

  private spend(_n: number): void {
    this.stamina = this.maxStamina
    this.staminaT = 0
  }

  receiveHit(damage: number, knock: 'flinch' | 'down', from: { x: number; z: number }, _source: string): HitResult {
    if (this.state === 'dead') return 'ignored'
    if (!this.iframes) this.hurtFlash = 1
    if (this.iframes) {
      if (this.state === 'dodge') this.counterT = COUNTER_WINDOW + Math.max(0, CONFIG.player.dodgeTime - this.t)
      return 'dodged'
    }
    const dmg = takenDamage(damage, this.stats.defense)
    this.hurt(dmg)
    const away = new THREE.Vector3(this.pos.x - from.x, 0, this.pos.z - from.z)
    if (away.lengthSq() < 1e-4) away.set(Math.sin(this.yaw + Math.PI), 0, Math.cos(this.yaw + Math.PI))
    away.normalize()
    this.interruptTask()
    this.graceT = 0.35
    if (this.hp <= 0) {
      this.setState('dead')
      this.knock.copy(away).multiplyScalar(6)
    } else if (knock === 'down') {
      this.setState('down')
      this.knock.copy(away).multiplyScalar(8)
      this.yaw = Math.atan2(-away.x, -away.z)
    } else {
      this.setState('flinch')
      this.knock.copy(away).multiplyScalar(3.5)
    }
    return 'hit'
  }

  /** Direct damage without a reaction (heat). */
  hurt(dmg: number): void {
    if (this.state === 'dead') return
    if (this.lastDamageT > 0.8) this.recentHp = this.hp
    this.hp = Math.max(0, this.hp - dmg)
    this.lastDamageT = 0
    if (this.hp <= 0) {
      this.setState('dead')
      this.interruptTask()
    }
  }

  update(dt: number, ctx: PlayerCtx): void {
    const C = CONFIG.player
    const I = ctx.input
    this.t += dt
    this.graceT = Math.max(0, this.graceT - dt)
    this.lastDamageT += dt
    this.staminaFlash = Math.max(0, this.staminaFlash - dt * 3)
    if (this.lastDamageT > 0.9) this.recentHp = approach(this.recentHp, this.hp, dt * 4)
    this.bufferT -= dt
    if (this.bufferT <= 0) this.buffer = null
    this.counterT = Math.max(0, this.counterT - dt)
    if (I.consume('light')) this.queue('light')
    if (I.consume('heavy')) this.queue('heavy')
    if (I.consume('dodge')) this.queue('dodge')
    const healPressed = I.consume('heal')

    // Desired move direction in world space (camera relative).
    const fy = Math.sin(ctx.camYaw)
    const fz = Math.cos(ctx.camYaw)
    const mx = I.move.x
    const my = I.move.y
    const wish = new THREE.Vector3(fy * my - fz * mx, 0, fz * my + fy * mx)
    const wishLen = Math.min(1, wish.length())
    if (wishLen > 0.01) wish.normalize()
    const aimYaw = ctx.aim ? Math.atan2(ctx.aim.pos.x - this.pos.x, ctx.aim.pos.z - this.pos.z) : null
    let target = rest()
    let speed = 0
    let face: number | null = null

    // Stamina regen.
    this.staminaT -= dt
    const draining = this.sprinting || this.state === 'dodge' || this.state === 'charge'
    if (!draining && this.staminaT <= 0) this.stamina = Math.min(this.maxStamina, this.stamina + C.staminaRegen * this.stats.staRegen * dt * (this.state === 'heal' ? 0.5 : 1))
    if (this.exhausted && this.stamina > 30) this.exhausted = false
    this.sprinting = false

    switch (this.state) {
      case 'move': {
        if (healPressed) {
          if (ctx.poultices() > 0 && this.hp < this.maxHp) {
            this.setState('heal')
            this.healed = false
            ctx.audio.play('ui')
            break
          }
          ctx.onError?.(ctx.poultices() > 0 ? 'Already at full health' : 'No poultices — craft some at camp')
        }
        if (this.buffer === 'dodge' && this.tryDodge(wish, wishLen, ctx)) break
        if (this.buffer === 'light') {
          this.startLight(0, ctx)
          break
        }
        if (this.buffer === 'heavy') {
          this.startCharge(ctx)
          break
        }
        const wantSprint = I.held('sprint') && wishLen > 0.2 && !this.exhausted && this.stamina > 0
        if (wantSprint) {
          this.sprinting = true
          this.spend(C.sprintCost * dt)
          this.staminaT = C.staminaDelay
          if (this.stamina <= 0) {
            this.exhausted = true
            this.staminaFlash = 1
          }
        }
        speed = wishLen * (this.sprinting ? C.sprintSpeed : C.walkSpeed)
        if (wishLen > 0.05) face = ctx.locked && ctx.aim && !this.sprinting ? aimYaw : Math.atan2(wish.x, wish.z)
        target = this.locomotionPose(speed)
        break
      }
      case 'attack': {
        const A = this.light(this.step)
        const slow = 1 + this.tier * 0.04
        const wind = A.windup * slow
        const end = wind + A.active + A.recovery
        const k = this.t
        if (k < wind) {
          if (aimYaw !== null) face = aimYaw
          else {
            const base = wishLen > 0.1 ? Math.atan2(wish.x, wish.z) : this.yaw
            face = ctx.harvestAim?.(base) ?? (wishLen > 0.1 ? base : null)
          }
        }
        // Lunge through windup and active frames.
        if (k < wind + A.active) {
          speed = (A.lunge / (wind + A.active)) * (ctx.aim && this.distTo(ctx.aim) < 1.2 ? 0.2 : 1)
          this.vel.set(Math.sin(this.yaw) * speed, 0, Math.cos(this.yaw) * speed)
        }
        const sling = this.stats.cls === 'sling' && this.held === 'weapon'
        if (!sling && k >= wind && k < wind + A.active) this.strike(A.motion, false, ctx)
        if (sling && k >= wind && !this.impactDone) {
          this.impactDone = true
          if (!ctx.shoot?.(this.handPoint(), this.yaw, A.motion, false)) {
            ctx.onError?.('No stone to sling — mine a boulder')
            this.setState('move')
            break
          }
        } else if (k >= wind && !this.impactDone) {
          this.impactDone = true
          ctx.audio.play(this.step === 2 || this.countering ? 'heavySwing' : 'swing')
          if (this.countering) {
            ctx.fx.ring(this.pos.x, this.pos.y + 0.1, this.pos.z, 0.35, 3.2, '#ffe9a8', 0.4)
            ctx.fx.sparks(this.tipPoint(), '#ffe9a8', 16, 4)
            ctx.fx.shake(0.18)
          }
          if (this.step === 2) {
            const p = this.tipPoint()
            ctx.fx.dustPuff(p.x, ctx.ground.heightAt(p.x, p.z), p.z, 6)
            ctx.fx.shake(0.12)
          }
        }
        target = this.lightPose(this.step, k, wind, A.active, A.recovery)
        if (k >= wind + A.active) {
          // Recovery: the only place a combo can continue or be cancelled.
          if (this.buffer === 'light' && this.step < 2 && k >= wind + A.active + 0.04) {
            this.startLight(this.step + 1, ctx)
            break
          }
          if (this.buffer === 'dodge' && k >= wind + A.active + A.recovery * 0.35 && this.tryDodge(wish, wishLen, ctx)) break
          if (this.buffer === 'heavy' && k >= wind + A.active + A.recovery * 0.3) {
            this.startCharge(ctx)
            break
          }
        }
        if (k >= end) this.setState('move')
        break
      }
      case 'charge': {
        const held = I.held('heavy')
        this.spend(0)
        const LT = this.stats.cls === 'sling' && this.held === 'weapon' ? SLING_LEVEL_T : HEAVY_LEVEL_T
        const lvl = this.t >= LT[1] ? 2 : this.t >= LT[0] ? 1 : 0
        if (lvl > this.chargeLevel) {
          this.chargeLevel = lvl
          ctx.audio.play('charge', 1 + lvl * 0.35)
          const p = this.tipPoint()
          ctx.fx.sparks(p, lvl === 2 ? '#ffd24a' : '#fff0b0', 10 + lvl * 8, 3)
        }
        speed = wishLen * 1.3
        if (aimYaw !== null) face = aimYaw
        else {
          const base = wishLen > 0.1 ? Math.atan2(wish.x, wish.z) : this.yaw
          face = ctx.harvestAim?.(base) ?? (wishLen > 0.1 ? base : null)
        }
        target = this.chargePose(this.t)
        if (this.buffer === 'dodge' && this.tryDodge(wish, wishLen, ctx)) break
        if (!held || this.t > 1.9) {
          if (this.stamina < C.heavyCost * 0.5) {
            this.chargeLevel = 0
            this.staminaFlash = 1
          }
          this.spend(C.heavyCost)
          this.setState('heavy')
          this.hitSet.clear()
          this.harvestDone = false
          this.impactDone = false
          ctx.audio.play('heavySwing')
        }
        break
      }
      case 'heavy': {
        const k = this.t
        const sling = this.stats.cls === 'sling' && this.held === 'weapon'
        const spear = this.stats.cls === 'spear' && this.held === 'weapon'
        // Sling releases snap out and recover fast; a spear lunge commits you for longer.
        const wind = sling ? 0.05 : 0.08
        const act = sling ? 0.08 : 0.14
        const rec = (sling ? 0.4 : spear ? 0.74 - this.chargeLevel * 0.03 : 0.62 - this.chargeLevel * 0.04) / this.cls.speed
        if (sling) {
          if (!this.impactDone && k >= wind) {
            this.impactDone = true
            if (!ctx.shoot?.(this.handPoint(), this.yaw, HEAVY_MOTION[this.chargeLevel] * this.cls.motion, true)) ctx.onError?.('No stone to sling — mine a boulder')
          }
          target = this.lightPose(1, k, wind, act, rec)
          if (k >= wind + act + rec) {
            this.chargeLevel = 0
            this.setState('move')
          }
          break
        }
        if (k < wind + act) {
          const lunge = (this.stats.cls === 'spear' ? SPEAR_LUNGE : 1.2) + this.chargeLevel * 0.4
          this.vel.set(Math.sin(this.yaw) * (lunge / (wind + act)), 0, Math.cos(this.yaw) * (lunge / (wind + act)))
          speed = lunge / (wind + act)
        }
        if (k >= wind && k < wind + act) this.strike(HEAVY_MOTION[this.chargeLevel] * this.cls.motion, true, ctx)
        if (k >= wind + act * 0.6 && !this.impactDone) {
          this.impactDone = true
          const p = this.tipPoint()
          const y = ctx.ground.heightAt(p.x, p.z)
          ctx.fx.ring(p.x, y, p.z, 0.4, 2 + this.chargeLevel, '#fff0c0', 0.35)
          ctx.fx.dustPuff(p.x, y, p.z, 10 + this.chargeLevel * 6, '#d8c6a0', 1 + this.chargeLevel * 0.4)
          ctx.fx.shake(0.18 + this.chargeLevel * 0.12)
          ctx.audio.play('stomp', 0.5 + this.chargeLevel * 0.25)
        }
        target = this.heavyPose(k, wind, act, rec)
        if (k >= wind + act + rec * 0.5 && this.buffer === 'dodge' && this.tryDodge(wish, wishLen, ctx)) break
        if (k >= wind + act + rec) {
          this.chargeLevel = 0
          this.setState('move')
        }
        break
      }
      case 'dodge': {
        const k = Math.min(1, this.t / C.dodgeTime)
        speed = C.dodgeSpeed * (1 - k * k) + 1
        this.vel.copy(this.dodgeDir).multiplyScalar(speed)
        target = this.dodgePose(k)
        if (k >= 1) {
          this.setState('move')
          this.pose.hipPitch = 0
        }
        break
      }
      case 'flinch': {
        const k = this.t / 0.42
        target = rest()
        target.lean = -0.35 * (1 - k)
        target.headPitch = -0.3 * (1 - k)
        target.shRz = -0.6 * (1 - k)
        target.shLz = 0.6 * (1 - k)
        if (this.t > 0.42) this.setState('move')
        break
      }
      case 'down': {
        const k = Math.min(1, this.t / 0.35)
        target = rest()
        target.hipPitch = -1.45 * smooth(k)
        target.hipY = -0.72 * smooth(k)
        target.shRx = -2.4 * k
        target.shLx = -2.4 * k
        target.legR = -0.6 * k
        target.legL = -0.3 * k
        target.kneeL = 0.8 * k
        if (this.t > 1.0) this.setState('getup')
        break
      }
      case 'getup': {
        const k = Math.min(1, this.t / 0.5)
        target = rest()
        target.hipPitch = -1.45 * (1 - smooth(k))
        target.hipY = -0.72 * (1 - smooth(k))
        target.legR = -1.2 * Math.sin(k * Math.PI)
        target.kneeR = 1.6 * Math.sin(k * Math.PI)
        if (this.t > 0.5) this.setState('move')
        break
      }
      case 'heal': {
        speed = wishLen * C.walkSpeed * 0.35
        if (wishLen > 0.05) face = Math.atan2(wish.x, wish.z)
        target = this.locomotionPose(speed)
        const k = this.t / C.healTime
        target.shLx = -2.1 * Math.min(1, k * 3)
        target.elL = -1.9 * Math.min(1, k * 3)
        target.headPitch = 0.15
        if (!this.healed && this.t > C.healTime * 0.55) {
          this.healed = true
          ctx.consumePoultice()
          this.hp = Math.min(this.maxHp, this.hp + C.healAmount)
          this.recentHp = this.hp
          ctx.fx.healGlow(this.pos)
          ctx.audio.play('heal')
        }
        if (this.t >= C.healTime) this.setState('move')
        break
      }
      case 'gather':
      case 'carve': {
        target = this.taskPose(this.state, this.t)
        if (this.buffer === 'dodge') {
          // Only abandon the task if the dodge actually starts.
          const saved = this.task
          this.task = null
          if (this.tryDodge(wish, wishLen, ctx)) {
            saved?.cancel?.()
            break
          }
          this.task = saved
        }
        if (this.task && this.t >= this.task.dur) {
          const done = this.task.done
          this.task = null
          this.setState('move')
          done()
        }
        break
      }
      case 'throw': {
        const k = this.t
        target = rest()
        target.shRx = k < 0.18 ? -2.6 * (k / 0.18) : -2.6 + 3.2 * Math.min(1, (k - 0.18) / 0.12)
        target.elR = k < 0.18 ? -1.2 : -0.2
        target.lean = k < 0.18 ? -0.15 : 0.2
        if (aimYaw !== null) face = aimYaw
        if (k >= 0.18 && this.throwDone) {
          const d = this.throwDone
          this.throwDone = null
          this.throwCancel = null
          d()
        }
        if (this.buffer === 'dodge' && k > 0.25 && this.tryDodge(wish, wishLen, ctx)) break
        if (k >= 0.5) this.setState('move')
        break
      }
      case 'dead': {
        const k = Math.min(1, this.t / 0.6)
        target = rest()
        target.hipPitch = 1.45 * smooth(k)
        target.hipY = -0.72 * smooth(k)
        target.shRx = -2.6 * k
        target.shLx = -2.4 * k
        break
      }
    }

    // Facing.
    if (face !== null) {
      const turn = this.state === 'attack' || this.state === 'charge' ? 22 : C.turnSpeed
      const d = wrap(face - this.yaw)
      this.yaw = wrap(this.yaw + d * (1 - Math.exp(-turn * dt)))
    }

    // Velocity.
    if (this.state === 'move' || this.state === 'heal' || this.state === 'charge') {
      const want = this.state === 'move' && wishLen > 0.05 ? wish.clone().multiplyScalar(speed) : this.state !== 'move' && wishLen > 0.05 ? wish.clone().multiplyScalar(speed) : new THREE.Vector3()
      const a = 1 - Math.exp(-C.acceleration * dt * 0.25)
      this.vel.lerp(want, a)
    } else if (this.state === 'flinch' || this.state === 'down' || this.state === 'dead' || this.state === 'getup') {
      this.vel.copy(this.knock)
      this.knock.multiplyScalar(Math.exp(-dt * 6))
    } else if (this.state === 'gather' || this.state === 'carve' || this.state === 'throw') {
      this.vel.set(0, 0, 0)
    } else if (this.state === 'attack' || this.state === 'heavy') {
      const A = this.state === 'attack' ? this.light(this.step) : null
      const lungeEnd = A ? A.windup * (1 + this.tier * 0.04) + A.active : 0.22
      if (this.t >= lungeEnd) this.vel.multiplyScalar(Math.exp(-dt * 18))
    }
    this.moveSpeed = Math.hypot(this.vel.x, this.vel.z)
    this.integrate(dt, ctx)

    // Footsteps.
    if (this.state === 'move' && this.moveSpeed > 0.5) {
      this.gait += (this.moveSpeed / 1.05) * dt * 2.1
      if (this.gait - this.lastStep > Math.PI) {
        this.lastStep = this.gait
        ctx.audio.play('step', this.sprinting ? 1.4 : 1)
        if (this.sprinting && Math.random() < 0.5) ctx.fx.dustPuff(this.pos.x, this.pos.y, this.pos.z, 1, '#d8c6a0', 0.4, 0.4)
      }
    }

    // Pose smoothing.
    const rate = dt * (this.state === 'attack' || this.state === 'heavy' || this.state === 'dodge' ? 30 : 14)
    for (const key of Object.keys(target) as (keyof Pose)[]) this.pose[key] = approach(this.pose[key], target[key], rate)
    if (this.state === 'dodge') this.pose.hipPitch = target.hipPitch
    this.sync()
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 5)
    this.avatar.flash(this.hurtFlash)
    this.avatar.update(dt, this.animDrive(ctx))
  }

  /** Map the gameplay state machine onto the realistic model's clips. */
  private animDrive(ctx: PlayerCtx): AnimDrive {
    const C = CONFIG.player
    switch (this.state) {
      case 'attack': {
        const A = this.light(this.step)
        const wind = A.windup * (1 + this.tier * 0.04)
        return { kind: 'swing', clip: this.step === 2 ? 'heavy' : 'light', t: this.t, windup: wind, active: A.active, recovery: A.recovery }
      }
      case 'charge': return { kind: 'swing', clip: 'heavy', t: 0, windup: 1, active: 0, recovery: 1, hold: Math.min(1, this.t / 0.9) * 0.72 + (this.chargeLevel === 2 ? Math.sin(this.t * 55) * 0.015 : 0) }
      case 'heavy': return this.stats.cls === 'sling' && this.held === 'weapon'
        ? { kind: 'swing', clip: 'light', t: this.t, windup: 0.08, active: 0.14, recovery: 0.5 }
        : { kind: 'swing', clip: 'heavy', t: this.t, windup: 0.08, active: 0.14, recovery: (0.62 - this.chargeLevel * 0.04) / this.cls.speed, startFrac: 0.72 }
      case 'throw': return { kind: 'swing', clip: 'light', t: this.t, windup: 0.18, active: 0.08, recovery: 0.24 }
      case 'dodge': return { kind: 'clip', clip: 'dodge', k: this.t / C.dodgeTime, from: 0.02, to: 0.92 }
      case 'flinch': return { kind: 'clip', clip: 'hit', k: this.t / 0.42, from: 0, to: 0.6 }
      case 'down': return { kind: 'clip', clip: 'down', k: this.t / 1.0, from: 0, to: 0.72 }
      case 'getup': return { kind: 'loco', speed: 0, sprint: false, combat: true, blend: 6 }
      case 'dead': return { kind: 'clip', clip: 'down', k: this.t / 1.1, from: 0, to: 0.8 }
      case 'gather': case 'carve': return { kind: 'task', t: this.t }
      default: return { kind: 'loco', speed: this.moveSpeed, sprint: this.sprinting, combat: ctx.locked || this.lastDamageT < 5 }
    }
  }

  private queue(a: 'light' | 'heavy' | 'dodge'): void {
    this.buffer = a
    this.bufferT = a === 'dodge' ? 0.35 : 0.45
  }

  private tryDodge(wish: THREE.Vector3, wishLen: number, ctx: PlayerCtx): boolean {
    this.buffer = null
    if (this.stamina < 8) {
      this.staminaFlash = 1
      ctx.audio.play('error')
      return false
    }
    this.spend(CONFIG.player.dodgeCost * this.stats.dodgeCost)
    if (wishLen > 0.15) this.dodgeDir.copy(wish).normalize()
    else this.dodgeDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    this.yaw = Math.atan2(this.dodgeDir.x, this.dodgeDir.z)
    if (wishLen <= 0.15) this.yaw = wrap(this.yaw + Math.PI)
    this.chargeLevel = 0
    this.setState('dodge')
    ctx.audio.play('dodge')
    ctx.fx.dustPuff(this.pos.x, this.pos.y, this.pos.z, 5, '#d8c6a0', 0.8, 0.5)
    ctx.onDodge?.()
    return true
  }

  /** Backstep when no direction is held: body faces forward but moves back. */
  private get backstep(): boolean {
    return this.state === 'dodge' && Math.abs(wrap(Math.atan2(this.dodgeDir.x, this.dodgeDir.z) - this.yaw)) > 2
  }

  private startLight(step: number, ctx: PlayerCtx): void {
    this.buffer = null
    // Spear: attacking inside the perfect-dodge window launches a counter-thrust.
    this.countering = step === 0 && this.counterT > 0 && this.stats.cls === 'spear' && this.held === 'weapon'
    if (this.countering) {
      this.counterT = 0
      ctx.onCounter?.()
    }
    this.step = step
    this.hitSet.clear()
    this.harvestDone = false
    this.impactDone = false
    this.setState('attack')
    void ctx
  }

  private startCharge(ctx: PlayerCtx): void {
    this.buffer = null
    this.chargeLevel = 0
    this.setState('charge')
    ctx.audio.play('charge', 0.8)
  }

  private distTo(c: Creature): number {
    return Math.hypot(c.pos.x - this.pos.x, c.pos.z - this.pos.z) - c.def.radius
  }

  get reach(): number {
    if (this.held === 'hands') return 1.75
    if (this.held !== 'weapon') return 2.25
    return 2.3 + this.tier * 0.22 + this.cls.reach
  }

  /** Approximate throwing/sling hand position. */
  private handPoint(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x + Math.sin(this.yaw) * 0.6, this.pos.y + 1.5, this.pos.z + Math.cos(this.yaw) * 0.6)
  }

  private tipPoint(): THREE.Vector3 {
    const r = this.reach * 0.75
    return new THREE.Vector3(this.pos.x + Math.sin(this.yaw) * r, this.pos.y + 0.3, this.pos.z + Math.cos(this.yaw) * r)
  }

  /** Active-frame hit test: arc in front of the hunter, one hit per creature per swing. */
  private strike(motion: number, heavy: boolean, ctx: PlayerCtx): void {
    const reach = this.reach + (heavy ? 0.3 : 0)
    for (const c of ctx.creatures) {
      if (!c.alive || this.hitSet.has(c.id)) continue
      const dx = c.pos.x - this.pos.x
      const dz = c.pos.z - this.pos.z
      const d = Math.hypot(dx, dz)
      const edge = d - c.def.radius
      if (edge > reach) continue
      const dy = Math.abs(c.pos.y - this.pos.y)
      if (dy > c.def.height + 2) continue
      const rel = Math.abs(wrap(Math.atan2(dx, dz) - this.yaw))
      const halfArc = 1.3 * (this.held === 'weapon' ? this.cls.arc : 1) + Math.atan2(c.def.radius, Math.max(d, 0.5))
      if (edge > 0.5 && rel > halfArc) continue
      this.hitSet.add(c.id)
      const opts = { forceStagger: heavy && this.chargeLevel === 2 && this.stats.cls === 'maul' && this.held === 'weapon' }
      const res = c.takeHit(this.stats.attack, motion, heavy, { x: this.pos.x, z: this.pos.z }, ctx.cctx, opts)
      const point = new THREE.Vector3(this.pos.x + dx * ((d - c.def.radius * 0.7) / Math.max(d, 0.01)), this.pos.y + Math.min(1.3, c.def.height * 0.5), this.pos.z + dz * ((d - c.def.radius * 0.7) / Math.max(d, 0.01)))
      ctx.onHit(c, res, point, heavy)
    }
    // ANIMAL SYSTEM HOOK
    if (ctx.animalStrike?.(this.stats.attack, motion, heavy, reach, this.held === 'weapon' ? this.cls.arc : 1)) {
      this.harvestDone = true
    }
    // Nothing alive in the arc: the swing can bite into a tree or boulder instead.
    if (!this.harvestDone && this.hitSet.size === 0 && ctx.harvestStrike?.(heavy, heavy ? this.chargeLevel : 0)) this.harvestDone = true
  }

  private integrate(dt: number, ctx: PlayerCtx): void {
    const G = ctx.ground
    let nx = this.pos.x + this.vel.x * dt
    let nz = this.pos.z + this.vel.z * dt
    // Wading slows the hunter.
    if (G.heightAt(this.pos.x, this.pos.z) < -0.35 && this.state === 'move') {
      nx = this.pos.x + this.vel.x * dt * 0.6
      nz = this.pos.z + this.vel.z * dt * 0.6
    }
    if (!G.canStep(this.pos.x, this.pos.z, nx, nz)) {
      // Slide along whichever axis still works.
      if (G.canStep(this.pos.x, this.pos.z, nx, this.pos.z)) nz = this.pos.z
      else if (G.canStep(this.pos.x, this.pos.z, this.pos.x, nz)) nx = this.pos.x
      else {
        nx = this.pos.x
        nz = this.pos.z
      }
    }
    const r = ctx.colliders.resolve(nx, nz, this.radius)
    if (G.walkable(r.x, r.z)) {
      nx = r.x
      nz = r.z
    }
    // Creature bodies are solid (except while rolling through them).
    if (this.state !== 'dodge') {
      for (const c of ctx.creatures) {
        if (!c.alive || c.state === 'active') continue
        const dx = nx - c.pos.x
        const dz = nz - c.pos.z
        const min = c.def.radius * 0.85 + this.radius
        const d2 = dx * dx + dz * dz
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2)
          const px = c.pos.x + (dx / d) * min
          const pz = c.pos.z + (dz / d) * min
          if (G.walkable(px, pz)) {
            nx = px
            nz = pz
          }
        }
      }
    }
    this.pos.x = nx
    this.pos.z = nz
    const ground = G.heightAt(nx, nz)
    this.pos.y = approach(this.pos.y, ground, dt * 30)
  }

  private sync(): void {
    const b = this.bones
    const p = this.pose
    this.root.position.copy(this.pos)
    this.root.rotation.y = this.yaw
    b.hips.position.y = 0.98 + p.hipY
    b.hips.rotation.set(this.backstep ? -p.hipPitch * 0.25 : p.hipPitch, 0, p.hipRoll)
    b.torso.rotation.set(p.lean, p.twist, 0)
    b.head.rotation.x = p.headPitch - p.lean * 0.5
    b.shR.rotation.set(p.shRx, 0, p.shRz)
    b.elR.rotation.x = -p.elR
    b.shL.rotation.set(p.shLx, 0, p.shLz)
    b.elL.rotation.x = -p.elL
    b.legR.rotation.x = p.legR
    b.legL.rotation.x = p.legL
    b.kneeR.rotation.x = p.kneeR
    b.kneeL.rotation.x = p.kneeL
  }

  // ─── Procedural poses ───────────────────────────────────────────────────

  private locomotionPose(speed: number): Pose {
    const p = rest()
    const s = Math.min(1, speed / CONFIG.player.sprintSpeed)
    const g = this.gait
    const amp = speed > 0.3 ? 0.35 + s * 0.55 : 0
    p.legR = Math.sin(g) * amp
    p.legL = -Math.sin(g) * amp
    p.kneeR = Math.max(0, -Math.cos(g)) * amp * 1.3 + 0.05
    p.kneeL = Math.max(0, Math.cos(g)) * amp * 1.3 + 0.05
    p.shRx = -Math.sin(g) * amp * 0.7 - 0.2
    p.shLx = Math.sin(g) * amp * 0.7
    p.elR = 0.5 + s * 0.4
    p.elL = 0.3 + s * 0.5
    p.lean = 0.06 + s * 0.28
    p.hipY = -Math.abs(Math.sin(g)) * 0.05 * amp
    p.twist = Math.sin(g) * 0.12 * amp
    if (speed <= 0.3) {
      const t = performance.now() / 1000
      p.lean = 0.03 + Math.sin(t * 1.8) * 0.02
      p.shRx = -0.25
      p.elR = 0.55
    }
    return p
  }

  private lightPose(step: number, k: number, wind: number, act: number, rec: number): Pose {
    const p = rest()
    const w = smooth(Math.min(1, k / wind))
    const a = k < wind ? 0 : smooth(Math.min(1, (k - wind) / act))
    const r = k < wind + act ? 0 : smooth(Math.min(1, (k - wind - act) / rec))
    const hold = 1 - r
    p.kneeR = 0.25
    p.kneeL = 0.25
    p.legR = 0.2
    p.legL = -0.25
    p.hipY = -0.06
    if (step === 0) {
      p.twist = (0.6 * w - 1.25 * a) * hold
      p.shRx = (-1.35 * w + 0.2 * a) * hold - 0.25 * r
      p.shRz = (-1.1 * w + 1.45 * a) * hold
      p.elR = 0.4 * hold + 0.4
      p.lean = 0.18 * a * hold
    } else if (step === 1) {
      p.twist = (-0.55 * w + 1.15 * a) * hold
      p.shRx = (-1.5 * w + 0.25 * a) * hold - 0.25 * r
      p.shRz = (0.55 * w - 1.4 * a) * hold
      p.elR = 0.9 * w * (1 - a) + 0.3
      p.lean = 0.15 * a * hold
    } else {
      p.shRx = (-2.9 * w + 2.2 * a) * hold - 0.2 * r
      p.shLx = (-2.5 * w + 1.9 * a) * hold
      p.elR = 0.6 * w * (1 - a) + 0.2
      p.elL = 0.8 * w * (1 - a) + 0.3
      p.lean = (-0.22 * w + 0.6 * a) * hold
      p.hipY = (-0.05 - 0.22 * a) * hold
      p.kneeR = 0.25 + 0.5 * a * hold
      p.kneeL = 0.25 + 0.6 * a * hold
      p.legL = -0.25 - 0.5 * a * hold
    }
    return p
  }

  private chargePose(t: number): Pose {
    const p = rest()
    const w = smooth(Math.min(1, t / 0.3))
    const lvl = this.chargeLevel
    const tremble = lvl === 2 ? Math.sin(t * 60) * 0.03 : 0
    p.shRx = -2.7 * w + tremble
    p.shLx = -2.5 * w
    p.elR = 0.7 * w
    p.elL = 0.9 * w
    p.lean = -0.28 * w
    p.twist = 0.35 * w + tremble
    p.hipY = -0.12 * w
    p.kneeR = 0.4 * w
    p.kneeL = 0.3 * w
    p.legR = 0.35 * w
    p.legL = -0.3 * w
    return p
  }

  private heavyPose(k: number, wind: number, act: number, rec: number): Pose {
    const p = this.chargePose(1)
    const a = smooth(Math.min(1, Math.max(0, k - wind * 0.3) / (wind + act)))
    const r = k < wind + act ? 0 : smooth(Math.min(1, (k - wind - act) / rec))
    const hold = 1 - r
    p.shRx = (-2.7 + 2.5 * a) * hold - 0.2 * r
    p.shLx = (-2.5 + 2.3 * a) * hold
    p.elR = 0.7 * (1 - a) * hold + 0.2
    p.elL = 0.9 * (1 - a) * hold + 0.2
    p.lean = (-0.28 + 0.9 * a) * hold
    p.twist = 0.35 * (1 - a) * hold
    p.hipY = (-0.12 - 0.26 * a) * hold
    p.kneeR = (0.4 + 0.5 * a) * hold
    p.kneeL = (0.3 + 0.7 * a) * hold
    p.legL = (-0.3 - 0.6 * a) * hold
    return p
  }

  private dodgePose(k: number): Pose {
    const p = rest()
    if (this.backstep) {
      const s = Math.sin(k * Math.PI)
      p.lean = -0.35 * s
      p.hipY = -0.2 * s
      p.legR = -0.6 * s
      p.kneeR = 0.9 * s
      p.kneeL = 0.5 * s
      p.shRx = 0.5 * s
      p.shLx = 0.5 * s
      p.hipPitch = 0
      return p
    }
    const tuck = Math.sin(Math.min(1, k * 1.25) * Math.PI)
    p.hipPitch = TAU * smooth(Math.min(1, k * 1.2))
    p.hipY = -0.45 * tuck
    p.legR = -1.4 * tuck
    p.legL = -1.3 * tuck
    p.kneeR = 2.0 * tuck
    p.kneeL = 2.1 * tuck
    p.shRx = -1.2 * tuck
    p.shLx = -1.2 * tuck
    p.elR = 1.2 * tuck
    p.elL = 1.2 * tuck
    p.lean = 0.5 * tuck
    return p
  }

  private taskPose(kind: 'gather' | 'carve', t: number): Pose {
    const p = rest()
    const w = smooth(Math.min(1, t / 0.2))
    if (kind === 'gather') {
      p.hipY = -0.36 * w
      p.kneeR = 1.2 * w
      p.kneeL = 1.2 * w
      p.legR = -0.7 * w
      p.legL = -0.7 * w
      p.lean = 0.75 * w
      p.shRx = (-0.9 + Math.sin(t * 14) * 0.35) * w
      p.shLx = (-0.9 - Math.sin(t * 14) * 0.35) * w
      p.elR = 0.4
      p.elL = 0.4
    } else {
      p.hipY = -0.45 * w
      p.legL = -1.4 * w
      p.kneeL = 1.9 * w
      p.legR = 0.2 * w
      p.kneeR = 1.5 * w
      p.lean = 0.55 * w
      p.shRx = (-0.9 + Math.abs(Math.sin(t * 9)) * 0.7) * w
      p.shLx = -0.8 * w
      p.elR = 0.5
    }
    return p
  }
}
