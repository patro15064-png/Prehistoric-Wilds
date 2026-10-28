import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ARENAS, PATHS, POI, Terrain, WORLD } from '../src/game/terrain'

const terrain = new Terrain()

/** Walk a straight line in small steps using the same rule characters use. */
function walkLine(ax: number, az: number, bx: number, bz: number): { ok: boolean; at?: string } {
  const d = Math.hypot(bx - ax, bz - az)
  const steps = Math.ceil(d / 0.12)
  let px = ax
  let pz = az
  for (let s = 1; s <= steps; s += 1) {
    const x = ax + ((bx - ax) * s) / steps
    const z = az + ((bz - az) * s) / steps
    if (!terrain.canStep(px, pz, x, z)) return { ok: false, at: `${x.toFixed(1)},${z.toFixed(1)} h=${terrain.heightAt(x, z).toFixed(1)}` }
    px = x
    pz = z
  }
  return { ok: true }
}

describe('terrain', () => {
  it('keeps every designed route walkable in both directions', () => {
    for (const path of PATHS) {
      for (let i = 0; i < path.length - 1; i += 1) {
        const [ax, az] = path[i]
        const [bx, bz] = path[i + 1]
        expect(walkLine(ax, az, bx, bz), `forward ${ax},${az} → ${bx},${bz}`).toEqual({ ok: true })
        expect(walkLine(bx, bz, ax, az), `back ${bx},${bz} → ${ax},${az}`).toEqual({ ok: true })
      }
    }
  })

  it('places the camp and landmarks on dry land in the intended regions', () => {
    expect(terrain.regionAt(POI.camp.x, POI.camp.z)).toBe('coast')
    expect(terrain.regionAt(ARENAS.ruins.x, ARENAS.ruins.z)).toBe('highlands')
    expect(terrain.regionAt(ARENAS.wyrm.x, ARENAS.wyrm.z)).toBe('caldera')
    for (const p of Object.values(POI)) {
      if (p === POI.seaArch) continue
      expect(terrain.heightAt(p.x, p.z), JSON.stringify(p)).toBeGreaterThan(WORLD.sea + 0.3)
    }
  })

  it('keeps boss arenas solid, flat and free of lava', () => {
    for (const a of [ARENAS.ruins, ARENAS.wyrm]) {
      const y0 = terrain.heightAt(a.x, a.z)
      for (let k = 0; k < 48; k += 1) {
        const ang = (k / 48) * Math.PI * 2
        for (const f of [0.3, 0.6, 0.9]) {
          const x = a.x + Math.cos(ang) * a.radius * f
          const z = a.z + Math.sin(ang) * a.radius * f
          expect(terrain.walkable(x, z)).toBe(true)
          expect(Math.abs(terrain.heightAt(x, z) - y0)).toBeLessThan(1.6)
        }
      }
    }
  })

  it('has lava inside the crater and a heat zone around it', () => {
    let lava = 0
    for (let x = -60; x < 30; x += 2) for (let z = -220; z < -140; z += 2) if (terrain.isLava(x, z)) lava += 1
    expect(lava).toBeGreaterThan(40)
    expect(terrain.heatAt(ARENAS.wyrm.x, ARENAS.wyrm.z)).toBe(1)
    expect(terrain.heatAt(POI.camp.x, POI.camp.z)).toBe(0)
  })

  it.runIf(process.env.DUMP_TERRAIN)('dumps the heightmap for inspection', () => {
    writeFileSync('shots/heights.bin', Buffer.from(terrain.heights.buffer))
    writeFileSync('shots/trail.bin', Buffer.from(terrain.trail.buffer))
    writeFileSync('shots/terrain.json', JSON.stringify({ N: terrain.N, half: WORLD.half, falls: terrain.falls }))
  })
})
