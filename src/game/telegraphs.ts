import * as THREE from 'three'

/** Minimal ground interface shared by the island terrain and the lab's flat floor. */
export type Ground = {
  heightAt(x: number, z: number): number
  surfaceAt(x: number, z: number): number
  walkable(x: number, z: number): boolean
  canStep(ax: number, az: number, bx: number, bz: number): boolean
}

export type DecalShape =
  | { kind: 'circle'; radius: number }
  | { kind: 'cone'; radius: number; angle: number; back?: boolean }
  | { kind: 'lane'; length: number; width: number }

const KIND = { circle: 0, cone: 1, lane: 2 } as const

const vertexShader = /* glsl */ `
  varying vec2 vLocal;
  void main(){
    vLocal = vec2(position.x, position.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`

const fragmentShader = /* glsl */ `
  uniform int uKind; uniform float uR; uniform float uHalf; uniform float uW; uniform float uL;
  uniform float uProg; uniform float uYaw; uniform float uBack; uniform float uAlpha; uniform float uTime; uniform float uFlash;
  uniform vec3 uColor;
  varying vec2 vLocal;
  void main(){
    float c = cos(uYaw); float s = sin(uYaw);
    // Local frame: +y is the creature's forward.
    vec2 p = vec2(c * vLocal.x - s * vLocal.y, s * vLocal.x + c * vLocal.y);
    p = vec2(p.x, p.y);
    float inside = 0.0; float edge = 0.0; float fill = 0.0;
    if (uKind == 0) {
      float d = length(p);
      inside = step(d, uR);
      edge = smoothstep(uR - 0.45, uR - 0.05, d) * inside;
      fill = step(d, uR * uProg);
    } else if (uKind == 1) {
      vec2 q = uBack > 0.5 ? vec2(p.x, -p.y) : p;
      float d = length(q);
      float ang = abs(atan(q.x, q.y));
      inside = step(d, uR) * step(ang, uHalf);
      float angEdge = smoothstep(uHalf - 0.08, uHalf, ang);
      edge = max(smoothstep(uR - 0.45, uR - 0.05, d), angEdge) * inside;
      fill = step(d, uR * uProg);
    } else {
      float hw = uW * 0.5;
      inside = step(abs(p.x), hw) * step(0.0, p.y) * step(p.y, uL);
      edge = max(smoothstep(hw - 0.3, hw, abs(p.x)), smoothstep(uL - 0.4, uL, p.y)) * inside;
      fill = step(p.y, uL * uProg);
      // chevrons pointing forward
      float chev = step(0.75, fract((p.y - abs(p.x) * 0.8) * 0.35 - uTime * 1.5));
      edge = max(edge, chev * 0.35 * inside);
    }
    if (inside < 0.5) discard;
    float pulse = 0.75 + 0.25 * sin(uTime * 14.0);
    float a = (0.16 + fill * 0.34 + edge * 0.5 * pulse) * uAlpha + uFlash * 0.5;
    vec3 col = mix(uColor, vec3(1.0, 0.95, 0.7), edge * 0.4 + uFlash);
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.95));
  }`

export class Telegraph {
  readonly mesh: THREE.Mesh
  private readonly mat: THREE.ShaderMaterial
  private readonly geo: THREE.BufferGeometry
  private readonly n: number
  private readonly extent: number
  x = 0
  z = 0
  yaw = 0
  alive = true
  /** Fill progress 0..1, set by the owner each frame. */
  progress = 0
  private life = 0
  private fade = -1

  constructor(private readonly ground: Ground, readonly shape: DecalShape, color = '#ff5a2a') {
    const extent = shape.kind === 'lane' ? Math.max(shape.length, shape.width) + 0.5 : shape.radius + 0.3
    this.extent = extent
    this.n = Math.min(40, Math.max(10, Math.ceil(extent * 1.6)))
    this.geo = new THREE.PlaneGeometry(extent * 2, extent * 2, this.n, this.n).rotateX(-Math.PI / 2)
    this.mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      uniforms: {
        uKind: { value: KIND[shape.kind] },
        uR: { value: shape.kind === 'lane' ? 0 : shape.radius },
        uHalf: { value: shape.kind === 'cone' ? THREE.MathUtils.degToRad(shape.angle) / 2 : 0 },
        uW: { value: shape.kind === 'lane' ? shape.width : 0 },
        uL: { value: shape.kind === 'lane' ? shape.length : 0 },
        uBack: { value: shape.kind === 'cone' && shape.back ? 1 : 0 },
        uProg: { value: 0 },
        uYaw: { value: 0 },
        uAlpha: { value: 1 },
        uTime: { value: 0 },
        uFlash: { value: 0 },
        uColor: { value: new THREE.Color(color) },
      },
    })
    this.mesh = new THREE.Mesh(this.geo, this.mat)
    this.mesh.renderOrder = 8
    this.mesh.frustumCulled = false
  }

  /** Move/rotate the decal and re-drape it on the ground. yaw: creature facing (0 = +Z). */
  place(x: number, z: number, yaw: number): void {
    this.x = x
    this.z = z
    this.yaw = yaw
    this.mesh.position.set(x, 0, z)
    // Forward = (sin yaw, cos yaw) in world xz; the shader projects offsets onto it.
    this.mat.uniforms.uYaw.value = yaw
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i += 1) {
      const lx = pos.getX(i)
      const lz = pos.getZ(i)
      pos.setY(i, this.ground.surfaceAt(x + lx, z + lz) + 0.14)
    }
    pos.needsUpdate = true
  }

  /** progress 0..1 fills the shape; flash briefly when the attack lands. */
  update(dt: number): void {
    this.life += dt
    const u = this.mat.uniforms
    u.uProg.value = this.progress
    u.uTime.value = this.life
    if (this.fade >= 0) {
      this.fade += dt
      u.uFlash.value = Math.max(0, 1 - this.fade * 5)
      u.uAlpha.value = Math.max(0, 1 - this.fade * 3.5)
      if (this.fade > 0.3) this.alive = false
    }
  }

  /** Attack resolved: flash and fade out. */
  release(): void {
    if (this.fade < 0) this.fade = 0
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.geo.dispose()
    this.mat.dispose()
  }

  get size(): number {
    return this.extent
  }
}

/** Owns every live telegraph; creatures request and release them. */
export class Telegraphs {
  readonly group = new THREE.Group()
  private readonly list: Telegraph[] = []
  constructor(private readonly ground: Ground) {}

  spawn(shape: DecalShape, x: number, z: number, yaw: number, color?: string): Telegraph {
    const t = new Telegraph(this.ground, shape, color)
    t.place(x, z, yaw)
    this.group.add(t.mesh)
    this.list.push(t)
    return t
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i -= 1) {
      const t = this.list[i]
      t.update(dt)
      if (!t.alive) {
        t.dispose()
        this.list.splice(i, 1)
      }
    }
  }

  clear(): void {
    for (const t of this.list) t.dispose()
    this.list.length = 0
  }
}
