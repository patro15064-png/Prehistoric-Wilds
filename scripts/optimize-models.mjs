// Optimise generated GLBs for the browser.
// Usage: node scripts/optimize-models.mjs <name> [<name> ...]   (reads art/models/raw/<name>.glb)
// Writes public/models/<name>.glb and prints bounds so orientation/scale can be set in code.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, weld, prune, resample, simplify, textureCompress, meshopt, getBounds } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { mkdirSync, statSync } from 'node:fs'

// Per-asset settings: texture size, triangle ratio, whether the emissive map is kept (lava glow only).
const PRESETS = {
  default: { tex: 1024, ratio: 1, emissive: false },
  weapon: { tex: 512, ratio: 1, emissive: false },
  hunter: { tex: 1024, ratio: 1, emissive: false },
  emberbeetle: { tex: 1024, ratio: 1, emissive: true },
  vulkarr: { tex: 1024, ratio: 1, emissive: true },
  ruinhorn: { tex: 1024, ratio: 1, emissive: false },
  'w-axe': { tex: 512, ratio: 0.35, emissive: false },
  'w-pick': { tex: 512, ratio: 0.35, emissive: false },
  'w-spear': { tex: 512, ratio: 0.35, emissive: false },
  'w-sling': { tex: 512, ratio: 0.35, emissive: false },
}
const preset = n => PRESETS[n] ?? (n.startsWith('w-') ? PRESETS.weapon : n.startsWith('hunter') ? PRESETS.hunter : PRESETS.default)

await MeshoptEncoder.ready
await MeshoptSimplifier.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
mkdirSync('public/models', { recursive: true })

for (const name of process.argv.slice(2)) {
  const src = name.includes('/') ? name : `art/models/raw/${name}.glb`
  const base = src.split('/').pop().replace(/\.glb$/, '')
  const p = preset(base)
  const doc = await io.read(src)
  const root = doc.getRoot()
  for (const m of root.listMaterials()) {
    // Glare control: fully rough-ish, never metallic, emissive only where it reads as lava.
    m.setMetallicFactor(0)
    m.setRoughnessFactor(Math.max(m.getRoughnessFactor(), 0.85))
    if (!p.emissive) { m.setEmissiveTexture(null); m.setEmissiveFactor([0, 0, 0]) }
    else m.setEmissiveFactor([0.55, 0.55, 0.55])
    m.setDoubleSided(false)
  }
  const skinned = root.listSkins().length > 0
  const tasks = [dedup(), prune()]
  if (!skinned) tasks.push(weld())
  if (p.ratio < 1) tasks.push(simplify({ simplifier: MeshoptSimplifier, ratio: p.ratio, error: 0.002 }))
  if (root.listAnimations().length) tasks.push(resample())
  tasks.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [p.tex, p.tex], quality: 82 }))
  await doc.transform(...tasks)
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  const b = getBounds(scene)
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  const out = `public/models/${base}.glb`
  await io.write(out, doc)
  const size = (a, i) => (a.max[i] - a.min[i]).toFixed(3)
  let tris = 0
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3
  console.log(`${base}: ${(statSync(out).size / 1e6).toFixed(2)}MB tris=${tris} size xyz=${size(b, 0)} ${size(b, 1)} ${size(b, 2)} min=${b.min.map(v => v.toFixed(2))} skins=${root.listSkins().length} anims=${root.listAnimations().map(a => a.getName()).join(',')}`)
}
