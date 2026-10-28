/**
 * Pure expedition rules (no three.js, no DOM): inventory maths, crafting, camp upgrades,
 * the objective chain, gear stats, damage formulas and save parsing. Unit tested.
 */
import {
  CAMP_STAGES, FIST_ATTACK, GADGET_ORDER, GEAR, HELD_ORDER, ITEMS, ITEM_SOURCE, MEALS, MEAL_DURATION, RECIPES, SEAR_MULT, SPECIES, TOWER_COST,
  TRACKING, itemCap,
  type Cost, type GadgetId, type GearId, type HeldId, type ItemId, type MealBuff, type MealId, type NodeKind, type RecipeDef, type RecipeId,
  type ResourceKind, type SearQuality, type SpeciesId, type WeaponClass,
} from './data'
import type { RegionId } from './terrain'

export type Progress = {
  version: 1
  inv: Partial<Record<ItemId, number>>
  owned: GearId[]
  weapon: GearId
  armor: GearId
  /** What is in the hunter's hands: weapon, a tool, or bare fists. */
  held: HeldId
  campStage: 0 | 1 | 2 | 3
  towerRestored: boolean
  bosses: { ruinhorn: boolean; vulkarr: boolean }
  hunts: Partial<Record<SpeciesId, number>>
  faints: number
  crafted: number
  /** Trees felled and boulders broken. */
  harvested: number
  playTime: number
  /** Current food reserve, from 0 (starving) to 100 (well fed). */
  hunger: number
  regions: RegionId[]
  /** Discovered top-down map cells, persisted per expedition. */
  explored: number[]
  tips: string[]
  /** Active hearth meal (one at a time); `t` counts down in seconds. */
  meal: { id: MealId; t: number; max: number; q: SearQuality } | null
  /** Selected gadget for the G key. */
  gadget: GadgetId
  /** Hunter's journal knowledge per species. */
  journal: Partial<Record<SpeciesId, JournalEntry>>
}
export type JournalEntry = { seen: boolean; clues: number; tracked: boolean; weak: boolean; parts: ItemId[]; best: number }

export function newProgress(): Progress {
  return {
    version: 1,
    inv: { poultice: 3 },
    owned: ['club', 'leafWraps'],
    weapon: 'club',
    armor: 'leafWraps',
    held: 'weapon',
    campStage: 0,
    towerRestored: false,
    bosses: { ruinhorn: false, vulkarr: false },
    hunts: {},
    faints: 0,
    crafted: 0,
    harvested: 0,
    playTime: 0,
    hunger: 100,
    regions: [],
    explored: [],
    tips: [],
    meal: null,
    gadget: 'snare',
    journal: {},
  }
}

export const count = (p: Progress, id: ItemId): number => p.inv[id] ?? 0

export function add(p: Progress, id: ItemId, n: number): number {
  const cap = itemCap(id)
  const before = count(p, id)
  const after = Math.max(0, Math.min(cap, before + n))
  p.inv[id] = after
  return after - before
}

export function missing(p: Progress, cost: Cost): { id: ItemId; have: number; need: number }[] {
  return (Object.entries(cost) as [ItemId, number][])
    .map(([id, need]) => ({ id, have: count(p, id), need }))
    .filter(m => m.have < m.need)
}

export const affordable = (p: Progress, cost: Cost): boolean => missing(p, cost).length === 0

function spend(p: Progress, cost: Cost): void {
  for (const [id, n] of Object.entries(cost) as [ItemId, number][]) p.inv[id] = count(p, id) - n
}

export const owns = (p: Progress, g: GearId): boolean => p.owned.includes(g)

export type RecipeState = 'locked' | 'owned' | 'full' | 'missing' | 'ready'
export function recipeState(p: Progress, r: RecipeDef): RecipeState {
  if (p.campStage < r.stage) return 'locked'
  if (r.gear && owns(p, r.gear)) return 'owned'
  if (r.item && count(p, r.item) >= itemCap(r.item)) return 'full'
  return affordable(p, r.cost) ? 'ready' : 'missing'
}

export type ActionResult = { ok: true; message: string } | { ok: false; reason: string }

