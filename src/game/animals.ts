import * as THREE from 'three'
import type { Colliders } from './colliders'
import type { Terrain, RegionId } from './terrain'
import type { Audio } from '../engine/audio'
import type { Fx } from './fx'
import type { Progress } from './rules'
import { add } from './rules'
import { ITEMS, type ItemId } from './data'

/**
 * ============================================================================
 * 7. CONFIGURATION — Passive Animal & Food System
 * ============================================================================
 */
export const ANIMAL_CONFIG = {
  /** Maximum number of simultaneous passive animals allowed in the world. */
  MAX_ANIMALS: 12,
  /** Initial count of passive animals spawned when the expedition begins. */
  INITIAL_ANIMALS: 8,
  /** Minimum distance from the player where animals are allowed to spawn. */
  MIN_SPAWN_DISTANCE_FROM_PLAYER: 45,
  /** Minimum delay (in seconds) before respawning a replacement animal. */
  SPAWN_DELAY_MIN: 8,
  /** Maximum delay (in seconds) before respawning a replacement animal. */
  SPAWN_DELAY_MAX: 20,
  /** Distance from player beyond which animals despawn to conserve performance. */
  DESPAWN_DISTANCE: 350,
  /** Radius around animal within which player presence triggers the FLEE state. */
  DETECTION_RADIUS: 18,
  /** Distance from player required for an animal to exit FLEE and calm down. */
  SAFE_DISTANCE: 38,
  /** Seconds animal must remain beyond SAFE_DISTANCE before returning to WANDER. */
  CALM_DOWN_TIME: 2.0,
  /** Speed multiplier applied when an animal is fleeing after being struck. */
  HIT_FLEE_MULTIPLIER: 1.3,
  /** Duration (in seconds) of the hit-speed panic boost. */
  HIT_BOOST_DURATION: 3.5,
  /** Hunger restored when raw meat is eaten upon pickup. */
  RAW_MEAT_HUNGER: 15,
  /** Reference hunger value for meals prepared at the hearth. */
  COOKED_MEAT_HUNGER: 35,
  /** Seconds before an uncollected dropped meat pickup despawns. */
  MEAT_DESPAWN_TIME: 60,

  /** Per-animal type attributes and spawn weighting. */
  TYPES: {
    rabbit: {
      id: 'rabbit' as const,
      name: 'Wild Hare',
      hp: 1,
      speed: 2.4,
      fleeSpeed: 7.2,
      meat: 1,
      radius: 0.35,
      height: 0.45,
      spawnWeight: 5,
      preferredRegions: ['coast', 'highlands'] as RegionId[],
    },
    deer: {
      id: 'deer' as const,
      name: 'Island Fallow Deer',
      hp: 3,
      speed: 2.1,
      fleeSpeed: 6.6,
      meat: 3,
      radius: 0.65,
      height: 1.35,
      spawnWeight: 2,
      preferredRegions: ['coast', 'highlands'] as RegionId[],
    },
    bird: {
      id: 'bird' as const,
      name: 'Emerald Pheasant',
      hp: 1,
      speed: 1.8,
      fleeSpeed: 5.6,
      meat: 1,
      radius: 0.32,
      height: 0.52,
      spawnWeight: 4,
      preferredRegions: ['coast', 'highlands', 'caldera'] as RegionId[],
    },
  },
} as const

export type AnimalType = keyof typeof ANIMAL_CONFIG.TYPES
export type AnimalState = 'IDLE' | 'WANDER' | 'FLEE' | 'DEAD'

/**
 * ============================================================================
 * 6. VISUAL MESH RIGS — Low-poly Three.js procedural models
 * ============================================================================
 */
