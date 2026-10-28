import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { assets } from '../engine/assets'
import { Colliders } from './colliders'
import { WORLD_UNIFORMS, heightTexture, lavaMaterial, skyMaterial, terrainMaterial, waterMaterial, waterfallMaterial, windify } from './materials'
import { Noise2, clamp, lerp, rng, smoothstep } from './noise'
import * as P from './props'
import { ARENAS, POI, Terrain, VOLCANO, WORLD } from './terrain'

export type SceneryQuality = 'low' | 'medium' | 'high'

type Atmos = { fog: THREE.Color; density: number; top: THREE.Color; horizon: THREE.Color; sun: THREE.Color; sunI: number; hemiSky: THREE.Color; hemiGround: THREE.Color; hemiI: number }
const atmos = (fog: string, density: number, top: string, horizon: string, sun: string, sunI: number, hemiSky: string, hemiGround: string, hemiI: number): Atmos => ({
  fog: new THREE.Color(fog), density, top: new THREE.Color(top), horizon: new THREE.Color(horizon), sun: new THREE.Color(sun), sunI,
  hemiSky: new THREE.Color(hemiSky), hemiGround: new THREE.Color(hemiGround), hemiI,
})
const ATMOS = {
  coast: atmos('#c7e6ea', 0.0029, '#2f8fdc', '#cdeef0', '#fff0cc', 2.7, '#cfeaff', '#5f7c3a', 1.05),
  highlands: atmos('#efd7a4', 0.0027, '#3f86cc', '#f6deaa', '#ffe2a6', 2.9, '#ffeac2', '#a2783a', 1.0),
  caldera: atmos('#9c7c72', 0.0068, '#4f5170', '#c68a6c', '#ffb487', 2.2, '#f0b89a', '#5a2a1a', 0.95),
}

type ScatterDef = { geo: THREE.BufferGeometry; mat: THREE.Material; shadow: boolean; cull: number; items: Map<number, { m: THREE.Matrix4[]; c: THREE.Color[] }> }
/** far: visible only beyond `cull` (procedural LOD behind a detailed near mesh). */
/** swap: distance scales with the quality detail factor. proxy: shadow-only stand-in (never drawn in colour). */
type Chunk = { mesh: THREE.InstancedMesh; x: number; z: number; cull: number; name: string; key: number; far?: boolean; swap?: boolean; proxy?: boolean }
/** Near-detail radius multiplier per quality level (textured catalog models are the dominant triangle cost). */
const DETAIL: Record<SceneryQuality, number> = { low: 0.6, medium: 0.8, high: 1 }
/**
 * Material for shadow-only proxies: the colour pass clips every vertex away, while the shadow pass
 * uses three's own depth material (it does not inherit shaders), so the cheap mesh still casts.
 */
const PROXY_MAT = (() => {
  const m = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
  m.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  gl_Position = vec4(0.0, 0.0, 2.0, 1.0);') }
  m.customProgramCacheKey = () => 'shadow-proxy'
  return m
})()
/** A tree or boulder that can be chopped/mined. `idx` is its instance slot inside every chunk mesh of `def`/`key`. */
export type HarvestRec = {
  id: number; kind: 'tree' | 'rock'; def: string; key: number; idx: number
  x: number; y: number; z: number; yaw: number; s: number; height: number; radius: number
  col: number; colR: number; matrix: THREE.Matrix4
}
/** Catalog models (Quaternius Stylized Nature MegaKit, CC0) that replace procedural scatter once streamed in. */
type Swap = { def: string; model: string; fit?: number; color?: string; wind?: [number, number, number?]; near?: number; lod?: boolean; whiten?: number; shadow?: boolean }
const SWAPS: Swap[] = [
  { def: 'jungle0', model: 'env/CommonTree_1', fit: 1.15, wind: [0.022, 1], near: 45, lod: true, whiten: 0.65, shadow: true },
  { def: 'jungle1', model: 'env/CommonTree_3', fit: 1.15, wind: [0.022, 1], near: 45, lod: true, whiten: 0.65, shadow: true },
  { def: 'jungle2', model: 'env/CommonTree_5', fit: 1.15, wind: [0.022, 1], near: 45, lod: true, whiten: 0.65, shadow: true },
  { def: 'acacia0', model: 'env/TwistedTree_1', fit: 1.1, color: '#f4e2b0', wind: [0.02, 1], near: 40, lod: true, whiten: 0.7, shadow: true },
  { def: 'acacia1', model: 'env/TwistedTree_3', fit: 1.1, color: '#f4e2b0', wind: [0.02, 1], near: 40, lod: true, whiten: 0.7, shadow: true },
  { def: 'deadtree', model: 'env/DeadTree_1', fit: 1.2, color: '#9a8a82', near: 45, lod: true, shadow: true },
  { def: 'fern', model: 'env/Fern_1', fit: 1.25, wind: [0.1, 1, 0.01], whiten: 0.6, near: 35 },
  { def: 'bigleaf', model: 'env/Plant_1_Big', fit: 1, wind: [0.08, 1, 0.01], whiten: 0.8, near: 45, lod: true },
  { def: 'bushJ', model: 'env/Bush_Common_Flowers', fit: 1.1, wind: [0.06, 1], whiten: 0.7, near: 40, lod: true },
  { def: 'flowerP', model: 'env/Flower_3_Group', fit: 1.4, wind: [0.12, 1, 0.02], whiten: 1, near: 35 },
  { def: 'rockC', model: 'env/Rock_Medium_1', fit: 1.05, color: '#c9c3b4', near: 260, lod: true, whiten: 0.5, shadow: true },
  { def: 'rockH', model: 'env/Rock_Medium_2', fit: 1.05, color: '#e6ad78', near: 260, lod: true, whiten: 0.5, shadow: true },
]

const CHUNK = 85

// ─── Soft particle puffs (steam, mist, smoke) ──────────────────────────────

type Emitter = {
  x: number; y: number; z: number; rate: number; spread: number
  vel: [number, number, number]; size: [number, number]; life: number; color: THREE.Color; alpha: number
  /** Periodic bursts (geysers): active for `on` seconds every `period`. */
  period?: number; on?: number; phase?: number; acc: number; enabled: boolean
}

class Puffs {
  readonly points: THREE.Points
  private readonly max = 900
  private readonly pos: Float32Array
  private readonly vel: Float32Array
  private readonly age: Float32Array
  private readonly life: Float32Array
  private readonly size: Float32Array
  private readonly col: Float32Array
  private readonly alpha: Float32Array
  private readonly aLife: Float32Array
  private next = 0
  readonly emitters: Emitter[] = []

