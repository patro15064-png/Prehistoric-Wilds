import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const port = 4350 + Math.floor(Math.random() * 200)
const url = `http://127.0.0.1:${port}/`

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' })
let browser

function cleanup() {
  try { server.kill('SIGTERM') } catch {}
}

async function run() {
  console.log('1. Waiting for preview server...')
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(url)).ok) break
    } catch {}
    await new Promise(r => setTimeout(r, 250))
  }

  const args = ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader']
  browser = await chromium.launch({ args, channel: 'chrome' }).catch(() => chromium.launch({ args }))
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })

  const errors = []
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().includes('AudioContext') && !m.text().includes('favicon')) {
      errors.push(m.text())
    }
  })

  console.log('2. Loading game...')
  await page.goto(url)
  await page.waitForSelector('[data-el="title"].on', { timeout: 60000 })

  console.log('3. Starting expedition...')
  const newBtn = page.locator('[data-act="new"]')
  if (await newBtn.isVisible()) await newBtn.click()
  else await page.locator('[data-act="continue"]').click()

  await page.waitForSelector('[data-el="hud"].on', { timeout: 15000 })
  await page.waitForTimeout(1000)

  console.log('4. Checking passive animal manager state...')
  const animalStats = await page.evaluate(() => {
    const g = window.__game?.game
    if (!g || !g.animals) return null
    return {
      animalCount: g.animals.animals.length,
      types: g.animals.animals.map(a => a.type),
      states: g.animals.animals.map(a => a.state),
      pickups: g.animals.pickups.length,
      hunger: g.progress.hunger,
      meat: g.progress.inv.meat ?? 0,
      playerPos: [g.player.pos.x, g.player.pos.y, g.player.pos.z],
    }
  })

  console.log('   Animal stats in live game:', JSON.stringify(animalStats, null, 2))
  if (!animalStats || animalStats.animalCount !== 8) {
    throw new Error(`Expected 8 initial animals, found ${animalStats?.animalCount}`)
  }

  console.log('5. Simulating attack on an animal...')
  const huntResult = await page.evaluate(() => {
    const g = window.__game?.game
    // Drop player's hunger slightly to 60 to verify food restoration
    g.progress.hunger = 60
    const initialHunger = g.progress.hunger
    const initialMeat = g.progress.inv.meat ?? 0

    // Place a rabbit 2m in front of player
    const rabbit = g.animals.animals[0]
    rabbit.pos.x = g.player.pos.x + Math.sin(g.player.yaw) * 1.8
    rabbit.pos.z = g.player.pos.z + Math.cos(g.player.yaw) * 1.8
    rabbit.pos.y = g.terrain.heightAt(rabbit.pos.x, rabbit.pos.z)

    // Strike rabbit with player's attack
    const hit = g.animals.strike(g.player.stats.attack, 1, false, g.player.pos, g.player.yaw, 3, 1)

    // Fast forward death animation to drop meat
    rabbit.update(0.7, g.player.pos, g.terrain, g.colliders)

    return {
      hit,
      state: rabbit.state,
      deadComplete: rabbit.deadComplete,
      initialHunger,
      initialMeat,
    }
  })

  console.log('   Hunt result:', huntResult)
  if (!huntResult.hit || huntResult.state !== 'DEAD') {
    throw new Error('Animal strike failed!')
  }

  console.log('6. Stepping update to verify meat drop and walk-over eating...')
  await page.waitForTimeout(500)
  const afterCollect = await page.evaluate(() => {
    const g = window.__game?.game
    // 1. Step to process animal death and spawn meat pickup
    g.animals.update(0.2, g.player.pos, g.progress)
    const meatSpawned = g.animals.pickups.length === 1

    // 2. Walk forward onto meat pickup
    g.player.pos.x += Math.sin(g.player.yaw) * 1.0
    g.player.pos.z += Math.cos(g.player.yaw) * 1.0
    g.animals.update(0.2, g.player.pos, g.progress)

    return {
      meatSpawned,
      pickupsRemaining: g.animals.pickups.length,
      newHunger: g.progress.hunger,
      newMeat: g.progress.inv.meat ?? 0,
    }
  })

  console.log('   After collect result:', afterCollect)
  if (!afterCollect.meatSpawned) {
    throw new Error('Meat pickup was not spawned upon animal death!')
  }
  if (afterCollect.newHunger <= 60) {
    throw new Error(`Hunger did not increase from eating raw meat! New: ${afterCollect.newHunger}`)
  }
  if (afterCollect.newMeat <= huntResult.initialMeat) {
    throw new Error(`Meat inventory did not increase! New: ${afterCollect.newMeat}`)
  }

  console.log('7. Taking screenshot of in-game gameplay...')
  await page.screenshot({ path: 'shots/animals-verification.png' })

  console.log('✅ ALL ANIMAL SYSTEM IN-GAME CHECKS PASSED!')
  await browser.close()
  cleanup()
}

run().catch(err => {
  console.error('❌ Verification failed:', err)
  browser?.close().catch(() => {})
  cleanup()
  process.exit(1)
})