export function craft(p: Progress, id: RecipeId): ActionResult {
  const r = RECIPES.find(x => x.id === id)
  if (!r) return { ok: false, reason: 'Unknown recipe.' }
  const state = recipeState(p, r)
  if (state === 'locked') return { ok: false, reason: `Requires camp stage ${r.stage}.` }
  if (state === 'owned') return { ok: false, reason: 'Already crafted.' }
  if (state === 'full') return { ok: false, reason: 'Pouch is full.' }
  if (state === 'missing') return { ok: false, reason: 'Missing materials.' }
  spend(p, r.cost)
  p.crafted += 1
  if (r.gear) {
    p.owned.push(r.gear)
    const g = GEAR[r.gear]
    // Crafting better gear equips it immediately (weapons only within the club/maul line;
    // a new spear or sling is equipped from the satchel so a class change is always deliberate).
    if (g.slot === 'weapon' && isBlunt(g.id) && isBlunt(p.weapon) && GEAR[p.weapon].tier < g.tier) p.weapon = g.id
    if (g.slot === 'weapon' && !isBlunt(g.id)) return { ok: true, message: `Crafted ${g.name}. Equip it in the Satchel` }
    if (g.slot === 'armor' && GEAR[p.armor].tier < g.tier) p.armor = g.id
    return { ok: true, message: `Crafted ${g.name}` }
  }
  add(p, r.item!, r.count ?? 1)
  return { ok: true, message: `Crafted ${ITEMS[r.item!].name}` }
}

export const weaponClass = (id: GearId): WeaponClass => GEAR[id].cls ?? 'club'
const isBlunt = (id: GearId) => weaponClass(id) === 'club' || weaponClass(id) === 'maul'

export function equip(p: Progress, id: GearId): boolean {
  if (!owns(p, id)) return false
  const slot = GEAR[id].slot
  if (slot === 'weapon') p.weapon = id
  else if (slot === 'armor') p.armor = id
  else return false
  return true
}

export const nextCampStage = (p: Progress) => CAMP_STAGES.find(s => s.stage === p.campStage + 1)

export function upgradeCamp(p: Progress): ActionResult {
  const next = nextCampStage(p)
  if (!next) return { ok: false, reason: 'The camp is fully built.' }
  if (!affordable(p, next.cost)) return { ok: false, reason: 'Missing materials.' }
  spend(p, next.cost)
  p.campStage = next.stage
  return { ok: true, message: `${next.name} built` }
}

export function towerState(p: Progress): 'locked' | 'missing' | 'ready' | 'done' {
  if (p.towerRestored) return 'done'
  if (p.campStage < 3) return 'locked'
  return affordable(p, TOWER_COST) ? 'ready' : 'missing'
}

export function restoreTower(p: Progress): ActionResult {
  const s = towerState(p)
  if (s === 'done') return { ok: false, reason: 'The beacon already burns.' }
  if (s === 'locked') return { ok: false, reason: 'Build the Stonehold camp first.' }
  if (s === 'missing') return { ok: false, reason: 'Missing materials.' }
  spend(p, TOWER_COST)
  p.towerRestored = true
  return { ok: true, message: 'The signal tower blazes!' }
}

/** Weapon and bare hands are always available; tools need to be crafted. */
export function canHold(p: Pick<Progress, 'owned'>, h: HeldId): boolean {
  if (!HELD_ORDER.includes(h)) return false
  return h === 'weapon' || h === 'hands' || p.owned.includes(h)
}
export function hold(p: Progress, h: HeldId): boolean {
  if (!canHold(p, h)) return false
  p.held = h
  return true
}
/** Next holdable item after the current one (for a cycle key / d-pad). */
export function nextHeld(p: Progress, dir = 1): HeldId {
  const n = HELD_ORDER.length
  let i = HELD_ORDER.indexOf(p.held)
  for (let k = 0; k < n; k += 1) {
    i = (i + dir + n) % n
    if (canHold(p, HELD_ORDER[i])) return HELD_ORDER[i]
  }
  return 'weapon'
}
/** Attack stat of what is currently in hand. */
export function heldAttack(p: Progress): number {
  if (p.held === 'hands') return FIST_ATTACK
  if (p.held === 'weapon') return GEAR[p.weapon].attack ?? 10
  return GEAR[p.held].attack ?? 8
}
export type GearStats = {
  attack: number; defense: number; maxHp: number; heatProof: boolean; carves: number; canMine: boolean
  /** Moveset of what is in hand ('club' for tools and fists). */
  cls: WeaponClass
  maxStamina: number; staRegen: number; dodgeCost: number; heatRate: number
}
export function gearStats(p: Progress): GearStats {
  const w = GEAR[p.weapon]
  const a = GEAR[p.armor]
  const b = mealBuff(p)
  const base = p.held && p.held !== 'weapon' ? heldAttack(p) : w.attack ?? 10
  return {
    attack: Math.round(base * (1 + (b.attack ?? 0))),
    defense: (a.defense ?? 0) + (b.defense ?? 0),
    maxHp: 100 + (a.hp ?? 0) + (b.hp ?? 0),
    heatProof: !!a.heatProof,
    carves: owns(p, 'boneKnife') ? 1 : 0,
    canMine: owns(p, 'flintPick'),
    cls: !p.held || p.held === 'weapon' ? weaponClass(p.weapon) : 'club',
    maxStamina: 100 + (b.stamina ?? 0),
    staRegen: 1 + (b.staRegen ?? 0),
    dodgeCost: 1 - (b.dodgeCost ?? 0),
    heatRate: 1 - (b.heatSlow ?? 0),
  }
}

