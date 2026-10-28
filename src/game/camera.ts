import * as THREE from 'three'
import { CONFIG } from './config'
import type { Ground } from './telegraphs'

const wrap = (a: number) => {
  const T = Math.PI * 2
  a = (a + Math.PI) % T
  return (a < 0 ? a + T : a) - Math.PI
}

/**
 * Third-person orbit camera. Yaw convention matches characters: looking along
 * (sin yaw, cos yaw). Lock-on steers yaw so the target stays framed beyond the hunter.
 */
export class OrbitCamera {
  readonly camera: THREE.PerspectiveCamera
  yaw = Math.PI
  pitch = 0.32
  private dist: number = CONFIG.camera.distance
  private readonly focus = new THREE.Vector3()
  private readonly look = new THREE.Vector3()
  private shakeT = 0

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, aspect, 0.3, 3200)
  }

  snap(target: THREE.Vector3, yaw: number): void {
    this.yaw = yaw
    this.focus.copy(target)
    this.look.copy(target)
  }

  update(dt: number, target: THREE.Vector3, look: { x: number; y: number }, lockOn: THREE.Vector3 | null, ground: Ground, shake: number, bigTarget = 0, blockers?: { clear(x: number, z: number, r: number): boolean }): void {
    const C = CONFIG.camera
    this.camera.fov = C.fov
    this.yaw -= look.x
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.y, C.minPitch, C.maxPitch)
    const f = 1 - Math.exp(-C.follow * dt)
    this.focus.lerp(target, f)
    let wantDist = C.distance + bigTarget * 3.5
    if (lockOn) {
      const want = Math.atan2(lockOn.x - this.focus.x, lockOn.z - this.focus.z)
      this.yaw += wrap(want - this.yaw) * (1 - Math.exp(-5 * dt))
      const dy = lockOn.y - this.focus.y
      const flat = Math.hypot(lockOn.x - this.focus.x, lockOn.z - this.focus.z)
      const wantPitch = THREE.MathUtils.clamp(0.28 - Math.atan2(dy, Math.max(flat, 2)) * 0.5 + bigTarget * 0.08, C.minPitch, 0.75)
      this.pitch += (wantPitch - this.pitch) * (1 - Math.exp(-3 * dt))
    }
    this.yaw = wrap(this.yaw)
    // Pull in when terrain blocks the view.
    const head = this.focus.clone()
    head.y += C.height
    const back = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch))
    let d = wantDist
    for (let s = 0.1; s <= 1.0001; s += 0.1) {
      const px = head.x + back.x * wantDist * s
      const py = head.y + back.y * wantDist * s
      const pz = head.z + back.z * wantDist * s
      const gy = ground.heightAt(px, pz)
      // Terrain, or a trunk/rock/camp collider at trunk height, blocks the view: pull in.
      if (gy + 0.5 > py || (blockers && py < gy + 7 && s * wantDist > 1.2 && !blockers.clear(px, pz, 0.45))) {
        d = Math.max(1.6, wantDist * (s - 0.1))
        break
      }
    }
    this.dist += (d - this.dist) * (1 - Math.exp(-(d < this.dist ? 18 : 3) * dt))
    const pos = head.clone().addScaledVector(back, this.dist)
    const floor = ground.surfaceAt(pos.x, pos.z) + 0.6
    if (pos.y < floor) pos.y = floor
    this.shakeT += dt * 40
    if (shake > 0) {
      const a = shake * shake * 0.35
      pos.x += Math.sin(this.shakeT * 1.3) * a
      pos.y += Math.sin(this.shakeT * 1.7 + 1) * a
      pos.z += Math.cos(this.shakeT * 1.1) * a
    }
    this.camera.position.copy(pos)
    const lookAt = head.clone()
    if (lockOn) lookAt.lerp(lockOn, 0.25)
    this.look.lerp(lookAt, 1 - Math.exp(-14 * dt))
    this.camera.lookAt(this.look)
  }
}
