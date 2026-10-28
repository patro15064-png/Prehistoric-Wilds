import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { rng } from './noise'

/**
 * Procedural stylised props. Every builder returns ONE merged, non-indexed BufferGeometry with
 * `position`, `normal` and `color` attributes, so each prop type renders as a single instanced
 * draw call. Colours are baked per vertex (no textures, tiny downloads).
 */

const tmpM = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const tmpE = new THREE.Euler()
const tmpS = new THREE.Vector3()
const tmpP = new THREE.Vector3()

export type ColorFn = (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color

/** Prepare a primitive: optional transform, bake colours, drop UVs, de-index. */
export function part(
  geo: THREE.BufferGeometry,
  color: THREE.ColorRepresentation | ColorFn,
  pos: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] | number = 1,
): THREE.BufferGeometry {
  let g = geo.index ? geo.toNonIndexed() : geo
  g.deleteAttribute('uv')
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  const s = typeof scale === 'number' ? [scale, scale, scale] : scale
  tmpM.compose(tmpP.set(...pos), tmpQ.setFromEuler(tmpE.set(...rot)), tmpS.set(s[0], s[1], s[2]))
  g.applyMatrix4(tmpM)
  const posA = g.getAttribute('position')
  const nrmA = g.getAttribute('normal')
  const colors = new Float32Array(posA.count * 3)
  const c = new THREE.Color()
  const v = new THREE.Vector3()
  const n = new THREE.Vector3()
  for (let i = 0; i < posA.count; i += 1) {
    if (typeof color === 'function') {
      v.fromBufferAttribute(posA, i)
      n.fromBufferAttribute(nrmA, i)
      c.copy(color(v, n))
    } else c.set(color)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  g = g.clone()
  return g
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!
  g.computeBoundingSphere()
  g.computeBoundingBox()
  return g
}

/** Organic blob: jittered icosphere with smooth normals (reads as painted foliage/rock). */
export function blob(radius: number, detail: number, jitter: number, seed: number, flat = false): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(radius, detail)
  g.deleteAttribute('uv')
  g.deleteAttribute('normal')
  g = mergeVertices(g)
  const r = rng(seed)
  const pos = g.getAttribute('position')
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i)
    const k = 1 + (r() - 0.5) * 2 * jitter
    pos.setXYZ(i, v.x * k, v.y * k, v.z * k)
  }
  g.computeVertexNormals()
  if (flat) {
    g = g.toNonIndexed()
    g.computeVertexNormals()
  }
  return g
}

const col = (hex: string) => new THREE.Color(hex)
const mix = (a: string, b: string, t: number) => col(a).lerp(col(b), Math.min(1, Math.max(0, t)))

/** Bent tapered strip (fronds, grass blades, leaves). Normals point up for soft foliage light. */
function strip(length: number, width: number, segs: number, droop: number, rise: number, widthFn: (t: number) => number, c0: string, c1: string): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const point = (t: number, side: number): [number, number, number] => {
    const w = widthFn(t) * width * side
    const y = rise * Math.sin(t * Math.PI * 0.5) - droop * t * t
    return [w, y, t * length]
  }
  for (let s = 0; s < segs; s += 1) {
    const t0 = s / segs
    const t1 = (s + 1) / segs
    const a = point(t0, -1)
    const b = point(t0, 1)
    const c = point(t1, -1)
    const d = point(t1, 1)
    const ca = mix(c0, c1, t0)
    const cb = mix(c0, c1, t1)
    positions.push(...a, ...c, ...b, ...b, ...c, ...d)
    for (const cc of [ca, cb, ca, ca, cb, cb]) colors.push(cc.r, cc.g, cc.b)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  const normals = new Float32Array(positions.length)
  for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  return g
}

function placeStrip(g: THREE.BufferGeometry, pos: [number, number, number], yaw: number, pitch: number): THREE.BufferGeometry {
  const out = g.clone()
  tmpM.compose(tmpP.set(...pos), tmpQ.setFromEuler(tmpE.set(pitch, yaw, 0, 'YXZ')), tmpS.set(1, 1, 1))
  out.applyMatrix4(tmpM)
  // keep foliage normals mostly up after rotation
  const n = out.getAttribute('normal')
  for (let i = 0; i < n.count; i += 1) n.setXYZ(i, 0, 1, 0)
  return out
}

