import { chromium } from 'playwright'
const base = process.argv[2] ?? 'http://127.0.0.1:3000/'
const views = (process.argv[3] ?? 'camp,beach,jungle,falls,high,ruins,cald,crater,over').split(',')
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.type(), m.text().slice(0, 300)) })
page.on('pageerror', e => console.log('pageerror:', e.message))
for (const v of views) {
  await page.goto(`${base}?v=${v}&q=${process.env.Q ?? 'high'}`)
  await page.waitForFunction(() => window.__ready, null, { timeout: 120000 })
  await page.waitForTimeout(2500)
  const info = await page.evaluate(() => ({ build: Math.round(window.__ready.buildMs), calls: window.__ready.calls(), tris: window.__ready.tris() }))
  console.log(v, JSON.stringify(info))
  await page.screenshot({ path: `shots/view-${v}.png` })
}
await browser.close()