function createRabbitMesh(): THREE.Group {
  const root = new THREE.Group()
  const furMat = new THREE.MeshLambertMaterial({ color: '#c49a6c' })
  const bellyMat = new THREE.MeshLambertMaterial({ color: '#f3ece2' })
  const earInnerMat = new THREE.MeshLambertMaterial({ color: '#e89da3' })
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#1a100d' })

  // Torso
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.24, 6, 5), furMat)
  body.scale.set(0.9, 0.85, 1.25)
  body.position.set(0, 0.22, 0)
  body.castShadow = true
  root.add(body)

  // Belly patch
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.21, 5, 4), bellyMat)
  belly.scale.set(0.75, 0.6, 1.0)
  belly.position.set(0, 0.16, 0.02)
  root.add(belly)

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), furMat)
  head.position.set(0, 0.32, 0.22)
  head.castShadow = true
  root.add(head)

  // Ears
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.22, 4), furMat)
    ear.position.set(side * 0.065, 0.46, 0.18)
    ear.rotation.set(-0.25, 0, side * 0.18)
    ear.scale.set(0.6, 1, 1)
    root.add(ear)

    const earIn = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 4), earInnerMat)
    earIn.position.set(side * 0.065, 0.44, 0.19)
    earIn.rotation.set(-0.25, 0, side * 0.18)
    earIn.scale.set(0.5, 1, 0.8)
    root.add(earIn)

    // Eyes
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 4, 3), eyeMat)
    eye.position.set(side * 0.11, 0.34, 0.28)
    root.add(eye)
  }

  // Fluffy tail
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.07, 5, 4), bellyMat)
  tail.position.set(0, 0.25, -0.26)
  root.add(tail)

  return root
}

function createDeerMesh(): THREE.Group {
  const root = new THREE.Group()
  const coatMat = new THREE.MeshLambertMaterial({ color: '#965223' })
  const underMat = new THREE.MeshLambertMaterial({ color: '#e8d2b8' })
  const antlerMat = new THREE.MeshLambertMaterial({ color: '#dfd4bc' })
  const hoofMat = new THREE.MeshLambertMaterial({ color: '#2b211a' })
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#0d0705' })

  // Torso
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 1.05, 6), coatMat)
  body.rotation.x = Math.PI / 2
  body.position.set(0, 0.82, 0)
  body.castShadow = true
  root.add(body)

  // Underbelly
  const belly = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.85, 5), underMat)
  belly.rotation.x = Math.PI / 2
  belly.position.set(0, 0.73, 0)
  root.add(belly)

  // Neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.19, 0.55, 5), coatMat)
  neck.position.set(0, 1.15, 0.44)
  neck.rotation.x = -0.55
  neck.castShadow = true
  root.add(neck)

  // Head
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.38, 5), coatMat)
  head.position.set(0, 1.34, 0.64)
  head.rotation.x = 1.3
  head.castShadow = true
  root.add(head)

  // Antlers
  for (const side of [-1, 1]) {
    const mainBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.42, 4), antlerMat)
    mainBeam.position.set(side * 0.1, 1.54, 0.58)
    mainBeam.rotation.set(-0.35, 0, side * 0.4)
    root.add(mainBeam)

    const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.18, 3), antlerMat)
    tine.position.set(side * 0.16, 1.62, 0.64)
    tine.rotation.set(0.3, 0, side * 0.7)
    root.add(tine)

    // Eyes
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 4, 3), eyeMat)
    eye.position.set(side * 0.11, 1.36, 0.62)
    root.add(eye)
  }

  // 4 Legs
  const legGeo = new THREE.CylinderGeometry(0.045, 0.035, 0.72, 4)
  const hoofGeo = new THREE.CylinderGeometry(0.038, 0.042, 0.08, 4)
  const legPositions = [
    [-0.18, 0.4, 0.38],
    [0.18, 0.4, 0.38],
    [-0.18, 0.4, -0.38],
    [0.18, 0.4, -0.38],
  ]

  for (const [lx, ly, lz] of legPositions) {
    const leg = new THREE.Mesh(legGeo, coatMat)
    leg.position.set(lx, ly, lz)
    leg.castShadow = true
    root.add(leg)

    const hoof = new THREE.Mesh(hoofGeo, hoofMat)
    hoof.position.set(lx, 0.04, lz)
    root.add(hoof)
  }

  // Small tail
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 4), underMat)
  tail.position.set(0, 0.88, -0.58)
  tail.rotation.x = -1.2
  root.add(tail)

  return root
}