// ─── Coast / jungle ────────────────────────────────────────────────────────

export function palmTree(seed: number): THREE.BufferGeometry {
  const r = rng(seed)
  const parts: THREE.BufferGeometry[] = []
  const H = 8 + r() * 2
  const bend = 1.2 + r() * 1.6
  const segs = 7
  const trunkAt = (t: number) => new THREE.Vector3(bend * t * t, H * t, 0)
  for (let s = 0; s < segs; s += 1) {
    const a = trunkAt(s / segs)
    const b = trunkAt((s + 1) / segs)
    const len = a.distanceTo(b)
    const rad = 0.34 - (s / segs) * 0.14
    const cyl = new THREE.CylinderGeometry(rad * 0.92, rad, len * 1.04, 7)
    const dir = b.clone().sub(a).normalize()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
    const e = new THREE.Euler().setFromQuaternion(q)
    const mid = a.clone().add(b).multiplyScalar(0.5)
    parts.push(part(cyl, s % 2 ? '#8b6a44' : '#a07c52', [mid.x, mid.y, mid.z], [e.x, e.y, e.z]))
  }
  const top = trunkAt(1)
  const frond = strip(4.4, 0.62, 6, 2.2, 0.9, t => Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.3), '#2f7f33', '#86cf55')
  const count = 9
  for (let i = 0; i < count; i += 1) {
    const yaw = (i / count) * Math.PI * 2 + r() * 0.3
    parts.push(placeStrip(frond, [top.x, top.y, top.z], yaw, -0.25 - r() * 0.35))
  }
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2
    parts.push(part(new THREE.IcosahedronGeometry(0.22, 0), '#6b4a2a', [top.x + Math.cos(a) * 0.3, top.y - 0.35, top.z + Math.sin(a) * 0.3]))
  }
  parts.push(part(new THREE.IcosahedronGeometry(0.42, 0), '#5d8a36', [top.x, top.y + 0.05, top.z]))
  return merge(parts)
}

export function jungleTree(seed: number, scale = 1): THREE.BufferGeometry {
  const r = rng(seed)
  const parts: THREE.BufferGeometry[] = []
  const H = (6.5 + r() * 3) * scale
  parts.push(part(new THREE.CylinderGeometry(0.34 * scale, 0.62 * scale, H, 8), (p) => mix('#5b412c', '#7d5a3c', p.y / H), [0, H / 2, 0]))
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + r()
    parts.push(part(new THREE.ConeGeometry(0.35 * scale, 2.2 * scale, 5), '#5b412c', [Math.cos(a) * 0.55 * scale, 0.7 * scale, Math.sin(a) * 0.55 * scale], [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6]))
  }
  // branch stubs
  for (let i = 0; i < 3; i += 1) {
    const a = r() * Math.PI * 2
    parts.push(part(new THREE.CylinderGeometry(0.12 * scale, 0.2 * scale, 2.6 * scale, 6), '#6a4b33', [Math.cos(a) * 0.9 * scale, H * 0.78, Math.sin(a) * 0.9 * scale], [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9]))
  }
  const greens = ['#2f7a34', '#3c9440', '#4fa845', '#357f3a']
  const n = 6 + Math.floor(r() * 3)
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 + r() * 0.5
    const d = (i === 0 ? 0 : 1.6 + r() * 1.4) * scale
    const rad = (1.9 + r() * 1.3) * scale
    const y = H + (r() * 1.6 - 0.2) * scale + (i === 0 ? 1.2 * scale : 0)
    const base = greens[Math.floor(r() * greens.length)]
    parts.push(part(blob(rad, 1, 0.22, seed * 31 + i), (p, nn) => mix('#1f5226', base, 0.35 + nn.y * 0.45 + (p.y - y) * 0.08), [Math.cos(a) * d, y, Math.sin(a) * d], [0, r() * 3, 0], [1, 0.78, 1]))
  }
  return merge(parts)
}

