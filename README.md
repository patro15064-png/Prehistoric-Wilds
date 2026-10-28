# Prehistoric Wilds

[![Three.js](https://img.shields.io/badge/Three.js-0.186.1-black?logo=three.js)](https://threejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.3.1-646CFF?logo=vite)](https://vitejs.dev/)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare_Pages-Ready-F38020?logo=cloudflare)](https://pages.cloudflare.com/)
[![Vitest](https://img.shields.io/badge/Vitest-5.0.2-729B1B?logo=vitest)](https://vitest.dev/)

**Prehistoric Wilds** is a stylized 3D browser-based action-hunting and crafting expedition built with Three.js, TypeScript, and Vite. Explore the untamed biomes of Cinderfall Isle, hunt ferocious apex beasts with telegraphed combat, chop trees, mine boulders, track wildlife clues, cook hearty meals, upgrade your base camp across three stages, and relight the ancient signal tower.

---

## Gameplay Highlights

### ⚔️ Telegraphed Action Combat
- **Combos & Heavy Strikes**: Fluid 3-hit light attack combo and a 3-level charged heavy attack that staggers enemies and breaks poise.
- **Dodge Roll with i-Frames**: Evade telegraphed damage zones. Perfect dodge rolls refund stamina and grant tactical counter-windows.
- **Lock-On Targeting**: Smooth orbit camera with terrain collision clearance and dynamic target locking (<kbd>Q</kbd> / Middle Mouse).
- **Poultices**: Gather herbs and craft Mendleaf Poultices (<kbd>R</kbd>) to recover health during encounters.

### 🏹 4 Distinct Weapon Classes
- **Club / Maul**: Heavy blunt weapon dealing immense poise damage and high stagger multipliers.
- **Greatsword / Blade**: Sweeping cutting arcs for crowd control and tail/flank severance.
- **Spear**: Long reach thrusts with an exclusive **counter-thrust** mechanic triggered immediately following a perfect dodge.
- **Sling**: Ranged projectile weapon consuming Stone ammunition. Precise headshots disrupt and stagger beasts from afar.

### 🪓 Minecraft-Style Harvesting & Tools
- Direct environmental harvesting: attack trees to harvest Wood, or strike boulders for Stone and Flint.
- Switch weapons and specialized tools via hotbar (<kbd>1</kbd>–<kbd>4</kbd> or <kbd>F</kbd>):
  - **Flint Hatchet**: Rapid wood chopping and tree felling.
  - **Flint Pick**: Mines mineral veins, amber, and hardened obsidian.
  - **Bare Hands & Weapons**: Emergency resource gathering.
- Natural resource respawning when traveling away from depleted areas.

### 🍖 Survival, Cooking & Traps
- **Campfire Cooking**: Roast meals at the camp hearth featuring an interactive **Sear QTE Gauge**. Hit the gold band with <kbd>Space</kbd> or <kbd>E</kbd> for extended 50% buff durations.
- **Survival Gadgets** (<kbd>G</kbd> to deploy, <kbd>C</kbd> to cycle):
  - **Snare**: Trips charging predators in their tracks.
  - **Pitfall Trap**: Immobilizes larger beasts, leaving them vulnerable to heavy damage.
  - **Flash Pod**: Blinds and interrupts charging attacks and windups.

### 🐾 Tracking, Ecology & Bestiary
- Follow glowing scent fireflies, footprints, and animal markings. Studying 3 clues for a species enables live HUD tracking.
- Dynamic predator-prey ecology: witness apex beasts hunt herbivores across the savanna and jungle.
- Access the **Hunter's Journal** (<kbd>B</kbd>) to review bestiary stats, ecological behavior, elemental weaknesses, and rare carves.

### 🏕️ Base Camp & Signal Tower Victory
- Expand your settlement from ruined rubble (Stage 0) to a roaring Hearth (Stage 1), defensive Palisade (Stage 2), and impenetrable Stonehold (Stage 3).
- Defeat the island's two apex beasts (**Ruinhorn** and **Vulkarr**) to recover ancient relics, rebuild the summit Signal Tower, and summon rescue.

---

## Controls

| Action | Keyboard & Mouse | Gamepad |
| :--- | :--- | :--- |
| **Move** | <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | Left Stick |
| **Look / Aim** | Mouse (pointer lock) | Right Stick |
| **Light Attack (3-hit combo)** | Left Click / <kbd>J</kbd> | <kbd>X</kbd> (Square) |
| **Charged Heavy Attack** | Hold Right Click / <kbd>K</kbd> | Hold <kbd>Y</kbd> (Triangle) |
| **Dodge Roll (i-frames)** | <kbd>Space</kbd> | <kbd>A</kbd> (Cross) |
| **Sprint** | Hold <kbd>Shift</kbd> | <kbd>L3</kbd> / <kbd>LB</kbd> |
| **Interact / Gather / Carve** | <kbd>E</kbd> | <kbd>B</kbd> (Circle) |
| **Tool / Weapon Hotbar** | <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> / <kbd>F</kbd> | D-Pad Left / Right |
| **Use Gadget (Trap / Flash)** | <kbd>G</kbd> | D-Pad Down |
| **Cycle Gadget** | <kbd>C</kbd> | D-Pad Up |
| **Apply Poultice (Heal)** | <kbd>R</kbd> | <kbd>RB</kbd> |
| **Lock-On Target** | <kbd>Q</kbd> / Middle Click | <kbd>R3</kbd> |
| **Satchel & Crafting** | <kbd>Tab</kbd> | Select / Back |
| **Field Map** | <kbd>M</kbd> | Touchpad / View |
| **Hunter's Journal** | <kbd>B</kbd> | — |
| **Skills Progression** | <kbd>V</kbd> | — |
| **Controls Help** | <kbd>H</kbd> | — |
| **Pause / Resume** | <kbd>Esc</kbd> | Start / Menu |

---

## Project Structure

```
├── public/                 # Static assets copied directly to dist
│   ├── _headers            # Cloudflare Pages security & caching headers
│   ├── _redirects          # Cloudflare Pages redirect rules
│   ├── _routes.json        # Cloudflare Pages static routing definition
│   ├── audio/              # Ambient loops, music stems, and combat SFX
│   ├── fonts/              # Subsetted variable web fonts (Sora, Figtree)
│   ├── models/             # Optimized glTF binary models (hunter, creatures, env)
│   ├── ui/                 # Hand-crafted WebP UI frames, medallions, and item icons
│   └── vfx/                # Additive particle sprites, slashes, and impact decals
├── src/
│   ├── engine/             # Core scaffolding (loop, input, audio, assets, renderer, save)
│   ├── game/               # Gameplay logic, heightfield terrain, hunter, creatures, camp, rules
│   ├── ui/                 # High-performance HTML/CSS HUD, satchel, journal, and canvas map
│   ├── lab/                # 3D Enemy Laboratory inspector (/enemies)
│   ├── styles/             # Modular CSS design system and tribal styling
│   └── main.ts             # Application bootstrap and lifecycle orchestration
├── tests/                  # Unit and integration test suites (vitest)
├── scripts/                # Asset optimization, size budget checks, and Playwright smoke tests
├── enemies/                # Multi-page HTML entry point for the Enemy Lab
├── wrangler.toml           # Cloudflare Pages configuration
├── .nvmrc                  # Node.js version pin (Node 20 LTS)
└── vite.config.ts          # Vite bundler configuration with multi-page rollup inputs
```

---

## Local Development

### Prerequisites
- Node.js 20+ (or use `.nvmrc`)
- `npm` or `pnpm`

### Quick Start
```bash
# 1. Install dependencies
npm install

# 2. Start local development server
npm run dev
# -> http://localhost:3000

# 3. Open Enemy 3D Lab
# -> http://localhost:3000/enemies/
```

### Testing & Validation
```bash
# Run unit & integration test suites
npm test

# Run TypeScript typechecker
npm run typecheck

# Build production bundle with asset size verification
npm run build

# Run end-to-end headless browser smoke test
npm run smoke
```

---

## Hosting on Cloudflare Pages

**Prehistoric Wilds** is designed to deploy seamlessly to [Cloudflare Pages](https://pages.cloudflare.com/) as a static web application.

### Method 1: Git Integration (Recommended)
1. Push your code to GitHub (e.g. `Prehistoric-Wilds`).
2. Go to the [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
3. Select the `Prehistoric-Wilds` repository.
4. Configure build settings:
   - **Framework preset**: `Vite` (or `None`)
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `/`
5. In **Environment variables**, ensure Node 20 is selected:
   - Variable name: `NODE_VERSION`
   - Value: `20`
6. Click **Save and Deploy**.

### Method 2: Wrangler CLI Direct Upload
```bash
# 1. Install Wrangler globally or use npx
npx wrangler pages deploy dist --project-name=prehistoric-wilds
```

The bundled `public/_headers` file will automatically configure:
- Immutable 1-year caching for `.glb` models, `.wasm`, audio files, web fonts, and WebP textures.
- Correct MIME types (`model/gltf-binary`, `application/wasm`).
- Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`).

---

## License & Credits

- **Fonts**: Sora and Figtree (SIL Open Font License 1.1).
- **Environment Assets**: [Stylized Nature MegaKit](https://quaternius.itch.io/stylized-nature-megakit) by Quaternius (CC0 1.0).
- **Engine**: Three.js (MIT).
- See [CREDITS.md](CREDITS.md) for full asset provenance and details.
