/** Static circular obstacles in a spatial hash; characters push out of them. */
export class Colliders {
  private readonly cell = 8
  private readonly grid = new Map<number, number[]>()
  readonly xs: number[] = []
  readonly zs: number[] = []
  readonly rs: number[] = []

  private key(ix: number, iz: number): number {
    return (ix + 512) * 4096 + (iz + 512)
  }

  add(x: number, z: number, r: number): number {
    const id = this.xs.length
    this.xs.push(x)
    this.zs.push(z)
    this.rs.push(r)
    // Margin covers the querying circle's radius, so lookups only need the centre cell.
    const m = r + 3
    const i0 = Math.floor((x - m) / this.cell)
    const i1 = Math.floor((x + m) / this.cell)
    const j0 = Math.floor((z - m) / this.cell)
    const j1 = Math.floor((z + m) / this.cell)
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const k = this.key(i, j)
        let list = this.grid.get(k)
        if (!list) this.grid.set(k, (list = []))
        list.push(id)
      }
    }
    return id
  }

  /** Disable a collider (e.g. a camp structure that gets replaced). */
  disable(id: number): void {
    this.rs[id] = 0
  }
  /** Re-enable a disabled collider with its radius (must not exceed the registered radius). */
  enable(id: number, r: number): void {
    this.rs[id] = r
  }

  /** Push a circle at (x, z) out of every overlapping obstacle. Returns the corrected point. */
  resolve(x: number, z: number, radius: number, out = { x: 0, z: 0, hit: false }): { x: number; z: number; hit: boolean } {
    out.x = x
    out.z = z
    out.hit = false
    const list = this.grid.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)))
    if (!list) return out
    for (let pass = 0; pass < 2; pass += 1) {
      for (const id of list) {
        const r = this.rs[id] + radius
        if (r <= radius) continue
        const dx = out.x - this.xs[id]
        const dz = out.z - this.zs[id]
        const d2 = dx * dx + dz * dz
        if (d2 >= r * r) continue
        const d = Math.sqrt(d2) || 1e-4
        out.x = this.xs[id] + (dx / d) * r
        out.z = this.zs[id] + (dz / d) * r
        out.hit = true
      }
    }
    return out
  }

  /** Is the point clear of obstacles (used by scatter and spawn placement)? */
  clear(x: number, z: number, radius: number): boolean {
    const list = this.grid.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)))
    if (!list) return true
    for (const id of list) {
      const r = this.rs[id] + radius
      const dx = x - this.xs[id]
      const dz = z - this.zs[id]
      if (dx * dx + dz * dz < r * r) return false
    }
    return true
  }
}