/** The Old Canopy: a colossal banyan with aerial roots and hanging vines (landmark). */
export function elderTree(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [jungleTree(99, 3.2)]
  const r = rng(4242)
  for (let i = 0; i < 16; i += 1) {
    const a = r() * Math.PI * 2
    const d = 6 + r() * 9
    const h = 16 + r() * 8
    parts.push(part(new THREE.CylinderGeometry(0.18, 0.32, h, 5), '#6e5238', [Math.cos(a) * d, h / 2, Math.sin(a) * d]))
  }
  for (let i = 0; i < 26; i += 1) {
    const a = r() * Math.PI * 2
    const d = 4 + r() * 12
    const h = 5 + r() * 7
    parts.push(part(new THREE.CylinderGeometry(0.05, 0.08, h, 4), '#4c8a3a', [Math.cos(a) * d, 27 - h / 2, Math.sin(a) * d]))
  }
  return merge(parts)
}

export function fern(seed: number): THREE.BufferGeometry {
  const r = rng(seed)
  const frond = strip(1.5, 0.28, 5, 0.9, 0.75, t => Math.sin(Math.PI * t) * (1 - t * 0.2), '#2d6e2e', '#6cc24a')
  const parts: THREE.BufferGeometry[] = []
  const n = 9
  for (let i = 0; i < n; i += 1) parts.push(placeStrip(frond, [0, 0.05, 0], (i / n) * Math.PI * 2 + r() * 0.4, -0.35 - r() * 0.3))
  return merge(parts)
}

export function bigLeafPlant(seed: number): THREE.BufferGeometry {
  const r = rng(seed)
  const parts: THREE.BufferGeometry[] = []
  const leaf = strip(1.7, 0.75, 5, 0.7, 0.35, t => Math.sin(Math.PI * Math.pow(t, 0.8)), '#1f5f2c', '#3fa24a')
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + r() * 0.5
    const h = 0.5 + r() * 0.7
    parts.push(part(new THREE.CylinderGeometry(0.03, 0.05, h, 4), '#3b7a33', [Math.cos(a) * 0.15, h / 2, Math.sin(a) * 0.15], [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3]))
    parts.push(placeStrip(leaf, [Math.cos(a) * 0.3, h, Math.sin(a) * 0.3], a + Math.PI / 2, -0.15 - r() * 0.2))
  }
  return merge(parts)
}

export function bush(seed: number, palette: string[]): THREE.BufferGeometry {
  const r = rng(seed)
  const parts: THREE.BufferGeometry[] = []
  const n = 4 + Math.floor(r() * 2)
  for (let i = 0; i < n; i += 1) {
    const a = r() * Math.PI * 2
    const d = i === 0 ? 0 : 0.5 + r() * 0.4
    const rad = 0.55 + r() * 0.45
    const base = palette[Math.floor(r() * palette.length)]
    parts.push(part(blob(rad, 1, 0.25, seed + i * 7), (_p, nn) => mix(palette[0], base, 0.45 + nn.y * 0.5), [Math.cos(a) * d, rad * 0.75, Math.sin(a) * d], [0, 0, 0], [1, 0.85, 1]))
  }
  return merge(parts)
}

export function grassTuft(seed: number, height: number, c0: string, c1: string, blades = 7): THREE.BufferGeometry {
  const r = rng(seed)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < blades; i += 1) {
    const h = height * (0.6 + r() * 0.6)
    const blade = strip(h, 0.07, 2, h * 0.35, 0, t => 1 - t, c0, c1)
    // rotate so the strip stands up (length along +y)
    const g = blade.clone()
    tmpM.makeRotationX(-Math.PI / 2 + 0.25 + r() * 0.3)
    g.applyMatrix4(tmpM)
    tmpM.makeRotationY(r() * Math.PI * 2)
    g.applyMatrix4(tmpM)
    tmpM.makeTranslation((r() - 0.5) * 0.35, 0, (r() - 0.5) * 0.35)
    g.applyMatrix4(tmpM)
    parts.push(g)
  }
  return merge(parts)
}

