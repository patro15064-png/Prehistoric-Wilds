import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { Colliders } from '../src/game/colliders'
import { Scenery } from '../src/game/scenery'
import { Terrain } from '../src/game/terrain'

describe('scenery placement', () => {
  it('plants every small instance on the terrain surface', async () => {
    const terrain = new Terrain()
    const scene = new THREE.Scene()
    const scenery = new Scenery(scene, terrain, new Colliders(), new Colliders(), 'low')
    await scenery.build(() => {})
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    const bad: string[] = []
    let total = 0
    scene.traverse(o => {
      if (!(o instanceof THREE.InstancedMesh) || !o.frustumCulled) return
      for (let i = 0; i < o.count; i += 1) {
        o.getMatrixAt(i, m)
        p.setFromMatrixPosition(m)
        total += 1
        const h = terrain.heightAt(p.x, p.z)
        if (Math.abs(p.y - h) > 3.5 && o.count > 1) bad.push(`${o.geometry.uuid.slice(0, 4)} n=${o.count} at ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} ground ${h.toFixed(1)}`)
      }
    })
    if (bad.length) console.log(bad.slice(0, 12).join('\n'))
    console.log('instances', total)
    expect(bad.length).toBeLessThan(total * 0.002)
  }, 120000)
})
