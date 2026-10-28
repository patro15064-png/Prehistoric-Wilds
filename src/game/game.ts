import * as THREE from 'three'
import { assets } from '../engine/assets'
import { CONFIG } from './config'
import { Colliders } from './colliders'
import { Scenery, type SceneryQuality } from './scenery'
import { ARENAS, MAP_GRID, REGION_NAMES, Terrain, WORLD, type RegionId } from './terrain'
import { Fx } from './fx'
import { Telegraphs } from './telegraphs'
import { Creature, type CreatureCtx, type CreatureEvent } from './creatures'
import { Player, type PlayerCtx } from './player'
import { OrbitCamera } from './camera'
import { Nodes, type GNode } from './nodes'
import { Camp, CAMP } from './camp'
import { GADGET_TUNING as GT, GEAR, HELD_NAMES, HELD_ORDER, ITEMS, MEALS, NODES, SLING_RANGE, SPAWNS, SPECIES, TRACKING, type GadgetId, type GearId, type HeldId, type ItemId, type MealId, type RecipeId, type SearQuality, type SpeciesId } from './data'
import { Gadgets } from './gadgets'
import { Tracks, type StudyTarget } from './tracks'
import { Harvest } from './harvest'
import {
  PROGRESS_KEY, add, addClue, canHold, carveLoot, clearTrack, cook, craft, equip, gearStats, hold, isTracked, newProgress, nextGadget, nextHeld, noteHunt, notePart,
  noteSeen, noteWeak, objective, parseProgress, restoreTower, tickMeal, upgradeCamp, useGadget,
  type ActionResult, type Objective, type Progress,
} from './rules'
import type { Renderer } from '../engine/renderer'
import type { Input } from '../engine/input'
import type { Audio } from '../engine/audio'

export type Mode = 'loading' | 'title' | 'playing' | 'menu' | 'paused' | 'fainted' | 'victory'
export type PopupKind = 'dmg' | 'punish' | 'big' | 'heal' | 'info' | 'loot' | 'warn' | 'taken' | 'weak'
export type MenuTab = 'materials' | 'craft' | 'camp' | 'gear' | 'cook' | 'journal'
export type StampKind = 'gold' | 'trap' | 'flash' | 'track' | 'counter'
export type Hooks = {
  popup(text: string, at: THREE.Vector3, kind: PopupKind): void
  toast(text: string, kind?: 'good' | 'warn' | 'info'): void
  loot(id: ItemId, n: number): void
  banner(title: string, sub: string, kind?: 'region' | 'boss' | 'camp'): void
  tip(id: string, html: string): void
  openMenu(tab?: MenuTab): void
  /** Big centre-screen callout (PERFECT SEAR, TRAPPED, COUNTER!...). */
  stamp(text: string, kind: StampKind): void
  /** A journal page gained knowledge. */
  journal(sp: SpeciesId, text: string): void
  /** Full-screen white-out pulse (0..1). */
  flash(amount: number): void
  faint(): void
  victory(): void
  hurt(amount: number): void
}
export type Interact = { label: string; verb: string; enabled: boolean; note?: string }

const HEARTH_R = 4.4
const TOWER_R = 5.2

export class Game {
  readonly scene = new THREE.Scene()
  readonly terrain = new Terrain()
  readonly colliders = new Colliders()
  private readonly reserved = new Colliders()
  scenery!: Scenery
  readonly fx = new Fx()
  readonly telegraphs: Telegraphs
  readonly player = new Player()
  readonly cam: OrbitCamera
  nodes!: Nodes
  harvest!: Harvest
  private resT = 99
  private pendingHeld: HeldId | null = null
  /** Carcass being carved; released if the carve is interrupted so it can still sink and respawn. */
  private carveTarget: Creature | null = null
  private resId = -1
  private resKind: 'tree' | 'rock' = 'tree'
  private resPos: THREE.Vector3 | null = null
  /** Last chop/mine feedback for the HUD progress bar. */
  harvestInfo = { label: '', frac: 1, t: 99, slow: false, kind: 'tree' as 'tree' | 'rock' }
  camp!: Camp
  gadgets!: Gadgets
  tracks!: Tracks
  /** Species whose scent trail is shown (last one tracked). */
  trackSp: SpeciesId | null = null
  private gadgetBuffer = 0
  /** World position of the nearest tracked beast (map pin / compass). */
  trackPos: THREE.Vector3 | null = null
  private huntStart = new Map<number, number>()
  private sightT = 0
  private prevPState = ''
  readonly creatures: Creature[] = []
  progress: Progress = newProgress()
  mode: Mode = 'loading'
  lockTarget: Creature | null = null
  softTarget: Creature | null = null
  /** Most recent creature you fought (for the HUD target panel). */
  focusTarget: Creature | null = null
  boss: Creature | null = null
  interact: Interact | null = null
  region: RegionId = 'coast'
  /** Combat level this frame (0 none, 1 hunt, 2 boss) and smoothed frame time — drive background loading. */
  private combatLevel = 0
  private frameAvg = 1 / 60
  private stepDist = 0
  private readonly _trailBase = new THREE.Vector3()
  heat = 0
  time = 0
  reducedMotion = false
  private interactFn: (() => void) | null = null
  private cctx!: CreatureCtx
  private pctx!: PlayerCtx
  private saveT = 0
  private faintT = 0
  private cineT = 0
  private titleT = 0
  private focusT = 0
  private lastRegion: RegionId | null = null
  private readonly v = new THREE.Vector3()
  private mapCanvas?: HTMLCanvasElement
  quality: SceneryQuality

  constructor(private readonly renderer: Renderer, private readonly input: Input, readonly audio: Audio, private readonly hooks: Hooks, quality: SceneryQuality) {
    this.quality = quality
    this.cam = new OrbitCamera(innerWidth / innerHeight)
    this.telegraphs = new Telegraphs(this.terrain)
    this.scene.add(this.fx.group, this.telegraphs.group, this.player.root)
  }