export function flower(seed: number, petal: string, center: string): THREE.BufferGeometry {
  const r = rng(seed)
  const parts: THREE.BufferGeometry[] = []
  for (let k = 0; k < 3; k += 1) {
    const ox = (r() - 0.5) * 0.5
    const oz = (r() - 0.5) * 0.5
    const h = 0.35 + r() * 0.35
    parts.push(part(new THREE.CylinderGeometry(0.015, 0.02, h, 3), '#3f8a35', [ox, h / 2, oz]))
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2
      parts.push(part(new THREE.SphereGeometry(0.07, 5, 3), petal, [ox + Math.cos(a) * 0.075, h, oz + Math.sin(a) * 0.075], [0, 0, 0], [1, 0.4, 1]))
    }
    parts.push(part(new THREE.SphereGeometry(0.045, 5, 3), center, [ox, h + 0.02, oz]))
  }
  return merge(parts)
}

export function reeds(seed: number): THREE.BufferGeometry {
  const r = rng(seed)
  const parts: THREE.BufferGeometry[] = [grassTuft(seed, 1.7, '#4a7a3a', '#a8c86a', 9)]
  for (let i = 0; i < 3; i += 1) {
    const x = (r() - 0.5) * 0.3
    const z = (r() - 0.5) * 0.3
    const h = 1.5 + r() * 0.5
    parts.push(part(new THREE.CylinderGeometry(0.015, 0.02, h, 3), '#6b8a45', [x, h / 2, z]))
    parts.push(part(new THREE.CylinderGeometry(0.06, 0.06, 0.28, 5), '#6a4228', [x, h, z]))
  }
  return merge(parts)
}

export function mushrooms(seed: number): THREE.BufferGeometry {
  const r = rng(seed)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 4; i += 1) {
    const x = (r() - 0.5) * 0.7
    const z = (r() - 0.5) * 0.7
    const h = 0.15 + r() * 0.3
    const cap = r() > 0.5 ? '#e2553a' : '#f0a34a'
    parts.push(part(new THREE.CylinderGeometry(0.035, 0.05, h, 5), '#f1e7cf', [x, h / 2, z]))
    parts.push(part(new THREE.SphereGeometry(0.11 + r() * 0.08, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), (_p, n) => (n.y > 0.85 && r() > 0.7 ? col('#fff5e0') : col(cap)), [x, h, z]))
  }
  return merge(parts)
}

export function driftwood(seed: number): THREE.BufferGeometry {
  const r = rng(seed)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 2; i += 1) {
    const len = 2.5 + r() * 2
    parts.push(part(new THREE.CylinderGeometry(0.14, 0.2, len, 6), '#cbb18a', [(r() - 0.5) * 0.6, 0.15, (r() - 0.5) * 0.6], [Math.PI / 2, r() * Math.PI, 0]))
  }
  return merge(parts)
}

// ─── Rocks ─────────────────────────────────────────────────────────────────

export function boulder(seed: number, base: string, top: string, dark: string): THREE.BufferGeometry {
  const r = rng(seed)
  const g = blob(1, 1, 0.3, seed, true)
  const s: [number, number, number] = [1 + r() * 0.5, 0.65 + r() * 0.35, 1 + r() * 0.4]
  return merge([part(g, (_p, n) => (n.y > 0.55 ? mix(base, top, (n.y - 0.55) * 2.4) : mix(dark, base, 0.5 + n.y * 0.8)), [0, 0.35, 0], [0, 0, 0], s)])
}

