import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { SpeciesId } from './data'
import { applyPose, buildRig, restPose, type Rig } from './creatureModels'

/**
 * Auto-skinning: the generated creature GLBs are static meshes, so we bind them to the
 * procedural pose rig (body / neck / head / jaw / tail / legs / wings) that gameplay already
 * animates. Per species (once):
 *   1. bake the GLB into rig space, scaled to the procedural silhouette (feet on y = 0);
 *   2. refit each leg's hip to the GLB's foot cluster so legs swing the right geometry;
 *   3. compute smooth skin weights from distance to bone segments (top-4, falloff d^-4);
 *   4. capture rest-pose bone inverses.
 * Per instance: new SkinnedMesh(shared geometry, cloned material) bound to that instance's rig.
 */
type BoneRef = { obj: (r: Rig) => THREE.Object3D; kind: 'body' | 'neck' | 'head' | 'jaw' | 'tail' | 'hip' | 'knee' | 'wing'; index: number }
type Prepared = {
  geos: THREE.BufferGeometry[]
  mats: THREE.MeshStandardMaterial[]
  bones: BoneRef[]
  inverses: THREE.Matrix4[]
  hipShift: THREE.Vector3[]
  glow: boolean
}
const cache = new Map<SpeciesId, Prepared>()

const GLOW_SPECIES = new Set<SpeciesId>(['emberbeetle', 'vulkarr'])

function toFloat(geo: THREE.BufferGeometry, name: string): void {
  const a = geo.getAttribute(name) as THREE.BufferAttribute | undefined
  if (!a || a.array instanceof Float32Array && !a.normalized) return
  const out = new Float32Array(a.count * a.itemSize)
  for (let i = 0; i < a.count; i += 1) for (let k = 0; k < a.itemSize; k += 1) out[i * a.itemSize + k] = a.getComponent(i, k)
  geo.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize))
}

function boneList(rig: Rig): BoneRef[] {
  const out: BoneRef[] = [{ obj: r => r.body, kind: 'body', index: 0 }]
  rig.neck.forEach((_, i) => out.push({ obj: r => r.neck[i], kind: 'neck', index: i }))
  out.push({ obj: r => r.head, kind: 'head', index: 0 })
  if (rig.jaw) out.push({ obj: r => r.jaw!, kind: 'jaw', index: 0 })
  rig.tail.forEach((_, i) => out.push({ obj: r => r.tail[i], kind: 'tail', index: i }))
  rig.legs.forEach((l, i) => {
    out.push({ obj: r => r.legs[i].hip, kind: 'hip', index: i })
    if (l.knee) out.push({ obj: r => r.legs[i].knee!, kind: 'knee', index: i })
  })
  rig.wings.forEach((_, i) => out.push({ obj: r => r.wings[i], kind: 'wing', index: i }))
  return out
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  _a.subVectors(b, a)
  const len2 = _a.lengthSq()
  const t = len2 > 1e-8 ? THREE.MathUtils.clamp(_b.subVectors(p, a).dot(_a) / len2, 0, 1) : 0
  return _b.copy(a).addScaledVector(_a, t).distanceTo(p)
}