  constructor() {
    const g = new THREE.BufferGeometry()
    this.pos = new Float32Array(this.max * 3).fill(-9999)
    this.vel = new Float32Array(this.max * 3)
    this.age = new Float32Array(this.max).fill(1e9)
    this.life = new Float32Array(this.max).fill(1)
    this.size = new Float32Array(this.max)
    this.col = new Float32Array(this.max * 3)
    this.alpha = new Float32Array(this.max)
    this.aLife = new Float32Array(this.max).fill(1)
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aLife', new THREE.BufferAttribute(this.aLife, 1).setUsage(THREE.DynamicDrawUsage))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        attribute float aSize; attribute vec3 aColor; attribute float aAlpha; attribute float aLife;
        uniform float uScale; varying vec3 vColor; varying float vAlpha;
        void main(){
          vColor = aColor;
          float t = aLife;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          // Fade near the camera; dead/invisible puffs get zero size so they are never rasterised.
          vAlpha = aAlpha * smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.55, 1.0, t)) * smoothstep(2.0, 6.0, -mvPosition.z);
          gl_PointSize = vAlpha > 0.004 ? min(aSize * (0.6 + t * 0.9) * uScale / max(1.0, -mvPosition.z), uScale * 0.3) : 0.0;
          gl_Position = vAlpha > 0.004 ? projectionMatrix * mvPosition : vec4(2.0, 2.0, 2.0, 1.0);
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        varying vec3 vColor; varying float vAlpha;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c) * 4.0;
          if (d > 1.0) discard;
          gl_FragColor = vec4(vColor, vAlpha * (1.0 - d) * (1.0 - d));
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    })
    this.points = new THREE.Points(g, mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 5
  }

  add(e: Omit<Emitter, 'acc' | 'enabled'>): Emitter {
    const em = { ...e, acc: 0, enabled: true }
    this.emitters.push(em)
    return em
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, c: THREE.Color, alpha: number): void {
    const i = this.next
    this.next = (this.next + 1) % this.max
    this.pos[i * 3] = x
    this.pos[i * 3 + 1] = y
    this.pos[i * 3 + 2] = z
    this.vel[i * 3] = vx
    this.vel[i * 3 + 1] = vy
    this.vel[i * 3 + 2] = vz
    this.age[i] = 0
    this.life[i] = life
    this.size[i] = size
    this.col[i * 3] = c.r
    this.col[i * 3 + 1] = c.g
    this.col[i * 3 + 2] = c.b
    this.alpha[i] = alpha
  }

  update(dt: number, time: number, focus: THREE.Vector3, pixelScale: number): void {
    ;(this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = pixelScale
    for (const e of this.emitters) {
      if (!e.enabled) continue
      const dx = e.x - focus.x
      const dz = e.z - focus.z
      if (dx * dx + dz * dz > 260 * 260) continue
      if (e.period) {
        const t = (time + (e.phase ?? 0)) % e.period
        if (t > (e.on ?? 1)) continue
      }
      e.acc += e.rate * dt
      while (e.acc >= 1) {
        e.acc -= 1
        const s = e.spread
        this.spawn(
          e.x + (Math.random() - 0.5) * s, e.y + Math.random() * s * 0.3, e.z + (Math.random() - 0.5) * s,
          e.vel[0] + (Math.random() - 0.5) * 0.8, e.vel[1] * (0.7 + Math.random() * 0.6), e.vel[2] + (Math.random() - 0.5) * 0.8,
          lerp(e.size[0], e.size[1], Math.random()), e.life * (0.75 + Math.random() * 0.5), e.color, e.alpha,
        )
      }
    }
    for (let i = 0; i < this.max; i += 1) {
      if (this.age[i] > this.life[i]) {
        this.aLife[i] = 1
        continue
      }
      this.age[i] += dt
      const k = i * 3
      this.pos[k] += this.vel[k] * dt
      this.pos[k + 1] += this.vel[k + 1] * dt
      this.pos[k + 2] += this.vel[k + 2] * dt
      this.vel[k] += 0.25 * dt
      this.aLife[i] = Math.min(1, this.age[i] / this.life[i])
    }
    const g = this.points.geometry
    for (const name of ['position', 'aSize', 'aColor', 'aAlpha', 'aLife']) g.getAttribute(name).needsUpdate = true
  }
}

// ─── Scenery ────────────────────────────────────────────────────────────────

export class Scenery {
  readonly root = new THREE.Group()
  readonly sun = new THREE.DirectionalLight('#fff0cc', 2.7)
  readonly hemi = new THREE.HemisphereLight('#cfeaff', '#5f7c3a', 1.05)
  readonly fog = new THREE.FogExp2('#c7e6ea', 0.0029)
  readonly puffs = new Puffs()
  /** Named render groups for profiling/debug tools (sky, sea, terrain, particles...). */
  readonly debug: Record<string, THREE.Object3D[]> = {}
  private tag(name: string, ...objs: THREE.Object3D[]): void {
    ;(this.debug[name] ??= []).push(...objs)
  }
  /** Smoothed region weights at the camera (drive fog, sky, particles, audio). */
  readonly weights = { coast: 1, highlands: 0, caldera: 0 }
  private readonly scatter = new Map<string, ScatterDef>()
  private readonly chunks: Chunk[] = []
  /** Choppable trees and mineable boulders, in placement order (ids are indices). */
  readonly harvestables: HarvestRec[] = []
  private plume?: THREE.InstancedMesh
  private readonly plumeSeeds: { t: number; a: number; r: number; s: number }[] = []
  private motes?: THREE.Points
  private clouds?: THREE.Group
  private islands?: THREE.Mesh
  private lavaLight?: THREE.PointLight
  private readonly heights: THREE.DataTexture
  readonly geysers: Emitter[] = []
  private readonly forestN = new Noise2(55)
  private readonly density: number
  private q: SceneryQuality
  /** Near-detail radius multiplier (see DETAIL). */
  private detail = 1

  constructor(
    private readonly scene: THREE.Scene,
    readonly terrain: Terrain,
    readonly colliders: Colliders,
    private readonly reserved: Colliders,
    quality: SceneryQuality,
  ) {
    this.q = quality
    this.detail = DETAIL[quality]
    this.density = quality === 'high' ? 1 : quality === 'medium' ? 0.62 : 0.36
    this.heights = heightTexture(terrain)
    scene.add(this.root)
    scene.fog = this.fog
    scene.background = new THREE.Color('#bfe8f2')
  }

  forest(x: number, z: number): number {
    return this.forestN.fbm(x / 72, z / 72, 3)
  }

  /** Build the world in phases so the loading bar keeps moving. */
  async build(progress: (f: number) => void): Promise<void> {
    const tick = async (f: number) => {
      progress(f)
      await new Promise(r => setTimeout(r, 0))
    }
    this.buildLights()
    this.buildSky()
    await tick(0.1)
    this.buildTerrainMesh()
    await tick(0.25)
    this.buildWater()
    this.buildLandmarks()
    await tick(0.4)
    this.defineScatter()
    this.populate()
    await tick(0.75)
    this.finishScatter()
    this.hookSwaps()
    this.buildAtmosphere()
    this.root.add(this.puffs.points)
    this.tag('puffs', this.puffs.points)
    await tick(0.95)
  }

  // ── lights & sky ──
  private buildLights(): void {
    const s = this.sun
    s.position.copy(WORLD_UNIFORMS.uSunDir.value).multiplyScalar(120)
    s.castShadow = true
    const cam = s.shadow.camera
    cam.left = -58
    cam.right = 58
    cam.top = 58
    cam.bottom = -58
    cam.near = 1
    cam.far = 320
    s.shadow.bias = -0.0006
    s.shadow.normalBias = 0.6
    s.shadow.mapSize.set(this.q === 'high' ? 2048 : 1024, this.q === 'high' ? 2048 : 1024)
    this.root.add(s, s.target, this.hemi)
  }

