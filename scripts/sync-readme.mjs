#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

const README_PATH = path.join(ROOT, 'README.md')
const PKG_PATH = path.join(ROOT, 'package.json')
const UI_PATH = path.join(ROOT, 'src', 'ui', 'ui.ts')

// Read package.json
const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'))
const threeVer = (pkg.dependencies?.['three'] || '0.186.1').replace(/^[^\d]*/, '')
const tsVer = (pkg.devDependencies?.['typescript'] || '5.9.3').replace(/^[^\d]*/, '')
const viteVer = (pkg.devDependencies?.['vite'] || '8.3.1').replace(/^[^\d]*/, '')
const vitestVer = (pkg.devDependencies?.['vitest'] || '5.0.2').replace(/^[^\d]*/, '')

// Generate Badges Section
function generateBadges() {
  return [
    `[![Three.js](https://img.shields.io/badge/Three.js-${threeVer}-black?logo=three.js)](https://threejs.org/)`,
    `[![TypeScript](https://img.shields.io/badge/TypeScript-${tsVer}-blue?logo=typescript)](https://www.typescriptlang.org/)`,
    `[![Vite](https://img.shields.io/badge/Vite-${viteVer}-646CFF?logo=vite)](https://vitejs.dev/)`,
    `[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare_Pages-Ready-F38020?logo=cloudflare)](https://pages.cloudflare.com/)`,
    `[![Vitest](https://img.shields.io/badge/Vitest-${vitestVer}-729B1B?logo=vitest)](https://vitest.dev/)`,
  ].join('\n')
}

// Format Keys & Action Names for Table
function formatKeyboard(keyStr) {
  const custom = {
    'W A S D': '<kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>',
    'Mouse': 'Mouse (pointer lock)',
    'Left click · J': 'Left Click / <kbd>J</kbd>',
    'Hold right click · K': 'Hold Right Click / <kbd>K</kbd>',
    'Space': '<kbd>Space</kbd>',
    'Shift': 'Hold <kbd>Shift</kbd>',
    'E': '<kbd>E</kbd>',
    '1 2 3 4 · F': '<kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> / <kbd>F</kbd>',
    'Attack a tree / boulder': 'Attack tree / boulder',
    'G': '<kbd>G</kbd>',
    'C': '<kbd>C</kbd>',
    'E on tracks': '<kbd>E</kbd> on tracks',
    'B': '<kbd>B</kbd>',
    'Q · Middle click': '<kbd>Q</kbd> / Middle Click',
    'R': '<kbd>R</kbd>',
    'Tab': '<kbd>Tab</kbd>',
    'M': '<kbd>M</kbd>',
    'H': '<kbd>H</kbd>',
    'Esc': '<kbd>Esc</kbd>',
  }
  return custom[keyStr] || keyStr
}

function formatAction(desc) {
  const custom = {
    'Move': '**Move**',
    'Look around': '**Look / Aim**',
    'Light attack (3-hit combo)': '**Light Attack** (3-hit combo)',
    'Charged heavy (3 levels)': '**Charged Heavy Attack** (3 levels)',
    'Dodge roll (invulnerable i-frames)': '**Dodge Roll** (i-frames)',
    'Sprint': '**Sprint**',
    'Gather · Carve · Use camp': '**Interact / Gather / Carve**',
    'Hold weapon · hatchet · pick · fists': '**Tool / Weapon Hotbar**',
    'Chop wood · mine stone': '**Direct Environmental Harvest**',
    'Use gadget: snare · pitfall · flash pod': '**Deploy Gadget** (Snare / Trap / Flash)',
    'Cycle gadget': '**Cycle Active Gadget**',
    'Study clues (3 clues = tracked)': '**Study Wildlife Clues** (3 = tracked)',
    "Hunter's journal": "**Hunter's Journal**",
    'Lock on / release': '**Lock-On Target**',
    'Apply poultice': '**Apply Poultice** (Heal)',
    'Satchel & crafting': '**Satchel & Crafting**',
    'Island map': '**Island Map**',
    'This controls card': '**Controls Help Card**',
    'Pause': '**Pause / Resume**',
  }
  return custom[desc] || `**${desc}**`
}

const GAMEPAD_MAP = {
  'W A S D': 'Left Stick',
  'Mouse': 'Right Stick',
  'Left click · J': '<kbd>X</kbd> (Square)',
  'Hold right click · K': 'Hold <kbd>Y</kbd> (Triangle)',
  'Space': '<kbd>A</kbd> (Cross)',
  'Shift': '<kbd>L3</kbd> / <kbd>LB</kbd>',
  'E': '<kbd>B</kbd> (Circle)',
  '1 2 3 4 · F': 'D-Pad Left / Right',
  'Attack a tree / boulder': 'Attack',
  'G': 'D-Pad Down',
  'C': 'D-Pad Up',
  'E on tracks': '<kbd>B</kbd> (Circle)',
  'B': '—',
  'Q · Middle click': '<kbd>R3</kbd> / <kbd>RB</kbd>',
  'R': '<kbd>LB</kbd>',
  'Tab': 'Select / Back',
  'M': 'Touchpad / View',
  'H': '—',
  'Esc': 'Start / Menu',
}

