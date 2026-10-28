import { chromium } from 'playwright'
// Deeper Hunt feature playtest: node scripts/huntplay.mjs [baseUrl] [steps]
// Exercises cooking (sear gauge), journal, spear/sling, snare/flash pod and footprint tracking,
// capturing screenshots and any runtime errors.
const base = process.argv[2] ?? 'http://127.0.0.1:3000/'
const steps = (process.argv[3] ?? 'cook,journal,sling,spear,gadgets,tracks').split(',')
const want = s => steps.includes(s)
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
const G = (fn, a) => page.evaluate(fn, a)
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { await page.screenshot({ path: `shots/hunt-${name}.png`, timeout: 120000 }); console.log('shot', name) }
const log = (...a) => console.log(...a)

await page.goto(base, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__game?.game?.mode === 'title', null, { timeout: 240000 })
await G(() => localStorage.clear())
await page.click('[data-act="new"]')
await wait(2500)
// Seed a mid-game state.
await G(() => {
  const g = window.__game.game, p = g.progress
  p.campStage = 2
  g.camp.setStage(2, false, false)
  const add = (id, n) => { p.inv[id] = (p.inv[id] ?? 0) + n }
  for (const [id, n] of Object.entries({ meat: 6, herb: 8, fiber: 12, wood: 10, bone: 6, glowcap: 4, snapperScale: 2, sulfur: 2, stone: 20, snare: 2, flashPod: 2, pitfall: 1 })) add(id, n)
  for (const w of ['boneSpear', 'reedSling']) if (!p.owned.includes(w)) p.owned.push(w)
})

if (want('cook')) {
  await page.keyboard.press('Tab')
  await page.waitForFunction(() => window.__game.ui.screen === 'menu')
  await wait(300)
  await page.keyboard.press('Digit3')
  await page.waitForFunction(() => window.__game.ui.tab === 'cook')
  await wait(400)
  await shot('cook-tab')
  const bb = await page.locator('[data-act="cook"][data-id="heartyHaunch"]').boundingBox()
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2)
  // Poll the needle (sweeps 0→1 over 1.25 s of game time) and stop it inside the perfect band.
  for (let i = 0; i < 400; i++) {
    const t = await G(() => window.__game.ui.sear?.t ?? -1)
    if (t < 0) break
    if (t / 1.25 >= 0.63 && t < 1.25) break
    await wait(15)
  }
  await shot('cook-sear')
  await page.keyboard.press('Space')
  await wait(250)
  await shot('cook-result')
  log('meal', JSON.stringify(await G(() => window.__game.game.progress.meal)))
  await wait(1200)
  await page.keyboard.press('Escape')
  await wait(400)
}

if (want('journal')) {
  await G(() => {
    const g = window.__game.game, p = g.progress
    p.hunts.tuskhog = 3
    p.journal.tuskhog = { seen: true, clues: 2, tracked: true, weak: true, parts: ['hogTusk', 'roughHide'], best: 84 }
    p.journal.mudsnapper = { seen: true, clues: 1, tracked: false, weak: false, parts: [], best: 0 }
  })
  await page.keyboard.press('KeyB')
  await wait(600)
  await shot('journal')
  await G(() => document.querySelector('[data-act="jsel"][data-id="mudsnapper"]').click())
  await wait(300)
  await shot('journal-2')
  await page.keyboard.press('Escape')
  await wait(400)
}

const nearBeast = (sp, d) => G(([sp, d]) => {
  const g = window.__game.game
  const c = g.creatures.find(c => c.def.id === sp && c.alive) ?? g.creatures.find(c => c.alive && !c.def.boss)
  const f = c.forward
  g.player.place(c.pos.x + f.x * d, c.pos.z + f.z * d, g.terrain, c.yaw + Math.PI)
  g.cam.snap(g.player.pos, c.yaw + Math.PI)
  g.lockTarget = c
  window.__target = c
  return `${c.def.name} hp=${Math.round(c.hp)} state=${c.state}`
}, [sp, d])