function createBirdMesh(): THREE.Group {
  const root = new THREE.Group()
  const bodyMat = new THREE.MeshLambertMaterial({ color: '#27684d' })
  const breastMat = new THREE.MeshLambertMaterial({ color: '#9e2e21' })
  const beakMat = new THREE.MeshLambertMaterial({ color: '#f0ad35' })
  const featherMat = new THREE.MeshLambertMaterial({ color: '#684524' })
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#160c07' })

  // Plump body
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), bodyMat)
  body.scale.set(0.9, 0.95, 1.2)
  body.position.set(0, 0.3, 0)
  body.castShadow = true
  root.add(body)

  // Crimson breast
  const breast = new THREE.Mesh(new THREE.SphereGeometry(0.18, 5, 4), breastMat)
  breast.scale.set(0.75, 0.8, 0.9)
  breast.position.set(0, 0.28, 0.11)
  root.add(breast)

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 5, 4), bodyMat)
  head.position.set(0, 0.46, 0.2)
  head.castShadow = true
  root.add(head)

  // Beak
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 4), beakMat)
  beak.position.set(0, 0.44, 0.34)
  beak.rotation.x = 1.45
  root.add(beak)

  // Eyes
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 3), eyeMat)
    eye.position.set(side * 0.085, 0.47, 0.24)
    root.add(eye)

    // Wings
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.32), featherMat)
    wing.position.set(side * 0.19, 0.32, -0.02)
    wing.rotation.set(-0.2, 0, side * 0.15)
    root.add(wing)

    // Little feet
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 3), beakMat)
    leg.position.set(side * 0.08, 0.08, 0)
    root.add(leg)
  }

  // Long tail feathers
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.45), featherMat)
  tail.position.set(0, 0.33, -0.38)
  tail.rotation.x = -0.35
  root.add(tail)

  return root
}

/**
 * ============================================================================
 * 5. MEAT DROP PICKUP ITEM
 * ============================================================================
 */
export class MeatPickup {
  readonly root = new THREE.Group()
  readonly pos = new THREE.Vector3()
  private lifeTime = 0
  collected = false
  readonly amount: number

  constructor(x: number, y: number, z: number, amount: number) {
    this.pos.set(x, y, z)
    this.amount = amount
    this.root.position.copy(this.pos)

    // 3D Raw Haunch Model
    const meatMat = new THREE.MeshLambertMaterial({ color: '#cf5346' })
    const boneMat = new THREE.MeshLambertMaterial({ color: '#f3ebd4' })
    const fatMat = new THREE.MeshLambertMaterial({ color: '#faf5ea' })

    const haunchGroup = new THREE.Group()

    // Meat bulk
    const meatMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 5), meatMat)
    meatMesh.scale.set(1.1, 0.85, 1.4)
    meatMesh.castShadow = true
    haunchGroup.add(meatMesh)

    // Marbling strip
    const fatMesh = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.03, 4, 8), fatMat)
    fatMesh.rotation.x = Math.PI / 2
    fatMesh.scale.set(0.9, 1.2, 1)
    haunchGroup.add(fatMesh)

    // Bone shank sticking out
    const boneMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.34, 5), boneMat)
    boneMesh.position.set(0, 0, -0.22)
    boneMesh.rotation.x = Math.PI / 2.2
    haunchGroup.add(boneMesh)

    // Bone knuckle
    for (const sx of [-0.04, 0.04]) {
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.042, 4, 3), boneMat)
      knuckle.position.set(sx, 0.02, -0.37)
      haunchGroup.add(knuckle)
    }

    haunchGroup.position.y = 0.35
    haunchGroup.rotation.z = 0.25
    this.root.add(haunchGroup)

    // Ground glow ring
    const ringGeo = new THREE.RingGeometry(0.25, 0.52, 12)
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#ffc366',
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const ringMesh = new THREE.Mesh(ringGeo, ringMat)
    ringMesh.rotation.x = -Math.PI / 2
    ringMesh.position.y = 0.06
    this.root.add(ringMesh)
  }

  update(dt: number, groundY: number): boolean {
    this.lifeTime += dt
    if (this.lifeTime >= ANIMAL_CONFIG.MEAT_DESPAWN_TIME) {
      return false // Time to despawn
    }

    // Keep resting on terrain ground level with floating bob
    this.pos.y = groundY
    this.root.position.x = this.pos.x
    this.root.position.z = this.pos.z
    this.root.position.y = groundY

    // Floating bob & rotation
    const bob = Math.sin(this.lifeTime * 3.8) * 0.08
    const haunch = this.root.children[0]
    if (haunch) {
      haunch.position.y = 0.32 + bob
      haunch.rotation.y += dt * 1.8
    }

    // Gentle ground ring pulse
    const ring = this.root.children[1] as THREE.Mesh | undefined
    if (ring && ring.material instanceof THREE.MeshBasicMaterial) {
      ring.material.opacity = 0.4 + Math.sin(this.lifeTime * 4.5) * 0.2
    }

    return true
  }

  dispose(): void {
    this.root.traverse(o => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh
        m.geometry.dispose()
        if (Array.isArray(m.material)) m.material.forEach(mat => mat.dispose())
        else m.material.dispose()
      }
    })
  }
}

