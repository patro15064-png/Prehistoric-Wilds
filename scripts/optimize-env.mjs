// Optimise catalog environment models (Quaternius Stylized Nature MegaKit, CC0) for the browser.
// Usage: node scripts/optimize-env.mjs   (reads assets/megakit/glTF/*.gltf -> public/models/env/<name>.glb)
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, weld, prune, textureCompress, meshopt, getBounds, flatten, join, simplify } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { mkdirSync, readdirSync, statSync } from 'node:fs'
await MeshoptEncoder.ready
await MeshoptSimplifier.ready
// Triangle budgets: trees are instanced by the thousand, so keep each near ~2k tris.
const RATIO = { CommonTree_1: 0.35, CommonTree_3: 0.55, CommonTree_5: 0.6, TwistedTree_1: 0.2, TwistedTree_3: 0.2, DeadTree_1: 0.3, Bush_Common_Flowers: 0.5, Flower_3_Group: 0.6 }
// Only rebuild models the game ships (others in the kit are unused).
const SHIP = new Set(readdirSync('public/models/env').map(f => f.replace('.glb', '')))
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
const dir = 'assets/megakit/glTF'
mkdirSync('public/models/env', { recursive: true })
for (const f of readdirSync(dir).filter(f => f.endsWith('.gltf') && SHIP.has(f.replace('.gltf', '')))) {
  const name = f.replace('.gltf', '')
  const doc = await io.read(`${dir}/${f}`)
  const root = doc.getRoot()
  for (const m of root.listMaterials()) {
    m.setNormalTexture(null) // big normal maps are the heaviest part and add specular sparkle
    m.setMetallicFactor(0)
    m.setRoughnessFactor(1)
    m.setEmissiveTexture(null)
    m.setEmissiveFactor([0, 0, 0])
  }
  await doc.transform(dedup(), flatten(), join(), weld(), prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80 }))
  if (RATIO[name]) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: RATIO[name], error: 0.12, lockBorder: false }), prune())
  const b = getBounds(root.getDefaultScene() ?? root.listScenes()[0])
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  const out = `public/models/env/${name}.glb`
  await io.write(out, doc)
  let tris = 0
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3
  const mats = root.listMaterials().map(m => `${m.getName()}:${m.getAlphaMode()}`).join(',')
  console.log(`${name}: ${(statSync(out).size / 1e3).toFixed(0)}KB tris=${tris} h=${(b.max[1] - b.min[1]).toFixed(2)} w=${(b.max[0] - b.min[0]).toFixed(2)} minY=${b.min[1].toFixed(2)} mats=${mats}`)
}
