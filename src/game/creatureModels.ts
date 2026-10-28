import * as THREE from 'three'
import type { SpeciesId } from './data'
import { SPECIES } from './data'

/**
 * Procedural, rigged creature models. Every rig faces +Z at yaw 0 (identity quaternion) and
 * stands with its feet at y = 0. Gameplay animates rigs only through `applyPose`.
 */
export type Leg = { hip: THREE.Object3D; knee?: THREE.Object3D; phase: number; front: boolean }
export type Rig = {
  species: SpeciesId
  root: THREE.Group
  body: THREE.Group
  neck: THREE.Object3D[]
  head: THREE.Group
  jaw?: THREE.Object3D
  tail: THREE.Object3D[]
  legs: Leg[]
  wings: THREE.Object3D[]
  glow: THREE.MeshStandardMaterial[]
  glowBase: number
  mats: THREE.MeshStandardMaterial[]
  bodyY: number
  headRestX: number
  height: number
  /** World-space metres per gait radian (for footstep speed matching). */
  stride: number
  /** Set once the realistic GLB mesh has been skinned onto this rig (procedural parts hidden). */
  model?: THREE.Object3D
  /** Shader uniform driving the white hit flash on GLB materials. */
  flashU?: { value: number }
}
export type Pose = {
  headPitch: number; headYaw: number; jaw: number
  bodyPitch: number; bodyRoll: number; bodyY: number; bodyYaw: number
  crouch: number; tailSwing: number; gait: number; stride: number; glow: number; wing: number
}
export const restPose = (): Pose => ({ headPitch: 0, headYaw: 0, jaw: 0, bodyPitch: 0, bodyRoll: 0, bodyY: 0, bodyYaw: 0, crouch: 0, tailSwing: 0, gait: 0, stride: 0, glow: 0, wing: 0 })

type V3 = [number, number, number]
class Kit {
  readonly mats: THREE.MeshStandardMaterial[] = []
  readonly glow: THREE.MeshStandardMaterial[] = []
  mat(color: string, rough = 0.85): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true })
    this.mats.push(m)
    return m
  }
  glowMat(color: string, emissive: string, base = 0.6): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: base, roughness: 0.5, flatShading: true })
    this.glow.push(m)
    return m
  }
  mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 | number = 1): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(...pos)
    m.rotation.set(...rot)
    if (typeof scale === 'number') m.scale.setScalar(scale)
    else m.scale.set(...scale)
    m.castShadow = true
    parent.add(m)
    return m
  }
  group(parent: THREE.Object3D, pos: V3 = [0, 0, 0]): THREE.Group {
    const g = new THREE.Group()
    g.position.set(...pos)
    parent.add(g)
    return g
  }
}
const sphere = (d = 1) => new THREE.IcosahedronGeometry(1, d)
const cyl = (rt: number, rb: number, h: number, s = 7) => new THREE.CylinderGeometry(rt, rb, h, s).translate(0, -h / 2, 0)
const cone = (r: number, h: number, s = 6) => new THREE.ConeGeometry(r, h, s).translate(0, h / 2, 0)
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z)

function base(species: SpeciesId, kit: Kit, bodyY: number, height: number, stride: number) {
  const root = new THREE.Group()
  root.name = `creature-${species}`
  const body = kit.group(root, [0, bodyY, 0])
  const head = new THREE.Group()
  return { root, body, head, neck: [] as THREE.Object3D[], tail: [] as THREE.Object3D[], legs: [] as Leg[], wings: [] as THREE.Object3D[], bodyY, height, stride }
}

/** Simple straight leg (hip pivot, optional knee). Length measured down from the hip. */
function leg(kit: Kit, parent: THREE.Object3D, at: V3, upper: number, lower: number, r: number, mat: THREE.Material, foot: THREE.Material, phase: number, front: boolean, splay = 0): Leg {
  const hip = kit.group(parent, at)
  hip.rotation.z = splay
  kit.mesh(hip, cyl(r, r * 0.8, upper), mat)
  const knee = kit.group(hip, [0, -upper, 0])
  kit.mesh(knee, cyl(r * 0.8, r * 0.6, lower), mat)
  kit.mesh(knee, sphere(0), foot, [0, -lower, r * 0.4], [0, 0, 0], [r * 1.1, r * 0.6, r * 1.5])
  return { hip, knee, phase, front }
}