// ─── Hearth cooking ────────────────────────────────────────────────────────

export type CookState = 'locked' | 'missing' | 'ready'
export function cookState(p: Progress, id: MealId): CookState {
  const m = MEALS[id]
  if (p.campStage < m.stage) return 'locked'
  return affordable(p, m.cost) ? 'ready' : 'missing'
}
/** Spend the ingredients and eat the meal at once; sear quality scales its duration. */
export function cook(p: Progress, id: MealId, q: SearQuality): ActionResult {
  const st = cookState(p, id)
  if (st === 'locked') return { ok: false, reason: `Requires camp stage ${MEALS[id].stage}.` }
  if (st === 'missing') return { ok: false, reason: 'Missing ingredients.' }
  spend(p, MEALS[id].cost)
  const t = Math.round(MEAL_DURATION * SEAR_MULT[q])
  p.meal = { id, t, max: t, q }
  return { ok: true, message: `${q === 'perfect' ? 'Perfect ' : q === 'charred' ? 'Charred ' : ''}${MEALS[id].name}: ${MEALS[id].desc}` }
}
/** Count the meal down. Returns true on the frame it runs out. */
export function tickMeal(p: Progress, dt: number): boolean {
  if (!p.meal) return false
  p.meal.t -= dt
  if (p.meal.t > 0) return false
  p.meal = null
  return true
}
export const mealBuff = (p: Pick<Progress, 'meal'>): MealBuff => (p.meal ? MEALS[p.meal.id].buff : {})

// ─── Gadgets ───────────────────────────────────────────────────────────────

export function nextGadget(p: Progress, dir = 1): GadgetId {
  const n = GADGET_ORDER.length
  const i = GADGET_ORDER.indexOf(p.gadget)
  // Prefer gadgets you carry; fall back to plain cycling when the pouch is empty.
  for (let k = 1; k <= n; k += 1) {
    const g = GADGET_ORDER[(i + dir * k + n * 4) % n]
    if (count(p, g) > 0) return g
  }
  return GADGET_ORDER[(i + dir + n) % n]
}
/** Consume one of the selected gadget. */
export function useGadget(p: Progress, g: GadgetId = p.gadget): boolean {
  if (count(p, g) <= 0) return false
  p.inv[g] = count(p, g) - 1
  return true
}

// ─── Hunter's journal ──────────────────────────────────────────────────────