  /** Build the world in phases (the loading bar follows `progress`). */
  async load(progress: (f: number) => void): Promise<void> {
    // Keep scatter away from the camp footprint.
    this.reserved.add(CAMP.x, CAMP.z, 22)
    this.scenery = new Scenery(this.scene, this.terrain, this.colliders, this.reserved, this.quality)
    await this.scenery.build(f => progress(f * 0.8))
    this.nodes = new Nodes(this.terrain, this.colliders)
    this.scene.add(this.nodes.group)
    this.harvest = new Harvest(this.scenery, this.terrain, this.colliders, this.fx, this.audio)
    this.scene.add(this.harvest.group)
    this.harvest.onLoot = (items, at, kind) => {
      items.forEach(([id, n], i) => this.give(id, n, at.clone().setY(at.y + i * 0.45)))
      this.audio.play('pickup', 0.8)
      this.fx.fountain(at, kind === 'tree' ? '#ffd9a0' : '#e8ecf4', 16, 2.5)
      this.harvestInfo.t = 99
      this.progress.harvested += 1
    }
    progress(0.85)
    await new Promise(r => setTimeout(r, 0))
    this.camp = new Camp(this.terrain, this.colliders, this.fx)
    this.scene.add(this.camp.root)
    this.gadgets = new Gadgets(this.scene, this.terrain, this.fx, this.audio)
    this.tracks = new Tracks(this.scene, this.terrain)
    this.spawnCreatures()
    progress(0.95)
    this.player.root.traverse(o => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true
    })
    this.cctx = {
      ground: this.terrain,
      colliders: this.colliders,
      telegraphs: this.telegraphs,
      fx: this.fx,
      audio: this.audio,
      player: this.player,
      safe: { x: CAMP.x, z: CAMP.z, r: CAMP.safeR },
      emit: e => this.onCreatureEvent(e),
      creatures: this.creatures,
      onStep: (c, x, z, yaw) => this.tracks.addPrint(c, x, z, yaw),
    }
    this.pctx = {
      input: this.input,
      camYaw: 0,
      ground: this.terrain,
      colliders: this.colliders,
      creatures: this.creatures,
      aim: null,
      locked: false,
      fx: this.fx,
      audio: this.audio,
      cctx: this.cctx,
      onHit: (c, r, p, heavy) => this.onPlayerHit(c, r, p, heavy),
      poultices: () => this.progress.inv.poultice ?? 0,
      consumePoultice: () => {
        add(this.progress, 'poultice', -1)
        this.hooks.popup(`+${CONFIG.player.healAmount}`, this.player.pos.clone().setY(this.player.pos.y + 2.2), 'heal')
      },
      onError: msg => this.hooks.toast(msg, 'warn'),
      harvestAim: yaw => {
        const P = this.player
        const r = this.harvest.target(P.pos.x, P.pos.z, yaw, P.reach + 0.8, 1.0)
        return r ? Math.atan2(r.x - P.pos.x, r.z - P.pos.z) : null
      },
      harvestStrike: (heavy, charge) => this.harvestStrike(heavy, charge),
      shoot: (from, yaw, motion, charged) => this.slingShot(from, yaw, motion, charged),
      onCounter: () => {
        this.hooks.stamp('COUNTER!', 'counter')
        this.fx.hitstop(0.14)
        this.audio.play('perfect')
        this.fx.impactFlash(this.player.pos.clone().setY(this.player.pos.y + 1.2), '#ffe9a8', 3, 0.2)
      },
    }
    this.applyProgress(false)
    this.player.place(CAMP.spawn.x, CAMP.spawn.z, this.terrain, Math.PI)
    this.mode = 'title'
    // Warm up particles and chunk culling before the first frame is shown.
    const campFocus = new THREE.Vector3(CAMP.x, this.terrain.heightAt(CAMP.x, CAMP.z), CAMP.z)
    for (let i = 0; i < 30; i += 1) {
      this.titleCamera(1 / 30)
      this.scenery.update(1 / 30, i / 30, this.cam.camera, campFocus, this.pixelScale)
    }
    progress(1)
  }

  get hasSave(): boolean {
    try {
      return !!parseProgress(localStorage.getItem(PROGRESS_KEY))
    } catch {
      return false
    }
  }

  // ─── Session control ─────────────────────────────────────────────────────

  start(fresh: boolean): void {
    let p: Progress | null = null
    if (!fresh) {
      try {
        p = parseProgress(localStorage.getItem(PROGRESS_KEY))
      } catch {
        p = null
      }
    }
    this.progress = p ?? newProgress()
    this.applyProgress(false)
    for (const c of this.creatures) c.respawn(this.terrain)
    this.telegraphs.clear()
    this.fx.clearTransient()
    this.harvest.reset()
    this.gadgets.clear()
    this.tracks.clear()
    this.huntStart.clear()
    this.trackSp = (Object.keys(SPECIES) as SpeciesId[]).find(sp => isTracked(this.progress, sp)) ?? null
    this.pendingHeld = null
    this.player.revive()
    this.player.place(CAMP.spawn.x, CAMP.spawn.z, this.terrain, Math.PI)
    this.cam.snap(this.player.pos, Math.PI)
    this.lockTarget = null
    this.focusTarget = null
    this.boss = null
    this.lastRegion = null
    this.mode = 'playing'
    this.save()
    if (!this.progress.tips.includes('move')) {
      this.tip('move', '<b>WASD</b> move · <b>Mouse</b> look · <b>Shift</b> sprint · <b>E</b> interact. Follow the <b>objective marker</b>.')
    }
  }

  toTitle(): void {
    this.save()
    this.mode = 'title'
    this.telegraphs.clear()
    this.lockTarget = null
  }

  pause(): void {
    if (this.mode === 'playing') this.mode = 'paused'
  }

  resume(): void {
    if (this.mode === 'paused' || this.mode === 'menu') this.mode = 'playing'
  }

  openMenu(tab?: MenuTab): void {
    if (this.mode !== 'playing') return
    this.mode = 'menu'
    this.hooks.openMenu(tab)
  }

  get atCamp(): boolean {
    return Math.hypot(this.player.pos.x - CAMP.x, this.player.pos.z - CAMP.z) < CAMP.safeR + 1
  }

  save(): void {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(this.progress))
    } catch {
      /* storage unavailable: session-only progress */
    }
  }

  /** Cook and eat a meal at the hearth. `q` comes from the sear gauge. */
  cookMeal(id: MealId, q: SearQuality): ActionResult {
    const r = cook(this.progress, id, q)
    if (!r.ok) {
      this.audio.play('error')
      return r
    }
    const P = this.player
    const hpBuff = MEALS[id].buff.hp ?? 0
    this.applyProgress(false)
    P.hp = Math.min(P.maxHp, P.hp + hpBuff)
    P.stamina = P.maxStamina
    this.progress.hunger = Math.min(100, this.progress.hunger + 38)
    this.audio.play('eat')
    if (q === 'perfect') this.audio.play('searPerfect')
    const at = new THREE.Vector3(CAMP.hearth.x, this.terrain.heightAt(CAMP.hearth.x, CAMP.hearth.z) + 1.2, CAMP.hearth.z)
    this.fx.fountain(at, q === 'charred' ? '#8a6a50' : '#ffcf7a', q === 'perfect' ? 50 : 26, 4)
    this.fx.embers(at.x, at.y, at.z, q === 'perfect' ? 24 : 10, 1.2)
    this.save()
    return r
  }

  private applyProgress(animate: boolean): void {
    const p = this.progress
    const stats = gearStats(p)
    const tier = GEAR[p.weapon].tier
    if (!canHold(p, p.held)) p.held = 'weapon'
    this.player.setGear(stats, p.weapon, p.armor, tier, p.held)
    this.camp.setStage(p.campStage, p.towerRestored, animate)
  }

  // ─── Camp actions (UI) ───────────────────────────────────────────────────

  craft(id: RecipeId): ActionResult {
    const r = craft(this.progress, id)
    if (r.ok) {
      this.audio.play('craft')
      const gear = GEAR[id as GearId]
      if (gear && gear.slot !== 'tool') {
        equip(this.progress, gear.id)
        this.applyProgress(false)
      } else {
        this.applyProgress(false)
        if (gear && (gear.id === 'flintHatchet' || gear.id === 'flintPick')) {
          const key = HELD_ORDER.indexOf(gear.id) + 1
          this.hooks.toast(`${gear.name} ready: press ${key} to hold it (1 weapon · 4 bare hands).`, 'good')
        }
      }
      this.fx.fountain(this.player.pos.clone().setY(this.player.pos.y + 1), '#ffe6a0', 30, 4)
      this.save()
    } else this.audio.play('error')
    return r
  }

  equip(id: GearId): void {
    if (equip(this.progress, id)) {
      this.applyProgress(false)
      this.audio.play('ui')
      this.save()
    }
  }

  upgrade(): ActionResult {
    const r = upgradeCamp(this.progress)
    if (r.ok) {
      this.audio.play('upgrade')
      this.camp.setStage(this.progress.campStage, false, true)
      this.player.restore()
      const names = ['', 'Hearth Camp', 'Palisade Camp', 'Stonehold Camp']
      const subs = ['', 'Crafting and resting unlocked', 'Tier II gear unlocked', 'Tier III gear and the Signal Tower unlocked']
      this.hooks.banner(names[this.progress.campStage], `Camp stage ${this.progress.campStage} of 3 · ${subs[this.progress.campStage]}`, 'camp')
      this.save()
    } else this.audio.play('error')
    return r
  }

  restoreTower(): ActionResult {
    const r = restoreTower(this.progress)
    if (r.ok) {
      this.save()
      this.mode = 'victory'
      this.cineT = 0
      this.camp.setStage(3, true, true)
      this.camp.celebrateTower()
      this.audio.play('win')
      this.audio.playVictory()
      this.audio.intensity = 0
      this.hooks.banner('The Signal Tower blazes', 'A rescue fleet turns toward Cinderfall Isle', 'camp')
      window.setTimeout(() => this.hooks.victory(), 6500)
    } else this.audio.play('error')
    return r
  }

  /** Keep playing after victory. */
  keepExploring(): void {
    this.mode = 'playing'
  }

  // ─── World setup ─────────────────────────────────────────────────────────

  private spawnCreatures(): void {
    const T = this.terrain
    let seed = 1
    const rnd = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const spot = (cx: number, cz: number, spread: number, shore: boolean) => {
      for (let i = 0; i < 60; i += 1) {
        const a = rnd() * Math.PI * 2
        const d = rnd() * spread
        const x = cx + Math.cos(a) * d
        const z = cz + Math.sin(a) * d
        if (!T.walkable(x, z) || T.slopeAt(x, z) > 0.6) continue
        if (shore && T.heightAt(x, z) > 2.6) continue
        if (!this.colliders.clear(x, z, 1.4)) continue
        if (Math.hypot(x - CAMP.x, z - CAMP.z) < CAMP.safeR + 12) continue
        return { x, z }
      }
      return { x: cx, z: cz }
    }
    for (const g of SPAWNS) {
      for (let i = 0; i < g.count; i += 1) {
        const p = spot(g.x, g.z, g.spread, !!g.shore)
        this.addCreature(new Creature(g.species, p.x, p.z, T))
      }
    }
    this.addCreature(new Creature('ruinhorn', ARENAS.ruins.x + 4, ARENAS.ruins.z, T))
    this.addCreature(new Creature('vulkarr', ARENAS.wyrm.x, ARENAS.wyrm.z + 2, T))
  }

  private addCreature(c: Creature): void {
    c.rig.root.traverse(o => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true
    })
    this.creatures.push(c)
    this.scene.add(c.rig.root)
  }

  // ─── Events ──────────────────────────────────────────────────────────────

  private onCreatureEvent(e: CreatureEvent): void {
    const c = e.c
    switch (e.type) {
      case 'engage':
        if (!this.huntStart.has(c.id)) this.huntStart.set(c.id, this.progress.playTime)
        if (c.def.boss) {
          this.boss = c
          this.hooks.banner(c.def.name, c.def.title, 'boss')
        } else if (!this.progress.tips.includes('combat')) {
          this.tip('combat', '<b>Left click</b> light combo · <b>Hold right click</b> charged heavy · <b>Space</b> dodge through attacks. Red zones show where attacks will land — punish the recovery!')
        } else if (!this.progress.tips.includes('lock')) {
          this.tip('lock', 'Press <b>Q</b> (or middle mouse) to lock on and keep the creature framed.')
        }
        break
      case 'enrage':
        this.hooks.toast(`${c.def.name} is enraged! Attacks come faster.`, 'warn')
        this.fx.shake(0.6)
        break
      case 'stagger':
        this.hooks.popup('STAGGER', c.center(this.v.clone()).setY(c.pos.y + c.def.height + 0.6), 'big')
        break
      case 'killed': {
        const p = this.progress
        const first = !(p.hunts[c.def.id] ?? 0)
        p.hunts[c.def.id] = (p.hunts[c.def.id] ?? 0) + 1
        c.carvesLeft += gearStats(p).carves
        const t0 = this.huntStart.get(c.id)
        this.huntStart.delete(c.id)
        noteHunt(p, c.def.id, t0 !== undefined ? p.playTime - t0 : 0)
        const wasTracked = isTracked(p, c.def.id)
        clearTrack(p, c.def.id)
        if (this.trackSp === c.def.id) {
          this.trackSp = null
          this.trackPos = null
        }
        this.hooks.journal(c.def.id, first ? `${c.def.name}: attacks, weak spot and drops recorded` : `${c.def.name}: hunt #${p.hunts[c.def.id]} recorded`)
        if (wasTracked) this.hooks.toast('Trail spent. Study fresh clues to track another.', 'info')
        if (this.lockTarget === c) this.lockTarget = null
        if (c.def.boss) {
          if (c.def.id === 'ruinhorn') p.bosses.ruinhorn = true
          if (c.def.id === 'vulkarr') p.bosses.vulkarr = true
          this.boss = null
          this.hooks.banner(`${c.def.name} hunted`, 'Carve its body with E — it holds what the tower needs', 'boss')
          this.audio.play('win')
        } else {
          this.hooks.popup(`${c.def.name} down`, c.pos.clone().setY(c.pos.y + c.def.height + 0.5), 'info')
        }
        if (!p.tips.includes('carve')) this.tip('carve', 'Stand by the carcass and press <b>E</b> to carve parts. Each hunt allows several carves.')
        this.save()
        break
      }
      case 'predation': {
        const by = e.by
        const d = Math.hypot(c.pos.x - this.player.pos.x, c.pos.z - this.player.pos.z)
        if (d < 60) {
          this.hooks.popup(`${by.def.name} brings down a ${c.def.name}`, c.pos.clone().setY(c.pos.y + c.def.height + 0.6), 'warn')
          this.tip('feed', `A feeding predator is distracted: strike it now for a <b>sneak attack (+50%)</b>. The carcass can be scavenged with <b>E</b>.`)
        }
        break
      }
      case 'hunting': {
        const d = Math.hypot(c.pos.x - this.player.pos.x, c.pos.z - this.player.pos.z)
        if (d < 50) {
          this.hooks.popup('Stalking prey', c.pos.clone().setY(c.pos.y + c.def.height + 0.6), 'info')
          this.tip('ecology', `The <b>${c.def.name}</b> is hunting a <b>${e.prey.def.name}</b>. Let it make the kill, then ambush it while it feeds.`)
        }
        break
      }
      case 'trapped': {
        const label = e.kind === 'trip' ? 'TRIPPED' : e.kind === 'pit' ? 'IN THE PIT' : 'TRAPPED'
        this.hooks.stamp(label, 'trap')
        this.fx.hitstop(e.kind === 'trip' ? 0.16 : 0.08)
        this.fx.shake(e.kind === 'pit' ? 0.4 : 0.2)
        this.focusTarget = c
        this.focusT = 8
        if (e.kind === 'trip') this.tip('trip', 'A beast that hits a snare mid-charge is <b>tripped</b>: it takes <b>+30% damage</b> while it is down.')
        break
      }
      case 'resisted':
        this.hooks.popup('RESISTED', c.pos.clone().setY(c.pos.y + c.def.height + 0.6), 'warn')
        this.hooks.toast(`${c.def.name} shrugs off the ${e.kind === 'pit' ? 'pitfall' : e.kind === 'flash' ? 'flash' : 'snare'}. It has learned. Wait before using that trick again.`, 'warn')
        break
      case 'blinded':
        if (e.interrupted) {
          this.hooks.stamp('FLASH INTERRUPT', 'flash')
          this.fx.hitstop(0.1)
        } else this.hooks.popup('BLINDED', c.pos.clone().setY(c.pos.y + c.def.height + 0.6), 'big')
        this.focusTarget = c
        this.focusT = 6
        break
      case 'dodged':
        this.player.stamina = Math.min(this.player.maxStamina, this.player.stamina + 12)
        this.audio.play('perfect')
        this.fx.ring(this.player.pos.x, this.player.pos.y, this.player.pos.z, 0.4, 3.2, '#9fe8ff', 0.35)
        this.fx.sparks(this.player.pos.clone().setY(this.player.pos.y + 1), '#bff4ff', 14, 5)
        this.fx.hitstop(0.05)
        this.hooks.popup('Evaded', this.player.pos.clone().setY(this.player.pos.y + 2.2), 'info')
        break
    }
  }

  private onPlayerHit(c: Creature, r: ReturnType<Creature['takeHit']>, point: THREE.Vector3, heavy: boolean): void {
    if (r.dealt <= 0) return
    this.focusTarget = c
    this.focusT = 12
    const big = heavy || r.punish
    this.fx.hitBurst(point, r.punish ? '#ffb347' : '#fff1b8', big)
    this.fx.sparks(point, r.punish ? '#ffb347' : '#ffe08a', big ? 18 : 10, big ? 9 : 6)
    const P = this.player
    const tilt = P.state === 'heavy' ? Math.PI / 2 + (Math.random() - 0.5) * 0.3 : (P.step % 2 ? -0.5 : 0.5) + (Math.random() - 0.5) * 0.4
    this.fx.slash(point, this.cam.camera, tilt, r.punish ? '#ffc070' : '#fff0c8', heavy ? 3.2 : 2.2)
    if (heavy) {
      const gy = this.terrain.heightAt(point.x, point.z)
      this.fx.crack(point.x, gy, point.z, 1.2 + P.chargeLevel * 0.5)
      this.fx.smoke(point.x, gy, point.z, 6, '#cbbd9f', 1.4)
    }
    this.fx.hitstop(CONFIG.combat.hitstop * (heavy ? 1.8 : 1) * (r.punish ? 1.25 : 1))
    this.fx.shake(heavy ? 0.28 : 0.1)
    this.audio.play(big ? 'bigHit' : 'hit')
    this.hooks.popup(r.weak ? `${r.dealt} WEAK` : String(r.dealt), point.clone().setY(point.y + 0.6), r.weak ? 'weak' : r.punish ? 'punish' : heavy ? 'big' : 'dmg')
    if (r.sneak) this.hooks.popup('SNEAK ATTACK', point.clone().setY(point.y + 1.4), 'big')
    if (r.weak) {
      this.fx.sparks(point, '#ff9a3a', 8, 5)
      if (noteWeak(this.progress, c.def.id)) this.hooks.journal(c.def.id, `${c.def.name}: weak spot found (${c.def.weak.label} ×${c.def.weak.mult})`)
    }
  }

  /** Sling: spend a stone and loose it at the lock-on target, a creature near the aim line, or straight ahead. */
  private slingShot(from: THREE.Vector3, yaw: number, motion: number, charged: boolean): boolean {
    if ((this.progress.inv.stone ?? 0) <= 0) {
      this.tip('ammo', 'The sling fires <b>Stone</b>. Mine boulders (a <b>Flint Pick</b> is fastest) to refill.')
      return false
    }
    add(this.progress, 'stone', -1)
    let tgt: Creature | null = this.lockTarget
    if (!tgt) {
      let best = Infinity
      for (const c of this.creatures) {
        if (!c.alive) continue
        const dx = c.pos.x - from.x
        const dz = c.pos.z - from.z
        const d = Math.hypot(dx, dz)
        if (d > SLING_RANGE * (charged ? 1.5 : 1) + c.def.radius) continue
        const rel = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - yaw), Math.cos(Math.atan2(dx, dz) - yaw)))
        if (rel > 0.4) continue
        const sc = d * (1 + rel * 3)
        if (sc < best) {
          best = sc
          tgt = c
        }
      }
    }
    const dir = tgt ? tgt.center(new THREE.Vector3()).sub(from).normalize() : new THREE.Vector3(Math.sin(yaw), 0.05, Math.cos(yaw)).normalize()
    if (tgt) dir.y += 0.02
    this.gadgets.shoot(from, dir, this.player.stats.attack, motion, charged, { x: this.player.pos.x, z: this.player.pos.z })
    if (charged) this.fx.ring(from.x, from.y, from.z, 0.2, 1.2, '#fff0c8', 0.25)
    return true
  }

  /** G: lay a snare, dig a pitfall or throw a flash pod. */
  private useGadgetAction(): void {
    const P = this.player
    const p = this.progress
    const g: GadgetId = p.gadget
    const name = ITEMS[g].name
    if (P.state !== 'move' || !P.alive) return
    if ((p.inv[g] ?? 0) <= 0) {
      this.audio.play('error')
      this.hooks.toast(`No ${name} left. Craft more at the camp workbench (C cycles gadgets).`, 'warn')
      return
    }
    const fx = Math.sin(P.yaw)
    const fz = Math.cos(P.yaw)
    if (g === 'flashPod') {
      const aim = this.lockTarget ?? this.softTarget
      let to: THREE.Vector3
      if (aim && Math.hypot(aim.pos.x - P.pos.x, aim.pos.z - P.pos.z) < GT.flashRange) to = aim.pos.clone()
      else {
        const cy = this.cam.yaw
        const x = P.pos.x + Math.sin(cy) * 10
        const z = P.pos.z + Math.cos(cy) * 10
        to = new THREE.Vector3(x, this.terrain.heightAt(x, z), z)
        P.yaw = cy
      }
      P.startThrow(() => {
        if (!useGadget(p, g)) return
        this.gadgets.throwFlash(P.pos.clone().setY(P.pos.y + 1.7), to)
      }, () => this.gadgetInterrupted(name, P.pos.x, P.pos.z, 'throw'))
      return
    }
    const x = P.pos.x + fx * 1.2
    const z = P.pos.z + fz * 1.2
    const why = this.gadgets.canPlace(x, z, CAMP)
    if (why) {
      this.audio.play('error')
      this.hooks.toast(why, 'warn')
      return
    }
    if (g === 'pitfall' && this.gadgets.traps.some(t => t.kind === 'pitfall' && t.sprung <= 0)) {
      this.audio.play('error')
      this.hooks.toast('Only one pitfall can be dug at a time.', 'warn')
      return
    }
    const yaw = P.yaw
    P.startTask('gather', g === 'pitfall' ? GT.pitDig : 0.5, () => {
      if (!useGadget(p, g)) return
      this.gadgets.place(g === 'pitfall' ? 'pitfall' : 'snare', x, z, yaw)
      this.hooks.popup(g === 'pitfall' ? 'Pitfall dug' : 'Snare set', new THREE.Vector3(x, this.terrain.heightAt(x, z) + 1.2, z), 'info')
      this.tip('trap', 'Lure a beast across your trap. <b>Charging</b> beasts get tripped by snares; pits hold anything for a long punish.')
      this.save()
    }, () => this.gadgetInterrupted(name, x, z, 'set'))
    this.audio.play(g === 'pitfall' ? 'gatherRock' : 'gatherPlant', 0.8)
  }

  /** A hit (or dodge) cancelled setting a trap or throwing a pod: nothing is spent, but say so clearly. */
  private gadgetInterrupted(name: string, x: number, z: number, how: 'set' | 'throw'): void {
    const y = this.terrain.heightAt(x, z)
    this.hooks.popup('INTERRUPTED', new THREE.Vector3(x, y + 2.1, z), 'warn')
    this.fx.dustPuff(x, y, z, 8, '#b89a6a', 0.8)
    this.fx.sparks(new THREE.Vector3(x, y + 0.5, z), '#ffb070', 8, 2.5)
    this.audio.play('error', 0.7)
    this.hooks.toast(how === 'set' ? `Trap setting interrupted. Your ${name} was not used.` : `Throw interrupted. Your ${name} was not used.`, 'warn')
  }
  /** Study a clue spot or fresh prints. */
  private study(t: StudyTarget): void {
    const P = this.player
    P.yaw = Math.atan2(t.x - P.pos.x, t.z - P.pos.z)
    P.startTask('gather', 0.7, () => {
      this.tracks.study(t)
      const r = addClue(this.progress, t.sp)
      const def = SPECIES[t.sp]
      const at = new THREE.Vector3(t.x, this.terrain.heightAt(t.x, t.z) + 1, t.z)
      this.fx.sparks(at, '#d6ff8a', 14, 3)
      this.audio.play('clue')
      if (r.tracked) {
        this.trackSp = t.sp
        this.hooks.stamp(`${def.name.toUpperCase()} TRACKED`, 'track')
        this.audio.play('tracked')
        this.hooks.journal(t.sp, `${def.name}: habitat and ecology recorded`)
        this.tip('tracked', 'Follow the <b>scent fireflies</b> and the pin on your map and compass to the tracked beast.')
      } else {
        this.hooks.popup(`${def.name} clue ${r.clues}/${TRACKING.cluesNeeded}`, at.clone().setY(at.y + 1), 'info')
        if (r.clues >= TRACKING.cluesNeeded) this.trackSp = t.sp
      }
      this.save()
    })
  }

  /** True while the hunt is heating up: background asset prefetch pauses. */
  isBusy(): boolean {
    if (this.mode !== 'playing') return false
    return this.combatLevel > 0 || this.fx.activeCount + this.harvest.activeCount + this.gadgets.active * 20 > 450
  }
  /** Slow frames alone only throttle streaming (never starve it on low-end machines). */
  isSlow(): boolean {
    return this.mode === 'playing' && this.frameAvg > 0.03
  }
  private tip(id: string, html: string): void {
    if (this.progress.tips.includes(id)) return
    this.progress.tips.push(id)
    this.hooks.tip(id, html)
  }

  /** Food is a light survival pressure rather than a hard timer: moving and sprinting burn more. */
  private updateHunger(dt: number): void {
    const P = this.player
    if (this.mode !== 'playing' || !P.alive) return
    const moving = Math.hypot(P.vel.x, P.vel.z) > 0.35
    const rate = P.sprinting ? 1.2 : moving ? 0.48 : 0.2
    this.progress.hunger = Math.max(0, this.progress.hunger - rate * dt)
    if (this.progress.hunger <= 24) this.tip('hunger', 'Your <b>hunger</b> is low. Hunt ordinary wildlife, carve the carcass, and cook a meal at the camp hearth.')
    if (this.progress.hunger <= 0) {
      P.hurt(4.5 * dt)
      if (!this.progress.tips.includes('starving')) this.tip('starving', 'You are <b>starving</b>. Find food quickly or your health will keep falling.')
    }
  }

  // ─── Simulation ──────────────────────────────────────────────────────────

  step(dt: number): void {
    this.time += dt
    if (this.mode === 'title' || this.mode === 'loading') return
    if (this.mode === 'paused' || this.mode === 'menu') return
    const P = this.player
    this.progress.playTime += dt
    let simDt = dt
    if (this.fx.hitstopLeft > 0) {
      this.fx.hitstopLeft -= dt
      simDt = dt * 0.08
    }

    if (this.mode === 'playing') this.handleInput(dt)
    // Player
    this.pctx.camYaw = this.cam.yaw
    this.pctx.aim = this.lockTarget ?? this.softTarget
    this.pctx.locked = !!this.lockTarget
    const hpBefore = P.hp
    if (this.mode === 'playing' || this.mode === 'fainted' || this.mode === 'victory') P.update(simDt, this.pctx)
    if (this.carveTarget && P.state !== 'carve') {
      this.carveTarget.carving = false
      this.carveTarget = null
    }
    if (P.hp < hpBefore - 0.5) {
      this.hooks.hurt(hpBefore - P.hp)
      this.hooks.popup(`-${Math.round(hpBefore - P.hp)}`, P.pos.clone().setY(P.pos.y + 2.1), 'taken')
      this.audio.play('hurt')
      this.fx.shake(0.3)
    }
    this.updateHunger(dt)
    // Heat
    this.heat = this.terrain.heatAt(P.pos.x, P.pos.z)
    if (this.heat > 0.05 && P.alive && !P.stats.heatProof && this.mode === 'playing') {
      P.hurt(CONFIG.player.heatDamage * this.heat * dt * P.stats.heatRate)
      if (!this.progress.tips.includes('heat')) this.tip('heat', 'The inner caldera <b>scorches</b> you. Craft the <b>Ashguard Mantle</b> to withstand the heat.')
      if (Math.random() < dt * 6) this.fx.embers(P.pos.x, P.pos.y + 1, P.pos.z, 1, 0.8)
    }
    if (P.alive && P.hp < P.maxHp * 0.45 && (this.progress.inv.poultice ?? 0) > 0) this.tip('heal', 'Low health! Press <b>R</b> to apply a Mendleaf Poultice. You can craft more at camp.')

    // Meal buff countdown
    if (this.mode === 'playing' && tickMeal(this.progress, dt)) {
      this.applyProgress(false)
      this.hooks.toast('Your meal has worn off. Cook another at the hearth.', 'info')
    }
    // Sling whirl sound when a sling charge begins
    if (P.state !== this.prevPState) {
      if (P.state === 'charge' && P.stats.cls === 'sling' && this.progress.held === 'weapon') this.audio.play('slingWhirl')
      this.prevPState = P.state
    }

    // Creatures
    let combat = 0
    for (const c of this.creatures) {
      const d = Math.hypot(c.pos.x - P.pos.x, c.pos.z - P.pos.z)
      if (c.state === 'gone') {
        c.respawnT -= dt
        if (c.respawnT <= 0 && d > 70) c.respawn(this.terrain)
        continue
      }
      const active = d < 140 || c.engaged
      c.rig.root.visible = d < 190
      if (!active) continue
      c.update(simDt, this.cctx)
      if (c.alive && c.engaged && d < 45 && c.state !== 'idle' && c.state !== 'return') combat = Math.max(combat, c.def.boss ? 2 : 1)
    }
    this.audio.intensity = this.mode === 'playing' ? combat : 0
    this.combatLevel = this.mode === 'playing' ? combat : 0
    this.audio.setLowHealth(this.mode === 'playing' && P.alive && P.hp < P.maxHp * 0.3 ? 1 - P.hp / (P.maxHp * 0.3) : 0)
    // Footsteps (distance based) with sprint dust.
    if (this.mode === 'playing' && P.alive && (P.state === 'move' || P.state === 'heal')) {
      this.stepDist += Math.hypot(P.vel.x, P.vel.z) * dt
      const stride = P.sprinting ? 1.35 : 0.95
      if (this.stepDist > stride) {
        this.stepDist = 0
        this.audio.play(this.region === 'coast' ? 'step' : 'stepStone', P.sprinting ? 1 : 0.7)
        if (P.sprinting) this.fx.dustPuff(P.pos.x, P.pos.y, P.pos.z, 3, this.region === 'caldera' ? '#6a5a52' : '#cdb994', 0.4, 0.5)
      }
    }
    // Weapon ribbon while swinging.
    const av = P.avatar
    if (av.ready) {
      const swinging = P.state === 'attack' || P.state === 'heavy'
      this._trailBase.lerpVectors(av.grip, av.tip, 0.35)
      const tier = this.progress.weapon === 'obsidianClub' ? '#d6b8ff' : this.progress.weapon === 'amberHammer' ? '#ffc868' : this.progress.weapon === 'flintMaul' ? '#fff0c0' : '#ffe6b8'
      this.fx.swingTrail(this._trailBase, av.tip, swinging, tier)
    }
    if (this.boss && (!this.boss.alive || this.boss.state === 'return' || this.boss.state === 'idle')) {
      if (Math.hypot(this.boss.pos.x - P.pos.x, this.boss.pos.z - P.pos.z) > 70 || !this.boss.alive) this.boss = null
    }
    this.focusT -= dt
    if (this.focusT <= 0 || (this.focusTarget && !this.focusTarget.alive)) this.focusTarget = null

    this.updateTargets()
    this.gadgets.update(simDt, this.creatures, this.cctx, {
      onShotHit: (c, r, point, charged) => this.onPlayerHit(c, r, point, charged),
      onFlash: (x, _y, z, hits) => {
        const d = Math.hypot(x - this.player.pos.x, z - this.player.pos.z)
        this.hooks.flash(d < 16 ? 0.75 - d * 0.035 : 0.12)
        this.fx.shake(0.12)
        if (!hits.length) this.hooks.popup('No beast caught in the flash', new THREE.Vector3(x, this.terrain.heightAt(x, z) + 1.5, z), 'warn')
      },
    })
    this.updateTracking(dt)
    this.telegraphs.update(simDt)
    this.nodes.update(dt, this.time, this.pixelScale)
    this.harvest.update(dt, P.pos.x, P.pos.z)
    this.harvestInfo.t += dt
    this.resT += dt
    this.camp.update(dt, this.time)
    this.updateRegion()
    if (this.mode === 'playing') this.updateInteract()

    // Faint & recovery
    if (!P.alive && this.mode === 'playing') {
      this.mode = 'fainted'
      this.faintT = 0
      this.progress.faints += 1
      this.lockTarget = null
      if (this.progress.meal) {
        this.progress.meal = null
        this.applyProgress(false)
      }
      this.audio.play('lose')
      this.hooks.faint()
    }
    if (this.mode === 'fainted') {
      this.faintT += dt
      if (this.faintT > 3.2) this.recover()
    }
    if (this.mode === 'victory') this.cineT += dt

    this.saveT += dt
    if (this.saveT > 15) {
      this.saveT = 0
      this.save()
    }
  }

  /** Carried back to camp: full health, bosses retreat and heal. Nothing is lost. */
  private recover(): void {
    const P = this.player
    for (const c of this.creatures) {
      if (c.alive && c.engaged) {
        c.respawn(this.terrain)
        if (c.def.boss) c.hp = c.maxHp
      }
    }
    this.telegraphs.clear()
    this.boss = null
    P.revive()
    this.progress.hunger = Math.max(this.progress.hunger, 55)
    P.place(CAMP.spawn.x, CAMP.spawn.z, this.terrain, Math.PI)
    this.cam.snap(P.pos, Math.PI)
    this.mode = 'playing'
    this.hooks.toast('You wake by the camp fire. Your satchel is intact.', 'info')
    this.save()
  }

  private handleInput(dt: number): void {
    const I = this.input
    if (I.consume('lock')) {
      if (this.lockTarget) this.lockTarget = null
      else {
        this.lockTarget = this.pickLockTarget()
        if (this.lockTarget) this.audio.play('lockon')
      }
    }
    if (I.consume('interact') && this.interactFn && !this.player.busy) this.interactFn()
    if (I.consume('satchel')) this.openMenu(this.atCamp ? 'craft' : 'materials')
    const slots = ['slot1', 'slot2', 'slot3', 'slot4'] as const
    slots.forEach((a, i) => {
      if (I.consume(a)) this.setHeld(HELD_ORDER[i])
    })
    if (I.consume('cycle')) this.setHeld(nextHeld(this.pendingHeld ? { ...this.progress, held: this.pendingHeld } : this.progress))
    if (I.consume('journal')) this.openMenu('journal')
    if (I.consume('gadgetCycle')) {
      this.progress.gadget = nextGadget(this.progress)
      const g = this.progress.gadget
      this.audio.play('ui')
      this.hooks.popup(`${ITEMS[g].name} ×${this.progress.inv[g] ?? 0}`, this.player.pos.clone().setY(this.player.pos.y + 2.3), 'info')
    }
    // Buffer the gadget key briefly so pressing it during recovery or a hit reaction still fires.
    if (I.consume('gadget')) this.gadgetBuffer = 0.6
    if (this.gadgetBuffer > 0) {
      this.gadgetBuffer -= dt
      if (this.player.alive && this.player.state === 'move') {
        this.gadgetBuffer = 0
        this.useGadgetAction()
      }
    }
    if (this.pendingHeld && !this.player.busy && this.player.alive) this.setHeld(this.pendingHeld)
  }
  /** Swap what is in hand (weapon, hatchet, pick or bare fists). */
  setHeld(h: HeldId): boolean {
    if (this.mode !== 'playing') return false
    if (h === this.progress.held) {
      this.pendingHeld = null
      return true
    }
    if (!canHold(this.progress, h)) {
      this.audio.play('error')
      this.hooks.toast(`Craft a ${HELD_NAMES[h as Exclude<HeldId, 'weapon'>] ?? 'tool'} at camp first.`, 'warn')
      return false
    }
    if (this.player.busy) {
      // Mid-swing / roll: swap as soon as the hunter is free (never silently drop the key).
      this.pendingHeld = h
      return true
    }
    this.pendingHeld = null
    hold(this.progress, h)
    this.applyProgress(false)
    this.audio.play('uiOpen', 0.6)
    const P = this.player
    this.fx.sparks(P.pos.clone().setY(P.pos.y + 1.1), '#fff0c8', 6, 2.5)
    this.hooks.popup(h === 'weapon' ? GEAR[this.progress.weapon].name : HELD_NAMES[h], P.pos.clone().setY(P.pos.y + 2.3), 'info')
    return true
  }
  /** Active attack frames that found no creature: bite into the tree/boulder in front. */
  private harvestStrike(heavy: boolean, charge: number): boolean {
    const P = this.player
    const r = this.harvest.target(P.pos.x, P.pos.z, P.yaw, P.reach + 0.2, 0.95)
    if (!r) return false
    const held = this.progress.held
    const res = this.harvest.hit(r, held, heavy, charge, P.pos, P.pos.y + 1.1)
    if (!res) return false
    this.fx.hitstop(heavy ? 0.05 : 0.03)
    this.fx.shake(heavy ? 0.1 : 0.05)
    const names: Record<string, string> = { palm0: 'Palm', palm1: 'Palm', palm2: 'Palm', jungle0: 'Canopy Tree', jungle1: 'Canopy Tree', jungle2: 'Canopy Tree', acacia0: 'Thornwood', acacia1: 'Thornwood', deadtree: 'Deadwood', rockC: 'Boulder', rockH: 'Sandstone Boulder', rockK: 'Basalt Boulder' }
    const slow = res.power < 2
    this.harvestInfo = { label: names[r.def] ?? (r.kind === 'tree' ? 'Tree' : 'Boulder'), frac: res.frac, t: 0, slow, kind: r.kind }
    if (slow && !res.broke) {
      const best = r.kind === 'tree' ? 'flintHatchet' : 'flintPick'
      const have = canHold(this.progress, best)
      this.tip(`slow-${r.kind}`, have
        ? `Hold the <b>${HELD_NAMES[best]}</b> (press <b>${HELD_ORDER.indexOf(best) + 1}</b>) to ${r.kind === 'tree' ? 'fell trees' : 'break boulders'} far faster.`
        : `Anything you swing will ${r.kind === 'tree' ? 'chop' : 'crack'} it, but a <b>${HELD_NAMES[best]}</b> from the camp workbench is far faster.`)
    }
    return true
  }

  private pickLockTarget(): Creature | null {
    const P = this.player
    const fwdYaw = this.cam.yaw
    let best: Creature | null = null
    let bestScore = Infinity
    for (const c of this.creatures) {
      if (!c.alive) continue
      const dx = c.pos.x - P.pos.x
      const dz = c.pos.z - P.pos.z
      const d = Math.hypot(dx, dz)
      if (d > CONFIG.combat.lockRange + c.def.radius) continue
      const rel = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - fwdYaw), Math.cos(Math.atan2(dx, dz) - fwdYaw)))
      if (rel > 1.3) continue
      const score = d * (1 + rel * 1.5) - (c.engaged ? 6 : 0)
      if (score < bestScore) {
        bestScore = score
        best = c
      }
    }
    return best
  }

  private updateTargets(): void {
    const P = this.player
    if (this.lockTarget) {
      const c = this.lockTarget
      const d = Math.hypot(c.pos.x - P.pos.x, c.pos.z - P.pos.z)
      if (!c.alive || d > CONFIG.combat.lockRange + 10) this.lockTarget = null
    }
    // Soft target: nearest creature roughly in front (or the direction you are pushing).
    let best: Creature | null = null
    let bestD = Infinity
    const I = this.input
    const fy = Math.sin(this.cam.yaw)
    const fz = Math.cos(this.cam.yaw)
    const wx = fy * I.move.y - fz * I.move.x
    const wz = fz * I.move.y + fy * I.move.x
    const dirYaw = Math.hypot(wx, wz) > 0.2 ? Math.atan2(wx, wz) : P.yaw
    for (const c of this.creatures) {
      if (!c.alive) continue
      const dx = c.pos.x - P.pos.x
      const dz = c.pos.z - P.pos.z
      const edge = Math.hypot(dx, dz) - c.def.radius
      if (edge > 4.5) continue
      const rel = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - dirYaw), Math.cos(Math.atan2(dx, dz) - dirYaw)))
      if (rel > 1.9 && edge > 1) continue
      const score = edge + rel * 1.5
      if (score < bestD) {
        bestD = score
        best = c
      }
    }
    this.softTarget = best
    const t = this.lockTarget ?? (best && best.engaged ? best : null)
    if (t) {
      this.focusTarget = t
      this.focusT = Math.max(this.focusT, 3)
    }
  }

  private updateRegion(): void {
    const P = this.player
    const r = this.terrain.regionAt(P.pos.x, P.pos.z)
    this.region = r
    if (this.mode !== 'playing') return
    this.revealMapAround(P.pos.x, P.pos.z)
    if (r !== this.lastRegion) {
      // Stream the region we're in (and the next one out) ahead of everything else.
      // Current region first, then the next one along the expedition route.
      const next = r === 'coast' ? 'highlands' : 'caldera'
      assets.prioritise(next)
      assets.prioritise(r)
      const first = !this.progress.regions.includes(r)
      if (first) this.progress.regions.push(r)
      const subs: Record<RegionId, string> = {
        coast: 'Sunlit jungle shore · Tuskhogs & Mudsnappers',
        highlands: 'Amber savanna & sunken ruins · Dunestalkers',
        caldera: 'Ash, obsidian and lava · Ashfangs & Emberbeetles',
      }
      if (this.lastRegion !== null || first) this.hooks.banner(REGION_NAMES[r], first ? `Region discovered · ${subs[r]}` : subs[r], 'region')
      this.lastRegion = r
      if (first) this.save()
    }
  }

  /** Reveal a small hand-charted patch around the player; cells persist with this expedition. */
  private revealMapAround(x: number, z: number): void {
    const half = WORLD.half
    const cell = (half * 2) / MAP_GRID
    const gx = Math.floor((x + half) / cell)
    const gz = Math.floor((z + half) / cell)
    let changed = false
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const ix = gx + dx
        const iz = gz + dz
        if (ix < 0 || iz < 0 || ix >= MAP_GRID || iz >= MAP_GRID) continue
        const wx = -half + (ix + 0.5) * cell
        const wz = -half + (iz + 0.5) * cell
        if (this.terrain.heightAt(wx, wz) < WORLD.sea) continue
        const key = iz * MAP_GRID + ix
        if (!this.progress.explored.includes(key)) {
          this.progress.explored.push(key)
          changed = true
        }
      }
    }
    if (changed) this.progress.explored.sort((a, b) => a - b)
  }

  private updateInteract(): void {
    const P = this.player
    this.interact = null
    this.interactFn = null
    if (!P.alive) return
    // Carve
    let bestC: Creature | null = null
    let bd = Infinity
    for (const c of this.creatures) {
      if (!c.carvable) continue
      const d = Math.hypot(c.pos.x - P.pos.x, c.pos.z - P.pos.z) - c.def.radius
      if (d < 2.4 && d < bd) {
        bd = d
        bestC = c
      }
    }
    if (bestC) {
      const c = bestC
      this.interact = { label: c.def.name, verb: `Carve (${c.carvesLeft} left)`, enabled: true }
      this.interactFn = () => this.carve(c)
      return
    }
    const hd = Math.hypot(P.pos.x - CAMP.hearth.x, P.pos.z - CAMP.hearth.z)
    if (hd < HEARTH_R) {
      const stage = this.progress.campStage
      this.interact = { label: stage === 0 ? 'Cold Hearth' : 'Camp Hearth', verb: stage === 0 ? 'Rebuild camp' : 'Craft · Cook · Upgrade · Rest', enabled: true }
      this.interactFn = () => {
        if (stage >= 1) {
          P.restore()
          this.hooks.popup('Rested', P.pos.clone().setY(P.pos.y + 2.2), 'heal')
        }
        this.openMenu(stage === 0 ? 'camp' : 'craft')
      }
      if (!this.progress.tips.includes('camp')) this.tip('camp', 'The hearth is your base: <b>build camp stages</b>, <b>craft gear</b> and <b>rest</b> to refill health.')
      return
    }
    const td = Math.hypot(P.pos.x - CAMP.tower.x, P.pos.z - CAMP.tower.z)
    if (td < TOWER_R) {
      this.interact = { label: 'Signal Tower', verb: this.progress.towerRestored ? 'The beacon burns' : 'Inspect', enabled: !this.progress.towerRestored }
      this.interactFn = () => this.openMenu('camp')
      return
    }
    const n = this.nodes.nearest(P.pos.x, P.pos.z, 2.6)
    if (n) {
      const def = NODES[n.kind]
      const blocked = def.needsPick && !gearStats(this.progress).canMine
      this.interact = { label: def.name, verb: blocked ? 'Needs a Flint Pick' : def.verb, enabled: !blocked }
      this.interactFn = blocked ? () => this.hooks.toast('Craft a Flint Pick at the camp workbench to mine this.', 'warn') : () => this.gather(n)
      if (!this.progress.tips.includes('gather')) this.tip('gather', 'Glinting objects can be gathered. Press <b>E</b> to collect materials.')
      return
    }
    const t = this.tracks.nearest(P.pos.x, P.pos.z)
    if (t) {
      const def = SPECIES[t.sp]
      const kind = t.kind === 'print' ? 'tracks' : (t.ref as { kind: string }).kind === 'dung' ? 'dung' : (t.ref as { kind: string }).kind === 'scored' ? 'claw marks' : 'shed scales'
      const k = this.progress.journal[t.sp]?.clues ?? 0
      this.interact = { label: `${def.name} ${kind}`, verb: `Study (${Math.min(k, TRACKING.cluesNeeded)}/${TRACKING.cluesNeeded})`, enabled: true }
      this.interactFn = () => this.study(t)
      this.tip('study', 'Beasts leave <b>tracks and clues</b>. Study 3 to <b>track</b> the species and reveal where it is.')
    }
  }

  /** Journal sightings and the tracked beast's position. */
  private updateTracking(dt: number): void {
    const P = this.player.pos
    this.sightT -= dt
    if (this.sightT <= 0 && this.mode === 'playing') {
      this.sightT = 0.5
      for (const c of this.creatures) {
        if (!c.alive || Math.hypot(c.pos.x - P.x, c.pos.z - P.z) > TRACKING.sightRange) continue
        if (noteSeen(this.progress, c.def.id)) this.hooks.journal(c.def.id, `${c.def.name} sighted`)
      }
    }
    this.trackPos = null
    if (this.trackSp) {
      let best: Creature | null = null
      let bd = Infinity
      for (const c of this.creatures) {
        if (c.def.id !== this.trackSp || !c.alive) continue
        const d = (c.pos.x - P.x) ** 2 + (c.pos.z - P.z) ** 2
        if (d < bd) {
          bd = d
          best = c
        }
      }
      if (best) this.trackPos = best.pos.clone().setY(best.pos.y + best.def.height + 0.8)
    }
    this.tracks.update(dt, P, this.mode === 'playing' ? this.trackPos : null)
  }

  private gather(n: GNode): void {
    const P = this.player
    const face = Math.atan2(n.x - P.pos.x, n.z - P.pos.z)
    P.yaw = face
    const def = NODES[n.kind]
    P.startTask('gather', 0.75, () => {
      if (!n.active) return
      for (const [id, lo, hi] of def.yields) {
        const k = lo + Math.floor(Math.random() * (hi - lo + 1))
        this.give(id, k, new THREE.Vector3(n.x, n.y + 1.2, n.z))
      }
      if (def.bonus && Math.random() < def.bonus[1]) this.give(def.bonus[0], 1, new THREE.Vector3(n.x, n.y + 1.6, n.z))
      this.nodes.deplete(n)
      this.fx.dustPuff(n.x, n.y, n.z, 8, n.kind === 'amber' ? '#ffcf7a' : '#d8c6a0', 1)
      if (n.kind === 'amber' || n.kind === 'obsidian' || n.kind === 'sulfur') this.fx.sparks(new THREE.Vector3(n.x, n.y + 0.6, n.z), '#fff0c0', 8, 4)
      this.audio.play('pickup', 0.8)
    })
    const k = n.kind
    this.audio.play(k === 'herb' || k === 'fiber' ? 'gatherPlant' : k === 'bone' ? 'carve' : 'gatherRock', 0.9)
  }

  private carve(c: Creature): void {
    const P = this.player
    P.yaw = Math.atan2(c.pos.x - P.pos.x, c.pos.z - P.pos.z)
    c.carving = true
    this.carveTarget = c
    const ok = P.startTask('carve', 0.9, () => {
      c.carving = false
      this.carveTarget = null
      if (!c.carvable) return
      const loot: Partial<Record<ItemId, number>> = c.scavenged ? (Math.random() < 0.6 ? { meat: 1 } : { bone: 1 }) : carveLoot(c.def.id, c.carveIndex, Math.random())
      for (const [id, n] of Object.entries(loot) as [ItemId, number][]) {
        this.give(id, n, c.pos.clone().setY(c.pos.y + 1.5))
        if (notePart(this.progress, c.def.id, id)) this.hooks.journal(c.def.id, `${c.def.name}: ${ITEMS[id].name} added to drops`)
      }
      c.carved()
      this.audio.play('carve')
      this.fx.sparks(c.pos.clone().setY(c.pos.y + 0.8), '#ffe6c0', 8, 3)
      this.save()
    })
    if (!ok) {
      c.carving = false
      this.carveTarget = null
    }
  }

  private give(id: ItemId, n: number, at: THREE.Vector3): void {
    const got = add(this.progress, id, n)
    if (got > 0) {
      this.hooks.loot(id, got)
      this.hooks.popup(`+${got} ${ITEMS[id].name}`, at, 'loot')
      if (ITEMS[id].kind === 'key') this.hooks.banner(ITEMS[id].name, ITEMS[id].desc, 'camp')
    } else this.hooks.toast(`${ITEMS[id].name} is full`, 'warn')
  }

  // ─── Queries for the UI ───────────────────────────────────────────────────

  objective(): Objective {
    return objective(this.progress)
  }

  /** World position the objective marker points at. */
  objectivePos(): THREE.Vector3 | null {
    const o = this.objective()
    const t = o.target
    const P = this.player.pos
    if (t.type === 'none') return null
    if (t.type === 'camp') {
      if (o.id === 'tower') return new THREE.Vector3(CAMP.tower.x, this.terrain.heightAt(CAMP.tower.x, CAMP.tower.z) + 3, CAMP.tower.z)
      return new THREE.Vector3(CAMP.hearth.x, this.terrain.heightAt(CAMP.hearth.x, CAMP.hearth.z) + 1.5, CAMP.hearth.z)
    }
    if (t.type === 'node') {
      const n = this.nodes.nearestOfKind(t.kind, P.x, P.z)
      return n ? new THREE.Vector3(n.x, n.y + 1.6, n.z) : null
    }
    if (t.type === 'resource') {
      // Re-query at most twice a second (thousands of trees).
      if (this.resT > 0.5 || !this.resPos || this.resKind !== t.kind || !this.harvest.isLive(this.resId)) {
        this.resT = 0
        this.resKind = t.kind
        const r = this.harvest.nearest(t.kind, P.x, P.z)
        this.resId = r ? r.id : -1
        this.resPos = r ? new THREE.Vector3(r.x, r.y + Math.min(4, Math.max(1.8, r.height * 0.55)), r.z) : null
      }
      return this.resPos
    }
    return this.speciesPos(t.species)
  }

  speciesPos(s: SpeciesId): THREE.Vector3 | null {
    const P = this.player.pos
    let best: Creature | null = null
    let bd = Infinity
    for (const c of this.creatures) {
      if (c.def.id !== s || c.state === 'gone') continue
      const d = (c.pos.x - P.x) ** 2 + (c.pos.z - P.z) ** 2
      if (d < bd) {
        bd = d
        best = c
      }
    }
    if (best) return best.pos.clone().setY(best.pos.y + best.def.height + 0.8)
    const g = SPAWNS.find(x => x.species === s)
    if (s === 'ruinhorn') return new THREE.Vector3(ARENAS.ruins.x, this.terrain.heightAt(ARENAS.ruins.x, ARENAS.ruins.z) + 4, ARENAS.ruins.z)
    if (s === 'vulkarr') return new THREE.Vector3(ARENAS.wyrm.x, this.terrain.heightAt(ARENAS.wyrm.x, ARENAS.wyrm.z) + 4, ARENAS.wyrm.z)
    return g ? new THREE.Vector3(g.x, this.terrain.heightAt(g.x, g.z) + 2, g.z) : null
  }

  /** Project a world point to CSS pixels. `behind` when the point is behind the camera. */
  project(p: THREE.Vector3): { x: number; y: number; behind: boolean } {
    const v = this.v.copy(p).project(this.cam.camera)
    const w = innerWidth
    const h = innerHeight
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, behind: v.z > 1 }
  }

  get pixelScale(): number {
    return innerHeight * this.renderer.gl.getPixelRatio()
  }

  /** Cached top-down relief map of the island (for the map panel). */
  mapImage(): HTMLCanvasElement {
    if (this.mapCanvas) return this.mapCanvas
    const N = 240
    const c = document.createElement('canvas')
    c.width = c.height = N
    const g = c.getContext('2d')!
    const img = g.createImageData(N, N)
    const T = this.terrain
    const half = WORLD.half
    const col = new THREE.Color()
    for (let j = 0; j < N; j += 1) {
      for (let i = 0; i < N; i += 1) {
        const x = (i / (N - 1)) * 2 * half - half
        const z = (j / (N - 1)) * 2 * half - half
        const h = T.heightAt(x, z)
        const h2 = T.heightAt(x + 3, z - 3)
        const shade = THREE.MathUtils.clamp(1 + (h - h2) * 0.08, 0.7, 1.25)
        if (h < WORLD.sea) {
          col.set('#2f86c6').lerp(new THREE.Color('#123e6e'), THREE.MathUtils.clamp(-h / 14, 0, 1))
        } else if (T.isLava(x, z)) col.set('#ff6a1a')
        else {
          const r = T.regionAt(x, z)
          if (r === 'coast') col.set(h < 2.6 ? '#e8d6a0' : '#4f9a3a')
          else if (r === 'highlands') col.set('#c9a45a')
          else col.set(T.heatAt(x, z) > 0.2 ? '#4a3a36' : '#6d5d55')
          col.multiplyScalar(shade)
        }
        const k = (j * N + i) * 4
        img.data[k] = Math.min(255, col.r * 255)
        img.data[k + 1] = Math.min(255, col.g * 255)
        img.data[k + 2] = Math.min(255, col.b * 255)
        img.data[k + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)
    this.mapCanvas = c
    return c
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  render(frameSeconds: number): void {
    const dt = Math.min(0.1, frameSeconds)
    this.fx.reducedMotion = this.reducedMotion
    if (this.mode === 'title' || this.mode === 'loading') this.titleCamera(dt)
    else if (this.mode === 'victory' && this.cineT < 7) this.victoryCamera(dt)
    else {
      const look = this.mode === 'playing' ? this.input.takeLook() : (this.input.takeLook(), { x: 0, y: 0 })
      const lock = this.lockTarget ? this.lockTarget.center(new THREE.Vector3()) : null
      const big = this.lockTarget?.def.boss || this.boss ? 1 : 0
      if (this.mode === 'fainted') look.y = -dt * 0.2
      this.cam.update(dt, this.player.pos, look, lock, this.terrain, this.fx.shakeAmount, big, this.colliders)
    }
    this.fx.shakeAmount = Math.max(0, this.fx.shakeAmount - dt * 2.2)
    this.fx.update(dt, this.pixelScale)
    const focus = this.mode === 'title' ? new THREE.Vector3(CAMP.x, this.terrain.heightAt(CAMP.x, CAMP.z), CAMP.z) : this.player.pos
    this.scenery.update(dt, this.time, this.cam.camera, focus, this.pixelScale)
    const P = this.player.pos
    const nearSea = THREE.MathUtils.clamp(1 - (this.terrain.heightAt(P.x, P.z) - 1) / 8, 0, 1)
    const atCamp = THREE.MathUtils.clamp(1 - (Math.hypot(P.x - CAMP.x, P.z - CAMP.z) - 12) / 30, 0, 1)
    this.audio.setAmbience(this.scenery.weights, nearSea, this.mode === 'title' ? 0.6 : atCamp)
    this.frameAvg += (dt - this.frameAvg) * 0.05
    this.renderer.render(this.scene, this.cam.camera)
  }

  private titleCamera(dt: number): void {
    this.titleT += dt
    const t = this.titleT
    const cam = this.cam.camera
    const a = Math.sin(t * 0.04) * 0.45
    const cx = CAMP.x + Math.sin(a) * 70
    const cz = CAMP.z + 96 + Math.cos(a) * 8
    const ground = Math.max(this.terrain.heightAt(cx, cz), 0)
    cam.position.set(cx, ground + 38 + Math.sin(t * 0.07) * 3, cz)
    cam.lookAt(CAMP.x - 6 + Math.sin(a) * 20, this.terrain.heightAt(CAMP.x, CAMP.z) + 8, CAMP.z - 80)
  }

  private victoryCamera(_dt: number): void {
    const t = this.cineT
    const top = this.camp.towerTop
    const r = 26 + t * 1.5
    const a = 2.4 + t * 0.22
    const cam = this.cam.camera
    cam.position.set(top.x + Math.sin(a) * r, top.y - 4 + t * 1.2, top.z + Math.cos(a) * r)
    cam.lookAt(top.x, top.y - 3 + t * 0.8, top.z)
  }

  setQuality(q: SceneryQuality): void {
    if (q === this.quality) return
    this.quality = q
    this.renderer.applyQuality(q)
    this.scenery.setQuality(q)
  }
}
