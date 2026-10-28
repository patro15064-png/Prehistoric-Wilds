import { assets, AMB_URL, LAYER_URL, MUSIC_URL, SFX_URL } from './assets'

/**
 * Sample-first audio. Every SFX, ambience bed and music layer streams through `assets`; until
 * a buffer lands the engine falls back to small synthesised stand-ins, so nothing ever blocks.
 *
 * Adaptive score: a region melodic loop (coast / highlands / caldera, title on the menu) plus a
 * percussion layer chosen by combat intensity (explore → hunt → boss), all crossfaded.
 * Browsers only allow audio after a user gesture, so call `unlock()` from the first click.
 */
export type Sfx =
  | 'swing' | 'heavySwing' | 'hit' | 'bigHit' | 'hurt' | 'dodge' | 'gather' | 'gatherWood' | 'gatherRock' | 'gatherPlant'
  | 'pickup' | 'craft' | 'upgrade' | 'roar' | 'bossRoar' | 'stomp' | 'carve' | 'ui' | 'uiOpen' | 'win' | 'lose' | 'heal'
  | 'charge' | 'fire' | 'fireHit' | 'error' | 'tell' | 'step' | 'stepStone' | 'perfect' | 'lockon' | 'stagger' | 'partBreak' | 'down'
  | 'chop' | 'mine' | 'treeFall' | 'rockBreak'
  | 'sizzle' | 'searPerfect' | 'eat' | 'snare' | 'pitfall' | 'flash' | 'slingWhirl' | 'slingShot' | 'clue' | 'tracked' | 'page'

type SampleDef = { file: string; vol: number; pitch?: number; slice?: number }
const SAMPLES: Partial<Record<Sfx, SampleDef>> = {
  swing: { file: 'swing_light', vol: 0.55, pitch: 0.08 },
  heavySwing: { file: 'swing_heavy', vol: 0.7, pitch: 0.06 },
  hit: { file: 'hit_light', vol: 0.8, pitch: 0.1 },
  bigHit: { file: 'hit_heavy', vol: 1, pitch: 0.06 },
  hurt: { file: 'player_hurt', vol: 0.8, pitch: 0.05 },
  dodge: { file: 'dodge', vol: 0.6, pitch: 0.08 },
  gather: { file: 'gather_rock', vol: 0.6, pitch: 0.1 },
  chop: { file: 'chop', vol: 0.8, pitch: 0.12 },
  mine: { file: 'mine', vol: 0.75, pitch: 0.12 },
  treeFall: { file: 'tree_fall', vol: 0.9, pitch: 0.05 },
  rockBreak: { file: 'rock_break', vol: 0.9, pitch: 0.06 },
  sizzle: { file: 'sizzle', vol: 0.6 },
  searPerfect: { file: 'sear_perfect', vol: 0.8 },
  eat: { file: 'eat', vol: 0.8, pitch: 0.05 },
  snare: { file: 'snare', vol: 0.9, pitch: 0.06 },
  pitfall: { file: 'pitfall', vol: 0.9 },
  flash: { file: 'flash', vol: 0.9 },
  slingWhirl: { file: 'sling_whirl', vol: 0.55 },
  slingShot: { file: 'sling_shot', vol: 0.8, pitch: 0.08 },
  clue: { file: 'clue', vol: 0.7, pitch: 0.04 },
  tracked: { file: 'tracked', vol: 0.8 },
  page: { file: 'page', vol: 0.7, pitch: 0.08 },
  gatherWood: { file: 'gather_wood', vol: 0.65, pitch: 0.1 },
  gatherRock: { file: 'gather_rock', vol: 0.65, pitch: 0.1 },
  gatherPlant: { file: 'gather_plant', vol: 0.7, pitch: 0.1 },
  pickup: { file: 'pickup', vol: 0.55, pitch: 0.06 },
  craft: { file: 'craft', vol: 0.8 },
  upgrade: { file: 'camp_upgrade', vol: 0.9 },
  roar: { file: 'roar_beast', vol: 0.75, pitch: 0.12 },
  bossRoar: { file: 'roar_boss', vol: 1 },
  stomp: { file: 'slam', vol: 0.85, pitch: 0.08 },
  carve: { file: 'carve', vol: 0.7, pitch: 0.08 },
  ui: { file: 'ui_click', vol: 0.45, pitch: 0.04 },
  uiOpen: { file: 'ui_open', vol: 0.55 },
  win: { file: 'signal_ignite', vol: 1 },
  lose: { file: 'faint', vol: 0.8 },
  heal: { file: 'heal', vol: 0.7 },
  fire: { file: 'fire_launch', vol: 0.75, pitch: 0.08 },
  fireHit: { file: 'fire_impact', vol: 0.8, pitch: 0.08 },
  tell: { file: 'telegraph', vol: 0.5 },
  step: { file: 'steps_grass', vol: 0.25, pitch: 0.12, slice: 0.32 },
  stepStone: { file: 'steps_stone', vol: 0.25, pitch: 0.12, slice: 0.32 },
  perfect: { file: 'perfect_dodge', vol: 0.8 },
  lockon: { file: 'lockon', vol: 0.5 },
  stagger: { file: 'stagger', vol: 0.8 },
  partBreak: { file: 'part_break', vol: 0.95 },
  down: { file: 'creature_down', vol: 0.8, pitch: 0.06 },
}

