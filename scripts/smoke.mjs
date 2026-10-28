// End-to-end smoke test for Prehistoric Wilds (builds must already exist in dist/).
// Serves dist/, boots the game in headless Chromium, tests gameplay/menus/lab,
// fails on any unhandled errors, and writes screenshots to ./shots/.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const port = 4300 + Math.floor(Math.random() * 500)
const url = `http://127.0.0.1:${port}/`
const out = process.env.SHOTS_DIR ?? 'shots'
mkdirSync(out, { recursive: true })

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: false })
let browser
const guard = setTimeout(() => fail('timed out after 120s'), 120_000)

function cleanup() {
  clearTimeout(guard)
  try { server.kill('SIGTERM') } catch {}
}

async function fail(msg) {
  console.error(`smoke: FAIL — ${msg}`)
  await browser?.close().catch(() => {})
  cleanup()
  process.exit(1)
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('preview server did not start')
}

async function openGame(context, errors) {
  const page = await context.newPage()
  page.on('console', m => {
    // Ignore harmless WebGL / AudioContext autoplay warnings
    const txt = m.text()
    if (m.type() === 'error' && !txt.includes('AudioContext') && !txt.includes('favicon')) {
      errors.push(txt)
    }
  })
  page.on('pageerror', e => errors.push(String(e)))
  page.on('response', r => {
    if (r.status() >= 400 && !r.url().includes('favicon.ico')) {
      errors.push(`HTTP ${r.status()} ${r.url()}`)
    }
  })
  await page.goto(url)
  // Wait for title screen to activate
  await page.waitForSelector('[data-el="title"].on', { timeout: 35_000 })
  await page.waitForTimeout(600)
  return page
}

const state = page => page.evaluate(() => {
  const { game } = window.__game ?? {}
  if (!game) return { mode: 'unknown', pos: { x: 0, y: 0, z: 0 } }
  const p = game.player?.pos ?? game.player?.root?.position ?? { x: 0, y: 0, z: 0 }
  return {
    mode: game.mode,
    progress: game.progress ? {
      campStage: game.progress.campStage,
      hunger: game.progress.hunger,
      weapon: game.progress.weapon,
      held: game.progress.held,
    } : null,
    pos: { x: p.x, y: p.y, z: p.z },
  }
})

try {
  await waitForServer()
  const args = ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader']
  browser = await chromium.launch({ args }).catch(() => chromium.launch({ args, channel: 'chrome' }))
  const errors = []

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' })
  const page = await openGame(ctx, errors)
  await page.screenshot({ path: `${out}/01-title.png` })
  console.log('smoke: title screen loaded successfully')

  // Click start game (either New or Continue)
  const newBtn = page.locator('[data-act="new"]')
  const contBtn = page.locator('[data-act="continue"]')
  if (await contBtn.isVisible()) {
    await contBtn.click()
  } else {
    await newBtn.click()
  }

  // Wait for HUD to become active
  await page.waitForSelector('[data-el="hud"].on', { timeout: 15_000 })
  await page.waitForTimeout(1000)
  const before = await state(page)
  console.log(`smoke: expedition started in mode "${before.mode}" at (${before.pos.x.toFixed(1)}, ${before.pos.z.toFixed(1)})`)

  // Move forward with W and dodge roll with Space
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(800)
  await page.keyboard.press('Space')
  await page.waitForTimeout(800)
  await page.keyboard.up('KeyW')
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/02-gameplay.png` })

  const after = await state(page)
  const moved = Math.hypot(after.pos.x - before.pos.x, after.pos.z - before.pos.z)
  if (after.mode !== 'playing') throw new Error(`expected playing mode, got ${after.mode}`)
  if (moved < 1.0) throw new Error(`player did not move sufficiently (${moved.toFixed(2)} m)`)
  console.log(`smoke: player moved ${moved.toFixed(2)} m`)

  // Test Pause Menu (Escape key)
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-el="pause"].on', { timeout: 5000 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${out}/03-pause.png` })
  console.log('smoke: pause menu opened')

  // Open Settings
  await page.click('[data-el="pause"] [data-act="settings"]')
  await page.waitForSelector('[data-el="settings"]:not([hidden])', { timeout: 5000 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${out}/04-settings.png` })
  console.log('smoke: settings opened')

  // Close Settings and Resume
  await page.click('[data-act="settings-close"]')
  await page.waitForTimeout(300)
  await page.click('[data-act="resume"]')
  await page.waitForSelector('[data-el="hud"].on', { timeout: 5000 })
  console.log('smoke: resumed from pause')

  // Open Satchel / Crafting menu (Tab)
  await page.keyboard.press('Tab')
  await page.waitForSelector('[data-el="menu"].on', { timeout: 5000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/05-satchel.png` })
  console.log('smoke: satchel/crafting menu opened')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // Open Skills menu (KeyV)
  await page.keyboard.press('KeyV')
  await page.waitForSelector('[data-el="skills"].on', { timeout: 5000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/06-skills.png` })
  console.log('smoke: skills progression opened')
  await page.keyboard.press('KeyV')
  await page.waitForTimeout(400)

  // Test Enemy Lab (/enemies/)
  const labPage = await ctx.newPage()
  await labPage.goto(`${url}enemies/`)
  await labPage.waitForSelector('#lab', { timeout: 20_000 })
  await labPage.waitForTimeout(1500)
  await labPage.screenshot({ path: `${out}/07-enemy-lab.png` })
  console.log('smoke: enemy lab loaded successfully')
  await labPage.close()

  await ctx.close()

  if (errors.length) {
    throw new Error(`console errors encountered:\n  ${errors.join('\n  ')}`)
  }

  await browser.close()
  cleanup()
  console.log(`smoke: SUCCESS — all checks passed, screenshots in ${out}/`)
} catch (err) {
  await fail(err?.message ?? String(err))
}
