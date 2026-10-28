// Merge animation clips from several rigged GLBs (same skeleton, bone names) into one
// mesh-free animation library. Usage: node scripts/merge-anims.mjs out.glb name=path ...
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup, resample } from '@gltf-transform/functions'

const [out, ...pairs] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const entries = pairs.map(p => p.split('='))
const base = await io.read(entries[0][1])
const root = base.getRoot()
const nodesByName = new Map(root.listNodes().map(n => [n.getName(), n]))
for (const a of root.listAnimations()) a.dispose()
const buffer = root.listBuffers()[0]

for (const [name, path] of entries) {
  const src = await io.read(path)
  const anims = src.getRoot().listAnimations()
  if (!anims.length) { console.log('no anim in', path); continue }
  const srcAnim = anims[0]
  const anim = base.createAnimation(name)
  let n = 0
  for (const ch of srcAnim.listChannels()) {
    const tn = ch.getTargetNode()?.getName()
    const target = tn && nodesByName.get(tn)
    if (!target) continue
    const path = ch.getTargetPath()
    // Keep rotations for every bone; translation only for the root motion bone (Hips).
    if (path === 'scale') continue
    if (path === 'translation' && tn !== 'Hips') continue
    const s = ch.getSampler()
    const inp = base.createAccessor().setType('SCALAR').setArray(s.getInput().getArray().slice()).setBuffer(buffer)
    const outA = base.createAccessor().setType(s.getOutput().getType()).setArray(s.getOutput().getArray().slice()).setBuffer(buffer)
    const sampler = base.createAnimationSampler().setInput(inp).setOutput(outA).setInterpolation(s.getInterpolation())
    anim.addSampler(sampler)
    anim.addChannel(base.createAnimationChannel().setTargetNode(target).setTargetPath(path).setSampler(sampler))
    n += 1
  }
  const dur = srcAnim.listChannels()[0].getSampler().getInput().getMax([])[0]
  console.log(name, 'channels', n, 'duration', dur.toFixed(2))
}
// Strip meshes/skins/materials: keep only node hierarchy + animations.
for (const node of root.listNodes()) { node.setMesh(null); node.setSkin(null) }
for (const m of root.listMeshes()) m.dispose()
for (const s of root.listSkins()) s.dispose()
for (const t of root.listTextures()) t.dispose()
for (const m of root.listMaterials()) m.dispose()
await base.transform(resample({ tolerance: 1e-4 }), dedup(), prune())
await io.write(out, base)
console.log('wrote', out)
