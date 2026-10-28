import * as THREE from 'three'
import { CAMP_STAGES, GEAR, ITEMS, MEALS, MEAL_ORDER, RECIPES, SEAR_ZONES, SPECIES, TOWER_COST, TRACKING, WEAPON_CLASSES, type Cost, type GearId, type ItemId, type MealId, type RecipeDef, type SearQuality, type SpeciesId } from '../game/data'
import { cookState, count, gearStats, knowledge, missing, nextCampStage, recipeState, towerState, weaponClass } from '../game/rules'
import { ARENAS, MAP_GRID, PATHS, POI, REGION_NAMES, WORLD } from '../game/terrain'
import { CAMP } from '../game/camp'
import type { Game, Hooks, MenuTab, PopupKind, StampKind } from '../game/game'
import type { SaveData, SaveStore } from '../engine/save'
import { gearIcon, icon } from './icons'
import { UiFx } from './uifx'

/** Painted item icons (public/ui/icons/<id>.webp); SVG fallback for anything else. */
const PAINTED = new Set<string>(['amber', 'ashfangPelt', 'bone', 'emberCarapace', 'fiber', 'flint', 'herb', 'hogTusk', 'hornShard', 'magmaHeart', 'obsidian', 'poultice', 'roughHide', 'ruinCrest', 'ruinPlate', 'scorchScale', 'snapperScale', 'stalkerClaw', 'stalkerHide', 'stone', 'sulfur', 'wood', 'meat', 'glowcap', 'snare', 'pitfall', 'flashPod'])
function itemIcon(id: ItemId, size: number): string {
  const it = ITEMS[id]
  return PAINTED.has(id) ? `<img class="pi" src="./ui/icons/${id}.webp" width="${size}" height="${size}" alt="" draggable="false">` : icon(it.icon, it.color, size)
}
const PAINTED_GEAR = new Set<string>(['boneSpear', 'stalkerLance', 'reedSling', 'sinewSling', 'flintHatchet', 'flintPick'])
const LOGO = '<img class="logo-img" src="./ui/logo.webp" alt="Caveman vs Wild" draggable="false">'

