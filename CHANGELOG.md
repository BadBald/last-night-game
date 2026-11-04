# Changelog

All notable changes to **LAST NIGHT** are documented here.
Format loosely follows Keep a Changelog; dates are ISO-8601.

## [Unreleased] — 2026-11-01

### Visual overhaul — art, lighting and atmosphere

The goal of this pass was to replace primitive placeholder rendering with a
coherent dark graphic-novel survival-horror look, without rewriting the game.

#### Added
- Complete procedural sprite atlas with deterministic PRNG (`src/engine/sprites.ts`).
- Four variants per tile type with baked ambient occlusion and wall-edge shading.
- Dedicated painters for every floor, wall, fence, window, barricade and door.
- Oriented doors that match horizontal or vertical wall runs.
- Layered survivor sprite with weapon/equipment overlays.
- Four visually distinct enemy classes: Crawler, Still, Bloom, Mimic.
- Enemy alert markers, wind-up attack telegraphs and post-lighting overlays so
  glowing weak points remain readable in darkness.
- Item-specific ground pickup icons with labels.
- Detailed props, containers, decals, 24 item icons, street-light poles, roofs
  and the extraction helicopter.
- Warm additive flashlight fill cone clipped to the visibility polygon.
- Twenty drifting dust motes inside the flashlight beam.
- Interior light color temperature per district (amber homes, clinical
  hospital/pharmacy, sodium industrial, cool rooftop/military).
- Deterministic wet-asphalt puddle sheen on streets, sidewalks and alleys.
- Ground fog, rare lightning, animated film grain and cinematic vignette.
- `PORT` environment variable support in `server.ts`.

#### Changed
- Renderer now draws tiles through the atlas with wall masks and variants
  (`src/engine/renderer.ts`).
- Ground items, doors, street lights, roofs, enemy telegraphs and enemy overlays
  all route through the new atlas.
- Lighting composite preserves existing lightmap behaviour while adding the
  flashlight fill and interior tints (`src/engine/lighting.ts`).
- Particle rendering upgraded from flat rectangles to soft circles/glows.

#### Preserved
- 7-hour / 30-minute run clock, survival stats, loot, inventory, stealth/noise,
  dynamic events, extraction, permadeath, PvPvE, gamepad and mobile controls.
- All existing UI screens, audio channels and settings.
- Original files backed up in `.backup-original/`.

#### Validation
- `npm run lint` passes (`tsc --noEmit`).
- `npm run build` succeeds.
- Runtime smoke test: title → new run → movement → melee → enemy damage → death
  → restart, inventory, phone, pause/resume, and all 25 rooms.
- ~60 FPS at 976×752 with the new renderer.
- No new console errors; the only expected error is the `502` radio-voice
  endpoint when `GEMINI_API_KEY` is not configured.

#### Known issues
- Single JS chunk remains above Vite's 500 kB warning threshold.
- Touch controls validated in code/browser emulation, not on physical devices.
- No automated test suite yet.