/** Layered sandstone spire (Stonefingers, mesa dressing). Unit height ~1, scaled per instance. */
export function spire(seed: number): THREE.BufferGeometry {
  const r = rng(seed)
  const parts: THREE.BufferGeometry[] = []
  const bands = ['#c77b47', '#e3a868', '#b5613a', '#d99058', '#9e5536']
  let y = 0
  let rad = 0.22
  const n = 6
  for (let i = 0; i < n; i += 1) {
    const h = 0.12 + r() * 0.1
    const top = rad * (0.82 + r() * 0.16)
    parts.push(part(new THREE.CylinderGeometry(top, rad, h, 7), bands[i % bands.length], [(r() - 0.5) * 0.03, y + h / 2, (r() - 0.5) * 0.03], [0, r() * 3, 0]))
    y += h
    rad = top
  }
  parts.push(part(blob(rad * 1.3, 0, 0.3, seed + 5, true), '#8a9a4a', [0, y + rad * 0.2, 0], [0, 0, 0], [1, 0.5, 1]))
  return merge(parts)
}

export function basaltCluster(seed: number): THREE.BufferGeometry {
  const r = rng(seed)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 8; i += 1) {
    const a = r() * Math.PI * 2
    const d = i === 0 ? 0 : 0.5 + r() * 0.8
    const h = 0.8 + r() * 2.6
    parts.push(part(new THREE.CylinderGeometry(0.42, 0.45, h, 6), (_p, n) => (n.y > 0.9 ? col('#6a5d56') : mix('#2c2624', '#433a36', r())), [Math.cos(a) * d, h / 2, Math.sin(a) * d]))
  }
  return merge(parts)
}

export function obsidianSpikes(seed: number): THREE.BufferGeometry {
  const r = rng(seed)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 5; i += 1) {
    const h = 0.8 + r() * 1.8
    parts.push(part(new THREE.OctahedronGeometry(0.35, 0), (_p, n) => mix('#140f1c', '#4a3a6a', Math.max(0, n.x * 0.5 + n.y * 0.5)), [(r() - 0.5) * 1.1, h * 0.5, (r() - 0.5) * 1.1], [(r() - 0.5) * 0.6, r() * 3, (r() - 0.5) * 0.6], [0.8, h * 1.4, 0.8]))
  }
  return merge(parts)
}

export function deadTree(seed: number): THREE.BufferGeometry {
  const r = rng(seed)
  const parts: THREE.BufferGeometry[] = []
  const H = 4 + r() * 3
  parts.push(part(new THREE.CylinderGeometry(0.12, 0.3, H, 6), '#2c2320', [0, H / 2, 0], [(r() - 0.5) * 0.2, 0, (r() - 0.5) * 0.2]))
  for (let i = 0; i < 4; i += 1) {
    const a = r() * Math.PI * 2
    const len = 1.2 + r() * 1.5
    const y = H * (0.5 + r() * 0.45)
    parts.push(part(new THREE.CylinderGeometry(0.04, 0.1, len, 4), i === 0 ? '#5a2a18' : '#2c2320', [Math.cos(a) * len * 0.4, y + len * 0.3, Math.sin(a) * len * 0.4], [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9]))
  }
  return merge(parts)
}

export function acacia(seed: number): THREE.BufferGeometry {
  const r = rng(seed)
  const parts: THREE.BufferGeometry[] = []
  const H = 4.5 + r() * 2
  const lean = (r() - 0.5) * 0.4
  parts.push(part(new THREE.CylinderGeometry(0.2, 0.34, H, 7), '#6b4a30', [lean * H * 0.5, H / 2, 0], [0, 0, -lean]))
  const tips: [number, number][] = []
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2 + r()
    const len = 2 + r() * 1.2
    const bx = lean * H + Math.cos(a) * len * 0.5
    const bz = Math.sin(a) * len * 0.5
    parts.push(part(new THREE.CylinderGeometry(0.08, 0.16, len, 5), '#6b4a30', [(lean * H + bx) / 2 + Math.cos(a) * 0.3, H + 0.5, bz / 2 + Math.sin(a) * 0.3], [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9]))
    tips.push([bx + Math.cos(a) * 0.5, bz + Math.sin(a) * 0.5])
  }
  for (const [x, z] of tips) {
    parts.push(part(blob(1.9 + r() * 0.8, 1, 0.2, seed + x * 10), (_p, n) => mix('#5b6f2a', '#a8b44a', 0.35 + n.y * 0.6), [x, H + 1.4, z], [0, 0, 0], [1.3, 0.34, 1.3]))
  }
  parts.push(part(blob(2.4, 1, 0.2, seed + 77), (_p, n) => mix('#5b6f2a', '#b5bd52', 0.35 + n.y * 0.6), [lean * H, H + 1.8, 0], [0, 0, 0], [1.4, 0.3, 1.4]))
  return merge(parts)
}