  private buildSky(): void {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMaterial())
    // Drawn after all opaque geometry: the dome sits on the far plane (xyww), so the depth test
    // rejects every pixel already covered by terrain/foliage instead of shading it first.
    sky.renderOrder = 999
    sky.frustumCulled = false
    this.root.add(sky)
    this.tag('sky', sky)
    // Puffy cumulus drifting around the island.
    const r = rng(9)
    this.clouds = new THREE.Group()
    const parts: THREE.BufferGeometry[] = []
    for (let i = 0; i < 26; i += 1) {
      const a = r() * Math.PI * 2
      const d = 180 + r() * 520
      const cx = Math.cos(a) * d
      const cz = Math.sin(a) * d
      const cy = 120 + r() * 70
      const n = 5 + Math.floor(r() * 5)
      for (let k = 0; k < n; k += 1) {
        const rad = 12 + r() * 16
        parts.push(P.part(P.blob(rad, 1, 0.12, i * 50 + k), (_p, nn) => new THREE.Color('#ffffff').lerp(new THREE.Color('#b9c9dc'), clamp(0.5 - nn.y * 0.6, 0, 1)), [cx + (k - n / 2) * rad * 0.9 + r() * 6, cy + r() * 8, cz + (r() - 0.5) * 16], [0, 0, 0], [1, 0.62, 1]))
      }
    }
    // Unlit (baked gradient) and drawn after the opaque scene: clouds are large, heavily overlapping blobs.
    const cloudMesh = new THREE.Mesh(P.merge(parts), new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.28, 1.28, 1.3), fog: false }))
    cloudMesh.renderOrder = 998
    this.clouds.add(cloudMesh)
    this.root.add(this.clouds)
    this.tag('clouds', this.clouds)
    // Distant island silhouettes on the horizon for depth.
    const isl: THREE.BufferGeometry[] = []
    for (let i = 0; i < 9; i += 1) {
      const a = (i / 9) * Math.PI * 2 + r() * 0.4
      const d = 1100 + r() * 500
      isl.push(P.part(P.blob(1, 1, 0.3, 300 + i, true), '#ffffff', [Math.cos(a) * d, -8, Math.sin(a) * d], [0, r() * 3, 0], [70 + r() * 90, 30 + r() * 60, 70 + r() * 90]))
    }
    this.islands = new THREE.Mesh(P.merge(isl), new THREE.MeshBasicMaterial({ color: '#8fb5c4', fog: false }))
    this.root.add(this.islands)
    this.tag('islands', this.islands)
  }

  // ── terrain ──
  private groundColor(x: number, z: number, h: number, slope: number, trail: number, out: THREE.Color): { glow: number } {
    const T = this.terrain
    const w = T.regionWeights(x, z)
    const n = this.forestN.get(x / 9, z / 9) * 0.5 + 0.5
    const f = this.forest(x, z)
    const c = new THREE.Color()
    // coast
    const sand = new THREE.Color('#efd79d')
    const wetSand = new THREE.Color('#c9ad78')
    const grass = new THREE.Color('#58b246').lerp(new THREE.Color('#3f9a3a'), n)
    grass.lerp(new THREE.Color('#2f6f2c'), smoothstep(-0.1, 0.5, f) * 0.55)
    let coast = grass.clone()
    const beach = 1 - smoothstep(1.8, 3.2, h)
    coast.lerp(sand, beach)
    if (h < 0.4) coast = wetSand.clone().lerp(new THREE.Color('#5d8d80'), smoothstep(0.4, -6, h))
    const cliffCoast = new THREE.Color('#7f7465').lerp(new THREE.Color('#9a8c78'), n)
    // highlands
    const gold = new THREE.Color('#d8b24e').lerp(new THREE.Color('#c39a3e'), n)
    gold.lerp(new THREE.Color('#9fae4a'), smoothstep(0.35, 0.7, f) * 0.5)
    const strata = 0.5 + 0.5 * Math.sin(h * 1.1 + n * 1.5)
    const cliffHigh = new THREE.Color('#b4623a').lerp(new THREE.Color('#e3a566'), strata)
    // caldera
    const dv = T.volcanoDistance(x, z)
    const ash = new THREE.Color('#6d625b').lerp(new THREE.Color('#857667'), n)
    ash.lerp(new THREE.Color('#3b3331'), smoothstep(110, 55, dv))
    ash.lerp(new THREE.Color('#7a6a4a'), smoothstep(130, 160, dv) * 0.6)
    const cliffCal = new THREE.Color('#342d2b').lerp(new THREE.Color('#4a3f3a'), n)
    const cliff = smoothstep(0.75, 1.15, slope)
    c.setRGB(0, 0, 0)
    c.add(coast.lerp(cliffCoast, cliff).multiplyScalar(w.coast))
    c.add(gold.lerp(cliffHigh, cliff).multiplyScalar(w.highlands))
    c.add(ash.lerp(cliffCal, cliff).multiplyScalar(w.caldera))
    const dirt = new THREE.Color('#b8895a').multiplyScalar(w.coast).add(new THREE.Color('#a8703e').multiplyScalar(w.highlands)).add(new THREE.Color('#4d423c').multiplyScalar(w.caldera))
    c.lerp(dirt, trail * 0.75 * (1 - cliff))
    out.copy(c)
    let glow = 0
    if (T.inCrater(x, z)) glow = clamp(1 - (h - WORLD.lava) / 2.4, 0, 1)
    return { glow }
  }

  /**
   * Coarse terrain for the shadow pass only. Each vertex takes the minimum height of its fine-grid
   * neighbourhood (minus a small offset) so the proxy never pokes above the visible surface
   * and cannot self-shadow it; hills, cliffs and ridges still cast broad shadows.
   */
  private buildTerrainShadowProxy(): void {
    const T = this.terrain
    const f = 3
    const M = Math.floor((T.N - 1) / f) + 1
    const pos = new Float32Array(M * M * 3)
    for (let j = 0; j < M; j += 1) {
      for (let i = 0; i < M; i += 1) {
        const fi = Math.min(T.N - 1, i * f)
        const fj = Math.min(T.N - 1, j * f)
        let h = Infinity
        for (let dj = -f; dj <= f; dj += 1) {
          for (let di = -f; di <= f; di += 1) {
            const ii = Math.min(T.N - 1, Math.max(0, fi + di))
            const jj = Math.min(T.N - 1, Math.max(0, fj + dj))
            h = Math.min(h, T.heights[jj * T.N + ii])
          }
        }
        const k = (j * M + i) * 3
        pos[k] = -WORLD.half + fi * T.step
        pos[k + 1] = h - 0.25
        pos[k + 2] = -WORLD.half + fj * T.step
      }
    }
    const idx = new Uint32Array((M - 1) * (M - 1) * 6)
    let o = 0
    for (let j = 0; j < M - 1; j += 1) {
      for (let i = 0; i < M - 1; i += 1) {
        const a = j * M + i
        const b = a + 1
        const c = a + M
        const d = c + 1
        idx[o++] = a; idx[o++] = c; idx[o++] = b
        idx[o++] = b; idx[o++] = c; idx[o++] = d
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setIndex(new THREE.BufferAttribute(idx, 1))
    g.computeBoundingSphere()
    const proxy = new THREE.Mesh(g, PROXY_MAT)
    proxy.castShadow = true
    proxy.receiveShadow = false
    this.root.add(proxy)
    this.tag('terrainShadow', proxy)
  }
  private buildTerrainMesh(): void {
    const T = this.terrain
    const N = T.N
    const pos = new Float32Array(N * N * 3)
    const colr = new Float32Array(N * N * 3)
    const glow = new Float32Array(N * N)
    const c = new THREE.Color()
    for (let j = 0; j < N; j += 1) {
      for (let i = 0; i < N; i += 1) {
        const k = j * N + i
        const x = -WORLD.half + i * T.step
        const z = -WORLD.half + j * T.step
        const h = T.heights[k]
        pos[k * 3] = x
        pos[k * 3 + 1] = h
        pos[k * 3 + 2] = z
        const { glow: g } = this.groundColor(x, z, h, T.slopeAt(x, z), T.trail[k], c)
        colr[k * 3] = c.r
        colr[k * 3 + 1] = c.g
        colr[k * 3 + 2] = c.b
        glow[k] = g
      }
    }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6)
    let o = 0
    for (let j = 0; j < N - 1; j += 1) {
      for (let i = 0; i < N - 1; i += 1) {
        const a = j * N + i
        const b = a + 1
        const cc = a + N
        const d = cc + 1
        idx[o++] = a
        idx[o++] = cc
        idx[o++] = b
        idx[o++] = b
        idx[o++] = cc
        idx[o++] = d
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(colr, 3))
    g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1))
    g.setIndex(new THREE.BufferAttribute(idx, 1))
    g.computeVertexNormals()
    g.computeBoundingSphere()
    const mesh = new THREE.Mesh(g, terrainMaterial())
    mesh.receiveShadow = true
    // The full terrain (~230k tris) is a receiver only; a 1/3-resolution shadow-only proxy casts instead.
    mesh.castShadow = false
    this.root.add(mesh)
    this.tag('terrain', mesh)
    if (this.q !== 'low') this.buildTerrainShadowProxy()
  }

  private buildWater(): void {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000, 1, 1).rotateX(-Math.PI / 2), waterMaterial(this.heights, WORLD.sea, { shallow: '#5fe3cf', mid: '#1f9fc4', deep: '#145c9a' }))
    sea.renderOrder = 2
    this.root.add(sea)
    this.tag('sea', sea)
    // Hot-spring pool that feeds the falls.
    const F = this.terrain.falls
    const pool = new THREE.Mesh(new THREE.CircleGeometry(19, 40).rotateX(-Math.PI / 2), waterMaterial(this.heights, F.poolY, { shallow: '#8ff5e6', mid: '#34c6c8', deep: '#1c8fa8' }, 0.7))
    pool.position.set(F.pool.x, F.poolY, F.pool.z)
    pool.renderOrder = 2
    this.root.add(pool)
    this.tag('pool', pool)
    for (let i = 0; i < 3; i += 1) this.puffs.add({ x: F.pool.x + (i - 1) * 6, y: F.poolY + 0.3, z: F.pool.z + (i - 1) * 3, rate: 3, spread: 8, vel: [0.3, 1.2, 0], size: [3, 6], life: 4, color: new THREE.Color('#f4fbff'), alpha: 0.28 })
    // Lava lake in the crater.
    const lava = new THREE.Mesh(new THREE.CircleGeometry(47, 64).rotateX(-Math.PI / 2), lavaMaterial(this.heights, WORLD.lava))
    lava.position.set(VOLCANO.x, WORLD.lava, VOLCANO.z)
    this.root.add(lava)
    this.tag('lava', lava)
    this.lavaLight = new THREE.PointLight('#ff6a2a', 320, 150, 1.4)
    this.lavaLight.position.set(VOLCANO.x, WORLD.lava + 14, VOLCANO.z)
    this.root.add(this.lavaLight)
    this.buildWaterfall()
  }

  private buildWaterfall(): void {
    const T = this.terrain
    const F = T.falls
    const width = 9
    const rows: [number, number][] = []
    let t = 0
    const y0 = F.poolY
    const z0 = F.top.z
    for (let s = 0; s < 60; s += 1) {
      const z = z0 + 2.2 * t
      let y = y0 - 0.5 * 9.8 * t * t
      y = Math.max(y, T.heightAt(F.top.x, z) + 0.4)
      rows.push([y, z])
      if (y < 0.4) break
      t += 0.06
    }
    const g = new THREE.BufferGeometry()
    const pos: number[] = []
    const uv: number[] = []
    const index: number[] = []
    rows.forEach(([y, z], i) => {
      for (let k = 0; k <= 4; k += 1) {
        const u = k / 4
        pos.push(F.top.x + (u - 0.5) * width * (1 + i * 0.01), y, z + Math.sin(u * Math.PI) * 0.6)
        uv.push(u, i / (rows.length - 1))
      }
      if (i > 0) {
        for (let k = 0; k < 4; k += 1) {
          const a = (i - 1) * 5 + k
          const b = i * 5 + k
          index.push(a, b, a + 1, a + 1, b, b + 1)
        }
      }
    })
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(index)
    const mesh = new THREE.Mesh(g, waterfallMaterial())
    mesh.renderOrder = 3
    this.root.add(mesh)
    this.tag('waterfall', mesh)
    const [, zb] = rows[rows.length - 1]
    this.puffs.add({ x: F.top.x, y: 0.6, z: zb + 1, rate: 14, spread: 8, vel: [0, 2.2, 1.2], size: [3, 7], life: 2.6, color: new THREE.Color('#ffffff'), alpha: 0.45 })
  }

  // ── landmarks ──
  private rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true })

  private addStatic(geo: THREE.BufferGeometry, x: number, y: number, z: number, rotY = 0, scale = 1, mat: THREE.Material = this.rockMat): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.rotation.y = rotY
    m.scale.setScalar(scale)
    m.castShadow = true
    m.receiveShadow = true
    this.root.add(m)
    this.tag('landmarks', m)
    return m
  }

  private buildLandmarks(): void {
    const T = this.terrain
    const C = this.colliders
    // Titan's Ribs on the south beach.
    const rb = POI.ribs
    this.addStatic(P.titanRibs(), rb.x, T.heightAt(rb.x, rb.z) - 0.8, rb.z, 0.6)
    for (let i = 0; i < 6; i += 1) {
      const d = -14 + i * 5
      C.add(rb.x + Math.sin(0.6) * d, rb.z + Math.cos(0.6) * d, 1.2)
    }
    // Whale Arch in the south-east shallows.
    this.addStatic(P.seaArch(), POI.seaArch.x, 0, POI.seaArch.z, -0.5)
    // The Old Canopy.
    const et = POI.elderTree
    const elder = new THREE.Mesh(P.elderTree(), windify(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0.012, 28))
    elder.position.set(et.x, T.heightAt(et.x, et.z) - 0.5, et.z)
    elder.castShadow = true
    elder.receiveShadow = true
    this.root.add(elder)
    C.add(et.x, et.z, 2.4)
    this.reserved.add(et.x, et.z, 16)

    // Sunken Ruins arena: ring of columns, arches and guardian heads.
    const ar = ARENAS.ruins
    const y0 = T.heightAt(ar.x, ar.z)
    const gemMat = new THREE.MeshStandardMaterial({ color: '#ffb23e', emissive: '#ff9a1f', emissiveIntensity: 0.9, roughness: 0.7 })
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2
      if (i % 4 === 1) continue // gaps to enter
      const rr = ar.radius + 1.5
      const x = ar.x + Math.cos(a) * rr
      const z = ar.z + Math.sin(a) * rr
      this.addStatic(P.ruinColumn(100 + i, i % 3 !== 0), x, T.heightAt(x, z) - 0.2, z, a)
      C.add(x, z, 0.95)
    }
    for (const a of [Math.PI * 0.25 + Math.PI / 8, Math.PI * 1.25 + Math.PI / 8]) {
      const rr = ar.radius + 9
      const x = ar.x + Math.cos(a) * rr
      const z = ar.z + Math.sin(a) * rr
      this.addStatic(P.ruinArch(), x, T.heightAt(x, z) - 0.2, z, -a + Math.PI / 2)
      C.add(x + Math.cos(a + Math.PI / 2) * 3.2, z + Math.sin(a + Math.PI / 2) * 3.2, 1)
      C.add(x - Math.cos(a + Math.PI / 2) * 3.2, z - Math.sin(a + Math.PI / 2) * 3.2, 1)
    }
    for (const a of [Math.PI * 0.85, Math.PI * 1.75]) {
      const rr = ar.radius + 7
      const x = ar.x + Math.cos(a) * rr
      const z = ar.z + Math.sin(a) * rr
      const head = this.addStatic(P.guardianHead(), x, T.heightAt(x, z) - 0.4, z, -a - Math.PI / 2, 1.9)
      for (const ex of [-0.8, 0.8]) {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), gemMat)
        gem.position.set(ex, 2.75, 1.5)
        head.add(gem)
      }
      C.add(x, z, 3.6)
    }
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2 + 0.3
      const rr = ar.radius + 14 + (i % 3) * 6
      const x = ar.x + Math.cos(a) * rr
      const z = ar.z + Math.sin(a) * rr
      if (!T.walkable(x, z)) continue
      this.addStatic(i % 2 ? P.ruinWall(200 + i) : P.standingStone(300 + i), x, T.heightAt(x, z) - 0.3, z, a + Math.PI / 2)
      C.add(x, z, i % 2 ? 2.8 : 1.1)
    }
    // broken paving in the arena
    const pave: THREE.BufferGeometry[] = []
    const pr = rng(66)
    for (let i = 0; i < 70; i += 1) {
      const a = pr() * Math.PI * 2
      const d = Math.sqrt(pr()) * ar.radius
      pave.push(P.part(new THREE.BoxGeometry(1.6 + pr(), 0.3, 1.4 + pr()), new THREE.Color('#c9bfa2').lerp(new THREE.Color('#9e9478'), pr()), [ar.x + Math.cos(a) * d, y0 + 0.02, ar.z + Math.sin(a) * d], [0, pr() * 3, 0]))
    }
    const paveMesh = new THREE.Mesh(P.merge(pave), this.rockMat)
    paveMesh.receiveShadow = true
    this.root.add(paveMesh)

    // Stonefingers: a cluster of tall banded spires.
    const sf = POI.stonefingers
    const sr = rng(77)
    for (let i = 0; i < 8; i += 1) {
      const a = sr() * Math.PI * 2
      const d = 6 + sr() * 26
      const x = sf.x + Math.cos(a) * d
      const z = sf.z + Math.sin(a) * d
      const h = 22 + sr() * 26
      const w = 9 + sr() * 7
      const m = this.addStatic(P.spire(400 + i), x, T.heightAt(x, z) - 1, z, sr() * 3)
      m.scale.set(w, h, w)
      C.add(x, z, 0.22 * w)
      this.reserved.add(x, z, 0.3 * w)
    }
    // Steamvents: geysers that erupt on a rhythm.
    const sv = POI.steamvents
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2 + 0.4
      const x = sv.x + Math.cos(a) * (8 + (i % 2) * 7)
      const z = sv.z + Math.sin(a) * (8 + (i % 2) * 7)
      const y = T.heightAt(x, z)
      this.addStatic(P.geyserVent(500 + i), x, y - 0.3, z, 0, 0.9 + (i % 3) * 0.2)
      C.add(x, z, 1.0)
      this.reserved.add(x, z, 3.5)
      this.geysers.push(this.puffs.add({ x, y: y + 0.8, z, rate: 38, spread: 1.2, vel: [0, 12, 0], size: [2, 4], life: 1.6, color: new THREE.Color('#ffffff'), alpha: 0.55, period: 7 + i * 1.3, on: 2.2, phase: i * 2.1 }))
      this.puffs.add({ x, y: y + 0.8, z, rate: 1.5, spread: 1, vel: [0, 1.5, 0], size: [2, 3], life: 3, color: new THREE.Color('#f5f5f0'), alpha: 0.25 })
    }
    // Crater smoke vents and rim haze.
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2
      const x = VOLCANO.x + Math.cos(a) * 30
      const z = VOLCANO.z + Math.sin(a) * 30
      this.puffs.add({ x, y: WORLD.lava + 1, z, rate: 2.2, spread: 6, vel: [0.6, 3.5, 0], size: [5, 10], life: 5, color: new THREE.Color('#5a4a46'), alpha: 0.35 })
    }
  }

  // ── scatter ──
  private defineScatter(): void {
    const lam = (side: THREE.Side = THREE.DoubleSide) => new THREE.MeshLambertMaterial({ vertexColors: true, side })
    const tree = windify(lam(), 0.018, 10)
    const plant = windify(lam(), 0.1, 1.6)
    const grass = windify(lam(), 0.32, 0.9, 0.02)
    const tallGrass = windify(lam(), 0.3, 1.3, 0.02)
    const obsidian = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, flatShading: true, emissive: '#1a0b2e', emissiveIntensity: 0.25 })
    const def = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean, cull: number) =>
      this.scatter.set(name, { geo, mat, shadow, cull, items: new Map() })
    const d = this.density
    const near = (m: number) => m * (0.7 + d * 0.3)
    for (let v = 0; v < 3; v += 1) def(`palm${v}`, P.palmTree(10 + v), tree, true, 0)
    for (let v = 0; v < 3; v += 1) def(`jungle${v}`, P.jungleTree(20 + v), tree, true, 0)
    for (let v = 0; v < 2; v += 1) def(`acacia${v}`, P.acacia(30 + v), tree, true, 0)
    def('fern', P.fern(40), plant, false, near(150))
    def('bigleaf', P.bigLeafPlant(41), plant, false, near(150))
    def('bushJ', P.bush(42, ['#2f7433', '#3f9440', '#58ad48']), plant, this.q === 'high', near(230))
    def('bushH', P.bush(43, ['#6d7a2e', '#98a043', '#b7a64a']), plant, this.q === 'high', near(230))
    def('grassJ', P.grassTuft(44, 0.65, '#2f6b2a', '#8fd35a'), grass, false, near(95))
    def('grassH', P.grassTuft(45, 1.05, '#8d6a2c', '#f2d27a', 8), tallGrass, false, near(95))
    def('grassC', P.grassTuft(46, 0.5, '#3a302a', '#8a7a58', 5), grass, false, near(80))
    def('flowerP', P.flower(47, '#ff7eb3', '#ffe35a'), plant, false, near(110))
    def('flowerY', P.flower(48, '#ffd23f', '#ff8a2a'), plant, false, near(110))
    def('flowerW', P.flower(49, '#f4f0ff', '#ffd23f'), plant, false, near(110))
    def('reeds', P.reeds(50), plant, false, near(140))
    def('mushroom', P.mushrooms(51), plant, false, near(90))
    def('drift', P.driftwood(52), this.rockMat, true, near(160))
    def('rockC', P.boulder(53, '#8b8274', '#6fa04e', '#5e574d'), this.rockMat, true, 0)
    def('rockH', P.boulder(54, '#c98a55', '#e6c07a', '#8a5234'), this.rockMat, true, 0)
    def('rockK', P.boulder(55, '#4a403b', '#5d534c', '#2a2422'), this.rockMat, true, 0)
    def('basalt', P.basaltCluster(56), this.rockMat, true, 0)
    def('obsidian', P.obsidianSpikes(57), obsidian, true, 0)
    def('deadtree', P.deadTree(58), lam(THREE.FrontSide), true, 0)
    def('ruinCol', P.ruinColumn(59, true), this.rockMat, true, 0)
  }

  private place(name: string, x: number, y: number, z: number, rotY: number, sx: number, sy = sx, sz = sx, tint?: THREE.Color, tilt?: [number, number]): { key: number; idx: number; m: THREE.Matrix4 } | null {
    const def = this.scatter.get(name)
    if (!def) return null
    const ci = Math.floor((x + WORLD.half) / CHUNK)
    const cj = Math.floor((z + WORLD.half) / CHUNK)
    const key = ci * 100 + cj
    let bucket = def.items.get(key)
    if (!bucket) def.items.set(key, (bucket = { m: [], c: [] }))
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt?.[0] ?? 0, rotY, tilt?.[1] ?? 0))
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz))
    bucket.m.push(m)
    bucket.c.push(tint ?? new THREE.Color(1, 1, 1))
    return { key, idx: bucket.m.length - 1, m }
  }

  /** Place a choppable tree / mineable boulder with its collider and record it. */
  private placeHarvest(kind: 'tree' | 'rock', name: string, x: number, y: number, z: number, rotY: number, sx: number, sy: number, sz: number, tint: THREE.Color | undefined, colR: number): void {
    const r = this.place(name, x, y, z, rotY, sx, sy, sz, tint)
    if (!r) return
    const def = this.scatter.get(name)!
    def.geo.computeBoundingBox()
    const bb = def.geo.boundingBox!
    this.harvestables.push({
      id: this.harvestables.length, kind, def: name, key: r.key, idx: r.idx, x, y, z, yaw: rotY, s: (sx + sy + sz) / 3,
      height: (bb.max.y - bb.min.y) * sy, radius: Math.max(colR, kind === 'rock' ? Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * sx * 0.45 : colR),
      col: this.colliders.add(x, z, colR), colR, matrix: r.m,
    })
  }

  /** Overwrite one harvestable instance's matrix in every chunk mesh that draws it (near parts + far LOD). */
  setHarvestMatrix(rec: HarvestRec, m: THREE.Matrix4): void {
    for (const c of this.chunks) {
      if (c.key !== rec.key || c.name !== rec.def || rec.idx >= c.mesh.count) continue
      c.mesh.setMatrixAt(rec.idx, m)
      c.mesh.instanceMatrix.needsUpdate = true
    }
  }

  /** Live quality switch: detail radius + shadow-map resolution (the renderer handles shadows/bloom/pixel ratio). */
  setQuality(q: SceneryQuality): void {
    if (q === this.q) return
    this.q = q
    this.detail = DETAIL[q]
    const size = q === 'high' ? 2048 : 1024
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size)
      this.sun.shadow.map?.dispose()
      this.sun.shadow.map = null
    }
  }
  /** Geometry/material/colour of each visible part of a harvestable (detailed model if streamed in). */
  harvestParts(rec: HarvestRec): { geo: THREE.BufferGeometry; mat: THREE.Material; color: THREE.Color }[] {
    const all = this.chunks.filter(c => c.key === rec.key && c.name === rec.def && rec.idx < c.mesh.count && !c.proxy)
    const near = all.filter(c => !c.far)
    return (near.length ? near : all).map(c => {
      const color = new THREE.Color(1, 1, 1)
      if (c.mesh.instanceColor) c.mesh.getColorAt(rec.idx, color)
      return { geo: c.mesh.geometry, mat: c.mesh.material as THREE.Material, color }
    })
  }

  private populate(): void {
    const T = this.terrain
    const C = this.colliders
    const r = rng(1234)
    const d = this.density
    const pick = (w: { coast: number; highlands: number; caldera: number }) => {
      const v = r()
      if (v < w.coast) return 'coast'
      if (v < w.coast + w.highlands) return 'highlands'
      return 'caldera'
    }
    const blocked = (x: number, z: number, rad: number) => {
      if (Math.hypot(x - POI.camp.x, z - POI.camp.z) < 24) return true
      if (Math.hypot(x - ARENAS.ruins.x, z - ARENAS.ruins.z) < ARENAS.ruins.radius + 3) return true
      if (Math.hypot(x - ARENAS.wyrm.x, z - ARENAS.wyrm.z) < ARENAS.wyrm.radius + 2) return true
      if (Math.hypot(x - POI.ribs.x, z - POI.ribs.z) < 26) return true
      if (Math.hypot(x - T.falls.lagoon.x, z - T.falls.lagoon.z) < 20) return true
      if (Math.hypot(x - T.falls.pool.x, z - T.falls.pool.z) < 17) return true
      return !C.clear(x, z, rad) || !this.reserved.clear(x, z, rad)
    }
    const tint = (base: number, spread: number) => new THREE.Color().setHSL(0, 0, 1).multiplyScalar(base + (r() - 0.5) * spread)
    const hue = (h: number, s: number, l: number) => new THREE.Color().setHSL(h, s, l)

    // Pass 1: trees and large rocks.
    const cell1 = 6.2
    for (let gz = -WORLD.half; gz < WORLD.half; gz += cell1) {
      for (let gx = -WORLD.half; gx < WORLD.half; gx += cell1) {
        const x = gx + r() * cell1
        const z = gz + r() * cell1
        const h = T.heightAt(x, z)
        if (h < 0.5 || T.isLava(x, z)) continue
        const slope = T.slopeAt(x, z)
        const trail = T.trailAt(x, z)
        const region = pick(T.regionWeights(x, z))
        const f = this.forest(x, z)
        if (slope > 0.95) {
          // Cliff dressing: big rocks embedded in steep faces break up stretched triangles.
          if (r() < 0.2 && !blocked(x, z, 0)) {
            const s = 1.4 + r() * 2
            const name = region === 'coast' ? 'rockC' : region === 'highlands' ? 'rockH' : 'rockK'
            this.place(name, x, h - s * 0.6, z, r() * 6, s, s * (0.7 + r() * 0.6), s, tint(1, 0.2))
          }
          continue
        }
        if (trail > 0.2) continue
        if (region === 'coast') {
          const beach = 1 - smoothstep(1.6, 5.5, h)
          const jungle = smoothstep(-0.3, 0.25, f) * (1 - beach)
          const v = r()
          if (v < beach * 0.4 + 0.03) {
            if (blocked(x, z, 1)) continue
            const s = 0.85 + r() * 0.4
            this.placeHarvest('tree', `palm${Math.floor(r() * 3)}`, x, h - 0.2, z, r() * 6, s, s, s, tint(1, 0.25), 0.45 * s)
          } else if (v < beach * 0.4 + 0.03 + jungle * 0.78) {
            if (blocked(x, z, 1.5)) continue
            const s = 0.8 + r() * 0.55
            this.placeHarvest('tree', `jungle${Math.floor(r() * 3)}`, x, h - 0.3, z, r() * 6, s, s * (0.9 + r() * 0.3), s, hue(0.3 + (r() - 0.5) * 0.06, 0.25, 0.5 + r() * 0.12).lerp(new THREE.Color(1, 1, 1), 0.55), 0.62 * s)
          } else if (v > 0.955) {
            if (blocked(x, z, 1.5)) continue
            const s = 0.7 + r() * 1.3
            this.placeHarvest('rock', 'rockC', x, h - 0.2, z, r() * 6, s, s, s, tint(1, 0.2), 1.0 * s)
          }
        } else if (region === 'highlands') {
          const v = r()
          if (v < 0.045 + smoothstep(0.1, 0.6, f) * 0.08) {
            if (blocked(x, z, 1.5)) continue
            const s = 0.9 + r() * 0.45
            this.placeHarvest('tree', `acacia${Math.floor(r() * 2)}`, x, h - 0.2, z, r() * 6, s, s, s, tint(1, 0.2), 0.4 * s)
          } else if (v > 0.93) {
            if (blocked(x, z, 1.5)) continue
            const s = 0.7 + r() * 1.6
            this.placeHarvest('rock', 'rockH', x, h - 0.2, z, r() * 6, s, s * (0.7 + r() * 0.6), s, tint(1, 0.2), 1.0 * s)
          } else if (v > 0.925 && T.plateauAt(x, z) > 0.9) {
            if (blocked(x, z, 1.5)) continue
            this.place('ruinCol', x, h - 0.2, z, r() * 6, 0.8 + r() * 0.3)
            C.add(x, z, 0.9)
          }
        } else {
          const dv = T.volcanoDistance(x, z)
          const v = r()
          if (blocked(x, z, 1.5)) continue
          if (dv > 100) {
            if (v < 0.06) {
              const s = 0.8 + r() * 0.5
              this.placeHarvest('tree', 'deadtree', x, h - 0.1, z, r() * 6, s, s, s, undefined, 0.3)
            } else if (v > 0.93) {
              const s = 0.7 + r() * 1.5
              this.placeHarvest('rock', 'rockK', x, h - 0.2, z, r() * 6, s, s, s, tint(1, 0.2), 1.0 * s)
            }
          } else {
            if (v < 0.06) {
              const s = 0.8 + r() * 0.8
              this.place('basalt', x, h - 0.3, z, r() * 6, s, s * (0.8 + r() * 0.8), s)
              C.add(x, z, 1.2 * s)
            } else if (v < 0.13) {
              const s = 0.8 + r() * 1.1
              this.place('obsidian', x, h - 0.2, z, r() * 6, s)
              C.add(x, z, 0.7 * s)
            } else if (v > 0.95) {
              const s = 0.6 + r() * 1.2
              this.placeHarvest('rock', 'rockK', x, h - 0.2, z, r() * 6, s, s, s, tint(1, 0.2), 1.0 * s)
            }
          }
        }
      }
    }
    // Crater ring of obsidian around the wyrm arena.
    for (let i = 0; i < 26; i += 1) {
      const a = (i / 26) * Math.PI * 2
      const rr = ARENAS.wyrm.radius + 3 + r() * 4
      const x = ARENAS.wyrm.x + Math.cos(a) * rr
      const z = ARENAS.wyrm.z + Math.sin(a) * rr
      if (T.isLava(x, z) || T.trailAt(x, z) > 0.1) continue
      const s = 1 + r() * 1.4
      this.place('obsidian', x, T.heightAt(x, z) - 0.2, z, r() * 6, s)
      C.add(x, z, 0.7 * s)
    }

    // Starter harvestables: guarantee trees and boulders a short walk from camp.
    const nearCamp = (kind: 'tree' | 'rock') => this.harvestables.filter(h => h.kind === kind && Math.hypot(h.x - POI.camp.x, h.z - POI.camp.z) < 50).length
    const starter = (kind: 'tree' | 'rock', want: number) => {
      for (let tries = 0; tries < 400 && nearCamp(kind) < want; tries += 1) {
        const a = r() * Math.PI * 2
        const dd = 27 + r() * 20
        const x = POI.camp.x + Math.cos(a) * dd
        const z = POI.camp.z + Math.sin(a) * dd
        const h = T.heightAt(x, z)
        if (h < 1.8 || T.slopeAt(x, z) > 0.6 || T.trailAt(x, z) > 0.15 || !C.clear(x, z, 2.2) || !this.reserved.clear(x, z, 2)) continue
        const s = 0.8 + r() * 0.4
        if (kind === 'rock') this.placeHarvest('rock', 'rockC', x, h - 0.2, z, r() * 6, s, s * 0.85, s, tint(1, 0.2), 1.0 * s)
        else this.placeHarvest('tree', `jungle${Math.floor(r() * 3)}`, x, h - 0.3, z, r() * 6, s, s, s, hue(0.3, 0.25, 0.55).lerp(new THREE.Color(1, 1, 1), 0.55), 0.62 * s)
      }
    }
    starter('rock', 6)
    starter('tree', 8)

    // Pass 2: understory.
    const cell2 = 2.6 / Math.sqrt(d)
    for (let gz = -WORLD.half; gz < WORLD.half; gz += cell2) {
      for (let gx = -WORLD.half; gx < WORLD.half; gx += cell2) {
        const x = gx + r() * cell2
        const z = gz + r() * cell2
        const h = T.heightAt(x, z)
        if (h < -0.4) continue
        const slope = T.slopeAt(x, z)
        if (slope > 0.9 || T.isLava(x, z)) continue
        const trail = T.trailAt(x, z)
        if (trail > 0.35) continue
        const region = pick(T.regionWeights(x, z))
        const f = this.forest(x, z)
        const v = r()
        if (region === 'coast') {
          if (h < 1.3) {
            if (h > -0.3 && v < 0.2 && !blocked(x, z, 0.3)) this.place('reeds', x, h - 0.1, z, r() * 6, 0.8 + r() * 0.5)
            continue
          }
          if (h < 2.4) {
            if (v < 0.012 && !blocked(x, z, 0.8)) this.place('drift', x, h, z, r() * 6, 0.8 + r() * 0.5)
            continue
          }
          if (blocked(x, z, 0.4)) continue
          const inForest = f > -0.15
          if (inForest) {
            if (v < 0.3) this.place('fern', x, h - 0.05, z, r() * 6, 0.9 + r() * 0.9, undefined, undefined, hue(0.3, 0.3, 0.5 + r() * 0.2).lerp(new THREE.Color(1, 1, 1), 0.6))
            else if (v < 0.48) this.place('bigleaf', x, h - 0.05, z, r() * 6, 0.9 + r() * 0.9)
            else if (v < 0.6) this.place('bushJ', x, h - 0.1, z, r() * 6, 0.8 + r() * 0.8, undefined, undefined, tint(1, 0.3))
            else if (v < 0.65) this.place('mushroom', x, h - 0.02, z, r() * 6, 0.9 + r() * 0.8)
          } else {
            if (v < 0.07) this.place('bushJ', x, h - 0.1, z, r() * 6, 0.7 + r() * 0.7, undefined, undefined, tint(1.05, 0.3))
            else if (v < 0.19) this.place(['flowerP', 'flowerY', 'flowerW'][Math.floor(r() * 3)], x, h - 0.02, z, r() * 6, 1 + r() * 0.8)
            else if (v < 0.24) this.place('fern', x, h - 0.05, z, r() * 6, 0.8 + r() * 0.6)
          }
        } else if (region === 'highlands') {
          if (blocked(x, z, 0.4)) continue
          if (v < 0.06) this.place('bushH', x, h - 0.1, z, r() * 6, 0.8 + r() * 0.9, undefined, undefined, tint(1, 0.3))
          else if (v < 0.1) this.place(r() > 0.5 ? 'flowerY' : 'flowerW', x, h - 0.02, z, r() * 6, 1 + r() * 0.6)
          else if (v < 0.118) {
            const s = 0.25 + r() * 0.45
            this.place('rockH', x, h - 0.05, z, r() * 6, s, s, s, tint(1, 0.2))
          }
        } else {
          if (blocked(x, z, 0.4)) continue
          if (v < 0.035) {
            const s = 0.25 + r() * 0.5
            this.place('rockK', x, h - 0.05, z, r() * 6, s, s, s, tint(1, 0.3))
          }
        }
      }
    }

    // Pass 3: grass carpet.
    const cell3 = (this.q === 'high' ? 1.35 : this.q === 'medium' ? 1.75 : 2.4)
    for (let gz = -WORLD.half; gz < WORLD.half; gz += cell3) {
      for (let gx = -WORLD.half; gx < WORLD.half; gx += cell3) {
        const x = gx + r() * cell3
        const z = gz + r() * cell3
        const h = T.heightAt(x, z)
        if (h < 2) continue
        const slope = T.slopeAt(x, z)
        if (slope > 0.85) continue
        const trail = T.trailAt(x, z)
        const region = pick(T.regionWeights(x, z))
        const v = r()
        if (region === 'coast') {
          const f = this.forest(x, z)
          if (v > (f > 0 ? 0.35 : 0.8) * (1 - trail * 0.8)) continue
          if (Math.hypot(x - POI.camp.x, z - POI.camp.z) < 12) continue
          this.place('grassJ', x, h - 0.05, z, r() * 6, 0.8 + r() * 0.7, 0.7 + r() * 0.8, undefined, hue(0.25 + (r() - 0.5) * 0.08, 0.35, 0.55 + r() * 0.15).lerp(new THREE.Color(1, 1, 1), 0.55))
        } else if (region === 'highlands') {
          if (v > 0.88 * (1 - trail * 0.85)) continue
          if (Math.hypot(x - ARENAS.ruins.x, z - ARENAS.ruins.z) < ARENAS.ruins.radius - 4) continue
          this.place('grassH', x, h - 0.05, z, r() * 6, 0.8 + r() * 0.6, 0.7 + r() * 0.7, undefined, hue(0.1 + (r() - 0.5) * 0.05, 0.4, 0.6 + r() * 0.15).lerp(new THREE.Color(1, 1, 1), 0.5))
        } else {
          const dv = T.volcanoDistance(x, z)
          if (dv < 100 || v > 0.3) continue
          this.place('grassC', x, h - 0.05, z, r() * 6, 0.8 + r() * 0.6)
        }
      }
    }
  }

  /** Hook every catalog swap to the staged asset store (fires immediately if already loaded). */
  private hookSwaps(): void {
    for (const sw of SWAPS) assets.onGltf(sw.model, g => this.upgradeScatter(sw, g))
  }

  /**
   * Replace a procedural scatter def with a textured catalog model while keeping every
   * placement, tint and collider. Trees/rocks keep the procedural mesh as a far LOD.
   */
  private upgradeScatter(sw: Swap, gltf: GLTF): void {
    const def = this.scatter.get(sw.def)
    const olds = this.chunks.filter(c => c.name === sw.def && !c.far)
    if (!def || !olds.length) return
    def.geo.computeBoundingBox()
    const bp = def.geo.boundingBox!
    const hp = bp.max.y - bp.min.y
    gltf.scene.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(gltf.scene)
    const k = (hp / Math.max(0.01, box.max.y - box.min.y)) * (sw.fit ?? 1)
    const norm = new THREE.Matrix4().makeScale(k, k, k)
    const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = []
    gltf.scene.traverse(n => {
      const m = n as THREE.Mesh
      if (!m.isMesh) return
      const src = m.material as THREE.MeshStandardMaterial
      // meshopt-quantized attributes are normalized ints: dequantize before baking transforms.
      const geo = new THREE.BufferGeometry()
      for (const key of ['position', 'normal', 'uv'] as const) {
        const at = m.geometry.getAttribute(key)
        if (!at) continue
        const out = new Float32Array(at.count * at.itemSize)
        for (let i = 0; i < at.count; i += 1) for (let c = 0; c < at.itemSize; c += 1) out[i * at.itemSize + c] = at.getComponent(i, c)
        geo.setAttribute(key, new THREE.BufferAttribute(out, at.itemSize))
      }
      if (m.geometry.index) geo.setIndex(Array.from(m.geometry.index.array))
      geo.applyMatrix4(m.matrixWorld).applyMatrix4(norm)
      const tex = src.map
      // Bake KHR_texture_transform (used by UV quantization) into the UVs so the shared map stays plain.
      if (tex && geo.getAttribute('uv')) {
        tex.updateMatrix()
        const uv = geo.getAttribute('uv') as THREE.BufferAttribute
        const v2 = new THREE.Vector2()
        for (let i = 0; i < uv.count; i += 1) { v2.fromBufferAttribute(uv, i).applyMatrix3(tex.matrix); uv.setXY(i, v2.x, v2.y) }
        tex.offset.set(0, 0); tex.repeat.set(1, 1); tex.rotation = 0; tex.updateMatrix()
      }
      const cut = src.alphaTest > 0 || src.transparent
      const mat = new THREE.MeshLambertMaterial({
        // Untextured catalog parts carry their look in the base colour: keep it (times the swap tint).
        map: src.map, color: src.map ? new THREE.Color(sw.color ?? '#ffffff') : src.color.clone().multiply(new THREE.Color(sw.color ?? '#ffffff')),
        alphaTest: cut ? 0.45 : 0,
        side: cut ? THREE.DoubleSide : THREE.FrontSide,
      })
      if (sw.wind) windify(mat, sw.wind[0], hp * (sw.fit ?? 1) * sw.wind[1], sw.wind[2] ?? 0)
      parts.push({ geo, mat })
    })
    const white = new THREE.Color(1, 1, 1)
    const tmp = new THREE.Color()
    for (const old of olds) {
      const n = old.mesh.count
      for (const part of parts) {
        const mesh = new THREE.InstancedMesh(part.geo, part.mat, n)
        mesh.instanceMatrix.array.set(old.mesh.instanceMatrix.array)
        for (let i = 0; i < n; i += 1) {
          if (old.mesh.instanceColor) old.mesh.getColorAt(i, tmp)
          else tmp.set(1, 1, 1)
          mesh.setColorAt(i, tmp.lerp(white, sw.whiten ?? 0))
        }
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        mesh.computeBoundingSphere()
        // LOD'd trees/rocks cast through a low-poly proxy instead (a detailed canopy costs 3-7k tris per shadow).
        mesh.castShadow = (sw.shadow ?? false) && !sw.lod
        mesh.receiveShadow = true
        this.root.add(mesh)
        this.chunks.push({ mesh, x: old.x, z: old.z, cull: sw.near ?? old.cull, name: sw.def, key: old.key, swap: true })
      }
      if (sw.lod && sw.shadow) {
        const proxy = new THREE.InstancedMesh(old.mesh.geometry, PROXY_MAT, n)
        proxy.instanceMatrix.array.set(old.mesh.instanceMatrix.array)
        proxy.instanceMatrix.needsUpdate = true
        proxy.computeBoundingSphere()
        proxy.castShadow = true
        proxy.receiveShadow = false
        this.root.add(proxy)
        // Fixed radius (not quality-scaled): must cover the whole shadow box around the player.
        this.chunks.push({ mesh: proxy, x: old.x, z: old.z, cull: 68, name: sw.def, key: old.key, proxy: true })
      }
      if (sw.lod) {
        old.far = true
        old.swap = true
        old.cull = sw.near ?? 200
        old.mesh.castShadow = false
      } else {
        this.root.remove(old.mesh)
        old.mesh.dispose()
        this.chunks.splice(this.chunks.indexOf(old), 1)
      }
    }
  }

  private finishScatter(): void {
    for (const [name, def] of this.scatter) {
      for (const [key, bucket] of def.items) {
        const mesh = new THREE.InstancedMesh(def.geo, def.mat, bucket.m.length)
        bucket.m.forEach((m, i) => {
          mesh.setMatrixAt(i, m)
          mesh.setColorAt(i, bucket.c[i])
        })
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        mesh.computeBoundingSphere()
        mesh.castShadow = def.shadow && this.q !== 'low'
        mesh.receiveShadow = true
        const ci = Math.floor(key / 100)
        const cj = key % 100
        // Ground cover draw distance scales with quality (it is the largest overdraw cost after foliage).
        this.chunks.push({ mesh, x: -WORLD.half + (ci + 0.5) * CHUNK, z: -WORLD.half + (cj + 0.5) * CHUNK, cull: def.cull, name, key, swap: /^(grass|flower)/.test(name) || undefined })
        this.root.add(mesh)
      }
      def.items.clear()
    }
  }

  // ── atmosphere ──
  private buildAtmosphere(): void {
    // Volcanic plume: a column of puffs rising and drifting from the crater.
    const count = 48
    const geo = P.blob(1, 1, 0.18, 999)
    const plume = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#3a1a10', emissiveIntensity: 0.25 }), count)
    plume.frustumCulled = false
    const r = rng(31)
    for (let i = 0; i < count; i += 1) {
      this.plumeSeeds.push({ t: i / count, a: r() * Math.PI * 2, r: r(), s: 0.7 + r() * 0.6 })
      plume.setColorAt(i, new THREE.Color('#6b625e'))
    }
    this.plume = plume
    this.root.add(plume)
    this.tag('plume', plume)
    // Floating motes around the camera: pollen, dust or embers depending on region.
    const n = this.q === 'low' ? 160 : 420
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(n * 3)
    const seed = new Float32Array(n)
    for (let i = 0; i < n; i += 1) {
      pos[i * 3] = r() * 70
      pos[i * 3 + 1] = r() * 26
      pos[i * 3 + 2] = r() * 70
      seed[i] = r()
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: WORLD_UNIFORMS.uTime, uCam: { value: new THREE.Vector3() }, uW: { value: new THREE.Vector3(1, 0, 0) }, uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; uniform vec3 uCam; uniform vec3 uW; uniform float uScale;
        varying vec3 vCol; varying float vA;
        void main(){
          vec3 box = vec3(70.0, 26.0, 70.0);
          float rise = uW.z * (1.5 + aSeed * 2.5) - uW.y * 0.2;
          vec3 drift = vec3(sin(uTime * 0.3 + aSeed * 40.0) * 1.5 + uTime * 0.6, uTime * (rise + 0.15) + sin(uTime * 0.7 + aSeed * 20.0) * 0.8, cos(uTime * 0.25 + aSeed * 30.0) * 1.5);
          vec3 p = mod(position + drift - uCam + box * 0.5, box) + uCam - box * 0.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float tw = 0.55 + 0.45 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 60.0);
          vCol = uW.x * vec3(1.0, 0.95, 0.55) + uW.y * vec3(1.0, 0.82, 0.5) * 0.8 + uW.z * vec3(1.0, 0.42, 0.1) * 1.4;
          float fade = 1.0 - smoothstep(18.0, 34.0, length(mv.xyz));
          vA = tw * fade * (0.45 + uW.z * 0.5);
          gl_PointSize = (1.5 + aSeed * 2.5 + uW.z * 1.5) * uScale / max(1.0, -mv.z) * 0.012;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol; varying float vA;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0; if (d > 1.0) discard; gl_FragColor = vec4(vCol * vA * (1.0 - d), 1.0); }`,
    })
    this.motes = new THREE.Points(g, mat)
    this.motes.frustumCulled = false
    this.motes.renderOrder = 6
    this.root.add(this.motes)
    this.tag('motes', this.motes)
  }

  private readonly tmpC = new THREE.Color()
  private readonly m4 = new THREE.Matrix4()
  private readonly v3 = new THREE.Vector3()
  private readonly q4 = new THREE.Quaternion()
  private readonly s3 = new THREE.Vector3()

  /** Per-frame: wind time, atmosphere blending, chunk culling, plume, particles, shadows follow focus. */
  update(dt: number, time: number, camera: THREE.PerspectiveCamera, focus: THREE.Vector3, pixelScale: number): void {
    WORLD_UNIFORMS.uTime.value = time
    const T = this.terrain
    const target = T.regionWeights(camera.position.x, camera.position.z)
    const k = 1 - Math.exp(-dt * 1.4)
    this.weights.coast = lerp(this.weights.coast, target.coast, k)
    this.weights.highlands = lerp(this.weights.highlands, target.highlands, k)
    this.weights.caldera = lerp(this.weights.caldera, target.caldera, k)
    const w = this.weights
    const blend = (key: keyof Atmos, out: THREE.Color) =>
      out.setRGB(0, 0, 0)
        .add(this.tmpC.copy(ATMOS.coast[key] as THREE.Color).multiplyScalar(w.coast))
        .add(this.tmpC.copy(ATMOS.highlands[key] as THREE.Color).multiplyScalar(w.highlands))
        .add(this.tmpC.copy(ATMOS.caldera[key] as THREE.Color).multiplyScalar(w.caldera))
    const num = (key: 'density' | 'sunI' | 'hemiI') => ATMOS.coast[key] * w.coast + ATMOS.highlands[key] * w.highlands + ATMOS.caldera[key] * w.caldera
    blend('fog', this.fog.color)
    this.fog.density = num('density')
    ;(this.scene.background as THREE.Color).copy(this.fog.color)
    blend('top', WORLD_UNIFORMS.uSkyTop.value)
    blend('horizon', WORLD_UNIFORMS.uSkyHorizon.value)
    blend('sun', WORLD_UNIFORMS.uSunColor.value)
    blend('sun', this.sun.color)
    this.sun.intensity = num('sunI')
    blend('hemiSky', this.hemi.color)
    blend('hemiGround', this.hemi.groundColor)
    this.hemi.intensity = num('hemiI')
    if (this.islands) (this.islands.material as THREE.MeshBasicMaterial).color.copy(WORLD_UNIFORMS.uSkyHorizon.value).multiplyScalar(0.82)
    if (this.clouds) this.clouds.rotation.y = time * 0.002
    // Shadow frustum follows the focus, snapped to texels to avoid shimmering.
    const texel = 116 / this.sun.shadow.mapSize.x
    const fx = Math.round(focus.x / texel) * texel
    const fz = Math.round(focus.z / texel) * texel
    this.sun.target.position.set(fx, focus.y, fz)
    this.sun.position.set(fx, focus.y, fz).addScaledVector(WORLD_UNIFORMS.uSunDir.value, 140)
    // Chunk culling by distance.
    const cx = camera.position.x
    const cz = camera.position.z
    for (const c of this.chunks) {
      if (!c.cull) continue
      // Swapped (detailed) chunks use the exact distance to the chunk square; others keep the legacy estimate.
      const dist = c.swap || c.proxy
        ? Math.hypot(Math.max(0, Math.abs(c.x - cx) - CHUNK / 2), Math.max(0, Math.abs(c.z - cz) - CHUNK / 2))
        : Math.hypot(c.x - cx, c.z - cz) - CHUNK * 0.7
      const cull = c.swap ? c.cull * this.detail : c.cull
      c.mesh.visible = c.far ? dist >= cull - CHUNK * 0.4 : dist < cull
    }
    // Plume.
    if (this.plume) {
      for (let i = 0; i < this.plumeSeeds.length; i += 1) {
        const s = this.plumeSeeds[i]
        const t = (s.t + time * 0.012) % 1
        const y = 70 + t * 190
        const spread = 8 + t * 40
        const x = VOLCANO.x + Math.cos(s.a) * spread * s.r + t * t * 120
        const z = VOLCANO.z + Math.sin(s.a) * spread * s.r - t * 30
        const sc = (10 + t * 34) * s.s
        this.m4.compose(this.v3.set(x, y, z), this.q4.identity(), this.s3.set(sc, sc * 0.8, sc))
        this.plume.setMatrixAt(i, this.m4)
        const shade = lerp(0.38, 0.82, smoothstep(0, 0.8, t))
        this.tmpC.setRGB(shade, shade * 0.95, shade * 0.92)
        if (t < 0.08) this.tmpC.lerp(new THREE.Color('#ff8a4a'), 0.35)
        this.plume.setColorAt(i, this.tmpC)
      }
      this.plume.instanceMatrix.needsUpdate = true
      if (this.plume.instanceColor) this.plume.instanceColor.needsUpdate = true
    }
    if (this.lavaLight) this.lavaLight.intensity = 320 * (0.85 + 0.15 * Math.sin(time * 2.3) * Math.sin(time * 1.1))
    if (this.motes) {
      const u = (this.motes.material as THREE.ShaderMaterial).uniforms
      u.uCam.value.copy(camera.position)
      u.uW.value.set(w.coast, w.highlands, w.caldera)
      u.uScale.value = pixelScale
    }
    this.puffs.update(dt, time, focus, pixelScale)
  }
}
