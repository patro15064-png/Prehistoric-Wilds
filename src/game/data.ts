/**
 * All authored game content as plain data: materials, gear, recipes, camp stages, creature
 * species (stats, telegraphed attacks, drops) and where things live on the island.
 * Gameplay code, the UI and the /enemies lab all read these same tables.
 */
import type { RegionId } from './terrain'

export type IconId =
  | 'log' | 'rock' | 'reed' | 'flint' | 'bone' | 'herb' | 'crystal' | 'shard' | 'sulfur'
  | 'tusk' | 'hide' | 'scale' | 'claw' | 'shell' | 'pelt' | 'plate' | 'horn' | 'crest' | 'heart' | 'potion'
  | 'meat' | 'mushroom' | 'snare' | 'pit' | 'pod'

export type ItemId =
  | 'wood' | 'stone' | 'fiber' | 'flint' | 'bone' | 'herb' | 'amber' | 'obsidian' | 'sulfur'
  | 'hogTusk' | 'roughHide' | 'snapperScale' | 'stalkerClaw' | 'stalkerHide' | 'emberCarapace' | 'ashfangPelt'
  | 'ruinPlate' | 'hornShard' | 'ruinCrest' | 'scorchScale' | 'magmaHeart' | 'poultice'
  | 'meat' | 'glowcap' | 'snare' | 'pitfall' | 'flashPod'

export type ItemKind = 'material' | 'part' | 'key' | 'consumable' | 'gadget'
export type ItemDef = { id: ItemId; name: string; desc: string; kind: ItemKind; icon: IconId; color: string }

const item = (id: ItemId, name: string, kind: ItemKind, icon: IconId, color: string, desc: string): ItemDef => ({ id, name, kind, icon, color, desc })

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: item('wood', 'Wood', 'material', 'log', '#b07a47', 'Sturdy branches and driftwood.'),
  stone: item('stone', 'Stone', 'material', 'rock', '#a8a29a', 'Fist-sized rock for building.'),
  fiber: item('fiber', 'Reed Fiber', 'material', 'reed', '#b9d36a', 'Tough reedgrass for lashing and wraps.'),
  flint: item('flint', 'Flint', 'material', 'flint', '#6d7f96', 'Sharp-edged stone found inside rocks.'),
  bone: item('bone', 'Bone', 'material', 'bone', '#f1e6cc', 'Weathered bones of old beasts.'),
  herb: item('herb', 'Mendleaf', 'material', 'herb', '#e0607a', 'A rosy leaf that closes wounds.'),
  amber: item('amber', 'Amberite', 'material', 'crystal', '#ffb23e', 'Glowing resin crystal of the highlands. Needs a pick.'),
  obsidian: item('obsidian', 'Obsidian', 'material', 'shard', '#5b4b8a', 'Volcanic glass, razor sharp. Needs a pick.'),
  sulfur: item('sulfur', 'Sulfur Crust', 'material', 'sulfur', '#f2e04a', 'Brimstone crystals that burn bright.'),
  hogTusk: item('hogTusk', 'Hog Tusk', 'part', 'tusk', '#f4ead2', 'Curved tusk carved from a Tuskhog.'),
  roughHide: item('roughHide', 'Bristle Hide', 'part', 'hide', '#9a6440', 'Bristly Tuskhog hide.'),
  snapperScale: item('snapperScale', 'Snapper Scale', 'part', 'scale', '#5fae8d', 'Slick scale from a Mudsnapper.'),
  stalkerClaw: item('stalkerClaw', 'Stalker Claw', 'part', 'claw', '#e8d7b0', 'Hooked claw of a Dunestalker.'),
  stalkerHide: item('stalkerHide', 'Striped Hide', 'part', 'hide', '#d99a4a', 'Tough striped Dunestalker hide.'),
  emberCarapace: item('emberCarapace', 'Ember Carapace', 'part', 'shell', '#c2461f', 'Heat-forged Emberbeetle shell.'),
  ashfangPelt: item('ashfangPelt', 'Ashfang Pelt', 'part', 'pelt', '#6b5a58', 'Fire-resistant cinder fur.'),
  ruinPlate: item('ruinPlate', 'Ruinhorn Plate', 'part', 'plate', '#8f8a7a', 'A slab of the Ruinhorn\u2019s stony hide.'),
  hornShard: item('hornShard', 'Horn Shard', 'part', 'horn', '#d7c9a0', 'A splinter of the great horn.'),
  ruinCrest: item('ruinCrest', 'Ruinhorn Crest', 'key', 'crest', '#e9c46a', 'The tyrant\u2019s crest. Needed to raise the signal tower.'),
  scorchScale: item('scorchScale', 'Scorch Scale', 'part', 'scale', '#ff6a2a', 'Still-warm scale of Vulkarr.'),
  magmaHeart: item('magmaHeart', 'Magma Heart', 'key', 'heart', '#ff4b12', 'Vulkarr\u2019s burning heart. It will light the beacon.'),
  poultice: item('poultice', 'Mendleaf Poultice', 'consumable', 'potion', '#ff7d95', 'Restores health. Press R to apply.'),
  meat: item('meat', 'Raw Haunch', 'material', 'meat', '#d0645a', 'Fresh meat carved from a beast. Cook it at the hearth.'),
  glowcap: item('glowcap', 'Glowcap', 'material', 'mushroom', '#62d6ff', 'A luminous mushroom. Its spores burst into blinding light.'),
  snare: item('snare', 'Vine Snare', 'gadget', 'snare', '#8fbf4a', 'Lay it with G. Holds a beast for 4 s; trips a charging one.'),
  pitfall: item('pitfall', 'Pitfall', 'gadget', 'pit', '#9a7a4e', 'Dig it with G. A beast that steps in is stuck for 5 s.'),
  flashPod: item('flashPod', 'Flash Pod', 'gadget', 'pod', '#fff3a0', 'Throw it with G. Blinds beasts facing it and interrupts windups.'),
}

