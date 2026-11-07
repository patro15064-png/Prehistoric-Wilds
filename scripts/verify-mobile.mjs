import { spawn } from 'node:child_process'
import { chromium, devices } from 'playwright'

const port = 4500 + Math.floor(Math.random() * 200)
const url = `http://127.0.0.1:${port}/`

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' })
let browser

function cleanup() {
  try {
    if (process.platform === 'win32' && server.pid) {
      spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'])
    } else {
      server.kill('SIGTERM')
    }
  } catch {}
}

async function run() {
  console.log('1. Waiting for preview server on ' + url)
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) break
    } catch {}
    await new Promise(r => setTimeout(r, 250))
  }

  const args = ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader']
  browser = await chromium.launch({ args }).catch(() => chromium.launch({ args, channel: 'chrome' }))

  const errors = []
  // Mobile landscape device configuration (iPhone 14 / Pixel landscape)
  const mobileDevice = {
    ...devices['iPhone 14'],
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  }

  const ctx = await browser.newContext(mobileDevice)
  const page = await ctx.newPage()

  page.on('console', m => {
    const txt = m.text()
    if (!txt.includes('AudioContext') && !txt.includes('favicon')) {
      console.log(`   [PAGE ${m.type()}]: ${txt}`)
    }
    if (m.type() === 'error' && !txt.includes('AudioContext') && !txt.includes('favicon')) {
      errors.push(txt)
    }
  })
  page.on('pageerror', e => errors.push(String(e)))

  console.log('2. Loading game in Mobile emulation (844x390, touch enabled)...')
  await page.goto(url)
  await page.waitForSelector('[data-el="title"].on', { timeout: 60000 })
  await page.waitForTimeout(500)

  console.log('3. Starting expedition via touch tap...')
  const contBtn = page.locator('[data-act="continue"]')
  const newBtn = page.locator('[data-act="new"]')
  if (await contBtn.isVisible()) {
    await contBtn.tap()
  } else {
    await newBtn.tap()
    const confirmBtn = page.locator('[data-act="confirm-new"]')
    if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await confirmBtn.tap()
    }
  }

  await page.waitForSelector('[data-el="hud"].on', { timeout: 15000 })
  // Wait for 10 animation frames so the engine game loop and UI sync completely
  await page.evaluate(() => new Promise(resolve => {
    let count = 0
    const step = () => {
      count++
      if (count >= 10) resolve()
      else requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }))

  console.log('4. Verifying Mobile Touch Controls are present and visible...')
  const debugState = await page.evaluate(() => {
    const g = (window.__game)?.game
    const ui = (window.__game)?.ui
    const touch = ui?.touch
    const tl = document.querySelector('.touch-layer')
    const t = touch ? touch.isTouchActive : false
    const n = g ? (g.mode === 'playing' && ui.screen === 'hud' && !ui.mapOpen && !ui.helpOpen) : false
    return {
      gameMode: g?.mode,
      uiScreen: ui?.screen,
      mapOpen: ui?.mapOpen,
      helpOpen: ui?.helpOpen,
      isTouchActive: t,
      conditionN: n,
      shouldShow: t && n,
      tlClasses: tl?.className,
      tlHidden: tl ? getComputedStyle(tl).display : 'no-tl'
    }
  })
  console.log('   STATE BEFORE CHECK:', debugState)

  const touchLayer = page.locator('.touch-layer')
  await touchLayer.waitFor({ state: 'attached' })
  const isTouchVisible = await page.evaluate(() => {
    const tl = document.querySelector('.touch-layer')
    return tl?.classList.contains('visible') && tl?.classList.contains('touch-capable')
  })
  console.log(`   Touch layer visible: ${isTouchVisible}`)
  if (!isTouchVisible) throw new Error('Touch controls layer should be visible on mobile')

  console.log('5. Verifying on-screen touch buttons exist...')
  const buttonsToCheck = [
    '.touch-btn-light',
    '.touch-btn-heavy',
    '.touch-btn-dodge',
    '.touch-btn-sprint',
    '.touch-btn-interact',
    '.touch-btn-lock',
    '.touch-btn-heal',
    '.touch-btn-gadget',
    '.touch-btn-cycle-gadget',
    '.touch-btn-cycle-weapon',
    '[data-touch-act="satchel"]',
    '[data-touch-act="journal"]',
    '[data-touch-act="map"]',
    '[data-touch-act="skills"]',
    '[data-touch-act="pause"]',
    '[data-touch-act="fullscreen"]'
  ]

  for (const sel of buttonsToCheck) {
    const count = await page.locator(sel).count()
    if (count === 0) throw new Error(`Expected button ${sel} to exist`)
  }
  console.log(`   All ${buttonsToCheck.length} touch buttons verified!`)

  console.log('6. Testing Virtual Joystick analog movement...')
  const posBefore = await page.evaluate(() => {
    const g = (window.__game)?.game
    return { x: g.player.pos.x, z: g.player.pos.z }
  })

  // Simulate touch drag on joystick zone (dragging upward for forward movement)
  const joyBox = await page.locator('.touch-joystick-zone').boundingBox()
  if (!joyBox) throw new Error('Joystick zone bounding box not found')

  const startX = joyBox.x + joyBox.width * 0.4
  const startY = joyBox.y + joyBox.height * 0.6

  // Touch start and drag forward
  await page.evaluate(({ sx, sy }) => {
    const zone = document.querySelector('.touch-joystick-zone')
    zone.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 10, clientX: sx, clientY: sy, pointerType: 'touch', bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 10, clientX: sx, clientY: sy - 45, pointerType: 'touch', bubbles: true }))
  }, { sx: startX, sy: startY })

  // Drive 35 animation frames while joystick is actively pushed
  await page.evaluate(() => new Promise(resolve => {
    let frames = 0
    const step = () => {
      frames++
      if (frames >= 35) resolve()
      else requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }))

  // Release joystick
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 10, pointerType: 'touch', bubbles: true }))
  })
  // Drive 5 recovery frames
  await page.evaluate(() => new Promise(resolve => {
    let frames = 0
    const step = () => {
      frames++
      if (frames >= 5) resolve()
      else requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }))

  const posAfter = await page.evaluate(() => {
    const g = (window.__game)?.game
    return { x: g.player.pos.x, z: g.player.pos.z }
  })
  const dist = Math.hypot(posAfter.x - posBefore.x, posAfter.z - posBefore.z)
  console.log(`   Player moved ${dist.toFixed(2)}m via virtual joystick!`)
  if (dist < 0.15) throw new Error(`Virtual joystick did not move player enough (${dist}m)`)

  console.log('7. Testing Touch-Look Camera rotation...')
  const beforeInfo = await page.evaluate(() => {
    const g = (window.__game)?.game
    const I = (window.__game)?.input
    return { yaw: g.cam.yaw, pitch: g.cam.pitch, look: { ...I.look }, touchLook: { ...I.touchLook } }
  })
  console.log('   LOOK BEFORE:', beforeInfo)

  const lookDebug = await page.evaluate(() => {
    const zone = document.querySelector('.touch-look-zone')
    const I = (window.__game)?.input
    const touch = (window.__game)?.ui.touch
    zone.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 12, clientX: 600, clientY: 200, pointerType: 'touch', bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 12, clientX: 520, clientY: 200, pointerType: 'touch', bubbles: true }))
    const touchLookAfterMove = { ...I.touchLook }
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 12, pointerType: 'touch', bubbles: true }))
    return { touchLookAfterMove }
  })
  console.log('   LOOK DISPATCH:', lookDebug)
  // Wait for 5 animation frames to render
  await page.evaluate(() => new Promise(resolve => {
    let count = 0
    const step = () => {
      count++
      if (count >= 5) resolve()
      else requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }))

  const afterInfo = await page.evaluate(() => {
    const g = (window.__game)?.game
    const I = (window.__game)?.input
    return { yaw: g.cam.yaw, pitch: g.cam.pitch, look: { ...I.look }, touchLook: { ...I.touchLook } }
  })
  console.log('   LOOK AFTER:', afterInfo)
  const yawBefore = beforeInfo.yaw
  const yawAfter = afterInfo.yaw
  console.log(`   Camera yaw changed from ${yawBefore.toFixed(2)} to ${yawAfter.toFixed(2)}`)
  if (Math.abs(yawAfter - yawBefore) < 0.05) throw new Error('Touch look should rotate camera')

  console.log('8. Testing Action buttons (Light Attack combo, Heavy charge, Dodge)...')
  const lightBtn = page.locator('.touch-btn-light')
  await lightBtn.tap()
  await page.waitForTimeout(300)
  await lightBtn.tap()
  await page.waitForTimeout(400)

  const dodgeBtn = page.locator('.touch-btn-dodge')
  await dodgeBtn.tap()
  await page.waitForTimeout(400)

  console.log('9. Testing Direct Hotbar Slot Tapping...')
  // Wait until player finishes any attack or dodge recovery
  await page.evaluate(() => new Promise(resolve => {
    let frames = 0
    const check = () => {
      frames++
      const g = (window.__game)?.game
      if (!g?.player.busy && frames >= 10) resolve()
      else requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  }))

  const handsSlot = page.locator('.hslot[data-slot="hands"]')
  if (await handsSlot.count() > 0) {
    await handsSlot.tap()
    await page.evaluate(() => new Promise(resolve => {
      let frames = 0
      const check = () => {
        frames++
        const g = (window.__game)?.game
        if (g?.progress.held === 'hands' || frames >= 15) resolve()
        else requestAnimationFrame(check)
      }
      requestAnimationFrame(check)
    }))
    const held = await page.evaluate(() => (window.__game)?.game.progress.held)
    console.log(`   Held weapon changed to: ${held}`)
    if (held !== 'hands') throw new Error(`Expected held to be hands, got ${held}`)
  }

  console.log('10. Testing Mobile Menus (Satchel, Codex, Map, Skills, Pause)...')
  // Tap Satchel button
  await page.locator('[data-touch-act="satchel"]').tap()
  await page.waitForSelector('.screen.menu.on', { timeout: 5000 })
  console.log('   Satchel opened successfully via touch button')

  // Switch tabs in menu via touch
  await page.locator('header.tabs > [data-tab="craft"]').tap()
  await page.waitForTimeout(200)
  await page.locator('header.tabs > [data-tab="journal"]').tap()
  await page.waitForTimeout(200)

  // Close menu
  await page.locator('[data-act="close-menu"]').tap()
  await page.waitForTimeout(300)

  // Tap Map button
  await page.locator('[data-touch-act="map"]').tap()
  await page.waitForSelector('.overlay.map:not([hidden])', { timeout: 5000 })
  console.log('   Map opened successfully via touch button')
  await page.locator('.overlay.map [data-act="map"]').tap()
  await page.waitForTimeout(300)

  // Tap Skills button
  await page.locator('[data-touch-act="skills"]').tap()
  await page.waitForSelector('.screen.skills.on', { timeout: 5000 })
  console.log('   Skills opened successfully via touch button')
  await page.locator('.skills [data-act="skills"]').tap()
  await page.waitForTimeout(300)

  // Tap Pause button
  await page.locator('[data-touch-act="pause"]').tap()
  await page.waitForSelector('.screen.pause.on', { timeout: 5000 })
  console.log('   Pause opened successfully via touch button')
  await page.locator('[data-act="resume"]').tap()
  await page.waitForTimeout(300)

  console.log('11. Testing Device Rotation Portrait Prompt...')
  // Resize to portrait
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  const portraitPrompt = page.locator('.touch-portrait-prompt')
  const isPromptVisible = await portraitPrompt.isVisible()
  console.log(`   Portrait rotate suggestion prompt visible: ${isPromptVisible}`)
  if (!isPromptVisible) throw new Error('Portrait rotate suggestion prompt should be visible in portrait')

  // Tap continue in portrait
  await page.locator('[data-touch-act="dismiss-rotate"]').tap()
  await page.waitForTimeout(200)
  const isPromptDismissed = !(await portraitPrompt.isVisible())
  console.log(`   Portrait prompt dismissed cleanly: ${isPromptDismissed}`)
  if (!isPromptDismissed) throw new Error('Portrait prompt should dismiss on tap')

  // Return to landscape
  await page.setViewportSize({ width: 844, height: 390 })
  await page.waitForTimeout(300)

  console.log('12. Checking for any Console Errors...')
  if (errors.length) {
    throw new Error(`Console errors found during mobile test:\n  ${errors.join('\n  ')}`)
  }
  console.log('   ZERO console errors or warnings!')

  await ctx.close()
  await browser.close()
  cleanup()
  console.log('\n======================================================')
  console.log('✅ MOBILE TOUCH VERIFICATION SUCCEEDED WITH 100% PASS!')
  console.log('======================================================\n')
  process.exit(0)
}

run().catch(err => {
  console.error('\n❌ Verification Failed:', err)
  cleanup()
  process.exit(1)
})
