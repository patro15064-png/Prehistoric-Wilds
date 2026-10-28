import { CONFIG, DEFAULT_CONFIG } from './config'

type Mode = 'LIVE' | 'NEXT_ACTION' | 'NEXT_RUN'
type Boundary = 'dodge' | 'run'
type Control = { id: string; type: 'number'; category: string; label: string; description: string; unit: string;
  default: number; min: number; max: number; step: number; applyMode: Mode; integrity: 'COSMETIC' | 'GAMEPLAY' }
type Binding = { control: Control; boundary?: Boundary; read(): number; write(value: number): void }

const bindings: Binding[] = []
function number<S extends keyof typeof CONFIG>(section: S, key: keyof typeof CONFIG[S] & string,
  label: string, min: number, max: number, step: number, unit: string, boundary?: Boundary): void {
  const values = CONFIG[section] as Record<string, number>
  const defaults = DEFAULT_CONFIG[section] as Record<string, number>
  bindings.push({ control: Object.freeze({ id: `${section}.${key}`, type: 'number', category: section === 'player' ? 'Hunter' : section === 'camera' ? 'Camera' : section === 'combat' ? 'Combat' : 'Expedition',
    label, description: boundary === 'dodge' ? 'Applies when the next dodge starts.' : boundary === 'run' ? 'Applies when a new expedition starts.' : 'Updates this preview immediately.',
    unit, default: defaults[key], min, max, step,
    applyMode: boundary === 'run' ? 'NEXT_RUN' : boundary ? 'NEXT_ACTION' : 'LIVE',
    integrity: section === 'camera' ? 'COSMETIC' : 'GAMEPLAY' }), boundary,
    read: () => values[key], write: value => { values[key] = value } })
}
number('player', 'walkSpeed', 'Walking speed', 1, 12, 0.1, 'm/s')
number('player', 'sprintSpeed', 'Sprint speed', 1, 16, 0.1, 'm/s')
number('player', 'staminaRegen', 'Stamina regen', 5, 80, 1, '/s')
number('player', 'dodgeCost', 'Dodge stamina cost', 0, 60, 1, '')
number('player', 'dodgeSpeed', 'Dodge speed', 6, 22, 0.5, 'm/s', 'dodge')
number('player', 'dodgeTime', 'Dodge duration', 0.2, 0.8, 0.02, 's', 'dodge')
number('player', 'iframeEnd', 'Dodge invulnerability end', 0.05, 0.6, 0.01, 's', 'dodge')
number('combat', 'playerDamage', 'Player damage multiplier', 0.25, 4, 0.05, '×')
number('combat', 'monsterDamage', 'Monster damage multiplier', 0, 3, 0.05, '×')
number('combat', 'telegraphScale', 'Telegraph duration multiplier', 0.5, 2, 0.05, '×')
number('combat', 'hitstop', 'Hitstop', 0, 0.2, 0.01, 's')
number('camera', 'fov', 'Field of view', 40, 100, 1, '°')
number('camera', 'distance', 'Camera distance', 3, 14, 0.1, 'm')
number('camera', 'follow', 'Camera follow speed', 2, 24, 1, '')
number('expedition', 'nodeRespawn', 'Gather node regrow time', 5, 300, 5, 's', 'run')
const byId = new Map(bindings.map(binding => [binding.control.id, binding]))
let requested = Object.fromEntries(bindings.map(({ control }) => [control.id, control.default]))
const valid = (values: Record<string, number>) => values['player.walkSpeed'] <= values['player.sprintSpeed']

let unranked = false
const gameplayModified = () => bindings.some(binding => binding.control.integrity === 'GAMEPLAY' && binding.read() !== binding.control.default)

export const tuning = {
  get unranked(): boolean { return unranked },
  controls: Object.freeze(bindings.map(binding => binding.control)),
  read() {
    return { requested: { ...requested }, active: Object.fromEntries(bindings.map(binding => [binding.control.id, binding.read()])) }
  },
  apply(patch: unknown): void {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid patch')
    const entries = Object.entries(patch)
    if (entries.length > bindings.length) throw new Error('Invalid patch')
    for (const [id, value] of entries) {
      const control = byId.get(id)?.control
      if (!control || typeof value !== 'number' || !Number.isFinite(value) || value < control.min || value > control.max) throw new Error('Invalid value')
      const steps = (value - control.min) / control.step
      if (value !== control.default && Math.abs(steps - Math.round(steps)) > 1e-7) throw new Error('Invalid increment')
    }
    const candidate = { ...requested, ...patch } as Record<string, number>
    const nextActive = this.read().active
    for (const [id, value] of entries) if (byId.get(id)!.control.applyMode === 'LIVE') nextActive[id] = value
    if (!valid(candidate) || !valid(nextActive)) throw new Error('Walking speed must not exceed sprint speed')
    // All writes are simple assignments, synchronously committed before the next
    // physics/render callback. No engine callbacks run during this transaction.
    requested = candidate
    for (const [id, value] of entries) {
      const binding = byId.get(id)!
      if (binding.control.applyMode === 'LIVE') binding.write(value)
    }
    unranked ||= gameplayModified()
  },
  activate(boundary: Boundary): void {
    for (const binding of bindings) if (binding.boundary === boundary) binding.write(requested[binding.control.id])
    // Reset only at a new run; resetting values mid-run cannot restore eligibility.
    unranked = boundary === 'run' ? gameplayModified() : unranked || gameplayModified()
  },
}