function tailChain(kit: Kit, parent: THREE.Object3D, at: V3, segs: number, len: number, r0: number, r1: number, mat: THREE.Material, droop = 0.08): THREE.Object3D[] {
  const out: THREE.Object3D[] = []
  let p: THREE.Object3D = kit.group(parent, at)
  for (let i = 0; i < segs; i += 1) {
    const t = i / segs
    const r = r0 + (r1 - r0) * t
    const seg = i === 0 ? p : kit.group(p, [0, 0, -len])
    seg.rotation.x = droop
    kit.mesh(seg, new THREE.CylinderGeometry(r * 0.85, r, len, 7).rotateX(Math.PI / 2).translate(0, 0, -len / 2), mat)
    out.push(seg)
    p = seg
  }
  return out
}

// ─── Species builders ───────────────────────────────────────────────────────

function tuskhog(kit: Kit): Rig {
  const [hide, dark, tusk, eye] = SPECIES.tuskhog.palette
  const b = base('tuskhog', kit, 0.98, 1.3, 0.55)
  const mHide = kit.mat(hide)
  const mDark = kit.mat(dark)
  const mTusk = kit.mat(tusk, 0.5)
  const mEye = kit.mat(eye, 0.3)
  kit.mesh(b.body, sphere(1), mHide, [0, 0, 0], [0, 0, 0], [0.78, 0.66, 1.08])
  kit.mesh(b.body, sphere(1), mHide, [0, 0.18, 0.35], [0, 0, 0], [0.72, 0.62, 0.7])
  for (let i = 0; i < 7; i += 1) kit.mesh(b.body, cone(0.12, 0.42, 4), mDark, [0, 0.56 + Math.sin((i / 6) * Math.PI) * 0.12, 0.6 - i * 0.2], [-0.5, 0, 0])
  b.head.position.set(0, 0.12, 0.92)
  b.body.add(b.head)
  kit.mesh(b.head, sphere(1), mHide, [0, 0, 0.25], [0, 0, 0], [0.48, 0.45, 0.55])
  kit.mesh(b.head, new THREE.CylinderGeometry(0.2, 0.24, 0.4, 8).rotateX(Math.PI / 2), mDark, [0, -0.1, 0.72])
  for (const s of [-1, 1]) {
    kit.mesh(b.head, cone(0.07, 0.6, 5), mTusk, [s * 0.2, -0.18, 0.62], [-0.9, 0, -s * 0.35])
    kit.mesh(b.head, cone(0.1, 0.3, 4), mDark, [s * 0.26, 0.34, 0.1], [0.2, 0, -s * 0.4])
    kit.mesh(b.head, sphere(0), mEye, [s * 0.27, 0.1, 0.5], [0, 0, 0], 0.06)
  }
  const jaw = kit.group(b.head, [0, -0.28, 0.35])
  kit.mesh(jaw, box(0.3, 0.1, 0.4), mDark, [0, 0, 0.12])
  const legs = [
    leg(kit, b.body, [-0.42, -0.38, 0.55], 0.32, 0.3, 0.13, mHide, mDark, 0, true),
    leg(kit, b.body, [0.42, -0.38, 0.55], 0.32, 0.3, 0.13, mHide, mDark, Math.PI, true),
    leg(kit, b.body, [-0.42, -0.38, -0.55], 0.32, 0.3, 0.13, mHide, mDark, Math.PI, false),
    leg(kit, b.body, [0.42, -0.38, -0.55], 0.32, 0.3, 0.13, mHide, mDark, 0, false),
  ]
  const tail = tailChain(kit, b.body, [0, 0.25, -1.02], 2, 0.22, 0.05, 0.03, mDark, 0.9)
  return { ...b, species: 'tuskhog', legs, tail, jaw, glow: kit.glow, glowBase: 0, mats: kit.mats, headRestX: 0 }
}

