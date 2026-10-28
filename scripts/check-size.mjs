// Fails the build when the payload that gates time-to-title grows past budget.
// Staged loading: only the app shell (JS/CSS/HTML/fonts, gzipped) + the `boot` manifest stage
// (title + first hunt) block the loading screen; later stages stream in the background.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const MB = 1024 * 1024
const BUDGET = { js: 2.0 * MB, fonts: 2.2 * MB, boot: 5.5 * MB }
const walk = dir => readdirSync(dir).flatMap(name => {
  const p = join(dir, name)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
const files = walk('dist').map(path => {
  const raw = readFileSync(path)
  const text = /\.(js|css|html|json|svg)$/.test(path)
  return { path, size: raw.length, wire: text ? gzipSync(raw).length : raw.length }
})
const sum = pred => files.filter(pred).reduce((n, f) => n + f.wire, 0)
const js = sum(f => f.path.endsWith('.js'))
const css = sum(f => f.path.endsWith('.css') || f.path.endsWith('.html'))
const fonts = sum(f => f.path.endsWith('.woff2'))
const total = sum(f => !f.path.endsWith('.txt'))
const manifest = JSON.parse(readFileSync('src/engine/manifest.json', 'utf8'))
const stage = name => manifest[name].reduce((n, u) => {
  const p = join('dist', u)
  if (!existsSync(p)) { console.error(`missing manifest file: ${u}`); process.exitCode = 1; return n }
  return n + statSync(p).size
}, 0)
const loadingBg = existsSync('dist/ui/loading-bg.webp') ? statSync('dist/ui/loading-bg.webp').size : 0
const boot = js + css + fonts + loadingBg + stage('boot')
const mb = n => `${(n / MB).toFixed(2)} MB`
console.log(`bundle (gzip): js ${mb(js)} / fonts ${mb(fonts)} / boot (blocks title) ${mb(boot)}`)
console.log(`streamed after title: coast ${mb(stage('coast'))} / highlands ${mb(stage('highlands'))} / caldera ${mb(stage('caldera'))} / total dist ${mb(total)}`)
const over = Object.entries({ js, fonts, boot }).filter(([k, v]) => v > BUDGET[k])
if (over.length) {
  for (const [k, v] of over) console.error(`over budget: ${k} ${mb(v)} > ${mb(BUDGET[k])}`)
  process.exit(1)
}
