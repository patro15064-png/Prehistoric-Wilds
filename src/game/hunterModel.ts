import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { assets } from '../engine/assets'
import type { GearId, HeldId } from './data'
import { buildToolModel } from './toolModels'

/**
 * Realistic hunter: a rigged GLB per armour tier (hunter-t0..t3) animated by a shared,
 * mesh-free clip library (hunter-anims.glb) retargeted by bone name.
 * Looping clips (idle/walk/run/stance/gather) blend by speed; combat clips are *driven*:
 * their time is set every frame from the gameplay state, and light/heavy clips are phase-
 * mapped so the clip's impact frame lands exactly on the hit frame (windup → impact → recovery
 * auto-detected from right-hand speed).
 */
export type Clip = 'idle' | 'walk' | 'run' | 'stance' | 'light' | 'heavy' | 'dodge' | 'hit' | 'down' | 'gather'
const LOOPS: Clip[] = ['idle', 'walk', 'run', 'stance', 'gather']
const ALL: Clip[] = ['idle', 'walk', 'run', 'stance', 'light', 'heavy', 'dodge', 'hit', 'down', 'gather']

export type AnimDrive =
  | { kind: 'loco'; speed: number; sprint: boolean; combat: boolean; blend?: number }
  | { kind: 'swing'; clip: 'light' | 'heavy'; t: number; windup: number; active: number; recovery: number; hold?: number; startFrac?: number }
  | { kind: 'clip'; clip: Clip; k: number; from?: number; to?: number }
  | { kind: 'task'; t: number }

type Marks = { start: number; impact: number; end: number; dur: number }

const WEAPON_MODEL: Record<string, string> = { club: 'w-club', flintMaul: 'w-maul', amberHammer: 'w-amber', obsidianClub: 'w-obsidian', flintHatchet: 'w-axe', boneSpear: 'w-spear', stalkerLance: 'w-spear', reedSling: 'w-sling', sinewSling: 'w-sling', flintPick: 'w-pick' }
const WEAPON_LEN: Record<string, number> = { club: 0.95, flintMaul: 1.1, amberHammer: 1.2, obsidianClub: 1.35, flintHatchet: 0.85, flintPick: 0.95, boneSpear: 1.75, stalkerLance: 1.9, reedSling: 0.75, sinewSling: 0.8, hands: 0.35 }
/** Generated meshes that are not modelled upright: rotate their long axis onto +Y (head end up). */
const ALIGN = new Set(['boneSpear', 'stalkerLance', 'reedSling', 'sinewSling'])
/** Tint to tell tier-2 variants apart when they share a mesh. */
const TINT: Record<string, string> = { stalkerLance: '#e8c890', sinewSling: '#f0dcc0' }

/** Principal axis of a model's vertices (world space of `root`), pointing towards its bulkier end. */
function longAxis(root: THREE.Object3D): THREE.Vector3 {
  root.updateMatrixWorld(true)
  const pts: THREE.Vector3[] = []
  const v = new THREE.Vector3()
  root.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const pos = m.geometry.getAttribute('position')
    const step = Math.max(1, Math.floor(pos.count / 1500))
    for (let i = 0; i < pos.count; i += step) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).clone())
  })
  const c = new THREE.Vector3()
  for (const p of pts) c.add(p)
  c.divideScalar(Math.max(1, pts.length))
  // Power iteration on the covariance matrix.
  let a = new THREE.Vector3(0.3, 1, 0.2).normalize()
  for (let it = 0; it < 24; it += 1) {
    const n = new THREE.Vector3()
    for (const p of pts) {
      const d = v.subVectors(p, c)
      n.addScaledVector(d, d.dot(a))
    }
    if (n.lengthSq() < 1e-12) break
    a = n.normalize()
  }
  // Bulkier end: larger spread perpendicular to the axis over the outer 25% of each end.
  let lo = 0, hi = 0, tmin = Infinity, tmax = -Infinity
  for (const p of pts) {
    const t = v.subVectors(p, c).dot(a)
    tmin = Math.min(tmin, t)
    tmax = Math.max(tmax, t)
  }
  const span = tmax - tmin
  for (const p of pts) {
    const d = v.subVectors(p, c)
    const t = d.dot(a)
    const r = d.addScaledVector(a, -t).length()
    if (t > tmax - span * 0.25) hi += r
    else if (t < tmin + span * 0.25) lo += r
  }
  return lo > hi ? a.negate() : a
}
const HEIGHT = 1.78