function mudsnapper(kit: Kit): Rig {
  const [skin, dark, eyeC, belly] = SPECIES.mudsnapper.palette
  const b = base('mudsnapper', kit, 0.52, 0.9, 0.5)
  const mSkin = kit.mat(skin)
  const mDark = kit.mat(dark)
  const mEye = kit.glowMat(eyeC, '#b58a1a', 0.4)
  const mBelly = kit.mat(belly)
  kit.mesh(b.body, sphere(1), mSkin, [0, 0, 0], [0, 0, 0], [0.62, 0.34, 1.15])
  kit.mesh(b.body, sphere(1), mBelly, [0, -0.12, 0], [0, 0, 0], [0.55, 0.22, 1.0])
  for (let i = 0; i < 6; i += 1) for (const s of [-1, 1]) kit.mesh(b.body, cone(0.08, 0.2, 4), mDark, [s * 0.18, 0.3, 0.7 - i * 0.28], [-0.3, 0, 0])
  b.head.position.set(0, 0.06, 1.05)
  b.body.add(b.head)
  kit.mesh(b.head, box(0.55, 0.24, 0.85), mSkin, [0, 0.04, 0.4], [0.05, 0, 0])
  kit.mesh(b.head, box(0.5, 0.06, 0.1), mBelly, [0, -0.06, 0.8])
  for (const s of [-1, 1]) kit.mesh(b.head, sphere(0), mEye, [s * 0.2, 0.2, 0.15], [0, 0, 0], [0.09, 0.08, 0.09])
  const jaw = kit.group(b.head, [0, -0.1, 0.02])
  kit.mesh(jaw, box(0.5, 0.12, 0.8), mBelly, [0, -0.02, 0.38])
  for (let i = 0; i < 4; i += 1) for (const s of [-1, 1]) kit.mesh(jaw, cone(0.03, 0.1, 3), mBelly, [s * 0.2, 0.04, 0.2 + i * 0.16])
  const legs = [
    leg(kit, b.body, [-0.52, -0.08, 0.62], 0.28, 0.24, 0.1, mSkin, mDark, 0, true, -0.7),
    leg(kit, b.body, [0.52, -0.08, 0.62], 0.28, 0.24, 0.1, mSkin, mDark, Math.PI, true, 0.7),
    leg(kit, b.body, [-0.52, -0.08, -0.55], 0.28, 0.24, 0.1, mSkin, mDark, Math.PI, false, -0.7),
    leg(kit, b.body, [0.52, -0.08, -0.55], 0.28, 0.24, 0.1, mSkin, mDark, 0, false, 0.7),
  ]
  const tail = tailChain(kit, b.body, [0, 0, -1.05], 5, 0.42, 0.26, 0.05, mSkin, 0.04)
  return { ...b, species: 'mudsnapper', legs, tail, jaw, glow: kit.glow, glowBase: 0.4, mats: kit.mats, headRestX: 0 }
}