// Extract and Generate Controls Table from src/ui/ui.ts
function generateControlsTable() {
  const uiContent = fs.readFileSync(UI_PATH, 'utf-8')
  const match = uiContent.match(/const\s+CONTROLS:\s*\[string,\s*string\]\[\]\s*=\s*\[([\s\S]*?)\]\s*(?:const|let|var|function|class)/)

  const rows = [
    '| Action | Keyboard & Mouse | Gamepad |',
    '| :--- | :--- | :--- |',
  ]

  if (match) {
    const rawPairs = [...match[1].matchAll(/\['([^']+)',\s*'([^']+)'\]/g)]
    for (const [, k, desc] of rawPairs) {
      const formattedKeys = formatKeyboard(k)
      const actionTitle = formatAction(desc)
      const gp = GAMEPAD_MAP[k] || '—'
      rows.push(`| ${actionTitle} | ${formattedKeys} | ${gp} |`)
    }
  }

  return rows.join('\n')
}

// Generate Project Structure
function generateProjectStructure() {
  return [
    '```',
    '├── public/                 # Static assets copied directly to dist',
    '│   ├── _headers            # Cloudflare Pages security & caching headers',
    '│   ├── _redirects          # Cloudflare Pages redirect rules',
    '│   ├── _routes.json        # Cloudflare Pages static routing definition',
    '│   ├── audio/              # Ambient loops, music stems, and combat SFX',
    '│   ├── fonts/              # Subsetted variable web fonts (Sora, Figtree)',
    '│   ├── models/             # Optimized glTF binary models (hunter, creatures, env)',
    '│   ├── ui/                 # Hand-crafted WebP UI frames, medallions, and item icons',
    '│   └── vfx/                # Additive particle sprites, slashes, and impact decals',
    '├── src/',
    '│   ├── engine/             # Core scaffolding (loop, input, audio, assets, renderer, save)',
    '│   ├── game/               # Gameplay logic, heightfield terrain, hunter, creatures, camp, rules',
    '│   ├── ui/                 # High-performance HTML/CSS HUD, satchel, journal, and canvas map',
    '│   ├── lab/                # 3D Enemy Laboratory inspector (/enemies)',
    '│   ├── styles/             # Modular CSS design system and tribal styling',
    '│   └── main.ts             # Application bootstrap and lifecycle orchestration',
    '├── tests/                  # Unit and integration test suites (vitest)',
    '├── scripts/                # Asset optimization, size budget checks, Playwright smoke tests & doc sync',
    '├── enemies/                # Multi-page HTML entry point for the Enemy Lab',
    '├── wrangler.toml           # Cloudflare Pages configuration',
    '├── .nvmrc                  # Node.js version pin (Node 20 LTS)',
    '└── vite.config.ts          # Vite bundler configuration with multi-page rollup inputs',
    '```',
  ].join('\n')
}

// Generate Local Development / Scripts Section
function generateScriptsSection() {
  return [
    '```bash',
    '# Run unit & integration test suites',
    'npm test',
    '',
    '# Run TypeScript typechecker',
    'npm run typecheck',
    '',
    '# Build production bundle with automated doc sync & size check',
    'npm run build',
    '',
    '# Run end-to-end headless browser smoke test',
    'npm run smoke',
    '',
    '# Auto-sync README documentation with codebase',
    'npm run sync:docs',
    '```',
  ].join('\n')
}

// Stale keywords and forbidden phrases check
const FORBIDDEN_PATTERNS = [
  { pattern: /refund\s+stamina\s+and\s+grant\s+tactical\s+counter-windows/i, replacement: 'fluid invulnerability frames and tactical counter-windows' },
  { pattern: /grant\s+tactical\s+counter-windows\s+and\s+grant\s+tactical\s+counter-windows/i, replacement: 'fluid invulnerability frames and tactical counter-windows' },
  { pattern: /refund\s+stamina/i, replacement: 'grant tactical counter-windows' },
  { pattern: /refunds\s+stamina/i, replacement: 'grants tactical counter-windows' },
  { pattern: /costs\s+stamina/i, replacement: 'costs hunger' },
  { pattern: /stamina\s+bar/i, replacement: 'hunger bar' },
  { pattern: /stamina\s+refund/i, replacement: 'tactical counter-window' },
  { pattern: /Sky\s+Cores/i, replacement: 'Island Relics' },
]

