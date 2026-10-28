import { chromium } from 'playwright'
// Usage: node scripts/labshots.mjs [species,...]  -> shots/lab-<sp>-rest.png, shots/lab-<sp>-atk.png
const base = 'http://127.0.0.1:3000/enemies/'
const only = process.argv[2]?.split(',')
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 900, height: 560 } })
p.on('pageerror', e => console.log('PAGEERR', e.message))
p.on('console', m => m.type() === 'error' && console.log('ERR', m.text()))
await p.goto(base)
await p.waitForFunction(() => window.__lab, null, { timeout: 120000 })
const ids = only ?? (await p.evaluate(() => window.__lab.species))
for (const sp of ids) {
  await p.evaluate(s => window.__lab.select(s), sp)
  const ok = await p.waitForFunction(() => !!window.__lab.creature?.rig.model, null, { timeout: 90000 }).then(() => true, () => false)
  await p.waitForTimeout(1500)
  await p.screenshot({ path: `shots/lab-${sp}-rest.png` })
  const atk = await p.evaluate(() => { const c = window.__lab.creature; const a = c.def.attacks[0]; window.__lab.play(a.id); return a.id + ' windup ' + a.windup })
  await p.waitForTimeout(700)
  await p.screenshot({ path: `shots/lab-${sp}-atk.png` })
  console.log(sp, 'model', ok, atk)
}
await b.close()