function dunestalker(kit: Kit): Rig {
  const [hide, stripe, dark, crest] = SPECIES.dunestalker.palette
  const b = base('dunestalker', kit, 1.25, 1.8, 0.8)
  const mHide = kit.mat(hide)
  const mStripe = kit.mat(stripe)
  const mDark = kit.mat(dark)
  const mCrest = kit.mat(crest)
  kit.mesh(b.body, sphere(1), mHide, [0, 0, 0], [-0.15, 0, 0], [0.42, 0.48, 0.85])
  for (let i = 0; i < 4; i += 1) kit.mesh(b.body, box(0.7, 0.06, 0.1), mStripe, [0, 0.38 - i * 0.02, 0.35 - i * 0.25], [0, 0, 0])
  const neck = kit.group(b.body, [0, 0.3, 0.7])
  neck.rotation.x = -0.5
  kit.mesh(neck, new THREE.CylinderGeometry(0.16, 0.22, 0.7, 7).translate(0, 0.35, 0), mHide)
  b.head.position.set(0, 0.68, 0)
  neck.add(b.head)
  kit.mesh(b.head, sphere(1), mHide, [0, 0.05, 0.25], [0, 0, 0], [0.26, 0.27, 0.5])
  kit.mesh(b.head, box(0.28, 0.14, 0.45), mHide, [0, 0.02, 0.62])
  for (const s of [-1, 1]) kit.mesh(b.head, sphere(0), mDark, [s * 0.18, 0.12, 0.35], [0, 0, 0], 0.05)
  for (let i = 0; i < 3; i += 1) kit.mesh(b.head, cone(0.06, 0.45, 4), mCrest, [0, 0.22, 0.2 - i * 0.16], [-0.9 - i * 0.2, 0, 0])
  const jaw = kit.group(b.head, [0, -0.08, 0.3])
  kit.mesh(jaw, box(0.24, 0.08, 0.55), mCrest, [0, -0.02, 0.24])
  for (const s of [-1, 1]) {
    const arm = kit.group(b.body, [s * 0.3, -0.12, 0.55])
    arm.rotation.x = -0.6
    kit.mesh(arm, cyl(0.06, 0.05, 0.35), mHide)
    for (let c = 0; c < 3; c += 1) kit.mesh(arm, cone(0.025, 0.14, 3), mDark, [s * 0.02 * (c - 1), -0.36, 0.04], [2.4, 0, 0])
  }
  const legs = [
    leg(kit, b.body, [-0.3, -0.2, -0.08], 0.55, 0.62, 0.13, mHide, mDark, 0, true),
    leg(kit, b.body, [0.3, -0.2, -0.08], 0.55, 0.62, 0.13, mHide, mDark, Math.PI, true),
  ]
  const tail = tailChain(kit, b.body, [0, 0.12, -0.75], 5, 0.42, 0.2, 0.04, mHide, -0.04)
  kit.mesh(tail[3], box(0.26, 0.05, 0.1), mStripe, [0, 0.08, -0.2])
  return { ...b, species: 'dunestalker', neck: [neck], legs, tail, jaw, glow: kit.glow, glowBase: 0, mats: kit.mats, headRestX: 0 }
}

function emberbeetle(kit: Kit): Rig {
  const [shell, magma, glowC, dark] = SPECIES.emberbeetle.palette
  const b = base('emberbeetle', kit, 0.82, 1.3, 0.4)
  const mShell = kit.mat(shell, 0.4)
  const mDark = kit.mat(dark)
  const mGlow = kit.glowMat(magma, glowC, 0.7)
  kit.mesh(b.body, new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mShell, [0, 0, 0], [0, 0, 0], [1.1, 0.8, 1.3])
  kit.mesh(b.body, sphere(1), mDark, [0, -0.08, 0], [0, 0, 0], [1.0, 0.3, 1.2])
  kit.mesh(b.body, box(0.12, 0.08, 2.5), mGlow, [0, 0.8, 0], [0, 0, 0])
  for (const s of [-1, 1]) {
    kit.mesh(b.body, new THREE.TorusGeometry(0.8, 0.05, 4, 16, Math.PI * 0.9), mGlow, [s * 0.35, 0.05, 0], [Math.PI / 2, s * 0.35, Math.PI / 2 + 0.2 * s], [1, 1.3, 1])
  }
  for (let i = 0; i < 5; i += 1) kit.mesh(b.body, sphere(0), mGlow, [(i - 2) * 0.35, 0.55 + (i % 2) * 0.1, -0.6 + (i % 3) * 0.5], [0, 0, 0], 0.1)
  b.head.position.set(0, 0.05, 1.2)
  b.body.add(b.head)
  kit.mesh(b.head, sphere(1), mDark, [0, 0, 0.1], [0, 0, 0], [0.5, 0.38, 0.4])
  for (const s of [-1, 1]) kit.mesh(b.head, sphere(0), mGlow, [s * 0.25, 0.12, 0.38], [0, 0, 0], 0.08)
  const jaw = kit.group(b.head, [0, -0.05, 0.35])
  for (const s of [-1, 1]) kit.mesh(jaw, cone(0.08, 0.5, 4), mShell, [s * 0.2, 0, 0], [Math.PI / 2, 0, -s * 0.5])
  const legs: Leg[] = []
  ;[0.65, 0, -0.65].forEach((z, i) => {
    for (const s of [-1, 1]) legs.push(leg(kit, b.body, [s * 0.9, -0.15, z], 0.4, 0.45, 0.07, mDark, mDark, (i + (s > 0 ? 1 : 0)) % 2 ? Math.PI : 0, z > 0, s * 0.9))
  })
  return { ...b, species: 'emberbeetle', legs, jaw, tail: [], glow: kit.glow, glowBase: 0.7, mats: kit.mats, headRestX: 0 }
}

