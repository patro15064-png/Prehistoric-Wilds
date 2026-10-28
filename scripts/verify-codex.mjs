import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const port = 4400 + Math.floor(Math.random() * 200)
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' })
  const page = await ctx.newPage()

  const errors = []
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

  console.log('2. Loading game...')
  await page.goto(url)
  await page.waitForSelector('[data-el="title"].on', { timeout: 60000 })
  await page.waitForTimeout(800)

  console.log('3. Starting expedition...')
  const newBtn = page.locator('[data-act="new"]')
  if (await newBtn.isVisible()) await newBtn.click()
  else await page.locator('[data-act="continue"]').click()

  await page.waitForSelector('[data-el="hud"].on', { timeout: 15000 })
  await page.waitForTimeout(1000)

  console.log('4. Opening Journal / Codex via B key...')
  await page.keyboard.press('KeyB')
  await page.waitForSelector('.screen.menu.on', { timeout: 5000 })
  await page.waitForSelector('.codex-shell', { timeout: 5000 })

  console.log('5. Verifying Codex tabs exist (Mobs, Items, Recipes)...')
  const tabs = page.locator('.codex-tab-btn')
  const tabCount = await tabs.count()
  if (tabCount !== 3) throw new Error(`Expected 3 codex tabs, found ${tabCount}`)

  console.log('6. Inspecting MOBS tab...')
  const debugLayout = await page.evaluate(() => {
    const mb = document.querySelector('.menu-body')
    const shell = document.querySelector('.codex-shell')
    const panelWrap = document.querySelector('.codex-panel-wrap')
    const leftCol = document.querySelector('.codex-left-col')
    const scroller = document.querySelector('.codex-list-scroller')
    const panel = document.querySelector('.panel.wide')
    return {
      panelH: panel ? panel.clientHeight : null,
      mbH: mb ? mb.clientHeight : null,
      mbScrollH: mb ? mb.scrollHeight : null,
      mbOverflow: mb ? getComputedStyle(mb).overflowY : null,
      shellH: shell ? shell.clientHeight : null,
      panelWrapH: panelWrap ? panelWrap.clientHeight : null,
      leftColH: leftCol ? leftCol.clientHeight : null,
      scrollerH: scroller ? scroller.clientHeight : null,
      scrollerScrollH: scroller ? scroller.scrollHeight : null,
    }
  })
  console.log('   LAYOUT DEBUG:', debugLayout)

  const mobCards = page.locator('.codex-card')
  const mobCount = await mobCards.count()
  console.log(`   Found ${mobCount} mobs in the list`)
  if (mobCount < 10) throw new Error(`Expected at least 10 mobs, found ${mobCount}`)

  // Click passive animal (Rabbit)
  const hareCard = page.locator('.codex-card:has-text("Wild Hare")')
  console.log('   hareCard count:', await hareCard.count())
  const hareAttrs = await hareCard.evaluate(el => ({
    tag: el.tagName,
    act: el.dataset.act,
    id: el.dataset.id,
    box: el.getBoundingClientRect(),
    visible: el.offsetParent !== null
  }))
  console.log('   HARE CARD ATTRS:', hareAttrs)
  await hareCard.evaluate(el => el.scrollIntoView({ block: 'nearest' }))
  await page.waitForTimeout(200)
  const afterBox = await hareCard.evaluate(el => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + 20, r.top + 20)
    return {
      rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
      hitTag: hit ? hit.tagName : null,
      hitClass: hit ? hit.className : null,
      hitAct: hit && hit.dataset ? hit.dataset.act : null
    }
  })
  console.log('   AFTER SCROLL HIT TEST:', afterBox)
  await hareCard.evaluate(el => el.click())
  await page.waitForTimeout(500)
  const detailText = await page.locator('.detail-scroller').innerText()
  console.log('   DETAIL TEXT AFTER CLICK:', JSON.stringify(detailText.slice(0, 300)))
  if (!detailText.includes('Does not attack') || !detailText.includes('PASSIVE')) {
    throw new Error(`Passive animal detail does not contain expected passive text. Actual:\n${detailText}`)
  }
  console.log('   ✓ Passive animal details verified (Wild Hare)')

  // Click hostile mob (Tuskhog)
  const tuskCard = page.locator('.codex-card:has-text("Tuskhog")')
  await tuskCard.evaluate(el => el.click())
  await page.waitForTimeout(300)
  const tuskDetail = await page.locator('.detail-scroller').innerText()
  if (!tuskDetail.includes('HOSTILE') || !tuskDetail.includes('Tusk Gore')) {
    throw new Error('Hostile mob detail does not contain expected attack text')
  }
  console.log('   ✓ Hostile mob details verified (Tuskhog)')

  console.log('7. Switching to ITEMS tab...')
  await page.locator('.codex-tab-btn:has-text("ITEMS")').evaluate(el => el.click())
  await page.waitForTimeout(300)

  const itemCards = page.locator('.codex-card')
  const itemCount = await itemCards.count()
  console.log(`   Found ${itemCount} items in the list`)
  if (itemCount < 30) throw new Error(`Expected at least 30 items, found ${itemCount}`)

  // Click natural resource (Wood)
  await page.locator('.codex-card:has-text("Wood")').first().evaluate(el => el.click())
  await page.waitForTimeout(300)
  const woodDetail = await page.locator('.detail-scroller').innerText()
  if (!woodDetail.includes('NATURAL') || !woodDetail.includes('VERY COMMON')) {
    throw new Error('Natural item detail does not contain expected abundance/natural tag')
  }
  console.log('   ✓ Natural item details & abundance verified (Wood)')

  // Click meat item to test Mob Drop jump
  await page.locator('.codex-card:has-text("Raw Haunch")').first().evaluate(el => el.click())
  await page.waitForTimeout(300)
  const mobChip = page.locator('.mob-jump-chip').first()
  if (await mobChip.isVisible()) {
    console.log('   Testing jump from Item drop chip to Mob tab...')
    await mobChip.evaluate(el => el.click())
    await page.waitForTimeout(300)
    const isMobTab = await page.locator('.codex-tab-btn:has-text("BEASTS")').getAttribute('class')
    if (!isMobTab?.includes('active')) throw new Error('Clicking mob drop chip did not jump to MOBS tab')
    console.log('   ✓ Cross-link jump from Item to Mob successful!')
  }

  console.log('8. Switching to RECIPES tab...')
  await page.locator('.codex-tab-btn:has-text("RECIPES")').evaluate(el => el.click())
  await page.waitForTimeout(300)

  const recipeCards = page.locator('.codex-card')
  const recipeCount = await recipeCards.count()
  console.log(`   Found ${recipeCount} recipes in the list`)
  if (recipeCount < 20) throw new Error(`Expected at least 20 recipes, found ${recipeCount}`)

  // Click recipe ingredient to test Item jump
  const ingCard = page.locator('.recipe-ing-card').first()
  const ingName = await ingCard.locator('.ing-name').innerText()
  console.log(`   Testing jump from ingredient (${ingName}) to ITEMS tab...`)
  await ingCard.evaluate(el => el.click())
  await page.waitForTimeout(300)

  const isItemTab = await page.locator('.codex-tab-btn:has-text("ITEMS")').getAttribute('class')
  if (!isItemTab?.includes('active')) throw new Error('Clicking ingredient did not jump to ITEMS tab')
  const curItemName = await page.locator('.detail-title').innerText()
  if (!curItemName.includes(ingName)) throw new Error(`Expected item tab to show ${ingName}, found ${curItemName}`)
  console.log('   ✓ Cross-link jump from Recipe to Item successful!')

  console.log('9. Testing search filtering in ITEMS tab...')
  const searchInput = page.locator('.codex-search-input')
  await searchInput.fill('amber')
  await page.waitForTimeout(300)
  const filteredItemCount = await page.locator('.codex-card').count()
  console.log(`   Filtered search 'amber' yielded ${filteredItemCount} entries`)
  if (filteredItemCount === 0 || filteredItemCount > 5) {
    throw new Error(`Unexpected search filter count: ${filteredItemCount}`)
  }

  // Clear search
  await page.locator('.codex-search-clear').evaluate(el => el.click())
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await page.waitForTimeout(200)

  console.log('10. Closing Codex with B key...')
  const activeEl = await page.evaluate(() => document.activeElement?.tagName)
  console.log('    Active element before KeyB:', activeEl)
  await page.keyboard.press('KeyB')
  await page.waitForTimeout(500)
  const menuVisible = await page.locator('.screen.menu.on').isVisible()
  if (menuVisible) throw new Error('Pressing B did not close the menu')
  console.log('   ✓ Menu closed cleanly')

  if (errors.length > 0) {
    console.error('Console errors detected:', errors)
    throw new Error('Test completed with console errors')
  }

  console.log('\n🎉 ALL CODEX IN-GAME VERIFICATIONS PASSED SUCCESSFULLY!')
}

run()
  .then(() => {
    cleanup()
    if (browser) browser.close()
    process.exit(0)
  })
  .catch(err => {
    console.error('\n❌ VERIFICATION FAILED:', err)
    cleanup()
    if (browser) browser.close()
    process.exit(1)
  })
