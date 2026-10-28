import './styles/lab.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { SPECIES, ITEMS, type SpeciesId, type AttackDef } from './game/data'
import { Creature, type CreatureCtx, type HitResult, type PlayerLike } from './game/creatures'
import { Telegraphs, type Ground } from './game/telegraphs'
import { Fx } from './game/fx'
import { REGION_NAMES } from './game/terrain'

/**
 * Enemy model laboratory (/enemies): inspect every creature rig in isolation — default
 * rotation/quaternion, bounds, stats, and play each telegraphed attack against a dummy.
 */
const flat: Ground = {
  heightAt: () => 0,
  surfaceAt: () => 0,
  walkable: (x, z) => Math.abs(x) < 60 && Math.abs(z) < 60,
  canStep: (_ax, _az, bx, bz) => Math.abs(bx) < 60 && Math.abs(bz) < 60,
}

class Dummy implements PlayerLike {
  readonly pos = new THREE.Vector3(0, 0, 8)
  readonly radius = 0.55
  alive = true
  invulnerable = false
  readonly mesh: THREE.Group
  private flashT = 0
  private readonly mat = new THREE.MeshStandardMaterial({ color: '#d9b48a', roughness: 0.8 })
  constructor(private readonly log: (s: string, kind?: string) => void) {
    this.mesh = new THREE.Group()
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.0, 4, 10), this.mat)
    body.position.y = 0.95
    body.castShadow = true
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), this.mat)
    head.position.y = 1.85
    head.castShadow = true
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.58, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#7df9ff' }))
    ring.position.y = 0.02
    this.mesh.add(body, head, ring)
  }
  receiveHit(damage: number, knock: 'flinch' | 'down', _from: { x: number; z: number }, source: string): HitResult {
    if (this.invulnerable) {
      this.log(`Dodged ${source} (i-frames)`, 'dodge')
      return 'dodged'
    }
    this.flashT = 0.35
    this.log(`HIT by ${source}: ${Math.round(damage)} dmg · ${knock === 'down' ? 'knockdown' : 'flinch'}`, 'hit')
    return 'hit'
  }
  update(dt: number): void {
    this.flashT = Math.max(0, this.flashT - dt)
    this.mat.emissive.setRGB(this.flashT * 2.5, 0, 0)
    this.mesh.position.copy(this.pos)
  }
}

const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1)
const f3 = (n: number) => (Math.abs(n) < 5e-5 ? 0 : n).toFixed(4)
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function shapeText(a: AttackDef): string {
  const s = a.shape as Record<string, unknown> & { kind: string }
  const parts = Object.entries(s).filter(([k]) => k !== 'kind').map(([k, v]) => `${k} ${typeof v === 'number' ? +v.toFixed(2) : String(v)}`)
  return `${s.kind}${parts.length ? ` (${parts.join(', ')})` : ''}`
}