function ashfang(kit: Kit): Rig {
  const [fur, dark, ember, bone] = SPECIES.ashfang.palette
  const b = base('ashfang', kit, 1.02, 1.4, 0.75)
  const mFur = kit.mat(fur)
  const mDark = kit.mat(dark)
  const mBone = kit.mat(bone)
  const mMane = kit.glowMat('#3a2a26', ember, 0.5)
  kit.mesh(b.body, sphere(1), mFur, [0, 0, 0], [0, 0, 0], [0.45, 0.46, 1.0])
  kit.mesh(b.body, sphere(1), mFur, [0, 0.1, 0.5], [0, 0, 0], [0.5, 0.52, 0.55])
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2
    kit.mesh(b.body, cone(0.1, 0.55, 4), mMane, [Math.cos(a) * 0.35, 0.2 + Math.sin(a) * 0.35, 0.75], [Math.sin(a) * 1.2 - 0.5, 0, -Math.cos(a) * 1.2])
  }
  b.head.position.set(0, 0.3, 1.0)
  b.body.add(b.head)
  kit.mesh(b.head, sphere(1), mFur, [0, 0.02, 0.15], [0, 0, 0], [0.3, 0.28, 0.38])
  kit.mesh(b.head, box(0.22, 0.18, 0.4), mDark, [0, -0.05, 0.5])
  for (const s of [-1, 1]) {
    kit.mesh(b.head, cone(0.08, 0.3, 4), mDark, [s * 0.16, 0.22, 0.0], [-0.3, 0, -s * 0.3])
    kit.mesh(b.head, sphere(0), mMane, [s * 0.14, 0.1, 0.36], [0, 0, 0], 0.05)
  }
  const jaw = kit.group(b.head, [0, -0.14, 0.3])
  kit.mesh(jaw, box(0.18, 0.07, 0.36), mDark, [0, 0, 0.16])
  for (const s of [-1, 1]) kit.mesh(jaw, cone(0.025, 0.1, 3), mBone, [s * 0.07, 0.05, 0.3])
  const legs = [
    leg(kit, b.body, [-0.26, -0.3, 0.62], 0.38, 0.38, 0.09, mFur, mDark, 0, true),
    leg(kit, b.body, [0.26, -0.3, 0.62], 0.38, 0.38, 0.09, mFur, mDark, Math.PI, true),
    leg(kit, b.body, [-0.26, -0.3, -0.62], 0.38, 0.38, 0.09, mFur, mDark, Math.PI, false),
    leg(kit, b.body, [0.26, -0.3, -0.62], 0.38, 0.38, 0.09, mFur, mDark, 0, false),
  ]
  const tail = tailChain(kit, b.body, [0, 0.2, -0.95], 3, 0.35, 0.16, 0.12, mFur, -0.4)
  kit.mesh(tail[2], sphere(0), mMane, [0, 0, -0.4], [0, 0, 0], [0.15, 0.15, 0.3])
  return { ...b, species: 'ashfang', legs, tail, jaw, glow: kit.glow, glowBase: 0.5, mats: kit.mats, headRestX: 0 }
}