type Loop = { url: string; gain: GainNode; src?: AudioBufferSourceNode; target: number }

export class Audio {
  readonly ctx: AudioContext
  private master: GainNode
  private music: GainNode
  private sfx: GainNode
  private amb: GainNode
  private comp: DynamicsCompressorNode
  private noise?: AudioBuffer
  private loops = new Map<string, Loop>()
  private musicOn = false
  private synthTimer = 0
  private lastPlay = new Map<Sfx, number>()
  /** 0 = explore, 1 = combat, 2 = boss. Shapes the score. */
  intensity = 0
  region: 'coast' | 'highlands' | 'caldera' = 'coast'
  onTitle = true
  private lowHealth = 0

  constructor() {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.music = this.ctx.createGain()
    this.sfx = this.ctx.createGain()
    this.amb = this.ctx.createGain()
    this.comp = this.ctx.createDynamicsCompressor()
    this.comp.threshold.value = -14
    this.comp.ratio.value = 4
    this.music.connect(this.master)
    this.sfx.connect(this.comp).connect(this.master)
    this.amb.connect(this.master)
    this.master.connect(this.ctx.destination)
    assets.setAudioContext(this.ctx)
  }

  unlock(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setVolumes(music: number, sfx: number, muted = false): void {
    const t = this.ctx.currentTime
    this.master.gain.setTargetAtTime(muted ? 0 : 1, t, 0.05)
    this.music.gain.setTargetAtTime(music * 0.7, t, 0.05)
    this.sfx.gain.setTargetAtTime(sfx * 0.9, t, 0.05)
    this.amb.gain.setTargetAtTime(sfx * 0.55, t, 0.05)
  }

  // ─── SFX ────────────────────────────────────────────────────────────────────
  play(name: Sfx, strength = 1): void {
    if (this.ctx.state !== 'running') return
    const now = this.ctx.currentTime
    // Avoid machine-gun stacking of the same sample within 40 ms.
    if ((this.lastPlay.get(name) ?? -1) > now - 0.04) return
    this.lastPlay.set(name, now)
    const def = SAMPLES[name]
    const buf = def ? assets.sound(SFX_URL(def.file)) : undefined
    if (def && buf) {
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = 1 + (Math.random() * 2 - 1) * (def.pitch ?? 0)
      const g = this.ctx.createGain()
      g.gain.value = def.vol * Math.min(1.4, strength)
      src.connect(g).connect(this.sfx)
      if (def.slice) {
        const off = Math.random() * Math.max(0, buf.duration - def.slice)
        g.gain.setValueAtTime(def.vol * strength, now + def.slice - 0.05)
        g.gain.linearRampToValueAtTime(0, now + def.slice)
        src.start(now, off, def.slice)
      } else src.start(now)
      return
    }
    this.synth(name, strength)
  }

  private noiseBuffer(): AudioBuffer {
    if (this.noise) return this.noise
    const len = this.ctx.sampleRate * 2
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1
    this.noise = buf
    return buf
  }

  private tone(freq: number, end: number, dur: number, type: OscillatorType, vol: number, delay = 0, out: AudioNode = this.sfx): void {
    const t = this.ctx.currentTime + delay
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(end, 20), t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(out)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  private burst(dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, delay = 0, q = 1): void {
    const t = this.ctx.currentTime + delay
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuffer()
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.Q.value = q
    f.frequency.setValueAtTime(f0, t)
    f.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(this.sfx)
    src.start(t, Math.random())
    src.stop(t + dur + 0.05)
  }

  /** Synth stand-ins (used until samples stream in, and for tiny UI blips). */
  private synth(name: Sfx, s: number): void {
    switch (name) {
      case 'swing': this.burst(0.16, 0.22 * s, 'bandpass', 900, 2600, 0, 1.4); break
      case 'heavySwing': this.burst(0.3, 0.3 * s, 'bandpass', 500, 1800, 0, 1.1); break
      case 'hit': this.burst(0.09, 0.5 * s, 'lowpass', 2400, 500); this.tone(190, 70, 0.12, 'triangle', 0.35 * s); break
      case 'bigHit': case 'partBreak': this.burst(0.22, 0.7, 'lowpass', 1800, 200); this.tone(120, 40, 0.3, 'sine', 0.6); break
      case 'hurt': this.burst(0.2, 0.45, 'lowpass', 1400, 300); break
      case 'dodge': this.burst(0.22, 0.2, 'highpass', 1200, 3000, 0, 0.7); break
      case 'gather': case 'gatherWood': case 'gatherRock': case 'gatherPlant': case 'chop': case 'mine': case 'treeFall': case 'rockBreak': case 'snare': case 'pitfall': case 'page': case 'sizzle': case 'eat': this.burst(0.07, 0.35, 'bandpass', 1800, 900, 0, 2); break
      case 'pickup': this.tone(880, 1320, 0.12, 'triangle', 0.14); break
      case 'flash': this.burst(0.35, 0.6, 'highpass', 800, 5000, 0, 0.8); break
      case 'slingWhirl': this.burst(0.4, 0.15, 'bandpass', 600, 1400, 0, 2); break
      case 'slingShot': this.burst(0.12, 0.35, 'bandpass', 1500, 3000, 0, 1.2); break
      case 'clue': case 'tracked': case 'searPerfect': [660, 990].forEach((f, i) => this.tone(f, f, 0.2, 'triangle', 0.16, i * 0.07)); break
      case 'carve': this.burst(0.12, 0.4, 'bandpass', 1200, 400, 0, 2); break
      case 'craft': [523, 659, 784].forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.22, i * 0.08)); break
      case 'upgrade': [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, f * 1.005, 0.5, 'triangle', 0.22, i * 0.12)); break
      case 'roar': case 'bossRoar': this.burst(1.1, 0.55, 'lowpass', 700, 180, 0, 2); this.tone(90, 55, 1.1, 'sawtooth', 0.22); break
      case 'stomp': this.tone(70, 30, 0.45, 'sine', 0.7 * s); this.burst(0.35, 0.4 * s, 'lowpass', 500, 60); break
      case 'ui': case 'lockon': this.tone(660, 720, 0.06, 'triangle', 0.16); break
      case 'uiOpen': this.tone(440, 660, 0.1, 'triangle', 0.14); break
      case 'error': this.tone(220, 180, 0.14, 'square', 0.1); break
      case 'heal': [523, 784, 1047].forEach((f, i) => this.tone(f, f * 1.02, 0.35, 'sine', 0.2, i * 0.09)); break
      case 'charge': this.tone(220 * s, 440 * s, 0.18, 'triangle', 0.14); break
      case 'fire': case 'fireHit': this.burst(0.8, 0.35, 'bandpass', 600, 1400, 0, 0.6); break
      case 'tell': this.tone(1320, 1320, 0.08, 'sine', 0.1); this.tone(990, 990, 0.1, 'sine', 0.08, 0.07); break
      case 'step': case 'stepStone': this.burst(0.05, 0.05 * s, 'lowpass', 800, 300); break
      case 'perfect': this.tone(1200, 2400, 0.25, 'sine', 0.2); break
      case 'stagger': this.tone(900, 700, 0.3, 'triangle', 0.18); break
      case 'down': this.tone(160, 60, 0.6, 'sawtooth', 0.15); break
      case 'win': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, f * 1.01, 0.6, 'triangle', 0.25, i * 0.14)); break
      case 'lose': [392, 330, 262, 196].forEach((f, i) => this.tone(f, f * 0.98, 0.5, 'sine', 0.25, i * 0.2)); break
    }
  }

  // ─── Loops (music layers + ambience) ─────────────────────────────────────────
  private loop(url: string, bus: GainNode): Loop {
    let l = this.loops.get(url)
    if (!l) {
      const gain = this.ctx.createGain()
      gain.gain.value = 0
      gain.connect(bus)
      l = { url, gain, target: 0 }
      this.loops.set(url, l)
    }
    return l
  }

  private drive(l: Loop, target: number, tc = 1.2): void {
    l.target = target
    if (target > 0.001 && !l.src && this.ctx.state === 'running') {
      const buf = assets.sound(l.url)
      if (buf) {
        const src = this.ctx.createBufferSource()
        src.buffer = buf
        src.loop = true
        src.connect(l.gain)
        src.start(this.ctx.currentTime + 0.02, Math.random() * buf.duration * 0.5)
        l.src = src
      } else {
        assets.onReady(l.url, () => {})
      }
    }
    l.gain.gain.setTargetAtTime(l.src ? target : 0, this.ctx.currentTime, tc)
  }

  setAmbience(w: { coast: number; highlands: number; caldera: number }, nearSea: number, atCamp = 0): void {
    this.region = w.caldera > 0.5 ? 'caldera' : w.highlands > 0.5 ? 'highlands' : 'coast'
    if (this.ctx.state !== 'running') return
    this.drive(this.loop(AMB_URL('jungle'), this.amb), 0.55 * w.coast)
    this.drive(this.loop(AMB_URL('ocean'), this.amb), 0.7 * nearSea)
    this.drive(this.loop(AMB_URL('highlands'), this.amb), 0.55 * w.highlands)
    this.drive(this.loop(AMB_URL('caldera'), this.amb), 0.6 * w.caldera)
    this.drive(this.loop(AMB_URL('camp'), this.amb), 0.5 * atCamp)
    this.drive(this.loop(SFX_URL('heartbeat'), this.sfx), this.lowHealth * 0.8, 0.3)
    this.updateMusic()
  }

  /** 0..1 — fades in the heartbeat loop as health gets critical. */
  setLowHealth(v: number): void { this.lowHealth = v }

  startMusic(): void {
    this.musicOn = true
    this.updateMusic()
    if (!this.synthTimer) this.synthTimer = window.setInterval(() => this.updateMusic(), 500)
  }

  stopMusic(): void {
    this.musicOn = false
    for (const l of this.loops.values()) if (l.gain.context && [MUSIC_URL('title'), MUSIC_URL('coast'), MUSIC_URL('highlands'), MUSIC_URL('caldera'), LAYER_URL('explore_perc'), LAYER_URL('hunt_drums'), LAYER_URL('boss_drums')].includes(l.url)) this.drive(l, 0, 0.6)
  }

  /** Victory sting: duck everything and play the fanfare once. */
  playVictory(): void {
    this.stopMusic()
    const buf = assets.sound(MUSIC_URL('victory'))
    if (!buf) { this.synth('win', 1); return }
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const g = this.ctx.createGain()
    g.gain.value = 0.9
    src.connect(g).connect(this.music)
    src.start()
  }

  private updateMusic(): void {
    if (this.ctx.state !== 'running') return
    const on = this.musicOn ? 1 : 0
    const title = this.onTitle
    const I = this.intensity
    const melodic = title ? 0 : I >= 2 ? 0.25 : I >= 1 ? 0.45 : 0.75
    this.drive(this.loop(MUSIC_URL('title'), this.music), on * (title ? 0.9 : 0), 1.5)
    this.drive(this.loop(MUSIC_URL('coast'), this.music), on * melodic * (this.region === 'coast' ? 1 : 0), 2)
    this.drive(this.loop(MUSIC_URL('highlands'), this.music), on * melodic * (this.region === 'highlands' ? 1 : 0), 2)
    this.drive(this.loop(MUSIC_URL('caldera'), this.music), on * melodic * (this.region === 'caldera' ? 1 : 0), 2)
    this.drive(this.loop(LAYER_URL('explore_perc'), this.music), on * (!title && I < 1 ? 0.35 : 0), 1.5)
    this.drive(this.loop(LAYER_URL('hunt_drums'), this.music), on * (!title && I >= 1 && I < 2 ? 0.8 : 0), 0.6)
    this.drive(this.loop(LAYER_URL('boss_drums'), this.music), on * (!title && I >= 2 ? 0.95 : 0), 0.5)
  }
}