function sanitizeContent(content) {
  let modified = content
  for (const { pattern, replacement } of FORBIDDEN_PATTERNS) {
    if (pattern.test(modified)) {
      modified = modified.replace(new RegExp(pattern, 'g'), replacement)
    }
  }
  return modified
}

function syncReadme(isCheckMode = false) {
  let content = fs.readFileSync(README_PATH, 'utf-8')
  let originalContent = content

  // 1. Sanitize any forbidden stale terms
  content = sanitizeContent(content)

  // 2. Replace or inject BADGES block
  const badgeStart = '<!-- AUTOSYNC:BADGES:START -->'
  const badgeEnd = '<!-- AUTOSYNC:BADGES:END -->'
  const badgeContent = `${badgeStart}\n${generateBadges()}\n${badgeEnd}`
  if (content.includes(badgeStart) && content.includes(badgeEnd)) {
    content = content.replace(new RegExp(`${badgeStart}[\\s\\S]*?${badgeEnd}`), badgeContent)
  } else {
    content = content.replace(/\[!\[Three\.js\][\s\S]*?\[!\[Vitest\][^\n]+\)/, badgeContent)
  }

  // 3. Replace or inject CONTROLS block
  const ctrlStart = '<!-- AUTOSYNC:CONTROLS:START -->'
  const ctrlEnd = '<!-- AUTOSYNC:CONTROLS:END -->'
  const ctrlContent = `${ctrlStart}\n${generateControlsTable()}\n${ctrlEnd}`
  if (content.includes(ctrlStart) && content.includes(ctrlEnd)) {
    content = content.replace(new RegExp(`${ctrlStart}[\\s\\S]*?${ctrlEnd}`), ctrlContent)
  } else {
    content = content.replace(/## Controls\s*\n\n\| Action[\s\S]*?\n\n---/, `## Controls\n\n${ctrlContent}\n\n---`)
  }

  // 4. Replace or inject STRUCTURE block
  const structStart = '<!-- AUTOSYNC:STRUCTURE:START -->'
  const structEnd = '<!-- AUTOSYNC:STRUCTURE:END -->'
  const structContent = `${structStart}\n${generateProjectStructure()}\n${structEnd}`
  if (content.includes(structStart) && content.includes(structEnd)) {
    content = content.replace(new RegExp(`${structStart}[\\s\\S]*?${structEnd}`), structContent)
  } else {
    content = content.replace(/## Project Structure\s*\n\n```[\s\S]*?```/, `## Project Structure\n\n${structContent}`)
  }

  // 5. Replace or inject SCRIPTS block
  const scriptsStart = '<!-- AUTOSYNC:SCRIPTS:START -->'
  const scriptsEnd = '<!-- AUTOSYNC:SCRIPTS:END -->'
  const scriptsContent = `${scriptsStart}\n${generateScriptsSection()}\n${scriptsEnd}`
  if (content.includes(scriptsStart) && content.includes(scriptsEnd)) {
    content = content.replace(new RegExp(`${scriptsStart}[\\s\\S]*?${scriptsEnd}`), scriptsContent)
  } else if (content.includes('### Testing & Validation')) {
    content = content.replace(/### Testing & Validation\s*```bash[\s\S]*?```/, `### Testing & Validation\n\n${scriptsContent}`)
  }

  // 6. Ensure Dodge roll is accurately phrased without stamina
  content = content.replace(
    /- \*\*Dodge Roll with i-Frames\*\*:.*$/m,
    '- **Dodge Roll with i-Frames**: Evade telegraphed damage zones with fluid invulnerability frames and tactical counter-windows.'
  )

  // 7. Ensure Hunger & Health dynamics are properly documented under Survival
  if (!content.includes('Action-Driven Hunger')) {
    content = content.replace(
      '### 🍖 Survival, Cooking & Traps',
      `### 🍖 Survival, Cooking & Traps\n- **Action-Driven Hunger**: Hunger drains dynamically through activity (sprinting burns 1.0/s, walking burns 0.35/s) with near-zero idle drain (0.005/s - >33 min per 10%). Satiate hunger by cooking hearth meals or hunting game. Unconstrained actions: dodge rolls and sprints are free of artificial stamina bar locks.`
    )
  }

  const hasDiff = content !== originalContent

  if (isCheckMode) {
    if (hasDiff) {
      console.error('❌ README.md is out of sync with project code/metadata!')
      console.error('Run `npm run sync:docs` to automatically synchronize README.md.')
      process.exit(1)
    } else {
      console.log('✅ README is 100% synchronized with codebase and metadata.')
      process.exit(0)
    }
  } else {
    if (hasDiff) {
      fs.writeFileSync(README_PATH, content, 'utf-8')
      console.log('✅ README.md successfully synchronized with project code, controls, and dependencies.')
    } else {
      console.log('✅ README.md is already up to date.')
    }
  }
}

const isCheck = process.argv.includes('--check')
syncReadme(isCheck)