export const STACK_MAX = 99
export const POULTICE_MAX = 5

// ─── Gadgets (traps and throwables) ────────────────────────────────────────

export type GadgetId = 'snare' | 'pitfall' | 'flashPod'
export const GADGET_ORDER: GadgetId[] = ['snare', 'pitfall', 'flashPod']
/** Carry limit per gadget. */
export const GADGET_MAX: Record<GadgetId, number> = { snare: 3, pitfall: 2, flashPod: 5 }
export const GADGET_TUNING = {
  snareArm: 0.6, snareHold: 4, snareHoldBoss: 2.5, tripTime: 3.5, tripBonus: 1.3, snareRadius: 1.5,
  pitDig: 1.2, pitHold: 5, pitHoldBoss: 3.5, pitRadius: 1.9,
  flashRange: 14, flashRadius: 7, blindTime: 3.5, flashFuse: 0.7,
  bossResist: 30, campNoTrap: 26, trapLife: 120,
}
/** Stack cap for any item. */
export function itemCap(id: ItemId): number {
  if (id === 'poultice') return POULTICE_MAX
  if (id in GADGET_MAX) return GADGET_MAX[id as GadgetId]
  return 99
}

// ─── Hearth meals ─────────────────────────────────────────────────────────

export type MealId = 'heartyHaunch' | 'trailStew' | 'snapperBroth' | 'brimstoneSkewer'
export type MealBuff = { hp?: number; stamina?: number; staRegen?: number; dodgeCost?: number; defense?: number; attack?: number; heatSlow?: number }
export type MealDef = { id: MealId; name: string; stage: 1 | 2; cost: Partial<Record<ItemId, number>>; buff: MealBuff; desc: string }
export const MEALS: Record<MealId, MealDef> = {
  heartyHaunch: { id: 'heartyHaunch', name: 'Hearty Haunch', stage: 1, cost: { meat: 2 }, buff: { hp: 25 }, desc: '+25 max health' },
  trailStew: { id: 'trailStew', name: 'Trail Stew', stage: 1, cost: { meat: 1, herb: 2 }, buff: { stamina: 30, staRegen: 0.2 }, desc: '+30 max stamina, +20% stamina regen' },
  snapperBroth: { id: 'snapperBroth', name: 'Snapper Broth', stage: 1, cost: { meat: 1, snapperScale: 1, herb: 1 }, buff: { dodgeCost: 0.25, defense: 0.08 }, desc: 'Dodges cost 25% less stamina, +8% defence' },
  brimstoneSkewer: { id: 'brimstoneSkewer', name: 'Brimstone Skewer', stage: 2, cost: { meat: 1, sulfur: 1 }, buff: { attack: 0.12, heatSlow: 0.6 }, desc: '+12% attack, caldera heat drains 60% slower' },
}
export const MEAL_ORDER: MealId[] = ['heartyHaunch', 'trailStew', 'snapperBroth', 'brimstoneSkewer']
export type SearQuality = 'perfect' | 'good' | 'charred'
export const MEAL_DURATION = 300
export const SEAR_MULT: Record<SearQuality, number> = { perfect: 1.5, good: 1, charred: 0.6 }
/** Sear gauge zones as fractions of the sweep (gold inside green). */
export const SEAR_ZONES = { good: [0.52, 0.8] as [number, number], perfect: [0.62, 0.7] as [number, number] }

// ─── Gear ──────────────────────────────────────────────────────────────────

export type GearId =
  | 'club' | 'flintMaul' | 'amberHammer' | 'obsidianClub'
  | 'leafWraps' | 'hideGarb' | 'stalkerPlate' | 'ashguardMantle'
  | 'boneKnife' | 'flintPick' | 'flintHatchet'
  | 'boneSpear' | 'stalkerLance' | 'reedSling' | 'sinewSling'
export type GearSlot = 'weapon' | 'armor' | 'tool'
export type WeaponClass = 'club' | 'maul' | 'spear' | 'sling'
export type GearDef = {
  id: GearId; name: string; slot: GearSlot; tier: number; desc: string
  attack?: number; defense?: number; hp?: number; heatProof?: boolean
  cls?: WeaponClass
}
/** Moveset tuning per weapon class. */
export type ClassDef = { name: string; speed: number; motion: number; reach: number; arc: number; desc: string }
export const WEAPON_CLASSES: Record<WeaponClass, ClassDef> = {
  club: { name: 'Club', speed: 1.15, motion: 1, reach: 0, arc: 1, desc: 'Fast all-rounder: quick 3-hit combo and a charged smash.' },
  maul: { name: 'Maul', speed: 0.85, motion: 1.3, reach: 0.2, arc: 1.1, desc: 'Slow and brutal. A full charge always breaks poise.' },
  spear: { name: 'Spear', speed: 1, motion: 0.95, reach: 1.6, arc: 0.45, desc: 'Long narrow thrusts and a lunge. Attack right after a perfect dodge to counter-thrust.' },
  sling: { name: 'Sling', speed: 1, motion: 0.8, reach: 0, arc: 1, desc: 'Ranged stone shots (1 Stone each). Hold heavy to whirl a charged shot.' },
}
export const SPEAR_LUNGE = 3
export const COUNTER_WINDOW = 0.5
export const COUNTER_MULT = 2.2
export const SLING_RANGE = 18

