import { describe, expect, it } from 'vitest'
import { CAMP_STAGES, HARVEST_POWER, HELD_ORDER, RECIPES, RESOURCES, SPECIES, TOWER_COST, type Cost, type HeldId, type ItemId } from '../src/game/data'
import {
  add, canHold, carveLoot, count, craft, gearStats, heldAttack, hold, nextHeld, hitDamage, newProgress, objective, OBJECTIVE_IDS, parseProgress,
  recipeState, restoreTower, takenDamage, towerState, upgradeCamp, type Progress,
} from '../src/game/rules'

const give = (p: Progress, cost: Cost) => {
  for (const [id, n] of Object.entries(cost) as [ItemId, number][]) add(p, id, n)
}
const recipe = (id: string) => RECIPES.find(r => r.id === id)!

describe('expedition rules', () => {
  it('starts with a ruined camp, a club and three poultices', () => {
    const p = newProgress()
    expect(p.campStage).toBe(0)
    expect(p.weapon).toBe('club')
    expect(count(p, 'poultice')).toBe(3)
    expect(objective(p).id).toBe('hearth')
    expect(objective(p).target).toEqual({ type: 'resource', kind: 'tree' })
    expect(p.held).toBe('weapon')
  })

  it('locks recipes behind camp stages and consumes exact materials', () => {
    const p = newProgress()
    give(p, recipe('flintMaul').cost)
    expect(recipeState(p, recipe('flintMaul'))).toBe('locked')
    expect(craft(p, 'flintMaul').ok).toBe(false)
    give(p, CAMP_STAGES[0].cost)
    expect(upgradeCamp(p).ok).toBe(true)
    expect(p.campStage).toBe(1)
    expect(craft(p, 'flintMaul')).toEqual({ ok: true, message: 'Crafted Flint Maul' })
    expect(p.weapon).toBe('flintMaul')
    expect(count(p, 'hogTusk')).toBe(0)
    expect(craft(p, 'flintMaul').ok).toBe(false)
    expect(gearStats(p).attack).toBe(19)
  })

  it('caps the poultice pouch', () => {
    const p = newProgress()
    p.campStage = 1
    add(p, 'poultice', 10)
    expect(count(p, 'poultice')).toBe(5)
    give(p, recipe('poultice').cost)
    expect(recipeState(p, recipe('poultice'))).toBe('full')
  })

  it('walks the whole objective chain from ruined camp to victory', () => {
    const p = newProgress()
    const seen: string[] = []
    const note = () => {
      const id = objective(p).id
      if (seen.at(-1) !== id) seen.push(id)
    }
    note()
    give(p, CAMP_STAGES[0].cost); expect(objective(p).ready).toBe(true); upgradeCamp(p); note()
    give(p, recipe('flintHatchet').cost); expect(craft(p, 'flintHatchet').ok).toBe(true); note()
    give(p, recipe('flintMaul').cost); craft(p, 'flintMaul'); note()
    give(p, recipe('hideGarb').cost); craft(p, 'hideGarb'); note()
    give(p, CAMP_STAGES[1].cost); upgradeCamp(p); note()
    give(p, recipe('flintPick').cost); craft(p, 'flintPick'); note()
    expect(gearStats(p).canMine).toBe(true)
    give(p, recipe('amberHammer').cost); craft(p, 'amberHammer'); note()
    expect(objective(p).target).toEqual({ type: 'species', species: 'ruinhorn' })
    p.bosses.ruinhorn = true
    for (let c = 0; c < 3; c += 1) give(p, carveLoot('ruinhorn', c, 0.5) as Cost)
    note()
    expect(count(p, 'ruinCrest')).toBe(1)
    expect(count(p, 'ruinPlate')).toBe(4)
    give(p, { stone: 12, amber: 6, stalkerClaw: 3 }); upgradeCamp(p); note()
    expect(p.campStage).toBe(3)
    expect(towerState(p)).toBe('missing')
    give(p, { ashfangPelt: 2, fiber: 4 }); craft(p, 'ashguardMantle'); note()
    expect(gearStats(p).heatProof).toBe(true)
    give(p, { obsidian: 5, emberCarapace: 2 }); craft(p, 'obsidianClub'); note()
    expect(objective(p).target).toEqual({ type: 'species', species: 'vulkarr' })
    p.bosses.vulkarr = true
    give(p, carveLoot('vulkarr', 0, 0.5) as Cost); note()
    const tower = { ...TOWER_COST }
    delete tower.ruinCrest
    delete tower.magmaHeart
    give(p, tower)
    expect(towerState(p)).toBe('ready')
    expect(restoreTower(p).ok).toBe(true)
    note()
    expect(seen).toEqual([...OBJECTIVE_IDS, 'victory'])
  })

  it('lets optional gear be skipped once a later milestone is reached', () => {
    const p = newProgress()
    p.campStage = 2
    expect(objective(p).id).toBe('pick')
  })

  it('rewards punishing and softens hits with armour', () => {
    expect(hitDamage(20, 1.5, true)).toBeGreaterThan(hitDamage(20, 1.5, false))
    expect(takenDamage(30, 0)).toBe(30)
    expect(takenDamage(30, 0.38)).toBe(19)
    expect(takenDamage(1, 0.9)).toBe(1)
  })

  it('guarantees the signature part on the first carve of every small species', () => {
    for (const s of Object.values(SPECIES)) {
      if (s.boss) continue
      expect(carveLoot(s.id, 0, 0.99)).toEqual({ [s.drops[0].item]: 1 })
      expect(Object.keys(carveLoot(s.id, 1, 0.99))).toHaveLength(1)
    }
  })

  it('round-trips and sanitises saved progress', () => {
    const p = newProgress()
    give(p, CAMP_STAGES[0].cost)
    upgradeCamp(p)
    add(p, 'bone', 7)
    const back = parseProgress(JSON.stringify(p))!
    expect(back).toEqual(p)
    expect(parseProgress('nope')).toBeNull()
    expect(parseProgress(JSON.stringify({ version: 2 }))).toBeNull()
    const hacked = parseProgress(JSON.stringify({ version: 1, inv: { bone: 1e9, fake: 3 }, owned: ['obsidianClub', 'x'], weapon: 'obsidianClub', campStage: 9, towerRestored: true }))!
    expect(hacked.inv.bone).toBe(99)
    expect('fake' in hacked.inv).toBe(false)
    expect(hacked.weapon).toBe('obsidianClub')
    expect(hacked.campStage).toBe(0)
    expect(hacked.towerRestored).toBe(false)
  })

  it('only lets crafted tools be held, and cycles past missing ones', () => {
    const p = newProgress()
    expect(canHold(p, 'weapon')).toBe(true)
    expect(canHold(p, 'hands')).toBe(true)
    expect(canHold(p, 'flintHatchet')).toBe(false)
    expect(hold(p, 'flintPick')).toBe(false)
    expect(p.held).toBe('weapon')
    expect(nextHeld(p)).toBe('hands')
    expect(canHold(p, 'bogus' as HeldId)).toBe(false)
    p.owned.push('flintHatchet')
    expect(nextHeld(p)).toBe('flintHatchet')
    expect(hold(p, 'hands')).toBe(true)
    expect(heldAttack(p)).toBeLessThan(heldAttack({ ...p, held: 'weapon' }))
    expect(nextHeld(p)).toBe('weapon')
  })

  it('makes the hatchet fastest on trees and the pick fastest on rock, with hands slowest', () => {
    const swings = (h: HeldId, k: 'tree' | 'rock') => Math.ceil(RESOURCES[k].hp / HARVEST_POWER[h][k])
    for (const h of HELD_ORDER) {
      expect(swings(h, 'tree')).toBeGreaterThanOrEqual(swings('flintHatchet', 'tree'))
      expect(swings(h, 'rock')).toBeGreaterThanOrEqual(swings('flintPick', 'rock'))
      expect(swings('hands', 'tree')).toBeGreaterThanOrEqual(swings(h, 'tree'))
      expect(swings('hands', 'rock')).toBeGreaterThanOrEqual(swings(h, 'rock'))
      // Everything can harvest everything, bare hands included.
      expect(swings(h, 'tree')).toBeLessThan(30)
      expect(swings(h, 'rock')).toBeLessThan(30)
    }
    expect(swings('flintHatchet', 'tree')).toBeLessThanOrEqual(3)
    expect(swings('flintPick', 'rock')).toBeLessThanOrEqual(3)
  })

  it('keeps a saved held tool only if it is owned', () => {
    const p = newProgress()
    const bad = parseProgress(JSON.stringify({ ...p, held: 'flintPick' }))!
    expect(bad.held).toBe('weapon')
    const ok = parseProgress(JSON.stringify({ ...p, owned: [...p.owned, 'flintPick'], held: 'flintPick' }))!
    expect(ok.held).toBe('flintPick')
    const junk = parseProgress(JSON.stringify({ ...p, held: 42 }))!
    expect(junk.held).toBe('weapon')
  })
})