/**
 * ============================================================================
 * 3. PASSIVE ANIMAL ENTITY — State Machine (IDLE, WANDER, FLEE, DEAD)
 * ============================================================================
 */
export class Animal {
  readonly id: number
  readonly type: AnimalType
  readonly def: (typeof ANIMAL_CONFIG.TYPES)[AnimalType]
  readonly root: THREE.Group
  readonly pos = new THREE.Vector3()
  readonly vel = new THREE.Vector3()
  yaw = 0
  hp: number
  state: AnimalState = 'IDLE'

  private stateTimer = 1.5 + Math.random() * 2.0
  private wanderTarget = new THREE.Vector3()
  private calmTimer = 0
  private hitPanicTimer = 0
  private flashTimer = 0
  private deathTimer = 0
  private animPhase = Math.random() * 10
  private originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  private flashMat = new THREE.MeshBasicMaterial({ color: '#ffffff' })
  deadComplete = false

  constructor(id: number, type: AnimalType, x: number, z: number, terrain: Terrain) {
    this.id = id
    this.type = type
    this.def = ANIMAL_CONFIG.TYPES[type]
    this.hp = this.def.hp

    this.pos.set(x, terrain.heightAt(x, z), z)
    this.yaw = Math.random() * Math.PI * 2

    // Build specific procedural mesh
    if (type === 'rabbit') this.root = createRabbitMesh()
    else if (type === 'deer') this.root = createDeerMesh()
    else this.root = createBirdMesh()

    this.root.position.copy(this.pos)
    this.root.rotation.y = this.yaw

    // Cache materials for hit flash
    this.root.traverse(o => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh
        this.originalMaterials.set(m, m.material)
      }
    })
  }

  takeDamage(amount: number, fromPos: THREE.Vector3): void {
    if (this.state === 'DEAD') return
    this.hp = Math.max(0, this.hp - amount)

    // Small knockback away from striker
    const kx = this.pos.x - fromPos.x
    const kz = this.pos.z - fromPos.z
    const kd = Math.hypot(kx, kz) || 1
    this.vel.x += (kx / kd) * 4.5
    this.vel.z += (kz / kd) * 4.5

    // Visual hit flash
    this.flashTimer = 0.16

    if (this.hp <= 0) {
      this.state = 'DEAD'
      this.deathTimer = 0
    } else {
      // Panic boost and immediate flee
      this.state = 'FLEE'
      this.hitPanicTimer = ANIMAL_CONFIG.HIT_BOOST_DURATION
      this.calmTimer = 0
    }
  }

  update(dt: number, playerPos: THREE.Vector3, terrain: Terrain, colliders: Colliders): void {
    // 1. Hit Flash decay
    if (this.flashTimer > 0) {
      this.flashTimer -= dt
      const flash = this.flashTimer > 0
      this.root.traverse(o => {
        if ((o as THREE.Mesh).isMesh) {
          const m = o as THREE.Mesh
          m.material = flash ? this.flashMat : (this.originalMaterials.get(m) ?? m.material)
        }
      })
    }

    // 2. Dead state animation & removal
    if (this.state === 'DEAD') {
      this.deathTimer += dt
      // Tumble sideways onto terrain
      this.root.rotation.z = Math.min(Math.PI / 2, this.deathTimer * 3.5)
      this.root.position.y = Math.max(terrain.heightAt(this.pos.x, this.pos.z) - 0.1, this.pos.y - dt * 0.4)
      if (this.deathTimer >= 0.55) {
        this.deadComplete = true
      }
      return
    }

    const pDist = Math.hypot(this.pos.x - playerPos.x, this.pos.z - playerPos.z)
    if (this.hitPanicTimer > 0) this.hitPanicTimer -= dt

    // 3. State transitions
    switch (this.state) {
      case 'IDLE': {
        // Check for player proximity trigger
        if (pDist < ANIMAL_CONFIG.DETECTION_RADIUS) {
          this.state = 'FLEE'
          this.calmTimer = 0
          break
        }
        this.stateTimer -= dt
        if (this.stateTimer <= 0) {
          this.pickWanderTarget(terrain, colliders)
          this.state = 'WANDER'
          this.stateTimer = 4.0 + Math.random() * 4.0
        }
        break
      }

      case 'WANDER': {
        // Player approaches -> flee immediately
        if (pDist < ANIMAL_CONFIG.DETECTION_RADIUS) {
          this.state = 'FLEE'
          this.calmTimer = 0
          break
        }
        this.stateTimer -= dt
        const toTargetDist = Math.hypot(this.wanderTarget.x - this.pos.x, this.wanderTarget.z - this.pos.z)
        if (toTargetDist < 1.4 || this.stateTimer <= 0) {
          this.state = 'IDLE'
          this.stateTimer = 1.2 + Math.random() * 3.0
          this.vel.set(0, 0, 0)
        }
        break
      }

      case 'FLEE': {
        // Check if player is beyond safe distance
        if (pDist > ANIMAL_CONFIG.SAFE_DISTANCE && this.hitPanicTimer <= 0) {
          this.calmTimer += dt
          if (this.calmTimer >= ANIMAL_CONFIG.CALM_DOWN_TIME) {
            this.state = 'WANDER'
            this.pickWanderTarget(terrain, colliders)
            this.stateTimer = 3.0 + Math.random() * 3.0
            break
          }
        } else {
          this.calmTimer = 0
        }
        break
      }
    }

    // 4. Movement Physics & Steering
    let targetSpeed = 0
    let wishX = 0
    let wishZ = 0

    if (this.state === 'WANDER') {
      targetSpeed = this.def.speed
      const dx = this.wanderTarget.x - this.pos.x
      const dz = this.wanderTarget.z - this.pos.z
      const len = Math.hypot(dx, dz) || 1
      wishX = dx / len
      wishZ = dz / len
    } else if (this.state === 'FLEE') {
      const speedMult = this.hitPanicTimer > 0 ? ANIMAL_CONFIG.HIT_FLEE_MULTIPLIER : 1.0
      targetSpeed = this.def.fleeSpeed * speedMult
      // Run directly away from player
      const fx = this.pos.x - playerPos.x
      const fz = this.pos.z - playerPos.z
      const flen = Math.hypot(fx, fz) || 1
      wishX = fx / flen
      wishZ = fz / flen
    }

    // Accelerate velocity toward wish vector
    if (targetSpeed > 0) {
      this.vel.x += (wishX * targetSpeed - this.vel.x) * Math.min(1, dt * 7)
      this.vel.z += (wishZ * targetSpeed - this.vel.z) * Math.min(1, dt * 7)
    } else {
      this.vel.x *= Math.max(0, 1 - dt * 10)
      this.vel.z *= Math.max(0, 1 - dt * 10)
    }

    // Attempt step
    let nx = this.pos.x + this.vel.x * dt
    let nz = this.pos.z + this.vel.z * dt

    // Wall & water avoidance: slide along valid axes
    if (!terrain.canStep(this.pos.x, this.pos.z, nx, nz)) {
      if (terrain.canStep(this.pos.x, this.pos.z, nx, this.pos.z)) {
        nz = this.pos.z
      } else if (terrain.canStep(this.pos.x, this.pos.z, this.pos.x, nz)) {
        nx = this.pos.x
      } else {
        nx = this.pos.x
        nz = this.pos.z
        if (this.state === 'WANDER') this.pickWanderTarget(terrain, colliders)
      }
    }

    // Circular obstacle pushout
    const resolved = colliders.resolve(nx, nz, this.def.radius)
    if (terrain.walkable(resolved.x, resolved.z)) {
      nx = resolved.x
      nz = resolved.z
    }

    this.pos.x = nx
    this.pos.z = nz
    this.pos.y = terrain.heightAt(nx, nz)

    // Orient facing direction
    const moving = Math.hypot(this.vel.x, this.vel.z)
    if (moving > 0.15) {
      const targetYaw = Math.atan2(this.vel.x, this.vel.z)
      // Smooth yaw turn
      let dyaw = targetYaw - this.yaw
      while (dyaw > Math.PI) dyaw -= Math.PI * 2
      while (dyaw < -Math.PI) dyaw += Math.PI * 2
      this.yaw += dyaw * Math.min(1, dt * 12)
    }

    this.root.position.copy(this.pos)
    this.root.rotation.y = this.yaw

    // 5. Ambient procedural movement animations
    this.animPhase += dt * (moving > 0.2 ? targetSpeed * 2.5 : 1.2)
    if (this.type === 'rabbit') {
      // Rabbit hop cycle
      if (moving > 0.3) {
        const hop = Math.abs(Math.sin(this.animPhase * 3.5))
        this.root.position.y += hop * 0.18
        this.root.rotation.x = Math.sin(this.animPhase * 3.5) * 0.22
      } else {
        this.root.rotation.x = 0
      }
    } else if (this.type === 'deer') {
      // Deer body sway and bound
      if (moving > 0.3) {
        this.root.position.y += Math.abs(Math.sin(this.animPhase * 2.8)) * 0.12
        this.root.rotation.z = Math.sin(this.animPhase * 2.8) * 0.05
      } else {
        this.root.rotation.z = 0
      }
    } else {
      // Bird waddle and flutter
      if (moving > 0.3) {
        this.root.position.y += Math.abs(Math.sin(this.animPhase * 4.5)) * 0.08
        this.root.rotation.z = Math.sin(this.animPhase * 4.5) * 0.14
      } else {
        // Idle pecking
        this.root.rotation.x = Math.sin(this.animPhase * 1.5) > 0.6 ? 0.35 : 0
      }
    }
  }

  private pickWanderTarget(terrain: Terrain, colliders: Colliders): void {
    for (let attempts = 0; attempts < 8; attempts++) {
      const angle = Math.random() * Math.PI * 2
      const dist = 12 + Math.random() * 22
      const tx = this.pos.x + Math.sin(angle) * dist
      const tz = this.pos.z + Math.cos(angle) * dist

      if (terrain.walkable(tx, tz) && terrain.slopeAt(tx, tz) < 0.75) {
        const res = colliders.resolve(tx, tz, this.def.radius)
        if (!res.hit) {
          this.wanderTarget.set(tx, terrain.heightAt(tx, tz), tz)
          return
        }
      }
    }
    // Fallback: stay nearby
    this.wanderTarget.copy(this.pos)
  }

  dispose(): void {
    this.root.traverse(o => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh
        m.geometry.dispose()
        if (Array.isArray(m.material)) m.material.forEach(mat => mat.dispose())
        else m.material.dispose()
      }
    })
    this.flashMat.dispose()
  }
}