export const GEAR: Record<GearId, GearDef> = {
  club: { id: 'club', name: 'Knotted Club', slot: 'weapon', tier: 0, attack: 12, cls: 'club', desc: 'A trusty knot of hardwood.' },
  flintMaul: { id: 'flintMaul', name: 'Flint Maul', slot: 'weapon', tier: 1, attack: 19, cls: 'maul', desc: 'Flint head lashed to a heavy haft.' },
  amberHammer: { id: 'amberHammer', name: 'Amber Tusk Hammer', slot: 'weapon', tier: 2, attack: 29, cls: 'maul', desc: 'Glowing amber set between tusks.' },
  obsidianClub: { id: 'obsidianClub', name: 'Obsidian Greatclub', slot: 'weapon', tier: 3, attack: 44, cls: 'club', desc: 'Volcanic glass spikes on a horn core.' },
  boneSpear: { id: 'boneSpear', name: 'Bone Spear', slot: 'weapon', tier: 1, attack: 17, cls: 'spear', desc: 'A flint-tipped bone shaft. Long reach, counter-thrusts.' },
  stalkerLance: { id: 'stalkerLance', name: 'Stalker Lance', slot: 'weapon', tier: 2, attack: 27, cls: 'spear', desc: 'Dunestalker claw on a bound shaft.' },
  reedSling: { id: 'reedSling', name: 'Reed Sling', slot: 'weapon', tier: 1, attack: 12, cls: 'sling', desc: 'Braided reed and hide. Throws stones from 18 m.' },
  sinewSling: { id: 'sinewSling', name: 'Stalker Sinew Sling', slot: 'weapon', tier: 2, attack: 19, cls: 'sling', desc: 'Sinew cords on a bone grip. Hard-hitting shots.' },
  leafWraps: { id: 'leafWraps', name: 'Leaf Wraps', slot: 'armor', tier: 0, defense: 0, hp: 0, desc: 'Leaves, mostly.' },
  hideGarb: { id: 'hideGarb', name: 'Bristlehide Garb', slot: 'armor', tier: 1, defense: 0.15, hp: 15, desc: 'Hide and scale tunic.' },
  stalkerPlate: { id: 'stalkerPlate', name: 'Stalker Bone Plate', slot: 'armor', tier: 2, defense: 0.27, hp: 30, desc: 'Bone plates over striped hide.' },
  ashguardMantle: { id: 'ashguardMantle', name: 'Ashguard Mantle', slot: 'armor', tier: 3, defense: 0.38, hp: 45, heatProof: true, desc: 'Ruinhorn plates under cinder fur. Shrugs off caldera heat.' },
  boneKnife: { id: 'boneKnife', name: 'Bone Carving Knife', slot: 'tool', tier: 1, desc: 'One extra carve from every hunt.' },
  flintHatchet: { id: 'flintHatchet', name: 'Flint Hatchet', slot: 'tool', tier: 1, attack: 9, desc: 'Fells trees in a couple of swings. Hold it with 2.' },
  flintPick: { id: 'flintPick', name: 'Flint Pick', slot: 'tool', tier: 1, attack: 10, desc: 'Breaks boulders fast and opens Amberite veins and Obsidian. Hold it with 3.' },
}

// ─── Held item & harvesting (Minecraft-style chopping and mining) ──────────

/** What the hunter has in hand: the equipped weapon, a tool, or bare fists. */
export type HeldId = 'weapon' | 'flintHatchet' | 'flintPick' | 'hands'
export const HELD_ORDER: HeldId[] = ['weapon', 'flintHatchet', 'flintPick', 'hands']
export const HELD_NAMES: Record<Exclude<HeldId, 'weapon'>, string> = { flintHatchet: 'Flint Hatchet', flintPick: 'Flint Pick', hands: 'Bare Hands' }
/** Bare fists still hurt a little. */
export const FIST_ATTACK = 5

export type ResourceKind = 'tree' | 'rock'
export type ResourceDef = { kind: ResourceKind; name: string; hp: number; yields: [ItemId, number, number]; bonus?: [ItemId, number] }
/** Base "hit points" scale with each instance's size; big trees take longer and give more. */
export const RESOURCES: Record<ResourceKind, ResourceDef> = {
  tree: { kind: 'tree', name: 'Tree', hp: 6, yields: ['wood', 3, 5] },
  rock: { kind: 'rock', name: 'Boulder', hp: 7, yields: ['stone', 2, 4], bonus: ['flint', 0.6] },
}
/** Harvest power per swing (light). Heavy swings multiply by HEAVY_HARVEST[chargeLevel]. */
export const HARVEST_POWER: Record<HeldId, Record<ResourceKind, number>> = {
  flintHatchet: { tree: 3, rock: 0.7 },
  flintPick: { tree: 0.9, rock: 3 },
  weapon: { tree: 1.1, rock: 1.3 },
  hands: { tree: 0.55, rock: 0.4 },
}
export const HEAVY_HARVEST = [1.6, 2, 2.6]
/** Seconds before a felled tree / broken boulder regrows (only while the hunter is away). */
export const RESOURCE_RESPAWN = 150

