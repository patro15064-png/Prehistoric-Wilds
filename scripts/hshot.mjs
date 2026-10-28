import { chromium } from 'playwright'
const [url, out] = process.argv.slice(2)
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1600, height: 900 } })
p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('console', m => m.type() === 'error' && console.log('ERR', m.text()))
await p.goto(url); await p.waitForFunction(() => document.title === 'done', null, { timeout: 240000 })
console.log(JSON.stringify(await p.evaluate(() => window.marks)))
await p.screenshot({ path: out }); await b.close()