if (want('sling')) {
  await G(() => { const g = window.__game.game; g.equip('reedSling') })
  await wait(600)
  log('sling vs', await nearBeast('tuskhog', 11))
  const before = await G(() => ({ stone: window.__game.game.progress.inv.stone, hp: window.__target.hp }))
  for (let i = 0; i < 6; i++) { await page.keyboard.press('KeyJ'); await wait(420) }
  await shot('sling')
  const after = await G(() => ({ stone: window.__game.game.progress.inv.stone, hp: window.__target.hp, state: window.__target.state }))
  log('sling', JSON.stringify(before), '->', JSON.stringify(after))
}

if (want('spear')) {
  await G(() => { const g = window.__game.game; g.equip('boneSpear'); if (!g.player.alive) g.player.revive?.() })
  await wait(600)
  log('spear vs', await nearBeast('tuskhog', 3))
  for (let i = 0; i < 6; i++) { await page.keyboard.press('KeyJ'); await wait(320) }
  await shot('spear')
  log('spear target', JSON.stringify(await G(() => ({ hp: Math.round(window.__target.hp), state: window.__target.state }))))
}

if (want('gadgets')) {
  await G(() => { const g = window.__game.game; if (!g.player.alive) g.player.revive?.(); g.progress.gadget = 'snare' })
  log('snare vs', await nearBeast('tuskhog', 6))
  await page.keyboard.press('KeyG')
  await wait(500)
  log('traps', await G(() => window.__game.game.gadgets.traps.length), 'snares left', await G(() => window.__game.game.progress.inv.snare))
  await shot('snare')
  await page.keyboard.press('KeyC')
  await wait(200)
  await page.keyboard.press('KeyC')
  await wait(200)
  log('gadget after cycle', await G(() => window.__game.game.progress.gadget))
  await G(() => { window.__game.game.progress.gadget = 'flashPod' })
  await wait(200)
  await page.keyboard.press('KeyG')
  await wait(900)
  await shot('flash')
  log('flash target', JSON.stringify(await G(() => ({ state: window.__target.state, blind: window.__target.state === 'blinded' }))), 'pods', await G(() => window.__game.game.progress.inv.flashPod))
}

if (want('tracks')) {
  const r = await G(() => {
    const g = window.__game.game
    const t = g.tracks
    const c = t.clues.find(c => c.cd <= 0) ?? t.clues[0]
    if (!c) return 'no clues'
    g.player.place(c.x + 0.8, c.z + 0.8, g.terrain, 0)
    g.cam.snap(g.player.pos, Math.PI)
    return `clue ${c.species ?? c.sp} at ${c.x.toFixed(0)},${c.z.toFixed(0)} (${t.clues.length} clues)`
  })
  log(r)
  await wait(800)
  await shot('clue')
  await page.keyboard.press('KeyE')
  await wait(1800)
  log('journal after study', JSON.stringify(await G(() => window.__game.game.progress.journal)))
  // Force a tracked state to see the trail and HUD pin.
  await G(() => {
    const g = window.__game.game
    const e = g.progress.journal.tuskhog ?? (g.progress.journal.tuskhog = { seen: true, clues: 0, tracked: false, weak: false, parts: [], best: 0 })
    e.clues = 3; e.tracked = true
    const c = g.creatures.find(c => c.def.id === 'tuskhog' && c.alive)
    g.player.place(c.pos.x + 22, c.pos.z + 22, g.terrain, 0)
    g.cam.snap(g.player.pos, Math.atan2(22, 22))
  })
  await wait(2500)
  await shot('tracked')
  log('trackSp', await G(() => window.__game.game.trackSp), 'trackPos', await G(() => !!window.__game.game.trackPos))
}

log('fps', await G(() => window.__game.game.frameAvg ? (1000 / window.__game.game.frameAvg).toFixed(1) : 'n/a'))
log('ERRORS', errors.length ? errors.slice(0, 12).join('\n') : 'none')
await browser.close()
