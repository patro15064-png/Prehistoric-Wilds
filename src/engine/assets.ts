import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import MANIFEST_JSON from './manifest.json'

/**
 * Staged asset streaming.
 *  - `boot`  : everything the title screen and the first region (jungle coast) need. Awaited
 *              behind the loading screen.
 *  - `highlands`, `caldera`: streamed in the background right after the title appears
 *              (current + next first), paused whenever the game reports it is busy (combat,
 *              heavy VFX, slow frames) and resumed when play calms down.
 * Consumers never block on later stages: models fall back to procedural placeholders and
 * audio falls back to synthesis until the real asset lands (`onReady`).
 */
export type Stage = 'boot' | 'coast' | 'highlands' | 'caldera'

const M = (n: string) => `/models/${n}.glb`
const S = (n: string) => `/audio/sfx/${n}.mp3`
const L = (n: string) => `/audio/layers/${n}.mp3`
const A = (n: string) => `/audio/amb/${n}.mp3`
const MU = (n: string) => `/audio/music/${n}.mp3`
const T = (n: string) => `/vfx/${n}.webp`

export const MANIFEST: Record<Stage, string[]> = MANIFEST_JSON

type Entry = { url: string; state: 'idle' | 'loading' | 'ready' | 'failed'; value?: unknown; waiters: ((v: unknown) => void)[] }

export class Assets {
  private readonly gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  /** True when a model name is listed in any stage of the manifest (i.e. it exists on disk). */
  known(name: string): boolean {
    const u = M(name)
    return (Object.values(MANIFEST) as string[][]).some(l => l.includes(u))
  }
  private readonly texLoader = new THREE.TextureLoader()
  private readonly entries = new Map<string, Entry>()
  private audioCtx?: BaseAudioContext
  private queue: string[] = []
  private pumping = false
  /** Return true to pause background prefetch (combat, heavy VFX, slow frames). */
  busy: () => boolean = () => false
  /** Return true when frames are slow: loads are throttled to one every `slowGapMs`, not paused. */
  slow: () => boolean = () => false
  slowGapMs = 8000
  private lastLoad = 0
  readonly stageDone: Record<Stage, boolean> = { boot: false, coast: false, highlands: false, caldera: false }
  /** Bytes-ish progress of the background queue for the debug overlay. */
  backgroundPending = 0

  setAudioContext(ctx: BaseAudioContext): void {
    this.audioCtx = ctx
    // Decode any audio fetched before the context existed.
    for (const e of this.entries.values()) if (e.state === 'ready' && e.value instanceof ArrayBuffer) void this.decode(e)
  }

  private entry(url: string): Entry {
    let e = this.entries.get(url)
    if (!e) { e = { url, state: 'idle', waiters: [] }; this.entries.set(url, e) }
    return e
  }

  private async decode(e: Entry): Promise<void> {
    if (!this.audioCtx || !(e.value instanceof ArrayBuffer)) return
    const raw = e.value
    e.value = undefined
    try {
      e.value = await this.audioCtx.decodeAudioData(raw)
      for (const w of e.waiters.splice(0)) w(e.value)
    } catch { e.state = 'failed' }
  }

  private async fetchOne(url: string): Promise<void> {
    const e = this.entry(url)
    if (e.state !== 'idle') return
    e.state = 'loading'
    try {
      if (url.endsWith('.glb')) e.value = await this.gltfLoader.loadAsync(url)
      else if (url.endsWith('.webp') || url.endsWith('.png') || url.endsWith('.jpg')) {
        if (url.startsWith('/vfx/')) {
          const t = await this.texLoader.loadAsync(url)
          t.colorSpace = THREE.SRGBColorSpace
          e.value = t
        } else {
          // DOM image: warm the HTTP cache so CSS backgrounds paint instantly.
          await new Promise<void>(res => { const im = new Image(); im.onload = () => res(); im.onerror = () => res(); im.src = url })
          e.value = url
        }
      } else if (url.endsWith('.mp3')) {
        const r = await fetch(url)
        if (!r.ok) throw new Error(String(r.status))
        e.value = await r.arrayBuffer()
      }
      e.state = 'ready'
      if (e.value instanceof ArrayBuffer) { if (this.audioCtx) await this.decode(e) }
      else for (const w of e.waiters.splice(0)) w(e.value)
    } catch {
      e.state = 'failed'
    }
  }

  /** Load a whole stage now (used for boot behind the loading screen). */
  async loadStage(stage: Stage, progress?: (f: number) => void): Promise<void> {
    const urls = MANIFEST[stage]
    let done = 0
    const limit = 6
    let i = 0
    const worker = async () => {
      while (i < urls.length) {
        const u = urls[i++]
        await this.fetchOne(u)
        done += 1
        progress?.(done / urls.length)
      }
    }
    await Promise.all(Array.from({ length: limit }, worker))
    this.stageDone[stage] = true
  }

  /** Queue stages for background streaming; `first` gets priority (e.g. the region the player is in). */
  prefetch(stages: Stage[]): void {
    for (const s of stages) for (const u of MANIFEST[s]) if (!this.queue.includes(u) && this.entry(u).state === 'idle') this.queue.push(u)
    this.backgroundPending = this.queue.length
    void this.pump()
  }

  /** Move a stage to the front of the background queue (player walked toward it). */
  prioritise(stage: Stage): void {
    const set = new Set(MANIFEST[stage])
    this.queue.sort((a, b) => Number(set.has(b)) - Number(set.has(a)))
  }

  private async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    while (this.queue.length) {
      if (this.busy()) { await new Promise(r => setTimeout(r, 600)); continue }
      if (this.slow() && performance.now() - this.lastLoad < this.slowGapMs) { await new Promise(r => setTimeout(r, 600)); continue }
      this.lastLoad = performance.now()
      const u = this.queue.shift()!
      await this.fetchOne(u)
      this.backgroundPending = this.queue.length
      for (const s of ['coast', 'highlands', 'caldera'] as Stage[]) if (!this.stageDone[s] && MANIFEST[s].every(x => this.entry(x).state === 'ready' || this.entry(x).state === 'failed')) this.stageDone[s] = true
      // Yield so a frame can render between loads.
      await new Promise(r => setTimeout(r, 30))
    }
    this.pumping = false
  }

  get<T>(url: string): T | undefined {
    const e = this.entries.get(url)
    return e?.state === 'ready' && !(e.value instanceof ArrayBuffer) ? (e.value as T) : undefined
  }

  /** Call back once the asset is ready (immediately if it already is). Requests it if idle. */
  onReady<T>(url: string, cb: (v: T) => void): void {
    const e = this.entry(url)
    const v = this.get<T>(url)
    if (v !== undefined) { cb(v); return }
    e.waiters.push(cb as (v: unknown) => void)
    if (e.state === 'idle') { this.queue.unshift(url); void this.pump() }
  }

  gltf(name: string): GLTF | undefined { return this.get<GLTF>(M(name)) }
  onGltf(name: string, cb: (g: GLTF) => void): void { this.onReady<GLTF>(M(name), cb) }
  texture(name: string): THREE.Texture | undefined { return this.get<THREE.Texture>(T(name)) }
  sound(url: string): AudioBuffer | undefined { return this.get<AudioBuffer>(url) }
}

export const assets = new Assets()
export const SFX_URL = S
export const LAYER_URL = L
export const AMB_URL = A
export const MUSIC_URL = MU