// ─── Ruins ─────────────────────────────────────────────────────────────────

const stone = (seed: number) => {
  const r = rng(seed)
  return (_p: THREE.Vector3, n: THREE.Vector3) => (n.y > 0.8 && r() > 0.55 ? mix('#8ba55a', '#c9c1a2', r() * 0.4) : mix('#b8ad90', '#d8cfb2', r()))
}

export function ruinColumn(seed: number, broken: boolean): THREE.BufferGeometry {
  const r = rng(seed)
  const h = broken ? 2.5 + r() * 3 : 7
  const parts = [
    part(new THREE.BoxGeometry(1.8, 0.5, 1.8), stone(seed), [0, 0.25, 0]),
    part(new THREE.CylinderGeometry(0.62, 0.7, h, 10), stone(seed + 1), [0, 0.5 + h / 2, 0]),
  ]
  if (!broken) parts.push(part(new THREE.BoxGeometry(1.9, 0.55, 1.9), stone(seed + 2), [0, 0.5 + h + 0.27, 0]))
  else parts.push(part(new THREE.CylinderGeometry(0.35, 0.62, 0.6, 7), stone(seed + 3), [0.1, 0.5 + h + 0.2, 0], [0.3, 0, 0.2]))
  return merge(parts)
}

export function ruinWall(seed: number): THREE.BufferGeometry {
  const r = rng(seed)
  const parts: THREE.BufferGeometry[] = []
  for (let row = 0; row < 4; row += 1) {
    for (let c = 0; c < 5; c += 1) {
      if (row > 1 && r() < 0.35 + row * 0.12) continue
      parts.push(part(new THREE.BoxGeometry(1.15, 0.7, 0.9), stone(seed + row * 9 + c), [c * 1.2 - 2.4 + (row % 2) * 0.3, row * 0.72 + 0.35, (r() - 0.5) * 0.1], [0, (r() - 0.5) * 0.08, (r() - 0.5) * 0.05]))
    }
  }
  return merge(parts)
}

export function ruinArch(): THREE.BufferGeometry {
  const parts = [
    ruinColumn(11, false).translate(-3.2, 0, 0),
    ruinColumn(12, false).translate(3.2, 0, 0),
    part(new THREE.BoxGeometry(8.6, 1.1, 2.1), stone(13), [0, 8.4, 0]),
    part(new THREE.BoxGeometry(2.4, 0.9, 2.2), stone(14), [0, 9.4, 0]),
  ]
  return merge(parts)
}

/** Weathered guardian head monolith; eye sockets are separate emissive gems in the scene. */
export function guardianHead(): THREE.BufferGeometry {
  const s = stone(51)
  const parts = [
    part(new THREE.BoxGeometry(3.2, 4.2, 2.8), s, [0, 2.1, 0]),
    part(new THREE.BoxGeometry(3.5, 0.6, 1.0), s, [0, 3.1, 1.3]),
    part(new THREE.BoxGeometry(0.7, 1.4, 0.8), s, [0, 2.2, 1.6]),
    part(new THREE.BoxGeometry(2.0, 0.35, 0.5), '#8a7f68', [0, 1.05, 1.45]),
    part(new THREE.BoxGeometry(0.8, 0.5, 0.3), '#3a3228', [-0.8, 2.75, 1.42]),
    part(new THREE.BoxGeometry(0.8, 0.5, 0.3), '#3a3228', [0.8, 2.75, 1.42]),
    part(new THREE.BoxGeometry(3.6, 0.9, 3.0), s, [0, 4.4, -0.1]),
  ]
  return merge(parts)
}