export type Cost = Partial<Record<ItemId, number>>
export type RecipeId = GearId | 'poultice' | GadgetId
export type RecipeDef = { id: RecipeId; stage: 1 | 2 | 3; cost: Cost; gear?: GearId; item?: ItemId; count?: number }

export const RECIPES: RecipeDef[] = [
  { id: 'poultice', stage: 1, item: 'poultice', count: 1, cost: { herb: 2, fiber: 1 } },
  { id: 'snare', stage: 1, item: 'snare', count: 1, cost: { fiber: 3, wood: 1 } },
  { id: 'flashPod', stage: 1, item: 'flashPod', count: 1, cost: { glowcap: 1, fiber: 1 } },
  { id: 'pitfall', stage: 2, item: 'pitfall', count: 1, cost: { wood: 3, fiber: 2, bone: 1 } },
  { id: 'flintHatchet', stage: 1, gear: 'flintHatchet', cost: { wood: 2, flint: 1, fiber: 2 } },
  { id: 'flintPick', stage: 1, gear: 'flintPick', cost: { wood: 3, flint: 2, fiber: 1 } },
  { id: 'flintMaul', stage: 1, gear: 'flintMaul', cost: { wood: 4, stone: 3, flint: 2, hogTusk: 2 } },
  { id: 'hideGarb', stage: 1, gear: 'hideGarb', cost: { roughHide: 3, snapperScale: 2, fiber: 4 } },
  { id: 'boneKnife', stage: 1, gear: 'boneKnife', cost: { bone: 3, flint: 2, fiber: 2 } },
  { id: 'boneSpear', stage: 1, gear: 'boneSpear', cost: { bone: 4, wood: 2, flint: 1, fiber: 2 } },
  { id: 'reedSling', stage: 1, gear: 'reedSling', cost: { fiber: 5, roughHide: 1, wood: 1 } },
  { id: 'stalkerLance', stage: 2, gear: 'stalkerLance', cost: { stalkerClaw: 2, bone: 4, wood: 2, amber: 1 } },
  { id: 'sinewSling', stage: 2, gear: 'sinewSling', cost: { stalkerHide: 2, fiber: 4, bone: 2 } },
  { id: 'amberHammer', stage: 2, gear: 'amberHammer', cost: { amber: 3, stalkerClaw: 2, bone: 3, hogTusk: 1 } },
  { id: 'stalkerPlate', stage: 2, gear: 'stalkerPlate', cost: { stalkerHide: 3, bone: 4, amber: 2 } },
  { id: 'ashguardMantle', stage: 3, gear: 'ashguardMantle', cost: { ruinPlate: 2, ashfangPelt: 2, fiber: 4 } },
  { id: 'obsidianClub', stage: 3, gear: 'obsidianClub', cost: { obsidian: 5, emberCarapace: 2, hornShard: 1 } },
]

export const CAMP_STAGES: { stage: 1 | 2 | 3; name: string; desc: string; cost: Cost }[] = [
  { stage: 1, name: 'Hearth Camp', desc: 'Relight the hearth and raise a lean-to. Unlocks basic crafting and resting.', cost: { wood: 6, stone: 5, fiber: 4 } },
  { stage: 2, name: 'Palisade Camp', desc: 'Stake a palisade, hide tents and a workbench. Unlocks tier II gear.', cost: { wood: 12, stone: 8, bone: 6, roughHide: 3, snapperScale: 2 } },
  { stage: 3, name: 'Stonehold Camp', desc: 'Build a stone kiln and walls around the tower footing. Unlocks tier III gear and the tower.', cost: { stone: 12, amber: 6, stalkerClaw: 3, ruinPlate: 2 } },
]

export const TOWER_COST: Cost = { wood: 10, obsidian: 6, sulfur: 4, ruinCrest: 1, magmaHeart: 1 }

// ─── Creatures ─────────────────────────────────────────────────────────────

export type SpeciesId = 'tuskhog' | 'mudsnapper' | 'dunestalker' | 'emberbeetle' | 'ashfang' | 'ruinhorn' | 'vulkarr'

export type Shape =
  /** Disc centred `forward` metres ahead of the creature (0 = around itself). */
  | { kind: 'circle'; radius: number; forward: number }
  /** Sector in front (or behind) of the creature. `angle` is the full opening in degrees. */
  | { kind: 'cone'; radius: number; angle: number; back?: boolean }
  /** The creature charges down a lane; its body is the hitbox while active. */
  | { kind: 'lane'; length: number; width: number }
  /** Leaps onto the point locked at the end of tracking; hits a disc on landing. */
  | { kind: 'leap'; radius: number; range: number }
  /** Eruptions under and around the target, all marked during the windup. */
  | { kind: 'burst'; radius: number; count: number; scatter: number }
  /** Arcing projectiles that splash a disc where they land (landing spots are marked). */
  | { kind: 'spit'; radius: number; count: number; spread: number; speed: number }

export type AnimId = 'bite' | 'gore' | 'charge' | 'tail' | 'stomp' | 'kick' | 'pounce' | 'claw' | 'spit' | 'roll' | 'breath' | 'spin' | 'erupt' | 'slam' | 'toss'

