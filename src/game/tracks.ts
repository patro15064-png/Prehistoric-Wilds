import * as THREE from 'three'
import { SPAWNS, SPECIES, TRACKING, type PrintKind, type SpeciesId } from './data'
import { rng } from './noise'
import type { Creature } from './creatures'

type Ground = { heightAt(x: number, z: number): number; walkable(x: number, z: number): boolean }
type Print = { sp: SpeciesId; x: number; z: number; age: number; slot: number; studied: boolean }
type Clue = { sp: SpeciesId; x: number; z: number; y: number; mesh: THREE.Group; glow: THREE.Sprite; cd: number; kind: 'dung' | 'scored' | 'scales' }
export type StudyTarget = { kind: 'print' | 'clue'; sp: SpeciesId; ref: Print | Clue; x: number; z: number }

const PRINT_KINDS: PrintKind[] = ['hoof', 'webbed', 'talon', 'insect', 'paw', 'giant', 'wyrm']
const PER_KIND = 96
const PRINT_SIZE: Record<PrintKind, number> = { hoof: 0.55, webbed: 0.75, talon: 0.7, insect: 0.6, paw: 0.7, giant: 1.9, wyrm: 1.7 }
const STUDY_COOLDOWN = 25

/** Paint one footprint shape into a small alpha canvas. */
function printTexture(kind: PrintKind): THREE.CanvasTexture {
  const S = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const g = cv.getContext('2d')!
  g.fillStyle = '#fff'
  const blob = (x: number, y: number, rx: number, ry: number, rot = 0) => {
    g.beginPath()
    g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2)
    g.fill()
  }
  const toe = (x: number, y: number, a: number, len: number, w: number) => {
    g.save()
    g.translate(x, y)
    g.rotate(a)
    g.beginPath()
    g.moveTo(-w, 0)
    g.quadraticCurveTo(0, -len * 1.1, w, 0)
    g.closePath()
    g.fill()
    g.restore()
  }
  switch (kind) {
    case 'hoof':
      blob(48, 64, 16, 30, -0.12)
      blob(80, 64, 16, 30, 0.12)
      break
    case 'webbed':
      g.beginPath()
      g.moveTo(64, 96)
      g.lineTo(22, 34)
      g.quadraticCurveTo(44, 46, 64, 22)
      g.quadraticCurveTo(84, 46, 106, 34)
      g.closePath()
      g.fill()
      break
    case 'talon':
      blob(64, 88, 14, 16)
      toe(64, 80, 0, 58, 7)
      toe(60, 82, -0.55, 44, 6)
      toe(68, 82, 0.55, 44, 6)
      break
    case 'insect':
      for (let i = 0; i < 3; i += 1) {
        blob(34, 34 + i * 30, 9, 7)
        blob(94, 34 + i * 30, 9, 7)
      }
      break
    case 'paw':
      blob(64, 80, 24, 20)
      blob(36, 44, 10, 13, -0.3)
      blob(54, 32, 10, 13, -0.1)
      blob(74, 32, 10, 13, 0.1)
      blob(92, 44, 10, 13, 0.3)
      break
    case 'giant':
      blob(64, 84, 34, 30)
      toe(64, 64, 0, 56, 14)
      toe(54, 70, -0.6, 48, 13)
      toe(74, 70, 0.6, 48, 13)
      break
    case 'wyrm':
      blob(64, 78, 30, 34)
      for (const a of [-0.8, -0.3, 0.3, 0.8]) toe(64 + a * 26, 54, a * 0.8, 44, 9)
      break
  }
  // Soft edge: blur by redrawing with low alpha.
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function glowTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  const g = cv.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,248,210,1)')
  grad.addColorStop(0.35, 'rgba(255,236,160,0.45)')
  grad.addColorStop(1, 'rgba(255,230,140,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(cv)
}

function clueModel(kind: Clue['kind'], color: string): THREE.Group {
  const g = new THREE.Group()
  if (kind === 'dung') {
    const m = new THREE.MeshStandardMaterial({ color: '#4a3422', roughness: 1 })
    for (let i = 0; i < 4; i += 1) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.16 + Math.random() * 0.08, 7, 5), m)
      b.scale.y = 0.6
      b.position.set((Math.random() - 0.5) * 0.4, 0.08 + (i === 3 ? 0.12 : 0), (Math.random() - 0.5) * 0.4)
      g.add(b)
    }
  } else if (kind === 'scored') {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), new THREE.MeshStandardMaterial({ color: '#8d877c', roughness: 0.95, flatShading: true }))
    rock.scale.set(1, 0.7, 0.9)
    rock.position.y = 0.3
    g.add(rock)
    const cut = new THREE.MeshBasicMaterial({ color: '#2b2520' })
    for (let i = 0; i < 3; i += 1) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.5, 0.02), cut)
      s.position.set(-0.12 + i * 0.12, 0.38, 0.47)
      s.rotation.z = 0.35
      g.add(s)
    }
  } else {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide })
    for (let i = 0; i < 6; i += 1) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(0.1 + Math.random() * 0.06, 6), m)
      p.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.6, 0, Math.random() * 6)
      p.position.set((Math.random() - 0.5) * 0.8, 0.05, (Math.random() - 0.5) * 0.8)
      g.add(p)
    }
  }
  return g
}

