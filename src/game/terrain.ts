import { Noise2, clamp, lerp, smoothstep } from './noise'

/**
 * The volcanic island as a deterministic heightfield. Everything that stands on the ground —
 * player, creatures, vegetation, decals, the camera — samples this one grid, so visuals and
 * collision always agree. Pure data (no three.js scene objects), so it is unit tested in Node.
 *
 * Axes: +x east, +z south, +y up. The jungle coast is south, the Amberback plateau spans the
 * middle and north-east, and the Cinder Caldera volcano rises in the north.
 */
export type RegionId = 'coast' | 'highlands' | 'caldera'
export type Vec2 = { x: number; z: number }

export const WORLD = {
  half: 340,
  res: 340,
  sea: 0,
  lava: 43,
  /** Max climbable rise per metre (≈45°). Steeper ground is a wall. */
  maxSlope: 1.0,
  wade: -0.9,
} as const

/** Coarse cells are cheap to persist and read clearly as a hand-charted map. */
export const MAP_GRID = 32

export const VOLCANO: Vec2 = { x: -18, z: -178 }

export const POI = {
  camp: { x: 24, z: 48 },
  ruins: { x: 128, z: -46 },
  wyrmArena: { x: -20, z: -182 },
  ribs: { x: -4, z: 262 },
  elderTree: { x: 96, z: 118 },
  seaArch: { x: 170, z: 196 },
  steamvents: { x: 40, z: -52 },
  stonefingers: { x: 190, z: -20 },
} satisfies Record<string, Vec2>

export const REGION_NAMES: Record<RegionId, string> = {
  coast: 'Fernsong Coast',
  highlands: 'Amberback Highlands',
  caldera: 'Cinder Caldera',
}

type PathNode = [number, number, number | null]
/** Walkable routes between regions. `null` heights are sampled from the raw terrain. */
export const PATHS: PathNode[][] = [
  // Camp → up the terraced ramp onto the Amberback plateau.
  [[24, 48, null], [34, 30, null], [46, 6, null], [58, -14, null], [66, -34, null]],
  // West coast → second ramp by the falls.
  [[-128, 74, null], [-140, 36, null], [-146, 0, null], [-140, -36, null]],
  // Plateau → the Breach canyon → caldera floor.
  [[44, -66, null], [14, -104, 50], [0, -126, 56], [-6, -142, 53], [-12, -158, 47], [-18, -170, 46.2]],
  // Camp → beach below.
  [[24, 48, null], [10, 90, null], [-6, 150, null], [-4, 226, null]],
  // Plateau spine → ruins.
  [[66, -34, null], [84, -38, null], [100, -42, null]],
]

export const ARENAS = {
  ruins: { ...POI.ruins, radius: 30 },
  wyrm: { ...POI.wyrmArena, radius: 22 },
}

export class Terrain {
  readonly N = WORLD.res + 1
  readonly step = (WORLD.half * 2) / WORLD.res
  readonly heights: Float32Array
  /** 0..1 plateau membership (for colouring and regions). */
  readonly plateau: Float32Array
  /** 0..1 trail wear from the flattened paths. */
  readonly trail: Float32Array
  readonly falls: { top: Vec2; pool: Vec2; lagoon: Vec2; topY: number; poolY: number }
  readonly flats: { x: number; z: number; y: number; r: number }[] = []
  private readonly n = new Noise2(20260928)
  private readonly n2 = new Noise2(777)