export type AttackDef = {
  id: string; name: string; desc: string; anim: AnimId
  /** Distance band to the player where the AI may pick this attack. */
  range: [number, number]
  windup: number; active: number; recovery: number
  damage: number; knock: 'flinch' | 'down'
  shape: Shape
  weight: number; cooldown: number
  /** Fraction of the windup during which the creature keeps turning toward the player. */
  tracking: number
  enragedOnly?: boolean
  /** Only picked when the player stands behind the creature. */
  behind?: boolean
}

export type Drop = { item: ItemId; weight: number }
export type SpeciesDef = {
  id: SpeciesId; name: string; title: string; region: RegionId; boss: boolean
  hp: number; poise: number; walk: number; run: number; turn: number
  radius: number; height: number; aggro: number; leash: number
  attacks: AttackDef[]
  drops: Drop[]
  /** Fixed carve rewards for bosses (one entry per carve). */
  bossCarves?: Partial<Record<ItemId, number>>[]
  carves: number
  palette: string[]
  lore: string
  /** Weak zone relative to facing: head = front 50°, rear = back 50°, flank = sides. */
  weak: { zone: HitZone; mult: number; label: string }
  /** Species this predator hunts when it is not fighting the hunter. */
  prey?: SpeciesId[]
  print: PrintKind
  habitat: string
}
export type HitZone = 'head' | 'flank' | 'rear'
export type PrintKind = 'hoof' | 'webbed' | 'talon' | 'insect' | 'paw' | 'giant' | 'wyrm'
/** Predator strike when hunting prey (not the hunter). */
export const PREY_STRIKE = { damage: 38, every: 1.2, detect: 30, cooldown: [45, 90] as [number, number], feed: 12, flee: 8, sneak: 1.5 }
/** Tracking: clues needed to mark a species Tracked; prints fade after this many seconds. */
export const TRACKING = { cluesNeeded: 3, printLife: 90, printSpacing: 2.2, studyRange: 2.6, sightRange: 30 }