export class HunterAvatar {
  /** Added under the player root; contains the current model. */
  readonly holder = new THREE.Group()
  ready = false
  private model?: THREE.Object3D
  private mixer?: THREE.AnimationMixer
  private actions = new Map<Clip, THREE.AnimationAction>()
  private weights = new Map<Clip, number>()
  marks: Partial<Record<Clip, Marks>> = {}
  private hand?: THREE.Object3D
  private weaponSlot = new THREE.Group()
  private weaponId: GearId | HeldId | '' = ''
  private tier = -1
  private flashU = { value: 0 }
  private walkPhase = 0
  /** World-space weapon tip (for trails/sparks). */
  readonly tip = new THREE.Vector3()
  /** World-space grip (weapon slot origin). */
  readonly grip = new THREE.Vector3()
  onReady?: () => void

  setTier(tier: number): void {
    if (tier === this.tier) return
    this.tier = tier
    const want = tier
    assets.onGltf(`hunter-t${tier}`, g => {
      if (this.tier !== want) return
      assets.onGltf('hunter-anims', lib => this.useModel(g, lib))
    })
  }

  setWeapon(id: GearId | HeldId): void {
    if (id === this.weaponId) return
    this.weaponId = id
    this.weaponSlot.userData.len = WEAPON_LEN[id] ?? 1
    if (id === 'hands') {
      // Bare fists: nothing in hand; the "tip" tracks just past the knuckles.
      this.weaponSlot.clear()
      return
    }
    if (id === 'flintHatchet' || id === 'flintPick') {
      // Show a procedural tool straight away; the generated model replaces it when it streams in.
      this.weaponSlot.clear()
      this.weaponSlot.add(buildToolModel(id, WEAPON_LEN[id]))
    }
    const name = WEAPON_MODEL[id]
    if (!name) return
    if (!assets.known(name)) return
    assets.onGltf(name, g => {
      if (this.weaponId !== id) return
      this.weaponSlot.clear()
      let w: THREE.Object3D = g.scene.clone(true)
      if (ALIGN.has(id)) {
        const inner = w
        inner.quaternion.setFromUnitVectors(longAxis(inner), new THREE.Vector3(0, 1, 0))
        w = new THREE.Group()
        w.add(inner)
      }
      const box = new THREE.Box3().setFromObject(w)
      const size = box.getSize(new THREE.Vector3())
      const s = (WEAPON_LEN[id] ?? 1) / size.y
      w.scale.setScalar(s)
      // Grip ~12% up from the pommel.
      w.position.y = -box.min.y * s - size.y * s * 0.12
      w.traverse(o => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        m.castShadow = true
        const mat = (m.material as THREE.MeshStandardMaterial).clone()
        mat.roughness = Math.max(0.6, mat.roughness)
        mat.metalness = Math.min(0.1, mat.metalness)
        mat.envMapIntensity = 0.4
        if (mat.emissiveMap) mat.emissiveIntensity = Math.min(mat.emissiveIntensity, 0.6)
        if (TINT[id]) mat.color.multiply(new THREE.Color(TINT[id]))
        m.material = mat
      })
      this.weaponSlot.add(w)
      this.weaponSlot.userData.len = WEAPON_LEN[id] ?? 1
    })
  }

  private useModel(g: GLTF, lib: GLTF): void {
    if (this.model) { this.holder.remove(this.model); this.mixer?.stopAllAction() }
    const m = skeletonClone(g.scene)
    // Normalise height, feet at y=0, facing +Z.
    m.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(m)
    const size = box.getSize(new THREE.Vector3())
    const s = HEIGHT / size.y
    m.scale.multiplyScalar(s)
    m.updateMatrixWorld(true)
    const b2 = new THREE.Box3().setFromObject(m)
    const c = b2.getCenter(new THREE.Vector3())
    m.position.x -= c.x
    m.position.z -= c.z
    m.position.y -= b2.min.y
    m.traverse(o => {
      const mesh = o as THREE.SkinnedMesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.frustumCulled = false
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone()
      mat.roughness = Math.max(0.8, mat.roughness)
      mat.metalness = 0
      mat.envMapIntensity = 0.35
      const flashU = this.flashU
      mat.onBeforeCompile = sh => {
        sh.uniforms.uFlash = flashU
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uFlash;')
          .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.35, 0.25), uFlash * 0.55);')
      }
      mesh.material = mat
    })
    this.model = m
    this.holder.add(m)

    // Bones by name.
    const bones = new Map<string, THREE.Object3D>()
    m.traverse(o => { if (o.name) bones.set(o.name, o) })
    this.hand = bones.get('RightHand')
    const libHips = lib.scene.getObjectByName('Hips')
    const hips = bones.get('Hips')
    const ratio = libHips && hips && libHips.position.length() > 1e-6 ? hips.position.length() / libHips.position.length() : 1

    this.mixer = new THREE.AnimationMixer(m)
    this.actions.clear()
    for (const name of ALL) {
      const src = lib.animations.find(a => a.name === name)
      if (!src) continue
      const clip = src.clone()
      clip.tracks = clip.tracks.filter(t => bones.has(t.name.split('.')[0]))
      for (const t of clip.tracks) {
        if (!t.name.endsWith('.position')) continue
        // Scale hip translation to this model's proportions and remove forward drift (in-place).
        const v = t.values
        const n = t.times.length
        const x0 = v[0], z0 = v[2], x1 = v[(n - 1) * 3], z1 = v[(n - 1) * 3 + 2]
        for (let i = 0; i < n; i += 1) {
          const k = n > 1 ? i / (n - 1) : 0
          v[i * 3] = (v[i * 3] - (x0 + (x1 - x0) * k)) * ratio + (hips?.position.x ?? 0)
          v[i * 3 + 1] *= ratio
          v[i * 3 + 2] = (v[i * 3 + 2] - (z0 + (z1 - z0) * k)) * ratio + (hips?.position.z ?? 0)
        }
      }
      const a = this.mixer.clipAction(clip)
      a.play()
      a.setEffectiveWeight(0)
      if (!LOOPS.includes(name)) { a.timeScale = 0; a.clampWhenFinished = true }
      this.actions.set(name, a)
      this.weights.set(name, name === 'idle' ? 1 : 0)
    }
    this.marks = {}
    for (const name of ['light', 'heavy'] as Clip[]) this.marks[name] = this.detectMarks(name)

    // Weapon on the right hand, world scale compensated.
    if (this.hand) {
      this.hand.add(this.weaponSlot)
      m.updateMatrixWorld(true)
      const ws = new THREE.Vector3()
      this.hand.getWorldScale(ws)
      this.weaponSlot.scale.setScalar(1 / ws.x)
      // Shaft across the fist, head pointing forward/up out of the grip.
      this.weaponSlot.rotation.set(Math.PI / 2, 0, 0)
    }
    this.ready = true
    this.onReady?.()
  }

  /** Find windup start, impact (peak hand speed) and settle times in an attack clip. */
  private detectMarks(name: Clip): Marks {
    const a = this.actions.get(name)!
    const dur = a.getClip().duration
    if (!this.hand || !this.mixer || !this.model) return { start: 0, impact: dur * 0.4, end: dur, dur }
    for (const x of this.actions.values()) x.setEffectiveWeight(0)
    a.setEffectiveWeight(1)
    const N = 60
    const pos: THREE.Vector3[] = []
    for (let i = 0; i <= N; i += 1) {
      a.time = (i / N) * dur
      this.mixer.update(0)
      this.model.updateMatrixWorld(true)
      pos.push(this.hand.getWorldPosition(new THREE.Vector3()))
    }
    const sp = pos.map((p, i) => (i ? p.distanceTo(pos[i - 1]) : 0))
    let pk = 1
    for (let i = 1; i <= N; i += 1) if (sp[i] > sp[pk]) pk = i
    let st = pk
    while (st > 1 && sp[st - 1] > sp[pk] * 0.18) st -= 1
    // Windup begins where the hand starts moving before the peak (search backward past the lull).
    let ws = st
    while (ws > 1 && sp[ws - 1] <= sp[pk] * 0.18) ws -= 1
    let en = pk
    while (en < N && sp[en + 1] > sp[pk] * 0.12) en += 1
    a.setEffectiveWeight(0)
    const T = (i: number) => (i / N) * dur
    return { start: T(Math.max(0, Math.min(ws, st - 2))), impact: T(pk), end: Math.min(dur, T(en) + dur * 0.12), dur }
  }

  flash(v: number): void { this.flashU.value = v }

  update(dt: number, d: AnimDrive): void {
    if (!this.mixer) return
    const target = new Map<Clip, number>()
    let blendRate = 14
    switch (d.kind) {
      case 'loco': {
        if (d.blend) blendRate = d.blend
        const sp = d.speed
        const idle = d.combat ? 'stance' : 'idle'
        const wWalk = THREE.MathUtils.clamp(sp / 1.6, 0, 1) * (1 - THREE.MathUtils.clamp((sp - 3.2) / 1.6, 0, 1))
        const wRun = THREE.MathUtils.clamp((sp - 3.2) / 1.6, 0, 1)
        target.set(idle, Math.max(0, 1 - wWalk - wRun))
        target.set('walk', wWalk)
        target.set('run', wRun)
        const walk = this.actions.get('walk')
        const run = this.actions.get('run')
        if (walk) walk.timeScale = THREE.MathUtils.clamp(sp / 1.45, 0.6, 1.8)
        if (run) run.timeScale = THREE.MathUtils.clamp(sp / 5.2, 0.8, 1.5)
        // Keep walk/run phase-aligned so the blend doesn't scissor.
        if (walk && run) {
          this.walkPhase = walk.time / walk.getClip().duration
          if (wRun > 0.01 && wWalk > 0.01) run.time = this.walkPhase * run.getClip().duration
        }
        break
      }
      case 'swing': {
        const m = this.marks[d.clip]
        const a = this.actions.get(d.clip)
        if (m && a) {
          const hitT = d.windup + d.active * 0.5
          let ct: number
          const sf = d.startFrac ?? 0
          if (d.t < hitT) ct = m.start + (m.impact - m.start) * (sf + (1 - sf) * Math.pow(d.t / hitT, 1.2))
          else ct = m.impact + (m.end - m.impact) * Math.min(1, (d.t - hitT) / Math.max(0.05, d.recovery + d.active * 0.5))
          if (d.hold !== undefined) ct = m.start + (m.impact - m.start) * d.hold
          a.time = ct
        }
        target.set(d.clip, 1)
        blendRate = 30
        break
      }
      case 'clip': {
        const a = this.actions.get(d.clip)
        if (a) {
          const dur = a.getClip().duration
          const from = (d.from ?? 0) * dur
          const to = (d.to ?? 1) * dur
          a.time = from + (to - from) * THREE.MathUtils.clamp(d.k, 0, 1)
        }
        target.set(d.clip, 1)
        blendRate = 26
        break
      }
      case 'task': target.set('gather', 1); break
    }
    const k = 1 - Math.exp(-blendRate * dt)
    for (const [name, a] of this.actions) {
      const w = (this.weights.get(name) ?? 0) + ((target.get(name) ?? 0) - (this.weights.get(name) ?? 0)) * k
      this.weights.set(name, w)
      a.setEffectiveWeight(w)
    }
    this.mixer.update(dt)
    if (this.weaponSlot.children.length) {
      this.weaponSlot.updateMatrixWorld(true)
      this.tip.set(0, (this.weaponSlot.userData.len as number) * 0.8, 0)
      this.weaponSlot.localToWorld(this.tip)
      this.weaponSlot.getWorldPosition(this.grip)
    }
  }

  /** Lab/debug access to the weapon slot rotation. */
  get weaponMount(): THREE.Group { return this.weaponSlot }
}