function prepare(species: SpeciesId, gltf: GLTF): Prepared {
  const proto = buildRig(species)
  applyPose(proto, restPose())
  proto.root.updateMatrixWorld(true)

  // Procedural silhouette (rest pose, rig space).
  const pBox = new THREE.Box3()
  proto.root.traverse(o => { if ((o as THREE.Mesh).isMesh) pBox.expandByObject(o) })
  const pSize = pBox.getSize(new THREE.Vector3())

  // Bake GLB meshes into a common space.
  gltf.scene.updateMatrixWorld(true)
  const geos: THREE.BufferGeometry[] = []
  const mats: THREE.MeshStandardMaterial[] = []
  gltf.scene.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const g = m.geometry.clone()
    toFloat(g, 'position')
    toFloat(g, 'normal')
    g.applyMatrix4(m.matrixWorld)
    geos.push(g)
    mats.push(m.material as THREE.MeshStandardMaterial)
  })
  const gBox = new THREE.Box3()
  for (const g of geos) { g.computeBoundingBox(); gBox.union(g.boundingBox!) }
  const gSize = gBox.getSize(new THREE.Vector3())
  const s = Math.sqrt((pSize.z / gSize.z) * (pSize.y / gSize.y))
  const pc = pBox.getCenter(new THREE.Vector3())
  const gc = gBox.getCenter(new THREE.Vector3())
  const fit = new THREE.Matrix4().makeTranslation(pc.x, 0, pc.z)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-gc.x, -gBox.min.y, -gc.z))
  for (const g of geos) { g.applyMatrix4(fit); g.computeBoundingBox(); g.computeBoundingSphere() }
  const H = gSize.y * s
  const zMax = (gBox.max.z - gc.z) * s + pc.z

  // Refit legs: centroid of low vertices nearest to each hip (xz).
  const hipWorld = proto.legs.map(l => l.hip.getWorldPosition(new THREE.Vector3()))
  const sums = proto.legs.map(() => ({ x: 0, z: 0, n: 0 }))
  const v = new THREE.Vector3()
  for (const g of geos) {
    const pos = g.getAttribute('position')
    for (let i = 0; i < pos.count; i += 3) {
      v.fromBufferAttribute(pos, i)
      if (v.y > H * 0.12) continue
      let best = -1
      let bd = Infinity
      hipWorld.forEach((h, k) => { const d = (h.x - v.x) ** 2 + (h.z - v.z) ** 2; if (d < bd) { bd = d; best = k } })
      if (best >= 0) { sums[best].x += v.x; sums[best].z += v.z; sums[best].n += 1 }
    }
  }
  const hipShift = proto.legs.map((l, k) => {
    const sm = sums[k]
    if (sm.n < 20) return new THREE.Vector3()
    const d = new THREE.Vector3(sm.x / sm.n - hipWorld[k].x, 0, sm.z / sm.n - hipWorld[k].z)
    const lim = Math.max(0.25, pSize.z * 0.18)
    if (d.length() > lim) d.setLength(lim)
    l.hip.position.add(d)
    return d
  })
  proto.root.updateMatrixWorld(true)

  // Bone segments in rig space.
  const bones = boneList(proto)
  const W = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3())
  const segs = bones.map(b => {
    const o = b.obj(proto)
    const a = W(o)
    let e: THREE.Vector3
    let rad = 1
    switch (b.kind) {
      case 'body': {
        const back = proto.tail.length ? W(proto.tail[0]) : a.clone().add(new THREE.Vector3(0, 0, -pSize.z * 0.35))
        const front = proto.neck.length ? W(proto.neck[0]) : W(proto.head)
        a.copy(back); e = front; rad = 1.9; break
      }
      case 'neck': e = b.index + 1 < proto.neck.length ? W(proto.neck[b.index + 1]) : W(proto.head); rad = 1.1; break
      case 'head': {
        const fwd = new THREE.Vector3(0, 0, 1).transformDirection(proto.head.matrixWorld)
        const L = Math.max(pSize.z * 0.12, zMax - a.z)
        e = a.clone().addScaledVector(fwd, L); rad = 1.2; break
      }
      case 'jaw': e = a.clone().add(new THREE.Vector3(0, 0, pSize.z * 0.1)); rad = 0.6; break
      case 'tail': {
        if (b.index + 1 < proto.tail.length) e = W(proto.tail[b.index + 1])
        else { const prev = b.index > 0 ? W(proto.tail[b.index - 1]) : W(proto.body); e = a.clone().add(a.clone().sub(prev).normalize().multiplyScalar(pSize.z * 0.12)) }
        rad = 0.9; break
      }
      case 'hip': e = proto.legs[b.index].knee ? W(proto.legs[b.index].knee!) : new THREE.Vector3(a.x, 0, a.z); rad = 0.8; break
      case 'knee': e = new THREE.Vector3(a.x, 0, a.z); rad = 0.8; break
      case 'wing': e = a.clone().add(new THREE.Vector3(Math.sign(a.x || 1) * pSize.x * 0.45, 0, 0)); rad = 1.2; break
    }
    return { a, e: e!, rad, kind: b.kind, hipY: b.kind === 'hip' || b.kind === 'knee' ? W(proto.legs[b.index].hip).y : 0 }
  })
  const jawIdx = bones.findIndex(b => b.kind === 'jaw')
  const headIdx = bones.findIndex(b => b.kind === 'head')
  const jawY = jawIdx >= 0 ? segs[jawIdx].a.y : 0
  const jawZ = jawIdx >= 0 ? segs[jawIdx].a.z : 0

  // Skin weights.
  const nb = bones.length
  const w = new Float32Array(nb)
  for (const g of geos) {
    const pos = g.getAttribute('position')
    const si = new Uint16Array(pos.count * 4)
    const sw = new Float32Array(pos.count * 4)
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i)
      for (let k = 0; k < nb; k += 1) {
        const sg = segs[k]
        const d = segDist(v, sg.a, sg.e) / sg.rad + 1e-3
        let wk = 1 / (d * d * d * d)
        // Legs only claim geometry below their hip; everything above belongs to the torso.
        if ((sg.kind === 'hip' || sg.kind === 'knee') && v.y > sg.hipY + H * 0.04) wk *= 0.02
        if (sg.kind === 'jaw') wk = 0
        w[k] = wk
      }
      // Lower jaw: head-dominated vertices under and ahead of the jaw pivot.
      if (jawIdx >= 0) {
        let top = 0
        for (let k = 1; k < nb; k += 1) if (w[k] > w[top]) top = k
        if (top === headIdx && v.y < jawY + H * 0.02 && v.z > jawZ) { w[jawIdx] = w[headIdx] * 1.6 }
      }
      // Top 4.
      for (let slot = 0; slot < 4; slot += 1) {
        let best = 0
        for (let k = 1; k < nb; k += 1) if (w[k] > w[best]) best = k
        si[i * 4 + slot] = best
        sw[i * 4 + slot] = w[best]
        w[best] = -1
      }
      const tot = sw[i * 4] + sw[i * 4 + 1] + sw[i * 4 + 2] + sw[i * 4 + 3]
      for (let slot = 0; slot < 4; slot += 1) sw[i * 4 + slot] /= tot
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4))
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4))
  }

  const inverses = bones.map(b => b.obj(proto).matrixWorld.clone().invert())
  return { geos, mats, bones, inverses, hipShift, glow: GLOW_SPECIES.has(species) }
}