const atk = (a: AttackDef): AttackDef => a

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  tuskhog: {
    id: 'tuskhog', name: 'Tuskhog', title: 'Bristle-backed jungle boar', region: 'coast', boss: false,
    weak: { zone: 'flank', mult: 1.35, label: 'Flank' }, print: 'hoof',
    habitat: 'Roots through the palm groves and forest edge of the jungle coast. Hunted by Dunestalkers and ambushed by Mudsnappers at the shore.',
    hp: 110, poise: 40, walk: 2.4, run: 7, turn: 5, radius: 1.1, height: 1.3, aggro: 16, leash: 42, carves: 2,
    palette: ['#8a5a3c', '#5a3826', '#f4ead2', '#2b1a12'],
    lore: 'Territorial and short-sighted. Paws the ground before it charges — sidestep, then punish its skid.',
    attacks: [
      atk({ id: 'gore', name: 'Tusk Gore', desc: 'Quick upward tusk swipe in front.', anim: 'gore', range: [0, 3.2], windup: 0.55, active: 0.18, recovery: 0.75, damage: 14, knock: 'flinch', shape: { kind: 'cone', radius: 3.2, angle: 80 }, weight: 3, cooldown: 0.4, tracking: 0.6 }),
      atk({ id: 'charge', name: 'Bristle Charge', desc: 'Lowers its head and barrels down a straight lane.', anim: 'charge', range: [5, 14], windup: 0.9, active: 0.9, recovery: 1.2, damage: 20, knock: 'down', shape: { kind: 'lane', length: 14, width: 2.6 }, weight: 2, cooldown: 3, tracking: 0.7 }),
    ],
    drops: [{ item: 'hogTusk', weight: 4 }, { item: 'roughHide', weight: 5 }, { item: 'meat', weight: 4 }, { item: 'bone', weight: 2 }],
  },
  mudsnapper: {
    id: 'mudsnapper', name: 'Mudsnapper', title: 'Shoreline ambush lizard', region: 'coast', boss: false,
    weak: { zone: 'head', mult: 1.3, label: 'Head' }, prey: ['tuskhog'], print: 'webbed',
    habitat: 'Lies half-buried in the wet sand of the tideline. Ambushes Tuskhogs that stray to the water.',
    hp: 80, poise: 30, walk: 2.0, run: 6.2, turn: 6, radius: 1.0, height: 0.9, aggro: 13, leash: 34, carves: 2,
    palette: ['#4f9a7a', '#2f6150', '#f2d27a', '#1a2a24'],
    lore: 'Lurks at the tideline. Its lunge is fast but it cannot turn mid-bite; its tail punishes flankers.',
    attacks: [
      atk({ id: 'lunge', name: 'Snapping Lunge', desc: 'Darts forward jaws-first.', anim: 'bite', range: [2, 6.5], windup: 0.5, active: 0.28, recovery: 0.85, damage: 13, knock: 'flinch', shape: { kind: 'lane', length: 6.5, width: 1.9 }, weight: 3, cooldown: 0.8, tracking: 0.65 }),
      atk({ id: 'tail', name: 'Tail Lash', desc: 'Whips its tail behind it.', anim: 'tail', range: [0, 3.6], windup: 0.45, active: 0.16, recovery: 0.6, damage: 10, knock: 'flinch', shape: { kind: 'cone', radius: 3.6, angle: 130, back: true }, weight: 4, cooldown: 1, tracking: 0, behind: true }),
    ],
    drops: [{ item: 'snapperScale', weight: 6 }, { item: 'meat', weight: 3 }, { item: 'roughHide', weight: 1 }, { item: 'bone', weight: 2 }],
  },
  dunestalker: {
    id: 'dunestalker', name: 'Dunestalker', title: 'Pack-hunting sand raptor', region: 'highlands', boss: false,
    weak: { zone: 'rear', mult: 1.3, label: 'Tail' }, prey: ['tuskhog'], print: 'talon',
    habitat: 'Roams the amber grass of the highlands in small packs. Preys on Tuskhogs; flees from Ashfangs.',
    hp: 130, poise: 45, walk: 3, run: 8.4, turn: 7, radius: 0.9, height: 1.8, aggro: 22, leash: 50, carves: 2,
    palette: ['#d9a24e', '#8a4d2a', '#2d2018', '#f4e3b8'],
    lore: 'Hunts in pairs and threes. Crouches before pouncing — roll through the landing, not away from it.',
    attacks: [
      atk({ id: 'pounce', name: 'Pounce', desc: 'Leaps onto your position after a low crouch.', anim: 'pounce', range: [5, 12], windup: 0.75, active: 0.6, recovery: 0.95, damage: 18, knock: 'down', shape: { kind: 'leap', radius: 2.7, range: 12 }, weight: 3, cooldown: 2.5, tracking: 0.7 }),
      atk({ id: 'rake', name: 'Claw Rake', desc: 'A wide slash with its foreclaws.', anim: 'claw', range: [0, 3.2], windup: 0.4, active: 0.14, recovery: 0.55, damage: 12, knock: 'flinch', shape: { kind: 'cone', radius: 3.2, angle: 100 }, weight: 3, cooldown: 0.5, tracking: 0.6 }),
    ],
    drops: [{ item: 'stalkerClaw', weight: 4 }, { item: 'stalkerHide', weight: 5 }, { item: 'meat', weight: 3 }, { item: 'bone', weight: 2 }],
  },
  emberbeetle: {
    id: 'emberbeetle', name: 'Emberbeetle', title: 'Armoured magma-spitting beetle', region: 'caldera', boss: false,
    weak: { zone: 'rear', mult: 1.45, label: 'Soft underside' }, print: 'insect',
    habitat: 'Crawls over warm obsidian near lava vents in the caldera, grazing on sulfur crust.',
    hp: 210, poise: 90, walk: 1.6, run: 4, turn: 3, radius: 1.35, height: 1.3, aggro: 18, leash: 40, carves: 2,
    palette: ['#3a2622', '#c2461f', '#ffb347', '#1a1210'],
    lore: 'Its shell glows before it spits. Close the gap — it rolls when cornered, and the roll leaves it belly-up.',
    attacks: [
      atk({ id: 'spit', name: 'Magma Spit', desc: 'Lobs a glob of magma onto your position.', anim: 'spit', range: [5, 18], windup: 0.8, active: 0.3, recovery: 0.9, damage: 16, knock: 'flinch', shape: { kind: 'spit', radius: 2.4, count: 1, spread: 0, speed: 15 }, weight: 3, cooldown: 1.6, tracking: 0.8 }),
      atk({ id: 'roll', name: 'Cinder Roll', desc: 'Curls up and rolls down a lane.', anim: 'roll', range: [2, 10], windup: 1.0, active: 1.0, recovery: 1.4, damage: 22, knock: 'down', shape: { kind: 'lane', length: 12, width: 2.9 }, weight: 2, cooldown: 3, tracking: 0.6 }),
    ],
    drops: [{ item: 'emberCarapace', weight: 5 }, { item: 'sulfur', weight: 3 }, { item: 'bone', weight: 1 }],
  },
  ashfang: {
    id: 'ashfang', name: 'Ashfang', title: 'Cinder-maned hunting hound', region: 'caldera', boss: false,
    weak: { zone: 'flank', mult: 1.3, label: 'Flank' }, prey: ['dunestalker'], print: 'paw',
    habitat: 'Hunts the ash slopes where the highlands meet the caldera. Chases Dunestalkers down from the plateau.',
    hp: 150, poise: 50, walk: 3, run: 9, turn: 7, radius: 1.0, height: 1.4, aggro: 20, leash: 46, carves: 2,
    palette: ['#5e5150', '#2b2423', '#ff7a2e', '#f2d6b0'],
    lore: 'Its mane flares before a burning dash. Dodge sideways and strike its flank while it skids.',
    attacks: [
      atk({ id: 'dash', name: 'Flame Dash', desc: 'Sprints through you trailing fire.', anim: 'charge', range: [4, 12], windup: 0.7, active: 0.55, recovery: 1.05, damage: 18, knock: 'down', shape: { kind: 'lane', length: 13, width: 2.3 }, weight: 3, cooldown: 2.2, tracking: 0.7 }),
      atk({ id: 'bite', name: 'Searing Bite', desc: 'A snapping bite in front.', anim: 'bite', range: [0, 3], windup: 0.42, active: 0.15, recovery: 0.55, damage: 13, knock: 'flinch', shape: { kind: 'cone', radius: 3, angle: 70 }, weight: 3, cooldown: 0.4, tracking: 0.6 }),
    ],
    drops: [{ item: 'ashfangPelt', weight: 5 }, { item: 'meat', weight: 3 }, { item: 'bone', weight: 2 }, { item: 'sulfur', weight: 1 }],
  },
  ruinhorn: {
    id: 'ruinhorn', name: 'Ruinhorn', title: 'Tyrant of the Sunken Ruins', region: 'highlands', boss: true,
    weak: { zone: 'rear', mult: 1.25, label: 'Hind legs' }, print: 'giant',
    habitat: 'Guards the Sunken Ruins east of the highland ramp. Its three-toed prints crack the flagstones.',
    hp: 1150, poise: 190, walk: 2.4, run: 7.4, turn: 2.6, radius: 2.7, height: 5.2, aggro: 30, leash: 36, carves: 3,
    palette: ['#8f8a7a', '#5b5448', '#e9c46a', '#2a2622', '#7cc4b0'],
    lore: 'A stone-hided behemoth that guards the ruins. Every charge ends in a long skid; its quake punishes greed.',
    attacks: [
      atk({ id: 'sweep', name: 'Horn Sweep', desc: 'A wide sweep of its great horn.', anim: 'gore', range: [0, 7], windup: 0.8, active: 0.22, recovery: 0.95, damage: 24, knock: 'down', shape: { kind: 'cone', radius: 7.2, angle: 140 }, weight: 3, cooldown: 0.8, tracking: 0.55 }),
      atk({ id: 'rampage', name: 'Rampage Charge', desc: 'Thunders down a long lane, then skids to a halt.', anim: 'charge', range: [8, 30], windup: 1.1, active: 1.5, recovery: 1.9, damage: 32, knock: 'down', shape: { kind: 'lane', length: 30, width: 5.2 }, weight: 3, cooldown: 4, tracking: 0.75 }),
      atk({ id: 'quake', name: 'Quake Stomp', desc: 'Rears up and shakes the ground around it.', anim: 'stomp', range: [0, 7.5], windup: 1.25, active: 0.2, recovery: 1.15, damage: 26, knock: 'down', shape: { kind: 'circle', radius: 8.6, forward: 0 }, weight: 2, cooldown: 5, tracking: 0 }),
      atk({ id: 'kick', name: 'Rear Kick', desc: 'Bucks at anything standing behind it.', anim: 'kick', range: [0, 6], windup: 0.5, active: 0.15, recovery: 0.75, damage: 18, knock: 'flinch', shape: { kind: 'cone', radius: 5.8, angle: 110, back: true }, weight: 5, cooldown: 1.5, tracking: 0, behind: true }),
      atk({ id: 'boulders', name: 'Rubble Toss', desc: 'Hurls ruin rubble at you (enraged).', anim: 'toss', range: [9, 30], windup: 1.1, active: 0.3, recovery: 1.0, damage: 22, knock: 'down', shape: { kind: 'spit', radius: 3.4, count: 3, spread: 6, speed: 20 }, weight: 3, cooldown: 5, tracking: 0.8, enragedOnly: true }),
    ],
    drops: [],
    bossCarves: [{ ruinCrest: 1 }, { ruinPlate: 2 }, { ruinPlate: 2, hornShard: 1 }, { ruinPlate: 1, bone: 3 }],
  },
  vulkarr: {
    id: 'vulkarr', name: 'Vulkarr', title: 'Wyrm of the Cinder Caldera', region: 'caldera', boss: true,
    weak: { zone: 'head', mult: 1.25, label: 'Glowing throat' }, print: 'wyrm',
    habitat: 'Nests in the heart of the Cinder Caldera, beyond the Breach canyon. The ground is scorched where it walks.',
    hp: 1750, poise: 250, walk: 2.2, run: 7, turn: 2.4, radius: 3.0, height: 5.6, aggro: 26, leash: 30, carves: 3,
    palette: ['#2a1c1a', '#4a2a22', '#ff6a2a', '#ffd24a', '#15100e'],
    lore: 'The heart of the mountain. Its throat glows before the breath; eruptions are marked — keep moving.',
    attacks: [
      atk({ id: 'breath', name: 'Flame Breath', desc: 'A long cone of fire in front.', anim: 'breath', range: [4, 15], windup: 1.0, active: 1.1, recovery: 1.25, damage: 28, knock: 'down', shape: { kind: 'cone', radius: 15, angle: 48 }, weight: 3, cooldown: 3, tracking: 0.7 }),
      atk({ id: 'spin', name: 'Tail Cyclone', desc: 'Spins with its tail fully extended.', anim: 'spin', range: [0, 7], windup: 0.75, active: 0.4, recovery: 1.05, damage: 24, knock: 'down', shape: { kind: 'circle', radius: 7.8, forward: 0 }, weight: 3, cooldown: 2, tracking: 0 }),
      atk({ id: 'erupt', name: 'Magma Eruption', desc: 'Roars and splits the ground under you.', anim: 'erupt', range: [0, 30], windup: 1.4, active: 0.3, recovery: 0.85, damage: 26, knock: 'down', shape: { kind: 'burst', radius: 3.4, count: 6, scatter: 9 }, weight: 2, cooldown: 6, tracking: 0.35 }),
      atk({ id: 'leap', name: 'Caldera Slam', desc: 'Leaps and crashes down on your position.', anim: 'slam', range: [9, 22], windup: 0.9, active: 0.9, recovery: 1.6, damage: 34, knock: 'down', shape: { kind: 'leap', radius: 6.6, range: 22 }, weight: 2, cooldown: 5, tracking: 0.7 }),
      atk({ id: 'fireballs', name: 'Cinder Volley', desc: 'Spits three fireballs (enraged).', anim: 'spit', range: [8, 26], windup: 0.9, active: 0.3, recovery: 0.75, damage: 20, knock: 'down', shape: { kind: 'spit', radius: 3, count: 3, spread: 5, speed: 22 }, weight: 3, cooldown: 4, tracking: 0.8, enragedOnly: true }),
    ],
    drops: [],
    bossCarves: [{ magmaHeart: 1 }, { scorchScale: 2 }, { scorchScale: 1, sulfur: 2 }, { scorchScale: 1 }],
  },
}

