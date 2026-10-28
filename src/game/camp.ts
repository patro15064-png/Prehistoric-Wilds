import * as THREE from 'three'
import { blob, merge, part } from './props'
import { rng } from './noise'
import { POI, type Terrain } from './terrain'
import type { Colliders } from './colliders'
import type { Fx } from './fx'

const C = POI.camp
export const CAMP = {
  x: C.x,
  z: C.z,
  safeR: 19,
  hearth: { x: C.x, z: C.z },
  tower: { x: C.x - 9, z: C.z - 8 },
  spawn: { x: C.x + 3, z: C.z + 4 },
}
// Gates face the highland ramp and the beach trail.
const GATES = [Math.atan2(30 - C.z, 34 - C.x), Math.atan2(90 - C.z, 10 - C.x)]
const inGate = (a: number) => GATES.some(g => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < 0.24)

type StageGroup = { group: THREE.Group; colliders: [number, number, number][]; ids: number[]; rise: number }

export class Camp {
  readonly root = new THREE.Group()
  stage = 0
  towerLit = false
  private readonly stages: StageGroup[] = []
  private readonly ruin: StageGroup
  private readonly scaffold: StageGroup
  private readonly beacon: StageGroup
  private readonly flames: THREE.Mesh[] = []
  private readonly beaconFlames: THREE.Mesh[] = []
  private readonly hearthLight = new THREE.PointLight('#ff9a4a', 0, 26, 1.6)
  private readonly beaconLight = new THREE.PointLight('#ffb050', 0, 90, 1.2)
  private beam?: THREE.Mesh
  private emberT = 0
  private readonly y: number

  constructor(private readonly terrain: Terrain, private readonly colliders: Colliders, private readonly fx: Fx) {
    this.y = terrain.heightAt(C.x, C.z)
    this.root.position.set(0, 0, 0)
    this.ruin = this.make(this.buildRuin())
    this.stages.push(this.make(this.buildHearth()), this.make(this.buildPalisade()), this.make(this.buildStonehold()))
    this.scaffold = this.make(this.buildScaffold())
    this.beacon = this.make(this.buildBeacon())
    this.hearthLight.position.set(C.x, this.y + 1.6, C.z)
    this.beaconLight.position.set(CAMP.tower.x, this.y + 15, CAMP.tower.z)
    this.root.add(this.hearthLight, this.beaconLight)
    this.setStage(0, false, false)
  }

  private h(x: number, z: number): number {
    return this.terrain.heightAt(x, z)
  }