export function standingStone(seed: number): THREE.BufferGeometry {
  const r = rng(seed)
  return merge([part(blob(1, 0, 0.18, seed, true), stone(seed), [0, 1.8, 0], [0, r() * 3, (r() - 0.5) * 0.15], [0.7, 2.2, 0.45])])
}

// ─── Landmarks ─────────────────────────────────────────────────────────────

/** Titan's Ribs: the half-buried skeleton of an ancient sea beast on the beach. */
export function titanRibs(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const bone = (_p: THREE.Vector3, n: THREE.Vector3) => mix('#cdbf9f', '#f4ecd6', 0.4 + n.y * 0.5)
  for (let i = 0; i < 14; i += 1) {
    const z = i * 2.4 - 16
    const y = 1.2 + Math.sin((i / 13) * Math.PI) * 1.4
    parts.push(part(new THREE.BoxGeometry(1.3, 1.1, 1.5), bone, [0, y, z], [0.2, 0, 0]))
  }
  for (let i = 0; i < 9; i += 1) {
    const z = i * 2.8 - 10
    const size = 7 + Math.sin((i / 8) * Math.PI) * 4
    for (const side of [-1, 1]) {
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 2.4, z), new THREE.Vector3(side * size, size * 0.9, z + 1), new THREE.Vector3(side * size * 0.8, -0.8, z + 2))
      parts.push(part(new THREE.TubeGeometry(curve, 10, 0.38 - i * 0.012, 6), bone))
    }
  }
  const skull = [
    part(blob(3, 1, 0.12, 71), bone, [0, 2.4, -21], [0.2, 0, 0], [1.1, 0.8, 1.5]),
    part(new THREE.ConeGeometry(0.6, 5, 6), bone, [-2.2, 4.6, -20], [0.6, 0, 0.5]),
    part(new THREE.ConeGeometry(0.6, 5, 6), bone, [2.2, 4.6, -20], [0.6, 0, -0.5]),
    part(new THREE.SphereGeometry(0.8, 6, 4), '#3a3026', [-1.3, 3.2, -23.5]),
    part(new THREE.SphereGeometry(0.8, 6, 4), '#3a3026', [1.3, 3.2, -23.5]),
  ]
  parts.push(...skull)
  return merge(parts)
}

/** Whale Arch: a mossy natural sea arch. */
export function seaArch(): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(14, 5, 8, 18, Math.PI)
  const base = mergeVertices(g.deleteAttribute('uv').deleteAttribute('normal'))
  const r = rng(808)
  const pos = base.getAttribute('position')
  for (let i = 0; i < pos.count; i += 1) {
    const k = 1 + (r() - 0.5) * 0.12
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * (1 + (r() - 0.5) * 0.3))
  }
  base.computeVertexNormals()
  const flat = base.toNonIndexed()
  flat.computeVertexNormals()
  return merge([
    part(flat, (_p, n) => (n.y > 0.5 ? mix('#7a8f58', '#9ec06a', n.y) : mix('#6d6258', '#9a8c7a', 0.5 + n.x * 0.3)), [0, -2, 0], [0, 0, 0], [1, 1.25, 1]),
    boulder(5, '#8a7e70', '#7ea05a', '#5d544b').scale(6, 5, 6).translate(-15, -2, 0),
    boulder(6, '#8a7e70', '#7ea05a', '#5d544b').scale(5, 7, 5).translate(16, -3, 2),
  ])
}

export function geyserVent(seed: number): THREE.BufferGeometry {
  const r = rng(seed)
  return merge([
    part(new THREE.CylinderGeometry(0.7, 2.4, 1.1, 10), (_p, n) => (n.y > 0.7 ? mix('#e8d8a8', '#d98a3a', r()) : col('#bfa27a')), [0, 0.3, 0]),
    part(new THREE.CylinderGeometry(0.55, 0.55, 0.2, 10), '#3a4a4a', [0, 0.86, 0]),
    part(new THREE.CylinderGeometry(2.6, 3.1, 0.3, 12), '#e0b060', [0, -0.05, 0]),
  ])
}
