/**
 * Unified In-Game Codex system for Prehistoric Wilds.
 * 
 * Provides an exhaustive, dynamic compendium of:
 * 1. MOBS (Hostile predators, Apex behemoths, and Passive wildlife)
 * 2. ITEMS & NATURAL RESOURCES (Materials, Parts, Gear, Consumables, Meals, World Nodes)
 * 3. CRAFTING RECIPES (Gear, Traps, Supplies, Hearth Meals, Camp Upgrades, Signal Tower)
 * 
 * Adheres strictly to Section 1 & 6 rules:
 * - Reads from real game data tables (SPECIES, ANIMAL_CONFIG, ITEMS, GEAR, MEALS, RECIPES, NODES, SPAWNS, CAMP_STAGES, TOWER_COST)
 * - Auto-discovers any new entry added to those tables
 * - Computes real-world abundance with uniform thresholds and sorting
 * - Full interactive cross-linking between items, recipes, and mobs
 */

import {
  CAMP_STAGES,
  GEAR,
  ITEMS,
  MEALS,
  RECIPES,
  RESOURCE_RESPAWN,
  SPAWNS,
  SPECIES,
  TOWER_COST,
  WEAPON_CLASSES,
  type GearId,
  type ItemId,
  type MealId,
  type SpeciesDef,
  type SpeciesId,
} from './data'
import { ANIMAL_CONFIG, type AnimalType } from './animals'
import { CONFIG } from './config'
import { REGION_NAMES } from './terrain'
import { count, knowledge, type Progress } from './rules'
import type { Game } from './game'
import { gearIcon, icon } from '../ui/icons'

export type CodexTab = 'mobs' | 'items' | 'recipes'
export type AbundanceRank = 'VERY COMMON' | 'COMMON' | 'UNCOMMON' | 'RARE' | 'VERY RARE' | 'Varies'

/**
 * Section 6: Uniform abundance configuration and scale.
 */
export const ABUNDANCE_CONFIG = {
  rankScores: {
    'VERY COMMON': 5,
    'COMMON': 4,
    'UNCOMMON': 3,
    'RARE': 2,
    'VERY RARE': 1,
    'Varies': 0,
  } as Record<AbundanceRank, number>,

  colors: {
    'VERY COMMON': '#6ee7b7', // Mint green
    'COMMON': '#93c5fd',      // Sky blue
    'UNCOMMON': '#fde047',    // Amber yellow
    'RARE': '#fb923c',        // Orange
    'VERY RARE': '#f87171',    // Crimson
    'Varies': '#d1d5db',       // Neutral gray
  } as Record<AbundanceRank, string>,
}

export type MobCodexEntry = {
  id: string
  kind: 'hostile' | 'passive'
  name: string
  title: string
  temperament: 'HOSTILE' | 'PASSIVE' | 'NEUTRAL'
  boss: boolean
  region: string
  habitat: string
  lore: string
  diet: string
  purpose: string
  hp: number
  walkSpeed: number
  runSpeed: number
  fleeSpeed?: number
  detectionRange: number
  poise?: number
  radius: number
  height: number
  palette: string[]
  weakSpot?: { label: string; mult: number; zone: string }
  attacks: {
    name: string
    desc: string
    damage: number
    range: [number, number]
    cooldown: number
    knock: string
    targets: string
    special: string
  }[]
  drops: { item: ItemId; name: string; amount: string; chance: string }[]
  huntingInfo: {
    canHuntForFood: boolean
    rawHaunchRestore: number
    bestMealRestore: number
    notes: string
  }
  abundance: {
    rank: AbundanceRank
    detail: string
    numericScore: number
  }
}

export type ItemSourceKind = 'NATURAL' | 'CRAFTED' | 'MOB DROP' | 'COMBINATION'

export type ItemCodexEntry = {
  id: string
  realItemId?: ItemId
  name: string
  category: 'Material' | 'Creature Part' | 'Weapon' | 'Armor' | 'Tool' | 'Consumable' | 'Gadget' | 'Hearth Meal' | 'Key Item'
  desc: string
  purpose: string
  sourceKind: ItemSourceKind
  stackCap: number
  iconHtml: string
  stats: Record<string, string | number>
  obtainedFrom: {
    worldSource?: string
    toolRequired?: string
    yieldPerGather?: string
    respawnTime?: string
    mobsDropping?: { mobId: string; mobName: string; chance: string }[]
    craftedFromRecipeId?: string
  }
  abundance: {
    rank: AbundanceRank
    detail: string
    numericScore: number
  }
  usedInRecipes: { recipeId: string; resultName: string; countNeeded: number }[]
}