/**
 * ============================================================================
 * 2. SPAWNING & MANAGER — Population caps, replacements, and combat hooks
 * ============================================================================
 */
export class AnimalManager {
  readonly group = new THREE.Group()
  readonly pickupGroup = new THREE.Group()
  readonly animals: Animal[] = []
  readonly pickups: MeatPickup[] = []

  private nextAnimalId = 1
  private respawnTimer = 0
  private terrain: Terrain
  private colliders: Colliders
  private audio: Audio
  private fx: Fx
  private hooks: {
    popup: (text: string, at: THREE.Vector3, kind: 'dmg' | 'loot' | 'heal' | 'info') => void
    loot: (id: ItemId, count: number) => void
    toast: (msg: string, type: 'info' | 'warn') => void
  }

  constructor(
    terrain: Terrain,
    colliders: Colliders,
    audio: Audio,
    fx: Fx,
    hooks: {
      popup: (text: string, at: THREE.Vector3, kind: 'dmg' | 'loot' | 'heal' | 'info') => void
      loot: (id: ItemId, count: number) => void
      toast: (msg: string, type: 'info' | 'warn') => void
    }
  ) {
    this.terrain = terrain
    this.colliders = colliders
    this.audio = audio
    this.fx = fx
    this.hooks = hooks

    this.group.name = 'passive_animals'
    this.pickupGroup.name = 'meat_pickups'
    this.group.add(this.pickupGroup)

    this.scheduleNextRespawn()
  }