/** Footprint trails, clue spots and scent fireflies. */
export class Tracks {
  readonly root = new THREE.Group()
  private meshes = new Map<PrintKind, THREE.InstancedMesh>()
  private prints: Print[] = []
  private next = new Map<PrintKind, number>()
  readonly clues: Clue[] = []
  private studyCd = new Map<SpeciesId, number>()
  private flies: THREE.Points
  private flyPhase: Float32Array
  private time = 0
  private m4 = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private e = new THREE.Euler()
  private v = new THREE.Vector3()
  private sc = new THREE.Vector3()

  constructor(scene: THREE.Scene, private readonly ground: Ground) {
    this.root.name = 'tracks'
    scene.add(this.root)
    const geo = new THREE.PlaneGeometry(1, 1)
    geo.rotateX(-Math.PI / 2)
    for (const k of PRINT_KINDS) {
      const mat = new THREE.MeshBasicMaterial({
        map: printTexture(k), color: k === 'wyrm' ? '#2a1a14' : '#3b2a1c', transparent: true, opacity: 0.5, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      })
      const im = new THREE.InstancedMesh(geo, mat, PER_KIND)
      im.count = 0
      im.frustumCulled = false
      im.renderOrder = 2
      this.root.add(im)
      this.meshes.set(k, im)
      this.next.set(k, 0)
    }
    // Clue spots: two per spawn group, deterministic placement.
    const rnd = rng(911)
    const glow = glowTexture()
    const kinds: Clue['kind'][] = ['dung', 'scored', 'scales']
    SPAWNS.forEach((s, gi) => {
      for (let n = 0; n < 2; n += 1) {
        for (let tries = 0; tries < 12; tries += 1) {
          const a = rnd() * Math.PI * 2
          const r = s.spread + 3 + rnd() * 7
          const x = s.x + Math.cos(a) * r
          const z = s.z + Math.sin(a) * r
          if (!ground.walkable(x, z) || ground.heightAt(x, z) < -0.2) continue
          const kind = kinds[(gi + n) % 3]
          const y = ground.heightAt(x, z)
          const mesh = clueModel(kind, SPECIES[s.species].palette[0])
          mesh.position.set(x, y, z)
          mesh.rotation.y = rnd() * 6
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#ffe9a0', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }))
          sp.scale.setScalar(1.3)
          sp.position.set(x, y + 0.7, z)
          this.root.add(mesh, sp)
          this.clues.push({ sp: s.species, x, z, y, mesh, glow: sp, cd: 0, kind })
          break
        }
      }
    })
    // Scent fireflies.
    const N = 22
    const pos = new Float32Array(N * 3)
    this.flyPhase = new Float32Array(N)
    for (let i = 0; i < N; i += 1) this.flyPhase[i] = i / N
    const fg = new THREE.BufferGeometry()
    fg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.flies = new THREE.Points(fg, new THREE.PointsMaterial({ map: glow, color: '#d6ff8a', size: 0.55, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }))
    this.flies.frustumCulled = false
    this.flies.visible = false
    this.root.add(this.flies)
  }

  /** Footfall hook from creatures. */
  addPrint(c: Creature, x: number, z: number, yaw: number): void {
    if (c.puppet) return
    const kind = c.def.print
    const im = this.meshes.get(kind)!
    const slot = this.next.get(kind)!
    this.next.set(kind, (slot + 1) % PER_KIND)
    const old = this.prints.findIndex(p => SPECIES[p.sp].print === kind && p.slot === slot)
    if (old >= 0) this.prints.splice(old, 1)
    this.prints.push({ sp: c.def.id, x, z, age: 0, slot, studied: false })
    im.count = Math.max(im.count, slot + 1)
    this.placePrint(im, slot, x, z, yaw, PRINT_SIZE[kind] * (0.9 + Math.random() * 0.2), 0)
  }

  private placePrint(im: THREE.InstancedMesh, slot: number, x: number, z: number, yaw: number, size: number, sink: number): void {
    const G = this.ground
    const y = G.heightAt(x, z)
    const dx = G.heightAt(x + 0.4, z) - G.heightAt(x - 0.4, z)
    const dz = G.heightAt(x, z + 0.4) - G.heightAt(x, z - 0.4)
    this.e.set(Math.atan2(dz, 0.8), yaw, -Math.atan2(dx, 0.8), 'YXZ')
    this.q.setFromEuler(this.e)
    this.m4.compose(this.v.set(x, y + 0.04 - sink, z), this.q, this.sc.set(size, 1, size))
    im.setMatrixAt(slot, this.m4)
    im.instanceMatrix.needsUpdate = true
  }

