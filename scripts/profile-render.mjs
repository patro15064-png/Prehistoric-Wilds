import { chromium } from 'playwright'
// Render-cost profiler: hides one render group at a time and times synced full renders
// (shadow pass + colour pass + bloom). Usage: node scripts/profile-render.mjs [url] [views]
// Pass 'base' as the 3rd arg to only time each view. Prints one line per measurement so partial runs still yield data.
const base = process.argv[2] ?? 'http://127.0.0.1:3000/'
const VIEWS = { camp: null, jungle: [90, 110], highlands: [120, -40], caldera: [-20, -168] }
const want = (process.argv[3] ?? Object.keys(VIEWS).join(',')).split(',')
const baseOnly = process.argv[4] === 'base'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
page.on('pageerror', e => console.log('pageerror', e.message))
const G = (fn, a) => page.evaluate(fn, a)
await page.goto(base, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__game?.game?.mode === 'title', null, { timeout: 240000 })
await G(() => localStorage.clear())
await page.click('[data-act="new"]')
await page.waitForTimeout(3000)
await G(() => {
  const g = window.__game.game, S = g.scenery, R = g.renderer
  const gl = R.gl.getContext(), px = new Uint8Array(4)
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
  // Groups: [label, hide(), show()]
  const matToggle = objs => {
    const mats = new Set()
    objs.forEach(o => o.traverse(m => { if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => mats.add(x)) }))
    return [() => mats.forEach(m => { m.userData.pv = m.visible; m.visible = false }), () => mats.forEach(m => { m.visible = m.userData.pv ?? true })]
  }
  const chunkToggle = pred => {
    let saved = []
    return [() => { saved = S.chunks.filter(pred).map(c => [c.mesh, c.mesh.count]); saved.forEach(([m]) => m.count = 0) }, () => saved.forEach(([m, n]) => m.count = n)]
  }
  const detailed = c => !c.proxy && !c.far && c.mesh.material.alphaTest > 0
  const groups = []
  for (const [k, objs] of Object.entries(S.debug)) groups.push([k, ...matToggle(objs)])
  groups.push(['leaves:detailed(alphaTest)', ...chunkToggle(detailed)])
  groups.push(['trees:shadowProxies', ...chunkToggle(c => c.proxy)])
  groups.push(['trees:procedural+far', ...chunkToggle(c => !c.proxy && !detailed(c) && /palm|jungle|acacia|bush|bigleaf|deadtree/.test(c.name))])
  groups.push(['grass', ...chunkToggle(c => /^grass/.test(c.name))])
  groups.push(['flowers+reeds+mushroom', ...chunkToggle(c => /flower|reeds|mushroom|fern/.test(c.name) && !detailed(c))])
  groups.push(['rocks+ruins', ...chunkToggle(c => /rock|basalt|obsidian|drift|ruin/.test(c.name))])
  const creatures = g.scene.children.filter(o => /^creature-/.test(o.name))
  groups.push(['creatures', ...matToggle(creatures)])
  groups.push(['caveman', ...matToggle(g.scene.children.filter(o => o.name === 'caveman'))])
  const others = g.scene.children.filter(o => o !== S.root && !/^creature-|^caveman$/.test(o.name))
  groups.push(['camp+nodes+fx+other', ...matToggle(others)])
  groups.push(['shadows(sun)', () => { S.sun.castShadow = false }, () => { S.sun.castShadow = true }])
  window.__prof = {
    groups,
    time(n = 2) { g.render(1 / 60); sync(); let best = 1e9; for (let i = 0; i < n; i++) { const t0 = performance.now(); g.render(1 / 60); sync(); best = Math.min(best, performance.now() - t0) } return best },
    info() { const r = R.gl; r.info.autoReset = false; r.info.reset(); g.render(1 / 60); const v = { calls: r.info.render.calls, ktris: Math.round(r.info.render.triangles / 1000) }; r.info.autoReset = true; return v },
  }
})
const n = await G(() => window.__prof.groups.length)
for (const view of want) {
  const xz = VIEWS[view]
  if (xz) await G(([x, z]) => { const g = window.__game.game; g.player.place(x, z, g.terrain, 0); g.cam.snap(g.player.pos, Math.PI) }, xz)
  await page.waitForTimeout(2500)
  const b = await G(() => window.__prof.time(3))
  const info = await G(() => window.__prof.info())
  console.log(`\n== ${view} base ${Math.round(b)}ms calls ${info.calls} tris ${info.ktris}k`)
  const rows = []
  for (let i = 0; i < (baseOnly ? 0 : n); i++) {
    const [label, ms, ktris] = await G(i => {
      const [label, hide, show] = window.__prof.groups[i]
      hide(); const ms = window.__prof.time(2); const k = window.__prof.info().ktris; show(); window.__prof.time(1)
      return [label, ms, k]
    }, i)
    const saved = Math.round(b - ms)
    rows.push([label, saved])
    console.log(`${view} | ${label} | saves ${saved}ms (${Math.round((saved / b) * 100)}%) | tris without ${ktris}k`)
  }
  await page.screenshot({ path: `shots/prof-${view}.png`, timeout: 120000 })
}
await browser.close()
console.log('done')