export const SPECIES_ORDER: SpeciesId[] = ['tuskhog', 'mudsnapper', 'dunestalker', 'emberbeetle', 'ashfang', 'ruinhorn', 'vulkarr']

/** Spawn groups: centre, count and scatter. Placement snaps to valid footing at runtime. */
export type SpawnGroup = { species: SpeciesId; x: number; z: number; count: number; spread: number; shore?: boolean }
export const SPAWNS: SpawnGroup[] = [
  { species: 'tuskhog', x: 58, z: 96, count: 2, spread: 10 },
  { species: 'tuskhog', x: -48, z: 118, count: 2, spread: 10 },
  { species: 'tuskhog', x: 118, z: 150, count: 1, spread: 6 },
  { species: 'tuskhog', x: -120, z: 40, count: 1, spread: 8 },
  { species: 'mudsnapper', x: -40, z: 262, count: 2, spread: 12, shore: true },
  { species: 'mudsnapper', x: 70, z: 238, count: 2, spread: 12, shore: true },
  { species: 'mudsnapper', x: -88, z: 40, count: 1, spread: 8, shore: true },
  { species: 'dunestalker', x: 84, z: -80, count: 2, spread: 8 },
  { species: 'dunestalker', x: -60, z: -62, count: 3, spread: 9 },
  { species: 'dunestalker', x: 176, z: -70, count: 2, spread: 8 },
  { species: 'tuskhog', x: -150, z: -40, count: 2, spread: 8 },
  // Prey herds near predators so the ecology plays out where you can see it.
  { species: 'tuskhog', x: 108, z: -64, count: 2, spread: 8 },
  { species: 'tuskhog', x: 62, z: 222, count: 1, spread: 6 },
  { species: 'ashfang', x: 72, z: -104, count: 2, spread: 8 },
  { species: 'ashfang', x: -124, z: -118, count: 2, spread: 8 },
  { species: 'emberbeetle', x: 22, z: -124, count: 1, spread: 5 },
  { species: 'emberbeetle', x: -62, z: -122, count: 2, spread: 8 },
  { species: 'emberbeetle', x: -104, z: -186, count: 2, spread: 8 },
]