/** Replace a rig's procedural look with the realistic skinned model. Idempotent. */
export function attachModel(rig: Rig, gltf: GLTF): void {
  if (rig.model) return
  let p = cache.get(rig.species)
  if (!p) { p = prepare(rig.species, gltf); cache.set(rig.species, p) }

  // Same leg refit as the prototype so bone inverses match.
  rig.legs.forEach((l, k) => l.hip.position.add(p!.hipShift[k]))
  const bones = p.bones.map(b => b.obj(rig)) as unknown as THREE.Bone[]
  const skeleton = new THREE.Skeleton(bones, p.inverses)

  // Hide procedural parts (keep the transform hierarchy that drives the skin).
  rig.root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.visible = false })

  const flashU = { value: 0 }
  const group = new THREE.Group()
  group.name = `model-${rig.species}`
  const glowMats: THREE.MeshStandardMaterial[] = []
  p.geos.forEach((g, i) => {
    const mat = p!.mats[i].clone()
    mat.roughness = Math.max(mat.roughness, 0.85)
    mat.metalness = 0
    mat.envMapIntensity = 0.35
    mat.onBeforeCompile = sh => {
      sh.uniforms.uFlash = flashU
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uFlash;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.93, 0.8), uFlash * 0.75);')
    }
    if (p!.glow) { mat.emissive.set('#ffffff'); glowMats.push(mat) }
    const sm = new THREE.SkinnedMesh(g, mat)
    sm.castShadow = true
    sm.receiveShadow = false
    sm.frustumCulled = false
    sm.bind(skeleton, new THREE.Matrix4())
    group.add(sm)
  })
  rig.root.add(group)
  rig.model = group
  rig.flashU = flashU
  if (p.glow) { rig.glow = glowMats; rig.glowBase = 0.45 }
  else { rig.glow = []; rig.glowBase = 0 }
}
