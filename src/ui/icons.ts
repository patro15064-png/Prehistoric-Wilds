import type { IconId } from '../game/data'

/** Original flat SVG icons (24×24). `c` is the item colour; strokes use a dark ink. */
const INK = '#2a1c14'
const P: Record<IconId, (c: string) => string> = {
  log: c => `<rect x="3" y="8" width="18" height="8" rx="4" fill="${c}" stroke="${INK}" stroke-width="1.5"/><ellipse cx="19" cy="12" rx="2.5" ry="4" fill="#e8c28e" stroke="${INK}" stroke-width="1.5"/><path d="M6 10.5h7M7 13.5h8" stroke="${INK}" stroke-width="1" opacity=".5"/>`,
  rock: c => `<path d="M4 17 6 9l5-4 6 2 3 6-2 5H6Z" fill="${c}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 10l3-2 4 1" stroke="#fff" stroke-width="1" opacity=".5" fill="none"/>`,
  reed: c => `<path d="M8 21c0-6 1-11 3-17M12 21c0-6 0-10 1-16M16 21c0-5-1-9-3-14" stroke="${c}" stroke-width="2.2" stroke-linecap="round" fill="none"/><path d="M8 21c0-6 1-11 3-17" stroke="${INK}" stroke-width=".8" fill="none" opacity=".5"/><ellipse cx="11" cy="4.5" rx="1.4" ry="2.4" fill="#d9c07a" stroke="${INK}"/>`,
  flint: c => `<path d="M12 3 19 10 15 21 7 18 5 9Z" fill="${c}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 3 11 12 15 21M5 9l6 3 8-2" stroke="#fff" stroke-width="1" opacity=".45" fill="none"/>`,
  bone: c => `<path d="M7 5a2.5 2.5 0 0 0-2 4l10 10a2.5 2.5 0 1 0 4-2 2.5 2.5 0 1 0-2-4L7 3a2.5 2.5 0 1 0-2 4 2.5 2.5 0 0 0 2-2Z" fill="${c}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>`,
  herb: c => `<path d="M12 21V11" stroke="#4f8a34" stroke-width="2"/><path d="M12 12C6 12 4 7 5 4c4 0 8 2 7 8ZM12 13c5 0 7-4 7-7-4 0-7 2-7 7Z" fill="${c}" stroke="${INK}" stroke-width="1.4"/>`,
  crystal: c => `<path d="M12 2 17 8 15 20H9L7 8Z" fill="${c}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 2v18M7 8h10" stroke="#fff6c0" stroke-width="1" opacity=".6"/><circle cx="12" cy="11" r="5" fill="${c}" opacity=".25"/>`,
  shard: c => `<path d="M9 21 5 12 10 3l3 8 6-3-4 13Z" fill="${c}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 3l-1 18M13 11l6-3" stroke="#c7a0ff" stroke-width="1" opacity=".7"/>`,
  sulfur: c => `<path d="M4 18 7 10l3 3 2-7 3 6 2-2 3 8Z" fill="${c}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="6" r="1.2" fill="${c}"/><circle cx="17" cy="7" r="1" fill="${c}"/>`,
  tusk: c => `<path d="M5 20C5 11 10 5 19 4c-5 3-8 8-8 16Z" fill="${c}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M5 20h6" stroke="${INK}" stroke-width="2"/>`,
  hide: c => `<path d="M6 4h12l2 5-2 3 2 4-3 5H7l-3-5 2-4-2-3Z" fill="${c}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 9h6M9 13h6M10 17h4" stroke="${INK}" stroke-width="1" opacity=".4"/>`,
  scale: c => `<path d="M12 3c5 3 7 7 7 11a7 7 0 0 1-14 0c0-4 2-8 7-11Z" fill="${c}" stroke="${INK}" stroke-width="1.5"/><path d="M12 6v14M8 12c2 1 6 1 8 0" stroke="#fff" stroke-width="1" opacity=".45" fill="none"/>`,
  claw: c => `<path d="M6 20c0-7 3-13 11-16-3 4-4 7-3 11l-3 5Z" fill="${c}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 20c1-4 3-7 7-9-1 3-2 6-4 9Z" fill="${c}" stroke="${INK}" stroke-width="1.3"/>`,
  shell: c => `<path d="M3 15a9 8 0 0 1 18 0v2H3Z" fill="${c}" stroke="${INK}" stroke-width="1.5"/><path d="M12 7v10M7 9l2 8M17 9l-2 8" stroke="#ffb070" stroke-width="1.2"/>`,
  pelt: c => `<path d="M5 6c3-2 11-2 14 0l-1 5 2 3-3 2 1 4-4-1-2 2-2-2-4 1 1-4-3-2 2-3Z" fill="${c}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 8l1 3M15 8l-1 3M12 10v4" stroke="#ff9a4a" stroke-width="1.2"/>`,
  plate: c => `<path d="M4 7 12 3l8 4v7l-8 7-8-7Z" fill="${c}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M4 7l8 4 8-4M12 11v10" stroke="${INK}" stroke-width="1" opacity=".45"/>`,
  horn: c => `<path d="M6 21c1-7 2-12 9-18 1 6-1 11-4 14Z" fill="${c}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 16l3 1M10 12l3 1M12 8l2 1" stroke="${INK}" stroke-width="1" opacity=".5"/>`,
  crest: c => `<path d="M12 2 15 8l6 1-4 5 1 7-6-3-6 3 1-7-4-5 6-1Z" fill="${c}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.6" fill="#fff4c0" stroke="${INK}"/>`,
  heart: c => `<path d="M12 20S3 14 3 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 9 2.5C21 14 12 20 12 20Z" fill="${c}" stroke="${INK}" stroke-width="1.5"/><path d="M9 9c1 2 2 3 3 6 1-3 2-4 3-6" stroke="#ffe07a" stroke-width="1.4" fill="none"/>`,
  potion: c => `<path d="M9 3h6v4l4 6a5 5 0 0 1-4 8H9a5 5 0 0 1-4-8l4-6Z" fill="${c}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 3h8" stroke="${INK}" stroke-width="2"/><path d="M7 14h10" stroke="#fff" opacity=".5"/>`,
  meat: c => `<path d="M5 14c0-5 5-9 10-8 3 1 4 4 3 7-1 4-6 7-10 6-2-1-3-3-3-5Z" fill="${c}" stroke="${INK}" stroke-width="1.4"/><path d="M16 12l4 4" stroke="#f4ead2" stroke-width="2.4" stroke-linecap="round"/><circle cx="20.5" cy="16.5" r="1.6" fill="#f4ead2" stroke="${INK}"/>`,
  mushroom: c => `<path d="M11 21v-8M15 21v-5" stroke="#dfeee6" stroke-width="2.2" stroke-linecap="round"/><path d="M5 13a6 5 0 0 1 12 0Z" fill="${c}" stroke="${INK}" stroke-width="1.4"/><path d="M12 16a4 3 0 0 1 8 0Z" fill="${c}" stroke="${INK}" stroke-width="1.2"/>`,
  snare: c => `<circle cx="12" cy="13" r="7" fill="none" stroke="${c}" stroke-width="2.6"/><circle cx="12" cy="13" r="7" fill="none" stroke="${INK}" stroke-width=".8" opacity=".6"/><path d="M17 5l3-3M18 3l1 5" stroke="#9a6a40" stroke-width="1.8" stroke-linecap="round"/>`,
  pit: c => `<ellipse cx="12" cy="15" rx="9" ry="4.5" fill="#2a1e14" stroke="${INK}" stroke-width="1.4"/><path d="M3 12l18 5M5 17l15-6" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/>`,
  pod: c => `<circle cx="12" cy="13" r="7" fill="${c}" stroke="${INK}" stroke-width="1.4"/><path d="M12 6c0-2 1-3 3-4" stroke="#6a8a3a" stroke-width="1.6" fill="none"/><circle cx="10" cy="11" r="2" fill="#fff" opacity=".8"/>`,
}

export function icon(id: IconId, color: string, size = 28): string {
  return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${P[id](color)}</svg>`
}

/** Gear glyphs for the craft/gear lists. */
export function gearIcon(slot: 'weapon' | 'armor' | 'tool', tier: number, size = 34): string {
  const tint = ['#b07a47', '#6d7f96', '#ffb23e', '#7a3aff'][Math.min(3, tier)]
  const body =
    slot === 'weapon'
      ? `<path d="M6 20 15 8" stroke="#7a4e2c" stroke-width="2.4" stroke-linecap="round"/><path d="M13 3l7 3-2 6-6-2Z" fill="${tint}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>`
      : slot === 'armor'
        ? `<path d="M7 3h10l3 5-3 2v10H7V10L4 8Z" fill="${tint}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/><path d="M9 12h6M9 15h6" stroke="${INK}" opacity=".45"/>`
        : `<path d="M5 20 14 11" stroke="#7a4e2c" stroke-width="2.4" stroke-linecap="round"/><path d="M11 5c4-2 8 0 9 3-3-1-5 0-6 2Z" fill="${tint}" stroke="${INK}" stroke-width="1.4"/>`
  return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`
}