export type Screen = 'boot' | 'title' | 'hud' | 'menu' | 'skills' | 'pause' | 'faint' | 'victory'
export type { MenuTab }
const TABS: MenuTab[] = ['materials', 'craft', 'cook', 'camp', 'gear', 'journal']
export type UiActions = {
  newGame(): void
  continueGame(): void
  resume(): void
  quitToTitle(): void
  keepExploring(): void
  settings(patch: Partial<SaveData>): void
  lockPointer(): void
  consumeKeys(): void
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const fmtTime = (s: number) => {
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`
}
const ROMAN = ['0', 'I', 'II', 'III']

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Look around'],
  ['Left click · J', 'Light attack (3-hit combo)'],
  ['Hold right click · K', 'Charged heavy (3 levels)'],
  ['Space', 'Dodge roll (invulnerable i-frames)'],
  ['Shift', 'Sprint'],
  ['E', 'Gather · Carve · Use camp'],
  ['1 2 3 4 · F', 'Hold weapon · hatchet · pick · fists'],
  ['Attack a tree / boulder', 'Chop wood · mine stone'],
  ['G', 'Use gadget: snare · pitfall · flash pod'],
  ['C', 'Cycle gadget'],
  ['E on tracks', 'Study clues (3 clues = tracked)'],
  ['B', "Hunter's journal"],
  ['Q · Middle click', 'Lock on / release'],
  ['R', 'Apply poultice'],
  ['Tab', 'Satchel & crafting'],
  ['M', 'Island map'],
  ['H', 'This controls card'],
  ['Esc', 'Pause'],
]
const TIPS = [
  '<b>Red zones</b> on the ground show where an attack will land. The fill shows how soon.',
  'When a creature shows <b class="open">OPEN</b> it is recovering — hits deal <b>+30%</b>.',
  'Heavy hits break poise and cause a <b>stagger</b>. Hits from behind deal extra damage.',
  'Rolling through an attack at the last moment grants a tactical counter-window.',
  'Attacks commit you: you can only chain or roll out during the recovery.',
  '<b>Spear:</b> attack right after a perfect dodge to <b>counter-thrust</b> for huge damage.',
  '<b>Sling:</b> fires Stone from range. A charged shot to the head staggers.',
  '<b>Snares</b> trip charging beasts; <b>flash pods</b> interrupt a windup. Beasts learn: reuse a trick too soon and they resist.',
  'Cook a <b>meal</b> at the hearth before a hunt. Stop the sear in the gold band for a longer buff.',
  'Swing at <b>trees</b> for wood and <b>boulders</b> for stone. Anything works; a <b>hatchet</b> or <b>pick</b> is far faster.',
]

type Popup = { el: HTMLElement; pos: THREE.Vector3; t: number; life: number }

export class Ui {
  readonly root: HTMLElement
  screen: Screen = 'boot'
  game?: Game
  private tab: MenuTab = 'materials'
  private el: Record<string, HTMLElement> = {}
  private popups: Popup[] = []
  private feed: { id: ItemId; n: number; t: number; el: HTMLElement }[] = []
  private bannerT = 0
  private tipT = 0
  private toastT = 0
  private hurtT = 0
  private mapOpen = false
  private mapReturn: 'hud' | 'pause' | null = null
  private mapDrawT = 0
  private helpOpen = false
  private lastPrompt = ''
  private lastObjective = ''
  private objectiveFlash = 0
  readonly fx: UiFx
  private lastLootId: ItemId | null = null
  private lastPot = -1
  private lastHp = -1
  private victoryT = 0
  private hotbarKey = ''
  private lastHeld = ''
  private lastHFrac = 1
  private stampT = 0
  private whiteT = 0
  private jnoteT = 0
  private gadgetKey = ''
  private mealKey = ''
  /** Active sear gauge (cook tab). */
  private sear: { id: MealId; t: number; done: boolean } | null = null
  private searClock = 0
  private journalSel: SpeciesId = 'tuskhog'

  constructor(private readonly save: SaveStore, private readonly actions: UiActions) {
    this.root = document.querySelector('#ui')!
    this.root.innerHTML = this.template()
    for (const n of this.root.querySelectorAll<HTMLElement>('[data-el]')) this.el[n.dataset.el!] = n
    this.fx = new UiFx(document.body)
    this.root.addEventListener('click', e => this.onClick(e))
    this.root.addEventListener('input', e => this.onInput(e))
    window.addEventListener('keydown', e => this.onKey(e))
    this.refreshSettings()
  }

  // ─── Templates ───────────────────────────────────────────────────────────

  private template(): string {
    return `
<section class="screen boot" data-el="boot">
  <div class="boot-bg"></div>
  <div class="boot-embers"></div>
  <div class="logo small">${LOGO}</div>
  <div class="bar"><i data-el="bootBar"></i></div>
  <p class="muted" data-el="bootText">Shaping the island…</p>
</section>

<section class="screen title" data-el="title">
  <div class="title-card">
    <div class="logo">${LOGO}</div>
    <p class="tagline">Hunt the beasts of Cinderfall Isle. Carve, craft, and light the signal.</p>
    <div class="menu-col">
      <button class="btn primary" data-act="continue" data-el="btnContinue">Continue expedition</button>
      <button class="btn" data-act="new" data-el="btnNew">New expedition</button>
      <a class="btn ghost" href="./enemies/" data-el="btnLab">Enemy lab</a>
      <div class="row2">
        <button class="btn ghost" data-act="help">Controls</button>
        <button class="btn ghost" data-act="settings">Settings</button>
      </div>
    </div>
    <p class="fine">Single-player · progress is saved in this browser</p>
  </div>
  <div class="confirm" data-el="confirmNew" hidden>
    <div class="panel narrow">
      <h3>Start over?</h3>
      <p>This replaces your current expedition progress.</p>
      <div class="row2"><button class="btn primary" data-act="confirm-new">Start fresh</button><button class="btn ghost" data-act="cancel-new">Keep it</button></div>
    </div>
  </div>
</section>

<section class="screen hud" data-el="hud">
  <div class="vignette hurt" data-el="vHurt"></div>
  <div class="vignette heat" data-el="vHeat"></div>
  <div class="vignette low" data-el="vLow"></div>
  <div class="vitals">
    <img class="med heart" data-el="medHeart" src="./ui/med-heart.webp" alt="" draggable="false">
    <div class="hpbar" data-el="hpBar"><i class="lost" data-el="hpLost"></i><i class="fill" data-el="hpFill"></i><b class="shine"></b><span data-el="hpText"></span></div>
    <div class="hungerbar" data-el="hungerBar"><i class="fill" data-el="hungerFill"></i><b class="shine"></b><span data-el="hungerText">HUNGER 100%</span></div>
    <div class="vitals-row">
      <div class="chip slot" data-el="potChip" title="Mendleaf Poultice (R)"><img class="pi" src="./ui/icons/poultice.webp" width="26" height="26" alt=""><b data-el="potN">0</b><kbd>R</kbd></div>
      <div class="chip meal" data-el="mealChip" hidden title="Meal buff"><i class="mring" data-el="mealRing"></i><img data-el="mealImg" src="./ui/icons/heartyHaunch.webp" width="28" height="28" alt=""><b data-el="mealT"></b><small data-el="mealName"></small></div>
          <div class="chip heatchip" data-el="heatChip" hidden>Scorching heat — find heat protection</div>
    </div>
  </div>
  <div class="compass" data-el="compass"><img class="ring" data-el="compassRing" src="./ui/compass-ring.webp" alt="" draggable="false"><i class="needle" data-el="needle"></i><i class="needle2" data-el="needle2"></i><span data-el="compassDist"></span></div>
  <div class="bossbar" data-el="boss" hidden>
    <img class="crest" src="./ui/crest-boss.webp" alt="" draggable="false">
    <div class="bname"><b data-el="bossName"></b><span data-el="bossTitle"></span><em class="tag" data-el="bossTag"></em></div>
    <div class="bbar"><i class="lost" data-el="bossLost"></i><i class="fill" data-el="bossFill"></i></div>
  </div>
  <div class="target" data-el="target" hidden>
    <b data-el="tName"></b><em class="tag" data-el="tTag"></em>
    <div class="tbar"><i class="fill" data-el="tFill"></i></div>
  </div>
  <div class="objective" data-el="obj">
    <div class="obj-step" data-el="objStep"></div>
    <div class="obj-title" data-el="objTitle"></div>
    <div class="obj-detail" data-el="objDetail"></div>
    <div class="obj-dist" data-el="objDist"></div>
  </div>
  <div class="marker" data-el="marker"><i></i><span data-el="markerDist"></span></div>
  <div class="tmarker" data-el="tmarker"><img src="./ui/icons/tracked.webp" alt="" draggable="false"><span data-el="tmarkerDist"></span></div>
  <div class="reticle" data-el="reticle" hidden><img src="./ui/reticle.webp" alt="" draggable="false"></div>
  <div class="feed" data-el="feed"></div>
  <div class="popups" data-el="popups"></div>
  <div class="banner" data-el="banner"><small data-el="bannerKind"></small><h2 data-el="bannerTitle"></h2><p data-el="bannerSub"></p></div>
  <div class="tip" data-el="tip"></div>
  <div class="toast" data-el="toast"></div>
  <div class="hotbar" data-el="hotbar"></div>
  <div class="gadget" data-el="gadget" title="Gadget (G to use, C to cycle)"><img data-el="gadgetImg" src="./ui/icons/snare.webp" width="40" height="40" alt="" draggable="false"><b data-el="gadgetN">0</b><kbd>G</kbd><small data-el="gadgetName"></small><em><kbd>C</kbd> cycle</em></div>
  <div class="stamp" data-el="stamp"></div>
  <div class="whiteout" data-el="whiteout"></div>
  <div class="jnote" data-el="jnote"><img src="./ui/icons/journal.webp" alt="" draggable="false"><div><small>Hunter's journal</small><span data-el="jnoteText"></span></div></div>
  <div class="hbar" data-el="hbar"><b data-el="hbarName"></b><div class="hbar-track"><i class="lost" data-el="hbarLost"></i><i class="fill" data-el="hbarFill"></i></div><small data-el="hbarNote"></small></div>
  <div class="prompt" data-el="prompt"><kbd>E</kbd><span data-el="promptVerb"></span><small data-el="promptLabel"></small></div>
  <div class="clicklook" data-el="clickLook">Click to look around</div>
  <button class="skill-hud-btn" data-act="skills"><kbd>V</kbd> Skills</button>
  <div class="hints"><kbd>H</kbd> controls <kbd>Tab</kbd> satchel <kbd>M</kbd> map <kbd>B</kbd> journal<i class="jdot" data-el="jdot"></i></div>
  <div class="region" data-el="region"></div>
</section>

<section class="screen menu" data-el="menu">
  <div class="panel wide">
    <header class="tabs">
      <button data-tab="materials">Materials</button>
      <button data-tab="craft">Craft</button>
      <button data-tab="cook">Cook</button>
      <button data-tab="camp">Camp</button>
      <button data-tab="gear">Gear</button>
      <button data-tab="journal">Journal</button>
      <span class="grow"></span>
      <span class="where" data-el="where"></span>
      <button class="x" data-act="close-menu" aria-label="Close">✕</button>
    </header>
    <div class="menu-body" data-el="menuBody"></div>
    <footer class="menu-foot" data-el="menuFoot"></footer>
  </div>
</section>

<section class="screen skills" data-el="skills">
  <div class="panel skills-panel">
    <header><div><small class="eyebrow">SURVIVAL PROGRESSION</small><h2>Skills</h2></div><button class="x" data-act="skills" aria-label="Close skills">✕</button></header>
    <p class="skills-intro">Every hunt, harvest, and clue makes the caveman more capable in the wild.</p>
    <div class="skills-body" data-el="skillsBody"></div>
    <footer class="menu-foot"><span><kbd>V</kbd>/<kbd>Esc</kbd> close</span><span>Progress saves automatically</span></footer>
  </div>
</section>

  <section class="screen pause" data-el="pause">
    <div class="panel narrow">
      <h2>Paused</h2>
      <div class="menu-col">
        <button class="btn primary" data-act="resume">Resume</button>
        <button class="btn" data-act="pause-map">View expedition map</button>
        <button class="btn" data-act="help">Controls</button>
      <button class="btn" data-act="settings">Settings</button>
      <button class="btn ghost" data-act="quit">Save &amp; return to title</button>
    </div>
  </div>
</section>

<section class="screen faint" data-el="faint">
  <h2>You collapsed…</h2>
  <p>Carried back to camp. Nothing in your satchel was lost.</p>
</section>

<section class="screen victory" data-el="victory">
  <div class="panel narrow center">
    <small class="eyebrow">Expedition complete</small>
    <h2>Signal Restored</h2>
    <p>The beacon on Cinderfall Isle burns bright. Rescue is on its way.</p>
    <div class="stats" data-el="stats"></div>
    <div class="menu-col">
      <button class="btn primary" data-act="keep">Keep exploring</button>
      <button class="btn" data-act="new-after">New expedition</button>
      <button class="btn ghost" data-act="quit">Return to title</button>
    </div>
  </div>
</section>

<div class="overlay help" data-el="help" hidden>
  <div class="panel">
    <header><h3>Controls</h3><button class="x" data-act="help" aria-label="Close">✕</button></header>
    <div class="help-grid">
      <dl>${CONTROLS.map(([k, v]) => `<dt><kbd>${k}</kbd></dt><dd>${v}</dd>`).join('')}</dl>
      <div class="help-tips"><h4>Hunting</h4><ul>${TIPS.map(t => `<li>${t}</li>`).join('')}</ul></div>
    </div>
  </div>
</div>

<div class="overlay map" data-el="map" hidden>
  <div class="panel map-panel">
    <header><div><small class="eyebrow">FIELD CHART · NORTH IS UP</small><h3>Cinderfall Isle</h3></div><button class="x" data-act="map" aria-label="Close map">✕</button></header>
    <div class="map-wrap"><canvas data-el="mapCanvas" width="640" height="640"></canvas><div class="map-compass" aria-hidden="true">N<span>✦</span></div></div>
    <div class="map-meta"><span data-el="mapMeta">Uncharted waters</span><span>ESC close · M map</span></div>
    <p class="legend"><i class="lg you"></i>Player <i class="lg camp"></i>Camp <i class="lg obj"></i>Objective <i class="lg boss"></i>Apex <i class="lg poi"></i>Landmark <i class="lg trk"></i>Tracked</p>
  </div>
</div>

<div class="overlay settings" data-el="settings" hidden>
  <div class="panel narrow">
    <header><h3>Settings</h3><button class="x" data-act="settings-close" aria-label="Close">✕</button></header>
    <label>Music <input type="range" min="0" max="1" step="0.05" data-set="musicVolume"></label>
    <label>Effects <input type="range" min="0" max="1" step="0.05" data-set="sfxVolume"></label>
    <label>Mouse sensitivity <input type="range" min="0.3" max="2.5" step="0.05" data-set="sensitivity"></label>
    <label class="check"><input type="checkbox" data-set="invertY"> Invert camera Y</label>
    <label class="check"><input type="checkbox" data-set="reducedMotion"> Reduce screen shake</label>
    <label class="check"><input type="checkbox" data-set="muted"> Mute all audio</label>
    <label>Graphics
      <select data-set="quality"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
    </label>
    <p class="fine">Graphics changes apply after reloading the page.</p>
  </div>
</div>`
  }

  // ─── Screens ─────────────────────────────────────────────────────────────

  show(s: Screen): void {
    this.screen = s
    for (const k of ['boot', 'title', 'hud', 'menu', 'skills', 'pause', 'faint', 'victory']) this.el[k].classList.toggle('on', k === s || (k === 'hud' && (s === 'menu' || s === 'skills' || s === 'faint')))
    if (s === 'title') {
      const has = !!this.game?.hasSave
      this.el.btnContinue.hidden = !has
      this.el.btnNew.classList.toggle('primary', !has)
    }
    if (s !== 'hud') {
      this.setMap(false)
    }
  }

  setBootProgress(f: number, text?: string): void {
    this.el.bootBar.style.width = `${Math.round(f * 100)}%`
    if (text) this.el.bootText.textContent = text
  }

  refreshSettings(): void {
    const d = this.save.data
    for (const inp of this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-set]')) {
      const key = inp.dataset.set as keyof SaveData
      const v = d[key]
      if (inp instanceof HTMLInputElement && inp.type === 'checkbox') inp.checked = !!v
      else inp.value = String(v)
    }
  }

  private toggleHelp(on = !this.helpOpen): void {
    this.helpOpen = on
    this.el.help.hidden = !on
  }

  private setMap(on: boolean): void {
    this.mapOpen = on
    this.el.map.hidden = !on
    if (!on) this.mapReturn = null
  }

  private openMap(from: 'hud' | 'pause'): void {
    if (!this.game) return
    if (from === 'hud' && this.game.mode === 'playing') this.game.pause()
    this.mapReturn = from
    this.mapOpen = true
    this.el.map.hidden = false
    this.game.audio.play('uiOpen')
    this.actions.consumeKeys()
  }

  private closeMap(): void {
    if (!this.mapOpen) return
    const from = this.mapReturn
    this.mapOpen = false
    this.el.map.hidden = true
    this.mapReturn = null
    if (from === 'hud') {
      this.game?.resume()
      this.show('hud')
      this.actions.lockPointer()
    } else if (from === 'pause') {
      this.show('pause')
    }
    this.game?.audio.play('ui')
    this.actions.consumeKeys()
  }

  private toggleSkills(on = this.screen !== 'skills'): void {
    if (!this.game) return
    if (on && this.screen === 'hud' && this.game.mode === 'playing') {
      this.game.pause()
      this.el.skillsBody.innerHTML = this.skillsHtml(this.game)
      this.show('skills')
      this.game.audio.play('uiOpen')
      this.actions.consumeKeys()
    } else if (!on && this.screen === 'skills') {
      this.game.resume()
      this.show('hud')
      this.actions.lockPointer()
      this.game.audio.play('ui')
      this.actions.consumeKeys()
    }
  }

  // ─── Input ───────────────────────────────────────────────────────────────

  private onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement
    const tabBtn = t.closest<HTMLElement>('[data-tab]')
    if (tabBtn) {
      this.game?.audio.play('ui')
      this.renderMenu(tabBtn.dataset.tab as MenuTab)
      return
    }
    const b = t.closest<HTMLElement>('[data-act]')
    if (!b) return
    const act = b.dataset.act!
    const g = this.game
    g?.audio.unlock()
    switch (act) {
      case 'continue':
        this.actions.continueGame()
        break
      case 'new':
        if (g?.hasSave) this.el.confirmNew.hidden = false
        else this.actions.newGame()
        break
      case 'confirm-new':
        this.el.confirmNew.hidden = true
        this.actions.newGame()
        break
      case 'cancel-new':
        this.el.confirmNew.hidden = true
        break
      case 'new-after':
        this.actions.newGame()
        break
      case 'help':
        this.toggleHelp()
        break
      case 'skills':
        this.toggleSkills()
        break
      case 'map':
        this.closeMap()
        break
      case 'pause-map':
        this.openMap('pause')
        break
      case 'settings':
        this.refreshSettings()
        this.el.settings.hidden = false
        break
      case 'settings-close':
        this.el.settings.hidden = true
        break
      case 'resume':
        this.actions.resume()
        break
      case 'quit':
        this.actions.quitToTitle()
        break
      case 'keep':
        this.actions.keepExploring()
        break
      case 'close-menu':
        this.closeMenu()
        break
      case 'craft':
        if (g) {
          const r = g.craft(b.dataset.id as RecipeDef['id'])
          this.toast(r.ok ? r.message : r.reason, r.ok ? 'good' : 'warn')
          if (r.ok) {
            const card = b.closest('.recipe') ?? b
            const [x, y] = this.fx.at(card, 0.08, 0.5)
            this.fx.burst(x, y, { color: ['#ffd27a', '#ff9a3a', '#fff2c8'], n: 40, speed: 360, kind: 'star', grav: 200, life: 0.9 })
            this.fx.ring(x, y, '#ffd27a', 80, 0.5)
            this.fx.outline(card, { color: ['#ffd27a', '#fff2c8'], n: 40, speed: 60, grav: -30, life: 0.9 })
          }
          this.renderMenu(this.tab)
        }
        break
      case 'cook':
        if (g) this.startSear(b.dataset.id as MealId)
        break
      case 'sear-stop':
        this.stopSear()
        break
      case 'jsel':
        this.journalSel = b.dataset.id as SpeciesId
        g?.audio.play('page')
        this.renderMenu('journal')
        break
      case 'equip':
        g?.equip(b.dataset.id as GearId)
        this.renderMenu(this.tab)
        break
      case 'upgrade':
        if (g) {
          const r = g.upgrade()
          if (r.ok) {
            for (let i = 0; i < 5; i += 1) setTimeout(() => this.fx.burst(innerWidth * (0.3 + Math.random() * 0.4), innerHeight * (0.35 + Math.random() * 0.3), { color: ['#ffd27a', '#ff9a3a', '#fff2c8', '#9dff9a'], n: 36, speed: 420, kind: 'star', grav: 260, life: 1.1 }), i * 140)
            this.closeMenu()
          }
          else this.toast(r.reason, 'warn')
          if (!r.ok) this.renderMenu('camp')
        }
        break
      case 'tower':
        if (g) {
          const r = g.restoreTower()
          if (r.ok) this.show('hud')
          else {
            this.toast(r.reason, 'warn')
            this.renderMenu('camp')
          }
        }
        break
    }
  }

  private onInput(e: Event): void {
    const inp = e.target as HTMLInputElement | HTMLSelectElement
    const key = inp.dataset.set as keyof SaveData | undefined
    if (!key) return
    let v: unknown
    if (inp instanceof HTMLInputElement && inp.type === 'checkbox') v = inp.checked
    else if (inp instanceof HTMLInputElement && inp.type === 'range') v = Number(inp.value)
    else v = inp.value
    this.actions.settings({ [key]: v } as Partial<SaveData>)
  }

  private onKey(e: KeyboardEvent): void {
    if (e.repeat) return
    if (this.mapOpen && (e.code === 'Escape' || e.code === 'KeyM')) {
      e.preventDefault()
      this.closeMap()
      return
    }
    if (!this.el.settings.hidden && e.code === 'Escape') {
      this.el.settings.hidden = true
      this.actions.consumeKeys()
      return
    }
    if (this.helpOpen && (e.code === 'Escape' || e.code === 'KeyH')) {
      this.toggleHelp(false)
      this.actions.consumeKeys()
      return
    }
    if (this.screen === 'skills' && (e.code === 'Escape' || e.code === 'KeyV')) {
      e.preventDefault()
      this.toggleSkills(false)
      return
    }
    if (this.screen === 'menu' && this.sear && !this.sear.done && (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter')) {
      e.preventDefault()
      this.stopSear()
      this.actions.consumeKeys()
      return
    }
    if (this.screen === 'menu' && this.tab === 'journal' && e.code === 'KeyB') {
      this.closeMenu()
      this.actions.consumeKeys()
      return
    }
    if (this.screen === 'menu' && (e.code === 'Escape' || e.code === 'Tab' || e.code === 'KeyI')) {
      e.preventDefault()
      this.closeMenu()
      this.actions.consumeKeys()
      return
    }
    if (this.screen === 'menu') {
      const m = /^Digit([1-6])$/.exec(e.code)
      if (m && !this.sear) this.renderMenu(TABS[Number(m[1]) - 1])
      return
    }
    if (this.screen === 'hud' && this.game?.mode === 'playing') {
      if (e.code === 'KeyM') this.openMap('hud')
      if (e.code === 'KeyH') this.toggleHelp()
      if (e.code === 'KeyV') this.toggleSkills()
      if (e.code === 'Escape' && (this.mapOpen || this.helpOpen)) {
        this.setMap(false)
        this.toggleHelp(false)
        this.actions.consumeKeys()
      }
    } else if (this.screen === 'title' && e.code === 'KeyH') this.toggleHelp()
  }

  private closeMenu(): void {
    if (this.screen !== 'menu') return
    if (this.sear && !this.sear.done) this.stopSear()
    this.sear = null
    this.game?.resume()
    this.show('hud')
    this.actions.lockPointer()
  }

  private skillsHtml(g: Game): string {
    const p = g.progress
    const hunts = Object.values(p.hunts).reduce((n, v) => n + (v ?? 0), 0)
    const clues = Object.values(p.journal).reduce((n, e) => n + (e?.clues ?? 0), 0)
    const speciesSeen = Object.values(p.journal).filter(e => e?.seen).length
    const skill = (name: string, level: number, current: number, next: number, detail: string, color: string) => {
      const pct = Math.min(100, Math.round((current / next) * 100))
      return `<article class="skill-card"><div class="skill-title"><b>${name}</b><strong>LEVEL ${level}</strong></div><p>${detail}</p><div class="skill-track"><i style="width:${pct}%;background:${color}"></i></div><small>${current} / ${next} progress</small></article>`
    }
    const huntingLevel = Math.min(5, 1 + Math.floor(hunts / 2))
    const foragingLevel = Math.min(5, 1 + Math.floor(p.harvested / 4))
    const craftingLevel = Math.min(5, 1 + Math.floor(p.crafted / 3))
    const trackingLevel = Math.min(5, 1 + Math.floor((clues + speciesSeen) / 4))
    return `<div class="skill-grid">
      ${skill('Hunting', huntingLevel, hunts % 2, 2, `${hunts} wildlife hunts recorded · carve meat from ordinary animals`, '#ff8a4a')}
      ${skill('Foraging', foragingLevel, p.harvested % 4, 4, `${p.harvested} trees and boulders harvested · gather what the forest gives`, '#8fd35a')}
      ${skill('Crafting', craftingLevel, p.crafted % 3, 3, `${p.crafted} recipes completed · stronger tools keep the hunt moving`, '#ffd27a')}
      ${skill('Tracking', trackingLevel, (clues + speciesSeen) % 4, 4, `${speciesSeen} species discovered · study clues to reveal trails`, '#7df9ff')}
    </div><div class="skill-summary"><span><b>Current hunger</b> ${Math.ceil(p.hunger)}%</span><span><b>Camp stage</b> ${ROMAN[p.campStage]}</span><span><b>Regions found</b> ${p.regions.length}/3</span></div>`
  }

  // ─── Menu (satchel) ──────────────────────────────────────────────────────

  openMenu(tab: MenuTab = 'materials'): void {
    this.show('menu')
    this.renderMenu(tab)
  }

  private costChips(cost: Cost): string {
    const g = this.game!
    return `<div class="costs">${(Object.entries(cost) as [ItemId, number][])
      .map(([id, need]) => {
        const have = count(g.progress, id)
        const it = ITEMS[id]
        return `<span class="cost ${have >= need ? 'ok' : 'no'}" title="${esc(it.name)}">${itemIcon(id, 24)}<b>${Math.min(have, 99)}/${need}</b><small>${esc(it.name)}</small></span>`
      })
      .join('')}</div>`
  }

  renderMenu(tab: MenuTab): void {
    const g = this.game
    if (!g) return
    this.tab = tab
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-tab]')) b.classList.toggle('on', b.dataset.tab === tab)
    const p = g.progress
    const atCamp = g.atCamp
    this.el.where.innerHTML = atCamp ? `<span class="ok">● At camp</span> · stage ${ROMAN[p.campStage]}` : `<span class="no">● In the wild</span> · crafting needs the camp hearth`
    let html = ''
    if (tab === 'materials') {
      const ids = (Object.keys(ITEMS) as ItemId[]).filter(id => count(p, id) > 0)
      const groups: [string, ItemId[]][] = [
        ['Materials', ids.filter(i => ITEMS[i].kind === 'material')],
        ['Creature parts', ids.filter(i => ITEMS[i].kind === 'part')],
        ['Key items & supplies', ids.filter(i => ITEMS[i].kind === 'key' || ITEMS[i].kind === 'consumable')],
      ]
      html = groups
        .map(([name, list]) => `<h4>${name}</h4>${list.length ? `<div class="items">${list.map(id => `<div class="item k-${ITEMS[id].kind}" title="${esc(ITEMS[id].desc)}">${itemIcon(id, 44)}<b>${count(p, id)}</b><span>${esc(ITEMS[id].name)}</span><small>${esc(ITEMS[id].desc)}</small></div>`).join('')}</div>` : '<p class="muted">Nothing yet.</p>'}`)
        .join('')
      const hunts = Object.entries(p.hunts) as [keyof typeof SPECIES, number][]
      html += `<h4>Hunting log</h4>${hunts.length ? `<div class="hunts">${hunts.map(([s, n]) => `<span><b>${n}×</b> ${esc(SPECIES[s].name)}</span>`).join('')}</div>` : '<p class="muted">No hunts yet.</p>'}`
    } else if (tab === 'craft') {
      html = `<div class="recipes">${RECIPES.map(r => {
        const st = recipeState(p, r)
        const gear = r.gear ? GEAR[r.gear] : null
        const name = gear ? gear.name : ITEMS[r.item!].name
        const desc = gear ? gear.desc : ITEMS[r.item!].desc
        const wcls = gear?.slot === 'weapon' ? weaponClass(gear.id) : null
        const cls = wcls ? ` · <b class="cls c-${wcls}">${WEAPON_CLASSES[wcls].name}</b>` : ''
        const statLine = gear
          ? gear.slot === 'weapon'
            ? `Attack <b>${gear.attack}</b>${cls}<br><small class="clsdesc">${esc(WEAPON_CLASSES[wcls!].desc)}</small>`
            : gear.slot === 'armor'
              ? `Defense <b>${Math.round((gear.defense ?? 0) * 100)}%</b> · Health <b>+${gear.hp}</b>${gear.heatProof ? ' · <b class="hot">Heat-proof</b>' : ''}`
              : `Tool`
          : r.item === 'poultice' ? `Heals <b>45</b> · carry up to 5` : `Gadget · carry up to <b>${r.item === 'flashPod' ? 5 : r.item === 'snare' ? 3 : 2}</b> · you have <b>${count(p, r.item!)}</b>`
        const ic = gear ? `<span class="gi">${PAINTED_GEAR.has(gear.id) ? `<img class="pi" src="./ui/icons/${gear.id}.webp" width="40" height="40" alt="">` : gearIcon(gear.slot, gear.tier)}</span>` : `<span class="gi">${itemIcon(r.item!, 40)}</span>`
        const label = st === 'owned' ? 'Owned' : st === 'full' ? 'Full' : st === 'locked' ? `Camp ${ROMAN[r.stage]}` : 'Craft'
        const can = st === 'ready' && atCamp
        return `<div class="recipe s-${st}">${ic}<div class="rinfo"><b>${esc(name)}</b><small>${esc(desc)}</small><span class="stat">${statLine}</span>${st !== 'owned' ? this.costChips(r.cost) : ''}</div>
          <button class="btn sm ${can ? 'primary' : ''}" data-act="craft" data-id="${r.id}" ${can ? '' : 'disabled'}>${label}</button></div>`
      }).join('')}</div>`
    } else if (tab === 'camp') {
      const next = nextCampStage(p)
      const pips = [1, 2, 3].map(s => `<div class="pip ${p.campStage >= s ? 'done' : next?.stage === s ? 'next' : ''}"><b>${ROMAN[s]}</b><span>${esc(CAMP_STAGES[s - 1].name)}</span></div>`).join('<i class="pipline"></i>')
      html = `<div class="camp-stages">${pips}</div>`
      if (next) {
        const ok = missing(p, next.cost).length === 0
        html += `<div class="card"><h4>Next: ${esc(next.name)} <small>(stage ${ROMAN[next.stage]} of III)</small></h4><p>${esc(next.desc)}</p>${this.costChips(next.cost)}
          <button class="btn ${ok && atCamp ? 'primary' : ''}" data-act="upgrade" ${ok && atCamp ? '' : 'disabled'}>${atCamp ? (ok ? 'Build' : 'Missing materials') : 'Return to camp to build'}</button></div>`
      } else html += `<div class="card"><h4>Stonehold complete</h4><p>Your camp is fully built.</p></div>`
      const ts = towerState(p)
      html += `<div class="card tower"><h4>Signal Tower</h4><p>${ts === 'done' ? 'The beacon burns. Rescue is coming.' : ts === 'locked' ? 'Its footing needs the Stonehold (camp stage III) before it can be raised.' : 'Bring the apex trophies and fuel to raise and light the beacon — this ends the expedition.'}</p>
        ${ts !== 'done' ? this.costChips(TOWER_COST) : ''}
        ${ts === 'ready' || ts === 'missing' ? `<button class="btn ${ts === 'ready' && atCamp ? 'primary glow' : ''}" data-act="tower" ${ts === 'ready' && atCamp ? '' : 'disabled'}>${ts === 'ready' ? 'Restore the Signal Tower' : 'Missing materials'}</button>` : ''}</div>`
    } else if (tab === 'cook') {
      html = this.cookHtml(g)
    } else if (tab === 'journal') {
      html = this.journalHtml(g)
      this.el.jdot.classList.remove('on')
    } else {
      const s = gearStats(p)
      html = `<div class="statline"><span>Attack <b>${s.attack}</b></span><span>Defense <b>${Math.round(s.defense * 100)}%</b></span><span>Max health <b>${s.maxHp}</b></span><span>Heat <b class="${s.heatProof ? 'ok' : 'no'}">${s.heatProof ? 'Protected' : 'Exposed'}</b></span><span>Carves <b>+${s.carves}</b></span><span>Mining <b class="${s.canMine ? 'ok' : 'no'}">${s.canMine ? 'Yes' : 'No'}</b></span></div>`
      for (const slot of ['weapon', 'armor', 'tool'] as const) {
        const list = (Object.values(GEAR) as (typeof GEAR)[GearId][]).filter(gd => gd.slot === slot)
        html += `<h4>${slot === 'weapon' ? 'Weapons' : slot === 'armor' ? 'Armour' : 'Tools'}</h4><div class="gear-list">${list
          .map(gd => {
            const own = p.owned.includes(gd.id)
            const on = p.weapon === gd.id || p.armor === gd.id
            const gi = PAINTED_GEAR.has(gd.id) ? `<img class="pi" src="./ui/icons/${gd.id}.webp" width="44" height="44" alt="">` : gearIcon(slot, gd.tier)
            const wc = slot === 'weapon' ? `<em class="cls c-${weaponClass(gd.id)}">${WEAPON_CLASSES[weaponClass(gd.id)].name} · ${gd.attack}</em>` : ''
            return `<div class="gearcard ${own ? '' : 'missing'} ${on ? 'on' : ''}">${gi}<b>${esc(gd.name)}</b>${wc}<small>${own ? esc(gd.desc) : 'Not crafted yet'}</small>${own && slot !== 'tool' ? `<button class="btn sm" data-act="equip" data-id="${gd.id}" ${on ? 'disabled' : ''}>${on ? 'Equipped' : 'Equip'}</button>` : own ? `<em class="okc">${gd.id === 'flintHatchet' ? 'Press <kbd>2</kbd> to hold' : gd.id === 'flintPick' ? 'Press <kbd>3</kbd> to hold · mines veins' : 'Always active'}</em>` : ''}</div>`
          })
          .join('')}</div>`
      }
    }
    this.el.menuBody.innerHTML = html
    this.el.menuFoot.innerHTML = `<span><kbd>1</kbd>–<kbd>6</kbd> tabs</span><span><kbd>Tab</kbd>/<kbd>Esc</kbd> close</span>`
  }

  private cookHtml(g: Game): string {
    const p = g.progress
    const atCamp = g.atCamp
    let html = ''
    if (p.meal) {
      const m = MEALS[p.meal.id]
      html += `<div class="card meal-now"><img class="pi" src="./ui/icons/${m.id}.webp" width="56" height="56" alt=""><div><h4>Eaten: ${esc(m.name)} <small class="q-${p.meal.q}">${p.meal.q === 'perfect' ? 'Perfect sear' : p.meal.q === 'charred' ? 'Charred' : 'Well cooked'}</small></h4><p>${esc(m.desc)} · <b>${fmtTime(p.meal.t)}</b> left. Cooking again replaces it.</p></div></div>`
    } else html += `<p class="muted cook-intro">Cook one meal before a hunt. Its buff lasts about 5 minutes, and ends if you faint. Stop the sear in the <b class="gold">gold band</b> for a 50% longer buff.</p>`
    if (this.sear) {
      const m = MEALS[this.sear.id]
      const [g0, g1] = SEAR_ZONES.good
      const [p0, p1] = SEAR_ZONES.perfect
      html += `<div class="sear ${this.sear.done ? 'done' : ''}" data-el-sear><h4>Searing ${esc(m.name)}…</h4>
        <div class="sgauge"><i class="zg" style="left:${g0 * 100}%;width:${(g1 - g0) * 100}%"></i><i class="zp" style="left:${p0 * 100}%;width:${(p1 - p0) * 100}%"></i><b class="sneedle" data-sneedle></b></div>
        <p>${this.sear.done ? '' : 'Press <kbd>Space</kbd> or <kbd>E</kbd> (or click) to take it off the fire'}</p>
        ${this.sear.done ? '' : '<button class="btn primary" data-act="sear-stop">Take it off!</button>'}</div>`
    }
    html += `<div class="recipes meals">${MEAL_ORDER.map(id => {
      const m = MEALS[id]
      const st = cookState(p, id)
      const can = st === 'ready' && atCamp && !this.sear
      const label = st === 'locked' ? `Camp ${ROMAN[m.stage]}` : !atCamp ? 'At hearth' : st === 'missing' ? 'Missing' : 'Cook'
      return `<div class="recipe s-${st}"><span class="gi"><img class="pi" src="./ui/icons/${id}.webp" width="44" height="44" alt=""></span><div class="rinfo"><b>${esc(m.name)}</b><span class="stat buff">${esc(m.desc)}</span>${this.costChips(m.cost)}</div>
        <button class="btn sm ${can ? 'primary' : ''}" data-act="cook" data-id="${id}" ${can ? '' : 'disabled'}>${label}</button></div>`
    }).join('')}</div>`
    return html
  }

  private startSear(id: MealId): void {
    const g = this.game
    if (!g || this.sear) return
    if (cookState(g.progress, id) !== 'ready' || !g.atCamp) return
    this.sear = { id, t: 0, done: false }
    this.searClock = 0
    g.audio.play('sizzle')
    this.renderMenu('cook')
  }

  /** Where the sear needle is (0..1): sweeps up then back down once, then burns. */
  private searPos(t: number): number {
    const T = 1.25
    return t < T ? t / T : Math.max(0, 1 - (t - T) / T)
  }

  private stopSear(): void {
    const g = this.game
    const sr = this.sear
    if (!g || !sr || sr.done) return
    sr.done = true
    const x = this.searPos(sr.t)
    const burnt = sr.t >= 2.5
    const q: SearQuality = burnt ? 'charred' : x >= SEAR_ZONES.perfect[0] && x <= SEAR_ZONES.perfect[1] ? 'perfect' : x >= SEAR_ZONES.good[0] && x <= SEAR_ZONES.good[1] ? 'good' : 'charred'
    const r = g.cookMeal(sr.id, q)
    const gauge = this.root.querySelector<HTMLElement>('.sgauge')
    if (r.ok) {
      this.toast(r.message, 'good')
      const [cx, cy] = gauge ? this.fx.at(gauge, x, 0.5) : [innerWidth / 2, innerHeight / 2]
      if (q === 'perfect') {
        this.stamp('PERFECT SEAR', 'gold')
        this.fx.burst(cx, cy, { color: ['#ffd27a', '#fff2c8', '#ff9a3a'], n: 70, speed: 460, kind: 'star', grav: 220, life: 1.2, size: 10 })
        this.fx.ring(cx, cy, '#ffd27a', 120, 0.6)
      } else if (q === 'good') {
        this.fx.burst(cx, cy, { color: ['#ffcf7a', '#fff2c8'], n: 34, speed: 300, kind: 'star', grav: 200 })
      } else {
        this.fx.burst(cx, cy, { color: ['#4a3a30', '#8a6a50', '#2a2220'], n: 30, speed: 180, kind: 'dot', grav: -60, life: 1.2 })
        this.toast(`Charred! ${r.message} (shorter buff)`, 'warn')
      }
      const meal = this.el.mealChip
      window.setTimeout(() => {
        if (meal.hidden) return
        const [mx, my] = this.fx.at(meal)
        this.fx.fly(`<img class="pi" src="./ui/icons/${sr.id}.webp" width="40" height="40" alt="">`, [cx, cy], meal, '#ffd27a')
        this.fx.ring(mx, my, '#ffd27a', 50, 0.5)
      }, 60)
    } else this.toast(r.reason, 'warn')
    window.setTimeout(() => {
      this.sear = null
      if (this.screen === 'menu' && this.tab === 'cook') this.renderMenu('cook')
    }, 900)
    this.renderMenu('cook')
  }

  private journalHtml(g: Game): string {
    const p = g.progress
    const ids = Object.keys(SPECIES) as SpeciesId[]
    const list = ids.map(sp => {
      const k = knowledge(p, sp)
      const d = SPECIES[sp]
      return `<button class="jcard ${sp === this.journalSel ? 'on' : ''} ${k.seen ? '' : 'unknown'} ${d.boss ? 'boss' : ''}" data-act="jsel" data-id="${sp}">
        <b>${k.seen ? esc(d.name) : '???'}</b><small>${k.seen ? esc(REGION_NAMES[d.region]) : 'Not yet sighted'}</small>
        <span class="jbadges">${k.tracked ? '<i class="jb trk" title="Tracked"></i>' : ''}${k.weak ? '<i class="jb wk" title="Weak spot known"></i>' : ''}${k.hunted ? `<i class="jb hn">${k.hunts}</i>` : ''}</span></button>`
    }).join('')
    const sp = this.journalSel
    const d = SPECIES[sp]
    const k = knowledge(p, sp)
    let page = ''
    if (!k.seen) {
      page = `<div class="jpage unknown"><h3>Unknown beast</h3><p>Rumoured to roam ${esc(REGION_NAMES[d.region])}. Get within sight of it to begin an entry.</p></div>`
    } else {
      const pips = Array.from({ length: TRACKING.cluesNeeded }, (_, i) => `<i class="pip ${i < k.clues ? 'on' : ''}"></i>`).join('')
      const zone = d.weak.zone
      const diagram = `<svg class="wzone" viewBox="-50 -50 100 100" width="92" height="92"><circle r="40" fill="rgba(0,0,0,.18)" stroke="#6b5236" stroke-width="2"/>${k.weak ? `<path d="${zone === 'head' ? 'M0 0 L-17 -37 A40 40 0 0 1 17 -37 Z' : zone === 'rear' ? 'M0 0 L-17 37 A40 40 0 0 0 17 37 Z' : 'M0 0 L-37 -17 A40 40 0 0 0 -37 17 Z M0 0 L37 -17 A40 40 0 0 1 37 17 Z'}" fill="#ff8a2a" opacity=".85"/>` : ''}<ellipse rx="11" ry="20" fill="#d9c49c" stroke="#3b2a1a" stroke-width="2"/><circle cy="-22" r="7" fill="#d9c49c" stroke="#3b2a1a" stroke-width="2"/><text y="-44" text-anchor="middle" font-size="9" fill="#6b5236">FRONT</text></svg>`
      const preds = ids.filter(o => SPECIES[o].prey?.includes(sp))
      const eco = (k.tracked || k.hunted)
        ? `<p><b>Habitat:</b> ${esc(d.habitat)}</p>${d.prey?.length ? `<p><b>Hunts:</b> ${d.prey.map(x => esc(SPECIES[x].name)).join(', ')}. Ambush it while it feeds for a sneak attack.</p>` : ''}${preds.length ? `<p><b>Hunted by:</b> ${preds.map(x => esc(SPECIES[x].name)).join(', ')}</p>` : ''}`
        : `<p class="muted">Study ${TRACKING.cluesNeeded} clues (tracks, dung, claw marks) to learn its habitat and ecology.</p>`
      const atks = k.hunted
        ? `<ul class="jatk">${d.attacks.map(a => `<li><b>${esc(a.name)}</b> <small>${esc(a.desc)}</small></li>`).join('')}</ul>`
        : `<p class="muted">Hunt one to record its attacks.</p>`
      let drops: string
      if (d.bossCarves) {
        const all = new Set<ItemId>()
        for (const c of d.bossCarves) for (const id of Object.keys(c) as ItemId[]) all.add(id)
        drops = `<div class="jdrops">${[...all].map(id => k.parts.includes(id) || k.exact ? `<span>${itemIcon(id, 28)}${esc(ITEMS[id].name)}</span>` : '<span class="q">?</span>').join('')}</div>`
      } else {
        const total = d.drops.reduce((a, x) => a + x.weight, 0)
        drops = `<div class="jdrops">${d.drops.map(x => k.parts.includes(x.item) || k.exact ? `<span>${itemIcon(x.item, 28)}${esc(ITEMS[x.item].name)}${k.exact ? `<b>${Math.round((x.weight / total) * 100)}%</b>` : ''}</span>` : '<span class="q">?</span>').join('')}</div>${k.exact ? '' : `<p class="muted fine">Hunt ${Math.max(0, 3 - k.hunts)} more to learn exact carve rates.</p>`}`
      }
      page = `<div class="jpage"><header><h3>${esc(d.name)}</h3><small>${esc(d.title)}</small>${k.tracked ? '<em class="tag trk">TRACKED</em>' : ''}</header>
        <p class="lore">${esc(d.lore)}</p>
        <div class="jgrid"><div><h5>Weak spot</h5>${diagram}<p>${k.weak ? `<b>${esc(d.weak.label)}</b> takes ×${d.weak.mult} damage` : '<span class="muted">Land hits to find it</span>'}</p></div>
        <div><h5>Tracking</h5><div class="pips">${pips}</div><p>${k.clues}/${TRACKING.cluesNeeded} clues${k.tracked ? ' · trail shown' : ''}</p><h5>Record</h5><p>Hunted <b>${k.hunts}</b>${k.best ? ` · best <b>${fmtTime(k.best)}</b>` : ''}</p></div></div>
        <h5>Ecology</h5>${eco}<h5>Attacks</h5>${atks}<h5>Carves</h5>${drops}</div>`
    }
    return `<div class="journal"><div class="jlist">${list}</div>${page}</div>`
  }

  // ─── Hooks for the game ──────────────────────────────────────────────────

  hooks(): Hooks {
    return {
      popup: (text, at, kind) => this.popup(text, at, kind),
      toast: (text, kind) => this.toast(text, kind),
      loot: (id, n) => this.loot(id, n),
      banner: (title, sub, kind) => this.banner(title, sub, kind),
      tip: (_id, html) => this.tip(html),
      openMenu: tab => this.openMenu(tab ?? 'materials'),
      faint: () => this.show('faint'),
      victory: () => this.showVictory(),
      stamp: (text, kind) => this.stamp(text, kind),
      journal: (_sp, text) => this.journalNote(text),
      flash: a => {
        this.whiteT = Math.max(this.whiteT, Math.min(1, a))
      },
      hurt: amount => {
        this.hurtT = Math.min(1, 0.35 + amount / 40)
        const [x, y] = this.fx.at(this.el.hpFill, 1, 0.5)
        this.fx.burst(x, y, { color: ['#ff4a3a', '#ff9a6a', '#ffd0b0'], n: 10 + Math.min(20, Math.round(amount)), speed: 260, kind: 'shard', grav: 520, life: 0.7, dir: -Math.PI / 2, spread: 2.6 })
        this.el.medHeart.classList.remove('thump'); void this.el.medHeart.offsetWidth; this.el.medHeart.classList.add('thump')
      },
    }
  }

  popup(text: string, at: THREE.Vector3, kind: PopupKind): void {
    const el = document.createElement('div')
    el.className = `pop p-${kind}`
    el.textContent = text
    this.el.popups.appendChild(el)
    const jitter = kind === 'dmg' || kind === 'punish' || kind === 'big' ? (Math.random() - 0.5) * 0.8 : 0
    this.popups.push({ el, pos: at.clone().add(new THREE.Vector3(jitter, 0, jitter)), t: 0, life: kind === 'loot' ? 1.6 : kind === 'info' || kind === 'big' ? 1.3 : 0.9 })
    const g = this.game
    if (g && (kind === 'punish' || kind === 'big' || kind === 'loot' || kind === 'info')) {
      const sp = g.project(at)
      if (!sp.behind) {
        if (kind === 'loot' && this.lastLootId) {
          const id = this.lastLootId
          const target = this.el.feed.firstElementChild ?? this.el.feed
          this.fx.fly(itemIcon(id, 40), [sp.x, sp.y], target, ITEMS[id].kind === 'part' ? '#ffb45a' : '#ffe08a')
        } else if (kind === 'info') this.fx.burst(sp.x, sp.y, { color: ['#9fe8ff', '#e6fbff'], n: 16, speed: 220, kind: 'star' })
        else this.fx.burst(sp.x, sp.y, { color: kind === 'punish' ? ['#ffb347', '#ffe08a', '#fff'] : ['#ffe08a', '#fff2c8'], n: kind === 'punish' ? 26 : 16, speed: kind === 'punish' ? 320 : 240, kind: 'star', grav: 120 })
      }
    }
    if (this.popups.length > 40) this.popups.shift()!.el.remove()
  }

  stamp(text: string, kind: StampKind): void {
    const el = this.el.stamp
    el.textContent = text
    el.className = `stamp s-${kind}`
    void el.offsetWidth
    el.classList.add('on')
    this.stampT = 1.5
    const col: Record<StampKind, string[]> = {
      gold: ['#ffd27a', '#fff2c8', '#ff9a3a'], trap: ['#b8f07a', '#f2ffd0', '#6ac04a'], flash: ['#ffffff', '#fff6c8', '#bfe8ff'],
      track: ['#d6ff8a', '#9ae8ff', '#ffffff'], counter: ['#ffe9a8', '#ffb347', '#ffffff'],
    }
    requestAnimationFrame(() => {
      const [x, y] = this.fx.at(el)
      this.fx.burst(x, y, { color: col[kind], n: 44, speed: 420, kind: 'star', grav: 160, life: 1, size: 10 })
      this.fx.ring(x, y, col[kind][0], 140, 0.5)
    })
  }

  private journalNote(text: string): void {
    const el = this.el.jnote
    this.el.jnoteText.textContent = text
    el.classList.remove('on')
    void el.offsetWidth
    el.classList.add('on')
    this.jnoteT = 3.4
    this.game?.audio.play('page', 0.8)
    this.el.jdot.classList.add('on')
    requestAnimationFrame(() => {
      const [x, y] = this.fx.at(el, 0.1, 0.5)
      this.fx.burst(x, y, { color: ['#f2e2b8', '#ffd27a', '#fff'], n: 20, speed: 180, kind: 'star', grav: 40, life: 0.8 })
    })
  }

  toast(text: string, kind: 'good' | 'warn' | 'info' = 'info'): void {
    const t = this.el.toast
    t.textContent = text
    t.className = `toast on t-${kind}`
    this.toastT = 3
  }

  loot(id: ItemId, n: number): void {
    this.lastLootId = id
    const existing = this.feed.find(f => f.id === id && f.t < 2.5)
    if (existing) {
      existing.n += n
      existing.t = 0
      existing.el.querySelector('b')!.textContent = `+${existing.n}`
      existing.el.classList.remove('bump')
      void existing.el.offsetWidth
      existing.el.classList.add('bump')
      return
    }
    const it = ITEMS[id]
    const el = document.createElement('div')
    el.className = `fi k-${it.kind} bump`
    el.innerHTML = `${itemIcon(id, 28)}<b>+${n}</b><span>${esc(it.name)}</span><small>${count(this.game!.progress, id)}</small>`
    this.el.feed.prepend(el)
    this.feed.push({ id, n, t: 0, el })
    while (this.feed.length > 6) this.feed.shift()!.el.remove()
  }

  banner(title: string, sub: string, kind: 'region' | 'boss' | 'camp' = 'region'): void {
    this.el.bannerKind.textContent = kind === 'boss' ? 'Apex beast' : kind === 'camp' ? 'Camp' : 'Now entering'
    this.el.bannerTitle.textContent = title
    this.el.bannerSub.textContent = sub
    this.el.banner.className = `banner on b-${kind}`
    requestAnimationFrame(() => this.fx.outline(this.el.banner, { color: kind === 'boss' ? ['#ff6a3a', '#ffb45a'] : ['#ffd27a', '#fff2c8'], n: 46, speed: 90, grav: -40, life: 1.1, size: 9 }))
    this.bannerT = kind === 'boss' ? 4 : 3.6
  }

  tip(html: string): void {
    this.el.tip.innerHTML = `<small>Field note</small>${html}`
    this.el.tip.classList.add('on')
    this.tipT = 10
  }

  showVictory(): void {
    const p = this.game!.progress
    const hunts = Object.values(p.hunts).reduce((a, b) => a + (b ?? 0), 0)
    this.el.stats.innerHTML = [
      ['Time on the island', fmtTime(p.playTime)],
      ['Creatures hunted', String(hunts)],
      ['Apex beasts', `${Number(p.bosses.ruinhorn) + Number(p.bosses.vulkarr)} / 2`],
      ['Items crafted', String(p.crafted)],
      ['Times carried home', String(p.faints)],
      ['Regions explored', `${p.regions.length} / 3`],
    ]
      .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
      .join('')
    this.show('victory')
  }

  // ─── Per-frame HUD ───────────────────────────────────────────────────────

  /** Held-item hotbar: weapon / hatchet / pick / fists. Rebuilt only when its contents change. */
  private updateHotbar(g: Game): void {
    const p = g.progress
    const w = GEAR[p.weapon]
    const sling = weaponClass(p.weapon) === 'sling'
    const key = `${p.held}|${p.weapon}|${p.owned.includes('flintHatchet')}|${p.owned.includes('flintPick')}|${sling ? count(p, 'stone') : ''}`
    const E = this.el
    if (key !== this.hotbarKey) {
      this.hotbarKey = key
      const slot = (id: string, n: number, img: string, name: string, own: boolean) =>
        `<div class="hslot ${p.held === id ? 'on' : ''} ${own ? '' : 'locked'}" data-slot="${id}" title="${esc(name)}"><img src="${img}" alt="" draggable="false" width="44" height="44"><kbd>${n}</kbd><small>${esc(own ? name : 'Craft at camp')}</small></div>`
      E.hotbar.innerHTML =
        slot('weapon', 1, PAINTED_GEAR.has(w.id) ? `./ui/icons/${w.id}.webp` : './ui/icons/gear-weapon.webp', w.name, true).replace('</div>', sling ? `<b class="ammo ${count(p, 'stone') ? '' : 'empty'}">${count(p, 'stone')}</b></div>` : '</div>') +
        slot('flintHatchet', 2, './ui/icons/flintHatchet.webp', 'Flint Hatchet', p.owned.includes('flintHatchet')) +
        slot('flintPick', 3, './ui/icons/flintPick.webp', 'Flint Pick', p.owned.includes('flintPick')) +
        slot('hands', 4, './ui/icons/hands.webp', 'Bare Hands', true)
      if (this.lastHeld && this.lastHeld !== p.held) {
        const el = E.hotbar.querySelector('.hslot.on')
        if (el) {
          const [x, y] = this.fx.at(el)
          this.fx.burst(x, y, { color: ['#ffe6a0', '#ffb23e', '#fff8e0'], n: 22, speed: 170, kind: 'star', grav: 60, life: 0.7 })
          this.fx.ring(x, y, '#ffd27a', 44, 0.4)
        }
      }
      this.lastHeld = p.held
    }
  }

  /** Chop/mine progress: appears on each strike, drains as the tree/boulder weakens. */
  private updateHarvestBar(g: Game): void {
    const h = g.harvestInfo
    const E = this.el
    const show = h.t < 1.6
    E.hbar.classList.toggle('show', show)
    if (!show) {
      this.lastHFrac = 1
      return
    }
    if (h.t < 0.02 || h.frac !== this.lastHFrac) {
      E.hbarName.textContent = h.label
      E.hbarFill.style.width = `${Math.max(0, h.frac) * 100}%`
      E.hbarNote.textContent = h.frac <= 0 ? (h.kind === 'tree' ? 'Timber!' : 'Shattered!') : h.slow ? (h.kind === 'tree' ? 'Slow: a hatchet bites deeper' : 'Slow: a pick cracks it faster') : ''
      E.hbar.classList.toggle('slow', h.slow)
      E.hbar.classList.toggle('rock', h.kind === 'rock')
      E.hbar.classList.remove('pulse')
      void E.hbar.offsetWidth
      E.hbar.classList.add('pulse')
      if (h.frac <= 0) {
        const [x, y] = this.fx.at(E.hbarFill, 0, 0.5)
        this.fx.burst(x, y, { color: h.kind === 'tree' ? ['#ffd9a0', '#c99a62', '#9ad26a'] : ['#e8ecf4', '#cfc3ae', '#fff0c8'], n: 26, speed: 190, kind: 'star', grav: 120, life: 0.8 })
      }
      window.setTimeout(() => (E.hbarLost.style.width = `${Math.max(0, h.frac) * 100}%`), 260)
      this.lastHFrac = h.frac
    }
  }

  /** HUD keep-out rectangles (screen px), refreshed on resize: markers never sit on top of them. */
  private hudRects: { l: number; t: number; r: number; b: number; up: boolean }[] = []
  private hudRectsKey = ''
  private hudRectsAt = 0
  private avoidHud(x: number, y: number): [number, number] {
    // Re-measure on resize and about once a second (the objective panel and hotbar change size).
    const now = performance.now()
    const key = `${innerWidth}x${innerHeight}`
    if (key !== this.hudRectsKey || this.hudRects.length === 0 || now - this.hudRectsAt > 1000) {
      this.hudRectsKey = key
      this.hudRectsAt = now
      const pad = 12
      this.hudRects = []
      for (const k of ['compass', 'region', 'hotbar', 'gadget', 'obj', 'hpBar', 'hungerBar', 'medHeart'] as const) {
        const el = (this.el as unknown as Record<string, HTMLElement | undefined>)[k]
        if (!el || !el.isConnected) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        this.hudRects.push({ l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad, up: r.top > innerHeight / 2 })
      }
    }
    // Resolve a few times in case pushing out of one box lands in another.
    for (let i = 0; i < 3; i++) {
      let moved = false
      for (const R of this.hudRects) {
        // The marker's diamond sits ~20px above its anchor and its distance label ~38px below.
        if (x > R.l && x < R.r && y > R.t - 38 && y < R.b + 20) {
          y = R.up ? R.t - 38 : R.b + 20
          moved = true
        }
      }
      if (!moved) break
    }
    return [x, y]
  }
  frame(dt: number): void {
    const g = this.game
    if (!g) return
    if (this.bannerT > 0) {
      this.bannerT -= dt
      if (this.bannerT <= 0) this.el.banner.classList.remove('on')
    }
    if (this.tipT > 0) {
      this.tipT -= dt
      if (this.tipT <= 0) this.el.tip.classList.remove('on')
    }
    if (this.toastT > 0) {
      this.toastT -= dt
      if (this.toastT <= 0) this.el.toast.classList.remove('on')
    }
    if (this.stampT > 0) {
      this.stampT -= dt
      if (this.stampT <= 0) this.el.stamp.classList.remove('on')
    }
    if (this.jnoteT > 0) {
      this.jnoteT -= dt
      if (this.jnoteT <= 0) this.el.jnote.classList.remove('on')
    }
    this.whiteT = Math.max(0, this.whiteT - dt * 1.4)
    this.el.whiteout.style.opacity = String(this.whiteT)
    if (this.sear && !this.sear.done) {
      // The satchel pauses the sim (dt = 0), so the gauge runs on wall-clock time. Clamp per-frame
      // advance so a frame hitch can never skip the gold band or burn the meal.
      const now = performance.now()
      const real = this.searClock ? (now - this.searClock) / 1000 : 0
      this.searClock = now
      this.sear.t += Math.min(Math.max(dt, real), 1 / 15)
      const n = this.root.querySelector<HTMLElement>('[data-sneedle]')
      const x = this.searPos(this.sear.t)
      if (n) {
        n.style.left = `${x * 100}%`
        n.classList.toggle('burn', this.sear.t > 1.25)
      }
      if (this.sear.t >= 2.5) this.stopSear()
    }
    for (const f of this.feed) {
      f.t += dt
      f.el.style.opacity = String(Math.max(0, Math.min(1, (4 - f.t) / 0.6)))
    }
    this.feed = this.feed.filter(f => (f.t < 4 ? true : (f.el.remove(), false)))
    // Popups follow their world position.
    for (const p of this.popups) {
      p.t += dt
      const k = p.t / p.life
      const s = g.project(p.pos.clone().setY(p.pos.y + k * 1.2))
      p.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%) scale(${k < 0.12 ? 0.6 + k * 4 : 1})`
      p.el.style.opacity = s.behind ? '0' : String(Math.min(1, (1 - k) * 3))
    }
    this.popups = this.popups.filter(p => (p.t < p.life ? true : (p.el.remove(), false)))
    if (this.screen === 'hud' || this.screen === 'menu' || this.screen === 'faint') this.hud(dt, g)
    if (this.mapOpen) {
      this.mapDrawT -= dt
      if (this.mapDrawT <= 0) {
        this.mapDrawT = 0.12
        this.drawMap(g)
      }
    }
    if (this.screen === 'victory' || g.mode === 'victory') {
      this.victoryT -= dt
      if (this.victoryT <= 0) {
        this.victoryT = 0.35 + Math.random() * 0.4
        const x = innerWidth * (0.1 + Math.random() * 0.8)
        const y = innerHeight * (0.1 + Math.random() * 0.4)
        this.fx.burst(x, y, { color: ['#ffd27a', '#ff7a3a', '#fff2c8', '#ffb45a'], n: 48, speed: 360, kind: 'star', grav: 180, life: 1.4, size: 11 })
        this.fx.ring(x, y, '#ffc062', 90, 0.6)
      }
    }
    this.fx.update(dt)
  }

  private hud(dt: number, g: Game): void {
    const P = g.player
    const E = this.el
    const p = g.progress
    E.hpFill.style.width = `${(P.hp / P.maxHp) * 100}%`
    E.hpLost.style.width = `${(Math.max(P.hp, P.recentHp) / P.maxHp) * 100}%`
    E.hpText.textContent = `${Math.ceil(P.hp)} / ${P.maxHp}`
    E.hungerFill.style.width = `${p.hunger}%`
    E.hungerText.textContent = `HUNGER ${Math.ceil(p.hunger)}%`
    E.hungerBar.classList.toggle('low', p.hunger < 35)
    E.hungerBar.classList.toggle('critical', p.hunger <= 10)
    const pot = g.progress.inv.poultice ?? 0
    if (this.lastPot >= 0 && pot < this.lastPot) {
      const [x, y] = this.fx.at(E.medHeart)
      this.fx.burst(x, y, { color: ['#9dff9a', '#e6ffe0', '#5ad07a'], n: 30, speed: 200, kind: 'star', grav: -80, life: 1 })
      this.fx.ring(x, y, '#9dff9a', 60, 0.6)
    }
    this.lastPot = pot
    if (this.lastHp >= 0 && P.hp > this.lastHp + 5) E.medHeart.classList.add('heal')
    else if (P.hp < P.maxHp) E.medHeart.classList.remove('heal')
    this.lastHp = P.hp
    E.medHeart.classList.toggle('low', P.hp < P.maxHp * 0.3 && P.alive)
    E.potN.textContent = String(g.progress.inv.poultice ?? 0)
    this.updateHotbar(g)
    this.updateHarvestBar(g)
    this.updateGadget(g)
    this.updateMeal(g)
    const exposed = g.heat > 0.05 && !P.stats.heatProof
    E.heatChip.hidden = !exposed
    E.vHeat.style.opacity = String(g.heat > 0.05 ? (exposed ? 0.35 + g.heat * 0.5 : 0.15) : 0)
    this.hurtT = Math.max(0, this.hurtT - dt * 1.8)
    E.vHurt.style.opacity = String(this.hurtT)
    E.vLow.style.opacity = P.hp < P.maxHp * 0.3 && P.alive ? String(0.35 + Math.sin(performance.now() / 180) * 0.2) : '0'
    // Boss bar
    const b = g.boss
    if (b && b.alive) {
      E.boss.hidden = false
      E.bossName.textContent = b.def.name
      E.bossTitle.textContent = b.def.title
      E.bossFill.style.width = `${(b.hp / b.maxHp) * 100}%`
      E.bossLost.style.width = `${(b.hp / b.maxHp) * 100}%`
      const tag = b.state === 'stagger' ? 'STAGGERED' : b.open ? 'OPEN' : b.enraged ? 'ENRAGED' : ''
      E.bossTag.textContent = tag
      E.bossTag.className = `tag ${tag === 'ENRAGED' ? 'rage' : tag ? 'open' : ''}`
    } else E.boss.hidden = true
    // Target panel (small creatures)
    const t = g.focusTarget
    if (t && t.alive && !t.def.boss) {
      E.target.hidden = false
      E.tName.textContent = t.def.name
      E.tFill.style.width = `${(t.hp / t.maxHp) * 100}%`
      const tag = t.state === 'stagger' ? 'STAGGERED' : t.open ? 'OPEN' : t.state === 'windup' ? 'ATTACKING' : ''
      E.tTag.textContent = tag
      E.tTag.className = `tag ${tag === 'ATTACKING' ? 'rage' : tag ? 'open' : ''}`
    } else E.target.hidden = true
    // Objective
    const o = g.objective()
    const key = `${o.id}|${o.detail}|${o.ready}`
    if (key !== this.lastObjective) {
      if (this.lastObjective && this.lastObjective.split('|')[0] !== o.id) {
        this.objectiveFlash = 1.5
        g.audio.play('craft', 0.6)
        requestAnimationFrame(() => this.fx.outline(this.el.obj, { color: ['#ffd27a', '#fff2c8', '#9dff9a'], n: 60, speed: 120, grav: -20, life: 1.2, kind: 'star' }))
      }
      this.lastObjective = key
      E.objStep.textContent = o.id === 'victory' ? 'Complete' : `Objective ${o.step} / ${o.total}`
      E.objTitle.textContent = o.title
      E.objDetail.textContent = o.ready ? 'Ready — return to the camp hearth' : o.detail
      E.obj.classList.toggle('ready', o.ready)
    }
    this.objectiveFlash = Math.max(0, this.objectiveFlash - dt)
    E.obj.classList.toggle('flash', this.objectiveFlash > 0)
    const op = g.objectivePos()
    if (op && g.mode === 'playing') {
      const d = Math.hypot(op.x - P.pos.x, op.z - P.pos.z)
      E.objDist.textContent = `${Math.round(d)} m`
      const s = g.project(op)
      const W = innerWidth
      const H = innerHeight
      let x = s.x
      let y = s.y
      const off = s.behind || x < 40 || x > W - 40 || y < 70 || y > H - 70
      if (s.behind) {
        x = W - x
        y = H - 70
      }
      x = Math.max(40, Math.min(W - 40, x))
      y = Math.max(70, Math.min(H - 70, y))
      ;[x, y] = this.avoidHud(x, y)
      E.marker.style.transform = `translate(${x}px, ${y}px)`
      E.marker.classList.toggle('edge', off)
      E.marker.style.display = d < 4 ? 'none' : ''
      E.markerDist.textContent = `${Math.round(d)}m`
    } else {
      E.marker.style.display = 'none'
      E.objDist.textContent = ''
    }
    // Compass: ring shows north, needle points at the objective (relative to the camera).
    const yaw = g.cam.yaw
    E.compassRing.style.transform = `rotate(${yaw - Math.PI}rad)`
    if (op && g.mode === 'playing') {
      const bearing = Math.atan2(op.x - P.pos.x, op.z - P.pos.z)
      E.needle.style.transform = `rotate(${yaw - bearing}rad)`
      E.needle.style.opacity = '1'
      E.compassDist.textContent = `${Math.round(Math.hypot(op.x - P.pos.x, op.z - P.pos.z))}m`
    } else {
      E.needle.style.opacity = '0'
      E.compassDist.textContent = ''
    }
    // Tracked beast: second compass needle + on-screen pin
    const tp = g.trackPos
    if (tp && g.mode === 'playing') {
      const td = Math.hypot(tp.x - P.pos.x, tp.z - P.pos.z)
      const bearing = Math.atan2(tp.x - P.pos.x, tp.z - P.pos.z)
      E.needle2.style.transform = `rotate(${yaw - bearing}rad)`
      E.needle2.style.opacity = '1'
      const s = g.project(tp)
      const vis = !s.behind && s.x > 30 && s.x < innerWidth - 30 && s.y > 60 && s.y < innerHeight - 60 && td > 8
      E.tmarker.style.display = vis ? '' : 'none'
      if (vis) {
        const [tx, ty] = this.avoidHud(s.x, s.y)
        E.tmarker.style.transform = `translate(${tx}px, ${ty}px)`
        E.tmarkerDist.textContent = `${Math.round(td)}m`
      }
    } else {
      E.needle2.style.opacity = '0'
      E.tmarker.style.display = 'none'
    }
    // Lock-on reticle
    if (g.lockTarget) {
      const s = g.project(g.lockTarget.center(new THREE.Vector3()))
      E.reticle.hidden = s.behind
      E.reticle.style.transform = `translate(${s.x}px, ${s.y}px)`
      E.reticle.classList.toggle('open', g.lockTarget.open)
    } else E.reticle.hidden = true
    // Interact prompt
    const it = g.interact
    const promptKey = it ? `${it.verb}|${it.label}|${it.enabled}` : ''
    if (promptKey !== this.lastPrompt) {
      this.lastPrompt = promptKey
      E.prompt.classList.toggle('on', !!it && g.mode === 'playing')
      if (it) {
        E.promptVerb.textContent = it.verb
        E.promptLabel.textContent = it.label
        E.prompt.classList.toggle('disabled', !it.enabled)
      }
    }
    if (!it || g.mode !== 'playing' || P.busy) E.prompt.classList.remove('on')
    else if (it) E.prompt.classList.add('on')
    E.clickLook.classList.toggle('on', g.mode === 'playing' && !document.pointerLockElement && this.screen === 'hud' && !this.mapOpen && !this.helpOpen)
    E.region.textContent = REGION_NAMES[g.region]
  }

  private updateGadget(g: Game): void {
    const p = g.progress
    const gd = p.gadget
    const n = count(p, gd)
    const key = `${gd}|${n}`
    if (key === this.gadgetKey) return
    const E = this.el
    const changed = this.gadgetKey && this.gadgetKey.split('|')[0] !== gd
    const used = this.gadgetKey && this.gadgetKey.split('|')[0] === gd && Number(this.gadgetKey.split('|')[1]) > n
    this.gadgetKey = key
    E.gadgetImg.setAttribute('src', `./ui/icons/${gd}.webp`)
    E.gadgetN.textContent = String(n)
    E.gadgetName.textContent = ITEMS[gd].name
    E.gadget.classList.toggle('empty', n === 0)
    if (changed || used) {
      const [x, y] = this.fx.at(E.gadget)
      this.fx.burst(x, y, { color: gd === 'flashPod' ? ['#ffffff', '#fff6c8', '#bfe8ff'] : ['#d8ff9a', '#fff2c8', '#9ad26a'], n: used ? 26 : 16, speed: 200, kind: 'star', grav: 80, life: 0.7 })
      E.gadget.classList.remove('bump')
      void E.gadget.offsetWidth
      E.gadget.classList.add('bump')
    }
  }

  private updateMeal(g: Game): void {
    const m = g.progress.meal
    const E = this.el
    const key = m ? `${m.id}|${m.q}` : ''
    if (key !== this.mealKey) {
      if (this.mealKey && !m) {
        const [x, y] = this.fx.at(E.mealChip)
        this.fx.burst(x, y, { color: ['#8a6a50', '#d8c6a0'], n: 14, speed: 120, kind: 'dot', grav: -40, life: 0.9 })
      }
      this.mealKey = key
      E.mealChip.hidden = !m
      if (m) {
        E.mealImg.setAttribute('src', `./ui/icons/${m.id}.webp`)
        E.mealName.textContent = MEALS[m.id].name
        E.mealChip.className = `chip meal q-${m.q}`
        E.mealChip.title = `${MEALS[m.id].name}: ${MEALS[m.id].desc}`
      }
    }
    if (m) {
      E.mealRing.style.setProperty('--f', String(Math.max(0, m.t / m.max)))
      E.mealT.textContent = `${Math.floor(m.t / 60)}:${String(Math.floor(m.t % 60)).padStart(2, '0')}`
      E.mealChip.classList.toggle('ending', m.t < 30)
    }
  }

  private drawMap(g: Game): void {
    const c = this.el.mapCanvas as HTMLCanvasElement
    const x = c.getContext('2d')!
    const S = c.width
    const half = WORLD.half
    const toMap = (wx: number, wz: number): [number, number] => [((wx + half) / (2 * half)) * S, ((wz + half) / (2 * half)) * S]
    const explored = new Set(g.progress.explored)
    const cell = (half * 2) / MAP_GRID
    const cellAt = (wx: number, wz: number): number => {
      const ix = Math.max(0, Math.min(MAP_GRID - 1, Math.floor((wx + half) / cell)))
      const iz = Math.max(0, Math.min(MAP_GRID - 1, Math.floor((wz + half) / cell)))
      return iz * MAP_GRID + ix
    }
    const isExplored = (wx: number, wz: number) => explored.has(cellAt(wx, wz))
    const charted = g.progress.explored.length
    this.el.mapMeta.textContent = `${charted} of ${MAP_GRID * MAP_GRID} charted cells · ${g.progress.regions.length} of 3 regions discovered`

    // A warm, paper-first base keeps unknown country visibly blank.
    x.imageSmoothingEnabled = true
    x.fillStyle = '#d7b982'
    x.fillRect(0, 0, S, S)
    for (let i = 0; i < 2200; i += 1) {
      const px = (i * 97) % S
      const py = (i * 53 + (i % 17) * 11) % S
      x.fillStyle = i % 7 === 0 ? 'rgba(90,52,25,.11)' : 'rgba(255,245,205,.09)'
      x.fillRect(px, py, i % 5 === 0 ? 2 : 1, 1)
    }
    // Reveal only cells the player has walked near; all other terrain remains paper.
    x.save()
    x.beginPath()
    for (const key of explored) {
      const ix = key % MAP_GRID
      const iz = Math.floor(key / MAP_GRID)
      x.rect(ix * S / MAP_GRID, iz * S / MAP_GRID, S / MAP_GRID + 0.5, S / MAP_GRID + 0.5)
    }
    x.clip()
    x.drawImage(g.mapImage(), 0, 0, S, S)
    x.restore()
    // Survey grid and a faded border echo a hand-drawn field chart.
    x.strokeStyle = 'rgba(87,52,24,.16)'
    x.lineWidth = 1
    for (let i = 1; i < MAP_GRID; i += 1) {
      const q = i * S / MAP_GRID
      x.beginPath(); x.moveTo(q, 0); x.lineTo(q, S); x.stroke()
      x.beginPath(); x.moveTo(0, q); x.lineTo(S, q); x.stroke()
    }
    x.strokeStyle = '#70451f'
    x.lineWidth = 5
    x.strokeRect(4, 4, S - 8, S - 8)
    x.strokeStyle = 'rgba(112,69,31,.45)'
    x.lineWidth = 1
    x.strokeRect(12, 12, S - 24, S - 24)

    const label = (t: string, wx: number, wz: number, size = 14, alpha = 1) => {
      const [mx, my] = toMap(wx, wz)
      x.save()
      x.globalAlpha = alpha
      x.textAlign = 'center'
      x.font = `700 ${size}px Georgia, serif`
      x.fillStyle = 'rgba(59,34,16,.45)'
      x.fillText(t, mx + 1.5, my + 1.5)
      x.fillStyle = '#4d2e16'
      x.fillText(t, mx, my)
      x.restore()
    }
    const regionTitle = (id: 'coast' | 'highlands' | 'caldera', wx: number, wz: number) => {
      const seen = g.progress.regions.includes(id)
      label(REGION_NAMES[id].toUpperCase(), wx, wz, seen ? 16 : 12, seen ? 0.9 : 0.42)
    }
    regionTitle('coast', 10, 190)
    regionTitle('highlands', 80, -20)
    regionTitle('caldera', -20, -240)

    // Old routes appear only where both ends have been charted.
    x.save()
    x.strokeStyle = 'rgba(91,55,25,.6)'
    x.lineWidth = 2
    x.setLineDash([7, 7])
    for (const path of PATHS) {
      x.beginPath()
      let started = false
      for (const [wx, wz] of path) {
        if (!isExplored(wx, wz)) { started = false; continue }
        const [mx, my] = toMap(wx, wz)
        if (!started) { x.moveTo(mx, my); started = true } else x.lineTo(mx, my)
      }
      x.stroke()
    }
    x.restore()

    const marker = (name: string, wx: number, wz: number, kind: 'poi' | 'camp' | 'boss') => {
      if (kind !== 'camp' && !isExplored(wx, wz)) return
      const [mx, my] = toMap(wx, wz)
      x.save()
      x.translate(mx, my)
      x.strokeStyle = '#422510'
      x.lineWidth = 2
      x.fillStyle = kind === 'camp' ? '#e8a52d' : kind === 'boss' ? '#9f3423' : '#e7d29b'
      x.beginPath()
      if (kind === 'camp') { x.moveTo(0, -9); x.lineTo(9, 7); x.lineTo(-9, 7) } else if (kind === 'boss') x.arc(0, 0, 7, 0, Math.PI * 2)
      else { x.moveTo(0, -7); x.lineTo(7, 0); x.lineTo(0, 7); x.lineTo(-7, 0); x.closePath() }
      x.fill(); x.stroke()
      x.restore()
      label(name, wx, wz + 17, 11, 0.95)
    }
    marker('CAMP', CAMP.x, CAMP.z, 'camp')
    marker('SUNKEN RUINS', POI.ruins.x, POI.ruins.z, 'poi')
    marker('OLD CANOPY', POI.elderTree.x, POI.elderTree.z, 'poi')
    marker('SEA ARCH', POI.seaArch.x, POI.seaArch.z, 'poi')
    marker('STEAM VENTS', POI.steamvents.x, POI.steamvents.z, 'poi')
    marker('STONE FINGERS', POI.stonefingers.x, POI.stonefingers.z, 'poi')
    marker('WYRM CRATER', ARENAS.wyrm.x, ARENAS.wyrm.z, 'boss')
    marker('RIBS OF THE OLD ONE', POI.ribs.x, POI.ribs.z, 'poi')

    const op = g.objectivePos()
    if (op && isExplored(op.x, op.z)) {
      const [ox, oy] = toMap(op.x, op.z)
      x.save(); x.translate(ox, oy); x.rotate(Math.PI / 4)
      x.strokeStyle = '#205c63'; x.lineWidth = 3; x.strokeRect(-7, -7, 14, 14); x.restore()
    }
    const tp = g.trackPos
    if (tp && isExplored(tp.x, tp.z)) {
      const [tx, ty] = toMap(tp.x, tp.z)
      x.strokeStyle = '#39752c'; x.lineWidth = 3
      x.beginPath(); x.arc(tx, ty, 10, 0, Math.PI * 2); x.stroke()
      if (g.trackSp) label(SPECIES[g.trackSp].name, tp.x, tp.z + 16, 11)
    }
    // Player pointer: a clear ink arrow with a small halo so it reads over terrain.
    const P = g.player
    const [px, py] = toMap(P.pos.x, P.pos.z)
    x.save(); x.translate(px, py); x.rotate(-P.yaw + Math.PI)
    x.fillStyle = '#fff4c8'; x.strokeStyle = '#2b180c'; x.lineWidth = 3
    x.beginPath(); x.moveTo(0, -13); x.lineTo(9, 10); x.lineTo(0, 6); x.lineTo(-9, 10); x.closePath(); x.fill(); x.stroke(); x.restore()
  }
}
