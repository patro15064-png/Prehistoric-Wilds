import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ANIMAL_CONFIG, Animal, MeatPickup, AnimalManager } from '../src/game/animals'
import { Terrain } from '../src/game/terrain'
import { Colliders } from '../src/game/colliders'
import { newProgress } from '../src/game/rules'

describe('Passive Animal System Configuration', () => {
  it('defines all required configuration parameters', () => {
    expect(ANIMAL_CONFIG.MAX_ANIMALS).toBe(12)
    expect(ANIMAL_CONFIG.INITIAL_ANIMALS).toBe(8)
    expect(ANIMAL_CONFIG.MIN_SPAWN_DISTANCE_FROM_PLAYER).toBeGreaterThanOrEqual(30)
    expect(ANIMAL_CONFIG.SPAWN_DELAY_MIN).toBe(8)
    expect(ANIMAL_CONFIG.SPAWN_DELAY_MAX).toBe(20)
    expect(ANIMAL_CONFIG.DESPAWN_DISTANCE).toBeGreaterThanOrEqual(300)
    expect(ANIMAL_CONFIG.DETECTION_RADIUS).toBeGreaterThan(0)
    expect(ANIMAL_CONFIG.SAFE_DISTANCE).toBeGreaterThan(ANIMAL_CONFIG.DETECTION_RADIUS)
    expect(ANIMAL_CONFIG.RAW_MEAT_HUNGER).toBe(15)
    expect(ANIMAL_CONFIG.COOKED_MEAT_HUNGER).toBe(35)
    expect(ANIMAL_CONFIG.MEAT_DESPAWN_TIME).toBe(60)
  })

  it('configures 3 passive animal types with correct stats and meat drops', () => {
    const { rabbit, deer, bird } = ANIMAL_CONFIG.TYPES

    // Rabbit: small, fast, 1 HP, drops 1 raw meat, flee speed high
    expect(rabbit.hp).toBe(1)
    expect(rabbit.meat).toBe(1)
    expect(rabbit.fleeSpeed).toBeGreaterThan(rabbit.speed)
    expect(rabbit.radius).toBeLessThan(deer.radius)

    // Deer: medium, 3 HP, drops 3 raw meat, flee speed medium-high
    expect(deer.hp).toBe(3)
    expect(deer.meat).toBe(3)
    expect(deer.fleeSpeed).toBeGreaterThan(deer.speed)
    expect(deer.height).toBeGreaterThan(rabbit.height)

    // Wild bird: small, 1 HP, drops 1 raw meat, flee speed medium
    expect(bird.hp).toBe(1)
    expect(bird.meat).toBe(1)
    expect(bird.fleeSpeed).toBeGreaterThan(bird.speed)
  })
})

describe('Passive Animal Behavior & State Machine', () => {
  const terrain = new Terrain()
  const colliders = new Colliders()

  it('creates rabbit, deer, and bird with their visual meshes', () => {
    const r = new Animal(1, 'rabbit', 0, 0, terrain)
    expect(r.root.children.length).toBeGreaterThan(0)
    expect(r.state).toBe('IDLE')
    expect(r.hp).toBe(1)

    const d = new Animal(2, 'deer', 10, 10, terrain)
    expect(d.root.children.length).toBeGreaterThan(0)
    expect(d.hp).toBe(3)

    const b = new Animal(3, 'bird', 20, 20, terrain)
    expect(b.root.children.length).toBeGreaterThan(0)
    expect(b.hp).toBe(1)

    r.dispose()
    d.dispose()
    b.dispose()
  })

  it('triggers FLEE state when player is within detection radius', () => {
    const a = new Animal(1, 'rabbit', 0, 0, terrain)
    expect(a.state).toBe('IDLE')

    // Player far away -> stays IDLE
    const farPlayer = new THREE.Vector3(100, 0, 100)
    a.update(0.1, farPlayer, terrain, colliders)
    expect(a.state).toBe('IDLE')

    // Player enters detection radius -> switches to FLEE
    const closePlayer = new THREE.Vector3(2, 0, 2)
    a.update(0.1, closePlayer, terrain, colliders)
    expect(a.state).toBe('FLEE')

    a.dispose()
  })

  it('calms down from FLEE to WANDER when player is beyond safe distance for 2s', () => {
    const a = new Animal(1, 'deer', 0, 0, terrain)
    const closePlayer = new THREE.Vector3(2, 0, 2)
    a.update(0.1, closePlayer, terrain, colliders)
    expect(a.state).toBe('FLEE')

    // Move player far away
    const safePlayer = new THREE.Vector3(80, 0, 80)
    a.update(1.0, safePlayer, terrain, colliders)
    expect(a.state).toBe('FLEE') // Still calming down (< 2s)

    a.update(1.5, safePlayer, terrain, colliders) // Total > 2s safe
    expect(a.state).toBe('WANDER')

    a.dispose()
  })

  it('enters DEAD state and triggers tumble animation at 0 HP', () => {
    const a = new Animal(1, 'rabbit', 0, 0, terrain)
    const strikerPos = new THREE.Vector3(1, 0, 1)

    a.takeDamage(1, strikerPos)
    expect(a.hp).toBe(0)
    expect(a.state).toBe('DEAD')

    // Step through death animation
    a.update(0.6, strikerPos, terrain, colliders)
    expect(a.deadComplete).toBe(true)

    a.dispose()
  })
})

