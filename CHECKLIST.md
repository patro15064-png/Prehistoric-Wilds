# Prehistoric Wilds — Release & Deployment Checklist

Comprehensive verification checklist for the standalone release and Cloudflare Pages deployment of **Prehistoric Wilds**.

---

## 1. Core Gameplay & Features Checklist

- [x] **Telegraphed Action Combat**
  - [x] 3-hit light attack combo with fluid animations and hitstop feel
  - [x] 3-level charged heavy attack with visual charge indicator and poise break
  - [x] Responsive dodge roll with invulnerability frames (i-frames) and tactical counter-windows on perfect rolls
  - [x] Camera target lock-on (Q / Middle click) and dynamic orbit camera with terrain collision avoidance
  - [x] Mendleaf Poultices (R key) with healing particle animations and sound effects

- [x] **Weapon Classes & Movesets**
  - [x] **Club / Maul**: Heavy blunt impact, increased poise damage, high stagger multiplier
  - [x] **Greatsword / Blade**: Wide sweeping arcs, high cutting damage
  - [x] **Spear**: Long reach, precision thrusts, and counter-thrust window following a perfect dodge
  - [x] **Sling**: Ranged projectile weapon using Stone ammunition, headshots induce stagger

- [x] **Survival, Harvesting & Ecology**
  - [x] Minecraft-style direct harvesting: strike trees for wood, boulders for stone and flint
  - [x] Dedicated tool system: Flint Hatchet (rapid woodcutting) and Flint Pick (vein mining & obsidian)
  - [x] Dynamic resource respawn when moving away from depleted areas
  - [x] Predator-prey ecology: predators hunt herbivores in the wild; carcasses can be scavenged
  - [x] Scent fireflies, animal tracks, and clue analysis (3 clues unlock live HUD tracking)

- [x] **Cooking & Traps**
  - [x] Campfire cooking with an interactive Sear QTE gauge (Space/E to stop in the gold zone for extended buffs)
  - [x] Meals: Trail Stew, Snapper Broth, Hearty Haunch, Brimstone Skewer
  - [x] Survival Gadgets: Snares (trip charging beasts), Pitfall Traps (immobilize heavy monsters), Flash Pods (interrupt windups)

- [x] **Base Camp & Victory Progression**
  - [x] 3-tier camp upgrades: Stage 0 (Ruined) -> Stage 1 (Hearth) -> Stage 2 (Palisade) -> Stage 3 (Stonehold)
  - [x] Ancient Signal Tower restoration using apex trophies to trigger expedition completion and victory celebration

- [x] **Hunter's Journal & Map**
  - [x] Complete Bestiary with species entries, weaknesses, ecology, and carves
  - [x] Parchment field map with fog-of-war exploration grid, POIs, landmarks, and apex arenas

---

## 2. Technical & Performance Checklist

- [x] **Simulation & Graphics**
  - [x] Fixed 60 Hz physics/gameplay loop with interpolated rendering
  - [x] Procedural heightfield terrain with analytical raycasting and normal calculations
  - [x] Adaptive graphics governor: monitors frame rate and dynamically adjusts quality tiers (Low/Medium/High)
  - [x] Optimized 3D asset pipeline: WebP textures, meshopt attribute compression, and LOD impostors

- [x] **Testing & Verification**
  - [x] **Unit & Integration Tests**: 35 passed across 5 test suites (`npm test` / `vitest run`)
    - `tests/hunt.test.ts` (10 tests)
    - `tests/rules.test.ts` (11 tests)
    - `tests/terrain.test.ts` (5 tests)
    - `tests/scenery.test.ts` (1 test, 22k+ instances placed)
    - `tests/preview.test.mjs` (9 tests)
  - [x] **E2E Smoke Suite**: Headless Playwright test (`npm run smoke`) passing with full validation of title screen, player movement, pause menu, settings, satchel crafting, skills progression, and enemy 3D laboratory.
  - [x] **Build Budget**: Production build (`npm run build`) completes with clean bundle budgets.

---

## 3. Cloudflare Pages Deployment Checklist

- [x] **Configuration Files**
  - [x] `wrangler.toml`: Set `name = "prehistoric-wilds"`, `pages_build_output_dir = "dist"`, and `NODE_VERSION = "20"`
  - [x] `.nvmrc`: Enforces Node 20 LTS in Cloudflare Pages build environments
  - [x] `public/_headers`: Security headers and 1-year immutable caching for static assets (`.glb`, `.wasm`, `.webp`, `.woff2`, audio)
  - [x] `public/_redirects`: Clean redirect handling for sub-routes such as `/enemies`
  - [x] `public/_routes.json`: Static routing configuration
  - [x] Multi-page app output support: Generates both `dist/index.html` (main game) and `dist/enemies/index.html` (enemy lab)

---

## 4. Git Sanitation & Security Checklist

- [x] **Ignored Files**:
  - [x] `node_modules/`
  - [x] `dist/`
  - [x] `shots/` and `scratch/`
  - [x] `.manus-webdev/` (private runtime identifiers and cloud environment bindings)
  - [x] `.manus-starter-init.json`
  - [x] `.env*` files
  - [x] OS-specific files (`.DS_Store`, `Thumbs.db`)
- [x] **Assets & Provenance**:
  - [x] All 3D models, textures, audio loops, and UI assets properly bundled in `public/`
  - [x] Licenses and credits documented in `CREDITS.md`
- [x] **Remote Repository**:
  - [x] Git repository initialized with `main` default branch
  - [x] GitHub repository `Prehistoric-Wilds` created and pushed