function ruinhorn(kit: Kit): Rig {
  const [stone, dark, horn, deep, rune] = SPECIES.ruinhorn.palette
  const b = base('ruinhorn', kit, 3.1, 5.2, 1.6)
  const mStone = kit.mat(stone)
  const mDark = kit.mat(dark)
  const mHorn = kit.mat(horn, 0.5)
  const mDeep = kit.mat(deep)
  const mRune = kit.glowMat('#3e6a60', rune, 0.8)
  const mMoss = kit.mat('#7a9a52')
  kit.mesh(b.body, sphere(1), mStone, [0, 0, 0], [0, 0, 0], [2.2, 1.8, 3.2])
  kit.mesh(b.body, sphere(1), mDark, [0, -0.6, 0.2], [0, 0, 0], [1.9, 1.2, 2.8])
  for (let i = 0; i < 7; i += 1) {
    const z = 2.0 - i * 0.7
    const y = 1.55 + Math.sin((i / 6) * Math.PI) * 0.35
    kit.mesh(b.body, box(1.6 - Math.abs(i - 3) * 0.12, 0.35, 0.8), mDark, [0, y, z], [-0.25, 0, 0])
    kit.mesh(b.body, box(1.2, 0.08, 0.5), mMoss, [0, y + 0.2, z - 0.05], [-0.25, 0, 0])
    if (i % 2 === 0) kit.mesh(b.body, box(0.3, 0.06, 0.3), mRune, [0, y + 0.1, z + 0.38], [-0.25, 0, 0])
  }
  for (const s of [-1, 1]) for (let i = 0; i < 3; i += 1) kit.mesh(b.body, box(0.2, 0.6, 0.12), mRune, [s * 2.1, 0.1, 1.2 - i * 0.9], [0, 0, s * 0.2])
  b.head.position.set(0, 0.2, 2.9)
  b.body.add(b.head)
  kit.mesh(b.head, sphere(1), mStone, [0, 0, 0.9], [0.1, 0, 0], [1.25, 1.05, 1.5])
  kit.mesh(b.head, new THREE.CylinderGeometry(2.1, 2.1, 0.3, 12, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2), mDark, [0, 0.9, 0.05], [-0.5, 0, 0])
  for (let i = 0; i < 7; i += 1) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI
    kit.mesh(b.head, cone(0.18, 0.8, 5), mHorn, [Math.sin(a) * 2.1, 0.9 + Math.cos(a) * 1.9, -0.35], [-0.5 + Math.cos(a) * 0.9, 0, -Math.sin(a) * 1.2])
  }
  kit.mesh(b.head, cone(0.5, 2.8, 7), mHorn, [0, 0.3, 2.0], [1.05, 0, 0])
  for (const s of [-1, 1]) {
    kit.mesh(b.head, cone(0.22, 1.1, 5), mHorn, [s * 0.7, 0.85, 1.3], [0.7, 0, -s * 0.5])
    kit.mesh(b.head, sphere(0), mRune, [s * 0.95, 0.35, 1.6], [0, 0, 0], 0.16)
  }
  const jaw = kit.group(b.head, [0, -0.7, 0.9])
  kit.mesh(jaw, box(1.2, 0.35, 1.4), mDeep, [0, 0, 0.5])
  const legs = [
    leg(kit, b.body, [-1.45, -1.1, 1.9], 1.1, 1.05, 0.6, mStone, mDeep, 0, true),
    leg(kit, b.body, [1.45, -1.1, 1.9], 1.1, 1.05, 0.6, mStone, mDeep, Math.PI, true),
    leg(kit, b.body, [-1.45, -1.1, -1.9], 1.1, 1.05, 0.6, mStone, mDeep, Math.PI, false),
    leg(kit, b.body, [1.45, -1.1, -1.9], 1.1, 1.05, 0.6, mStone, mDeep, 0, false),
  ]
  const tail = tailChain(kit, b.body, [0, 0.3, -3.0], 4, 1.0, 0.8, 0.35, mStone, 0.12)
  kit.mesh(tail[3], new THREE.DodecahedronGeometry(0.75, 0), mDark, [0, 0, -1.1])
  return { ...b, species: 'ruinhorn', legs, tail, jaw, glow: kit.glow, glowBase: 0.8, mats: kit.mats, headRestX: 0 }
}