describe('Meat Drops & Hunger Restoration', () => {
  it('creates meat pickup that bobs and tracks despawn timer', () => {
    const pickup = new MeatPickup(10, 5, 10, 2)
    expect(pickup.amount).toBe(2)
    expect(pickup.collected).toBe(false)

    // Updating keeps it alive
    const alive1 = pickup.update(1.0, 5)
    expect(alive1).toBe(true)

    // At 60 seconds it despawns
    const alive2 = pickup.update(60.0, 5)
    expect(alive2).toBe(false)

    pickup.dispose()
  })

  it('collecting meat restores RAW_MEAT_HUNGER up to cap of 100 without exceeding', () => {
    const terrain = new Terrain()
    const colliders = new Colliders()
    const audio = { play: () => {} } as any
    const fx = { sparks: () => {}, dustPuff: () => {}, hitstop: () => {} } as any
    const popups: string[] = []
    const hooks = {
      popup: (t: string) => popups.push(t),
      loot: () => {},
      toast: () => {},
    }

    const manager = new AnimalManager(terrain, colliders, audio, fx, hooks)
    const p = newProgress()
    p.hunger = 40

    const pickup = new MeatPickup(0, 0, 0, 1)
    const playerPos = new THREE.Vector3(0, 0, 0)

    manager.collectPickup(pickup, p, playerPos)

    expect(p.inv.meat).toBe(1)
    expect(p.hunger).toBe(55) // 40 + 15 = 55
    expect(popups).toContain('+15 Hunger')

    // Test cap at 100
    p.hunger = 95
    const pickup2 = new MeatPickup(0, 0, 0, 1)
    manager.collectPickup(pickup2, p, playerPos)
    expect(p.hunger).toBe(100) // Clamped at 100, not 110
    expect(popups).toContain('+5 Hunger')
  })
})

describe('Animal Manager Spawning & Population Cap', () => {
  const terrain = new Terrain()
  const colliders = new Colliders()
  const audio = { play: () => {} } as any
  const fx = { sparks: () => {}, dustPuff: () => {}, hitstop: () => {} } as any
  const hooks = { popup: () => {}, loot: () => {}, toast: () => {} }
  const playerPos = new THREE.Vector3(24, terrain.heightAt(24, 48), 48)

  it('spawns initial batch and respects MAX_ANIMALS cap of 12', () => {
    const manager = new AnimalManager(terrain, colliders, audio, fx, hooks)
    manager.spawnInitialBatch(playerPos)

    expect(manager.animals.length).toBeLessThanOrEqual(ANIMAL_CONFIG.MAX_ANIMALS)
    expect(manager.animals.length).toBe(ANIMAL_CONFIG.INITIAL_ANIMALS)

    // Animals must be at or beyond MIN_SPAWN_DISTANCE_FROM_PLAYER
    for (const a of manager.animals) {
      const d = Math.hypot(a.pos.x - playerPos.x, a.pos.z - playerPos.z)
      expect(d).toBeGreaterThanOrEqual(ANIMAL_CONFIG.MIN_SPAWN_DISTANCE_FROM_PLAYER - 1)
    }

    manager.reset()
    expect(manager.animals.length).toBe(0)
  })

  it('damages animal on strike and drops meat on death', () => {
    const manager = new AnimalManager(terrain, colliders, audio, fx, hooks)
    // Manually add one rabbit directly in front of player (yaw 0 is +z)
    const rabbit = new Animal(99, 'rabbit', 24, 49.5, terrain)
    manager.animals.push(rabbit)
    manager.group.add(rabbit.root)

    // Strike near rabbit
    const hit = manager.strike(10, 1, false, playerPos, 0, 3, 1)
    expect(hit).toBe(true)
    expect(rabbit.hp).toBe(0)
    expect(rabbit.state).toBe('DEAD')

    // Step death animation with observer at 3m distance so walk-over doesn't immediately consume it
    const observePos = new THREE.Vector3(24, terrain.heightAt(24, 46), 46)
    manager.update(0.7, observePos, newProgress())
    expect(manager.pickups.length).toBe(1)
    expect(manager.pickups[0].amount).toBe(1)

    // Now walk over it to collect
    const p = newProgress()
    manager.update(0.1, new THREE.Vector3(24, terrain.heightAt(24, 49.5), 49.5), p)
    expect(p.inv.meat).toBe(1)
    expect(manager.pickups.length).toBe(0)

    manager.reset()
  })
})