export function journalEntry(p: Progress, sp: SpeciesId): JournalEntry {
  let e = p.journal[sp]
  if (!e) {
    e = { seen: false, clues: 0, tracked: false, weak: false, parts: [], best: 0 }
    p.journal[sp] = e
  }
  return e
}
export function noteSeen(p: Progress, sp: SpeciesId): boolean {
  const e = journalEntry(p, sp)
  if (e.seen) return false
  e.seen = true
  return true
}
/** Study a clue. Returns whether this clue made the species Tracked. */
export function addClue(p: Progress, sp: SpeciesId): { clues: number; tracked: boolean } {
  const e = journalEntry(p, sp)
  e.seen = true
  const before = e.clues
  e.clues = Math.min(TRACKING.cluesNeeded, e.clues + 1)
  const becomes = before < TRACKING.cluesNeeded && e.clues >= TRACKING.cluesNeeded
  if (becomes) e.tracked = true
  return { clues: e.clues, tracked: becomes }
}
/** Tracking is spent when that beast is hunted, so the next hunt starts a fresh trail. */
export function clearTrack(p: Progress, sp: SpeciesId): void {
  const e = journalEntry(p, sp)
  e.clues = 0
}
export const isTracked = (p: Progress, sp: SpeciesId): boolean => (p.journal[sp]?.clues ?? 0) >= TRACKING.cluesNeeded
export function noteWeak(p: Progress, sp: SpeciesId): boolean {
  const e = journalEntry(p, sp)
  if (e.weak) return false
  e.weak = true
  return true
}
export function notePart(p: Progress, sp: SpeciesId, item: ItemId): boolean {
  const e = journalEntry(p, sp)
  if (e.parts.includes(item)) return false
  e.parts.push(item)
  return true
}
export function noteHunt(p: Progress, sp: SpeciesId, seconds: number): void {
  const e = journalEntry(p, sp)
  e.seen = true
  e.weak = true
  if (seconds > 0 && (e.best === 0 || seconds < e.best)) e.best = Math.round(seconds)
}
export type Knowledge = { seen: boolean; tracked: boolean; weak: boolean; hunted: boolean; exact: boolean; parts: ItemId[]; hunts: number; best: number; clues: number }
export function knowledge(p: Progress, sp: SpeciesId): Knowledge {
  const e = p.journal[sp]
  const hunts = p.hunts[sp] ?? 0
  return {
    seen: !!e?.seen || hunts > 0, tracked: !!e?.tracked, weak: !!e?.weak || hunts > 0, hunted: hunts >= 1, exact: hunts >= 3,
    parts: e?.parts ?? [], hunts, best: e?.best ?? 0, clues: e?.clues ?? 0,
  }
}

/** Outgoing damage. Punishing an open (recovering/staggered) monster is rewarded. */
export function hitDamage(attack: number, motion: number, punish: boolean): number {
  return Math.max(1, Math.round(attack * motion * (punish ? 1.3 : 1)))
}

/** Incoming damage after armour. */
export function takenDamage(base: number, defense: number): number {
  return Math.max(1, Math.round(base * (1 - Math.min(0.7, defense))))
}

// ─── Objectives ─────────────────────────────────────────────────────────────

export type ObjectiveTarget =
  | { type: 'camp' }
  | { type: 'node'; kind: NodeKind }
  | { type: 'resource'; kind: ResourceKind }
  | { type: 'species'; species: SpeciesId }
  | { type: 'none' }

export type Objective = { id: string; title: string; detail: string; step: number; total: number; target: ObjectiveTarget; ready: boolean }

type Step = { id: string; title: string; done: (p: Progress) => boolean; cost?: (p: Progress) => Cost; target?: ObjectiveTarget; hint: string }

const recipe = (id: RecipeId) => RECIPES.find(r => r.id === id)!
// Progression follows the club/maul line; spears and slings are side-grades.
const weaponTier = (p: Progress) => Math.max(...p.owned.map(g => (GEAR[g].slot === 'weapon' && isBlunt(g) ? GEAR[g].tier : 0)))
const armorTier = (p: Progress) => Math.max(...p.owned.map(g => (GEAR[g].slot === 'armor' ? GEAR[g].tier : 0)))

const STEPS: Step[] = [
  { id: 'hearth', title: 'Rebuild the Hearth', done: p => p.campStage >= 1, cost: () => CAMP_STAGES[0].cost, hint: 'Chop trees for wood and break boulders for stone (any swing works), cut reed fiber, then build at the camp.' },
  { id: 'hatchet', title: 'Craft a Flint Hatchet', done: p => owns(p, 'flintHatchet'), cost: () => recipe('flintHatchet').cost, hint: 'Boulders sometimes hide flint. A hatchet fells trees in a couple of swings.' },
  { id: 'maul', title: 'Craft a Flint Maul', done: p => weaponTier(p) >= 1, cost: () => recipe('flintMaul').cost, hint: 'Hunt Tuskhogs for tusks and break boulders for flint.' },
  { id: 'garb', title: 'Craft Bristlehide Garb', done: p => armorTier(p) >= 1, cost: () => recipe('hideGarb').cost, hint: 'Tuskhog hide and Mudsnapper scales from the shore.' },
  { id: 'palisade', title: 'Raise the Palisade', done: p => p.campStage >= 2, cost: () => CAMP_STAGES[1].cost, hint: 'Upgrade the camp to stage II.' },
  { id: 'pick', title: 'Craft a Flint Pick', done: p => owns(p, 'flintPick'), cost: () => recipe('flintPick').cost, hint: 'A pick opens Amberite veins in the highlands.' },
  { id: 'hammer', title: 'Forge the Amber Tusk Hammer', done: p => weaponTier(p) >= 2, cost: () => recipe('amberHammer').cost, hint: 'Climb to the Amberback Highlands: amber veins and Dunestalker claws.' },
  { id: 'ruinhorn', title: 'Hunt the Ruinhorn', done: p => p.bosses.ruinhorn, target: { type: 'species', species: 'ruinhorn' }, hint: 'It rules the Sunken Ruins east of the highland ramp. Carve its crest.' },
  { id: 'stonehold', title: 'Build the Stonehold', done: p => p.campStage >= 3, cost: () => CAMP_STAGES[2].cost, hint: 'Upgrade the camp to stage III.' },
  { id: 'mantle', title: 'Craft the Ashguard Mantle', done: p => armorTier(p) >= 3, cost: () => recipe('ashguardMantle').cost, hint: 'Ashfang pelts from the caldera foothills. The mantle blocks the heat.' },
  { id: 'greatclub', title: 'Forge the Obsidian Greatclub', done: p => weaponTier(p) >= 3, cost: () => recipe('obsidianClub').cost, hint: 'Obsidian and Emberbeetle carapace lie inside the heat zone.' },
  { id: 'vulkarr', title: 'Hunt Vulkarr', done: p => p.bosses.vulkarr, target: { type: 'species', species: 'vulkarr' }, hint: 'Enter the crater through the Breach canyon. Carve its Magma Heart.' },
  { id: 'tower', title: 'Restore the Signal Tower', done: p => p.towerRestored, cost: () => TOWER_COST, hint: 'Bring the Crest, the Heart, obsidian, sulfur and wood to camp.' },
]

