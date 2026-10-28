import { chromium } from 'playwright'
// Usage: node scripts/vegprobe.mjs [def,...]  -> shots/veg-<def>.png ; prints material diagnostics
const base = 'http://127.0.0.1:3000/'
const defs = (process.argv[2] ?? 'jungle0,fern,bushJ').split(',')
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
page.on('pageerror', e => console.log('pageerror', e.message))
await page.goto(base, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__game?.game?.mode === 'title', null, { timeout: 240000 })
await page.evaluate(() => localStorage.clear())
await page.waitForTimeout(2000)
await page.click('[data-act="new"]')
await page.waitForTimeout(5000)
for (const d of defs) {
  await page.waitForFunction(name => window.__game.game.scenery.chunks.some(c => c.name === name && !c.far && c.mesh.material.type === 'MeshLambertMaterial'), d, { timeout: 240000, polling: 2000 }).catch(() => console.log('swap not loaded', d))
  const info = await page.evaluate(name => {
    const g = window.__game.game
    const sc = g.scenery
    const cs = sc.chunks.filter(c => c.name === name && !c.far)
    if (!cs.length) return { err: 'no chunks' }
    // Nearest instance to camp.
    let best = null
    const m = new g.player.pos.constructor()
    const mat4 = cs[0].mesh.matrixWorld.clone()
    for (const c of cs) for (let i = 0; i < c.mesh.count; i += 1) {
      c.mesh.getMatrixAt(i, mat4); m.setFromMatrixPosition(mat4)
      const dd = Math.hypot(m.x - 27, m.z - 52)
      if (!best || dd < best.d) best = { d: dd, x: m.x, y: m.y, z: m.z }
    }
    const dist = name.startsWith('jungle') || name.startsWith('acacia') ? 11 : 5
    g.player.place(best.x + dist, best.z + dist * 0.3, g.terrain, Math.PI / 2 + 0.3)
    g.cam.snap(g.player.pos, -Math.PI / 2 - 0.25)
    const mats = cs.map(c => { const mt = c.mesh.material; return `${mt.type} map=${!!mt.map} at=${mt.alphaTest} side=${mt.side} vis=${c.mesh.visible} n=${c.mesh.count}` })
    return { best, mats: [...new Set(mats)] }
  }, d)
  console.log(d, JSON.stringify(info))
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `shots/veg-${d}.png`, timeout: 120000 })
}
await browser.close()
