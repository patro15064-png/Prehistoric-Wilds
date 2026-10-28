import * as THREE from 'three'
import { CONFIG } from './config'
import { GADGET_TUNING as GT, PREY_STRIKE, SPECIES, TRACKING, type AttackDef, type HitZone, type SpeciesDef, type SpeciesId } from './data'
import { applyPose, buildRig, restPose, setFlash, type Pose, type Rig } from './creatureModels'
import { attachModel } from './creatureSkin'
import { assets } from '../engine/assets'
import type { Colliders } from './colliders'
import type { Fx } from './fx'
import type { Audio } from '../engine/audio'
import type { Ground, Telegraph, Telegraphs } from './telegraphs'
import { hitDamage } from './rules'

export type HitResult = 'hit' | 'dodged' | 'ignored'
export interface PlayerLike {
  readonly pos: THREE.Vector3
  readonly radius: number
  readonly alive: boolean
  receiveHit(damage: number, knock: 'flinch' | 'down', from: { x: number; z: number }, source: string): HitResult
}
export type CreatureEvent =
  | { type: 'engage'; c: Creature }
  | { type: 'enrage'; c: Creature }
  | { type: 'stagger'; c: Creature }
  | { type: 'killed'; c: Creature }
  | { type: 'dodged'; c: Creature }
  | { type: 'predation'; c: Creature; by: Creature }
  | { type: 'hunting'; c: Creature; prey: Creature }
  | { type: 'trapped'; c: Creature; kind: HoldKind }
  | { type: 'resisted'; c: Creature; kind: 'snare' | 'pit' | 'flash' }
  | { type: 'blinded'; c: Creature; interrupted: boolean }
export type HoldKind = 'snare' | 'pit' | 'trip'
export type HitOpts = { mult?: number; forceStagger?: boolean; ranged?: boolean; headStagger?: boolean }
export type HitOut = { dealt: number; punish: boolean; stagger: boolean; killed: boolean; zone: HitZone; weak: boolean; sneak: boolean }
export type CreatureCtx = {
  ground: Ground
  colliders?: Colliders
  telegraphs: Telegraphs
  fx: Fx
  audio?: Audio
  player: PlayerLike
  /** Camp safe zone: creatures never enter it and give up the chase when the player is inside. */
  safe?: { x: number; z: number; r: number }
  emit?(e: CreatureEvent): void
  /** All creatures, for predators looking for prey. */
  creatures?: readonly Creature[]
  /** Footfall hook (footprint trails). */
  onStep?(c: Creature, x: number, z: number, yaw: number, side: number): void
}
export type CState =
  | 'idle' | 'alert' | 'roar' | 'chase' | 'windup' | 'active' | 'recover' | 'stagger' | 'flinch' | 'return' | 'dead' | 'sinking' | 'gone'
  | 'held' | 'blinded' | 'hunt' | 'flee' | 'feed'

const TAU = Math.PI * 2
const wrap = (a: number) => {
  a = (a + Math.PI) % TAU
  return (a < 0 ? a + TAU : a) - Math.PI
}
const approach = (a: number, b: number, rate: number) => a + (b - a) * (1 - Math.exp(-rate))
const smooth = (k: number) => k * k * (3 - 2 * k)

let nextId = 1

export class Creature {
  readonly id = nextId++
  readonly def: SpeciesDef
  readonly rig: Rig
  readonly pos = new THREE.Vector3()
  yaw = 0
  hp: number
  maxHp: number
  poise: number
  poiseMax: number
  state: CState = 'idle'
  t = 0
  attack: AttackDef | null = null
  enraged = false
  engaged = false
  carvesLeft = 0
  carveIndex = 0
  respawnT = 0
  /** Set true while the player is carving this carcass. */
  carving = false
  readonly home: { x: number; z: number }
  private pose: Pose = restPose()
  private target: Pose = restPose()
  private flash = 0
  private gapT = 0.8
  private cooldowns = new Map<string, number>()
  private wanderT = 1
  private wanderTo: { x: number; z: number } | null = null
  private speed = 0
  private decals: Telegraph[] = []
  private hitDone = false
  private laneFrom = new THREE.Vector3()
  private laneDir = new THREE.Vector3()
  private leapFrom = new THREE.Vector3()
  private leapTo = new THREE.Vector3()
  private points: THREE.Vector3[] = []
  private crash = 0
  private pendingEnrage = false
  private flameT = 0
  private strafe = 1
  private deathRoll = 0
  private lastStep = 0
  /** Frozen lab mode: no autonomous AI, attacks only on demand. */
  puppet = false
  /** Trap hold (snare / pit / tripped charge) while state === 'held'. */
  holdKind: HoldKind | null = null
  private holdDur = 0
  private blindDur = 0
  /** Boss trap resistance timers. */
  private resist = { snare: 0, pit: 0, flash: 0 }
  /** Ecology: current prey (predators) or threat (prey). */
  prey: Creature | null = null
  private threat: Creature | null = null
  private huntCd = 20 + Math.random() * 40
  private strikeT = 0
  /** Killed by a predator: one carve, mostly meat. */
  scavenged = false
  private stepDist = 0
  private stepSide = 1
  private lastX = 0
  private lastZ = 0

  constructor(species: SpeciesId, x: number, z: number, ground: Ground) {
    this.def = SPECIES[species]
    this.rig = buildRig(species)
    this.rig.root.rotation.order = 'YXZ'
    assets.onGltf(species, g => attachModel(this.rig, g))
    this.home = { x, z }
    this.hp = this.maxHp = this.def.hp
    this.poise = this.poiseMax = this.def.poise
    this.pos.set(x, ground.heightAt(x, z), z)
    this.yaw = Math.random() * TAU
    this.strafe = Math.random() < 0.5 ? -1 : 1
    this.syncRig(ground)
  }

