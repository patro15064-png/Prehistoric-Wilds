import { chromium } from 'playwright'
// Scripted playtest: node scripts/play.mjs [baseUrl] [scenario,...]
const base = process.argv[2] ?? 'http://127.0.0.1:3000/'
const only = (process.argv[3] ?? '').split(',').filter(Boolean)
const out = 'shots'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})
const G = fn => page.evaluate(fn)
const wait = ms => page.waitForTimeout(ms)
const shot = async name => {
  await page.screenshot({ path: `${out}/play-${name}.png`, timeout: 120000 })
  console.log('shot', name)
}
const want = s => only.length === 0 || only.includes(s)

await page.goto(base, { waitUntil: 'domcontentloaded' })
if (want('boot')) { await page.waitForTimeout(1200); await shot('boot') }
await page.waitForLoadState('load')
await page.waitForFunction(() => window.__game?.game?.mode === 'title', null, { timeout: 240000 })
await page.evaluate(() => localStorage.clear())
await wait(2500)
if (want('title')) await shot('title')
await page.click('[data-act="new"]')
await wait(2500)
const state = () => G(() => {
  const g = window.__game.game
  return { mode: g.mode, hp: Math.round(g.player.hp), st: Math.round(g.player.stamina), pos: [g.player.pos.x, g.player.pos.y, g.player.pos.z].map(v => +v.toFixed(1)), obj: g.objective().title, region: g.region, screen: window.__game.ui.screen }
})
console.log('after start', JSON.stringify(await state()))
if (want('hud')) {
  // Walk forward a little (W held) and turn the camera.
  await page.keyboard.down('KeyW')
  await wait(1500)
  await page.keyboard.up('KeyW')
  await wait(400)
  await shot('camp')
}
if (want('gather')) {
  const r = await G(() => {
    const g = window.__game.game
    const n = g.nodes.nearestOfKind('wood', g.player.pos.x, g.player.pos.z)
    if (!n) return 'no node'
    g.player.place(n.x + 1.6, n.z + 1.2, g.terrain, 0)
    g.cam.snap(g.player.pos, Math.atan2(n.x - g.player.pos.x, n.z - g.player.pos.z) + Math.PI)
    return `node at ${n.x.toFixed(1)},${n.z.toFixed(1)}`
  })
  console.log('gather:', r)
  await wait(500)
  console.log('interact:', JSON.stringify(await G(() => window.__game.game.interact)))
  await page.keyboard.press('KeyE')
  await wait(1400)
  console.log('inv:', JSON.stringify(await G(() => window.__game.game.progress.inv)))
  await shot('gather')
}
if (want('combat')) {
  const r = await G(() => {
    const g = window.__game.game
    const c = g.creatures.find(c => c.def.id === 'tuskhog' && c.alive)
    const f = c.forward
    g.player.place(c.pos.x + f.x * 7, c.pos.z + f.z * 7, g.terrain, c.yaw + Math.PI)
    g.cam.snap(g.player.pos, c.yaw + Math.PI)
    window.__target = c
    return `${c.def.name} at ${c.pos.x.toFixed(1)},${c.pos.z.toFixed(1)}`
  })
  console.log('combat vs', r)
  await wait(1200)
  await shot('combat-approach')
  // Wait for a windup to capture a telegraph.
  for (let i = 0; i < 40; i++) {
    const s = await G(() => window.__target.state)
    if (s === 'windup') break
    await wait(100)
  }
  await wait(200)
  await shot('combat-telegraph')
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('KeyJ')
    await wait(260)
  }
  await shot('combat-hits')
  console.log('target', JSON.stringify(await G(() => ({ hp: window.__target.hp, state: window.__target.state }))), JSON.stringify(await state()))
  // Finish it with heavies and carve.
  for (let i = 0; i < 30; i++) {
    const alive = await G(() => window.__target.alive)
    if (!alive) break
    await G(() => {
      const g = window.__game.game
      const c = window.__target
      g.lockTarget = c
      if (!g.player.alive) g.player.revive()
    })
    await page.keyboard.press('KeyJ')
    await wait(300)
  }
  await G(() => {
    const g = window.__game.game
    const c = window.__target
    if (c.alive) c.takeHit(9999, 1, true, g.player.pos, g.cctx)
  })
  await wait(1500)
  await G(() => {
    const g = window.__game.game
    const c = window.__target
    const d = Math.hypot(c.pos.x - g.player.pos.x, c.pos.z - g.player.pos.z)
    if (d > c.def.radius + 1.6) g.player.place(c.pos.x + c.def.radius + 1, c.pos.z, g.terrain, -Math.PI / 2)
  })
  await wait(300)
  console.log('carve prompt', JSON.stringify(await G(() => window.__game.game.interact)))
  await page.keyboard.press('KeyE')
  await wait(1300)
  await shot('carve')
  console.log('inv after carve', JSON.stringify(await G(() => window.__game.game.progress.inv)))
}
if (want('camp')) {
  await G(() => {
    const g = window.__game.game
    const p = g.progress
    Object.assign(p.inv, { wood: 30, stone: 30, fiber: 20, flint: 10, bone: 10, herb: 10, hogTusk: 6, roughHide: 6, snapperScale: 4 })
    g.player.place(24 + 2.5, 48 + 2.5, g.terrain, 0)
  })
  await wait(600)
  console.log('camp interact', JSON.stringify(await G(() => window.__game.game.interact)))
  await page.keyboard.press('KeyE')
  await wait(600)
  await shot('menu-camp')
  await page.click('[data-act="upgrade"]').catch(e => console.log('upgrade click failed', e.message))
  await wait(2500)
  await shot('camp-stage1')
  await page.keyboard.press('Tab')
  await wait(500)
  await page.click('[data-tab="craft"]')
  await wait(300)
  await shot('menu-craft')
  await page.keyboard.press('Escape')
  await wait(300)
}
if (want('regions')) {
  for (const [name, x, z] of [['highlands', 110, -30], ['ruins', 118, -40], ['caldera', 10, -120], ['crater', -12, -160], ['beach', -4, 230]]) {
    await G(([x, z]) => {
      const g = window.__game.game
      g.player.place(x, z, g.terrain, Math.PI)
      g.cam.snap(g.player.pos, Math.PI)
    }, [x, z])
    await page.evaluate(([x, z]) => {
      const g = window.__game.game
      g.player.place(x, z, g.terrain, Math.PI)
    }, [x, z])
    await wait(2500)
    await shot(`region-${name}`)
  }
}
if (want('perf')) {
  const fps = await page.evaluate(() => new Promise(res => {
    let n = 0
    const t0 = performance.now()
    const f = () => {
      n++
      if (performance.now() - t0 < 3000) requestAnimationFrame(f)
      else res(n / 3)
    }
    requestAnimationFrame(f)
  }))
  const info = await G(() => {
    const r = window.__game.game
    return { calls: r['renderer'].gl.info.render.calls, tris: r['renderer'].gl.info.render.triangles }
  })
  console.log('fps (swiftshader)', fps.toFixed(1), JSON.stringify(info))
}
if (want('lab')) {
  await page.goto(new URL('enemies/?species=ruinhorn&attack=quake', base).href, { waitUntil: 'load' })
  await wait(2500)
  await page.screenshot({ path: `${out}/lab-ruinhorn.png`, timeout: 120000 })
  await page.evaluate(() => window.__lab.select('vulkarr', 'breath'))
  await wait(1500)
  await page.screenshot({ path: `${out}/lab-vulkarr.png`, timeout: 120000 })
  console.log('lab shots done')
}
console.log('final', JSON.stringify(await state().catch(() => 'n/a')))
console.log('errors', errors.length ? errors.slice(0, 12).join('\n') : 'none')
await browser.close()
