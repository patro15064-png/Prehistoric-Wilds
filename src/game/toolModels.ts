import * as THREE from 'three'

/**
 * Procedural flint tools (fallback until the generated GLBs stream in, and for the placeholder
 * rig). Built along +Y with the grip at the origin, head at the top, sized in metres.
 */
const mats = new Map<string, THREE.MeshStandardMaterial>()
function mat(color: string, rough = 0.85, flat = false): THREE.MeshStandardMaterial {
  const k = `${color}|${rough}|${flat}`
  let m = mats.get(k)
  if (!m) mats.set(k, (m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, flatShading: flat })))
  return m
}

function knapped(r: number, sx: number, sy: number, sz: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 1)
  const p = g.getAttribute('position') as THREE.BufferAttribute
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < p.count; i += 1) {
    const k = 0.82 + rnd() * 0.3
    p.setXYZ(i, p.getX(i) * sx * k, p.getY(i) * sy * k, p.getZ(i) * sz * k)
  }
  g.computeVertexNormals()
  return g
}

function lash(parent: THREE.Object3D, y: number, r: number, turns: number, color = '#c9a96e'): void {
  for (let i = 0; i < turns; i += 1) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 4, 10), mat(color, 0.95))
    t.rotation.x = Math.PI / 2 + (i % 2 ? 0.25 : -0.25)
    t.position.y = y + (i - turns / 2) * 0.022
    parent.add(t)
  }
}

export function buildToolModel(kind: 'flintHatchet' | 'flintPick', len: number): THREE.Group {
  const g = new THREE.Group()
  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, len * 1.05, 7).translate(0, len * 0.41, 0), mat('#6e4a2c', 0.9))
  g.add(haft)
  // Leather grip wrap near the base.
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.033, len * 0.26, 8).translate(0, len * 0.05, 0), mat('#4a3322', 0.95))
  g.add(grip)
  const top = len * 0.86
  if (kind === 'flintHatchet') {
    const blade = new THREE.Mesh(knapped(0.1, 1.45, 1.05, 0.32, 11), mat('#7d8a9c', 0.55, true))
    blade.position.set(0.1, top, 0)
    g.add(blade)
    lash(g, top, 0.036, 5)
  } else {
    const spike = new THREE.Mesh(knapped(0.08, 2.2, 0.62, 0.55, 23), mat('#3c3a44', 0.5, true))
    spike.position.set(0.14, top, 0)
    g.add(spike)
    const tine = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.28, 6).rotateZ(Math.PI / 2 + 0.35), mat('#e6dcc4', 0.7))
    tine.position.set(-0.15, top - 0.03, 0)
    g.add(tine)
    lash(g, top, 0.038, 5)
  }
  g.traverse(o => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true
  })
  return g
}