  get alive(): boolean {
    return this.state !== 'dead' && this.state !== 'sinking' && this.state !== 'gone'
  }
  get carvable(): boolean {
    return this.state === 'dead' && this.carvesLeft > 0
  }
  /** Open to punishment: recovering or staggered. */
  get open(): boolean {
    return this.state === 'recover' || this.state === 'stagger' || this.state === 'held'
  }
  /** Seconds left in a trap hold or blind (for the HUD). */
  get holdLeft(): number {
    return this.state === 'held' ? Math.max(0, this.holdDur - this.t) : this.state === 'blinded' ? Math.max(0, this.blindDur - this.t) : 0
  }
  get holdTotal(): number {
    return this.state === 'held' ? this.holdDur : this.state === 'blinded' ? this.blindDur : 0
  }
  get forward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw))
  }
  /** Approximate centre-of-mass for targeting and hit sparks. */
  center(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + this.def.height * 0.55, this.pos.z)
  }

  /** Reset to a fresh spawn at home. */
  respawn(ground: Ground): void {
    this.clearDecals()
    this.hp = this.maxHp
    this.poise = this.poiseMax = this.def.poise
    this.state = 'idle'
    this.enraged = false
    // A boss dropped below half before the hunter fainted must not re-enrage at full health.
    this.pendingEnrage = false
    this.carving = false
    this.flameT = 0
    this.engaged = false
    this.attack = null
    this.holdKind = null
    this.prey = null
    this.threat = null
    this.scavenged = false
    this.resist = { snare: 0, pit: 0, flash: 0 }
    this.huntCd = 20 + Math.random() * 40
    this.rig.root.visible = true
    this.pos.set(this.home.x, ground.heightAt(this.home.x, this.home.z), this.home.z)
    this.deathRoll = 0
    this.pose = restPose()
    this.syncRig(ground)
  }

  private setState(s: CState): void {
    if (this.puppet && (s === 'chase' || s === 'alert' || s === 'roar' || s === 'return' || s === 'hunt' || s === 'flee' || s === 'feed')) s = 'idle'
    if (s !== 'held') this.holdKind = null
    if (s !== 'hunt' && s !== 'feed') this.prey = null
    this.state = s
    this.t = 0
  }

  private clearDecals(): void {
    for (const d of this.decals) d.release()
    this.decals = []
  }

  // ─── Damage in ───────────────────────────────────────────────────────────

  /** Player strike. Returns dealt damage and whether it was a punish. */
  takeHit(attack: number, motion: number, heavy: boolean, from: { x: number; z: number }, ctx: CreatureCtx, opts: HitOpts = {}): HitOut {
    const zone = this.zoneFrom(from)
    if (!this.alive) return { dealt: 0, punish: false, stagger: false, killed: false, zone, weak: false, sneak: false }
    const punish = this.open
    // Weak zones reward positioning; a feeding beast that has not noticed you takes a sneak bonus.
    const weak = zone === this.def.weak.zone
    const sneak = this.state === 'feed' && !this.engaged
    const tripped = this.state === 'held' && this.holdKind === 'trip'
    const mult = (weak ? this.def.weak.mult : 1) * (sneak ? PREY_STRIKE.sneak : 1) * (tripped ? GT.tripBonus : 1) * (opts.mult ?? 1)
    const dealt = Math.round(hitDamage(attack, motion, punish) * CONFIG.combat.playerDamage * mult)
    this.hp -= dealt
    this.flash = 1
    if (!this.engaged) this.engage(ctx)
    if (this.state === 'idle' || this.state === 'alert' || this.state === 'return' || this.state === 'hunt' || this.state === 'feed' || this.state === 'flee') this.setState('chase')
    if (this.hp <= 0) {
      this.die(ctx)
      return { dealt, punish, stagger: false, killed: true, zone, weak, sneak }
    }
    if (this.def.boss && !this.enraged && this.hp < this.maxHp * 0.5) this.pendingEnrage = true
    let stagger = false
    if (this.state !== 'stagger') {
      this.poise -= dealt * (heavy ? 1.35 : 1)
      if (this.poise <= 0 || opts.forceStagger || (opts.headStagger && zone === 'head')) {
        stagger = true
        this.enterStagger(ctx)
      } else if (!this.def.boss && heavy && this.state !== 'active' && this.state !== 'held' && this.state !== 'blinded') {
        this.clearDecals()
        this.attack = null
        this.setState('flinch')
      }
    }
    return { dealt, punish, stagger, killed: false, zone, weak, sneak }
  }

  /** Which body zone faces a point: head (front 50°), rear (back 50°) or flank. */
  zoneFrom(from: { x: number; z: number }): HitZone {
    const rel = Math.abs(wrap(Math.atan2(from.x - this.pos.x, from.z - this.pos.z) - this.yaw))
    return rel < 0.87 ? 'head' : rel > 2.27 ? 'rear' : 'flank'
  }

  // ─── Traps and flash ─────────────────────────────────────────────────────

  /** Spring a snare or pitfall on this beast. A snare under a charging beast trips it. */
  trap(kind: 'snare' | 'pit', ctx: CreatureCtx): HoldKind | 'resisted' | null {
    if (!this.alive) return null
    if (this.state === 'held') return null
    const charging = kind === 'snare' && this.state === 'active' && this.attack?.shape.kind === 'lane'
    if (this.def.boss && this.resist[kind] > 0 && !charging) {
      ctx.emit?.({ type: 'resisted', c: this, kind })
      this.flash = 0.6
      return 'resisted'
    }
    const hold: HoldKind = charging ? 'trip' : kind
    this.clearDecals()
    this.attack = null
    this.crash = 0
    this.holdDur = hold === 'trip' ? GT.tripTime : hold === 'pit' ? (this.def.boss ? GT.pitHoldBoss : GT.pitHold) : this.def.boss ? GT.snareHoldBoss : GT.snareHold
    if (this.def.boss) this.resist[kind] = GT.bossResist
    this.setState('held')
    this.holdKind = hold
    this.speed = 0
    if (!this.engaged) this.engage(ctx)
    ctx.fx.dustPuff(this.pos.x, this.pos.y, this.pos.z, this.def.boss ? 22 : 10, '#c9b48a', this.def.radius)
    ctx.fx.shake(hold === 'trip' ? (this.def.boss ? 0.7 : 0.3) : 0.12)
    if (hold === 'trip') ctx.audio?.play('stomp')
    ctx.emit?.({ type: 'trapped', c: this, kind: hold })
    return hold
  }

  /** A flash pod bursting at (x, z). Interrupts windups; blinds beasts that face it. */
  flashAt(x: number, z: number, ctx: CreatureCtx): 'interrupt' | 'blind' | 'resisted' | 'miss' {
    if (!this.alive) return 'miss'
    const d = Math.hypot(x - this.pos.x, z - this.pos.z)
    if (d > GT.flashRadius + this.def.radius) return 'miss'
    const facing = Math.abs(wrap(Math.atan2(x - this.pos.x, z - this.pos.z) - this.yaw)) < 1.75 || d < this.def.radius + 1.5
    if (!facing) return 'miss'
    if (this.def.boss && this.resist.flash > 0) {
      ctx.emit?.({ type: 'resisted', c: this, kind: 'flash' })
      return 'resisted'
    }
    if (this.def.boss) this.resist.flash = GT.bossResist
    if (!this.engaged) this.engage(ctx)
    const interrupted = this.state === 'windup'
    if (interrupted) this.enterStagger(ctx)
    else {
      this.clearDecals()
      this.attack = null
      this.blindDur = GT.blindTime * (this.def.boss ? 0.7 : 1)
      this.setState('blinded')
    }
    ctx.emit?.({ type: 'blinded', c: this, interrupted })
    return interrupted ? 'interrupt' : 'blind'
  }

  // ─── Ecology ─────────────────────────────────────────────────────────────

  /** A predator struck this prey: flee from it. */
  private alarm(from: Creature): void {
    if (!this.alive || this.engaged) return
    this.threat = from
    if (this.state !== 'flee') this.setState('flee')
  }

  /** Killed by a predator: leaves a carcass with a single scavenger carve. */
  private dieByPredator(by: Creature, ctx: CreatureCtx): void {
    this.clearDecals()
    this.attack = null
    this.hp = 0
    this.setState('dead')
    this.carvesLeft = 1
    this.carveIndex = 0
    this.scavenged = true
    ctx.fx.dustPuff(this.pos.x, this.pos.y, this.pos.z, 10, '#d8c6a0', 1.2)
    ctx.audio?.play('down', 0.6)
    ctx.emit?.({ type: 'predation', c: this, by })
  }

  private scanForPrey(ctx: CreatureCtx, playerDist: number): Creature | null {
    const list = ctx.creatures
    if (!list || !this.def.prey || this.def.boss) return null
    if (playerDist < this.def.aggro * 1.3) return null
    let best: Creature | null = null
    let bd = PREY_STRIKE.detect
    for (const o of list) {
      if (o === this || !o.alive || o.engaged || o.puppet || !this.def.prey.includes(o.def.id)) continue
      if (o.state !== 'idle' && o.state !== 'return') continue
      const d = Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z)
      if (d < bd) {
        bd = d
        best = o
      }
    }
    return best
  }

  private enterStagger(ctx: CreatureCtx): void {
    this.clearDecals()
    this.attack = null
    this.poiseMax *= this.def.boss ? 1.18 : 1.1
    this.poise = this.poiseMax
    this.setState('stagger')
    ctx.fx.shake(this.def.boss ? 0.5 : 0.2)
    ctx.audio?.play('stagger')
    ctx.emit?.({ type: 'stagger', c: this })
  }

  private die(ctx: CreatureCtx): void {
    this.clearDecals()
    this.attack = null
    this.hp = 0
    this.setState('dead')
    this.carvesLeft = this.def.carves
    this.carveIndex = 0
    ctx.fx.dustPuff(this.pos.x, this.pos.y, this.pos.z, this.def.boss ? 30 : 12, '#d8c6a0', this.def.boss ? 3 : 1.4)
    ctx.fx.shake(this.def.boss ? 0.9 : 0.25)
    ctx.audio?.play(this.def.boss ? 'bossRoar' : 'down')
    ctx.emit?.({ type: 'killed', c: this })
  }

  /** Called by the game after each carve. */
  carved(): void {
    this.carvesLeft -= 1
    this.carveIndex += 1
    if (this.carvesLeft <= 0) this.setState('sinking')
  }

  private engage(ctx: CreatureCtx): void {
    this.engaged = true
    ctx.emit?.({ type: 'engage', c: this })
  }

  // ─── Main update ─────────────────────────────────────────────────────────

  update(dt: number, ctx: CreatureCtx): void {
    const P = ctx.player
    this.t += dt
    for (const [k, v] of this.cooldowns) this.cooldowns.set(k, v - dt)
    if (this.def.boss) {
      this.resist.snare = Math.max(0, this.resist.snare - dt)
      this.resist.pit = Math.max(0, this.resist.pit - dt)
      this.resist.flash = Math.max(0, this.resist.flash - dt)
    }
    this.gapT -= dt
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 7)
      setFlash(this.rig, this.flash * 0.9)
    }
    const dx = P.pos.x - this.pos.x
    const dz = P.pos.z - this.pos.z
    const dist = Math.hypot(dx, dz)
    const toPlayer = Math.atan2(dx, dz)
    const rel = wrap(toPlayer - this.yaw)
    const playerSafe = !!ctx.safe && Math.hypot(P.pos.x - ctx.safe.x, P.pos.z - ctx.safe.z) < ctx.safe.r
    const homeDist = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z)
    const playerHome = Math.hypot(P.pos.x - this.home.x, P.pos.z - this.home.z)
    const tel = CONFIG.combat.telegraphScale * (this.enraged ? 0.88 : 1)
    const pace = this.enraged ? 1.15 : 1
    const T = this.target
    Object.assign(T, restPose())
    T.headYaw = 0
    let moveSpeed = 0

    switch (this.state) {
      case 'idle': {
        if (this.puppet) break
        this.wanderT -= dt
        if (this.wanderT <= 0) {
          this.wanderT = 3 + Math.random() * 4
          const a = Math.random() * TAU
          const r = Math.random() * (this.def.boss ? 10 : 7)
          this.wanderTo = Math.random() < 0.35 ? null : { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r }
        }
        if (this.wanderTo) {
          const wx = this.wanderTo.x - this.pos.x
          const wz = this.wanderTo.z - this.pos.z
          if (Math.hypot(wx, wz) < 1) this.wanderTo = null
          else {
            this.turnToward(Math.atan2(wx, wz), this.def.turn * 0.6, dt)
            moveSpeed = this.def.walk * 0.7
          }
        } else {
          T.headPitch = 0.25 + Math.sin(this.t * 0.8) * 0.15
          T.headYaw = Math.sin(this.t * 0.5) * 0.3
        }
        if (P.alive && !playerSafe && dist < this.def.aggro && playerHome < this.def.leash) {
          this.setState(this.def.boss && !this.engaged ? 'roar' : 'alert')
          if (!this.engaged) this.engage(ctx)
          ctx.audio?.play(this.def.boss ? 'bossRoar' : 'roar', this.def.boss ? 1 : 0.7)
          break
        }
        if (this.def.prey) {
          this.huntCd -= dt
          if (this.huntCd <= 0) {
            this.huntCd = 1
            const prey = this.scanForPrey(ctx, dist)
            if (prey) {
              this.prey = prey
              this.setState('hunt')
              this.prey = prey
              this.strikeT = 0.4
              ctx.emit?.({ type: 'hunting', c: this, prey })
            }
          }
        }
        break
      }
      case 'hunt': {
        const prey = this.prey
        if (P.alive && !playerSafe && dist < this.def.aggro * 0.7 && playerHome < this.def.leash) {
          this.setState('alert')
          if (!this.engaged) this.engage(ctx)
          ctx.audio?.play('roar', 0.7)
          break
        }
        if (!prey || !prey.alive || this.t > 25 || homeDist > this.def.leash * 1.6) {
          this.huntCd = PREY_STRIKE.cooldown[0] + Math.random() * (PREY_STRIKE.cooldown[1] - PREY_STRIKE.cooldown[0])
          this.setState('return')
          break
        }
        const px = prey.pos.x - this.pos.x
        const pz = prey.pos.z - this.pos.z
        const pd = Math.hypot(px, pz)
        this.turnToward(Math.atan2(px, pz), this.def.turn * 1.2, dt)
        const reach = this.def.radius + prey.def.radius + 1.2
        if (pd > reach) moveSpeed = this.def.run * 0.92
        else {
          moveSpeed = 0
          this.strikeT -= dt
          const melee = this.def.attacks.find(a => a.shape.kind === 'cone') ?? this.def.attacks[0]
          this.attackPose(melee, this.strikeT < 0.25 ? 'active' : 'windup', this.strikeT < 0.25 ? 1 - this.strikeT / 0.25 : 1)
          if (this.strikeT <= 0) {
            this.strikeT = PREY_STRIKE.every
            prey.hp -= PREY_STRIKE.damage
            prey.flash = 1
            ctx.fx.sparks(prey.center(new THREE.Vector3()), '#ffe0b0', 6, 3)
            ctx.audio?.play('hit', 0.35)
            prey.alarm(this)
            if (prey.hp <= 0) {
              prey.dieByPredator(this, ctx)
              this.setState('feed')
              this.prey = prey
              this.huntCd = PREY_STRIKE.cooldown[0] + Math.random() * (PREY_STRIKE.cooldown[1] - PREY_STRIKE.cooldown[0])
            }
          }
        }
        T.headPitch = 0.2
        break
      }
      case 'feed': {
        if (P.alive && !playerSafe && dist < this.def.aggro * 0.5 && playerHome < this.def.leash) {
          this.setState('alert')
          if (!this.engaged) this.engage(ctx)
          ctx.audio?.play('roar', 0.7)
          break
        }
        const c = this.prey
        if (c) this.turnToward(Math.atan2(c.pos.x - this.pos.x, c.pos.z - this.pos.z), this.def.turn * 0.5, dt)
        T.headPitch = 0.75 + Math.sin(this.t * 6) * 0.12
        T.jaw = 0.3 + Math.abs(Math.sin(this.t * 5)) * 0.5
        T.crouch = 0.25
        if (this.t > PREY_STRIKE.feed || !c || c.state === 'gone' || c.state === 'sinking') this.setState('return')
        break
      }
      case 'flee': {
        const th = this.threat
        const away = th ? Math.atan2(this.pos.x - th.pos.x, this.pos.z - th.pos.z) : this.yaw
        this.turnToward(away + Math.sin(this.t * 1.7) * 0.4, this.def.turn * 1.4, dt)
        moveSpeed = this.def.run * 0.8
        T.headPitch = -0.15
        if (this.t > PREY_STRIKE.flee || !th || !th.alive) {
          this.threat = null
          this.setState('return')
        }
        break
      }
      case 'held': {
        const k = Math.min(1, this.t / 0.3)
        const w = Math.sin(this.t * 13)
        if (this.holdKind === 'pit') {
          T.bodyY = -this.def.height * 0.38 * k
          T.crouch = 0.5
          T.headPitch = -0.4 + w * 0.15
          T.jaw = 0.5 + w * 0.3
        } else if (this.holdKind === 'trip') {
          T.bodyRoll = 1.25 * k + w * 0.05
          T.crouch = 0.3
          T.headPitch = 0.3
          T.jaw = 0.6
        } else {
          T.crouch = 0.35
          T.bodyRoll = w * 0.12
          T.headYaw = Math.sin(this.t * 9) * 0.5
          T.jaw = 0.5 + w * 0.3
          T.tailSwing = w * 0.6
        }
        if (Math.random() < dt * 5) ctx.fx.dustPuff(this.pos.x, this.pos.y, this.pos.z, 2, '#c9b48a', this.def.radius * 0.6)
        if (this.t >= this.holdDur) {
          this.gapT = 0.25
          ctx.fx.dustPuff(this.pos.x, this.pos.y, this.pos.z, 8, '#c9b48a', this.def.radius)
          this.setState('chase')
        }
        break
      }
      case 'blinded': {
        T.headYaw = Math.sin(this.t * 5) * 0.7
        T.headPitch = -0.2 + Math.sin(this.t * 3) * 0.2
        T.jaw = 0.4
        this.yaw = wrap(this.yaw + Math.sin(this.t * 1.3 + this.id) * dt * 1.2)
        moveSpeed = this.def.walk * 0.4
        if (Math.random() < dt * 3) ctx.fx.sparks(this.center(new THREE.Vector3()).setY(this.pos.y + this.def.height * 1.1), '#fffbe0', 2, 1.5)
        if (this.t >= this.blindDur) {
          this.gapT = 0.4
          this.setState('chase')
        }
        break
      }
      case 'alert': {
        this.turnToward(toPlayer, this.def.turn * 1.5, dt)
        T.headPitch = -0.3
        T.jaw = 0.4
        if (this.t > 0.5) this.setState('chase')
        break
      }
      case 'roar': {
        this.turnToward(toPlayer, this.def.turn, dt)
        const k = Math.min(1, this.t / 0.4)
        T.headPitch = -0.7 * k
        T.jaw = k
        T.bodyPitch = -0.12 * k
        T.glow = 0.6 * k
        T.wing = 0.8 * k
        if (this.t > 0.35 && this.t < 1.3) ctx.fx.shake(0.12)
        if (this.t > 1.7) {
          this.setState('chase')
          this.gapT = 0.4
        }
        break
      }
      case 'chase': {
        if (this.pendingEnrage) {
          this.pendingEnrage = false
          this.enraged = true
          this.setState('roar')
          ctx.audio?.play(this.def.boss ? 'bossRoar' : 'roar')
          ctx.emit?.({ type: 'enrage', c: this })
          break
        }
        if (!P.alive || playerSafe || playerHome > this.def.leash + 12 || homeDist > this.def.leash * 1.35) {
          this.setState('return')
          break
        }
        const facing = Math.abs(rel)
        const behind = facing > 1.9
        const pick = this.gapT <= 0 ? this.pickAttack(dist, behind) : null
        if (pick) {
          this.startAttack(pick, ctx)
          break
        }
        const near = this.def.boss ? 5.5 : 2.4
        if (!behind || !this.def.boss) this.turnToward(toPlayer, this.def.turn, dt)
        else this.turnToward(toPlayer, this.def.turn * 0.6, dt)
        if (dist > near + 1) moveSpeed = (dist > 12 ? this.def.run : this.def.walk * 1.4) * pace
        else {
          // Circle the player while waiting for an opening.
          moveSpeed = this.def.walk * 0.6
          this.yaw += this.strafe * dt * 0.8
          if (Math.random() < dt * 0.3) this.strafe *= -1
        }
        T.headPitch = 0.1
        break
      }
      case 'windup': {
        const A = this.attack!
        const wind = A.windup * tel
        const k = Math.min(1, this.t / wind)
        if (k < A.tracking) this.turnToward(toPlayer, this.def.turn * 2.2, dt)
        this.trackDecals(ctx, k < A.tracking)
        for (const d of this.decals) d.progress = k
        this.attackPose(A, 'windup', k)
        if (A.anim === 'charge' && Math.random() < dt * 8) ctx.fx.dustPuff(this.pos.x - Math.sin(this.yaw) * this.def.radius, this.pos.y, this.pos.z - Math.cos(this.yaw) * this.def.radius, 2)
        if (A.anim === 'breath' || A.anim === 'erupt' || A.anim === 'spit') {
          if (Math.random() < dt * 20) ctx.fx.embers(this.pos.x, this.pos.y + this.def.height * 0.8, this.pos.z, 1, this.def.radius)
        }
        if (this.t >= wind) this.beginActive(ctx)
        break
      }
      case 'active': {
        const A = this.attack!
        const k = Math.min(1, this.t / A.active)
        this.attackPose(A, 'active', k)
        this.runActive(A, k, dt, ctx)
        if (this.t >= A.active) {
          this.clearDecals()
          this.setState('recover')
        }
        break
      }
      case 'recover': {
        const A = this.attack
        const rec = (A?.recovery ?? 0.6) + this.crash
        const k = Math.min(1, this.t / rec)
        if (A) this.attackPose(A, 'recover', k)
        // Tired tells: head low, panting.
        T.jaw = Math.max(T.jaw, 0.35 + Math.sin(this.t * 10) * 0.2)
        if (this.t >= rec) {
          if (A) this.cooldowns.set(A.id, A.cooldown)
          this.attack = null
          this.crash = 0
          this.gapT = (this.def.boss ? 0.35 : 0.6) + Math.random() * (this.def.boss ? 0.6 : 1)
          this.setState('chase')
        }
        break
      }
      case 'flinch': {
        const k = this.t / 0.38
        T.headPitch = -0.4 * (1 - k)
        T.bodyRoll = 0.15 * Math.sin(this.t * 30) * (1 - k)
        if (this.t > 0.38) this.setState('chase')
        break
      }
      case 'stagger': {
        const dur = this.def.boss ? 2.6 : 1.7
        const k = this.t / dur
        const fade = 1 - smooth(Math.max(0, (k - 0.7) / 0.3))
        T.bodyRoll = (0.28 + Math.sin(this.t * 7) * 0.12) * fade
        T.headPitch = 0.55 * fade
        T.crouch = 0.45 * fade
        T.jaw = 0.7 * fade
        T.tailSwing = Math.sin(this.t * 5) * 0.4 * fade
        if (Math.random() < dt * 4) ctx.fx.sparks(this.center(new THREE.Vector3()).setY(this.pos.y + this.def.height * 1.05), '#fff4a0', 2, 2)
        if (this.t > dur) this.setState('chase')
        break
      }
      case 'return': {
        const hx = this.home.x - this.pos.x
        const hz = this.home.z - this.pos.z
        this.turnToward(Math.atan2(hx, hz), this.def.turn, dt)
        moveSpeed = this.def.run * 0.8
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * (this.def.boss ? 0.02 : 0.1) * dt)
        if (Math.hypot(hx, hz) < 3) {
          this.setState('idle')
          if (!this.def.boss) this.engaged = false
        } else if (P.alive && !playerSafe && dist < this.def.aggro * 0.6 && playerHome < this.def.leash) this.setState('chase')
        break
      }
      case 'dead': {
        this.deathRoll = Math.min(1, this.deathRoll + dt * 2.2)
        T.bodyRoll = 1.45 * smooth(this.deathRoll)
        T.crouch = 0.3
        T.headPitch = 0.3
        T.jaw = 0.5
        T.glow = -1
        // Small carcasses fade out if left alone.
        if (!this.def.boss && !this.carving && this.t > 90) this.setState('sinking')
        break
      }
      case 'sinking': {
        T.bodyRoll = 1.45
        T.glow = -1
        this.pos.y -= dt * 0.7
        if (this.t > 2) {
          this.rig.root.visible = false
          this.setState('gone')
          this.respawnT = CONFIG.expedition.creatureRespawn
        }
        break
      }
      case 'gone': {
        break
      }
    }

    // Locomotion
    this.speed = approach(this.speed, moveSpeed, dt * 8)
    if (this.speed > 0.05) this.moveAlong(this.forward, this.speed, dt, ctx)
    if (this.state !== 'sinking' && this.state !== 'gone' && !(this.state === 'active' && this.attack?.shape.kind === 'leap')) {
      this.pos.y = ctx.ground.heightAt(this.pos.x, this.pos.z)
    }
    const gaitRate = this.speed / this.rig.stride
    this.pose.gait += gaitRate * dt
    T.gait = this.pose.gait
    T.stride = this.speed > 0.1 ? Math.min(0.75, 0.2 + (this.speed / this.def.run) * 0.55) : 0
    if (this.state === 'active' && this.attack && this.attack.shape.kind === 'lane') {
      this.pose.gait += dt * 14
      T.gait = this.pose.gait
      T.stride = this.attack.anim === 'roll' ? 0 : 0.85
    }
    if (this.speed > this.def.walk && this.pose.gait - this.lastStep > Math.PI) {
      this.lastStep = this.pose.gait
      if (this.def.boss) {
        ctx.audio?.play('stomp', 0.35)
        ctx.fx.shake(dist < 18 ? 0.08 : 0)
      }
    }
    // Footprints: one print per stride length travelled.
    if (this.alive && ctx.onStep) {
      const moved = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ)
      if (moved < 5) this.stepDist += moved
      if (this.stepDist > TRACKING.printSpacing * (this.def.boss ? 1.8 : 1)) {
        this.stepDist = 0
        this.stepSide = -this.stepSide
        const sx = Math.cos(this.yaw) * this.def.radius * 0.35 * this.stepSide
        const sz = -Math.sin(this.yaw) * this.def.radius * 0.35 * this.stepSide
        ctx.onStep(this, this.pos.x + sx, this.pos.z + sz, this.yaw, this.stepSide)
      }
    }
    this.lastX = this.pos.x
    this.lastZ = this.pos.z
    // Breathing idle
    T.bodyY += Math.sin(this.t * 2.4 + this.id) * 0.015 * this.def.height

    const rate = dt * (this.state === 'active' ? 22 : 12)
    const p = this.pose
    for (const key of Object.keys(T) as (keyof Pose)[]) {
      if (key === 'gait') continue
      p[key] = approach(p[key], T[key], rate)
    }
    this.syncRig(ctx.ground)
  }

  private syncRig(ground: Ground): void {
    const r = this.rig.root
    r.position.copy(this.pos)
    r.rotation.y = this.yaw
    if (this.alive) {
      const L = this.def.radius
      const fx = Math.sin(this.yaw) * L
      const fz = Math.cos(this.yaw) * L
      const hf = ground.heightAt(this.pos.x + fx, this.pos.z + fz)
      const hb = ground.heightAt(this.pos.x - fx, this.pos.z - fz)
      r.rotation.x = approach(r.rotation.x, -Math.atan2(hf - hb, 2 * L) * 0.8, 0.2)
    }
    applyPose(this.rig, this.pose)
  }

  private turnToward(target: number, rate: number, dt: number): void {
    const d = wrap(target - this.yaw)
    const maxStep = rate * dt
    this.yaw = wrap(this.yaw + Math.max(-maxStep, Math.min(maxStep, d)))
  }

  /** Move with terrain/collider/safe-zone checks. Returns false when blocked. */
  private moveAlong(dir: THREE.Vector3, speed: number, dt: number, ctx: CreatureCtx): boolean {
    const nx = this.pos.x + dir.x * speed * dt
    const nz = this.pos.z + dir.z * speed * dt
    return this.tryMove(nx, nz, ctx)
  }

  private tryMove(nx: number, nz: number, ctx: CreatureCtx): boolean {
    if (ctx.safe && Math.hypot(nx - ctx.safe.x, nz - ctx.safe.z) < ctx.safe.r + this.def.radius) return false
    if (!ctx.ground.canStep(this.pos.x, this.pos.z, nx, nz)) return false
    if (this.def.boss && Math.hypot(nx - this.home.x, nz - this.home.z) > this.def.leash) return false
    if (ctx.colliders) {
      const r = ctx.colliders.resolve(nx, nz, this.def.radius * 0.6)
      if (r.hit && !ctx.ground.canStep(this.pos.x, this.pos.z, r.x, r.z)) return false
      this.pos.x = r.x
      this.pos.z = r.z
      return !r.hit
    }
    this.pos.x = nx
    this.pos.z = nz
    return true
  }

  // ─── Attacks ─────────────────────────────────────────────────────────────

  private pickAttack(dist: number, behind: boolean): AttackDef | null {
    const pool = this.def.attacks.filter(a => {
      if ((this.cooldowns.get(a.id) ?? 0) > 0) return false
      if (a.enragedOnly && !this.enraged) return false
      if (a.behind && !behind) return false
      if (!a.behind && behind && a.shape.kind === 'cone' && !a.shape.back) return false
      return dist >= a.range[0] && dist <= a.range[1]
    })
    if (!pool.length) return null
    // Rear attacks take priority when flanked (punishes standing behind for too long).
    const rear = pool.filter(a => a.behind)
    if (rear.length && Math.random() < 0.7) return rear[0]
    let w = pool.reduce((s, a) => s + a.weight, 0) * Math.random()
    for (const a of pool) {
      w -= a.weight
      if (w <= 0) return a
    }
    return pool[0]
  }

  /** Begin an attack by id (the lab uses this). */
  forceAttack(id: string, ctx: CreatureCtx): void {
    const a = this.def.attacks.find(x => x.id === id)
    if (!a || !this.alive) return
    this.clearDecals()
    this.startAttack(a, ctx)
  }

  private startAttack(A: AttackDef, ctx: CreatureCtx): void {
    this.attack = A
    this.hitDone = false
    this.crash = 0
    this.setState('windup')
    this.decals = []
    this.points = []
    const S = A.shape
    const color = this.def.boss ? '#ff3d1f' : '#ff7a2a'
    if (S.kind === 'cone') this.decals.push(ctx.telegraphs.spawn({ kind: 'cone', radius: S.radius, angle: S.angle, back: S.back }, this.pos.x, this.pos.z, this.yaw, color))
    else if (S.kind === 'circle') this.decals.push(ctx.telegraphs.spawn({ kind: 'circle', radius: S.radius }, this.pos.x, this.pos.z, this.yaw, color))
    else if (S.kind === 'lane') this.decals.push(ctx.telegraphs.spawn({ kind: 'lane', length: S.length, width: S.width }, this.pos.x, this.pos.z, this.yaw, color))
    else if (S.kind === 'leap') this.decals.push(ctx.telegraphs.spawn({ kind: 'circle', radius: S.radius }, ctx.player.pos.x, ctx.player.pos.z, 0, color))
    else if (S.kind === 'burst' || S.kind === 'spit') {
      const n = S.count
      for (let i = 0; i < n; i += 1) {
        this.points.push(new THREE.Vector3())
        this.decals.push(ctx.telegraphs.spawn({ kind: 'circle', radius: S.radius }, ctx.player.pos.x, ctx.player.pos.z, 0, color))
      }
      this.scatterPoints(ctx, true)
    }
    ctx.audio?.play(A.anim === 'erupt' ? (this.def.boss ? 'bossRoar' : 'roar') : 'tell')
    if (A.anim === 'breath') ctx.audio?.play('charge', 0.6)
  }

  private scatterPoints(ctx: CreatureCtx, fresh: boolean): void {
    const A = this.attack!
    const S = A.shape
    const P = ctx.player.pos
    if (S.kind === 'burst') {
      this.points.forEach((p, i) => {
        if (i === 0) p.set(P.x, 0, P.z)
        else if (fresh) {
          const a = (i / (this.points.length - 1)) * TAU + Math.random() * 0.6
          const r = S.scatter * (0.45 + Math.random() * 0.55)
          p.set(P.x + Math.cos(a) * r, 0, P.z + Math.sin(a) * r)
        }
      })
    } else if (S.kind === 'spit') {
      const fwd = Math.atan2(P.x - this.pos.x, P.z - this.pos.z)
      const side = new THREE.Vector3(Math.cos(fwd), 0, -Math.sin(fwd))
      this.points.forEach((p, i) => {
        const off = this.points.length === 1 ? 0 : (i / (this.points.length - 1) - 0.5) * 2 * S.spread
        p.set(P.x + side.x * off, 0, P.z + side.z * off)
      })
    }
  }

  private trackDecals(ctx: CreatureCtx, tracking: boolean): void {
    const A = this.attack!
    const S = A.shape
    if (S.kind === 'cone' || S.kind === 'circle' || S.kind === 'lane') {
      const d = this.decals[0]
      let x = this.pos.x
      let z = this.pos.z
      if (S.kind === 'circle' && S.forward) {
        x += Math.sin(this.yaw) * S.forward
        z += Math.cos(this.yaw) * S.forward
      }
      if (tracking || d.x !== x || d.z !== z) d.place(x, z, this.yaw)
    } else if (tracking) {
      if (S.kind === 'leap') {
        const P = ctx.player.pos
        const dx = P.x - this.pos.x
        const dz = P.z - this.pos.z
        const L = Math.hypot(dx, dz)
        const k = L > S.range ? S.range / L : 1
        let tx = this.pos.x + dx * k
        let tz = this.pos.z + dz * k
        if (!ctx.ground.walkable(tx, tz)) {
          tx = this.pos.x + dx * k * 0.5
          tz = this.pos.z + dz * k * 0.5
        }
        if (this.def.boss && Math.hypot(tx - this.home.x, tz - this.home.z) > this.def.leash - 2) {
          const a = Math.atan2(tx - this.home.x, tz - this.home.z)
          tx = this.home.x + Math.sin(a) * (this.def.leash - 2)
          tz = this.home.z + Math.cos(a) * (this.def.leash - 2)
        }
        this.leapTo.set(tx, ctx.ground.heightAt(tx, tz), tz)
        this.decals[0].place(tx, tz, 0)
      } else {
        this.scatterPoints(ctx, false)
        this.points.forEach((p, i) => this.decals[i].place(p.x, p.z, 0))
      }
    }
  }

  private beginActive(ctx: CreatureCtx): void {
    const A = this.attack!
    const S = A.shape
    this.setState('active')
    this.hitDone = false
    this.flameT = 0
    ctx.audio?.play(this.def.boss ? 'heavySwing' : 'swing')
    if (S.kind === 'cone' && A.anim !== 'breath') {
      this.resolveCone(S.radius, S.angle, !!S.back, A, ctx)
      this.clearDecals()
    } else if (S.kind === 'circle') {
      const cx = this.pos.x + Math.sin(this.yaw) * S.forward
      const cz = this.pos.z + Math.cos(this.yaw) * S.forward
      if (A.anim !== 'spin') {
        this.resolveCircle(cx, cz, S.radius, A, ctx)
        this.clearDecals()
        ctx.fx.ring(cx, this.pos.y, cz, 1, S.radius, '#ffdca0')
        ctx.fx.dustPuff(cx, this.pos.y, cz, this.def.boss ? 26 : 10, '#d8c6a0', S.radius * 0.5)
        ctx.fx.shake(this.def.boss ? 0.6 : 0.2)
        ctx.audio?.play('stomp')
      }
    } else if (S.kind === 'lane') {
      this.laneFrom.copy(this.pos)
      this.laneDir.copy(this.forward)
      if (A.anim === 'roll' || A.anim === 'charge') ctx.audio?.play('fire', A.anim === 'charge' && this.def.id === 'ashfang' ? 1 : 0.4)
    } else if (S.kind === 'leap') {
      this.leapFrom.copy(this.pos)
    } else if (S.kind === 'burst') {
      for (let i = 0; i < this.points.length; i += 1) {
        const p = this.points[i]
        const y = ctx.ground.heightAt(p.x, p.z)
        this.resolveCircle(p.x, p.z, S.radius, A, ctx)
        ctx.fx.ring(p.x, y, p.z, 0.5, S.radius, '#ff9a3a', 0.5)
        ctx.fx.flame(new THREE.Vector3(p.x, y + 0.3, p.z), new THREE.Vector3(0, 1, 0), 0.5, 9, 18)
        ctx.fx.embers(p.x, y + 0.5, p.z, 10, S.radius)
      }
      this.clearDecals()
      ctx.fx.shake(0.55)
      ctx.audio?.play('stomp')
      ctx.audio?.play('fireHit')
    } else if (S.kind === 'spit') {
      const mouth = this.center(new THREE.Vector3()).addScaledVector(this.forward, this.def.radius).setY(this.pos.y + this.def.height * 0.85)
      this.points.forEach((p, i) => {
        const to = new THREE.Vector3(p.x, ctx.ground.heightAt(p.x, p.z) + 0.3, p.z)
        const decal = this.decals[i]
        const dur = Math.max(0.35, mouth.distanceTo(to) / S.speed)
        ctx.fx.lob(mouth, to, dur, 2 + mouth.distanceTo(to) * 0.18, this.def.id === 'ruinhorn' ? 'rubble' : this.def.boss ? 'fire' : 'magma', () => {
          decal.release()
          this.resolveCircle(p.x, p.z, S.radius, A, ctx, true)
          ctx.fx.ring(p.x, to.y, p.z, 0.5, S.radius, this.def.id === 'ruinhorn' ? '#e8dcc0' : '#ff9a3a', 0.4)
          if (this.def.id === 'ruinhorn') ctx.fx.dustPuff(p.x, to.y, p.z, 12, '#cbbd9e', 1.6)
          else ctx.fx.embers(p.x, to.y, p.z, 14, S.radius)
          ctx.fx.shake(0.2)
          ctx.audio?.play('stomp', 0.6)
        })
      })
      this.decals = []
    }
  }

  private runActive(A: AttackDef, k: number, dt: number, ctx: CreatureCtx): void {
    const S = A.shape
    const P = ctx.player
    if (S.kind === 'lane') {
      const speed = S.length / A.active
      if (!this.moveAlong(this.laneDir, speed, dt, ctx)) {
        // Crashed into a wall: longer, very punishable recovery.
        this.crash = 0.8
        ctx.fx.dustPuff(this.pos.x, this.pos.y, this.pos.z, 14, '#d8c6a0', 1.8)
        ctx.fx.shake(this.def.boss ? 0.5 : 0.15)
        ctx.audio?.play('stomp')
        this.clearDecals()
        this.setState('recover')
        return
      }
      if (Math.random() < dt * 30) {
        if (this.def.id === 'ashfang' || this.def.id === 'emberbeetle') ctx.fx.embers(this.pos.x, this.pos.y + 0.4, this.pos.z, 2, 1)
        else ctx.fx.dustPuff(this.pos.x, this.pos.y, this.pos.z, 1, '#d8c6a0', 0.6)
      }
      if (!this.hitDone) {
        const d = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z)
        if (d < this.def.radius + P.radius + 0.35) this.deliver(A, ctx)
      }
    } else if (S.kind === 'leap') {
      const e = smooth(k)
      this.pos.lerpVectors(this.leapFrom, this.leapTo, e)
      this.pos.y = THREE.MathUtils.lerp(this.leapFrom.y, this.leapTo.y, e) + Math.sin(k * Math.PI) * (this.def.boss ? 7 : 2.6)
      if (k >= 1 && !this.hitDone) {
        this.hitDone = true
        this.pos.y = this.leapTo.y
        this.clearDecals()
        this.resolveCircle(this.leapTo.x, this.leapTo.z, S.radius, A, ctx)
        ctx.fx.ring(this.leapTo.x, this.leapTo.y, this.leapTo.z, 1, S.radius, '#ffdca0')
        ctx.fx.dustPuff(this.leapTo.x, this.leapTo.y, this.leapTo.z, this.def.boss ? 30 : 10, this.def.region === 'caldera' ? '#6a5a55' : '#d8c6a0', S.radius * 0.45)
        if (this.def.id === 'vulkarr') ctx.fx.embers(this.leapTo.x, this.leapTo.y, this.leapTo.z, 24, S.radius)
        ctx.fx.shake(this.def.boss ? 0.8 : 0.25)
        ctx.audio?.play('stomp')
      }
    } else if (S.kind === 'cone' && A.anim === 'breath') {
      this.flameT += dt
      const head = new THREE.Vector3()
      this.rig.head.getWorldPosition(head)
      const dir = this.forward.clone()
      dir.y = -0.12
      dir.normalize()
      ctx.fx.flame(head.addScaledVector(dir, 1.5), dir, 0.55, S.radius * 1.15, 7)
      if (this.decals[0]) this.decals[0].place(this.pos.x, this.pos.z, this.yaw)
      if (this.flameT > 0.12 && !this.hitDone) this.resolveCone(S.radius, S.angle, false, A, ctx)
      if (Math.random() < dt * 6) ctx.audio?.play('fire', 0.5)
    } else if (S.kind === 'circle' && A.anim === 'spin') {
      if (!this.hitDone && k > 0.2) this.resolveCircle(this.pos.x, this.pos.z, S.radius, A, ctx)
      if (k > 0.2 && this.decals.length) {
        this.clearDecals()
        ctx.fx.ring(this.pos.x, this.pos.y, this.pos.z, 2, S.radius, '#ffb070', 0.35)
        ctx.fx.embers(this.pos.x, this.pos.y + 1, this.pos.z, 20, S.radius)
      }
    }
  }

  private resolveCone(radius: number, angle: number, back: boolean, A: AttackDef, ctx: CreatureCtx): void {
    const P = ctx.player
    const dx = P.pos.x - this.pos.x
    const dz = P.pos.z - this.pos.z
    const d = Math.hypot(dx, dz)
    if (d > radius + P.radius) return
    const facing = back ? wrap(this.yaw + Math.PI) : this.yaw
    const rel = Math.abs(wrap(Math.atan2(dx, dz) - facing))
    const half = THREE.MathUtils.degToRad(angle) / 2 + Math.atan2(P.radius, Math.max(d, 0.5))
    if (d < this.def.radius * 0.8 || rel <= half) this.deliver(A, ctx)
  }

  private resolveCircle(x: number, z: number, radius: number, A: AttackDef, ctx: CreatureCtx, allowRepeat = false): void {
    if (this.hitDone && !allowRepeat) return
    const P = ctx.player
    if (Math.hypot(P.pos.x - x, P.pos.z - z) <= radius + P.radius * 0.6) this.deliver(A, ctx)
  }

  private deliver(A: AttackDef, ctx: CreatureCtx): void {
    if (this.hitDone) return
    this.hitDone = true
    const r = ctx.player.receiveHit(A.damage * CONFIG.combat.monsterDamage, A.knock, { x: this.pos.x, z: this.pos.z }, `${this.def.name} — ${A.name}`)
    if (r === 'dodged') ctx.emit?.({ type: 'dodged', c: this })
  }

  // ─── Procedural attack animation ─────────────────────────────────────────

  private attackPose(A: AttackDef, phase: 'windup' | 'active' | 'recover', k: number): void {
    const T = this.target
    const e = smooth(k)
    const r = 1 - e
    const shake = phase === 'windup' ? Math.sin(this.t * 40) * 0.03 * k : 0
    switch (A.anim) {
      case 'bite':
        if (phase === 'windup') Object.assign(T, { headPitch: -0.35 * e, jaw: e, crouch: 0.3 * e, bodyPitch: -0.08 * e })
        else if (phase === 'active') Object.assign(T, { headPitch: 0.4, jaw: 1 - e, bodyPitch: 0.15, crouch: 0.1 })
        else Object.assign(T, { headPitch: 0.3 * r, crouch: 0.15 * r })
        break
      case 'gore':
        if (phase === 'windup') Object.assign(T, { headPitch: 0.5 * e, headYaw: -0.6 * e, crouch: 0.25 * e, bodyYaw: -0.15 * e })
        else if (phase === 'active') Object.assign(T, { headPitch: -0.45, headYaw: -0.6 + 1.3 * e, bodyYaw: 0.25 * e })
        else Object.assign(T, { headPitch: 0.35 * r, headYaw: 0.7 * r })
        break
      case 'charge':
        if (phase === 'windup') Object.assign(T, { headPitch: 0.5 * e, crouch: 0.35 * e, bodyPitch: 0.1 * e + shake, glow: 0.8 * e })
        else if (phase === 'active') Object.assign(T, { headPitch: 0.5, crouch: 0.15, bodyPitch: 0.12, glow: 0.8 })
        else Object.assign(T, { headPitch: 0.35 * r + 0.15, bodyPitch: -0.12 * r, crouch: 0.2 * r })
        break
      case 'tail':
        if (phase === 'windup') Object.assign(T, { bodyYaw: 0.45 * e, tailSwing: -0.9 * e, crouch: 0.2 * e })
        else if (phase === 'active') Object.assign(T, { bodyYaw: 0.45 - 1.1 * e, tailSwing: -0.9 + 2.3 * e })
        else Object.assign(T, { bodyYaw: -0.65 * r, tailSwing: 1.4 * r })
        break
      case 'stomp':
        if (phase === 'windup') Object.assign(T, { bodyPitch: -0.42 * e + shake, bodyY: this.def.height * 0.12 * e, headPitch: -0.35 * e, jaw: 0.6 * e })
        else if (phase === 'active') Object.assign(T, { bodyPitch: 0.12, crouch: 0.35, headPitch: 0.3 })
        else Object.assign(T, { crouch: 0.35 * r, headPitch: 0.3 * r })
        break
      case 'kick':
        if (phase === 'windup') Object.assign(T, { bodyPitch: 0.22 * e, headPitch: 0.35 * e, crouch: 0.15 * e })
        else if (phase === 'active') Object.assign(T, { bodyPitch: -0.12, tailSwing: 0.5 })
        else Object.assign(T, { bodyPitch: -0.1 * r })
        break
      case 'pounce':
        if (phase === 'windup') Object.assign(T, { crouch: 0.85 * e, headPitch: -0.1, tailSwing: Math.sin(this.t * 18) * 0.3 * e, jaw: 0.4 * e })
        else if (phase === 'active') Object.assign(T, { crouch: 0.4, bodyPitch: -0.25 + 0.5 * e, jaw: 1, headPitch: 0.1 })
        else Object.assign(T, { crouch: 0.45 * r, headPitch: 0.3 * r })
        break
      case 'claw':
        if (phase === 'windup') Object.assign(T, { bodyYaw: 0.45 * e, headPitch: -0.2 * e, crouch: 0.2 * e })
        else if (phase === 'active') Object.assign(T, { bodyYaw: 0.45 - 1 * e, headPitch: 0.25 })
        else Object.assign(T, { bodyYaw: -0.55 * r })
        break
      case 'spit':
        if (phase === 'windup') Object.assign(T, { headPitch: -0.5 * e, bodyPitch: -0.15 * e, glow: e, jaw: 0.3 * e })
        else if (phase === 'active') Object.assign(T, { headPitch: 0.25, jaw: 1, glow: 0.6 * r })
        else Object.assign(T, { headPitch: 0.2 * r })
        break
      case 'roll':
        if (phase === 'windup') Object.assign(T, { crouch: 0.6 * e, glow: 0.8 * e, bodyRoll: shake * 3 })
        else if (phase === 'active') {
          Object.assign(T, { crouch: 0.9, glow: 0.8 })
          this.pose.bodyPitch = this.t * 16
          T.bodyPitch = this.pose.bodyPitch
        } else Object.assign(T, { bodyRoll: 3.0 * (1 - smooth(Math.max(0, (k - 0.55) / 0.45))), crouch: 0.2 })
        break
      case 'breath':
        if (phase === 'windup') Object.assign(T, { headPitch: -0.7 * e, jaw: 0.3 * e, glow: 1.2 * e, bodyPitch: -0.12 * e, wing: 0.4 * e })
        else if (phase === 'active') Object.assign(T, { headPitch: 0.3, jaw: 1, glow: 1.2, headYaw: Math.sin(this.t * 3) * 0.12, wing: 0.3 })
        else Object.assign(T, { headPitch: 0.3 * r, glow: 0.5 * r, jaw: 0.4 * r })
        break
      case 'spin':
        if (phase === 'windup') Object.assign(T, { bodyYaw: 0.7 * e, tailSwing: -1.1 * e, crouch: 0.25 * e })
        else if (phase === 'active') {
          const a = 0.7 - e * (TAU + 0.7)
          this.pose.bodyYaw = a
          Object.assign(T, { bodyYaw: a, tailSwing: 0.2, crouch: 0.2 })
        } else Object.assign(T, { bodyYaw: 0, crouch: 0.25 * r, headPitch: 0.3 * r })
        break
      case 'erupt':
        if (phase === 'windup') Object.assign(T, { headPitch: -0.8 * e, jaw: e, glow: 1.4 * e, bodyPitch: -0.2 * e, wing: 1 * e })
        else if (phase === 'active') Object.assign(T, { bodyPitch: 0.15, headPitch: 0.35, glow: 1, crouch: 0.3 })
        else Object.assign(T, { headPitch: 0.3 * r, glow: 0.6 * r })
        break
      case 'slam':
        if (phase === 'windup') Object.assign(T, { crouch: 0.75 * e, wing: 0.6 * e, headPitch: -0.2 * e })
        else if (phase === 'active') Object.assign(T, { wing: 1.2, bodyPitch: -0.25 + 0.5 * e, crouch: 0.2 })
        else Object.assign(T, { crouch: 0.5 * r, headPitch: 0.35 * r })
        break
      case 'toss':
        if (phase === 'windup') Object.assign(T, { headPitch: 0.65 * e, crouch: 0.3 * e, bodyPitch: 0.1 * e + shake })
        else if (phase === 'active') Object.assign(T, { headPitch: -0.9, jaw: 0.6, bodyPitch: -0.15 })
        else Object.assign(T, { headPitch: -0.3 * r })
        break
    }
  }
}