// ─── Gathering ─────────────────────────────────────────────────────────────

/** Pick-up gather nodes. Wood and stone are no longer nodes: chop trees and mine boulders. */
export type NodeKind = 'fiber' | 'bone' | 'herb' | 'amber' | 'obsidian' | 'sulfur' | 'glowcap'
export type NodeDef = { kind: NodeKind; name: string; verb: string; yields: [ItemId, number, number][]; bonus?: [ItemId, number]; needsPick?: boolean }
export const NODES: Record<NodeKind, NodeDef> = {
  fiber: { kind: 'fiber', name: 'Reedgrass', verb: 'Cut', yields: [['fiber', 2, 3]] },
  bone: { kind: 'bone', name: 'Bone Pile', verb: 'Collect', yields: [['bone', 2, 2]] },
  herb: { kind: 'herb', name: 'Mendleaf', verb: 'Pick', yields: [['herb', 2, 2]] },
  amber: { kind: 'amber', name: 'Amberite Vein', verb: 'Mine', yields: [['amber', 1, 2]], needsPick: true },
  obsidian: { kind: 'obsidian', name: 'Obsidian Shards', verb: 'Mine', yields: [['obsidian', 1, 2]], needsPick: true },
  sulfur: { kind: 'sulfur', name: 'Sulfur Crust', verb: 'Chip', yields: [['sulfur', 1, 2]] },
  glowcap: { kind: 'glowcap', name: 'Glowcap Cluster', verb: 'Pick', yields: [['glowcap', 1, 2]] },
}

/** Which gather node or creature supplies each item (drives objective waypoints). */
export const ITEM_SOURCE: Partial<Record<ItemId, { node?: NodeKind; species?: SpeciesId; resource?: ResourceKind }>> = {
  wood: { resource: 'tree' }, stone: { resource: 'rock' }, flint: { resource: 'rock' }, fiber: { node: 'fiber' },
  bone: { node: 'bone' }, herb: { node: 'herb' }, glowcap: { node: 'glowcap' }, meat: { species: 'tuskhog' }, amber: { node: 'amber' }, obsidian: { node: 'obsidian' }, sulfur: { node: 'sulfur' },
  hogTusk: { species: 'tuskhog' }, roughHide: { species: 'tuskhog' }, snapperScale: { species: 'mudsnapper' },
  stalkerClaw: { species: 'dunestalker' }, stalkerHide: { species: 'dunestalker' }, emberCarapace: { species: 'emberbeetle' },
  ashfangPelt: { species: 'ashfang' }, ruinPlate: { species: 'ruinhorn' }, hornShard: { species: 'ruinhorn' },
  ruinCrest: { species: 'ruinhorn' }, magmaHeart: { species: 'vulkarr' }, scorchScale: { species: 'vulkarr' },
}