function vulkarr(kit: Kit): Rig {
  const [scale, belly, magma, core, dark] = SPECIES.vulkarr.palette
  const b = base('vulkarr', kit, 3.0, 5.6, 1.5)
  const mScale = kit.mat(scale, 0.55)
  const mBelly = kit.mat(belly)
  const mDark = kit.mat(dark)
  const mGlow = kit.glowMat('#5a1a0a', magma, 0.9)
  const mCore = kit.glowMat('#7a2a0a', core, 1.0)
  kit.mesh(b.body, sphere(1), mScale, [0, 0, 0], [0, 0, 0], [1.8, 1.55, 3.0])
  kit.mesh(b.body, sphere(1), mBelly, [0, -0.55, 0.3], [0, 0, 0], [1.5, 1.0, 2.5])
  for (let i = 0; i < 5; i += 1) kit.mesh(b.body, box(1.5 - i * 0.1, 0.06, 0.12), mGlow, [0, -1.35, 1.6 - i * 0.7], [0.1, 0, 0])
  for (let i = 0; i < 9; i += 1) {
    const z = 2.4 - i * 0.6
    const h = 0.9 + Math.sin((i / 8) * Math.PI) * 0.6
    kit.mesh(b.body, cone(0.22, h, 5), mDark, [0, 1.35 + Math.sin((i / 8) * Math.PI) * 0.2, z], [-0.35, 0, 0])
    kit.mesh(b.body, cone(0.08, 0.3, 4), mGlow, [0, 1.35 + h * 0.85 + Math.sin((i / 8) * Math.PI) * 0.2, z - h * 0.3], [-0.35, 0, 0])
  }
  // folded wings
  const wings: THREE.Object3D[] = []
  for (const s of [-1, 1]) {
    const w = kit.group(b.body, [s * 1.2, 1.0, 0.8])
    const shape = new THREE.Shape()
    shape.moveTo(0, 0)
    shape.lineTo(s * 3.2, 1.2)
    shape.lineTo(s * 2.8, -0.4)
    shape.lineTo(s * 1.6, -1.6)
    shape.lineTo(0, -1.2)
    const g = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2)
    kit.mesh(w, g, new THREE.MeshStandardMaterial({ color: '#3a1d18', emissive: '#6a1a08', emissiveIntensity: 0.3, side: THREE.DoubleSide, flatShading: true }), [0, 0, 0], [0.2, 0, s * 0.5])
    kit.mesh(w, cyl(0.1, 0.06, 3.3), mDark, [0, 0, 0], [0, 0, s * (Math.PI / 2 + 0.36)])
    w.rotation.set(0, 0, s * 0.6)
    wings.push(w)
  }
  // neck chain → head
  const neck: THREE.Object3D[] = []
  let p: THREE.Object3D = b.body
  const neckAt: V3[] = [[0, 0.7, 2.6], [0, 0.55, 0.9], [0, 0.45, 0.85]]
  for (let i = 0; i < 3; i += 1) {
    const n = kit.group(p, neckAt[i])
    n.rotation.x = i === 0 ? -0.55 : 0.2
    kit.mesh(n, new THREE.CylinderGeometry(0.62 - i * 0.1, 0.75 - i * 0.1, 1.1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.45), mScale)
    kit.mesh(n, cone(0.12, 0.5, 4), mGlow, [0, 0.6 - i * 0.08, 0.4], [-0.4, 0, 0])
    neck.push(n)
    p = n
  }
  b.head.position.set(0, 0.1, 0.95)
  p.add(b.head)
  b.head.rotation.x = 0.4
  kit.mesh(b.head, sphere(1), mScale, [0, 0.1, 0.6], [0, 0, 0], [0.85, 0.7, 1.35])
  kit.mesh(b.head, box(0.9, 0.35, 0.9), mDark, [0, 0.05, 1.55])
  for (const s of [-1, 1]) {
    kit.mesh(b.head, cone(0.18, 1.5, 5), mDark, [s * 0.5, 0.6, 0.1], [-1.9, 0, -s * 0.3])
    kit.mesh(b.head, sphere(0), mCore, [s * 0.5, 0.35, 1.2], [0, 0, 0], [0.13, 0.09, 0.13])
  }
  const jaw = kit.group(b.head, [0, -0.35, 0.4])
  kit.mesh(jaw, box(0.8, 0.25, 1.5), mBelly, [0, -0.05, 0.75])
  for (let i = 0; i < 5; i += 1) for (const s of [-1, 1]) kit.mesh(jaw, cone(0.05, 0.22, 3), mBelly, [s * 0.32, 0.08, 0.3 + i * 0.25])
  kit.mesh(b.head, sphere(1), mCore, [0, -0.45, 0.5], [0, 0, 0], [0.45, 0.35, 0.6])
  const legs = [
    leg(kit, b.body, [-1.3, -0.9, 1.7], 1.2, 1.15, 0.45, mScale, mDark, 0, true, -0.1),
    leg(kit, b.body, [1.3, -0.9, 1.7], 1.2, 1.15, 0.45, mScale, mDark, Math.PI, true, 0.1),
    leg(kit, b.body, [-1.3, -0.9, -1.6], 1.2, 1.15, 0.5, mScale, mDark, Math.PI, false, -0.1),
    leg(kit, b.body, [1.3, -0.9, -1.6], 1.2, 1.15, 0.5, mScale, mDark, 0, false, 0.1),
  ]
  const tail = tailChain(kit, b.body, [0, 0.2, -2.9], 6, 1.05, 0.85, 0.2, mScale, 0.06)
  for (let i = 1; i < 6; i += 1) kit.mesh(tail[i], cone(0.1, 0.4, 4), mGlow, [0, 0.35 - i * 0.04, -0.4], [-0.6, 0, 0])
  kit.mesh(tail[5], cone(0.3, 1.2, 5), mDark, [0, 0, -1.0], [-Math.PI / 2, 0, 0])
  return { ...b, species: 'vulkarr', neck, wings, legs, tail, jaw, glow: kit.glow, glowBase: 0.9, mats: kit.mats, headRestX: 0.4 }
}