function main(): void {
  const root = document.getElementById('lab')!
  const ids = Object.keys(SPECIES) as SpeciesId[]
  root.innerHTML = `
  <aside class="side">
    <header><a href="../" class="back">← Game</a><h1>Enemy Lab</h1><p>Inspect models, default orientation, telegraphs and stats.</p></header>
    <nav class="species">${ids.map(id => `<button data-sp="${id}"><b>${esc(SPECIES[id].name)}</b><small>${SPECIES[id].boss ? '<em>Apex</em> · ' : ''}${esc(REGION_NAMES[SPECIES[id].region])}</small></button>`).join('')}</nav>
    <section class="view">
      <h3>View</h3>
      <label><input type="checkbox" data-opt="axes" checked> Axes &amp; forward arrow</label>
      <label><input type="checkbox" data-opt="radius" checked> Body radius ring</label>
      <label><input type="checkbox" data-opt="bounds"> Bounding box</label>
      <label><input type="checkbox" data-opt="wire"> Wireframe</label>
      <label><input type="checkbox" data-opt="spin"> Turntable</label>
      <label><input type="checkbox" data-opt="dummy" checked> Target dummy</label>
      <label><input type="checkbox" data-opt="iframes"> Dummy invulnerable (dodge)</label>
      <label class="range">Yaw <input type="range" min="-180" max="180" step="1" value="0" data-opt="yaw"><output data-el="yawOut">0°</output></label>
      <label class="range">Dummy distance <input type="range" min="1" max="30" step="0.5" value="8" data-opt="dist"><output data-el="distOut">8 m</output></label>
      <label class="range">Time scale <input type="range" min="0.1" max="1.5" step="0.05" value="1" data-opt="speed"><output data-el="speedOut">1×</output></label>
    </section>
  </aside>
  <main class="stage">
    <canvas data-el="canvas"></canvas>
    <div class="state"><b data-el="stateName">idle</b><div class="timeline" data-el="timeline"><i class="w"></i><i class="a"></i><i class="r"></i><span data-el="playhead"></span></div><small data-el="stateInfo"></small></div>
    <div class="log" data-el="log"></div>
  </main>
  <aside class="info">
    <header><h2 data-el="name"></h2><p data-el="title"></p></header>
    <section><h3>Default transform</h3><table class="kv" data-el="xform"></table></section>
    <section><h3>Stats</h3><table class="kv" data-el="stats"></table></section>
    <section><h3>Actions</h3><div class="btns" data-el="actions"></div></section>
    <section><h3>Attacks &amp; telegraphs</h3><div data-el="attacks"></div></section>
    <section><h3>Drops</h3><div data-el="drops"></div></section>
    <section><h3>Field notes</h3><p class="lore" data-el="lore"></p></section>
  </aside>`
  const el = (k: string) => root.querySelector<HTMLElement>(`[data-el="${k}"]`)!
  const canvas = el('canvas') as HTMLCanvasElement

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(2, devicePixelRatio))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#9fc7d6')
  scene.fog = new THREE.Fog('#9fc7d6', 60, 140)
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400)
  camera.position.set(9, 6, 12)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.target.set(0, 1.2, 0)
  scene.add(new THREE.HemisphereLight('#e8f4ff', '#6b5a3a', 1.6))
  const sun = new THREE.DirectionalLight('#fff1d6', 2.6)
  sun.position.set(12, 20, 8)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const sc = sun.shadow.camera
  sc.left = sc.bottom = -25
  sc.right = sc.top = 25
  scene.add(sun)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#8fae6a', roughness: 1 }))
  floor.receiveShadow = true
  scene.add(floor)
  const grid = new THREE.GridHelper(120, 120, '#2d4a22', '#5d7e45')
  ;(grid.material as THREE.Material).transparent = true
  ;(grid.material as THREE.Material).opacity = 0.35
  grid.position.y = 0.01
  scene.add(grid)
  const axes = new THREE.AxesHelper(3)
  axes.position.y = 0.03
  scene.add(axes)
  const fwdArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.05, 0), 4, 0xff3355, 0.6, 0.35)
  scene.add(fwdArrow)
  const radiusRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8 }))
  radiusRing.position.y = 0.02
  scene.add(radiusRing)
  const boxHelper = new THREE.Box3Helper(new THREE.Box3(), 0xffd24a)
  boxHelper.visible = false
  scene.add(boxHelper)

  const fx = new Fx()
  const telegraphs = new Telegraphs(flat)
  scene.add(fx.group, telegraphs.group)
  const logEl = el('log')
  const log = (s: string, kind = 'info') => {
    const d = document.createElement('div')
    d.className = `l-${kind}`
    d.textContent = `${(performance.now() / 1000).toFixed(1)}s  ${s}`
    logEl.prepend(d)
    while (logEl.childElementCount > 40) logEl.lastElementChild!.remove()
  }
  const dummy = new Dummy(log)
  scene.add(dummy.mesh)
  const ctx: CreatureCtx = {
    ground: flat,
    telegraphs,
    fx,
    player: dummy,
    emit: e => log(`event: ${e.type}`, e.type === 'killed' ? 'hit' : 'info'),
  }

  let creature: Creature | null = null
  let yawDeg = 0
  let spin = false
  let timeScale = 1
  let loopAttack: string | null = null
  const opts = { axes: true, radius: true, bounds: false, wire: false }

  const select = (id: SpeciesId, attack?: string) => {
    if (creature) {
      scene.remove(creature.rig.root)
      telegraphs.clear()
    }
    const c = new Creature(id, 0, 0, flat)
    c.puppet = true
    c.yaw = 0
    c.rig.root.traverse(o => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true
    })
    creature = c
    scene.add(c.rig.root)
    yawDeg = 0
    ;(root.querySelector('[data-opt="yaw"]') as HTMLInputElement).value = '0'
    el('yawOut').textContent = '0°'
    loopAttack = null
    for (const b of root.querySelectorAll<HTMLElement>('[data-sp]')) b.classList.toggle('on', b.dataset.sp === id)
    const d = c.def
    el('name').textContent = d.name
    el('title').innerHTML = `${esc(d.title)} · ${esc(REGION_NAMES[d.region])}${d.boss ? ' · <em>Apex beast</em>' : ''}`
    el('stats').innerHTML = [
      ['Health', d.hp], ['Poise (stagger)', d.poise], ['Walk / run', `${d.walk} / ${d.run} m/s`], ['Turn rate', `${d.turn} rad/s`],
      ['Body radius', `${d.radius} m`], ['Height', `${d.height} m`], ['Aggro range', `${d.aggro} m`], ['Leash', `${d.leash} m`], ['Carves', d.carves], ['Weak spot', `${d.weak.label} (${d.weak.zone}) ×${d.weak.mult}`], ['Habitat', d.habitat], ['Prey', d.prey?.length ? d.prey.join(', ') : '—'], ['Footprint', d.print],
    ].map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')
    el('attacks').innerHTML = d.attacks.map(a => `<div class="atk" data-atk="${a.id}">
      <header><b>${esc(a.name)}</b><span class="tags">${a.behind ? '<em>rear</em>' : ''}${a.enragedOnly ? '<em class="rage">enraged</em>' : ''}<em>${a.knock}</em></span>
      <button data-play="${a.id}">Play</button><button data-loop="${a.id}" title="Repeat">Loop</button></header>
      <p>${esc(a.desc)}</p>
      <div class="bar"><i class="w" style="flex:${a.windup}"></i><i class="a" style="flex:${a.active}"></i><i class="r" style="flex:${a.recovery}"></i></div>
      <table class="kv sm"><tr><th>Windup / active / recovery</th><td>${a.windup}s / ${a.active}s / ${a.recovery}s</td></tr>
      <tr><th>Damage</th><td>${a.damage}</td></tr><tr><th>Shape</th><td>${esc(shapeText(a))}</td></tr>
      <tr><th>Range · cooldown</th><td>${a.range[0]}–${a.range[1]} m · ${a.cooldown}s</td></tr><tr><th>Anim · tracking</th><td>${a.anim} · ${a.tracking}</td></tr></table></div>`).join('')
    el('drops').innerHTML = d.bossCarves
      ? `<ol class="drops">${d.bossCarves.map(cv => `<li>${Object.entries(cv).map(([k, n]) => `${n}× ${esc(ITEMS[k as keyof typeof ITEMS].name)}`).join(', ')}</li>`).join('')}</ol>`
      : (() => {
          const total = d.drops.reduce((s2, dr) => s2 + dr.weight, 0)
          return `<ul class="drops">${d.drops.map(dr => `<li>${esc(ITEMS[dr.item].name)} <small>(${Math.round((dr.weight / total) * 100)}% per carve)</small></li>`).join('')}</ul>`
        })()
    el('lore').textContent = d.lore
    el('actions').innerHTML = `
      <button data-act="flinch">Hit (light)</button><button data-act="heavy">Hit (heavy)</button><button data-act="stagger">Force stagger</button>
      <button data-act="enrage">Toggle enrage</button><button data-act="kill">Kill</button><button data-act="reset">Reset</button>`
    // Frame the camera on the model.
    const r = Math.max(4, d.height * 2.4 + d.radius * 1.6)
    controls.target.set(0, d.height * 0.5, 0)
    camera.position.set(r * 0.8, d.height * 0.9 + r * 0.35, r * 1.05)
    sc.left = sc.bottom = -Math.max(25, r * 2)
    sc.right = sc.top = Math.max(25, r * 2)
    sc.updateProjectionMatrix()
    applyWire()
    const url = new URL(location.href)
    url.searchParams.set('species', id)
    url.searchParams.delete('attack')
    history.replaceState(null, '', url)
    log(`selected ${d.name}`)
    if (attack) window.setTimeout(() => play(attack), 300)
  }

  const play = (id: string) => {
    if (!creature) return
    if (!creature.alive) creature.respawn(flat)
    creature.state = 'idle'
    creature.forceAttack(id, ctx)
    const a = creature.def.attacks.find(x => x.id === id)
    if (a) log(`attack: ${a.name}`, 'atk')
  }

  const applyWire = () => {
    creature?.rig.root.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
      if (m && 'wireframe' in m) m.wireframe = opts.wire
    })
  }

  root.addEventListener('click', e => {
    const t = e.target as HTMLElement
    const sp = t.closest<HTMLElement>('[data-sp]')
    if (sp) return select(sp.dataset.sp as SpeciesId)
    const pl = t.closest<HTMLElement>('[data-play]')
    if (pl) {
      loopAttack = null
      return play(pl.dataset.play!)
    }
    const lp = t.closest<HTMLElement>('[data-loop]')
    if (lp) {
      loopAttack = loopAttack === lp.dataset.loop ? null : lp.dataset.loop!
      for (const b of root.querySelectorAll<HTMLElement>('[data-loop]')) b.classList.toggle('on', b.dataset.loop === loopAttack)
      if (loopAttack) play(loopAttack)
      return
    }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act
    if (!act || !creature) return
    const c = creature
    const from = { x: dummy.pos.x, z: dummy.pos.z }
    if (!c.alive && act !== 'reset') c.respawn(flat)
    if (act === 'flinch') {
      const r = c.takeHit(20, 1, false, from, ctx)
      log(`light hit → ${r.dealt} dmg${r.punish ? ' (punish)' : ''}${r.stagger ? ' · STAGGER' : ''}`)
    } else if (act === 'heavy') {
      const r = c.takeHit(20, 2.2, true, from, ctx)
      log(`heavy hit → ${r.dealt} dmg${r.punish ? ' (punish)' : ''}${r.stagger ? ' · STAGGER' : ''}`)
    } else if (act === 'stagger') {
      c.poise = 0.01
      c.takeHit(1, 1, true, from, ctx)
    } else if (act === 'enrage') {
      c.enraged = !c.enraged
      log(`enraged: ${c.enraged}`)
    } else if (act === 'kill') {
      c.takeHit(99999, 1, true, from, ctx)
    } else if (act === 'reset') {
      telegraphs.clear()
      c.respawn(flat)
      c.yaw = (yawDeg * Math.PI) / 180
    }
  })
  root.addEventListener('input', e => {
    const t = e.target as HTMLInputElement
    const o = t.dataset.opt
    if (!o) return
    if (o === 'yaw') {
      yawDeg = Number(t.value)
      el('yawOut').textContent = `${yawDeg}°`
      if (creature) creature.yaw = (yawDeg * Math.PI) / 180
    } else if (o === 'dist') {
      dummy.pos.set(0, 0, Number(t.value))
      el('distOut').textContent = `${t.value} m`
    } else if (o === 'speed') {
      timeScale = Number(t.value)
      el('speedOut').textContent = `${t.value}×`
    } else if (o === 'spin') spin = t.checked
    else if (o === 'dummy') dummy.mesh.visible = t.checked
    else if (o === 'iframes') dummy.invulnerable = t.checked
    else if (o === 'wire') {
      opts.wire = t.checked
      applyWire()
    } else if (o in opts) (opts as Record<string, boolean>)[o] = t.checked
  })

  const resize = () => {
    const r = canvas.getBoundingClientRect()
    renderer.setSize(r.width, r.height, false)
    camera.aspect = r.width / Math.max(1, r.height)
    camera.updateProjectionMatrix()
  }
  new ResizeObserver(resize).observe(canvas)
  resize()

  const box = new THREE.Box3()
  const size = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const eu = new THREE.Euler()
  let last = performance.now()
  let uiT = 0
  const frame = (now: number) => {
    const real = Math.min(0.05, (now - last) / 1000)
    last = now
    const dt = real * timeScale
    const c = creature
    if (c) {
      if (spin && (c.state === 'idle' || c.state === 'dead')) {
        yawDeg = ((yawDeg + dt * 30 + 180) % 360) - 180
        c.yaw = (yawDeg * Math.PI) / 180
      }
      // Keep the creature pinned at the origin between attacks so the transform readout stays meaningful.
      if (c.state === 'idle') {
        c.pos.lerp(new THREE.Vector3(0, 0, 0), 1 - Math.exp(-dt * 3))
        c.yaw += Math.atan2(Math.sin((yawDeg * Math.PI) / 180 - c.yaw), Math.cos((yawDeg * Math.PI) / 180 - c.yaw)) * (1 - Math.exp(-dt * 6))
      }
      c.update(dt, ctx)
      if (c.state === 'gone' || c.state === 'sinking') {
        if (c.state === 'gone') c.respawn(flat)
      }
      if (loopAttack && c.state === 'idle' && c.alive) play(loopAttack)
      const R = c.rig.root
      fwdArrow.position.set(c.pos.x, 0.06, c.pos.z)
      fwdArrow.setDirection(c.forward)
      fwdArrow.visible = axes.visible = opts.axes
      axes.position.set(c.pos.x, 0.03, c.pos.z)
      radiusRing.visible = opts.radius
      radiusRing.position.set(c.pos.x, 0.02, c.pos.z)
      radiusRing.scale.setScalar(c.def.radius)
      box.setFromObject(R)
      ;(boxHelper as unknown as { box: THREE.Box3 }).box.copy(box)
      boxHelper.visible = opts.bounds
      uiT -= real
      if (uiT <= 0) {
        uiT = 0.1
        R.getWorldQuaternion(q)
        eu.setFromQuaternion(q, 'YXZ')
        box.getSize(size)
        let tris = 0
        let meshes = 0
        R.traverse(o => {
          const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
          if ((o as THREE.Mesh).isMesh && g) {
            meshes += 1
            tris += (g.index ? g.index.count : g.attributes.position.count) / 3
          }
        })
        el('xform').innerHTML = [
          ['Root rotation (YXZ, deg)', `x ${deg(eu.x)} · y ${deg(eu.y)} · z ${deg(eu.z)}`],
          ['Root quaternion (x, y, z, w)', `${f3(q.x)}, ${f3(q.y)}, ${f3(q.z)}, ${f3(q.w)}`],
          ['Logical yaw', `${deg(c.yaw)}° (forward = +Z at 0°)`],
          ['Forward vector', `${f3(c.forward.x)}, 0, ${f3(c.forward.z)}`],
          ['Position', `${c.pos.x.toFixed(2)}, ${c.pos.y.toFixed(2)}, ${c.pos.z.toFixed(2)}`],
          ['Bounds (w × h × d)', `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m`],
          ['Meshes · triangles', `${meshes} · ${Math.round(tris).toLocaleString()}`],
        ].map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')
        const a = c.attack
        el('stateName').textContent = `${c.state}${c.enraged ? ' · enraged' : ''}${c.open ? ' · OPEN' : ''}`
        el('stateName').className = c.open ? 'open' : c.state === 'windup' ? 'wind' : c.state === 'active' ? 'act' : ''
        el('stateInfo').textContent = `HP ${Math.ceil(c.hp)} / ${c.maxHp} · poise ${c.poise.toFixed(0)} / ${c.poiseMax}${a ? ` · ${a.name}` : ''}`
        const tl = el('timeline')
        if (a && (c.state === 'windup' || c.state === 'active' || c.state === 'recover')) {
          const tel = c.enraged ? 0.88 : 1
          const w = a.windup * tel
          const total = w + a.active + a.recovery
          const [iw, ia, ir] = Array.from(tl.querySelectorAll('i')) as HTMLElement[]
          iw.style.flex = String(w)
          ia.style.flex = String(a.active)
          ir.style.flex = String(a.recovery)
          const tt = c.state === 'windup' ? c.t : c.state === 'active' ? w + c.t : w + a.active + c.t
          el('playhead').style.left = `${Math.min(100, (tt / total) * 100)}%`
          tl.classList.add('on')
        } else tl.classList.remove('on')
      }
    }
    dummy.update(dt)
    telegraphs.update(dt)
    fx.update(dt, canvas.clientHeight * renderer.getPixelRatio())
    controls.update()
    renderer.render(scene, camera)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  const params = new URLSearchParams(location.search)
  const sp = params.get('species') as SpeciesId | null
  select(sp && SPECIES[sp] ? sp : ids[0], params.get('attack') ?? undefined)
  ;(window as unknown as { __lab: unknown }).__lab = {
    select,
    play,
    get creature() {
      return creature
    },
    species: ids,
  }
}

main()