  constructor() {
    const N = this.N
    this.heights = new Float32Array(N * N)
    this.plateau = new Float32Array(N * N)
    this.trail = new Float32Array(N * N)
    const fx = -88
    const edge = this.edgeZ(fx)
    this.falls = {
      top: { x: fx, z: edge - 2 },
      pool: { x: fx, z: edge - 18 },
      lagoon: { x: fx, z: edge + 20 },
      topY: 0,
      poolY: 0,
    }
    for (let j = 0; j < N; j += 1) {
      for (let i = 0; i < N; i += 1) {
        const x = -WORLD.half + i * this.step
        const z = -WORLD.half + j * this.step
        const [h, p] = this.raw(x, z)
        this.heights[j * N + i] = h
        this.plateau[j * N + i] = p
      }
    }
    // Flat pads: camp clearing and both boss arenas.
    for (const [c, r] of [[POI.camp, 20], [ARENAS.ruins, ARENAS.ruins.radius], [ARENAS.wyrm, ARENAS.wyrm.radius]] as const) {
      const y = c === ARENAS.wyrm ? 46.2 : this.heightAt(c.x, c.z)
      this.flats.push({ x: c.x, z: c.z, y, r })
      this.blend((x, z) => {
        const d = Math.hypot(x - c.x, z - c.z)
        return { w: 1 - smoothstep(r, r + 14, d), y: y + this.n2.get(x / 30, z / 30) * 0.35 * smoothstep(0, r, d) }
      })
    }
    this.carvePaths()
    this.falls.poolY = this.heightAt(this.falls.top.x, this.falls.top.z) - 0.6
    this.falls.topY = this.falls.poolY
  }

  /** Z of the plateau cliff edge for a given x (plateau lies north / at smaller z). */
  edgeZ(x: number): number {
    return 14 + this.n.fbm(x / 150, 11.3, 3) * 30
  }

  private raw(x: number, z: number): [number, number] {
    const n = this.n
    const coastNoise = n.fbm(x / 170, z / 170, 3) * 40 + n.get(x / 45, z / 45) * 7
    const r = Math.hypot(x, z * 0.92) + coastNoise
    const land = smoothstep(282, 206, r)
    // Coast: seabed → broad beaches → rolling jungle hills.
    const hills = (n.fbm(x / 115 + 3, z / 115 - 7, 4) * 0.5 + 0.5) * 12 + n.ridge(x / 60, z / 60, 2) * 5
    let h = lerp(-14, 1.1, smoothstep(0, 0.32, land)) + smoothstep(0.44, 0.97, land) * (2.5 + hills)

    // Amberback plateau: a raised table north of a noisy cliff line.
    const edge = this.edgeZ(x) + n.get(x / 24, z / 24) * 3
    const inland = smoothstep(246, 196, r)
    const p = smoothstep(-3, 8, edge - z) * inland
    const mesa = Math.pow(Math.max(0, n.get(x / 70 + 40, z / 70 - 9) - 0.45), 1.2) * 60
    const plateauH = 31 + n.fbm(x / 95 - 5, z / 95 + 2, 4) * 6 + n.ridge(x / 40, z / 40, 2) * 2.5 + mesa
    h = lerp(h, plateauH, p)

    // Cinder Caldera: a broad cone with a crater and lava channels.
    const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z)
    if (dv < 175) {
      const t = clamp(1 - (dv - 52) / 118, 0, 1)
      const ridges = n.ridge(Math.atan2(z - VOLCANO.z, x - VOLCANO.x) * 6, dv / 30, 2) * 7 * t
      let vh = 22 + 66 * Math.pow(t, 2.1) + ridges + n.fbm(x / 40, z / 40, 3) * 3
      if (dv < 54) {
        const floor = 46 + n.fbm(x / 25, z / 25, 2) * 1.4
        vh = lerp(floor, 88 + ridges, smoothstep(36, 55, dv))
        const channel = n.get(x / 16 + 9, z / 16 - 4)
        const moat = smoothstep(26, 31, dv) * (1 - smoothstep(34, 38, dv))
        const lava = Math.max(smoothstep(0.18, 0.32, channel) * smoothstep(40, 30, dv), moat)
        vh = lerp(vh, 38.5, lava)
      }
      const k = 8
      const w = clamp(0.5 + (vh - h) / (2 * k), 0, 1)
      h = lerp(h, vh, w) + k * w * (1 - w) * 0.5
    }