  /** Spawn initial batch of passive wildlife when game loads. */
  spawnInitialBatch(playerPos: THREE.Vector3): void {
    for (let i = 0; i < ANIMAL_CONFIG.INITIAL_ANIMALS; i++) {
      this.spawnOne(playerPos)
    }
  }

  private pickRandomType(region: RegionId): AnimalType {
    const types = Object.values(ANIMAL_CONFIG.TYPES)
    const candidates = types.filter(t => (t.preferredRegions as readonly RegionId[]).includes(region))
    const pool = candidates.length > 0 ? candidates : types

    let totalWeight = 0
    for (const t of pool) totalWeight += t.spawnWeight
    let r = Math.random() * totalWeight
    for (const t of pool) {
      r -= t.spawnWeight
      if (r <= 0) return t.id as AnimalType
    }
    return 'rabbit'
  }

  private findSpawnPosition(playerPos: THREE.Vector3): { x: number; z: number; type: AnimalType } | null {
    const minDist = ANIMAL_CONFIG.MIN_SPAWN_DISTANCE_FROM_PLAYER
    const maxDist = 200

    for (let tries = 0; tries < 24; tries++) {
      const angle = Math.random() * Math.PI * 2
      const dist = minDist + Math.random() * (maxDist - minDist)
      const x = playerPos.x + Math.sin(angle) * dist
      const z = playerPos.z + Math.cos(angle) * dist

      if (!this.terrain.walkable(x, z)) continue
      if (this.terrain.slopeAt(x, z) > 0.7) continue
      if (this.terrain.isLava(x, z)) continue

      const reg = this.terrain.regionAt(x, z)
      const type = this.pickRandomType(reg)
      const def = ANIMAL_CONFIG.TYPES[type]

      const res = this.colliders.resolve(x, z, def.radius + 0.5)
      if (res.hit) continue

      return { x, z, type }
    }
    return null
  }

