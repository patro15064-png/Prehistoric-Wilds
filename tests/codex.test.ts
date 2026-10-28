import { describe, expect, it } from 'vitest'
import {
  CodexManager,
  getItemCodexEntries,
  getMobCodexEntries,
  getRecipeCodexEntries,
} from '../src/game/codex'
import {
  CAMP_STAGES,
  GEAR,
  ITEMS,
  MEALS,
  RECIPES,
  SPECIES,
  type SpeciesDef,
} from '../src/game/data'
import { ANIMAL_CONFIG } from '../src/game/animals'

describe('In-Game Codex System', () => {
  describe('Mob Registry & Details', () => {
    it('registers every hostile species and passive animal from source data', () => {
      const mobs = getMobCodexEntries()
      const hostileIds = Object.keys(SPECIES)
      const passiveIds = Object.keys(ANIMAL_CONFIG.TYPES)
      const expectedTotal = hostileIds.length + passiveIds.length

      expect(mobs.length).toBe(expectedTotal)

      // Ensure every single ID from SPECIES and ANIMAL_CONFIG is represented
      for (const hid of hostileIds) {
        expect(mobs.some(m => m.id === hid && m.kind === 'hostile')).toBe(true)
      }
      for (const pid of passiveIds) {
        expect(mobs.some(m => m.id === pid && m.kind === 'passive')).toBe(true)
      }
    })

    it('populates correct temperament, stats, and attacks for each mob', () => {
      const mobs = getMobCodexEntries()

      for (const m of mobs) {
        expect(['HOSTILE', 'PASSIVE', 'NEUTRAL']).toContain(m.temperament)
        expect(m.hp).toBeGreaterThan(0)
        expect(m.walkSpeed).toBeGreaterThan(0)
        expect(m.runSpeed).toBeGreaterThan(0)
        expect(m.detectionRange).toBeGreaterThan(0)
        expect(m.diet.length).toBeGreaterThan(0)
        expect(m.purpose.length).toBeGreaterThan(0)
        expect(m.habitat.length).toBeGreaterThan(0)
        expect(m.attacks.length).toBeGreaterThan(0)
        expect(m.abundance.rank.length).toBeGreaterThan(0)

        if (m.temperament === 'PASSIVE') {
          expect(m.attacks[0].damage).toBe(0)
          expect(m.attacks[0].name).toContain('Does not attack')
          expect(m.fleeSpeed).toBeGreaterThan(0)
          expect(m.huntingInfo.canHuntForFood).toBe(true)
        } else {
          expect(m.attacks.some(a => a.damage > 0)).toBe(true)
        }
      }
    })

    it('calculates abundance with correct rankings and real numbers', () => {
      const mobs = getMobCodexEntries()
      const ruinhorn = mobs.find(m => m.id === 'ruinhorn')!
      const vulkarr = mobs.find(m => m.id === 'vulkarr')!
      const rabbit = mobs.find(m => m.id === 'rabbit')!
      const tuskhog = mobs.find(m => m.id === 'tuskhog')!

      expect(ruinhorn.abundance.rank).toBe('VERY RARE')
      expect(ruinhorn.abundance.detail).toContain('Apex')
      expect(vulkarr.abundance.rank).toBe('VERY RARE')

      expect(rabbit.abundance.rank).toBe('VERY COMMON')
      expect(rabbit.abundance.detail).toContain('Spawn weight 5')

      expect(tuskhog.abundance.rank).toBe('COMMON')
      expect(tuskhog.abundance.detail).toContain('11 on map')
    })
  })

  describe('Item & Resource Registry', () => {
    it('registers every material, part, gear item, and hearth meal', () => {
      const items = getItemCodexEntries()
      const totalExpected = Object.keys(ITEMS).length + Object.keys(GEAR).length + Object.keys(MEALS).length

      expect(items.length).toBe(totalExpected)

      // Spot check essential items
      const wood = items.find(i => i.id === 'wood')!
      const stone = items.find(i => i.id === 'stone')!
      const meat = items.find(i => i.id === 'meat')!
      const boneSpear = items.find(i => i.id === 'boneSpear')!
      const heartyHaunch = items.find(i => i.id === 'heartyHaunch')!

      expect(wood).toBeDefined()
      expect(wood.sourceKind).toBe('NATURAL')
      expect(wood.abundance.rank).toBe('VERY COMMON')
      expect(wood.obtainedFrom.toolRequired).toContain('Hatchet')

      expect(stone).toBeDefined()
      expect(stone.obtainedFrom.toolRequired).toContain('Pick')

      expect(meat).toBeDefined()
      expect(meat.sourceKind).toBe('COMBINATION')
      expect(meat.obtainedFrom.mobsDropping?.length).toBeGreaterThanOrEqual(7)

      expect(boneSpear).toBeDefined()
      expect(boneSpear.category).toBe('Weapon')
      expect(boneSpear.stats['Attack Power']).toBe(17)

      expect(heartyHaunch).toBeDefined()
      expect(heartyHaunch.category).toBe('Hearth Meal')
      expect(heartyHaunch.stats['Health Buff']).toBe('+25 Max HP')
    })

    it('identifies recipes where each item is used as an ingredient', () => {
      const items = getItemCodexEntries()
      const wood = items.find(i => i.id === 'wood')!
      const herb = items.find(i => i.id === 'herb')!
      const ruinCrest = items.find(i => i.id === 'ruinCrest')!

      expect(wood.usedInRecipes.length).toBeGreaterThanOrEqual(5)
      expect(wood.usedInRecipes.some(r => r.recipeId === 'snare')).toBe(true)

      expect(herb.usedInRecipes.some(r => r.recipeId === 'poultice')).toBe(true)
      expect(ruinCrest.usedInRecipes.some(r => r.recipeId === 'tower')).toBe(true)
    })
  })

  describe('Recipe Registry', () => {
    it('registers all crafting blueprints, meals, camp stages, and tower restoration', () => {
      const recipes = getRecipeCodexEntries()
      const expectedTotal = RECIPES.length + Object.keys(MEALS).length + CAMP_STAGES.length + 1 // +1 for tower

      expect(recipes.length).toBe(expectedTotal)

      for (const r of recipes) {
        expect(r.name.length).toBeGreaterThan(0)
        expect(r.purpose.length).toBeGreaterThan(0)
        expect(r.ingredients.length).toBeGreaterThan(0)
        expect(r.station.length).toBeGreaterThan(0)

        // Ensure all ingredients are valid items
        for (const ing of r.ingredients) {
          expect(ing.needed).toBeGreaterThan(0)
          expect(ing.name.length).toBeGreaterThan(0)
          expect(ing.itemId in ITEMS).toBe(true)
        }
      }
    })
  })

  describe('Navigation & Cross-referencing', () => {
    it('switches tabs and targets specific entries on cross-link jumps', () => {
      const codex = new CodexManager()
      expect(codex.activeTab).toBe('mobs')

      codex.selectItem('amber')
      expect(codex.activeTab).toBe('items')
      expect(codex.selectedItemId).toBe('amber')

      codex.selectRecipe('tower')
      expect(codex.activeTab).toBe('recipes')
      expect(codex.selectedRecipeId).toBe('tower')

      codex.selectMob('vulkarr')
      expect(codex.activeTab).toBe('mobs')
      expect(codex.selectedMobId).toBe('vulkarr')
    })

    it('sorts entries by abundance ranking', () => {
      const items = getItemCodexEntries()
      const sorted = [...items].sort((a, b) => b.abundance.numericScore - a.abundance.numericScore)

      expect(sorted[0].abundance.numericScore).toBeGreaterThanOrEqual(sorted[sorted.length - 1].abundance.numericScore)
      expect(sorted[0].abundance.rank).toBe('VERY COMMON')
    })
  })

  describe('Data Auto-discovery', () => {
    it('automatically includes newly added game definitions', () => {
      const initialCount = getMobCodexEntries().length

      // Temporarily mock an extra species definition
      const testSpeciesId = '__test_beast__' as any
      ;(SPECIES as any)[testSpeciesId] = {
        id: testSpeciesId,
        name: 'Test Beast',
        title: 'Experimental Fauna',
        region: 'coast',
        boss: false,
        hp: 99,
        poise: 20,
        walk: 2,
        run: 5,
        turn: 4,
        radius: 1,
        height: 1,
        aggro: 10,
        leash: 30,
        carves: 1,
        palette: ['#000'],
        lore: 'A mysterious test creature.',
        weak: { zone: 'head', mult: 1.5, label: 'Head' },
        habitat: 'Coastal laboratory',
        attacks: [{ id: 'test_atk', name: 'Nip', desc: 'A test nip', anim: 'bite', range: [0, 2], windup: 0.5, active: 0.2, recovery: 0.5, damage: 5, knock: 'flinch', shape: { kind: 'cone', radius: 2, angle: 90 }, weight: 1, cooldown: 1, tracking: 0.5 }],
        drops: [{ item: 'wood', weight: 1 }],
      } as SpeciesDef

      try {
        const updatedMobs = getMobCodexEntries()
        expect(updatedMobs.length).toBe(initialCount + 1)
        expect(updatedMobs.some(m => m.id === testSpeciesId && m.name === 'Test Beast')).toBe(true)
      } finally {
        delete (SPECIES as any)[testSpeciesId]
      }

      // Ensure cleaned up
      expect(getMobCodexEntries().length).toBe(initialCount)
    })
  })
})