const BUILDERS: Record<SpeciesId, (k: Kit) => Rig> = { tuskhog, mudsnapper, dunestalker, emberbeetle, ashfang, ruinhorn, vulkarr }

export function buildRig(species: SpeciesId): Rig {
  const rig = BUILDERS[species](new Kit())
  rig.root.userData.species = species
  return rig
}

/** Drive a rig from a pose. Pure transform writes; safe to call every frame. */
export function applyPose(rig: Rig, p: Pose): void {
  rig.body.position.y = rig.bodyY + p.bodyY - p.crouch * rig.height * 0.16
  rig.body.rotation.set(p.bodyPitch, p.bodyYaw, p.bodyRoll)
  const n = rig.neck.length + 1
  for (const nk of rig.neck) {
    nk.rotation.y = p.headYaw / n
  }
  if (rig.neck.length) {
    rig.neck[0].rotation.x = (rig.species === 'vulkarr' ? -0.55 : -0.5) + p.headPitch / n
  }
  rig.head.rotation.x = rig.headRestX + p.headPitch / n
  rig.head.rotation.y = p.headYaw / n
  if (rig.jaw) rig.jaw.rotation.x = p.jaw * 0.65
  rig.tail.forEach((t, i) => {
    t.rotation.y = p.tailSwing * (0.35 + i * 0.12)
  })
  for (const l of rig.legs) {
    const ph = p.gait + l.phase
    const swing = Math.sin(ph) * p.stride
    l.hip.rotation.x = swing + p.crouch * (l.front ? -0.35 : 0.55)
    if (l.knee) l.knee.rotation.x = Math.max(0, -Math.cos(ph)) * p.stride * 0.9 + p.crouch * (l.front ? 0.5 : -0.2) - (l.front ? 0 : p.crouch * 0.4)
  }
  for (const w of rig.wings) {
    const s = Math.sign(w.position.x)
    w.rotation.z = s * (0.6 + p.wing * 0.9)
  }
  for (const m of rig.glow) m.emissiveIntensity = rig.glowBase + p.glow * (rig.model ? 1.4 : 3.2)
}

/** Brief white hit-flash on all body materials (0..1). */
export function setFlash(rig: Rig, amount: number): void {
  if (rig.flashU) { rig.flashU.value = amount; return }
  for (const m of rig.mats) {
    m.emissive.setRGB(amount, amount * 0.9, amount * 0.75)
    m.emissiveIntensity = amount > 0 ? 0.8 : 0
  }
}