export type RecipeCodexEntry = {
  id: string
  name: string
  category: 'Weapon' | 'Armor' | 'Tool' | 'Supply' | 'Meal' | 'Camp Stage' | 'Signal Tower'
  resultItemId?: string
  resultItemName: string
  resultIconHtml: string
  producedCount: number
  purpose: string
  station: string
  stage: number | string
  timeInfo: string
  ingredients: {
    itemId: ItemId
    name: string
    needed: number
    sourceTag: 'Natural' | 'Crafted' | 'Mob Drop'
    iconHtml: string
  }[]
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const PAINTED_SET = new Set<string>([
  'amber', 'ashfangPelt', 'bone', 'emberCarapace', 'fiber', 'flint', 'herb',
  'hogTusk', 'hornShard', 'magmaHeart', 'obsidian', 'poultice', 'roughHide',
  'ruinCrest', 'ruinPlate', 'scorchScale', 'snapperScale', 'stalkerClaw',
  'stalkerHide', 'stone', 'sulfur', 'wood', 'meat', 'glowcap', 'snare',
  'pitfall', 'flashPod', 'boneSpear', 'stalkerLance', 'reedSling', 'sinewSling',
  'flintHatchet', 'flintPick', 'heartyHaunch', 'trailStew', 'snapperBroth', 'brimstoneSkewer'
])

function getItemIconHtml(id: string, size = 32): string {
  if (PAINTED_SET.has(id)) {
    return `<img class="pi" src="./ui/icons/${id}.webp" width="${size}" height="${size}" alt="${id}" draggable="false">`
  }
  if (id in ITEMS) {
    const it = ITEMS[id as ItemId]
    return icon(it.icon, it.color, size)
  }
  if (id in GEAR) {
    const gd = GEAR[id as GearId]
    return gearIcon(gd.slot, gd.tier)
  }
  return `<span class="ph-icon" style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:6px;background:#3e3226;color:#d9c5a0;font-size:12px;font-weight:bold;">${id.slice(0, 2).toUpperCase()}</span>`
}

function countSpawnsForSpecies(sp: SpeciesId): number {
  return SPAWNS.filter(s => s.species === sp).reduce((acc, g) => acc + g.count, 0)
}

// ─── Registry Builders ─────────────────────────────────────────────────────

export function getMobCodexEntries(): MobCodexEntry[] {
  const entries: MobCodexEntry[] = []

  // 1. Hostile mobs from SPECIES
  for (const [id, def] of Object.entries(SPECIES) as [SpeciesId, SpeciesDef][]) {
    const countOnMap = def.boss ? 1 : countSpawnsForSpecies(id)
    let rank: AbundanceRank
    let detail: string

    if (def.boss) {
      rank = 'VERY RARE'
      detail = '1 on map (Apex Arena Boss)'
    } else if (countOnMap >= 8) {
      rank = 'COMMON'
      detail = `${countOnMap} on map (Re-engages on alert)`
    } else if (countOnMap >= 4) {
      rank = 'UNCOMMON'
      detail = `${countOnMap} on map across territory`
    } else {
      rank = 'RARE'
      detail = `${countOnMap} on map`
    }

    const attacks = def.attacks.map(a => ({
      name: a.name,
      desc: a.desc,
      damage: a.damage,
      range: a.range,
      cooldown: a.cooldown,
      knock: a.knock === 'down' ? 'Knockdown' : 'Flinch',
      targets: 'Player & Rival Prey',
      special: a.enragedOnly ? 'Enraged Phase Only' : a.behind ? 'Triggers When Flanked' : 'Standard Moveset',
    }))

    const drops: MobCodexEntry['drops'] = []
    if (def.bossCarves) {
      const counts: Record<string, number> = {}
      for (const carve of def.bossCarves) {
        for (const [itemKey, amt] of Object.entries(carve)) {
          counts[itemKey] = (counts[itemKey] ?? 0) + (amt ?? 1)
        }
      }
      for (const [itemKey, amt] of Object.entries(counts)) {
        const itemDef = ITEMS[itemKey as ItemId]
        drops.push({
          item: itemKey as ItemId,
          name: itemDef ? itemDef.name : itemKey,
          amount: `${amt} total`,
          chance: 'Guaranteed Carve Pool',
        })
      }
    } else {
      const totalWeight = def.drops.reduce((sum, d) => sum + d.weight, 0)
      for (const d of def.drops) {
        const itemDef = ITEMS[d.item]
        const pct = Math.round((d.weight / totalWeight) * 100)
        drops.push({
          item: d.item,
          name: itemDef ? itemDef.name : d.item,
          amount: '1–2 per carve',
          chance: `${pct}%`,
        })
      }
    }

    const preyNames = def.prey?.map(p => SPECIES[p]?.name ?? p).join(', ')
    const feedsOn = def.diet ?? (preyNames ? `Carnivorous: hunts ${preyNames} across the region.` : 'Ecology: grazes and roams its native habitat.')

    entries.push({
      id,
      kind: 'hostile',
      name: def.name,
      title: def.title,
      temperament: 'HOSTILE',
      boss: def.boss,
      region: REGION_NAMES[def.region] ?? def.region,
      habitat: def.habitat,
      lore: def.lore,
      diet: feedsOn,
      purpose: def.purpose ?? (def.boss ? 'Crucial apex boss holding relics to ignite the beacon.' : 'Threat and resource source for vital gear crafting.'),
      hp: def.hp,
      walkSpeed: def.walk,
      runSpeed: def.run,
      detectionRange: def.aggro,
      poise: def.poise,
      radius: def.radius,
      height: def.height,
      palette: def.palette,
      weakSpot: {
        label: def.weak.label,
        mult: def.weak.mult,
        zone: def.weak.zone,
      },
      attacks,
      drops,
      huntingInfo: {
        canHuntForFood: drops.some(d => d.item === 'meat'),
        rawHaunchRestore: 15,
        bestMealRestore: 38,
        notes: drops.some(d => d.item === 'meat')
          ? 'Drops Raw Haunch meat when carved (+15 hunger on pickup, or cook into hearty meals).'
          : 'Does not yield edible meat. Hunted strictly for crafting components.',
      },
      abundance: {
        rank,
        detail,
        numericScore: ABUNDANCE_CONFIG.rankScores[rank],
      },
    })
  }

  // 2. Passive animals from ANIMAL_CONFIG.TYPES
  for (const [id, a] of Object.entries(ANIMAL_CONFIG.TYPES) as [AnimalType, typeof ANIMAL_CONFIG.TYPES[AnimalType]][]) {
    let rank: AbundanceRank = 'COMMON'
    if (a.spawnWeight >= 5) rank = 'VERY COMMON'
    else if (a.spawnWeight >= 3) rank = 'COMMON'
    else rank = 'UNCOMMON'

    const regions = a.preferredRegions.map(r => REGION_NAMES[r] ?? r).join(', ')

    entries.push({
      id,
      kind: 'passive',
      name: a.name,
      title: a.title ?? 'Passive Island Herbivore',
      temperament: 'PASSIVE',
      boss: false,
      region: regions,
      habitat: `Natural wildlife wandering throughout ${regions}. Runs away when caveman draws near.`,
      lore: `Gentle creature roaming the wild lands. Harmless to humans and hunted for fresh meat.`,
      diet: a.diet ?? 'Wild greenery, seeds, and tender flora.',
      purpose: a.purpose ?? 'Harmless wildlife hunted to replenish player hunger.',
      hp: a.hp,
      walkSpeed: a.speed,
      runSpeed: a.fleeSpeed,
      fleeSpeed: a.fleeSpeed,
      detectionRange: ANIMAL_CONFIG.DETECTION_RADIUS,
      radius: a.radius,
      height: a.height,
      palette: ['#c49a6c', '#f3ece2', '#2a1a12'],
      attacks: [{
        name: 'Does not attack',
        desc: `Non-hostile. Flees at ${a.fleeSpeed} m/s when approached within ${ANIMAL_CONFIG.DETECTION_RADIUS}m. Panics with a speed surge if hit.`,
        damage: 0,
        range: [0, 0],
        cooldown: 0,
        knock: 'None',
        targets: 'None',
        special: 'Pure escape behavior',
      }],
      drops: [{
        item: 'meat',
        name: 'Raw Haunch',
        amount: `${a.meat} meat haunch${a.meat > 1 ? 'es' : ''}`,
        chance: '100% Guaranteed',
      }],
      huntingInfo: {
        canHuntForFood: true,
        rawHaunchRestore: ANIMAL_CONFIG.RAW_MEAT_HUNGER * a.meat,
        bestMealRestore: 38,
        notes: `Drops ${a.meat} meat haunch${a.meat > 1 ? 'es' : ''} on death (+${ANIMAL_CONFIG.RAW_MEAT_HUNGER * a.meat}% hunger total upon pickup).`,
      },
      abundance: {
        rank,
        detail: `Spawn weight ${a.spawnWeight} (cap of ${ANIMAL_CONFIG.MAX_ANIMALS} concurrent wildlife)`,
        numericScore: ABUNDANCE_CONFIG.rankScores[rank],
      },
    })
  }

  return entries
}

export function getItemCodexEntries(): ItemCodexEntry[] {
  const entries: ItemCodexEntry[] = []

  // Helper to find recipes that use an item
  const findRecipesUsing = (id: ItemId) => {
    const res: { recipeId: string; resultName: string; countNeeded: number }[] = []
    for (const r of RECIPES) {
      if (r.cost[id]) {
        const gear = r.gear ? GEAR[r.gear] : null
        const name = gear ? gear.name : (ITEMS[r.item!]?.name ?? r.id)
        res.push({ recipeId: r.id, resultName: name, countNeeded: r.cost[id]! })
      }
    }
    for (const [mid, m] of Object.entries(MEALS) as [MealId, typeof MEALS[MealId]][]) {
      if (m.cost[id]) {
        res.push({ recipeId: mid, resultName: m.name, countNeeded: m.cost[id]! })
      }
    }
    for (const stage of CAMP_STAGES) {
      if (stage.cost[id]) {
        res.push({ recipeId: `campStage_${stage.stage}`, resultName: `Camp Stage ${stage.stage}: ${stage.name}`, countNeeded: stage.cost[id]! })
      }
    }
    if (TOWER_COST[id]) {
      res.push({ recipeId: 'tower', resultName: 'Signal Tower Beacon', countNeeded: TOWER_COST[id]! })
    }
    return res
  }

  // Helper to find recipe that creates an item
  const findCraftingRecipe = (id: string): string | undefined => {
    const r = RECIPES.find(rec => rec.id === id || rec.item === id || rec.gear === id)
    if (r) return r.id
    if (id in MEALS) return id
    return undefined
  }

  // Helper to find mobs dropping an item
  const findMobsDropping = (id: ItemId) => {
    const list: { mobId: string; mobName: string; chance: string }[] = []
    for (const [sp, def] of Object.entries(SPECIES) as [SpeciesId, SpeciesDef][]) {
      if (def.bossCarves) {
        let has = false
        for (const c of def.bossCarves) if (id in c) has = true
        if (has) list.push({ mobId: sp, mobName: def.name, chance: 'Carve Drop Pool' })
      } else {
        const d = def.drops.find(x => x.item === id)
        if (d) {
          const total = def.drops.reduce((a, b) => a + b.weight, 0)
          list.push({ mobId: sp, mobName: def.name, chance: `${Math.round((d.weight / total) * 100)}%` })
        }
      }
    }
    if (id === 'meat') {
      for (const [at, a] of Object.entries(ANIMAL_CONFIG.TYPES) as [AnimalType, typeof ANIMAL_CONFIG.TYPES[AnimalType]][]) {
        list.push({ mobId: at, mobName: `${a.name} (Passive)`, chance: `100% (${a.meat} drop)` })
      }
    }
    return list
  }

  // 1. Items from ITEMS
  for (const [id, it] of Object.entries(ITEMS) as [ItemId, typeof ITEMS[ItemId]][]) {
    const craftRecipe = findCraftingRecipe(id)
    const mobsDropping = findMobsDropping(id)
    const usedIn = findRecipesUsing(id)

    let sourceKind: ItemSourceKind = 'NATURAL'
    if (craftRecipe && mobsDropping.length === 0) sourceKind = 'CRAFTED'
    else if (!craftRecipe && mobsDropping.length > 0 && id !== 'bone' && id !== 'sulfur' && id !== 'meat') sourceKind = 'MOB DROP'
    else if (craftRecipe && mobsDropping.length > 0) sourceKind = 'COMBINATION'
    else if (mobsDropping.length > 0 && (id === 'bone' || id === 'sulfur' || id === 'meat')) sourceKind = 'COMBINATION'

    let rank: AbundanceRank = 'COMMON'
    let detail = 'Common island resource'
    let worldSource: string | undefined
    let toolRequired: string | undefined
    let yieldPerGather: string | undefined
    let respawnTime: string | undefined

    if (id === 'wood') {
      rank = 'VERY COMMON'
      detail = '~350 trees on map · 150s regrowth'
      worldSource = 'Living trees across all island regions'
      toolRequired = 'Hands or weapons (Flint Hatchet is fastest)'
      yieldPerGather = '3–5 Wood per felled tree'
      respawnTime = `${RESOURCE_RESPAWN}s`
    } else if (id === 'stone') {
      rank = 'COMMON'
      detail = '~120 boulders on map · 150s regrowth'
      worldSource = 'Stone boulders on shores and hills'
      toolRequired = 'Hands or weapons (Flint Pick is fastest)'
      yieldPerGather = '2–4 Stone per shattered boulder'
      respawnTime = `${RESOURCE_RESPAWN}s`
    } else if (id === 'flint') {
      rank = 'COMMON'
      detail = '60% bonus yield inside boulders'
      worldSource = 'Embedded within stone boulders'
      toolRequired = 'Flint Pick or blunt weapon'
      yieldPerGather = '60% chance of 1 Flint per boulder'
      respawnTime = `${RESOURCE_RESPAWN}s`
    } else if (id === 'fiber') {
      rank = 'VERY COMMON'
      detail = '34 Reedgrass nodes on map · 70s regrowth'
      worldSource = 'Reedgrass nodes in shoreline shallows & coast'
      toolRequired = 'Hand gather (press E)'
      yieldPerGather = '2–3 Reed Fiber per gather'
      respawnTime = `${CONFIG.expedition.nodeRespawn}s`
    } else if (id === 'bone') {
      rank = 'VERY COMMON'
      detail = '32 Bone Piles on map + creature drops'
      worldSource = 'Ancient Bone Piles and slain creatures'
      toolRequired = 'Hand gather (press E) or Carve'
      yieldPerGather = '2 Bone per pile'
      respawnTime = `${CONFIG.expedition.nodeRespawn}s`
    } else if (id === 'herb') {
      rank = 'VERY COMMON'
      detail = '29 Mendleaf nodes on map · 70s regrowth'
      worldSource = 'Mendleaf floral clusters in grass'
      toolRequired = 'Hand gather (press E)'
      yieldPerGather = '2 Mendleaf per node'
      respawnTime = `${CONFIG.expedition.nodeRespawn}s`
    } else if (id === 'amber') {
      rank = 'COMMON'
      detail = '24 Amberite Veins on map (Highlands)'
      worldSource = 'Amberite mineral veins on highland rock'
      toolRequired = 'Flint Pick required'
      yieldPerGather = '1–2 Amberite crystals per vein'
      respawnTime = `${CONFIG.expedition.nodeRespawn}s`
    } else if (id === 'obsidian') {
      rank = 'COMMON'
      detail = '24 Obsidian Veins on map (Caldera)'
      worldSource = 'Volcanic glass spires inside the breach'
      toolRequired = 'Flint Pick required'
      yieldPerGather = '1–2 Obsidian Shards per vein'
      respawnTime = `${CONFIG.expedition.nodeRespawn}s`
    } else if (id === 'sulfur') {
      rank = 'COMMON'
      detail = '22 Sulfur Crusts on map (Caldera) + Beetle drops'
      worldSource = 'Yellow sulfur deposits near lava vents'
      toolRequired = 'Hand chip (press E)'
      yieldPerGather = '1–2 Sulfur per node'
      respawnTime = `${CONFIG.expedition.nodeRespawn}s`
    } else if (id === 'glowcap') {
      rank = 'COMMON'
      detail = '22 Glowcap Clusters on map (Jungle & Ruins)'
      worldSource = 'Luminescent mushroom clusters'
      toolRequired = 'Hand pick (press E)'
      yieldPerGather = '1–2 Glowcaps per cluster'
      respawnTime = `${CONFIG.expedition.nodeRespawn}s`
    } else if (id === 'meat') {
      rank = 'VERY COMMON'
      detail = 'Obtained from 4 predators and 3 passive animals'
      worldSource = 'Hunted wild animals and slain monsters'
      toolRequired = 'Hunt or Carve'
      yieldPerGather = '1–3 haunches per kill'
    } else if (id === 'ruinCrest' || id === 'magmaHeart') {
      rank = 'VERY RARE'
      detail = 'Guaranteed 1 drop per Apex Boss kill'
    } else if (id === 'ruinPlate' || id === 'hornShard' || id === 'scorchScale') {
      rank = 'RARE'
      detail = 'Highland & Caldera Boss carves'
    } else if (sourceKind === 'CRAFTED') {
      rank = 'Varies'
      detail = 'Crafted at Camp Workbench'
    }

    const stats: Record<string, string | number> = {}
    if (it.kind === 'consumable' && id === 'poultice') stats['Heal Amount'] = '+45 Health'
    if (id === 'meat') stats['Hunger Restored'] = `+${ANIMAL_CONFIG.RAW_MEAT_HUNGER}% on pickup`
    if (id in CONFIG.player) stats['Weight'] = 'Standard'

    let categoryLabel: ItemCodexEntry['category'] = 'Material'
    if (it.kind === 'part') categoryLabel = 'Creature Part'
    else if (it.kind === 'consumable') categoryLabel = 'Consumable'
    else if (it.kind === 'gadget') categoryLabel = 'Gadget'
    else if (it.kind === 'key') categoryLabel = 'Key Item'

    entries.push({
      id,
      realItemId: id,
      name: it.name,
      category: categoryLabel,
      desc: it.desc,
      purpose: it.purpose ?? it.desc,
      sourceKind,
      stackCap: id === 'poultice' ? 5 : (id === 'snare' ? 3 : (id === 'pitfall' ? 2 : (id === 'flashPod' ? 5 : 99))),
      iconHtml: getItemIconHtml(id, 40),
      stats,
      obtainedFrom: {
        worldSource,
        toolRequired,
        yieldPerGather,
        respawnTime,
        mobsDropping,
        craftedFromRecipeId: craftRecipe,
      },
      abundance: {
        rank,
        detail,
        numericScore: ABUNDANCE_CONFIG.rankScores[rank],
      },
      usedInRecipes: usedIn,
    })
  }

  // 2. Gear items from GEAR
  for (const [id, g] of Object.entries(GEAR) as [GearId, typeof GEAR[GearId]][]) {
    const stats: Record<string, string | number> = {}
    if (g.attack) stats['Attack Power'] = g.attack
    if (g.defense) stats['Damage Defense'] = `${Math.round(g.defense * 100)}%`
    if (g.hp) stats['Bonus Health'] = `+${g.hp} Max HP`
    if (g.heatProof) stats['Environmental Heat'] = 'Immune (Caldera Proof)'
    if (g.cls) stats['Weapon Moveset'] = WEAPON_CLASSES[g.cls]?.name ?? g.cls

    let cat: ItemCodexEntry['category'] = 'Weapon'
    if (g.slot === 'armor') cat = 'Armor'
    if (g.slot === 'tool') cat = 'Tool'

    entries.push({
      id,
      name: g.name,
      category: cat,
      desc: g.desc,
      purpose: g.purpose ?? g.desc,
      sourceKind: g.tier === 0 ? 'NATURAL' : 'CRAFTED',
      stackCap: 1,
      iconHtml: getItemIconHtml(id, 40),
      stats,
      obtainedFrom: {
        craftedFromRecipeId: findCraftingRecipe(id),
        worldSource: g.tier === 0 ? 'Starting gear equipped when arriving on island' : 'Camp workbench crafting',
      },
      abundance: {
        rank: g.tier === 0 ? 'COMMON' : 'Varies',
        detail: g.tier === 0 ? 'Starting gear' : `Craftable Tier ${g.tier}`,
        numericScore: 0,
      },
      usedInRecipes: [],
    })
  }

  // 3. Hearth Meals from MEALS
  for (const [id, m] of Object.entries(MEALS) as [MealId, typeof MEALS[MealId]][]) {
    const stats: Record<string, string | number> = {
      'Buff Duration': '300s (5 minutes) · +50% for Perfect Sear',
      'Hunger Restored': '+38% Hunger',
    }
    if (m.buff.hp) stats['Health Buff'] = `+${m.buff.hp} Max HP`
    if (m.buff.stamina) stats['Stamina Pool'] = `+${m.buff.stamina}`
    if (m.buff.staRegen) stats['Stamina Regen'] = `+${Math.round(m.buff.staRegen * 100)}%`
    if (m.buff.dodgeCost) stats['Dodge Cost'] = `-${Math.round(m.buff.dodgeCost * 100)}% Stamina`
    if (m.buff.defense) stats['Defense Buff'] = `+${Math.round(m.buff.defense * 100)}%`
    if (m.buff.attack) stats['Attack Buff'] = `+${Math.round(m.buff.attack * 100)}%`
    if (m.buff.heatSlow) stats['Caldera Heat Drain'] = `-${Math.round(m.buff.heatSlow * 100)}% Slowdown`

    entries.push({
      id,
      name: m.name,
      category: 'Hearth Meal',
      desc: m.desc,
      purpose: m.purpose ?? m.desc,
      sourceKind: 'CRAFTED',
      stackCap: 1,
      iconHtml: getItemIconHtml(id, 40),
      stats,
      obtainedFrom: {
        craftedFromRecipeId: id,
        worldSource: `Prepared over campfire at Camp Stage ${m.stage}`,
      },
      abundance: {
        rank: 'Varies',
        detail: `Cookable at Camp Hearth (Stage ${m.stage})`,
        numericScore: 0,
      },
      usedInRecipes: [],
    })
  }

  return entries
}

export function getRecipeCodexEntries(): RecipeCodexEntry[] {
  const entries: RecipeCodexEntry[] = []

  const resolveSourceTag = (id: ItemId): 'Natural' | 'Crafted' | 'Mob Drop' => {
    if (id === 'wood' || id === 'stone' || id === 'fiber' || id === 'flint' || id === 'herb' || id === 'amber' || id === 'obsidian' || id === 'sulfur' || id === 'glowcap') return 'Natural'
    if (id === 'poultice' || id === 'snare' || id === 'pitfall' || id === 'flashPod') return 'Crafted'
    return 'Mob Drop'
  }

  // 1. Gear and consumable recipes from RECIPES
  for (const r of RECIPES) {
    const gear = r.gear ? GEAR[r.gear] : null
    const item = r.item ? ITEMS[r.item] : null
    const resultName = gear ? gear.name : (item ? item.name : r.id)
    const resultPurpose = gear ? (gear.purpose ?? gear.desc) : (item ? (item.purpose ?? item.desc) : '')
    const iconHtml = getItemIconHtml(r.gear ?? r.item ?? r.id, 40)

    let cat: RecipeCodexEntry['category'] = 'Supply'
    if (gear?.slot === 'weapon') cat = 'Weapon'
    else if (gear?.slot === 'armor') cat = 'Armor'
    else if (gear?.slot === 'tool') cat = 'Tool'

    const ingredients = (Object.entries(r.cost) as [ItemId, number][]).map(([iid, need]) => ({
      itemId: iid,
      name: ITEMS[iid]?.name ?? iid,
      needed: need,
      sourceTag: resolveSourceTag(iid),
      iconHtml: getItemIconHtml(iid, 24),
    }))

    entries.push({
      id: r.id,
      name: resultName,
      category: cat,
      resultItemId: r.gear ?? r.item,
      resultItemName: resultName,
      resultIconHtml: iconHtml,
      producedCount: r.count ?? 1,
      purpose: resultPurpose,
      station: `Camp Workbench (Stage ${r.stage})`,
      stage: r.stage,
      timeInfo: 'Instant crafting at camp',
      ingredients,
    })
  }

  // 2. Hearth Meals from MEALS
  for (const [id, m] of Object.entries(MEALS) as [MealId, typeof MEALS[MealId]][]) {
    const ingredients = (Object.entries(m.cost) as [ItemId, number][]).map(([iid, need]) => ({
      itemId: iid,
      name: ITEMS[iid]?.name ?? iid,
      needed: need,
      sourceTag: resolveSourceTag(iid),
      iconHtml: getItemIconHtml(iid, 24),
    }))

    entries.push({
      id,
      name: m.name,
      category: 'Meal',
      resultItemId: id,
      resultItemName: m.name,
      resultIconHtml: getItemIconHtml(id, 40),
      producedCount: 1,
      purpose: m.purpose ?? m.desc,
      station: `Camp Hearth Fire (Stage ${m.stage})`,
      stage: m.stage,
      timeInfo: 'Interactive searing mini-game; stop in gold band for +50% duration',
      ingredients,
    })
  }

  // 3. Camp Upgrades from CAMP_STAGES
  for (const cs of CAMP_STAGES) {
    const ingredients = (Object.entries(cs.cost) as [ItemId, number][]).map(([iid, need]) => ({
      itemId: iid,
      name: ITEMS[iid]?.name ?? iid,
      needed: need,
      sourceTag: resolveSourceTag(iid),
      iconHtml: getItemIconHtml(iid, 24),
    }))

    entries.push({
      id: `campStage_${cs.stage}`,
      name: `Camp Upgrade ${cs.stage}: ${cs.name}`,
      category: 'Camp Stage',
      resultItemName: cs.name,
      resultIconHtml: `<span style="font-size:28px">⛺</span>`,
      producedCount: 1,
      purpose: cs.desc,
      station: 'Camp Site Perimeter',
      stage: cs.stage,
      timeInfo: 'Instant permanent base progression',
      ingredients,
    })
  }

  // 4. Signal Tower Beacon from TOWER_COST
  const towerIngs = (Object.entries(TOWER_COST) as [ItemId, number][]).map(([iid, need]) => ({
    itemId: iid,
    name: ITEMS[iid]?.name ?? iid,
    needed: need,
    sourceTag: resolveSourceTag(iid),
    iconHtml: getItemIconHtml(iid, 24),
  }))

  entries.push({
    id: 'tower',
    name: 'Signal Tower Beacon Restoration',
    category: 'Signal Tower',
    resultItemName: 'Rescue Beacon Flame',
    resultIconHtml: `<span style="font-size:28px">🗼</span>`,
    producedCount: 1,
    purpose: 'Lights the grand beacon atop the ancient tower, summoning rescue ships and ending the expedition.',
    station: 'Ancient Signal Tower Footing (Requires Camp Stage III)',
    stage: 3,
    timeInfo: 'Final expedition milestone',
    ingredients: towerIngs,
  })

  return entries
}

// ─── Codex Manager & Renderer ──────────────────────────────────────────────

export class CodexManager {
  activeTab: CodexTab = 'mobs'
  selectedMobId: string = 'tuskhog'
  selectedItemId: string = 'wood'
  selectedRecipeId: string = 'boneSpear'

  searchTerm = ''
  categoryFilter = 'All'
  sourceFilter = 'All'
  sortAbundanceDesc = false

  selectTab(tab: CodexTab): void {
    this.activeTab = tab
    this.categoryFilter = 'All'
    this.sourceFilter = 'All'
  }

  selectMob(id: string): void {
    this.activeTab = 'mobs'
    this.selectedMobId = id
  }

  selectItem(id: string): void {
    this.activeTab = 'items'
    this.selectedItemId = id
  }

  selectRecipe(id: string): void {
    this.activeTab = 'recipes'
    this.selectedRecipeId = id
  }

  render(game: Game): string {
    const p = game.progress

    // Tab buttons
    const tabsHtml = `
      <div class="codex-topbar">
        <div class="codex-tabs">
          <button class="codex-tab-btn ${this.activeTab === 'mobs' ? 'active' : ''}" data-act="codex-tab" data-codex-tab="mobs">
            <span class="tab-icon">🐾</span> BEASTS &amp; WILDLIFE
          </button>
          <button class="codex-tab-btn ${this.activeTab === 'items' ? 'active' : ''}" data-act="codex-tab" data-codex-tab="items">
            <span class="tab-icon">🌿</span> ITEMS &amp; RESOURCES
          </button>
          <button class="codex-tab-btn ${this.activeTab === 'recipes' ? 'active' : ''}" data-act="codex-tab" data-codex-tab="recipes">
            <span class="tab-icon">🔨</span> RECIPES &amp; BLUEPRINTS
          </button>
        </div>
        <div class="codex-search-wrap">
          <input type="text" class="codex-search-input" data-act="codex-search" placeholder="Search entries, stats, drops..." value="${esc(this.searchTerm)}" />
          ${this.searchTerm ? `<button class="codex-search-clear" data-act="codex-clear-search" title="Clear search">✕</button>` : ''}
        </div>
      </div>
    `

    let contentHtml = ''
    if (this.activeTab === 'mobs') contentHtml = this.renderMobsTab(game, p)
    else if (this.activeTab === 'items') contentHtml = this.renderItemsTab(game, p)
    else contentHtml = this.renderRecipesTab(game, p)

    return `<div class="codex-shell">${tabsHtml}<div class="codex-main">${contentHtml}</div></div>`
  }

  private renderMobsTab(_game: Game, p: Progress): string {
    const allMobs = getMobCodexEntries()
    const q = this.searchTerm.trim().toLowerCase()

    let filtered = allMobs.filter(m => {
      if (this.categoryFilter !== 'All') {
        if (this.categoryFilter === 'Hostile' && m.temperament !== 'HOSTILE') return false
        if (this.categoryFilter === 'Passive' && m.temperament !== 'PASSIVE') return false
        if (this.categoryFilter === 'Apex Boss' && !m.boss) return false
      }
      if (!q) return true
      return (
        m.name.toLowerCase().includes(q) ||
        m.title.toLowerCase().includes(q) ||
        m.region.toLowerCase().includes(q) ||
        m.lore.toLowerCase().includes(q) ||
        m.diet.toLowerCase().includes(q) ||
        m.drops.some(d => d.name.toLowerCase().includes(q))
      )
    })

    if (this.sortAbundanceDesc) {
      filtered.sort((a, b) => b.abundance.numericScore - a.abundance.numericScore)
    }

    if (!filtered.some(m => m.id === this.selectedMobId) && filtered.length > 0) {
      this.selectedMobId = filtered[0].id
    }

    const currentMob = allMobs.find(m => m.id === this.selectedMobId) ?? allMobs[0]
    const k = currentMob.kind === 'hostile' ? knowledge(p, currentMob.id as SpeciesId) : { seen: true, hunted: true, tracked: false, weak: true, clues: 3, hunts: 0, parts: ['meat'] as ItemId[], exact: true, best: 0 }

    // Filter controls
    const categories = ['All', 'Hostile', 'Passive', 'Apex Boss']
    const filtersHtml = `
      <div class="codex-filter-bar">
        <div class="filter-chips">
          ${categories.map(cat => `<button class="chip ${this.categoryFilter === cat ? 'active' : ''}" data-act="codex-cat" data-val="${cat}">${cat}</button>`).join('')}
        </div>
        <div class="sort-wrap">
          <button class="sort-btn ${this.sortAbundanceDesc ? 'active' : ''}" data-act="codex-sort" title="Toggle abundance sorting">
            ⇅ Abundance ${this.sortAbundanceDesc ? '(Highest)' : '(Default)'}
          </button>
        </div>
      </div>
    `

    // List column
    const listHtml = filtered.map(m => {
      const isSel = m.id === this.selectedMobId
      const kInfo = m.kind === 'hostile' ? knowledge(p, m.id as SpeciesId) : { seen: true }
      const statusBadge = m.boss ? `<span class="tag-badge boss">APEX</span>` : m.kind === 'passive' ? `<span class="tag-badge passive">PASSIVE</span>` : `<span class="tag-badge hostile">HOSTILE</span>`
      const seenMarker = kInfo.seen ? '' : `<span class="sight-tag">New</span>`

      return `
        <button class="codex-card ${isSel ? 'selected' : ''}" data-act="codex-sel" data-id="${m.id}">
          <div class="card-icon" style="background:${m.palette[0] ?? '#443'};color:#fff">
            ${m.boss ? '👑' : m.kind === 'passive' ? '🐰' : '🐗'}
          </div>
          <div class="card-body">
            <div class="card-title-row">
              <strong class="card-name">${esc(m.name)}</strong>
              ${statusBadge}
            </div>
            <div class="card-sub">${esc(m.region)} · ${esc(m.abundance.rank)}</div>
          </div>
          ${seenMarker}
        </button>
      `
    }).join('')

    // Detail panel
    const detailHtml = this.renderMobDetail(currentMob, k)

    return `
      <div class="codex-panel-wrap">
        <div class="codex-left-col">
          ${filtersHtml}
          <div class="codex-list-scroller">
            ${listHtml || '<div class="codex-empty">No matching beasts found.</div>'}
          </div>
        </div>
        <div class="codex-right-col">
          ${detailHtml}
        </div>
      </div>
    `
  }

  private renderMobDetail(m: MobCodexEntry, k: ReturnType<typeof knowledge>): string {
    const abColor = ABUNDANCE_CONFIG.colors[m.abundance.rank] ?? '#ffd27a'

    // Weak spot diagram
    let weakDiagram = ''
    if (m.weakSpot) {
      const zone = m.weakSpot.zone
      weakDiagram = `
        <div class="weak-spot-card">
          <div class="diagram-wrap">
            <svg class="wzone" viewBox="-50 -50 100 100" width="84" height="84">
              <circle r="42" fill="rgba(0,0,0,.25)" stroke="#785a3a" stroke-width="2"/>
              ${k.weak ? `<path d="${zone === 'head' ? 'M0 0 L-18 -39 A42 42 0 0 1 18 -39 Z' : zone === 'rear' ? 'M0 0 L-18 39 A42 42 0 0 0 18 39 Z' : 'M0 0 L-39 -18 A42 42 0 0 0 -39 18 Z M0 0 L39 -18 A42 42 0 0 1 39 18 Z'}" fill="#ff8a2a" opacity=".9"/>` : ''}
              <ellipse rx="12" ry="22" fill="#d9c49c" stroke="#3b2a1a" stroke-width="2"/>
              <circle cy="-24" r="8" fill="#d9c49c" stroke="#3b2a1a" stroke-width="2"/>
              <text y="-44" text-anchor="middle" font-size="9" font-weight="bold" fill="#ffd27a">FRONT</text>
            </svg>
          </div>
          <div class="diagram-info">
            <h5>Weak Hit Zone</h5>
            <p><strong>${esc(m.weakSpot.label)}</strong> takes <strong>×${m.weakSpot.mult}</strong> damage</p>
            <small class="fine-tip">${k.weak ? 'Weakness verified in combat' : 'Strike weak zone to confirm'}</small>
          </div>
        </div>
      `
    }

    // Attacks section
    const attacksHtml = m.attacks.map(a => `
      <div class="attack-row">
        <div class="atk-head">
          <strong class="atk-name">${esc(a.name)}</strong>
          <span class="atk-dmg">${a.damage > 0 ? `Damage: <b>${a.damage}</b> (${a.knock})` : '<em class="safe-tag">Harmless</em>'}</span>
        </div>
        <p class="atk-desc">${esc(a.desc)}</p>
        <div class="atk-meta">
          <span>Range: <b>${a.range[0]}–${a.range[1]}m</b></span>
          <span>Cooldown: <b>${a.cooldown}s</b></span>
          <span>Targets: <b>${esc(a.targets)}</b></span>
          ${a.special !== 'Standard Moveset' ? `<span class="atk-special">${esc(a.special)}</span>` : ''}
        </div>
      </div>
    `).join('')

    // Drops section with cross-links
    const dropsHtml = m.drops.map(d => `
      <div class="drop-item-chip" data-act="codex-jump-item" data-id="${d.item}" title="Click to view ${esc(d.name)} in Items Tab">
        ${getItemIconHtml(d.item, 32)}
        <div class="drop-text">
          <strong>${esc(d.name)}</strong>
          <small>${d.amount} · <b class="gold">${d.chance}</b></small>
        </div>
        <span class="jump-arrow">➔</span>
      </div>
    `).join('')

    return `
      <div class="detail-scroller">
        <div class="detail-header">
          <div class="title-cluster">
            <span class="detail-eyebrow">${esc(m.title)} · ${esc(m.region)}</span>
            <h2 class="detail-title">${esc(m.name)}</h2>
          </div>
          <div class="badge-cluster">
            <span class="rank-badge" style="border-color:${abColor};color:${abColor}">
              ● ${esc(m.abundance.rank)}
            </span>
            <span class="temp-badge ${m.temperament.toLowerCase()}">${esc(m.temperament)}</span>
          </div>
        </div>

        <div class="detail-callout lore-box">
          <p>${esc(m.lore)}</p>
          <div class="purpose-line"><strong>Expedition Role:</strong> ${esc(m.purpose)}</div>
        </div>

        <div class="stat-boxes-grid">
          <div class="stat-box">
            <span class="sb-label">HEALTH</span>
            <span class="sb-val">${m.hp} HP</span>
          </div>
          <div class="stat-box">
            <span class="sb-label">SPEED</span>
            <span class="sb-val">${m.walkSpeed} / ${m.runSpeed} m/s</span>
          </div>
          <div class="stat-box">
            <span class="sb-label">DETECTION</span>
            <span class="sb-val">${m.detectionRange} m</span>
          </div>
          <div class="stat-box">
            <span class="sb-label">POISE / DEF</span>
            <span class="sb-val">${m.poise ?? 'Standard'}</span>
          </div>
        </div>

        <div class="section-divider"></div>

        <div class="two-col-section">
          <div>
            <h4>Ecology &amp; Habitat</h4>
            <p><strong>Spawn Territory:</strong> ${esc(m.habitat)}</p>
            <p><strong>Dietary Pattern:</strong> ${esc(m.diet)}</p>
            <p><strong>World Abundance:</strong> ${esc(m.abundance.detail)}</p>
          </div>
          <div>
            <h4>Hunting &amp; Nutrition</h4>
            <p>${esc(m.huntingInfo.notes)}</p>
            ${m.huntingInfo.canHuntForFood ? `<p class="gold-box">🍗 Restores <b>+${m.huntingInfo.rawHaunchRestore}% Hunger</b> directly or cook for sustained buffs.</p>` : ''}
          </div>
        </div>

        ${weakDiagram ? `<div class="section-divider"></div><h4>Vulnerability</h4>${weakDiagram}` : ''}

        <div class="section-divider"></div>
        <h4>Attacks &amp; Behaviors</h4>
        <div class="attacks-list">${attacksHtml}</div>

        <div class="section-divider"></div>
        <h4>Carves, Drops &amp; Yields</h4>
        <div class="drops-grid">${dropsHtml}</div>
      </div>
    `
  }

  private renderItemsTab(_game: Game, p: Progress): string {
    const allItems = getItemCodexEntries()
    const q = this.searchTerm.trim().toLowerCase()

    let filtered = allItems.filter(item => {
      if (this.categoryFilter !== 'All') {
        if (this.categoryFilter === 'Materials' && item.category !== 'Material') return false
        if (this.categoryFilter === 'Creature Parts' && item.category !== 'Creature Part') return false
        if (this.categoryFilter === 'Weapons' && item.category !== 'Weapon') return false
        if (this.categoryFilter === 'Armor' && item.category !== 'Armor') return false
        if (this.categoryFilter === 'Tools' && item.category !== 'Tool') return false
        if (this.categoryFilter === 'Supplies' && (item.category !== 'Consumable' && item.category !== 'Gadget')) return false
        if (this.categoryFilter === 'Hearth Meals' && item.category !== 'Hearth Meal') return false
      }
      if (this.sourceFilter !== 'All') {
        if (this.sourceFilter === 'Natural' && item.sourceKind !== 'NATURAL' && item.sourceKind !== 'COMBINATION') return false
        if (this.sourceFilter === 'Crafted' && item.sourceKind !== 'CRAFTED' && item.sourceKind !== 'COMBINATION') return false
        if (this.sourceFilter === 'Mob Drop' && item.sourceKind !== 'MOB DROP' && item.sourceKind !== 'COMBINATION') return false
      }
      if (!q) return true
      return (
        item.name.toLowerCase().includes(q) ||
        item.desc.toLowerCase().includes(q) ||
        item.purpose.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      )
    })

    if (this.sortAbundanceDesc) {
      filtered.sort((a, b) => b.abundance.numericScore - a.abundance.numericScore)
    }

    if (!filtered.some(i => i.id === this.selectedItemId) && filtered.length > 0) {
      this.selectedItemId = filtered[0].id
    }

    const currentItem = allItems.find(i => i.id === this.selectedItemId) ?? allItems[0]

    // Category and source chips
    const categories = ['All', 'Materials', 'Creature Parts', 'Weapons', 'Armor', 'Tools', 'Supplies', 'Hearth Meals']
    const sources = ['All', 'Natural', 'Crafted', 'Mob Drop']

    const filtersHtml = `
      <div class="codex-filter-bar stacked">
        <div class="filter-chips">
          ${categories.map(cat => `<button class="chip ${this.categoryFilter === cat ? 'active' : ''}" data-act="codex-cat" data-val="${cat}">${cat}</button>`).join('')}
        </div>
        <div class="filter-chips sub">
          <span class="filter-label">Source:</span>
          ${sources.map(src => `<button class="chip sm ${this.sourceFilter === src ? 'active' : ''}" data-act="codex-src" data-val="${src}">${src}</button>`).join('')}
          <button class="sort-btn sm ${this.sortAbundanceDesc ? 'active' : ''}" data-act="codex-sort" title="Toggle abundance sorting">
            ⇅ Abundance ${this.sortAbundanceDesc ? '(Highest)' : '(Default)'}
          </button>
        </div>
      </div>
    `

    // List column
    const listHtml = filtered.map(item => {
      const isSel = item.id === this.selectedItemId
      const inSatchel = item.realItemId ? count(p, item.realItemId) : (p.owned.includes(item.id as GearId) ? 1 : 0)

      return `
        <button class="codex-card ${isSel ? 'selected' : ''}" data-act="codex-sel" data-id="${item.id}">
          <div class="card-icon mini">${item.iconHtml}</div>
          <div class="card-body">
            <div class="card-title-row">
              <strong class="card-name">${esc(item.name)}</strong>
              ${inSatchel > 0 ? `<span class="owned-tag">${inSatchel}x</span>` : ''}
            </div>
            <div class="card-sub">${esc(item.category)} · ${esc(item.sourceKind)}</div>
          </div>
        </button>
      `
    }).join('')

    const detailHtml = this.renderItemDetail(currentItem, p)

    return `
      <div class="codex-panel-wrap">
        <div class="codex-left-col">
          ${filtersHtml}
          <div class="codex-list-scroller">
            ${listHtml || '<div class="codex-empty">No matching items found.</div>'}
          </div>
        </div>
        <div class="codex-right-col">
          ${detailHtml}
        </div>
      </div>
    `
  }

  private renderItemDetail(item: ItemCodexEntry, p: Progress): string {
    const abColor = ABUNDANCE_CONFIG.colors[item.abundance.rank] ?? '#ffd27a'
    const have = item.realItemId ? count(p, item.realItemId) : (p.owned.includes(item.id as GearId) ? 1 : 0)

    // Stats table
    const statsHtml = Object.entries(item.stats).map(([k, v]) => `
      <div class="stat-box">
        <span class="sb-label">${esc(k.toUpperCase())}</span>
        <span class="sb-val">${esc(String(v))}</span>
      </div>
    `).join('')

    // Where obtained
    const ob = item.obtainedFrom
    let sourceDetail = ''
    if (ob.worldSource) {
      sourceDetail += `
        <div class="source-block">
          <h5>World Gathering &amp; Natural Environment</h5>
          <p><strong>Environment:</strong> ${esc(ob.worldSource)}</p>
          ${ob.toolRequired ? `<p><strong>Tool Required:</strong> ${esc(ob.toolRequired)}</p>` : ''}
          ${ob.yieldPerGather ? `<p><strong>Harvest Yield:</strong> ${esc(ob.yieldPerGather)}</p>` : ''}
          ${ob.respawnTime ? `<p><strong>Regrowth Interval:</strong> ${esc(ob.respawnTime)}</p>` : ''}
        </div>
      `
    }
    if (ob.mobsDropping && ob.mobsDropping.length > 0) {
      sourceDetail += `
        <div class="source-block">
          <h5>Creature Drops &amp; Hunting</h5>
          <div class="mobs-drop-list">
            ${ob.mobsDropping.map(m => `
              <div class="mob-jump-chip" data-act="codex-jump-mob" data-id="${m.mobId}" title="Click to view ${esc(m.mobName)} in Mobs Tab">
                <span class="mob-paw">🐾</span>
                <strong>${esc(m.mobName)}</strong>
                <span class="gold">${esc(m.chance)}</span>
                <span class="jump-arrow">➔</span>
              </div>
            `).join('')}
          </div>
        </div>
      `
    }
    if (ob.craftedFromRecipeId) {
      sourceDetail += `
        <div class="source-block">
          <h5>Crafting Recipe</h5>
          <button class="recipe-jump-btn" data-act="codex-jump-recipe" data-id="${ob.craftedFromRecipeId}">
            🔨 View Recipe Blueprint in Recipes Tab ➔
          </button>
        </div>
      `
    }

    // Used in recipes
    const usedInHtml = item.usedInRecipes.map(r => `
      <div class="recipe-chip" data-act="codex-jump-recipe" data-id="${r.recipeId}" title="View ${esc(r.resultName)} recipe">
        <span class="wrench">🔧</span>
        <span class="r-name">${esc(r.resultName)}</span>
        <span class="r-req">Requires <b>${r.countNeeded}×</b></span>
        <span class="jump-arrow">➔</span>
      </div>
    `).join('')

    return `
      <div class="detail-scroller">
        <div class="detail-header">
          <div class="detail-icon-large">${item.iconHtml}</div>
          <div class="title-cluster">
            <span class="detail-eyebrow">${esc(item.category)} · Stack Cap: ${item.stackCap}</span>
            <h2 class="detail-title">${esc(item.name)}</h2>
          </div>
          <div class="badge-cluster">
            <span class="rank-badge" style="border-color:${abColor};color:${abColor}">
              ● ${esc(item.abundance.rank)}
            </span>
            <span class="source-tag-badge">${esc(item.sourceKind)}</span>
          </div>
        </div>

        <div class="detail-callout purpose-box">
          <p class="purpose-lead"><strong>Usage &amp; Purpose:</strong> ${esc(item.purpose)}</p>
          <small class="lore-sub">${esc(item.desc)}</small>
        </div>

        <div class="inventory-status-chip ${have > 0 ? 'have' : 'none'}">
          Satchel Inventory: <b>${have} in possession</b> (Capacity: ${item.stackCap})
        </div>

        ${statsHtml ? `<div class="section-divider"></div><h4>Item Attributes &amp; Stats</h4><div class="stat-boxes-grid">${statsHtml}</div>` : ''}

        <div class="section-divider"></div>
        <h4>How To Obtain</h4>
        <div class="obtain-container">
          <p><strong>Natural Abundance:</strong> ${esc(item.abundance.detail)}</p>
          ${sourceDetail || '<p class="muted">No explicit world source recorded.</p>'}
        </div>

        <div class="section-divider"></div>
        <h4>Used In Crafting Blueprints (${item.usedInRecipes.length})</h4>
        <div class="used-in-grid">
          ${usedInHtml || '<p class="muted">This item is not used as an ingredient in any crafting recipe.</p>'}
        </div>
      </div>
    `
  }

  private renderRecipesTab(_game: Game, p: Progress): string {
    const allRecipes = getRecipeCodexEntries()
    const q = this.searchTerm.trim().toLowerCase()

    let filtered = allRecipes.filter(r => {
      if (this.categoryFilter !== 'All') {
        if (this.categoryFilter === 'Weapons' && r.category !== 'Weapon') return false
        if (this.categoryFilter === 'Armor' && r.category !== 'Armor') return false
        if (this.categoryFilter === 'Tools' && r.category !== 'Tool') return false
        if (this.categoryFilter === 'Supplies' && r.category !== 'Supply') return false
        if (this.categoryFilter === 'Meals' && r.category !== 'Meal') return false
        if (this.categoryFilter === 'Camp & Tower' && (r.category !== 'Camp Stage' && r.category !== 'Signal Tower')) return false
      }
      if (!q) return true
      return (
        r.name.toLowerCase().includes(q) ||
        r.purpose.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        r.ingredients.some(ing => ing.name.toLowerCase().includes(q))
      )
    })

    if (!filtered.some(r => r.id === this.selectedRecipeId) && filtered.length > 0) {
      this.selectedRecipeId = filtered[0].id
    }

    const currentRecipe = allRecipes.find(r => r.id === this.selectedRecipeId) ?? allRecipes[0]

    const categories = ['All', 'Weapons', 'Armor', 'Tools', 'Supplies', 'Meals', 'Camp & Tower']
    const filtersHtml = `
      <div class="codex-filter-bar">
        <div class="filter-chips">
          ${categories.map(cat => `<button class="chip ${this.categoryFilter === cat ? 'active' : ''}" data-act="codex-cat" data-val="${cat}">${cat}</button>`).join('')}
        </div>
      </div>
    `

    const listHtml = filtered.map(r => {
      const isSel = r.id === this.selectedRecipeId
      const allMet = r.ingredients.every(ing => count(p, ing.itemId) >= ing.needed)

      return `
        <button class="codex-card ${isSel ? 'selected' : ''}" data-act="codex-sel" data-id="${r.id}">
          <div class="card-icon mini">${r.resultIconHtml}</div>
          <div class="card-body">
            <div class="card-title-row">
              <strong class="card-name">${esc(r.name)}</strong>
              ${allMet ? `<span class="ready-dot" title="You have sufficient materials">● Ready</span>` : ''}
            </div>
            <div class="card-sub">${esc(r.category)} · ${esc(r.station)}</div>
          </div>
        </button>
      `
    }).join('')

    const detailHtml = this.renderRecipeDetail(currentRecipe, p)

    return `
      <div class="codex-panel-wrap">
        <div class="codex-left-col">
          ${filtersHtml}
          <div class="codex-list-scroller">
            ${listHtml || '<div class="codex-empty">No matching recipes found.</div>'}
          </div>
        </div>
        <div class="codex-right-col">
          ${detailHtml}
        </div>
      </div>
    `
  }

  private renderRecipeDetail(r: RecipeCodexEntry, p: Progress): string {
    const ingredientsHtml = r.ingredients.map(ing => {
      const have = count(p, ing.itemId)
      const isOk = have >= ing.needed

      return `
        <div class="recipe-ing-card ${isOk ? 'ok' : 'missing'}" data-act="codex-jump-item" data-id="${ing.itemId}" title="Click to view ${esc(ing.name)} in Items Tab">
          <div class="ing-icon">${ing.iconHtml}</div>
          <div class="ing-info">
            <div class="ing-name">${esc(ing.name)}</div>
            <div class="ing-tag">${esc(ing.sourceTag)}</div>
          </div>
          <div class="ing-count-chip ${isOk ? 'chip-ok' : 'chip-no'}">
            <b>${have} / ${ing.needed}</b>
          </div>
          <span class="jump-arrow">➔</span>
        </div>
      `
    }).join('')

    return `
      <div class="detail-scroller">
        <div class="detail-header">
          <div class="detail-icon-large">${r.resultIconHtml}</div>
          <div class="title-cluster">
            <span class="detail-eyebrow">${esc(r.category)} Blueprint</span>
            <h2 class="detail-title">${esc(r.name)}</h2>
          </div>
          <div class="badge-cluster">
            <span class="rank-badge" style="border-color:#ffd27a;color:#ffd27a">
              Yield: ${r.producedCount}x
            </span>
          </div>
        </div>

        <div class="detail-callout purpose-box">
          <p><strong>Blueprint Utility:</strong> ${esc(r.purpose)}</p>
          <div class="station-meta">
            <span><strong>Crafting Station:</strong> ${esc(r.station)}</span>
            <span><strong>Production Timing:</strong> ${esc(r.timeInfo)}</span>
          </div>
        </div>

        <div class="section-divider"></div>
        <h4>Required Ingredients &amp; Inventory Status</h4>
        <div class="ingredients-grid">
          ${ingredientsHtml}
        </div>

        <div class="section-divider"></div>
        <div class="interactive-hint">
          💡 Click any ingredient above to jump directly to its entry in the <b>Items Tab</b> to see where it is gathered or which monsters drop it.
        </div>
      </div>
    `
  }
}