    // Plunge lagoon below the falls, and the hot-spring pool that feeds them.
    const lg = Math.hypot(x - this.falls.lagoon.x, z - this.falls.lagoon.z)
    h = lerp(h, -2.8, 1 - smoothstep(12, 26, lg))
    const pl = Math.hypot(x - this.falls.pool.x, z - this.falls.pool.z)
    h -= 4.2 * (1 - smoothstep(6, 16, pl)) * p
    return [h, p]
  }

  private blend(fn: (x: number, z: number) => { w: number; y: number }): void {
    const N = this.N
    for (let j = 0; j < N; j += 1) {
      for (let i = 0; i < N; i += 1) {
        const x = -WORLD.half + i * this.step
        const z = -WORLD.half + j * this.step
        const { w, y } = fn(x, z)
        if (w <= 0) continue
        const k = j * N + i
        this.heights[k] = lerp(this.heights[k], y, w)
      }
    }
  }

  private carvePaths(): void {
    // Endpoints sample the terrain; interior unspecified nodes are graded evenly by distance
    // between their fixed neighbours so ramps never bunch up at a cliff.
    const resolve = (path: PathNode[]) => {
      const nodes = path.map(([x, z, y], i) => ({ x, z, y: y ?? (i === 0 || i === path.length - 1 ? this.heightAt(x, z) : NaN) }))
      const dist = [0]
      for (let i = 1; i < nodes.length; i += 1) dist.push(dist[i - 1] + Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].z - nodes[i - 1].z))
      for (let i = 1; i < nodes.length - 1; i += 1) {
        if (!Number.isNaN(nodes[i].y)) continue
        let a = i - 1
        let b = i + 1
        while (Number.isNaN(nodes[b].y)) b += 1
        nodes[i].y = lerp(nodes[a].y, nodes[b].y, (dist[i] - dist[a]) / (dist[b] - dist[a]))
        a = i
      }
      return nodes
    }
    const N = this.N
    for (const raw of PATHS) {
      const path = resolve(raw)
      for (let s = 0; s < path.length - 1; s += 1) {
        const a = path[s]
        const b = path[s + 1]
        const minX = Math.min(a.x, b.x) - 22
        const maxX = Math.max(a.x, b.x) + 22
        const minZ = Math.min(a.z, b.z) - 22
        const maxZ = Math.max(a.z, b.z) + 22
        const i0 = Math.max(0, Math.floor((minX + WORLD.half) / this.step))
        const i1 = Math.min(N - 1, Math.ceil((maxX + WORLD.half) / this.step))
        const j0 = Math.max(0, Math.floor((minZ + WORLD.half) / this.step))
        const j1 = Math.min(N - 1, Math.ceil((maxZ + WORLD.half) / this.step))
        const dx = b.x - a.x
        const dz = b.z - a.z
        const len2 = dx * dx + dz * dz
        for (let j = j0; j <= j1; j += 1) {
          for (let i = i0; i <= i1; i += 1) {
            const x = -WORLD.half + i * this.step
            const z = -WORLD.half + j * this.step
            const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1)
            const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t))
            const w = 1 - smoothstep(4.5, 13, d)
            if (w <= 0) continue
            const k = j * N + i
            const y = lerp(a.y, b.y, t)
            this.heights[k] = lerp(this.heights[k], y, w)
            this.trail[k] = Math.max(this.trail[k], 1 - smoothstep(1.2, 3.6, d + this.n2.get(x / 5, z / 5) * 1.2))
          }
        }
      }
    }
  }

  // ─── queries ─────────────────────────────────────────────────────────────

  private gridAt(arr: Float32Array, x: number, z: number): number {
    const N = this.N
    const gx = clamp((x + WORLD.half) / this.step, 0, N - 1.001)
    const gz = clamp((z + WORLD.half) / this.step, 0, N - 1.001)
    const i = Math.floor(gx)
    const j = Math.floor(gz)
    const fx = gx - i
    const fz = gz - j
    const k = j * N + i
    const a = arr[k]
    const b = arr[k + 1]
    const c = arr[k + N]
    const d = arr[k + N + 1]
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fz)
  }

  heightAt(x: number, z: number): number {
    return this.gridAt(this.heights, x, z)
  }

  plateauAt(x: number, z: number): number {
    return this.gridAt(this.plateau, x, z)
  }

  trailAt(x: number, z: number): number {
    return this.gridAt(this.trail, x, z)
  }

  /** Ground surface, never below the water/lava surface (for props, camera and decals). */
  surfaceAt(x: number, z: number): number {
    const h = this.heightAt(x, z)
    if (this.inCrater(x, z)) return Math.max(h, WORLD.lava)
    return Math.max(h, WORLD.sea)
  }

  normalAt(x: number, z: number, out = { x: 0, y: 1, z: 0 }): { x: number; y: number; z: number } {
    const e = this.step
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z)
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e)
    const len = Math.hypot(hx, 2 * e, hz)
    out.x = -hx / len
    out.y = (2 * e) / len
    out.z = -hz / len
    return out
  }

  slopeAt(x: number, z: number): number {
    const e = this.step
    const hx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e)
    const hz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e)
    return Math.hypot(hx, hz)
  }

  volcanoDistance(x: number, z: number): number {
    return Math.hypot(x - VOLCANO.x, z - VOLCANO.z)
  }

  inCrater(x: number, z: number): boolean {
    return this.volcanoDistance(x, z) < 46
  }

  isLava(x: number, z: number): boolean {
    return this.inCrater(x, z) && this.heightAt(x, z) < WORLD.lava + 0.25
  }

  regionAt(x: number, z: number): RegionId {
    if (this.volcanoDistance(x, z) < 150) return 'caldera'
    if (this.plateauAt(x, z) > 0.5 || z < -60) return 'highlands'
    return 'coast'
  }

  /** Region blend weights for fog, sky and ground colour. */
  regionWeights(x: number, z: number): { coast: number; highlands: number; caldera: number } {
    const caldera = smoothstep(165, 120, this.volcanoDistance(x, z))
    const highlands = Math.max(this.plateauAt(x, z), smoothstep(-40, -90, z)) * (1 - caldera)
    return { coast: Math.max(0, 1 - caldera - highlands), highlands, caldera }
  }

  /** Scorching-heat zone of the inner caldera (needs heat protection). */
  heatAt(x: number, z: number): number {
    return smoothstep(112, 96, this.volcanoDistance(x, z))
  }

  /** True when a character standing at (x, z) is on valid footing. */
  walkable(x: number, z: number): boolean {
    if (Math.abs(x) > WORLD.half - 6 || Math.abs(z) > WORLD.half - 6) return false
    const h = this.heightAt(x, z)
    if (h < WORLD.sea + WORLD.wade) return false
    if (this.isLava(x, z)) return false
    return true
  }

  /** Can a character step from a to b (short step)? Uphill steeper than maxSlope is a wall. */
  canStep(ax: number, az: number, bx: number, bz: number): boolean {
    if (!this.walkable(bx, bz)) return false
    const d = Math.hypot(bx - ax, bz - az)
    if (d < 1e-5) return true
    const rise = this.heightAt(bx, bz) - this.heightAt(ax, az)
    if (rise <= 0) return true
    // Measure against a lookahead so tiny steps cannot creep up cliffs.
    const lx = ax + ((bx - ax) / d) * 0.9
    const lz = az + ((bz - az) / d) * 0.9
    const riseAhead = this.heightAt(lx, lz) - this.heightAt(ax, az)
    return riseAhead / 0.9 <= WORLD.maxSlope && rise / d <= WORLD.maxSlope * 1.4
  }
}