  /** Nearest fresh print or clue spot within study range, for the interact prompt. */
  nearest(x: number, z: number): StudyTarget | null {
    let best: StudyTarget | null = null
    let bd = TRACKING.studyRange + 0.4
    for (const c of this.clues) {
      if (c.cd > 0) continue
      const d = Math.hypot(c.x - x, c.z - z)
      if (d < bd) {
        bd = d
        best = { kind: 'clue', sp: c.sp, ref: c, x: c.x, z: c.z }
      }
    }
    if (best) return best
    bd = TRACKING.studyRange
    for (const p of this.prints) {
      if (p.studied || p.age > TRACKING.printLife * 0.8 || (this.studyCd.get(p.sp) ?? 0) > 0) continue
      const d = Math.hypot(p.x - x, p.z - z)
      if (d < bd) {
        bd = d
        best = { kind: 'print', sp: p.sp, ref: p, x: p.x, z: p.z }
      }
    }
    return best
  }

  /** Study a clue or print; the caller adds the clue to the journal. */
  study(t: StudyTarget): void {
    if (t.kind === 'clue') {
      const c = t.ref as Clue
      c.cd = 180
      c.mesh.visible = false
      c.glow.visible = false
    } else {
      // A trail counts once per species every little while.
      this.studyCd.set(t.sp, STUDY_COOLDOWN)
      for (const p of this.prints) if (p.sp === t.sp && Math.hypot(p.x - t.x, p.z - t.z) < 14) p.studied = true
    }
  }

  update(dt: number, player: THREE.Vector3, target: THREE.Vector3 | null): void {
    this.time += dt
    for (const [k, v] of this.studyCd) this.studyCd.set(k, v - dt)
    // Age prints; fade by sinking during the last quarter of their life.
    for (let i = this.prints.length - 1; i >= 0; i -= 1) {
      const p = this.prints[i]
      const prevAge = p.age
      p.age += dt
      const life = TRACKING.printLife
      const im = this.meshes.get(SPECIES[p.sp].print)!
      if (p.age >= life) {
        this.m4.makeScale(0, 0, 0)
        im.setMatrixAt(p.slot, this.m4)
        im.instanceMatrix.needsUpdate = true
        this.prints.splice(i, 1)
      } else if (p.age > life * 0.75 && Math.floor(prevAge * 2) !== Math.floor(p.age * 2)) {
        const k = (p.age - life * 0.75) / (life * 0.25)
        im.getMatrixAt(p.slot, this.m4)
        this.m4.decompose(this.v, this.q, this.sc)
        this.m4.compose(this.v.setY(this.ground.heightAt(p.x, p.z) + 0.04 - k * 0.06), this.q, this.sc.multiplyScalar(1 - dt * 0.2))
        im.setMatrixAt(p.slot, this.m4)
        im.instanceMatrix.needsUpdate = true
      }
    }
    for (const c of this.clues) {
      if (c.cd > 0) {
        c.cd -= dt
        if (c.cd <= 0) {
          c.mesh.visible = true
          c.glow.visible = true
        }
        continue
      }
      const near = Math.hypot(c.x - player.x, c.z - player.z)
      c.glow.visible = near < 60
      ;(c.glow.material as THREE.SpriteMaterial).opacity = 0.2 + (Math.sin(this.time * 2.2 + c.x) * 0.5 + 0.5) * 0.25
    }
    // Scent fireflies drift from the hunter toward the tracked beast.
    const vis = !!target && Math.hypot(target.x - player.x, target.z - player.z) > 7
    this.flies.visible = vis
    if (vis && target) {
      const pos = this.flies.geometry.getAttribute('position') as THREE.BufferAttribute
      const dx = target.x - player.x
      const dz = target.z - player.z
      const L = Math.hypot(dx, dz)
      const span = Math.min(L - 3, 26)
      const ux = dx / L
      const uz = dz / L
      for (let i = 0; i < this.flyPhase.length; i += 1) {
        this.flyPhase[i] = (this.flyPhase[i] + dt * 0.12) % 1
        const u = this.flyPhase[i]
        const d = 2 + u * span
        const wob = Math.sin(this.time * 2 + i * 1.7) * 0.8
        const x = player.x + ux * d - uz * wob
        const z = player.z + uz * d + ux * wob
        pos.setXYZ(i, x, this.ground.heightAt(x, z) + 1.1 + Math.sin(this.time * 3 + i) * 0.35, z)
      }
      pos.needsUpdate = true
      ;(this.flies.material as THREE.PointsMaterial).opacity = 0.75 + Math.sin(this.time * 6) * 0.15
    }
  }

  /** Remove all prints (new expedition). */
  clear(): void {
    for (const im of this.meshes.values()) im.count = 0
    for (const k of PRINT_KINDS) this.next.set(k, 0)
    this.prints = []
    this.studyCd.clear()
    for (const c of this.clues) {
      c.cd = 0
      c.mesh.visible = true
      c.glow.visible = true
    }
  }
}
