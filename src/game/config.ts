/**
 * All gameplay tuning in one place. Change numbers here before touching game code; Tweak reads
 * and writes these same values in development previews.
 */
export const DEFAULT_CONFIG = {
  player: {
    radius: 0.55,
    walkSpeed: 5.2,
    sprintSpeed: 8.6,
    acceleration: 38,
    turnSpeed: 12,
    maxStamina: 100,
    /** Stamina regained per second after `staminaDelay` seconds without spending. */
    staminaRegen: 34,
    staminaDelay: 0.55,
    sprintCost: 14,
    dodgeCost: 24,
    dodgeSpeed: 13,
    dodgeTime: 0.42,
    /** Invulnerable window inside the roll, measured from its start. */
    iframeStart: 0.03,
    iframeEnd: 0.3,
    heavyCost: 18,
    healTime: 1.1,
    healAmount: 45,
    /** Health lost per second in the caldera heat zone without heat protection. */
    heatDamage: 7,
  },
  combat: {
    /** Global damage multiplier for the player's attacks. */
    playerDamage: 1,
    /** Global damage multiplier for monster attacks. */
    monsterDamage: 1,
    hitstop: 0.06,
    /** Multiplier on monster windups: >1 makes telegraphs longer and easier to read. */
    telegraphScale: 1,
    lockRange: 34,
  },
  camera: {
    distance: 6.8,
    height: 2.1,
    minPitch: -0.5,
    maxPitch: 1.05,
    follow: 12,
    fov: 60,
  },
  expedition: {
    /** Seconds a depleted gather node takes to regrow. */
    nodeRespawn: 70,
    /** Seconds before a hunted small creature returns. */
    creatureRespawn: 95,
  },
} as const

// Gameplay always reads active values here. Source defaults remain immutable for
// Tweak Reset and Save with Manus; Apply never writes source or local storage.
type MutableConfig<T> = { -readonly [K in keyof T]: T[K] extends number ? number : T[K] extends object ? MutableConfig<T[K]> : T[K] }
export const CONFIG: MutableConfig<typeof DEFAULT_CONFIG> = structuredClone(DEFAULT_CONFIG)
