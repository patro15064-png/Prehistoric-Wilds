import * as THREE from 'three'
import { blob, merge, part } from './props'
import { rng } from './noise'
import { NODES, type NodeKind } from './data'
import { ARENAS, POI, type RegionId, type Terrain } from './terrain'
import type { Colliders } from './colliders'
import { CONFIG } from './config'

export type GNode = { id: number; kind: NodeKind; x: number; y: number; z: number; yaw: number; scale: number; active: boolean; respawnT: number; slot: number }

type Layer = { geo: THREE.BufferGeometry; mat: THREE.Material }
const base = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true })
const glow = (emissive: string, i: number) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, flatShading: true, emissive, emissiveIntensity: i * 0.6 })

function layers(kind: NodeKind): Layer[] {
  switch (kind) {
    case 'fiber': {
      const r = rng(7)
      const stalks: THREE.BufferGeometry[] = []
      for (let i = 0; i < 14; i += 1) {
        const a = r() * Math.PI * 2
        const d = r() * 0.4
        const h = 1.2 + r() * 0.8
        stalks.push(part(new THREE.ConeGeometry(0.05, h, 3), i % 3 ? '#b9d36a' : '#9cc050', [Math.cos(a) * d, h / 2, Math.sin(a) * d], [(r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.4]))
        if (i % 2 === 0) stalks.push(part(new THREE.CylinderGeometry(0.06, 0.05, 0.3, 5), '#d9c07a', [Math.cos(a) * d, h + 0.05, Math.sin(a) * d]))
      }
      return [{ geo: merge(stalks), mat: base() }]
    }
    case 'bone': {
      const ribs = [0, 1, 2, 3].map(i => part(new THREE.TorusGeometry(0.7, 0.07, 4, 10, Math.PI * 0.9), '#efe3c6', [0, 0, (i - 1.5) * 0.3], [0, 0, 0.1], 1))
      const skull = part(blob(0.32, 1, 0.15, 5), '#f4ead2', [0.9, 0.25, 0.3], [0, 0, 0], [1.2, 0.9, 1])
      const eye = part(new THREE.SphereGeometry(0.08, 5, 4), '#3a3026', [1.15, 0.32, 0.42])
      return [{ geo: merge([...ribs, skull, eye]), mat: base() }]
    }
    case 'herb': {
      const r = rng(9)
      const leaves: THREE.BufferGeometry[] = []
      for (let i = 0; i < 9; i += 1) {
        const a = (i / 9) * Math.PI * 2
        leaves.push(part(blob(0.28, 0, 0.1, 20 + i), i % 2 ? '#e0607a' : '#f08aa0', [Math.cos(a) * 0.35, 0.3 + r() * 0.2, Math.sin(a) * 0.35], [0.5, a, 0], [1, 0.35, 0.6]))
      }
      leaves.push(part(new THREE.CylinderGeometry(0.03, 0.04, 0.5, 4), '#5a8a3a', [0, 0.25, 0]))
      return [{ geo: merge(leaves), mat: base() }, { geo: part(new THREE.IcosahedronGeometry(0.14, 0), '#ffd6e0', [0, 0.62, 0]), mat: glow('#ff6a90', 0.9) }]
    }
    case 'amber': {
      const rock = part(blob(0.9, 1, 0.3, 21), '#8a6a4a', [0, 0.35, 0], [0, 0, 0], [1.1, 0.6, 1])
      const r = rng(23)
      const cr: THREE.BufferGeometry[] = []
      for (let i = 0; i < 6; i += 1) {
        const a = r() * Math.PI * 2
        cr.push(part(new THREE.OctahedronGeometry(0.25 + r() * 0.2, 0), '#ffb23e', [Math.cos(a) * 0.5, 0.7 + r() * 0.4, Math.sin(a) * 0.4], [r(), r(), r()], [0.7, 1.6, 0.7]))
      }
      return [{ geo: rock, mat: base() }, { geo: merge(cr), mat: glow('#ff8a1a', 0.9) }]
    }
    case 'obsidian': {
      const rock = part(blob(0.8, 1, 0.3, 31), '#2a2422', [0, 0.25, 0], [0, 0, 0], [1.2, 0.5, 1.1])
      const r = rng(33)
      const sp: THREE.BufferGeometry[] = []
      for (let i = 0; i < 7; i += 1) {
        const a = r() * Math.PI * 2
        const h = 0.9 + r() * 0.9
        sp.push(part(new THREE.ConeGeometry(0.18, h, 4), '#3b2f5a', [Math.cos(a) * 0.5, h / 2 + 0.2, Math.sin(a) * 0.45], [(r() - 0.5) * 0.7, r(), (r() - 0.5) * 0.7]))
      }
      return [{ geo: rock, mat: base() }, { geo: merge(sp), mat: glow('#7a3aff', 0.55) }]
    }
    case 'sulfur': {
      const rock = part(blob(0.85, 1, 0.3, 41), '#4a3a30', [0, 0.3, 0], [0, 0, 0], [1.1, 0.55, 1])
      const r = rng(43)
      const cr: THREE.BufferGeometry[] = []
      for (let i = 0; i < 9; i += 1) {
        const a = r() * Math.PI * 2
        cr.push(part(new THREE.BoxGeometry(0.22, 0.3 + r() * 0.3, 0.22), '#f2e04a', [Math.cos(a) * 0.55, 0.62, Math.sin(a) * 0.5], [r(), r(), r()]))
      }
      return [{ geo: rock, mat: base() }, { geo: merge(cr), mat: glow('#c9a800', 0.5) }]
    }
    case 'glowcap': {
      const r = rng(51)
      const stems: THREE.BufferGeometry[] = []
      const caps: THREE.BufferGeometry[] = []
      stems.push(part(blob(0.45, 1, 0.3, 52), '#3f5a36', [0, 0.05, 0], [0, 0, 0], [1.3, 0.25, 1.2]))
      for (let i = 0; i < 5; i += 1) {
        const a = (i / 5) * Math.PI * 2 + r() * 0.5
        const d = i === 0 ? 0 : 0.28 + r() * 0.18
        const h = (i === 0 ? 0.62 : 0.3 + r() * 0.25)
        const cx = Math.cos(a) * d
        const cz = Math.sin(a) * d
        stems.push(part(new THREE.CylinderGeometry(0.035, 0.055, h, 5), '#d8e8e0', [cx, h / 2, cz], [(r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3]))
        const cs = i === 0 ? 0.26 : 0.13 + r() * 0.08
        caps.push(part(new THREE.SphereGeometry(cs, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), '#58c8f0', [cx, h - 0.02, cz], [0, 0, 0], [1, 0.62, 1]))
      }
      return [{ geo: merge(stems), mat: base() }, { geo: merge(caps), mat: glow('#3ab8ff', 0.75) }]
    }
  }
}

const GLINT: Record<NodeKind, string> = {
  fiber: '#f4ffb0', bone: '#fff6e0', herb: '#ffb0c8', amber: '#ffc060', obsidian: '#c7a0ff', sulfur: '#fff27a', glowcap: '#9fe6ff',
}

type Plan = { kind: NodeKind; region: RegionId | 'shore'; count: number; filter?: (x: number, z: number, t: Terrain) => boolean }
const PLAN: Plan[] = [
  { kind: 'fiber', region: 'shore', count: 14 },
  { kind: 'fiber', region: 'coast', count: 12 },
  { kind: 'fiber', region: 'highlands', count: 8 },
  { kind: 'bone', region: 'coast', count: 8 },
  { kind: 'bone', region: 'highlands', count: 16 },
  { kind: 'bone', region: 'caldera', count: 8 },
  { kind: 'herb', region: 'coast', count: 18 },
  { kind: 'herb', region: 'highlands', count: 8 },
  { kind: 'herb', region: 'caldera', count: 3 },
  { kind: 'amber', region: 'highlands', count: 24 },
  { kind: 'obsidian', region: 'caldera', count: 24 },
  { kind: 'sulfur', region: 'caldera', count: 22 },
  // Glowcaps grow in jungle shade and around the highland ruins (flash pod ingredient).
  { kind: 'glowcap', region: 'coast', count: 14 },
  { kind: 'glowcap', region: 'highlands', count: 8 },
]

export class Nodes {
  readonly list: GNode[] = []
  readonly group = new THREE.Group()
  private readonly meshes = new Map<NodeKind, THREE.InstancedMesh[]>()
  private readonly glints: THREE.Points
  private readonly glintPos: Float32Array
  private readonly m4 = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0)

  constructor(private readonly terrain: Terrain, colliders: Colliders) {
    this.place(colliders)
    for (const kind of Object.keys(NODES) as NodeKind[]) {
      const nodes = this.list.filter(n => n.kind === kind)
      nodes.forEach((n, i) => (n.slot = i))
      const ms = layers(kind).map(l => {
        const m = new THREE.InstancedMesh(l.geo, l.mat, Math.max(1, nodes.length))
        m.castShadow = true
        m.receiveShadow = true
        m.name = `node-${kind}`
        this.group.add(m)
        return m
      })
      this.meshes.set(kind, ms)
      for (const n of nodes) this.write(n)
      for (const m of ms) {
        m.instanceMatrix.needsUpdate = true
        m.computeBoundingSphere()
      }
    }
    this.glintPos = new Float32Array(this.list.length * 3)
    const col = new Float32Array(this.list.length * 3)
    const seed = new Float32Array(this.list.length)
    this.list.forEach((n, i) => {
      const c = new THREE.Color(GLINT[n.kind])
      col.set([c.r, c.g, c.b], i * 3)
      seed[i] = Math.random() * 10
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.glintPos, 3))
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
    this.glints = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uScale: { value: 500 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSeed; uniform float uTime; uniform float uScale; varying vec3 vC; varying float vA;
        void main(){ vC = aColor; vec3 p = position; p.y += sin(uTime * 1.6 + aSeed) * 0.15;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); float d = -mv.z;
          vA = (0.55 + 0.45 * sin(uTime * 3.0 + aSeed * 2.0)) * smoothstep(90.0, 60.0, d);
          gl_PointSize = 0.32 * uScale / max(1.0, d); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying float vA;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0; float star = max(0.0, 1.0 - d) + max(0.0, 1.0 - abs(c.x) * 14.0) * max(0.0, 1.0 - abs(c.y) * 2.2) * 0.6 + max(0.0, 1.0 - abs(c.y) * 14.0) * max(0.0, 1.0 - abs(c.x) * 2.2) * 0.6;
          if (star < 0.02) discard; gl_FragColor = vec4(vC * star * vA * 1.4, 1.0); }`,
    }))
    this.glints.frustumCulled = false
    this.glints.renderOrder = 7
    this.group.add(this.glints)
    this.list.forEach((n, i) => this.writeGlint(n, i))
  }

  private place(colliders: Colliders): void {
    const T = this.terrain
    const r = rng(777)
    const ok = (x: number, z: number, kind: NodeKind) => {
      if (!T.walkable(x, z) || T.heightAt(x, z) < 0.4 || T.slopeAt(x, z) > 0.6) return false
      if (Math.hypot(x - POI.camp.x, z - POI.camp.z) < 22) return false
      if (Math.hypot(x - ARENAS.wyrm.x, z - ARENAS.wyrm.z) < ARENAS.wyrm.radius + 4) return false
      if (kind !== 'bone' && Math.hypot(x - ARENAS.ruins.x, z - ARENAS.ruins.z) < ARENAS.ruins.radius - 4) return false
      if (!colliders.clear(x, z, 1.3)) return false
      for (const n of this.list) if ((n.x - x) ** 2 + (n.z - z) ** 2 < 49) return false
      return true
    }
    const add = (kind: NodeKind, x: number, z: number) => {
      this.list.push({ id: this.list.length, kind, x, y: T.heightAt(x, z), z, yaw: r() * Math.PI * 2, scale: 0.9 + r() * 0.35, active: true, respawnT: 0, slot: 0 })
    }
    // Starter set in a ring around camp so the first objective is quick (trees/boulders come from the scenery).
    const starter: NodeKind[] = ['fiber', 'herb', 'fiber', 'fiber', 'herb', 'fiber']
    starter.forEach((kind, i) => {
      for (let tries = 0; tries < 80; tries += 1) {
        const a = (i / starter.length) * Math.PI * 2 + (r() - 0.5) * 0.4
        const d = 26 + r() * 26
        const x = POI.camp.x + Math.cos(a) * d
        const z = POI.camp.z + Math.sin(a) * d
        if (ok(x, z, kind)) {
          add(kind, x, z)
          break
        }
      }
    })
    for (const p of PLAN) {
      let placed = 0
      for (let tries = 0; tries < p.count * 400 && placed < p.count; tries += 1) {
        const x = (r() * 2 - 1) * 320
        const z = (r() * 2 - 1) * 320
        const region = T.regionAt(x, z)
        if (p.region === 'shore') {
          const h = T.heightAt(x, z)
          if (region !== 'coast' || h > 3.5) continue
        } else if (region !== p.region) continue
        if (p.kind === 'sulfur' && T.volcanoDistance(x, z) > 125) continue
        if (p.kind === 'obsidian' && T.volcanoDistance(x, z) > 135) continue
        if (!ok(x, z, p.kind)) continue
        add(p.kind, x, z)
        placed += 1
      }
    }
  }

  private write(n: GNode): void {
    const ms = this.meshes.get(n.kind)
    if (!ms) return
    if (n.active) this.m4.compose(new THREE.Vector3(n.x, n.y, n.z), this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), n.yaw), new THREE.Vector3(n.scale, n.scale, n.scale))
    for (const m of ms) {
      m.setMatrixAt(n.slot, n.active ? this.m4 : this.zero)
      m.instanceMatrix.needsUpdate = true
    }
  }

  private writeGlint(n: GNode, i: number): void {
    this.glintPos.set(n.active ? [n.x, n.y + 1.7 * n.scale, n.z] : [0, -9999, 0], i * 3)
    this.glints.geometry.getAttribute('position').needsUpdate = true
  }

  nearest(x: number, z: number, r: number): GNode | null {
    let best: GNode | null = null
    let bd = r * r
    for (const n of this.list) {
      if (!n.active) continue
      const d = (n.x - x) ** 2 + (n.z - z) ** 2
      if (d < bd) {
        bd = d
        best = n
      }
    }
    return best
  }

  nearestOfKind(kind: NodeKind, x: number, z: number): GNode | null {
    let best: GNode | null = null
    let bd = Infinity
    for (const n of this.list) {
      if (!n.active || n.kind !== kind) continue
      const d = (n.x - x) ** 2 + (n.z - z) ** 2
      if (d < bd) {
        bd = d
        best = n
      }
    }
    return best
  }

  deplete(n: GNode): void {
    n.active = false
    n.respawnT = CONFIG.expedition.nodeRespawn * (0.8 + Math.random() * 0.4)
    this.write(n)
    this.writeGlint(n, n.id)
  }

  update(dt: number, time: number, pixelScale: number): void {
    const u = (this.glints.material as THREE.ShaderMaterial).uniforms
    u.uTime.value = time
    u.uScale.value = pixelScale
    for (const n of this.list) {
      if (n.active) continue
      n.respawnT -= dt
      if (n.respawnT <= 0) {
        n.active = true
        this.write(n)
        this.writeGlint(n, n.id)
      }
    }
  }
}