  private make(parts: { geo: THREE.BufferGeometry[]; colliders: [number, number, number][]; extra?: THREE.Object3D[] }): StageGroup {
    const group = new THREE.Group()
    if (parts.geo.length) {
      const mesh = new THREE.Mesh(merge(parts.geo), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }))
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
    }
    for (const e of parts.extra ?? []) group.add(e)
    group.visible = false
    this.root.add(group)
    return { group, colliders: parts.colliders, ids: [], rise: 1 }
  }

  private show(s: StageGroup, on: boolean, animate: boolean): void {
    if (on && !s.group.visible) {
      s.group.visible = true
      s.ids = s.colliders.map(([x, z, r]) => this.colliders.add(x, z, r))
      s.rise = animate ? 0 : 1
    } else if (!on && s.group.visible) {
      s.group.visible = false
      for (const id of s.ids) this.colliders.disable(id)
      s.ids = []
    }
  }

  /** Apply camp stage (0..3) and tower state. `animate` plays the raise effect. */
  setStage(stage: number, towerLit: boolean, animate: boolean): void {
    const prev = this.stage
    this.stage = stage
    this.towerLit = towerLit
    this.show(this.ruin, stage === 0, false)
    this.stages.forEach((s, i) => this.show(s, stage >= i + 1, animate && i + 1 > prev))
    this.show(this.scaffold, stage >= 3 && !towerLit, animate)
    this.show(this.beacon, towerLit, animate)
    this.hearthLight.intensity = stage >= 1 ? 40 : 0
    this.beaconLight.intensity = towerLit ? 500 : 0
    for (const f of this.flames) f.visible = stage >= 1
    if (animate) {
      const p = new THREE.Vector3(C.x, this.y + 1, C.z)
      this.fx.fountain(p, '#ffd26a', 90, 11)
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * Math.PI * 2
        this.fx.dustPuff(C.x + Math.cos(a) * 9, this.y, C.z + Math.sin(a) * 9, 5, '#e8d8b0', 1.5)
      }
      this.fx.ring(C.x, this.y, C.z, 2, 20, '#ffe6a0', 0.8)
      this.fx.shake(0.35)
    }
  }

  celebrateTower(): void {
    const p = new THREE.Vector3(CAMP.tower.x, this.y + 15, CAMP.tower.z)
    this.fx.fountain(p, '#ffc050', 160, 16)
    this.fx.ring(CAMP.tower.x, this.y, CAMP.tower.z, 2, 40, '#ffd080', 1.2)
    this.fx.shake(0.6)
  }

  get towerTop(): THREE.Vector3 {
    return new THREE.Vector3(CAMP.tower.x, this.y + 15.5, CAMP.tower.z)
  }

  update(dt: number, time: number): void {
    for (const s of [...this.stages, this.scaffold, this.beacon]) {
      if (s.rise < 1 && s.group.visible) {
        s.rise = Math.min(1, s.rise + dt * 0.9)
        const k = s.rise
        const e = 1 - Math.pow(1 - k, 3)
        const over = Math.sin(k * Math.PI) * 0.08
        s.group.scale.set(1, e + over, 1)
        s.group.position.y = (this.y) * (1 - (e + over))
      } else if (s.group.visible) {
        s.group.scale.set(1, 1, 1)
        s.group.position.y = 0
      }
    }
    this.flames.forEach((f, i) => {
      const flick = 0.85 + Math.sin(time * 11 + i * 2.1) * 0.12 + Math.sin(time * 23 + i) * 0.06
      f.scale.set(flick * (1 - i * 0.2), flick * (1.2 - i * 0.1), flick * (1 - i * 0.2))
      f.rotation.y = time * (1.5 + i)
    })
    if (this.stage >= 1) {
      this.hearthLight.intensity = 38 + Math.sin(time * 13) * 5 + Math.sin(time * 7.3) * 4
      this.emberT -= dt
      if (this.emberT <= 0) {
        this.emberT = 0.12
        this.fx.embers(C.x, this.y + 0.9, C.z, 1, 0.6)
      }
    }
    if (this.towerLit) {
      this.beaconFlames.forEach((f, i) => {
        const flick = 0.85 + Math.sin(time * 9 + i * 2.1) * 0.15
        f.scale.set(flick, flick * 1.25, flick)
        f.rotation.y = time * (1 + i)
      })
      this.beaconLight.intensity = 480 + Math.sin(time * 8) * 60
      if (this.beam) (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.2 + Math.sin(time * 2) * 0.05
      if (Math.random() < dt * 20) this.fx.embers(CAMP.tower.x, this.y + 15.5, CAMP.tower.z, 2, 1.5)
    }
  }

  // ─── Builders (world-space merged geometry) ──────────────────────────────

  private fire(parent: THREE.Object3D[], x: number, y: number, z: number, scale: number, into: THREE.Mesh[]): void {
    const cols = ['#ff5a1a', '#ff9a2a', '#ffe07a']
    cols.forEach((c, i) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry((0.55 - i * 0.14) * scale, (1.5 - i * 0.3) * scale, 6).translate(0, (0.75 - i * 0.15) * scale, 0), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85 - i * 0.1, depthWrite: false, blending: THREE.AdditiveBlending }))
      m.position.set(x, y, z)
      into.push(m)
      parent.push(m)
    })
  }

  private stones(g: THREE.BufferGeometry[], x: number, z: number, r: number, n: number, size: number, color: string, seed: number): void {
    const R = rng(seed)
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2
      const sx = x + Math.cos(a) * r
      const sz = z + Math.sin(a) * r
      g.push(part(blob(size * (0.8 + R() * 0.4), 0, 0.25, seed + i), color, [sx, this.h(sx, sz) + size * 0.3, sz], [R(), R(), R()], [1, 0.7, 1]))
    }
  }

  private log(g: THREE.BufferGeometry[], x: number, z: number, len: number, r: number, yaw: number, pitch: number, color = '#8a5a34', yOff = 0): void {
    g.push(part(new THREE.CylinderGeometry(r, r * 1.1, len, 6), color, [x, this.h(x, z) + r + yOff, z], [Math.PI / 2 + pitch, yaw, 0]))
  }

  private towerFooting(g: THREE.BufferGeometry[]): void {
    const { x, z } = CAMP.tower
    this.stones(g, x, z, 2.6, 12, 0.8, '#9a948a', 501)
    this.stones(g, x, z, 2.2, 9, 0.6, '#85807a', 502)
    for (const [dx, dz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) {
      g.push(part(new THREE.CylinderGeometry(0.22, 0.26, 2.2, 6), '#4a3526', [x + dx, this.h(x + dx, z + dz) + 1.1, z + dz], [0.05 * dx, 0, 0.05 * dz]))
    }
  }

  private buildRuin() {
    const g: THREE.BufferGeometry[] = []
    const R = rng(401)
    // Cold, scattered hearth ring.
    this.stones(g, C.x, C.z, 1.4, 7, 0.4, '#7a746c', 402)
    for (let i = 0; i < 4; i += 1) this.log(g, C.x + (R() - 0.5) * 1.5, C.z + (R() - 0.5) * 1.5, 1.1, 0.1, R() * 3, 0, '#2a2420')
    // Collapsed lean-to.
    for (let i = 0; i < 6; i += 1) this.log(g, C.x + 7 + (R() - 0.5) * 3, C.z - 5 + (R() - 0.5) * 3, 2.6, 0.08, R() * 3, 0, '#7a5a3a')
    this.towerFooting(g)
    for (let i = 0; i < 5; i += 1) this.log(g, CAMP.tower.x + (R() - 0.5) * 5, CAMP.tower.z + (R() - 0.5) * 5, 3, 0.15, R() * 3, 0, '#2e2622')
    // Signal post with a torn banner hints at the goal.
    g.push(part(new THREE.CylinderGeometry(0.1, 0.12, 3.2, 5), '#6a4a2e', [C.x - 4, this.h(C.x - 4, C.z + 3) + 1.6, C.z + 3], [0.15, 0, 0.1]))
    return { geo: g, colliders: [[CAMP.tower.x, CAMP.tower.z, 2.8]] as [number, number, number][] }
  }

  private buildHearth() {
    const g: THREE.BufferGeometry[] = []
    const extra: THREE.Object3D[] = []
    const y = this.h(C.x, C.z)
    this.stones(g, C.x, C.z, 1.35, 10, 0.42, '#8a847a', 411)
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2
      g.push(part(new THREE.CylinderGeometry(0.1, 0.12, 1.3, 5), '#3a2a20', [C.x + Math.cos(a) * 0.35, y + 0.35, C.z + Math.sin(a) * 0.35], [Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9]))
    }
    this.fire(extra, C.x, y + 0.15, C.z, 1, this.flames)
    // Lean-to shelter with leaf roof.
    const lx = C.x + 7
    const lz = C.z - 5
    const ly = this.h(lx, lz)
    for (const dx of [-1.6, 0, 1.6]) {
      g.push(part(new THREE.CylinderGeometry(0.09, 0.1, 3.4, 5), '#7a5a3a', [lx + dx, ly + 1.3, lz - 0.4], [-0.6, 0, 0]))
    }
    g.push(part(new THREE.BoxGeometry(4, 0.12, 3.2), '#4f8a34', [lx, ly + 1.35, lz - 0.2], [-0.6, 0, 0]))
    g.push(part(new THREE.BoxGeometry(3.6, 0.1, 2.9), '#6aa83e', [lx, ly + 1.45, lz - 0.2], [-0.6, 0, 0]))
    g.push(part(new THREE.BoxGeometry(1, 0.12, 2.1), '#b07a47', [lx - 0.6, ly + 0.08, lz + 0.3]))
    g.push(part(new THREE.BoxGeometry(0.9, 0.14, 1.8), '#d9c3a0', [lx + 0.7, ly + 0.08, lz + 0.3]))
    // Drying rack with hides.
    const rx = C.x - 5
    const rz = C.z - 3
    const ry = this.h(rx, rz)
    for (const dx of [-1.2, 1.2]) g.push(part(new THREE.CylinderGeometry(0.07, 0.08, 2.2, 5), '#6a4a2e', [rx + dx, ry + 1.1, rz]))
    g.push(part(new THREE.CylinderGeometry(0.06, 0.06, 2.8, 5), '#6a4a2e', [rx, ry + 2.1, rz], [0, 0, Math.PI / 2]))
    g.push(part(new THREE.BoxGeometry(0.9, 1.2, 0.05), '#9a6440', [rx - 0.5, ry + 1.45, rz]))
    g.push(part(new THREE.BoxGeometry(0.7, 1.0, 0.05), '#b8845a', [rx + 0.6, ry + 1.55, rz]))
    this.towerFooting(g)
    // Log seats.
    for (const a of [0.6, 2.4, 4.2]) this.log(g, C.x + Math.cos(a) * 3.2, C.z + Math.sin(a) * 3.2, 1.8, 0.22, a + Math.PI / 2, 0)
    return { geo: g, extra, colliders: [[lx, lz - 0.4, 1.8], [rx, rz, 1.2], [CAMP.tower.x, CAMP.tower.z, 2.8], [C.x, C.z, 1.2]] as [number, number, number][] }
  }

  private buildPalisade() {
    const g: THREE.BufferGeometry[] = []
    const cols: [number, number, number][] = []
    const R = rng(421)
    const n = 88
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2
      if (inGate(a)) continue
      const x = C.x + Math.cos(a) * 17.5
      const z = C.z + Math.sin(a) * 17.5
      const hgt = 2.6 + R() * 0.8
      const y = this.h(x, z)
      g.push(part(new THREE.CylinderGeometry(0.2, 0.24, hgt, 6), i % 2 ? '#8a5a34' : '#9a6a3e', [x, y + hgt / 2 - 0.2, z], [(R() - 0.5) * 0.08, 0, (R() - 0.5) * 0.08]))
      g.push(part(new THREE.ConeGeometry(0.2, 0.5, 6), '#c9a070', [x, y + hgt - 0.2 + 0.25, z]))
      if (i % 2 === 0) cols.push([x, z, 0.8])
    }
    // Gate posts with skull totems.
    for (const gA of GATES) {
      for (const s of [-1, 1]) {
        const a = gA + s * 0.27
        const x = C.x + Math.cos(a) * 17.5
        const z = C.z + Math.sin(a) * 17.5
        const y = this.h(x, z)
        g.push(part(new THREE.CylinderGeometry(0.3, 0.34, 4.6, 6), '#6a4a2e', [x, y + 2.1, z]))
        g.push(part(blob(0.45, 1, 0.1, 430), '#f1e6cc', [x, y + 4.6, z], [0, 0, 0], [1, 0.9, 1.1]))
        g.push(part(new THREE.ConeGeometry(0.1, 0.9, 5), '#f4ead2', [x + 0.35, y + 4.9, z], [0, 0, -0.9]))
        g.push(part(new THREE.ConeGeometry(0.1, 0.9, 5), '#f4ead2', [x - 0.35, y + 4.9, z], [0, 0, 0.9]))
        cols.push([x, z, 0.6])
      }
    }
    // Hide tents.
    const tent = (x: number, z: number, c1: string, c2: string, r = 2) => {
      const y = this.h(x, z)
      g.push(part(new THREE.ConeGeometry(r, 3.2, 7), (p: THREE.Vector3) => new THREE.Color(p.y > 0.3 ? c1 : c2), [x, y + 1.6, z]))
      for (let i = 0; i < 3; i += 1) g.push(part(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 4), '#6a4a2e', [x + Math.cos(i * 2.1) * 0.2, y + 3.4, z + Math.sin(i * 2.1) * 0.2], [Math.cos(i * 2.1) * 0.4, 0, Math.sin(i * 2.1) * 0.4]))
      g.push(part(new THREE.BoxGeometry(0.8, 1.4, 0.1), '#3a2618', [x, y + 0.7, z + r * 0.72], [-0.35, 0, 0]))
      cols.push([x, z, r * 0.9])
    }
    tent(C.x + 10, C.z + 6, '#b8845a', '#9a6440')
    tent(C.x + 3, C.z + 11.5, '#c9a070', '#8a5a38', 1.8)
    // Workbench.
    const wx = C.x - 7
    const wz = C.z + 6
    const wy = this.h(wx, wz)
    g.push(part(new THREE.BoxGeometry(2.6, 0.18, 1.2), '#9a6a3e', [wx, wy + 0.95, wz]))
    for (const [dx, dz] of [[-1.1, -0.45], [1.1, -0.45], [-1.1, 0.45], [1.1, 0.45]]) g.push(part(new THREE.CylinderGeometry(0.08, 0.09, 0.95, 5), '#6a4a2e', [wx + dx, wy + 0.47, wz + dz]))
    g.push(part(new THREE.DodecahedronGeometry(0.25, 0), '#6d7f96', [wx - 0.6, wy + 1.2, wz]))
    g.push(part(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 5), '#8a5a34', [wx + 0.4, wy + 1.1, wz], [0, 0, Math.PI / 2]))
    g.push(part(new THREE.ConeGeometry(0.08, 0.5, 4), '#f4ead2', [wx + 0.9, wy + 1.15, wz + 0.2], [0, 0, 1.2]))
    cols.push([wx, wz, 1.4])
    // Torches.
    const extra: THREE.Object3D[] = []
    for (const a of [0.3, 1.9, 3.5, 5.1]) {
      const x = C.x + Math.cos(a) * 14
      const z = C.z + Math.sin(a) * 14
      const y = this.h(x, z)
      g.push(part(new THREE.CylinderGeometry(0.08, 0.1, 2.2, 5), '#5a3a22', [x, y + 1.1, z]))
      this.fire(extra, x, y + 2.2, z, 0.32, this.flames)
    }
    return { geo: g, extra, colliders: cols }
  }

  private buildStonehold() {
    const g: THREE.BufferGeometry[] = []
    const cols: [number, number, number][] = []
    const R = rng(441)
    // Low stone walls just inside the palisade.
    const n = 44
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2
      if (inGate(a)) continue
      const x = C.x + Math.cos(a) * 15.8
      const z = C.z + Math.sin(a) * 15.8
      const y = this.h(x, z)
      g.push(part(new THREE.BoxGeometry(2.3, 1.2 + R() * 0.3, 0.9), (p: THREE.Vector3) => new THREE.Color(p.y > 0.4 ? '#b9b3aa' : '#968f86'), [x, y + 0.55, z], [0, -a + Math.PI / 2, 0]))
      if (i % 3 === 0) g.push(part(new THREE.BoxGeometry(1.1, 0.12, 0.7), '#7a9a52', [x, y + 1.22, z], [0, -a + Math.PI / 2, 0]))
    }
    // Stone kiln with amber glow.
    const kx = C.x - 3
    const kz = C.z + 9
    const ky = this.h(kx, kz)
    g.push(part(new THREE.SphereGeometry(1.5, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#a8a29a', [kx, ky, kz], [0, 0, 0], [1, 1.2, 1]))
    g.push(part(new THREE.CylinderGeometry(0.35, 0.45, 1.4, 6), '#8a847a', [kx, ky + 2.1, kz]))
    g.push(part(new THREE.BoxGeometry(0.8, 0.7, 0.3), '#ffb23e', [kx, ky + 0.45, kz + 1.35]))
    cols.push([kx, kz, 1.7])
    // Amber lanterns and banners.
    const extra: THREE.Object3D[] = []
    const lanternMat = new THREE.MeshStandardMaterial({ color: '#ffb23e', emissive: '#ff8a1a', emissiveIntensity: 0.8, roughness: 0.75, flatShading: true })
    for (const a of [0.9, 2.5, 4.0, 5.6]) {
      const x = C.x + Math.cos(a) * 11
      const z = C.z + Math.sin(a) * 11
      const y = this.h(x, z)
      g.push(part(new THREE.CylinderGeometry(0.12, 0.14, 3.4, 6), '#8a847a', [x, y + 1.7, z]))
      const l = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), lanternMat)
      l.position.set(x, y + 3.6, z)
      extra.push(l)
      cols.push([x, z, 0.4])
    }
    for (const gA of GATES) {
      for (const s of [-1, 1]) {
        const a = gA + s * 0.4
        const x = C.x + Math.cos(a) * 15.8
        const z = C.z + Math.sin(a) * 15.8
        const y = this.h(x, z)
        g.push(part(new THREE.CylinderGeometry(0.1, 0.1, 5.5, 5), '#5a3a22', [x, y + 2.75, z]))
        g.push(part(new THREE.BoxGeometry(1.1, 1.8, 0.06), (p: THREE.Vector3) => new THREE.Color(Math.abs(p.y) < 0.2 ? '#ffb23e' : '#c2461f'), [x + 0.6, y + 4.4, z], [0, -a, 0]))
      }
    }
    return { geo: g, extra, colliders: cols }
  }

  private buildScaffold() {
    const g: THREE.BufferGeometry[] = []
    const { x, z } = CAMP.tower
    const y = this.h(x, z)
    this.stones(g, x, z, 2.6, 12, 0.8, '#9a948a', 501)
    for (const [dx, dz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) {
      g.push(part(new THREE.CylinderGeometry(0.18, 0.28, 14, 6), '#6a4a2e', [x + dx * 0.85, y + 7, z + dz * 0.85], [-dz * 0.02, 0, dx * 0.02]))
    }
    for (let lv = 1; lv <= 4; lv += 1) {
      const hy = y + lv * 3.2
      const s = 1.8 - lv * 0.12
      for (const [ax, az, rot] of [[0, -s, 0], [0, s, 0], [-s, 0, Math.PI / 2], [s, 0, Math.PI / 2]] as [number, number, number][]) {
        g.push(part(new THREE.CylinderGeometry(0.1, 0.1, s * 2.1, 5), '#8a5a34', [x + ax, hy, z + az], [0, rot, Math.PI / 2]))
      }
    }
    g.push(part(new THREE.CylinderGeometry(1.5, 1.1, 0.8, 8), '#6a6058', [x, y + 14.2, z]))
    g.push(part(new THREE.CylinderGeometry(1.3, 1.3, 0.2, 8), '#2a2420', [x, y + 14.65, z]))
    return { geo: g, colliders: [[x, z, 2.8]] as [number, number, number][] }
  }

  private buildBeacon() {
    const { geo, colliders } = this.buildScaffold()
    const { x, z } = CAMP.tower
    const y = this.h(x, z)
    geo.push(part(new THREE.OctahedronGeometry(0.5, 0), '#ff4b12', [x, y + 15.2, z]))
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2
      geo.push(part(new THREE.ConeGeometry(0.18, 1.1, 4), '#5b4b8a', [x + Math.cos(a) * 1.35, y + 15.1, z + Math.sin(a) * 1.35], [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4]))
    }
    geo.push(part(new THREE.BoxGeometry(1.6, 2.4, 0.06), (p: THREE.Vector3) => new THREE.Color(Math.abs(p.y) < 0.25 ? '#ffd24a' : '#c2461f'), [x + 1.9, y + 12, z], [0, 0.4, 0]))
    const extra: THREE.Object3D[] = []
    this.fire(extra, x, y + 14.8, z, 2.4, this.beaconFlames)
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.2, 260, 12, 1, true).translate(0, 130, 0), new THREE.MeshBasicMaterial({ color: '#ffd080', transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }))
    beam.position.set(x, y + 15, z)
    this.beam = beam
    extra.push(beam)
    return { geo, extra, colliders }
  }
}
