import { chromium } from 'playwright'
// Chop/mine + perf playtest: node scripts/harvestplay.mjs [baseUrl]
// Places the hunter beside the nearest tree / boulder, swings with each held item, and reports
// swings-to-break, loot, errors, and renderer stats (draw calls / triangles / frame time) per region.
const base = process.argv[2] ?? 'http://127.0.0.1:3000/'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
const G = (fn, a) => page.evaluate(fn, a)
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { await page.screenshot({ path: `shots/harv-${name}.png`, timeout: 120000 }); console.log('shot', name) }

await page.goto(base, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__game?.game?.mode === 'title', null, { timeout: 240000 })
await G(() => localStorage.clear())
await page.click('[data-act="new"]')
await wait(2000)
console.log('objective', await G(() => window.__game.game.objective().title))

/** Stand next to the nearest live resource of `kind`, facing it. */
const approach = kind => G(k => {
  const g = window.__game.game, P = g.player
  const r = g.harvest.nearest(k, P.pos.x, P.pos.z, 400)
  if (!r) return null
  const ang = Math.random() * Math.PI * 2
  let best = null
  for (let i = 0; i < 12 && !best; i++) {
    const a = ang + i * 0.52
    const d = (k === 'tree' ? 0.9 : 1.2) + (r.radius ?? 0.6)
    const x = r.x + Math.sin(a) * d, z = r.z + Math.cos(a) * d
    if (g.terrain.walkable(x, z)) best = { x, z }
  }
  if (!best) return null
  P.place(best.x, best.z, g.terrain, Math.atan2(r.x - best.x, r.z - best.z))
  g.cam.snap(P.pos, P.yaw + Math.PI)
  return { id: r.id, def: r.def, x: +r.x.toFixed(1), z: +r.z.toFixed(1) }
}, kind)

/** Swing (light) until the resource breaks or 40 swings pass. */
const chop = async (kind, label) => {
  const r = await approach(kind)
  if (!r) { console.log(label, 'no target'); return }
  const inv0 = await G(() => ({ ...window.__game.game.progress.inv }))
  let swings = 0
  for (; swings < 40; swings++) {
    const live = await G(id => window.__game.game.harvest.isLive(id), r.id)
    if (!live) break
    if (swings === 2) await shot(`${label}-mid`)
    await page.keyboard.press('KeyJ')
    await wait(650)
  }
  await wait(900)
  if (label.endsWith('0')) await shot(`${label}-done`)
  const inv1 = await G(() => ({ ...window.__game.game.progress.inv }))
  const gained = Object.fromEntries(Object.keys(inv1).filter(k => (inv1[k] ?? 0) !== (inv0[k] ?? 0)).map(k => [k, (inv1[k] ?? 0) - (inv0[k] ?? 0)]))
  console.log(label, JSON.stringify({ target: r.def, swings, gained, held: await G(() => window.__game.game.progress.held) }))
}

// Club (starting weapon) on a tree and a boulder.
await chop('tree', 'club-tree0')
await chop('rock', 'club-rock0')
// Bare hands.
await page.keyboard.press('Digit4'); await wait(400)
await chop('tree', 'hands-tree')
// Locked tool key: should toast and stay on hands.
await page.keyboard.press('Digit2'); await wait(300)
console.log('locked key held =', await G(() => window.__game.game.progress.held))
// Grant the tools (as if crafted) and use them.
await G(() => { const g = window.__game.game; g.progress.owned.push('flintHatchet', 'flintPick'); g.save() })
await page.keyboard.press('Digit2'); await wait(1500)
await shot('hotbar-hatchet')
await chop('tree', 'hatchet-tree0')
await chop('tree', 'hatchet-tree')
await page.keyboard.press('Digit3'); await wait(1500)
await chop('rock', 'pick-rock0')
await chop('rock', 'pick-rock')
// Queued swap mid-swing.
await page.keyboard.press('KeyJ'); await wait(80); await page.keyboard.press('Digit1'); await wait(1400)
console.log('queued swap held =', await G(() => window.__game.game.progress.held))
console.log('harvested count', await G(() => window.__game.game.progress.harvested))

// Perf sampling per region: renderer.info + frame time over ~4 s.
const spots = { camp: null, jungle: [90, 110], highlands: [120, -40], caldera: [-20, -168] }
for (const [name, xz] of Object.entries(spots)) {
  if (xz) await G(([x, z]) => { const g = window.__game.game; g.player.place(x, z, g.terrain, 0); g.cam.snap(g.player.pos, Math.PI) }, xz)
  await wait(2500)
  const s = await G(async () => {
    const g = window.__game.game, r = g.renderer.gl
    const times = []
    let last = performance.now()
    await new Promise(res => { let n = 0; const f = t => { times.push(t - last); last = t; if (++n < 60) requestAnimationFrame(f); else res() }; requestAnimationFrame(f) })
    times.sort((a, b) => a - b)
    return { calls: r.info.render.calls, tris: r.info.render.triangles, geos: r.info.memory.geometries, texs: r.info.memory.textures, medianMs: +times[30].toFixed(1), p90Ms: +times[54].toFixed(1), fx: g.fx.activeCount, debris: g.harvest.activeCount, region: g.region }
  })
  console.log('perf', name, JSON.stringify(s))
  await shot(`perf-${name}`)
}
console.log('errors', errors.length ? errors.slice(0, 10).join('\n') : 'none')
await browser.close()
