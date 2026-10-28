import { describe, expect, it } from 'vitest'
import { GEAR, ITEM_SOURCE, MEALS, MEAL_ORDER, RECIPES, SPECIES, TRACKING, WEAPON_CLASSES, type Cost, type ItemId, type SpeciesId } from '../src/game/data'
import {
  add, addClue, clearTrack, cook, cookState, count, craft, equip, gearStats, isTracked, knowledge, mealBuff, newProgress, nextGadget,
  noteHunt, notePart, noteSeen, parseProgress, tickMeal, useGadget, weaponClass, type Progress,
} from '../src/game/rules'

const give = (p: Progress, cost: Cost) => {
  for (const [id, n] of Object.entries(cost) as [ItemId, number][]) add(p, id, n)
}

describe('hearth cooking', () => {
  it('is locked until camp stage 1 and needs ingredients', () => {
    const p = newProgress()
    expect(cookState(p, 'heartyHaunch')).toBe('locked')
    p.campStage = 1
    expect(cookState(p, 'heartyHaunch')).toBe('missing')
    give(p, MEALS.heartyHaunch.cost)
    expect(cookState(p, 'heartyHaunch')).toBe('ready')
    expect(cookState(p, 'brimstoneSkewer')).toBe('locked')
  })
  it('spends ingredients, applies the buff, and scales duration by sear quality', () => {
    const durations: Record<string, number> = {}
    for (const q of ['charred', 'good', 'perfect'] as const) {
      const p = newProgress()
      p.campStage = 2
      give(p, MEALS.trailStew.cost)
      expect(cook(p, 'trailStew', q).ok).toBe(true)
      for (const [id] of Object.entries(MEALS.trailStew.cost) as [ItemId, number][]) expect(count(p, id)).toBe(0)
      durations[q] = p.meal!.max
      expect(mealBuff(p)).toEqual(MEALS.trailStew.buff)
    }
    expect(durations.perfect).toBeGreaterThan(durations.good)
    expect(durations.good).toBeGreaterThan(durations.charred)
  })
  it('meal buffs feed gear stats and expire', () => {
    const p = newProgress()
    p.campStage = 1
    const base = gearStats(p)
    give(p, MEALS.trailStew.cost)
    cook(p, 'trailStew', 'good')
    expect(gearStats(p).maxStamina).toBeGreaterThan(base.maxStamina)
    expect(tickMeal(p, 1)).toBe(false)
    expect(tickMeal(p, 10_000)).toBe(true)
    expect(p.meal).toBeNull()
    expect(gearStats(p).maxStamina).toBe(base.maxStamina)
  })
  it('every meal is cookable from obtainable items', () => {
    const obtainable = new Set<string>(Object.keys(ITEM_SOURCE))
    for (const sp of Object.values(SPECIES)) {
      for (const d of sp.drops) obtainable.add(d.item)
      for (const c of sp.bossCarves ?? []) for (const k of Object.keys(c)) obtainable.add(k)
    }
    for (const id of MEAL_ORDER) for (const it of Object.keys(MEALS[id].cost)) expect(obtainable.has(it), `${id} needs ${it}`).toBe(true)
  })
})

describe('traps and throwables', () => {
  it('gadget recipes produce stackable items that are consumed on use', () => {
    const p = newProgress()
    p.campStage = 2
    for (const id of ['snare', 'flashPod', 'pitfall']) {
      const r = RECIPES.find(x => x.id === id)!
      give(p, r.cost)
      expect(craft(p, r.id).ok).toBe(true)
    }
    expect(count(p, 'snare')).toBe(1)
    p.gadget = 'snare'
    expect(useGadget(p)).toBe(true)
    expect(useGadget(p)).toBe(false)
    expect(nextGadget(p)).toBe('pitfall')
    useGadget(p, 'pitfall')
    expect(nextGadget(p)).toBe('flashPod')
  })
})

describe('weapon classes', () => {
  it('every weapon has a class with a defined moveset', () => {
    for (const g of Object.values(GEAR)) if (g.slot === 'weapon') expect(WEAPON_CLASSES[weaponClass(g.id)]).toBeTruthy()
    expect(weaponClass('club')).toBe('club')
    expect(weaponClass('boneSpear')).toBe('spear')
    expect(weaponClass('reedSling')).toBe('sling')
  })
  it('crafted spear and sling can be equipped', () => {
    const p = newProgress()
    p.campStage = 3
    for (const id of ['boneSpear', 'reedSling'] as const) {
      const r = RECIPES.find(x => x.gear === id)!
      give(p, r.cost)
      expect(craft(p, r.id).ok).toBe(true)
      expect(equip(p, id)).toBe(true)
      expect(p.weapon).toBe(id)
    }
  })
})

describe('tracking and the journal', () => {
  it('three clues track a beast; hunting clears the trail and a new trail re-tracks', () => {
    const p = newProgress()
    const sp: SpeciesId = 'tuskhog'
    expect(addClue(p, sp).tracked).toBe(false)
    expect(addClue(p, sp).tracked).toBe(false)
    expect(addClue(p, sp).tracked).toBe(true)
    expect(isTracked(p, sp)).toBe(true)
    expect(addClue(p, sp).tracked).toBe(false)
    clearTrack(p, sp)
    expect(isTracked(p, sp)).toBe(false)
    for (let i = 1; i < TRACKING.cluesNeeded; i += 1) addClue(p, sp)
    expect(addClue(p, sp).tracked).toBe(true)
  })
  it('knowledge unlocks in layers: seen, weak spot, hunted, exact rates', () => {
    const p = newProgress()
    const sp: SpeciesId = 'dunestalker'
    expect(knowledge(p, sp).seen).toBe(false)
    expect(noteSeen(p, sp)).toBe(true)
    expect(noteSeen(p, sp)).toBe(false)
    expect(knowledge(p, sp).weak).toBe(false)
    p.hunts[sp] = 1
    noteHunt(p, sp, 95)
    expect(notePart(p, sp, SPECIES[sp].drops[0].item)).toBe(true)
    expect(notePart(p, sp, SPECIES[sp].drops[0].item)).toBe(false)
    let k = knowledge(p, sp)
    expect(k.hunted && k.weak && !k.exact).toBe(true)
    expect(k.best).toBe(95)
    p.hunts[sp] = 3
    noteHunt(p, sp, 120)
    k = knowledge(p, sp)
    expect(k.exact).toBe(true)
    expect(k.best).toBe(95)
  })
  it('meals, gadgets and the journal survive save round-trips', () => {
    const p = newProgress()
    p.campStage = 1
    give(p, MEALS.heartyHaunch.cost)
    cook(p, 'heartyHaunch', 'perfect')
    add(p, 'flashPod', 2)
    p.gadget = 'flashPod'
    addClue(p, 'ashfang')
    const q = parseProgress(JSON.stringify(p))!
    expect(q.meal?.id).toBe('heartyHaunch')
    expect(q.meal?.q).toBe('perfect')
    expect(q.gadget).toBe('flashPod')
    expect(count(q, 'flashPod')).toBe(2)
    expect(q.journal.ashfang?.clues).toBe(1)
  })
})
