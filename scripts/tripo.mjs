// Batch image->3D via Manus Data API (Tripo3D). Usage:
//   manus-node scripts/tripo.mjs name1 name2 ...   (reads art/refs/<name>.png, writes art/tripo/<name>.glb)
// APIs used (discovered): Tripo3D/upload_image, Tripo3D/image_to_model, Tripo3D/get_task. Max batch: 40.
import { pathToFileURL } from 'node:url'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const { ApiClient } = await import(pathToFileURL('/home/ubuntu/skills/data-api/lib/data-api.mjs').href)
const client = new ApiClient()
const names = process.argv.slice(2).slice(0, 40)
const root = new URL('..', import.meta.url).pathname
mkdirSync(`${root}art/tripo`, { recursive: true })
const statePath = `${root}art/tripo/state.json`
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {}
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function submit(name) {
  if (state[name]?.task && state[name].status !== 'failed') return
  const src = `${root}art/refs/${name}.png`
  const tmp = `/tmp/tripo-${name}.jpg`
  // Downscale to 1024px JPEG to keep uploads small.
  execFileSync('python3', ['-c', `from PIL import Image; im=Image.open('${src}').convert('RGB'); im.thumbnail((1024,1024)); im.save('${tmp}', quality=92)`])
  const b64 = readFileSync(tmp).toString('base64')
  const up = await client.callApi('Tripo3D/upload_image', { multipartFormData: { file: b64 } })
  const token = up?.data?.image_token
  if (!token) throw new Error(`upload failed for ${name}: ${JSON.stringify(up).slice(0, 300)}`)
  const res = await client.callApi('Tripo3D/image_to_model', {
    body: { type: 'image_to_model', file: { type: 'jpg', file_token: token } },
  })
  const task = res?.data?.task_id
  if (!task) throw new Error(`submit failed for ${name}: ${JSON.stringify(res).slice(0, 300)}`)
  state[name] = { task, status: 'queued' }
  save()
  log('submitted', name, task)
}

async function download(url, path) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`download ${r.status}`)
  writeFileSync(path, Buffer.from(await r.arrayBuffer()))
}

for (const n of names) {
  try { await submit(n) } catch (e) { log('ERR', n, String(e.message).slice(0, 300)); state[n] = { status: 'failed', error: String(e.message).slice(0, 300) }; save() }
}
const t0 = Date.now()
while (Date.now() - t0 < 40 * 60_000) {
  const pending = names.filter(n => state[n]?.task && !['success', 'failed', 'done'].includes(state[n].status))
  if (!pending.length) break
  for (const n of pending) {
    try {
      const r = await client.callApi('Tripo3D/get_task', { pathParams: { task_id: state[n].task } })
      const d = r?.data ?? {}
      if (d.status !== state[n].status || d.progress !== state[n].progress) log(n, d.status, d.progress)
      state[n].status = d.status
      state[n].progress = d.progress
      if (d.status === 'success') {
        const o = d.output ?? {}
        const out = d.outputs ?? {}
        const url = o.pbr_model ?? o.model ?? out.model?.url ?? d.result?.pbr_model?.url ?? d.result?.model?.url
        const prev = o.rendered_image ?? out.previews?.[0]?.url ?? d.result?.rendered_image?.url
        if (!url) { log('no url', n, JSON.stringify(d).slice(0, 500)); state[n].status = 'failed'; save(); continue }
        await download(url, `${root}art/tripo/${n}.glb`)
        if (prev) { try { await download(prev, `${root}art/tripo/${n}.preview.webp`) } catch {} }
        state[n].status = 'done'
        log('DONE', n)
      }
      save()
    } catch (e) { log('poll err', n, String(e.message).slice(0, 200)) }
  }
  await sleep(12_000)
}
log('finished', JSON.stringify(Object.fromEntries(names.map(n => [n, state[n]?.status]))))