export function objective(p: Progress): Objective {
  let lastDone = -1
  for (let i = STEPS.length - 1; i >= 0; i -= 1) {
    if (STEPS[i].done(p)) {
      lastDone = i
      break
    }
  }
  const idx = lastDone + 1
  if (idx >= STEPS.length) return { id: 'victory', title: 'The beacon burns', detail: 'Rescue is on its way.', step: STEPS.length, total: STEPS.length, target: { type: 'none' }, ready: false }
  const s = STEPS[idx]
  let detail = s.hint
  let target: ObjectiveTarget = s.target ?? { type: 'camp' }
  let ready = false
  if (s.cost) {
    const cost = s.cost(p)
    const lacking = missing(p, cost)
    detail = (Object.entries(cost) as [ItemId, number][]).map(([id, need]) => `${ITEMS[id].name} ${Math.min(count(p, id), need)}/${need}`).join(' · ')
    if (lacking.length) {
      const src = ITEM_SOURCE[lacking[0].id]
      target = src?.resource ? { type: 'resource', kind: src.resource } : src?.node ? { type: 'node', kind: src.node } : src?.species ? { type: 'species', species: src.species } : { type: 'camp' }
    } else {
      target = { type: 'camp' }
      ready = true
    }
  }
  return { id: s.id, title: s.title, detail, step: idx + 1, total: STEPS.length, target, ready }
}

export const OBJECTIVE_HINTS: Record<string, string> = Object.fromEntries(STEPS.map(s => [s.id, s.hint]))
export const OBJECTIVE_IDS = STEPS.map(s => s.id)

// ─── Carving ───────────────────────────────────────────────────────────────

/** Loot for a carve. Bosses use their fixed tables; small creatures roll weighted drops. */
export function carveLoot(species: SpeciesId, carveIndex: number, roll: number): Partial<Record<ItemId, number>> {
  const def = SPECIES[species]
  if (def.bossCarves) return { ...(def.bossCarves[Math.min(carveIndex, def.bossCarves.length - 1)] ?? {}) }
  // Guarantee the signature part on the first carve so progression never stalls on bad luck.
  if (carveIndex === 0) return { [def.drops[0].item]: 1 }
  const total = def.drops.reduce((s, d) => s + d.weight, 0)
  let r = roll * total
  for (const d of def.drops) {
    r -= d.weight
    if (r <= 0) return { [d.item]: 1 }
  }
  return { [def.drops[0].item]: 1 }
}

// ─── Save parsing ─────────────────────────────────────────────────────────

export const PROGRESS_KEY = 'cavwild.expedition'

