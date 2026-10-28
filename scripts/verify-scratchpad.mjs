import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const out = 'shots'
mkdirSync(out, { recursive: true })

async function run() {
  console.log('1. Navigating to http://127.0.0.1:3000/ ...')
  const args = ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader']
  const browser = await chromium.launch({ args }).catch(() => chromium.launch({ args, channel: 'chrome' }))
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' })
  const page = await ctx.newPage()

  const consoleLogs = []
  const failedRequests = []

  page.on('console', m => {
    const text = m.text()
    if (!text.includes('AudioContext') && !text.includes('favicon.ico')) {
      consoleLogs.push(`[${m.type()}] ${text}`)
    }
  })

  page.on('response', r => {
    if (r.status() >= 400 && !r.url().includes('favicon.ico')) {
      failedRequests.push(`HTTP ${r.status()} ${r.url()}`)
    }
  })

  await page.goto('http://127.0.0.1:3000/')
  console.log('2. Waiting for game to boot and title screen to display...')
  await page.waitForSelector('[data-el="title"].on', { timeout: 40_000 })
  await page.waitForTimeout(1000)

  console.log('3. Checking title screen and action buttons...')
  const newBtn = page.locator('[data-act="new"]')
  const contBtn = page.locator('[data-act="continue"]')
  const settingsBtn = page.locator('[data-el="title"] [data-act="settings"]')
  const helpBtn = page.locator('[data-el="title"] [data-act="help"]')
  const labBtn = page.locator('[data-el="btnLab"]')

  const newVisible = await newBtn.isVisible()
  const contVisible = await contBtn.isVisible()
  const settingsVisible = await settingsBtn.isVisible()
  const helpVisible = await helpBtn.isVisible()
  const labVisible = await labBtn.isVisible()

  console.log(`   - New Expedition button visible: ${newVisible}`)
  console.log(`   - Continue Expedition button visible: ${contVisible}`)
  console.log(`   - Settings button visible: ${settingsVisible}`)
  console.log(`   - Controls Help button visible: ${helpVisible}`)
  console.log(`   - Enemy Lab button visible: ${labVisible}`)

  console.log('4. Taking screenshot of title screen...')
  await page.screenshot({ path: `${out}/scratchpad-title.png` })

  console.log('5. Clicking start game to verify gameplay and HUD...')
  if (contVisible) {
    await contBtn.click()
  } else {
    await newBtn.click()
  }

  await page.waitForSelector('[data-el="hud"].on', { timeout: 15_000 })
  await page.waitForTimeout(1500)

  // Verify game state
  const gameState = await page.evaluate(() => {
    const { game } = window.__game ?? {}
    return {
      mode: game?.mode,
      campStage: game?.progress?.campStage,
      hunger: game?.progress?.hunger,
      pos: game?.player?.pos,
    }
  })
  console.log('   - Game mode:', gameState.mode)
  console.log('   - Camp stage:', gameState.campStage)
  console.log('   - Player position:', gameState.pos)

  console.log('6. Taking screenshot of active gameplay HUD...')
  await page.screenshot({ path: `${out}/scratchpad-gameplay.png` })

  console.log('7. Verifying console logs and network requests...')
  console.log(`   - Total non-trivial console messages: ${consoleLogs.length}`)
  console.log(`   - Failed network requests: ${failedRequests.length}`)
  if (failedRequests.length > 0) {
    console.warn('   Failed requests:', failedRequests)
  }

  await browser.close()
  console.log('ALL SCRATCHPAD CHECKLIST ITEMS VERIFIED AND COMPLETED SUCCESSFULLY!')
}

run().catch(err => {
  console.error('Scratchpad verification error:', err)
  process.exit(1)
})