  private spawnOne(playerPos: THREE.Vector3): boolean {
    if (this.animals.length >= ANIMAL_CONFIG.MAX_ANIMALS) return false
    const pos = this.findSpawnPosition(playerPos)
    if (!pos) return false

    const animal = new Animal(this.nextAnimalId++, pos.type, pos.x, pos.z, this.terrain)
    this.animals.push(animal)
    this.group.add(animal.root)
    return true
  }

  private scheduleNextRespawn(): void {
    const min = ANIMAL_CONFIG.SPAWN_DELAY_MIN
    const max = ANIMAL_CONFIG.SPAWN_DELAY_MAX
    this.respawnTimer = min + Math.random() * (max - min)
  }

  /**
   * 4. COMBAT HOOK — Called when caveman performs a melee swing.
   */
  strike(
    attackDmg: number,
    motion: number,
    heavy: boolean,
    playerPos: THREE.Vector3,
    playerYaw: number,
    reach: number,
    weaponArcMult: number
  ): boolean {
    let hitAny = false

    for (const a of this.animals) {
      if (a.state === 'DEAD') continue

      const dx = a.pos.x - playerPos.x
      const dz = a.pos.z - playerPos.z
      const d = Math.hypot(dx, dz)
      const edge = d - a.def.radius

      if (edge > reach + 0.3) continue
      const dy = Math.abs(a.pos.y - playerPos.y)
      if (dy > a.def.height + 1.8) continue

      // Arc check
      const rel = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - playerYaw), Math.cos(Math.atan2(dx, dz) - playerYaw)))
      const halfArc = 1.35 * weaponArcMult + Math.atan2(a.def.radius, Math.max(d, 0.4))
      if (edge > 0.4 && rel > halfArc) continue

      // Landed hit!
      hitAny = true
      const dmg = Math.max(1, Math.round(attackDmg * motion * (heavy ? 1.4 : 1.0)))
      a.takeDamage(dmg, playerPos)

      const hitPoint = new THREE.Vector3(
        playerPos.x + dx * 0.7,
        a.pos.y + a.def.height * 0.5,
        playerPos.z + dz * 0.7
      )

      this.audio.play('hit', 0.9)
      this.fx.sparks(hitPoint, '#fff0c0', heavy ? 10 : 6, 4)
      this.fx.hitstop(heavy ? 0.06 : 0.04)
      this.hooks.popup(String(dmg), hitPoint.clone().setY(hitPoint.y + 0.5), 'dmg')

      if (a.hp <= 0) {
        this.fx.dustPuff(a.pos.x, a.pos.y, a.pos.z, 6, '#bca280', 0.6)
      }
    }

    return hitAny
  }

  /** Sling stone projectile collision test against passive animals. */
  checkProjectileHit(from: THREE.Vector3, to: THREE.Vector3, damage: number): boolean {
    for (const a of this.animals) {
      if (a.state === 'DEAD') continue
      const d = Math.hypot(a.pos.x - to.x, a.pos.z - to.z)
      if (d < a.def.radius + 0.6 && Math.abs(a.pos.y - to.y) < a.def.height + 0.6) {
        a.takeDamage(damage, from)
        this.audio.play('hit', 0.9)
        this.fx.sparks(to, '#fff0c0', 6, 3)
        this.hooks.popup(String(damage), to.clone().setY(to.y + 0.5), 'dmg')
        return true
      }
    }
    return false
  }

  /**
   * Find nearest meat pickup within distance of player for interaction.
   */
  nearestPickup(playerPos: THREE.Vector3, maxDist = 2.4): MeatPickup | null {
    let best: MeatPickup | null = null
    let bestDist = maxDist
    for (const p of this.pickups) {
      if (p.collected) continue
      const d = Math.hypot(p.pos.x - playerPos.x, p.pos.z - playerPos.z)
      if (d < bestDist) {
        bestDist = d
        best = p
      }
    }
    return best
  }

  /** Collect a meat pickup and restore hunger. */
  collectPickup(pickup: MeatPickup, progress: Progress, playerPos: THREE.Vector3): void {
    if (pickup.collected) return
    pickup.collected = true

    // 1. Add meat to inventory
    const added = add(progress, 'meat', pickup.amount)
    if (added > 0) {
      this.hooks.loot('meat', added)
      this.hooks.popup(`+${added} ${ITEMS.meat.name}`, pickup.pos.clone().setY(pickup.pos.y + 0.8), 'loot')
    }

    // 2. Eating raw meat restores hunger (capped at 100)
    const oldHunger = progress.hunger
    progress.hunger = Math.min(100, progress.hunger + ANIMAL_CONFIG.RAW_MEAT_HUNGER)
    const hungerGained = Math.round(progress.hunger - oldHunger)
    if (hungerGained > 0) {
      this.hooks.popup(`+${hungerGained} Hunger`, playerPos.clone().setY(playerPos.y + 2.1), 'heal')
      this.audio.play('eat', 0.85)
    }

    this.audio.play('pickup', 0.9)
    this.fx.sparks(pickup.pos.clone().setY(pickup.pos.y + 0.4), '#ffd47d', 8, 3.5)

    // Remove from group and clean up
    this.pickupGroup.remove(pickup.root)
    pickup.dispose()
    const idx = this.pickups.indexOf(pickup)
    if (idx !== -1) this.pickups.splice(idx, 1)
  }

  /** Per-frame update loop. */
  update(dt: number, playerPos: THREE.Vector3, progress: Progress): void {
    // 1. Update animals
    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i]
      a.update(dt, playerPos, this.terrain, this.colliders)

      // When death animation finishes, drop meat & remove
      if (a.deadComplete) {
        // Spawn Meat Pickup
        const meatPickup = new MeatPickup(a.pos.x, a.pos.y, a.pos.z, a.def.meat)
        this.pickups.push(meatPickup)
        this.pickupGroup.add(meatPickup.root)

        this.group.remove(a.root)
        a.dispose()
        this.animals.splice(i, 1)
        this.scheduleNextRespawn()
        continue
      }

      // Despawn if animal drifted far beyond active world range
      const dist = Math.hypot(a.pos.x - playerPos.x, a.pos.z - playerPos.z)
      if (dist > ANIMAL_CONFIG.DESPAWN_DISTANCE) {
        this.group.remove(a.root)
        a.dispose()
        this.animals.splice(i, 1)
        this.scheduleNextRespawn()
      }
    }

    // 2. Update meat pickups & walk-over collection
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i]
      const gy = this.terrain.heightAt(p.pos.x, p.pos.z)
      const alive = p.update(dt, gy)

      if (!alive) {
        // Despawned after 60s
        this.pickupGroup.remove(p.root)
        p.dispose()
        this.pickups.splice(i, 1)
        continue
      }

      // Walk-over pickup check
      const d = Math.hypot(p.pos.x - playerPos.x, p.pos.z - playerPos.z)
      if (d < 1.65 && Math.abs(p.pos.y - playerPos.y) < 1.8) {
        this.collectPickup(p, progress, playerPos)
      }
    }

    // 3. Gradual respawning
    if (this.animals.length < ANIMAL_CONFIG.MAX_ANIMALS) {
      this.respawnTimer -= dt
      if (this.respawnTimer <= 0) {
        this.spawnOne(playerPos)
        this.scheduleNextRespawn()
      }
    }
  }

  reset(): void {
    for (const a of this.animals) {
      this.group.remove(a.root)
      a.dispose()
    }
    this.animals.length = 0

    for (const p of this.pickups) {
      this.pickupGroup.remove(p.root)
      p.dispose()
    }
    this.pickups.length = 0
    this.scheduleNextRespawn()
  }
}