export function parseProgress(raw: string | null): Progress | null {
  if (!raw) return null
  let d: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    d = parsed
  } catch {
    return null
  }
  if (d.version !== 1) return null
  const base = newProgress()
  const inv: Progress['inv'] = {}
  if (d.inv && typeof d.inv === 'object') {
    for (const [k, v] of Object.entries(d.inv as Record<string, unknown>)) {
      if (k in ITEMS && typeof v === 'number' && Number.isFinite(v)) inv[k as ItemId] = Math.max(0, Math.min(itemCap(k as ItemId), Math.floor(v)))
    }
  }
  const owned = Array.isArray(d.owned) ? (d.owned.filter(g => typeof g === 'string' && g in GEAR) as GearId[]) : [...base.owned]
  for (const g of base.owned) if (!owned.includes(g)) owned.push(g)
  const pickOwned = (v: unknown, slot: 'weapon' | 'armor', fallback: GearId): GearId =>
    typeof v === 'string' && owned.includes(v as GearId) && GEAR[v as GearId].slot === slot ? (v as GearId) : fallback
  const stage = typeof d.campStage === 'number' && [0, 1, 2, 3].includes(d.campStage) ? (d.campStage as Progress['campStage']) : 0
  const b = (d.bosses ?? {}) as Record<string, unknown>
  const hunts: Progress['hunts'] = {}
  if (d.hunts && typeof d.hunts === 'object') {
    for (const [k, v] of Object.entries(d.hunts as Record<string, unknown>)) if (k in SPECIES && typeof v === 'number') hunts[k as SpeciesId] = Math.max(0, Math.floor(v))
  }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
  const hunger = typeof d.hunger === 'number' && Number.isFinite(d.hunger) ? Math.max(0, Math.min(100, d.hunger)) : base.hunger
  const explored = Array.isArray(d.explored)
    ? d.explored.filter(v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1024).map(v => v as number).slice(0, 1024)
    : base.explored
  return {
    version: 1,
    inv,
    owned: [...new Set(owned)],
    weapon: pickOwned(d.weapon, 'weapon', 'club'),
    armor: pickOwned(d.armor, 'armor', 'leafWraps'),
    held: typeof d.held === 'string' && canHold({ owned } as Progress, d.held as HeldId) ? (d.held as HeldId) : 'weapon',
    campStage: stage,
    towerRestored: d.towerRestored === true && stage === 3,
    bosses: { ruinhorn: b.ruinhorn === true, vulkarr: b.vulkarr === true },
    hunts,
    faints: Math.floor(num(d.faints)),
    crafted: Math.floor(num(d.crafted)),
    harvested: Math.floor(num(d.harvested)),
    playTime: num(d.playTime),
    hunger,
    regions: Array.isArray(d.regions) ? (d.regions.filter(r => r === 'coast' || r === 'highlands' || r === 'caldera') as RegionId[]) : [],
    explored: [...new Set(explored)],
    tips: Array.isArray(d.tips) ? d.tips.filter((t): t is string => typeof t === 'string').slice(0, 64) : [],
    meal: parseMeal(d.meal),
    gadget: typeof d.gadget === 'string' && (GADGET_ORDER as string[]).includes(d.gadget) ? (d.gadget as GadgetId) : 'snare',
    journal: parseJournal(d.journal),
  }
}

function parseMeal(v: unknown): Progress['meal'] {
  if (!v || typeof v !== 'object') return null
  const m = v as Record<string, unknown>
  if (typeof m.id !== 'string' || !(m.id in MEALS)) return null
  const t = typeof m.t === 'number' && Number.isFinite(m.t) ? m.t : 0
  const max = typeof m.max === 'number' && Number.isFinite(m.max) ? m.max : t
  if (t <= 0) return null
  const q = m.q === 'perfect' || m.q === 'charred' ? m.q : 'good'
  return { id: m.id as MealId, t: Math.min(t, MEAL_DURATION * 2), max: Math.max(t, Math.min(max, MEAL_DURATION * 2)), q }
}

function parseJournal(v: unknown): Progress['journal'] {
  const out: Progress['journal'] = {}
  if (!v || typeof v !== 'object') return out
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!(k in SPECIES) || !raw || typeof raw !== 'object') continue
    const e = raw as Record<string, unknown>
    const clues = typeof e.clues === 'number' && Number.isFinite(e.clues) ? Math.max(0, Math.min(TRACKING.cluesNeeded, Math.floor(e.clues))) : 0
    out[k as SpeciesId] = {
      seen: e.seen === true, clues, tracked: e.tracked === true, weak: e.weak === true,
      parts: Array.isArray(e.parts) ? [...new Set(e.parts.filter((x): x is ItemId => typeof x === 'string' && x in ITEMS))] : [],
      best: typeof e.best === 'number' && Number.isFinite(e.best) && e.best > 0 ? Math.round(e.best) : 0,
    }
  }
  return out
}
